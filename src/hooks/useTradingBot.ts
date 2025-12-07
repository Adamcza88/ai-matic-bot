// hooks/useTradingBot.ts
import { useState, useEffect, useRef, useCallback } from "react";
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
    EntryHistoryRecord,
    TestnetOrder,
    TestnetTrade,
    AssetPnlRecord,
    
} from "../types";

import { Candle, evaluateStrategyForSymbol } from "@/engine/botEngine";
import { useNetworkConfig } from "../engine/networkConfig";
import { addEntryToHistory, loadEntryHistory, removeEntryFromHistory } from "../lib/entryHistory";
import { addPnlRecord, loadPnlHistory, AssetPnlMap } from "../lib/pnlHistory";

// SYMBOLS
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];

// SIMULOVANÝ KAPITÁL
const INITIAL_CAPITAL = 200000;
const MAX_SINGLE_POSITION_VALUE = 10000;
const MIN_ENTRY_SPACING_MS = 3000;

// RISK / STRATEGY
export const INITIAL_RISK_SETTINGS: AISettings = {
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: true,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.1,
    maxDailyProfitPercent: 0.1,
    maxDrawdownPercent: 0.09,
    baseRiskPerTrade: 0.07,
    strategyProfile: "scalp",
    entryStrictness: "ultra",
    enforceSessionHours: true,
    haltOnDailyLoss: false,
    haltOnDrawdown: false,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    maxAllocatedCapitalPercent: 1,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.2,
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

function snapshotSettings(settings: AISettings): AISettings {
    return {
        ...settings,
        tradingDays: [...settings.tradingDays],
    };
}

// ========== HLAVNÍ HOOK ==========

export const useTradingBot = (
    mode: TradingMode,
    useTestnet: boolean,
    authToken?: string
) => {
    const { httpBase } = useNetworkConfig(useTestnet);
    const envBase = (import.meta as any).env?.VITE_API_BASE;
    const inferredBase =
        typeof window !== "undefined" ? window.location.origin : "";
    const apiBase = (envBase || inferredBase || "").replace(/\/$/, "");

    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [activePositions, setActivePositions] = useState<ActivePosition[]>(
        []
    );
    const [closedPositions, _setClosedPositions] = useState<ClosedPosition[]>(
        []
    );
    const [pendingSignals, setPendingSignals] = useState<PendingSignal[]>([]);
    const pendingSignalsRef = useRef<PendingSignal[]>([]);
    const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(
        {}
    );
    const [portfolioHistory, _setPortfolioHistory] = useState<
        { timestamp: string; totalCapital: number }[]
    >([]);
    const [newsHeadlines, setNewsHeadlines] = useState<NewsItem[]>([]);
    const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
    const [entryHistory, setEntryHistory] = useState<EntryHistoryRecord[]>([]);
    const [testnetOrders, setTestnetOrders] = useState<TestnetOrder[]>([]);
    const [testnetTrades, setTestnetTrades] = useState<TestnetTrade[]>([]);
    const [ordersError, setOrdersError] = useState<string | null>(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState<AssetPnlMap>({});
    const [settings, setSettings] = useState(INITIAL_RISK_SETTINGS);

    const [systemState, setSystemState] = useState({
        bybitStatus: "Connecting...",
        latency: 0,
        lastError: null as string | null,
        recentErrors: [] as string[],
    });
    const activePositionsRef = useRef<ActivePosition[]>([]);

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
        maxOpenPositions: 4,
    });
    const lastEntryAtRef = useRef<number | null>(null);
    const entryQueueRef = useRef<Promise<void>>(Promise.resolve());

    // Dynamicky uprav capital/max allocation pro testovací režim
    useEffect(() => {
        const isTest = settings.entryStrictness === "test";
        setPortfolioState((prev) => {
            const totalCapital = isTest ? prev.totalCapital || 200000 : INITIAL_CAPITAL;
            const pctCap = totalCapital * settings.maxAllocatedCapitalPercent;
            const maxAlloc = isTest ? Math.min(1000000, pctCap) : pctCap;
            return {
                ...prev,
                totalCapital,
                maxAllocatedCapital: maxAlloc,
                allocatedCapital: Math.min(prev.allocatedCapital, maxAlloc),
            };
        });
    }, [settings.entryStrictness, settings.maxAllocatedCapitalPercent]);

    // Přepočet denního PnL podle otevřených pozic (unrealized)
    useEffect(() => {
        const unrealized = activePositions.reduce(
            (sum, p) => sum + (p.pnl ?? 0),
            0
        );
        setPortfolioState((prev) => ({
            ...prev,
            dailyPnl: realizedPnlRef.current + unrealized,
        }));
    }, [activePositions]);

    useEffect(() => {
        setEntryHistory(loadEntryHistory());
        setAssetPnlHistory(loadPnlHistory());
    }, []);

    useEffect(() => {
        pendingSignalsRef.current = pendingSignals;
    }, [pendingSignals]);

    useEffect(() => {
        activePositionsRef.current = activePositions;
    }, [activePositions]);

    const fetchTestnetOrders = useCallback(async () => {
        if (!authToken) {
            setTestnetOrders([]);
            setOrdersError("Missing auth token");
            return;
        }
        if (!useTestnet) {
            setTestnetOrders([]);
            setOrdersError("Testnet off");
            return;
        }
        // Pokud není definován explicitní backend, nezkoušej fetchovat – předejdeme 404 na statickém hostu
        const baseProvided = Boolean(envBase);
        const sameOrigin =
            typeof window !== "undefined" &&
            inferredBase === window.location.origin;
        if (!baseProvided && sameOrigin) {
            setTestnetOrders([]);
            setOrdersError("Orders API unavailable: configure VITE_API_BASE to point to backend");
            return;
        }
        try {
            setOrdersError(null);
            const res = await fetch(`${apiBase}/api/demo/orders`, {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Orders API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
            const mapped: TestnetOrder[] = Array.isArray(list)
                ? list.map((o: any) => {
                    const toIso = (ts: any) => {
                        const n = Number(ts);
                        return Number.isFinite(n) && n > 0
                            ? new Date(n).toISOString()
                            : new Date().toISOString();
                    };
                    return {
                        orderId: o.orderId || o.orderLinkId || o.id || `${Date.now()}`,
                        symbol: o.symbol || "",
                        side: (o.side as "Buy" | "Sell") || "Buy",
                        qty: Number(o.qty ?? o.cumExecQty ?? 0),
                        price: o.price != null ? Number(o.price) : o.avgPrice != null ? Number(o.avgPrice) : null,
                        status: o.orderStatus || o.status || "unknown",
                        createdTime: toIso(o.createdTime ?? o.created_at ?? Date.now()),
                    };
                })
                : [];
            setTestnetOrders(mapped);
        } catch (err: any) {
            setOrdersError(err?.message || "Failed to load orders");
        }
    }, [authToken, useTestnet, apiBase]);

    const fetchTestnetTrades = useCallback(async () => {
        if (!authToken || !useTestnet) {
            setTestnetTrades([]);
            return;
        }
        const baseProvided = Boolean(envBase);
        const sameOrigin =
            typeof window !== "undefined" &&
            inferredBase === window.location.origin;
        if (!baseProvided && sameOrigin) {
            setTestnetTrades([]);
            return;
        }
        try {
            const res = await fetch(`${apiBase}/api/demo/trades`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Trades API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
            const mapped: TestnetTrade[] = Array.isArray(list)
                ? list.map((t: any) => {
                    const ts = Number(t.execTime ?? t.transactTime ?? t.createdTime ?? Date.now());
                    return {
                        id: t.execId || t.tradeId || `${Date.now()}`,
                        symbol: t.symbol || "",
                        side: (t.side as "Buy" | "Sell") || "Buy",
                        price: Number(t.execPrice ?? t.price ?? 0),
                        qty: Number(t.execQty ?? t.qty ?? 0),
                        value: Number(t.execValue ?? t.value ?? 0),
                        fee: Number(t.execFee ?? t.fee ?? 0),
                        time: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
                    };
                })
                : [];
            setTestnetTrades(mapped);
        } catch (err: any) {
            setOrdersError((prev) => prev || err?.message || "Failed to load trades");
        }
    }, [authToken, useTestnet, apiBase, envBase, inferredBase]);

    // Sync reálně fillnuté trady z testnetu do Entry History (aby UI odpovídalo skutečným obchodům)
    useEffect(() => {
        if (!testnetTrades.length) return;
        setEntryHistory(() => {
            let current = loadEntryHistory();
            const existingIds = new Set(current.map((r) => r.id));
            const toAdd = testnetTrades.filter((t) => !existingIds.has(t.id));
            if (!toAdd.length) return current;
            toAdd.forEach((t) => {
                const record: EntryHistoryRecord = {
                    id: t.id,
                    symbol: t.symbol,
                    side: t.side.toLowerCase() as "buy" | "sell",
                    entryPrice: t.price,
                    sl: undefined,
                    tp: undefined,
                    size: t.qty,
                    createdAt: t.time,
                    settingsNote: "imported from testnet trade",
                    settingsSnapshot: snapshotSettings(settingsRef.current),
                };
                current = addEntryToHistory(record);
            });
            return current;
        });
    }, [testnetTrades]);

    useEffect(() => {
        void fetchTestnetOrders();
        void fetchTestnetTrades();
    }, [fetchTestnetOrders]);

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
                const prevActive = activePositionsRef.current;
                const closed = prevActive.filter(
                    (p) => !engineActive.some((e) => e.id === p.id)
                );

                let freedNotional = 0;
                if (closed.length) {
                    closed.forEach((p) => {
                        const exitPrice =
                            newPrices[p.symbol] ??
                            currentPrices[p.symbol] ??
                            p.entryPrice;
                        const dir = p.side === "buy" ? 1 : -1;
                        const pnl =
                            (exitPrice - p.entryPrice) * dir * p.size;
                        realizedPnlRef.current += pnl;
                        const record: AssetPnlRecord = {
                            symbol: p.symbol,
                            pnl,
                            timestamp: new Date().toISOString(),
                            note: `Auto-close @ ${exitPrice.toFixed(
                                4
                            )} | size ${p.size.toFixed(4)}`,
                        };
                        setAssetPnlHistory(() => addPnlRecord(record));
                        freedNotional += p.entryPrice * p.size;
                        addLog({
                            action: "AUTO_CLOSE",
                            message: `${p.symbol} auto-closed @ ${exitPrice.toFixed(
                                4
                            )} | PnL ${pnl.toFixed(2)} USDT`,
                        });
                    });
                }

                setActivePositions(() => {
                    activePositionsRef.current = engineActive;
                    return engineActive;
                });
                setPortfolioState((p) => ({
                    ...p,
                    openPositions: engineActive.length,
                    allocatedCapital: Math.max(
                        0,
                        p.allocatedCapital - freedNotional
                    ),
                }));

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
    const performTrade = async (signalId: string): Promise<boolean> => {
        const signal = pendingSignalsRef.current.find((s) => s.id === signalId);
        if (!signal) return false;

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
            return false;
        }

        const intent: TradeIntent = signal.intent;
        const { entry, sl, tp, side } = intent;

        const riskPerTrade =
            portfolioState.totalCapital *
            settings.baseRiskPerTrade *
            settings.positionSizingMultiplier;

        const riskPerUnit = Math.abs(entry - sl);
        if (riskPerUnit <= 0) return false;

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
            return false;
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
            )} USDT, TS≈${trailingStopPct.toFixed(2)}% from 1R)`,
        });

        const settingsSnapshot = snapshotSettings(settingsRef.current);
        const historyRecord: EntryHistoryRecord = {
            id: position.id,
            symbol: signal.symbol,
            side,
            entryPrice: entry,
            sl,
            tp,
            size,
            createdAt: new Date().toISOString(),
            settingsNote: `profile=${settingsSnapshot.strategyProfile}, strictness=${settingsSnapshot.entryStrictness}, risk=${settingsSnapshot.baseRiskPerTrade}, mult=${settingsSnapshot.positionSizingMultiplier}`,
            settingsSnapshot,
        };
        setEntryHistory(() => addEntryToHistory(historyRecord));

        // === VOLÁNÍ BACKENDU – POSÍLÁME SL/TP + DYNAMICKÝ TRAILING ===
        try {
            if (!authToken) {
                addLog({
                    action: "ERROR",
                    message:
                        "Missing auth token for placing order. Please re-login.",
                });
                return true;
            }

            const res = await fetch(`${apiBase}/api/demo/order`, {
                method: "POST",
                headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                        symbol: signal.symbol,
                        side: side === "buy" ? "Buy" : "Sell",
                        qty: Number(size.toFixed(3)),
                        orderType: "Limit",
                        timeInForce: "IOC",
                        price:
                            side === "buy"
                                ? entry * 1.001 // lehce nad vstupní cenu, aby se limit rychle fillnul
                                : entry * 0.999,
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
        return true;
    };

    function executeTrade(signalId: string): Promise<void> {
        entryQueueRef.current = entryQueueRef.current
            .catch(() => {
                // swallow to keep queue alive
            })
            .then(async () => {
                const last = lastEntryAtRef.current;
                const sinceLast = last ? Date.now() - last : Infinity;
                const waitMs =
                    sinceLast < MIN_ENTRY_SPACING_MS
                        ? MIN_ENTRY_SPACING_MS - sinceLast
                        : 0;

                // Delay only when více vstupů čeká zároveň.
                if (pendingSignalsRef.current.length > 0 && waitMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                }

                const executed = await performTrade(signalId);
                if (executed) {
                    lastEntryAtRef.current = Date.now();
                }
            });

        return entryQueueRef.current;
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
                headline: "Volatility rising in BTCUSDT",
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
        setActivePositions((prev) => {
            const target = prev.find((p) => p.id === id);
            if (!target) return prev;

            const currentPrice = currentPrices[target.symbol] ?? target.entryPrice;
            const dir = target.side === "buy" ? 1 : -1;
            const pnl = (currentPrice - target.entryPrice) * dir * target.size;
            const freedNotional = target.entryPrice * target.size;

            realizedPnlRef.current += pnl;

            const record: AssetPnlRecord = {
                symbol: target.symbol,
                pnl,
                timestamp: new Date().toISOString(),
                note: `Closed at ${currentPrice.toFixed(4)} | size ${target.size.toFixed(4)}`,
            };
            setAssetPnlHistory(() => addPnlRecord(record));

            setPortfolioState((p) => ({
                ...p,
                allocatedCapital: Math.max(0, p.allocatedCapital - freedNotional),
                openPositions: Math.max(0, p.openPositions - 1),
            }));
            addLog({
                action: "CLOSE",
                message: `Position ${id} closed manually | PnL ${pnl.toFixed(2)} USDT`,
            });

            return prev.filter((p) => p.id !== id);
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

    const removeEntryHistoryItem = (id: string) => {
        setEntryHistory(() => removeEntryFromHistory(id));
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
        entryHistory,
        testnetOrders,
        testnetTrades,
        ordersError,
        refreshTestnetOrders: fetchTestnetOrders,
        assetPnlHistory,
        removeEntryHistoryItem,
    };
};

// ========= API TYPE EXPORT ==========
export type TradingBotApi = ReturnType<typeof useTradingBot>;
