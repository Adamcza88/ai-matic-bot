// hooks/useTradingBot.ts
import { useState, useEffect, useRef, useCallback } from "react";
import { TradingMode, } from "../types";
import { evaluateStrategyForSymbol } from "@/engine/botEngine";
import { useNetworkConfig } from "../engine/networkConfig";
import { addEntryToHistory, loadEntryHistory, removeEntryFromHistory } from "../lib/entryHistory";
import { addPnlRecord, loadPnlHistory } from "../lib/pnlHistory";
// SYMBOLS
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];
// SIMULOVANÝ / DEFAULT KAPITÁL
const INITIAL_CAPITAL = 101.33; // Unified Trading balance snapshot
const MAX_SINGLE_POSITION_VALUE = 120;
const MIN_ENTRY_SPACING_MS = 3000;
const MAX_TEST_PENDING = 4;
const KEEPALIVE_SIGNAL_INTERVAL_MS = 12000;
const QTY_LIMITS = {
    BTCUSDT: { min: 0.0005, max: 0.01 },
    ETHUSDT: { min: 0.001, max: 0.2 },
    SOLUSDT: { min: 0.01, max: 5 },
    ADAUSDT: { min: 10, max: 5000 },
};
// RISK / STRATEGY
const AI_MATIC_PRESET = {
    riskMode: "ai-matic",
    strictRiskAdherence: true,
    pauseOnHighVolatility: true,
    avoidLowLiquidity: true,
    useTrendFollowing: true,
    smcScalpMode: false,
    useLiquiditySweeps: true,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.05,
    maxDailyProfitPercent: 0.12,
    maxDrawdownPercent: 0.18,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.08,
    maxAllocatedCapitalPercent: 0.4,
    maxOpenPositions: 2,
    strategyProfile: "auto",
    entryStrictness: "base",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: true,
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
const AI_MATIC_X_PRESET = {
    riskMode: "ai-matic-x",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: true,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.12,
    maxDailyProfitPercent: 0.5,
    maxDrawdownPercent: 0.38,
    baseRiskPerTrade: 0.04,
    maxPortfolioRiskPercent: 0.15,
    maxAllocatedCapitalPercent: 0.8,
    maxOpenPositions: 4,
    strategyProfile: "auto",
    entryStrictness: "ultra",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.5,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.1,
    minWinRate: 55,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
};
export const INITIAL_RISK_SETTINGS = AI_MATIC_X_PRESET;
// UTILS
function parseKlines(list) {
    if (!Array.isArray(list))
        return [];
    return list
        .map((row) => {
        const [ts, open, high, low, close, volume] = row;
        return {
            openTime: Number(ts),
            open: parseFloat(open),
            high: parseFloat(high),
            low: parseFloat(low),
            close: parseFloat(close),
            volume: parseFloat(volume),
        };
    })
        .sort((a, b) => a.openTime - b.openTime);
}
function withinSession(settings, now) {
    if (settings.entryStrictness === "test")
        return true;
    if (!settings.enforceSessionHours)
        return true;
    const day = now.getDay();
    const hour = now.getHours();
    if (!settings.tradingDays.includes(day))
        return false;
    if (hour < settings.tradingStartHour || hour > settings.tradingEndHour)
        return false;
    return true;
}
function chooseStrategyProfile(candles, preferred) {
    if (preferred === "off")
        return null;
    if (preferred === "coach")
        return "scalp";
    if (preferred === "trend")
        return "trend";
    if (preferred === "scalp")
        return "scalp";
    if (preferred === "swing")
        return "swing";
    if (preferred === "intraday")
        return "intraday";
    // auto: heuristika podle volatility
    if (candles.length < 20)
        return "trend";
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
    if (atrPct < 0.0015)
        return "scalp";
    if (atrPct > 0.0075)
        return "swing";
    if (atrPct > 0.0045)
        return "trend";
    return "intraday";
}
function snapshotSettings(settings) {
    return {
        ...settings,
        tradingDays: [...settings.tradingDays],
    };
}
const presetFor = (mode) => mode === "ai-matic-x" ? AI_MATIC_X_PRESET : AI_MATIC_PRESET;
const clampQtyForSymbol = (symbol, qty) => {
    const limits = QTY_LIMITS[symbol];
    if (!limits)
        return qty;
    return Math.min(limits.max, Math.max(limits.min, qty));
};
function computeAtrFromHistory(candles, period = 20) {
    if (!candles || candles.length < 2)
        return 0;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const trs = [];
    for (let i = 1; i < closes.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        trs.push(Math.max(hl, hc, lc));
    }
    if (!trs.length)
        return 0;
    const slice = trs.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / slice.length;
}
const resolveRiskPct = (settings) => {
    const base = settings.baseRiskPerTrade;
    if (settings.strategyProfile === "scalp") {
        return Math.max(0.01, Math.min(base, 0.02));
    }
    if (settings.strategyProfile === "trend" || settings.strategyProfile === "swing") {
        return Math.max(base, 0.03);
    }
    if (settings.strategyProfile === "intraday") {
        return Math.max(base, 0.025);
    }
    return base;
};
const computePositionRisk = (p) => {
    const stop = p.currentTrailingStop ?? p.sl ?? p.entryPrice;
    const distance = Math.max(0, Math.abs(p.entryPrice - stop));
    return distance * p.size;
};
// ========== HLAVNÍ HOOK ==========
export const useTradingBot = (mode, useTestnet, authToken) => {
    const { httpBase } = useNetworkConfig(useTestnet);
    const envBase = import.meta.env?.VITE_API_BASE;
    const inferredBase = typeof window !== "undefined" ? window.location.origin : "";
    const apiBase = (envBase || inferredBase || "").replace(/\/$/, "");
    const [logEntries, setLogEntries] = useState([]);
    const [activePositions, setActivePositions] = useState([]);
    const [closedPositions, _setClosedPositions] = useState([]);
    const [pendingSignals, setPendingSignals] = useState([]);
    const pendingSignalsRef = useRef([]);
    const [currentPrices, setCurrentPrices] = useState({});
    const currentPricesRef = useRef({});
    const [portfolioHistory, _setPortfolioHistory] = useState([]);
    const [newsHeadlines, setNewsHeadlines] = useState([]);
    const [priceAlerts, setPriceAlerts] = useState([]);
    const [entryHistory, setEntryHistory] = useState([]);
    const [testnetOrders, setTestnetOrders] = useState([]);
    const [testnetTrades, setTestnetTrades] = useState([]);
    const [ordersError, setOrdersError] = useState(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState({});
    const [settings, setSettings] = useState(INITIAL_RISK_SETTINGS);
    const [systemState, setSystemState] = useState({
        bybitStatus: "Connecting...",
        latency: 0,
        lastError: null,
        recentErrors: [],
    });
    const activePositionsRef = useRef([]);
    const [portfolioState, setPortfolioState] = useState({
        totalCapital: INITIAL_CAPITAL,
        allocatedCapital: 0,
        maxAllocatedCapital: INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxAllocatedCapitalPercent,
        dailyPnl: 0,
        maxDailyLoss: INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxDailyLossPercent,
        maxDailyProfit: INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxDailyProfitPercent,
        peakCapital: INITIAL_CAPITAL,
        currentDrawdown: 0,
        maxDrawdown: INITIAL_RISK_SETTINGS.maxDrawdownPercent,
        openPositions: 0,
        maxOpenPositions: INITIAL_RISK_SETTINGS.maxOpenPositions,
    });
    const lastEntryAtRef = useRef(null);
    const entryQueueRef = useRef(Promise.resolve());
    // Dynamicky uprav capital/max allocation pro testovací režim
    useEffect(() => {
        const isTest = settings.entryStrictness === "test";
        setPortfolioState((prev) => {
            const baseCapital = INITIAL_CAPITAL;
            const totalCapital = isTest ? prev.totalCapital || baseCapital : baseCapital;
            const pctCap = totalCapital * settings.maxAllocatedCapitalPercent;
            const maxAlloc = isTest ? Math.min(1000000, pctCap) : pctCap;
            return {
                ...prev,
                totalCapital,
                maxAllocatedCapital: maxAlloc,
                allocatedCapital: Math.min(prev.allocatedCapital, maxAlloc),
                maxDailyLoss: totalCapital * settings.maxDailyLossPercent,
                maxDailyProfit: totalCapital * settings.maxDailyProfitPercent,
                maxDrawdown: settings.maxDrawdownPercent,
                maxOpenPositions: settings.maxOpenPositions,
            };
        });
    }, [
        settings.entryStrictness,
        settings.maxAllocatedCapitalPercent,
        settings.maxDailyLossPercent,
        settings.maxDailyProfitPercent,
        settings.maxDrawdownPercent,
        settings.maxOpenPositions,
    ]);
    // Přepočet denního PnL podle otevřených pozic (unrealized)
    useEffect(() => {
        const unrealized = activePositions.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
        setPortfolioState((prev) => ({
            ...prev,
            dailyPnl: realizedPnlRef.current + unrealized,
        }));
    }, [activePositions]);
    useEffect(() => {
        setPortfolioState((prev) => {
            const equity = prev.totalCapital + prev.dailyPnl;
            const peakCapital = Math.max(prev.peakCapital, equity);
            const currentDrawdown = peakCapital > 0 ? (peakCapital - equity) / peakCapital : 0;
            if (peakCapital === prev.peakCapital &&
                currentDrawdown === prev.currentDrawdown) {
                return prev;
            }
            return { ...prev, peakCapital, currentDrawdown };
        });
    }, [portfolioState.dailyPnl, portfolioState.totalCapital]);
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
        // Pokud není definován explicitní backend, nezkoušej fetchovat – předejdeme 404 na statickém hostu
        const baseProvided = Boolean(envBase);
        const sameOrigin = typeof window !== "undefined" &&
            inferredBase === window.location.origin;
        if (!baseProvided && sameOrigin) {
            setTestnetOrders([]);
            setOrdersError("Orders API unavailable: configure VITE_API_BASE to point to backend");
            return;
        }
        try {
            setOrdersError(null);
            const res = await fetch(`${apiBase}/api/demo/orders?net=${useTestnet ? "testnet" : "mainnet"}`, {
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
            const mapped = Array.isArray(list)
                ? list.map((o) => {
                    const toIso = (ts) => {
                        const n = Number(ts);
                        return Number.isFinite(n) && n > 0
                            ? new Date(n).toISOString()
                            : new Date().toISOString();
                    };
                    return {
                        orderId: o.orderId || o.orderLinkId || o.id || `${Date.now()}`,
                        symbol: o.symbol || "",
                        side: o.side || "Buy",
                        qty: Number(o.qty ?? o.cumExecQty ?? 0),
                        price: o.price != null ? Number(o.price) : o.avgPrice != null ? Number(o.avgPrice) : null,
                        status: o.orderStatus || o.status || "unknown",
                        createdTime: toIso(o.createdTime ?? o.created_at ?? Date.now()),
                    };
                })
                : [];
            setTestnetOrders(mapped);
        }
        catch (err) {
            setOrdersError(err?.message || "Failed to load orders");
        }
    }, [authToken, useTestnet, apiBase]);
    // Testnet pozice přímo z Bybitu – přepíší simulované activePositions
    useEffect(() => {
        if (!authToken)
            return;
        let cancel = false;
        const fetchPositions = async () => {
            try {
                const res = await fetch(`${apiBase}/api/demo/positions?net=${useTestnet ? "testnet" : "mainnet"}`, {
                    headers: { Authorization: `Bearer ${authToken}` },
                });
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`Positions API failed (${res.status}): ${txt || "unknown"}`);
                }
                const data = await res.json();
                const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
                const mapped = Array.isArray(list)
                    ? list.map((p, idx) => {
                        const avgPrice = Number(p.avgPrice ?? p.entryPrice ?? p.lastPrice ?? 0);
                        const size = Math.abs(Number(p.size ?? 0));
                        const pnl = Number(p.unrealisedPnl ?? 0);
                        return {
                            id: p.symbol ? `${p.symbol}-${p.positionIdx ?? idx}` : `pos-${idx}`,
                            symbol: p.symbol || "UNKNOWN",
                            side: (p.side === "Buy" ? "buy" : "sell"),
                            entryPrice: avgPrice,
                            sl: p.stopLoss != null ? Number(p.stopLoss) : p.side === "Buy" ? avgPrice * 0.99 : avgPrice * 1.01,
                            tp: p.takeProfit != null ? Number(p.takeProfit) : avgPrice,
                            size,
                            openedAt: new Date(Number(p.updatedTime ?? p.createdTime ?? Date.now())).toISOString(),
                            unrealizedPnl: pnl,
                            pnl,
                            pnlValue: pnl,
                            rrr: 0,
                            peakPrice: Number(p.markPrice ?? p.lastPrice ?? avgPrice),
                            currentTrailingStop: undefined,
                            volatilityFactor: undefined,
                            lastUpdateReason: undefined,
                            timestamp: new Date().toISOString(),
                        };
                    })
                    : [];
                if (cancel)
                    return;
                setActivePositions(() => {
                    activePositionsRef.current = mapped;
                    return mapped;
                });
                setPortfolioState((p) => ({
                    ...p,
                    openPositions: mapped.length,
                    allocatedCapital: mapped.reduce((sum, pos) => sum + pos.entryPrice * pos.size, 0),
                }));
                setSystemState((prev) => ({
                    ...prev,
                    bybitStatus: "Connected",
                    lastError: null,
                }));
                addLog({
                    action: "SYSTEM",
                    message: `Synced ${mapped.length} ${useTestnet ? "testnet" : "mainnet"} positions`,
                });
            }
            catch (err) {
                if (cancel)
                    return;
                addLog({
                    action: "ERROR",
                    message: `Positions sync failed: ${err?.message || "unknown"}`,
                });
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Error",
                    lastError: err?.message || "Failed to load positions",
                }));
            }
        };
        void fetchPositions();
        const id = setInterval(fetchPositions, 10000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, useTestnet, apiBase, envBase, inferredBase]);
    const fetchTestnetTrades = useCallback(async () => {
        if (!authToken) {
            setTestnetTrades([]);
            return;
        }
        try {
            const res = await fetch(`${apiBase}/api/demo/trades?net=${useTestnet ? "testnet" : "mainnet"}`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Trades API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
            const mapped = Array.isArray(list)
                ? list.map((t) => {
                    const ts = Number(t.execTime ?? t.transactTime ?? t.createdTime ?? Date.now());
                    return {
                        id: t.execId || t.tradeId || `${Date.now()}`,
                        symbol: t.symbol || "",
                        side: t.side || "Buy",
                        price: Number(t.execPrice ?? t.price ?? 0),
                        qty: Number(t.execQty ?? t.qty ?? 0),
                        value: Number(t.execValue ?? t.value ?? 0),
                        fee: Number(t.execFee ?? t.fee ?? 0),
                        time: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
                    };
                })
                : [];
            setTestnetTrades(mapped);
        }
        catch (err) {
            setOrdersError((prev) => prev || err?.message || "Failed to load trades");
        }
    }, [authToken, useTestnet, apiBase, envBase, inferredBase]);
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
        status: "Idle",
    });
    const priceHistoryRef = useRef({});
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const realizedPnlRef = useRef(0);
    const lastTestSignalAtRef = useRef(null);
    const lastKeepaliveAtRef = useRef(null);
    const coachStakeRef = useRef({});
    const winStreakRef = useRef(0);
    const lossStreakRef = useRef(0);
    const rollingOutcomesRef = useRef([]);
    const registerOutcome = (pnl) => {
        const win = pnl > 0;
        if (win) {
            winStreakRef.current += 1;
            lossStreakRef.current = 0;
        }
        else {
            lossStreakRef.current += 1;
            winStreakRef.current = 0;
        }
        rollingOutcomesRef.current = [...rollingOutcomesRef.current.slice(-9), win];
    };
    const computeScalpDynamicRisk = (settings) => {
        const base = resolveRiskPct(settings);
        const rolling = rollingOutcomesRef.current;
        const wins = rolling.filter(Boolean).length;
        const rate = rolling.length ? wins / rolling.length : 0;
        let risk = base;
        const hot = winStreakRef.current >= 4 ||
            (rolling.length >= 5 && rate >= 0.65);
        const cold = lossStreakRef.current >= 3;
        if (hot) {
            risk = Math.min(Math.max(base, base * 1.8), 0.02);
        }
        if (cold) {
            risk = Math.max(base * 0.5, 0.005);
        }
        return risk;
    };
    const getEffectiveRiskPct = (settings) => settings.strategyProfile === "scalp"
        ? computeScalpDynamicRisk(settings)
        : resolveRiskPct(settings);
    // ========== LOG ==========
    const addLog = (entry) => {
        const log = {
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
            if (!withinSession(settingsRef.current, now))
                return;
            try {
                const URL_KLINE = `${httpBase}/v5/market/kline?category=linear`;
                const newPrices = {};
                const newHistory = { ...priceHistoryRef.current };
                const engineActive = [];
                for (const symbol of SYMBOLS) {
                    const url = `${URL_KLINE}&symbol=${symbol}&interval=1&limit=200`;
                    const r = await fetch(url);
                    const j = await r.json();
                    if (j.retCode !== 0)
                        throw new Error(j.retMsg);
                    const candles = parseKlines(j.result?.list ?? []);
                    if (!candles.length)
                        continue;
                    newHistory[symbol] = candles;
                    newPrices[symbol] = candles[candles.length - 1].close;
                    if (mode !== TradingMode.BACKTEST) {
                        const profile = chooseStrategyProfile(candles, settingsRef.current.strategyProfile);
                        if (!profile)
                            continue;
                        const resolvedRiskPct = Math.min(getEffectiveRiskPct(settingsRef.current) *
                            (settingsRef.current.positionSizingMultiplier || 1), 0.07);
                        const decision = evaluateStrategyForSymbol(symbol, candles, {
                            strategyProfile: profile,
                            entryStrictness: settingsRef.current.entryStrictness,
                            riskPerTrade: resolvedRiskPct,
                            accountBalance: portfolioState.totalCapital,
                            maxDailyLossPercent: settingsRef.current.maxDailyLossPercent,
                            maxDrawdownPercent: settingsRef.current.maxDrawdownPercent,
                            maxDailyProfitPercent: settingsRef.current.maxDailyProfitPercent,
                            maxOpenPositions: settingsRef.current.maxOpenPositions,
                            maxPortfolioRiskPercent: settingsRef.current.maxPortfolioRiskPercent,
                            enforceSessionHours: settingsRef.current.enforceSessionHours,
                            tradingHours: {
                                start: settingsRef.current.tradingStartHour,
                                end: settingsRef.current.tradingEndHour,
                                days: settingsRef.current.tradingDays,
                            },
                        });
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
                            const currentPrice = candles[candles.length - 1].close;
                            const pnl = (currentPrice - pos.entryPrice) *
                                dir *
                                pos.size;
                            const hist = newHistory[symbol] || [];
                            const atr = computeAtrFromHistory(hist, 20) ||
                                pos.entryPrice * 0.005;
                            const safeSl = pos.stopLoss ||
                                (pos.side === "long"
                                    ? pos.entryPrice - 1.5 * atr
                                    : pos.entryPrice + 1.5 * atr);
                            const tpCandidate = Number.isFinite(pos.takeProfit)
                                ? pos.takeProfit
                                : pos.initialTakeProfit;
                            const safeTp = tpCandidate && Number.isFinite(tpCandidate)
                                ? tpCandidate
                                : pos.side === "long"
                                    ? pos.entryPrice +
                                        1.2 * (pos.entryPrice - safeSl)
                                    : pos.entryPrice -
                                        1.2 * (safeSl - pos.entryPrice);
                            const mapped = {
                                id: `${symbol}-${pos.opened}`,
                                symbol,
                                side: pos.side === "long" ? "buy" : "sell",
                                entryPrice: pos.entryPrice,
                                sl: safeSl,
                                tp: safeTp,
                                size: pos.size,
                                openedAt: new Date(pos.opened).toISOString(),
                                unrealizedPnl: pnl,
                                pnl,
                                pnlValue: pnl,
                                rrr: Math.abs((Number.isFinite(pos.takeProfit)
                                    ? pos.takeProfit
                                    : pos.initialTakeProfit) -
                                    pos.entryPrice) /
                                    Math.abs(pos.entryPrice - pos.stopLoss ||
                                        1e-8) || 0,
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
                if (cancel)
                    return;
                priceHistoryRef.current = newHistory;
                setCurrentPrices(newPrices);
                currentPricesRef.current = newPrices;
                // Simulované pozice aktualizujeme jen pokud NEMÁME auth token (tj. není přímá vazba na burzu).
                if (!authToken) {
                    const prevActive = activePositionsRef.current;
                    const closed = prevActive.filter((p) => !engineActive.some((e) => e.id === p.id));
                    let freedNotional = 0;
                    if (closed.length) {
                        closed.forEach((p) => {
                            const exitPrice = newPrices[p.symbol] ??
                                currentPrices[p.symbol] ??
                                p.entryPrice;
                            const dir = p.side === "buy" ? 1 : -1;
                            const pnl = (exitPrice - p.entryPrice) * dir * p.size;
                            realizedPnlRef.current += pnl;
                            const limits = QTY_LIMITS[p.symbol];
                            if (settingsRef.current.strategyProfile === "coach" && limits) {
                                const nextStake = Math.max(limits.min * p.entryPrice, Math.min(limits.max * p.entryPrice, p.entryPrice * p.size + pnl));
                                coachStakeRef.current[p.symbol] = nextStake;
                            }
                            const record = {
                                symbol: p.symbol,
                                pnl,
                                timestamp: new Date().toISOString(),
                                note: `Auto-close @ ${exitPrice.toFixed(4)} | size ${p.size.toFixed(4)}`,
                            };
                            setAssetPnlHistory(() => addPnlRecord(record));
                            setEntryHistory(() => addEntryToHistory({
                                id: `${p.id}-auto-closed`,
                                symbol: p.symbol,
                                side: p.side,
                                entryPrice: p.entryPrice,
                                sl: p.sl,
                                tp: p.tp,
                                size: p.size,
                                createdAt: new Date().toISOString(),
                                settingsNote: `Auto-closed @ ${exitPrice.toFixed(4)} | PnL ${pnl.toFixed(2)} USDT`,
                                settingsSnapshot: snapshotSettings(settingsRef.current),
                            }));
                            freedNotional += p.entryPrice * p.size;
                            addLog({
                                action: "AUTO_CLOSE",
                                message: `${p.symbol} auto-closed @ ${exitPrice.toFixed(4)} | PnL ${pnl.toFixed(2)} USDT`,
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
                        allocatedCapital: Math.max(0, p.allocatedCapital - freedNotional),
                    }));
                }
                const latency = Math.round(performance.now() - started);
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Connected",
                    latency,
                    lastError: null,
                }));
                // === TEST MODE: GENERUJ RYCHLÉ SIGNÁLY PRO VŠECHNY ASSETY, KTERÉ NEJSOU OTEVŘENÉ ===
                if (settingsRef.current.entryStrictness === "test") {
                    const now = Date.now();
                    if (lastTestSignalAtRef.current &&
                        now - lastTestSignalAtRef.current < 4000) {
                        // Throttle generování test signálů
                    }
                    else {
                        lastTestSignalAtRef.current = now;
                        const activeSymbols = new Set(activePositionsRef.current.map((p) => p.symbol));
                        const pendingSymbols = new Set(pendingSignalsRef.current.map((p) => p.symbol));
                        const nowIso = new Date().toISOString();
                        const newTestSignals = [];
                        for (const symbol of SYMBOLS) {
                            if (activeSymbols.has(symbol))
                                continue;
                            if (pendingSymbols.has(symbol))
                                continue;
                            if (pendingSignalsRef.current.length + newTestSignals.length >=
                                MAX_TEST_PENDING)
                                break;
                            const price = newPrices[symbol];
                            if (!price)
                                continue;
                            const side = Math.random() > 0.5 ? "buy" : "sell";
                            const offsetPct = 0.003 + Math.random() * 0.01; // 0.3% – 1.3%
                            const sl = side === "buy"
                                ? price * (1 - offsetPct)
                                : price * (1 + offsetPct);
                            const tp = side === "buy"
                                ? price * (1 + offsetPct)
                                : price * (1 - offsetPct);
                            newTestSignals.push({
                                id: `${symbol}-${Date.now()}-${Math.random()
                                    .toString(16)
                                    .slice(2)}`,
                                symbol,
                                intent: { side, entry: price, sl, tp },
                                risk: 0.7,
                                message: `TEST signal ${side.toUpperCase()} ${symbol} @ ${price.toFixed(4)}`,
                                createdAt: nowIso,
                            });
                        }
                        if (newTestSignals.length) {
                            setPendingSignals((prev) => [
                                ...newTestSignals,
                                ...prev,
                            ]);
                            newTestSignals.forEach((s) => addLog({
                                action: "SIGNAL",
                                message: s.message,
                            }));
                        }
                    }
                }
                // Keepalive signály pro ostatní profily: pokud není žádný pending/aktivní delší dobu, vytvoř fallback
                if (settingsRef.current.entryStrictness !== "test" &&
                    pendingSignalsRef.current.length === 0 &&
                    activePositionsRef.current.length === 0 &&
                    !(authToken && !useTestnet) // na mainnetu s přihlášeným účtem keepalive nevytvářej
                ) {
                    const now = Date.now();
                    if (!lastKeepaliveAtRef.current ||
                        now - lastKeepaliveAtRef.current > KEEPALIVE_SIGNAL_INTERVAL_MS) {
                        lastKeepaliveAtRef.current = now;
                        const keepSignals = [];
                        const nowIso = new Date().toISOString();
                        for (const symbol of SYMBOLS) {
                            if (keepSignals.length >= MAX_TEST_PENDING)
                                break;
                            const price = newPrices[symbol];
                            if (!price)
                                continue;
                            const hist = priceHistoryRef.current[symbol] || [];
                            const atr = computeAtrFromHistory(hist, 20) || price * 0.005;
                            const side = Math.random() > 0.5 ? "buy" : "sell";
                            const sl = side === "buy" ? price - 1.5 * atr : price + 1.5 * atr;
                            const tp = side === "buy" ? price + 2.5 * atr : price - 2.5 * atr;
                            keepSignals.push({
                                id: `${symbol}-keep-${Date.now()}-${Math.random()
                                    .toString(16)
                                    .slice(2)}`,
                                symbol,
                                intent: { side, entry: price, sl, tp },
                                risk: 0.6,
                                message: `Keepalive ${side.toUpperCase()} ${symbol} @ ${price.toFixed(4)}`,
                                createdAt: nowIso,
                            });
                        }
                        if (keepSignals.length) {
                            setPendingSignals((prev) => [...keepSignals, ...prev]);
                            keepSignals.forEach((s) => addLog({ action: "SIGNAL", message: s.message }));
                        }
                    }
                }
            }
            catch (err) {
                if (cancel)
                    return;
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
    const performTrade = async (signalId) => {
        const signal = pendingSignalsRef.current.find((s) => s.id === signalId);
        if (!signal)
            return false;
        // Risk-engine: guardrails for capital allocation, portfolio risk, and halts
        const maxAlloc = portfolioState.maxAllocatedCapital;
        const currentAlloc = portfolioState.allocatedCapital;
        const baseRiskPct = getEffectiveRiskPct(settings);
        const riskPctWithMult = Math.min(baseRiskPct * (settings.positionSizingMultiplier || 1), 0.07);
        if (settings.haltOnDailyLoss &&
            portfolioState.dailyPnl <= -portfolioState.maxDailyLoss) {
            addLog({
                action: "RISK_HALT",
                message: `Trading halted: daily loss limit hit (${(portfolioState.maxDailyLoss * 100 /
                    Math.max(1, portfolioState.totalCapital)).toFixed(2)}%).`,
            });
            return false;
        }
        if (settings.haltOnDrawdown &&
            portfolioState.currentDrawdown >= portfolioState.maxDrawdown) {
            addLog({
                action: "RISK_HALT",
                message: `Trading halted: drawdown cap reached (${(portfolioState.maxDrawdown * 100).toFixed(1)}%).`,
            });
            return false;
        }
        if (portfolioState.openPositions >= settings.maxOpenPositions) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: max open positions (${settings.maxOpenPositions}) reached.`,
            });
            return false;
        }
        const availableAllocation = Math.max(0, maxAlloc - currentAlloc);
        const intent = signal.intent;
        const side = intent.side;
        const entry = intent.entry;
        // Dynamické SL/TP/TS dle ATR
        const history = priceHistoryRef.current[signal.symbol] || [];
        const atr = computeAtrFromHistory(history, 20) || entry * 0.005;
        let sl = intent.sl;
        let tp = intent.tp;
        if (!sl) {
            sl = side === "buy" ? entry - 1.5 * atr : entry + 1.5 * atr;
        }
        if (!tp) {
            tp = side === "buy" ? entry + 2.5 * atr : entry - 2.5 * atr;
        }
        const riskPerTrade = portfolioState.totalCapital *
            riskPctWithMult;
        const riskPerUnit = Math.abs(entry - sl);
        if (riskPerUnit <= 0)
            return false;
        const limits = QTY_LIMITS[signal.symbol];
        let size;
        let notional;
        if (settings.strategyProfile === "coach") {
            const prevStake = coachStakeRef.current[signal.symbol] ??
                (limits ? limits.min * entry : riskPerTrade);
            const targetQty = prevStake / entry;
            size = limits ? clampQtyForSymbol(signal.symbol, targetQty) : targetQty;
            notional = size * entry;
        }
        else {
            size = riskPerTrade / riskPerUnit;
            notional = size * entry;
            if (notional > MAX_SINGLE_POSITION_VALUE) {
                const factor = MAX_SINGLE_POSITION_VALUE / notional;
                size *= factor;
                notional = MAX_SINGLE_POSITION_VALUE;
            }
            size = limits ? clampQtyForSymbol(signal.symbol, size) : size;
            notional = size * entry;
        }
        const newRiskAmount = riskPerUnit * size;
        if (notional <= 0) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: zero size after allocation cap.`,
            });
            return false;
        }
        const openRiskAmount = activePositionsRef.current.reduce((sum, p) => sum + computePositionRisk(p), 0);
        const riskBudget = portfolioState.totalCapital *
            settings.maxPortfolioRiskPercent;
        // scale size down to fit remaining risk budget
        const remainingRiskBudget = Math.max(0, riskBudget - openRiskAmount);
        const maxSizeByRisk = riskPerUnit > 0 ? remainingRiskBudget / riskPerUnit : size;
        if (maxSizeByRisk <= 0) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: portfolio risk cap (${(settings.maxPortfolioRiskPercent * 100).toFixed(1)}%) reached.`,
            });
            return false;
        }
        if (size > maxSizeByRisk) {
            size = maxSizeByRisk;
            size = limits ? clampQtyForSymbol(signal.symbol, size) : size;
            notional = size * entry;
        }
        // cap by remaining capital allocation after risk scaling
        const remainingAllocation = Math.max(0, maxAlloc - currentAlloc);
        if (notional > remainingAllocation && remainingAllocation > 0) {
            const scaledSize = remainingAllocation / entry;
            const maxOnlyClamp = limits ? Math.min(limits.max, Math.max(0, scaledSize)) : Math.max(0, scaledSize);
            size = maxOnlyClamp;
            notional = size * entry;
        }
        if (size <= 0 || notional <= 0) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: zero size after caps.`,
            });
            return false;
        }
        if (openRiskAmount + newRiskAmount > riskBudget) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: portfolio risk cap (${(settings.maxPortfolioRiskPercent * 100).toFixed(1)}%) would be exceeded.`,
            });
            return false;
        }
        if (portfolioState.allocatedCapital + notional >
            portfolioState.maxAllocatedCapital) {
            const headroom = Math.max(0, portfolioState.maxAllocatedCapital - portfolioState.allocatedCapital);
            const scaledSize = headroom / entry;
            const maxOnlyClamp = limits ? Math.min(limits.max, Math.max(0, scaledSize)) : Math.max(0, scaledSize);
            size = maxOnlyClamp;
            notional = size * entry;
            if (size <= 0 || notional <= 0 || portfolioState.allocatedCapital + notional > portfolioState.maxAllocatedCapital) {
                addLog({
                    action: "RISK_BLOCK",
                    message: `Signal on ${signal.symbol} exceeds capital allocation limit.`,
                });
                return false;
            }
        }
        // ===== DYNAMICKÝ TRAILING STOP (odvozený z 1R) =====
        const oneR = Math.abs(entry - sl); // velikost SL
        const trailingDistance = oneR * 0.5; // 0.5R
        let trailingActivationPrice = null;
        if (side === "buy") {
            trailingActivationPrice = entry + oneR; // aktivace při +1R
        }
        else {
            trailingActivationPrice = entry - oneR;
        }
        // callbackRate v %
        const trailingStopPct = (trailingDistance / entry) * 100;
        const trailingStopDistance = trailingDistance;
        const position = {
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
            message: `Opened ${side.toUpperCase()} ${signal.symbol} at ${entry.toFixed(4)} (size ≈ ${size.toFixed(4)}, notional ≈ ${notional.toFixed(2)} USDT, TS≈${trailingStopPct.toFixed(2)}% from 1R)`,
        });
        const settingsSnapshot = snapshotSettings(settingsRef.current);
        // === VOLÁNÍ BACKENDU – POSÍLÁME SL/TP + DYNAMICKÝ TRAILING ===
        try {
            if (!authToken) {
                addLog({
                    action: "ERROR",
                    message: "Missing auth token for placing order. Please re-login.",
                });
                return true;
            }
            const res = await fetch(`${apiBase}/api/demo/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
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
                    price: side === "buy"
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
        }
        catch (err) {
            addLog({
                action: "ERROR",
                message: `Demo API order failed: ${err?.message || "unknown"}`,
            });
        }
        return true;
    };
    function executeTrade(signalId) {
        entryQueueRef.current = entryQueueRef.current
            .catch(() => {
            // swallow to keep queue alive
        })
            .then(async () => {
            const last = lastEntryAtRef.current;
            const sinceLast = last ? Date.now() - last : Infinity;
            const waitMs = sinceLast < MIN_ENTRY_SPACING_MS
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
        if (modeRef.current !== TradingMode.AUTO_ON)
            return;
        if (!pendingSignals.length)
            return;
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
    const addPriceAlert = (symbol, price) => {
        const alert = {
            id: `a-${Date.now()}`,
            symbol,
            price,
            createdAt: new Date().toISOString(),
            triggered: false,
        };
        setPriceAlerts((p) => [...p, alert]);
    };
    const removePriceAlert = (id) => {
        setPriceAlerts((p) => p.filter((a) => a.id !== id));
    };
    const closePosition = (id) => {
        setActivePositions((prev) => {
            const target = prev.find((p) => p.id === id);
            if (!target)
                return prev;
            const currentPrice = currentPrices[target.symbol] ?? target.entryPrice;
            const dir = target.side === "buy" ? 1 : -1;
            const pnl = (currentPrice - target.entryPrice) * dir * target.size;
            const freedNotional = target.entryPrice * target.size;
            realizedPnlRef.current += pnl;
            registerOutcome(pnl);
            const limits = QTY_LIMITS[target.symbol];
            if (settingsRef.current.strategyProfile === "coach" && limits) {
                const nextStake = Math.max(limits.min * target.entryPrice, Math.min(limits.max * target.entryPrice, freedNotional + pnl));
                coachStakeRef.current[target.symbol] = nextStake;
            }
            const record = {
                symbol: target.symbol,
                pnl,
                timestamp: new Date().toISOString(),
                note: `Closed at ${currentPrice.toFixed(4)} | size ${target.size.toFixed(4)}`,
            };
            setAssetPnlHistory(() => addPnlRecord(record));
            setEntryHistory(() => addEntryToHistory({
                id: `${target.id}-closed`,
                symbol: target.symbol,
                side: target.side,
                entryPrice: target.entryPrice,
                sl: target.sl,
                tp: target.tp,
                size: target.size,
                createdAt: new Date().toISOString(),
                settingsNote: `Closed at ${currentPrice.toFixed(4)} | PnL ${pnl.toFixed(2)} USDT`,
                settingsSnapshot: snapshotSettings(settingsRef.current),
            }));
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
    const updateSettings = (newS) => {
        const incomingMode = newS.riskMode ?? settingsRef.current.riskMode;
        const basePreset = incomingMode !== settingsRef.current.riskMode
            ? presetFor(incomingMode)
            : settingsRef.current;
        let patched = { ...basePreset, ...newS, riskMode: incomingMode };
        if (incomingMode !== settingsRef.current.riskMode) {
            const presetKeys = [
                "baseRiskPerTrade",
                "maxAllocatedCapitalPercent",
                "maxPortfolioRiskPercent",
                "maxDailyLossPercent",
                "maxDailyProfitPercent",
                "maxDrawdownPercent",
                "positionSizingMultiplier",
                "entryStrictness",
                "strategyProfile",
                "enforceSessionHours",
                "haltOnDailyLoss",
                "haltOnDrawdown",
                "maxOpenPositions",
            ];
            presetKeys.forEach((k) => {
                patched = { ...patched, [k]: basePreset[k] };
            });
        }
        if (patched.strategyProfile === "coach") {
            const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
            patched = {
                ...patched,
                baseRiskPerTrade: clamp(patched.baseRiskPerTrade || 0.02, 0.01, 0.03),
                maxDailyLossPercent: Math.min(patched.maxDailyLossPercent || 0.05, 0.05),
                positionSizingMultiplier: clamp(patched.positionSizingMultiplier || 1, 0.5, 1),
                maxAllocatedCapitalPercent: clamp(patched.maxAllocatedCapitalPercent || 1, 0.25, 1),
                maxPortfolioRiskPercent: clamp(patched.maxPortfolioRiskPercent || 0.08, 0.05, 0.1),
                maxOpenPositions: 2,
            };
            if (patched.entryStrictness === "ultra") {
                patched = { ...patched, entryStrictness: "base" };
            }
        }
        if (patched.strategyProfile === "scalp") {
            patched = {
                ...patched,
                baseRiskPerTrade: Math.max(0.01, Math.min(patched.baseRiskPerTrade, 0.02)),
                maxOpenPositions: 1,
                maxDailyLossPercent: Math.max(Math.min(patched.maxDailyLossPercent, 0.12), 0.08),
                maxDrawdownPercent: Math.max(patched.maxDrawdownPercent, 0.3),
                maxPortfolioRiskPercent: Math.max(Math.min(patched.maxPortfolioRiskPercent, 0.12), 0.08),
                enforceSessionHours: false,
                entryStrictness: patched.entryStrictness === "test" ? "ultra" : patched.entryStrictness,
            };
        }
        setSettings(patched);
        settingsRef.current = patched;
        setPortfolioState((p) => {
            const maxAlloc = p.totalCapital * patched.maxAllocatedCapitalPercent;
            return {
                ...p,
                maxOpenPositions: patched.maxOpenPositions,
                maxAllocatedCapital: maxAlloc,
                allocatedCapital: Math.min(p.allocatedCapital, maxAlloc),
                maxDailyLoss: p.totalCapital * patched.maxDailyLossPercent,
                maxDailyProfit: p.totalCapital * patched.maxDailyProfitPercent,
                maxDrawdown: patched.maxDrawdownPercent,
            };
        });
    };
    const removeEntryHistoryItem = (id) => {
        setEntryHistory(() => removeEntryFromHistory(id));
    };
    const rejectSignal = (id) => {
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
