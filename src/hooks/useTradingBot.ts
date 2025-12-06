// hooks/useTradingBot.ts
import { useState, useEffect, useRef } from "react";
import {
    TradingMode,
    TradeIntent,
    PendingSignal,
    ActivePosition,
    ClosedPosition,
    LogEntry,
    NewsItem,
    PriceAlert,
    AISettings,
} from "../types";

import { Candle, evaluateStrategyForSymbol } from "../engine/botEngine";
import { useNetworkConfig } from "../engine/networkConfig";

// SYMBOLS
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];

// SIMULOVANÝ KAPITÁL
const INITIAL_CAPITAL = 100000;
const MAX_SINGLE_POSITION_VALUE = 10000;

// RISK / STRATEGY
export const INITIAL_RISK_SETTINGS: AISettings = {
    strictRiskAdherence: false,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: false,
    useLiquiditySweeps: false,
    useVolatilityExpansion: false,
    maxDailyLossPercent: 0.02,
    maxDailyProfitPercent: 0.03,
    maxDrawdownPercent: 0.05,
    baseRiskPerTrade: 0.02,
    strategyProfile: "auto",
    entryStrictness: "base",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    maxAllocatedCapitalPercent: 0.5,
    requireConfirmationInAuto: true,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.5,
    minWinRate: 65,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
};

// UTILS
function parseKlines(list: any[]): Candle[] {
    if (!Array.isArray(list)) return [];
    return list
        .map((row: any) => {
            const [ts, open, high, low, close, volume] = row;
            return {
                openTime: Number(ts),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume),
            } as Candle;
        })
        .sort((a, b) => a.openTime - b.openTime);
}

function withinSession(settings: typeof INITIAL_RISK_SETTINGS, now: Date) {
    if (settings.entryStrictness === "test") return true;
    if (!settings.enforceSessionHours) return true;
    const day = now.getDay();
    const hour = now.getHours();
    if (!settings.tradingDays.includes(day)) return false;
    if (hour < settings.tradingStartHour || hour > settings.tradingEndHour)
        return false;
    return true;
}

function chooseStrategyProfile(
    candles: Candle[],
    preferred: (typeof INITIAL_RISK_SETTINGS)["strategyProfile"]
): "trend" | "scalp" | "swing" | "intraday" | null {
    if (preferred === "off") return null;
    if (preferred === "trend") return "trend";
    if (preferred === "scalp") return "scalp";
    if (preferred === "swing") return "swing";
    if (preferred === "intraday") return "intraday";
    // auto: heuristika podle volatility
    if (candles.length < 20) return "trend";
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const atr = (() => {
        let res = 0;
        for (let i = 1; i < closes.length; i++) {
            const hl = highs[i] - lows[i];
            const hc = Math.abs(highs[i] - closes[i - 1]);
            const lc = Math.abs(lows[i] - closes[i - 1]);
            res += Math.max(hl, hc, lc);
        }
        const avg = res / Math.max(1, closes.length - 1);
        return avg;
    })();
    const price = closes[closes.length - 1] || 1;
    const atrPct = atr / price;
    if (atrPct < 0.0015) return "scalp";
    if (atrPct > 0.006) return "swing";
    return "trend";
}

// ========== HLAVNÍ HOOK ==========

export const useTradingBot = (
    mode: TradingMode,
    useTestnet: boolean,
    authToken?: string
) => {
    const { httpBase } = useNetworkConfig(useTestnet);

    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [activePositions, setActivePositions] = useState<ActivePosition[]>(
        []
    );
    const [closedPositions, _setClosedPositions] = useState<ClosedPosition[]>(
        []
    );
    const [pendingSignals, setPendingSignals] = useState<PendingSignal[]>([]);
    const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(
        {}
    );
    const [portfolioHistory, _setPortfolioHistory] = useState<
        { timestamp: string; totalCapital: number }[]
    >([]);
    const [newsHeadlines, setNewsHeadlines] = useState<NewsItem[]>([]);
    const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
    const [settings, setSettings] = useState(INITIAL_RISK_SETTINGS);

    const [systemState, setSystemState] = useState({
        bybitStatus: "Connecting...",
        latency: 0,
        lastError: null as string | null,
        recentErrors: [] as string[],
    });

    const [portfolioState, setPortfolioState] = useState({
        totalCapital: INITIAL_CAPITAL,
        allocatedCapital: 0,
        maxAllocatedCapital:
            INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxAllocatedCapitalPercent,
        dailyPnl: 0,
        maxDailyLoss:
            INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxDailyLossPercent,
        maxDailyProfit:
            INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxDailyProfitPercent,
        peakCapital: INITIAL_CAPITAL,
        currentDrawdown: 0,
        maxDrawdown: INITIAL_RISK_SETTINGS.maxDrawdownPercent,
        openPositions: 0,
        maxOpenPositions: 5,
    });

    // Dynamicky uprav maxAllocation pro testovací režim
    useEffect(() => {
        const capPct =
            settings.entryStrictness === "test"
                ? 0.9
                : settings.maxAllocatedCapitalPercent;
        setPortfolioState((prev) => ({
            ...prev,
            maxAllocatedCapital: prev.totalCapital * capPct,
        }));
    }, [settings.entryStrictness, settings.maxAllocatedCapitalPercent]);

    const [aiModelState, _setAiModelState] = useState({
        version: "1.0.0-real-strategy",
        lastRetrain: new Date(Date.now() - 7 * 24 * 3600 * 1000)
            .toISOString()
            .split("T")[0],
        nextRetrain: new Date(Date.now() + 7 * 24 * 3600 * 1000)
            .toISOString()
            .split("T")[0],
        status: "Idle" as "Idle" | "Training",
    });

    const priceHistoryRef = useRef<Record<string, Candle[]>>({});
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const realizedPnlRef = useRef(0);

    // ========== LOG ==========
    const addLog = (entry: Omit<LogEntry, "id" | "timestamp">) => {
        const log: LogEntry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date().toISOString(),
            ...entry,
        };
        setLogEntries((prev) => [log, ...prev].slice(0, 200));
    };

    // ========== FETCH CEN Z BYBIT (mainnet / testnet) ==========
    useEffect(() => {
        if (mode === TradingMode.OFF) {
            setSystemState((p) => ({ ...p, bybitStatus: "Disconnected" }));
            return;
        }

        let cancel = false;

        const fetchAll = async () => {
            const started = performance.now();
            const now = new Date();

            if (!withinSession(settingsRef.current, now)) return;

            try {
                const URL_KLINE = `${httpBase}/v5/market/kline?category=linear`;

                const newPrices: Record<string, number> = {};
                const newHistory: any = { ...priceHistoryRef.current };
                const engineActive: ActivePosition[] = [];

                for (const symbol of SYMBOLS) {
                    const url = `${URL_KLINE}&symbol=${symbol}&interval=1&limit=200`;
                    const r = await fetch(url);
                    const j = await r.json();
                    if (j.retCode !== 0) throw new Error(j.retMsg);

                    const candles = parseKlines(j.result?.list ?? []);
                    if (!candles.length) continue;

                    newHistory[symbol] = candles;
                    newPrices[symbol] = candles[candles.length - 1].close;

                    if (mode !== TradingMode.BACKTEST) {
                        const profile = chooseStrategyProfile(
                            candles,
                            settingsRef.current.strategyProfile as any
                        );
                        if (!profile) continue;
                        const decision = evaluateStrategyForSymbol(
                            symbol,
                            candles,
                            {
                                strategyProfile: profile,
                                entryStrictness:
                                    settingsRef.current.entryStrictness,
                                riskPerTrade:
                                    settingsRef.current.baseRiskPerTrade,
                            }
                        );
                        const signal = decision?.signal;
                        if (signal) {
                            setPendingSignals((prev) => [signal, ...prev]);
                            addLog({
                                action: "SIGNAL",
                                message: `${signal.intent.side} ${symbol} @ ${signal.intent.entry} | TESTNET=${useTestnet}`,
                            });
                        }
                        if (decision?.position) {
                            const pos = decision.position;
                            const dir = pos.side === "long" ? 1 : -1;
                            const currentPrice =
                                candles[candles.length - 1].close;
                            const pnl =
                                (currentPrice - pos.entryPrice) *
                                dir *
                                pos.size;
                            const mapped: ActivePosition = {
                                id: `${symbol}-${pos.opened}`,
                                symbol,
                                side: pos.side === "long" ? "buy" : "sell",
                                entryPrice: pos.entryPrice,
                                sl: pos.stopLoss,
                                tp: Number.isFinite(pos.takeProfit)
                                    ? pos.takeProfit
                                    : pos.initialTakeProfit,
                                size: pos.size,
                                openedAt: new Date(pos.opened).toISOString(),
                                unrealizedPnl: pnl,
                                pnl,
                                pnlValue: pnl,
                                rrr:
                                    Math.abs(
                                        (Number.isFinite(pos.takeProfit)
                                            ? pos.takeProfit
                                            : pos.initialTakeProfit) -
                                            pos.entryPrice
                                    ) /
                                        Math.abs(
                                            pos.entryPrice - pos.stopLoss ||
                                                1e-8
                                        ) || 0,
                                peakPrice: pos.highWaterMark,
                                currentTrailingStop: pos.trailingStop,
                                volatilityFactor: undefined,
                                lastUpdateReason: undefined,
                                timestamp: new Date().toISOString(),
                            };
                            engineActive.push(mapped);
                        }
                    }
                }

                if (cancel) return;

                priceHistoryRef.current = newHistory;
                setCurrentPrices(newPrices);
                setActivePositions(engineActive);

                const latency = Math.round(performance.now() - started);
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Connected",
                    latency,
                    lastError: null,
                }));
            } catch (err: any) {
                if (cancel) return;
                const msg = err.message ?? "unknown";
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Error",
                    lastError: msg,
                    recentErrors: [msg, ...p.recentErrors].slice(0, 10),
                }));
                addLog({ action: "ERROR", message: msg });
            }
        };

        fetchAll();
        const id = setInterval(fetchAll, 12000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [mode, useTestnet, httpBase]);

    // ========== EXECUTE TRADE (simulated + backend order) ==========
    async function executeTrade(signalId: string) {
        const signal = pendingSignals.find((s) => s.id === signalId);
        if (!signal) return;

        // Jednoduchý risk-engine: hlídá max. risk / capital allocation
        const maxAlloc = portfolioState.maxAllocatedCapital;
        const currentAlloc = portfolioState.allocatedCapital;

        const plannedNotional =
            portfolioState.totalCapital *
            settings.baseRiskPerTrade *
            settings.positionSizingMultiplier;

        if (currentAlloc + plannedNotional > maxAlloc) {
            setLogEntries((prev) => [
                {
                    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    action: "RISK_BLOCK",
                    timestamp: new Date().toISOString(),
                    message: `Signal on ${signal.symbol} blocked: too much allocated capital.`,
                },
                ...prev,
            ]);
            return;
        }

        const intent: TradeIntent = signal.intent;
        const { entry, sl, tp, side } = intent;

        const riskPerTrade =
            portfolioState.totalCapital *
            settings.baseRiskPerTrade *
            settings.positionSizingMultiplier;

        const riskPerUnit = Math.abs(entry - sl);
        if (riskPerUnit <= 0) return;

        let size = riskPerTrade / riskPerUnit;
        let notional = size * entry;

        if (notional > MAX_SINGLE_POSITION_VALUE) {
            const factor = MAX_SINGLE_POSITION_VALUE / notional;
            size *= factor;
            notional = MAX_SINGLE_POSITION_VALUE;
        }

        if (
            portfolioState.allocatedCapital + notional >
            portfolioState.maxAllocatedCapital
        ) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} exceeds capital allocation limit.`,
            });
            return;
        }

        // ===== DYNAMICKÝ TRAILING STOP (odvozený z 1R) =====
        const oneR = Math.abs(entry - sl); // velikost SL
        const trailingDistance = oneR * 0.5; // 0.5R
        let trailingActivationPrice: number | null = null;

        if (side === "buy") {
            trailingActivationPrice = entry + oneR; // aktivace při +1R
        } else {
            trailingActivationPrice = entry - oneR;
        }

        // callbackRate v %
        const trailingStopPct = (trailingDistance / entry) * 100;
        const trailingStopDistance = trailingDistance;

        const position: ActivePosition = {
            id: `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            symbol: signal.symbol,
            side,
            entryPrice: entry,
            sl,
            tp,
            size,
            openedAt: new Date().toISOString(),
            unrealizedPnl: 0,
            currentTrailingStop: sl,
            rrr: Math.abs(tp - entry) / Math.abs(entry - sl) || 0,
            pnl: 0,
            pnlValue: 0,
            timestamp: new Date().toISOString(),
            peakPrice: entry,
        };

        setActivePositions((prev) => [position, ...prev]);
        setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
        setPortfolioState((prev) => ({
            ...prev,
            allocatedCapital: prev.allocatedCapital + notional,
            openPositions: prev.openPositions + 1,
        }));

        addLog({
            action: "OPEN",
            message: `Opened ${side.toUpperCase()} ${
                signal.symbol
            } at ${entry.toFixed(4)} (size ≈ ${size.toFixed(
                4
            )}, notional ≈ ${notional.toFixed(
                2
            )} USD, TS≈${trailingStopPct.toFixed(2)}% from 1R)`,
        });

        // === VOLÁNÍ BACKENDU – POSÍLÁME SL/TP + DYNAMICKÝ TRAILING ===
        try {
            if (!authToken) {
                addLog({
                    action: "ERROR",
                    message:
                        "Missing auth token for placing order. Please re-login.",
                });
                return;
            }

            const res = await fetch("/api/demo/order", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    symbol: signal.symbol,
                    side: side === "buy" ? "Buy" : "Sell",
                    qty: Number(size.toFixed(3)),
                    sl,
                    tp,
                    trailingStop: trailingStopDistance,
                    trailingStopPct,
                    trailingActivationPrice,
                }),
            });

            if (!res.ok) {
                const errText = await res.text();
                addLog({
                    action: "ERROR",
                    message: `Order API failed (${res.status}): ${errText}`,
                });
            }
        } catch (err: any) {
            addLog({
                action: "ERROR",
                message: `Demo API order failed: ${err?.message || "unknown"}`,
            });
        }
    }

    // ========== AUTO MODE ==========
    useEffect(() => {
        if (modeRef.current !== TradingMode.AUTO_ON) return;
        if (!pendingSignals.length) return;

        const sig = pendingSignals[0];
        if (settingsRef.current.requireConfirmationInAuto && sig.risk < 0.65)
            return;

        void executeTrade(sig.id);
    }, [pendingSignals]);

    // MOCK NEWS
    useEffect(() => {
        setNewsHeadlines([
            {
                id: "n1",
                headline: "Volatility rising in BTC",
                sentiment: "neutral",
                source: "scanner",
                time: new Date().toISOString(),
            },
        ]);
    }, []);

    const addPriceAlert = (symbol: string, price: number) => {
        const alert: PriceAlert = {
            id: `a-${Date.now()}`,
            symbol,
            price,
            createdAt: new Date().toISOString(),
            triggered: false,
        };
        setPriceAlerts((p) => [...p, alert]);
    };

    const removePriceAlert = (id: string) => {
        setPriceAlerts((p) => p.filter((a) => a.id !== id));
    };

    const closePosition = (id: string) => {
        setActivePositions((prev) => prev.filter((p) => p.id !== id));
        setPortfolioState((prev) => ({
            ...prev,
            openPositions: Math.max(0, prev.openPositions - 1),
        }));
        addLog({
            action: "CLOSE",
            message: `Position ${id} closed manually`,
        });
    };

    const resetRiskState = () => {
        setPortfolioState((p) => ({
            ...p,
            dailyPnl: 0,
            currentDrawdown: 0,
            peakCapital: p.totalCapital,
        }));
        realizedPnlRef.current = 0;
    };

    const updateSettings = (newS: typeof INITIAL_RISK_SETTINGS) => {
        setSettings(newS);
        settingsRef.current = newS;
    };

    const rejectSignal = (id: string) => {
        setPendingSignals((prev) => prev.filter((s) => s.id !== id));

        setLogEntries((prev) => [
            {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                action: "REJECT",
                timestamp: new Date().toISOString(),
                message: `Rejected signal ${id}`,
            },
            ...prev,
        ]);
    };

    // ========= RETURN API ==========
    return {
        logEntries,
        activePositions,
        closedPositions,
        systemState,
        portfolioState,
        aiModelState,
        settings,
        currentPrices,
        pendingSignals,
        portfolioHistory,
        newsHeadlines,
        priceAlerts,
        addPriceAlert,
        removePriceAlert,
        updateSettings,
        resetRiskState,
        executeTrade,
        rejectSignal,
        closePosition,
    };
};

// ========= API TYPE EXPORT ==========
export type TradingBotApi = ReturnType<typeof useTradingBot>;
