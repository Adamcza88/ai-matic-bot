// hooks/useTradingBot.ts
import { useState, useEffect, useRef, useCallback } from "react";
import { TradingMode, } from "../types";
import { getApiBase, useNetworkConfig } from "../engine/networkConfig";
import { addEntryToHistory, loadEntryHistory, removeEntryFromHistory, persistEntryHistory } from "../lib/entryHistory";
import { addPnlRecord, loadPnlHistory, clearPnlHistory } from "../lib/pnlHistory";
// SYMBOLS
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];
// SIMULOVANÝ / DEFAULT KAPITÁL
const INITIAL_CAPITAL = 100; // Unified Trading balance snapshot
const MAX_SINGLE_POSITION_VALUE = Number.POSITIVE_INFINITY; // notional cap disabled (use margin caps instead)
const MIN_ENTRY_SPACING_MS = 3000;
const MAX_TEST_PENDING = 4;
const KEEPALIVE_SIGNAL_INTERVAL_MS = 12000;
const LEVERAGE = {
    BTCUSDT: 100,
    ETHUSDT: 100,
    SOLUSDT: 100,
    ADAUSDT: 75,
};
const MIN_MARGIN_USD = 5;
const MAX_MARGIN_USD = 10;
const TARGET_NOTIONAL = {
    BTCUSDT: 500, // odpovídá ~5 USDT margin při 100x
    ETHUSDT: 500,
    SOLUSDT: 500,
    ADAUSDT: 350, // odpovídá screenshotu při 75x
};
const QTY_LIMITS = {
    BTCUSDT: { min: 0.005, max: 0.005 },
    ETHUSDT: { min: 0.15, max: 0.15 },
    SOLUSDT: { min: 3.5, max: 3.5 },
    ADAUSDT: { min: 858, max: 858 },
};
const ACCOUNT_BALANCE_USD = 100;
const RISK_PER_TRADE_USD = 4;
const MAX_TOTAL_RISK_USD = 8;
const MAX_ACTIVE_TRADES = 2;
const STOP_MIN_PCT = 0.0015; // 0.15 %
const MAX_LEVERAGE_ALLOWED = 100;
const MIN_NOTIONAL_USD = {
    BTCUSDT: 5,
    ETHUSDT: 5,
    SOLUSDT: 5,
    ADAUSDT: 5,
};
// RISK / STRATEGY
const AI_MATIC_PRESET = {
    riskMode: "ai-matic",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.07,
    maxDailyProfitPercent: 0.5,
    maxDrawdownPercent: 0.2,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
    strategyProfile: "auto",
    entryStrictness: "base",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
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
    useLiquiditySweeps: false,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.1,
    maxDailyProfitPercent: 1.0,
    maxDrawdownPercent: 0.2,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
    strategyProfile: "auto",
    entryStrictness: "ultra",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.2,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.1,
    minWinRate: 65,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
};
export const INITIAL_RISK_SETTINGS = AI_MATIC_PRESET;
const SETTINGS_STORAGE_KEY = "ai-matic-settings";
function loadStoredSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed)
            return null;
        return {
            ...INITIAL_RISK_SETTINGS,
            ...parsed,
            tradingDays: Array.isArray(parsed.tradingDays) ? parsed.tradingDays : INITIAL_RISK_SETTINGS.tradingDays,
            maxOpenPositions: Math.min(2, parsed.maxOpenPositions ?? INITIAL_RISK_SETTINGS.maxOpenPositions),
        };
    }
    catch {
        return null;
    }
}
function persistSettings(s) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
    }
    catch {
        // ignore storage errors
    }
}
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
const leverageFor = (symbol) => LEVERAGE[symbol] ?? 1;
const marginFor = (symbol, entry, size) => (entry * size) / Math.max(1, leverageFor(symbol));
const asNum = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min, max) => Math.floor(min + Math.random() * Math.max(0, max - min));
const TAKER_FEE = 0.0006; // orientační taker fee (0.06%)
const MIN_TP_BUFFER_PCT = 0.0003; // 0.03 % buffer
function feeRoundTrip(notional, openRate = TAKER_FEE, closeRate = TAKER_FEE) {
    return notional * (openRate + closeRate);
}
function ensureMinTpDistance(entry, sl, tp, size) {
    if (!Number.isFinite(entry) || !Number.isFinite(tp) || size <= 0)
        return tp;
    const notional = entry * size;
    const minDistance = feeRoundTrip(notional) / size + entry * MIN_TP_BUFFER_PCT;
    const dir = tp >= entry ? 1 : -1;
    const proposedDistance = Math.abs(tp - entry);
    if (proposedDistance >= minDistance)
        return tp;
    return entry + dir * minDistance;
}
function uuidLite() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `aim-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}
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
function computeAtrPair(candles) {
    const atrShort = computeAtrFromHistory(candles, 14);
    const atrLong = computeAtrFromHistory(candles, 50) || atrShort || 1;
    return { atrShort, atrLong };
}
function computeEma(candles, period) {
    if (!candles || candles.length === 0)
        return 0;
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
        ema = candles[i].close * k + ema * (1 - k);
    }
    return ema;
}
function scoreVol(atrPct) {
    // Prefer 0.2 % – 0.8 % intraday volatility, decay outside.
    const idealMin = 0.002;
    const idealMax = 0.008;
    if (atrPct <= 0)
        return 0;
    if (atrPct < idealMin)
        return atrPct / idealMin; // up to 1
    if (atrPct > idealMax)
        return Math.max(0, 1 - (atrPct - idealMax) / idealMax);
    return 1.2; // slight bonus inside sweet spot
}
// === Market Structure Helpers ===
function isSwingHigh(candles, idx, n = 2) {
    const hi = candles[idx]?.high ?? 0;
    if (!Number.isFinite(hi))
        return false;
    for (let i = 1; i <= n; i++) {
        if (!candles[idx - i] || !candles[idx + i])
            return false;
        if (candles[idx - i].high >= hi || candles[idx + i].high >= hi)
            return false;
    }
    return true;
}
function isSwingLow(candles, idx, n = 2) {
    const lo = candles[idx]?.low ?? 0;
    if (!Number.isFinite(lo))
        return false;
    for (let i = 1; i <= n; i++) {
        if (!candles[idx - i] || !candles[idx + i])
            return false;
        if (candles[idx - i].low <= lo || candles[idx + i].low <= lo)
            return false;
    }
    return true;
}
function findLastSwingBreak(candles, bias, n = 2) {
    for (let i = candles.length - (n + 2); i >= n; i--) {
        if (bias === "bullish" && isSwingHigh(candles, i, n)) {
            const level = candles[i].high;
            const afterClose = candles.slice(i + 1).find((c) => c.close > level);
            if (afterClose)
                return { level, idx: i };
        }
        if (bias === "bearish" && isSwingLow(candles, i, n)) {
            const level = candles[i].low;
            const afterClose = candles.slice(i + 1).find((c) => c.close < level);
            if (afterClose)
                return { level, idx: i };
        }
    }
    return null;
}
function netRrr(entry, sl, tp, feePct) {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp))
        return 0;
    const risk = Math.abs(entry - sl) + entry * feePct * 2;
    const reward = Math.abs(tp - entry) - entry * feePct * 2;
    if (risk <= 0)
        return 0;
    return reward / risk;
}
function buildZone(candles, bosIdx, direction) {
    for (let i = bosIdx - 1; i >= Math.max(0, bosIdx - 10); i--) {
        const c = candles[i];
        if (!c)
            continue;
        const isOpposite = direction === "buy" ? c.close < c.open : c.close > c.open;
        if (isOpposite) {
            const high = Math.max(c.open, c.close);
            const low = Math.min(c.open, c.close);
            return { zoneHigh: high, zoneLow: low };
        }
    }
    return null;
}
function evaluateMarketStructure(c4h, c1h, c15, c5, symbol) {
    const res = evaluateMarketStructureWithReason(c4h, c1h, c15, c5, symbol);
    return res.structure;
}
function evaluateMarketStructureWithReason(c4h, c1h, c15, c5, symbol) {
    const gates = [];
    const bias4h = (() => {
        const bosUp = findLastSwingBreak(c4h, "bullish");
        const bosDn = findLastSwingBreak(c4h, "bearish");
        if (bosUp && (!bosDn || bosUp.idx > bosDn.idx))
            return "bullish";
        if (bosDn && (!bosUp || bosDn.idx > bosUp.idx))
            return "bearish";
        return null;
    })();
    if (!bias4h)
        return { structure: null, reason: "HTF_BIAS" };
    gates.push("HTF_BIAS_OK");
    const bias1h = (() => {
        const bosUp = findLastSwingBreak(c1h, "bullish");
        const bosDn = findLastSwingBreak(c1h, "bearish");
        if (bosUp && (!bosDn || bosUp.idx > bosDn.idx))
            return "bullish";
        if (bosDn && (!bosUp || bosDn.idx > bosUp.idx))
            return "bearish";
        return null;
    })();
    if (bias1h !== bias4h)
        return { structure: null, reason: "HTF_CONFIRM" };
    gates.push("HTF_CONFIRM_OK");
    const choch15 = (() => {
        const bosUp = findLastSwingBreak(c15, "bullish");
        const bosDn = findLastSwingBreak(c15, "bearish");
        if (bias4h === "bullish" && bosUp)
            return "bullish";
        if (bias4h === "bearish" && bosDn)
            return "bearish";
        return null;
    })();
    if (!choch15)
        return { structure: null, reason: "LTF_CHOCH" };
    gates.push("LTF_CHOCH_OK");
    const bos5 = findLastSwingBreak(c5, bias4h);
    if (!bos5)
        return { structure: null, reason: "LTF_BOS" };
    gates.push("LTF_BOS_OK");
    const dir = bias4h === "bullish" ? "buy" : "sell";
    const zone = buildZone(c5, bos5.idx, dir);
    if (!zone)
        return { structure: null, reason: "ZONE" };
    gates.push("ZONE_DEFINED_OK");
    const lastClose = c5[c5.length - 1]?.close;
    if (!Number.isFinite(lastClose))
        return { structure: null, reason: "PRICE" };
    const inZone = lastClose >= Math.min(zone.zoneLow, zone.zoneHigh) &&
        lastClose <= Math.max(zone.zoneLow, zone.zoneHigh);
    if (!inZone)
        return { structure: null, reason: "RETEST" };
    gates.push("RETEST_OK");
    const entry = lastClose;
    const buffer = Math.max(entry * STOP_MIN_PCT, entry * 0.0005);
    const sl = dir === "buy" ? zone.zoneLow - buffer : zone.zoneHigh + buffer;
    const r = Math.abs(entry - sl);
    const tp1 = dir === "buy" ? entry + 1.5 * r : entry - 1.5 * r;
    const tp2 = dir === "buy" ? entry + 2 * r : entry - 2 * r;
    const netR = netRrr(entry, sl, tp1, TAKER_FEE);
    return {
        structure: {
            bias: bias4h,
            zoneHigh: zone.zoneHigh,
            zoneLow: zone.zoneLow,
            entry,
            sl,
            tp1,
            tp2,
            netRrr: netR,
            direction: dir,
            gates,
        },
        reason: netR >= 1.5 ? "OK" : "NET_RRR",
    };
}
function findRecentHigherLow(candles, lookback = 60) {
    if (!candles || candles.length < 5)
        return null;
    const start = Math.max(2, candles.length - lookback);
    for (let i = candles.length - 3; i >= start; i--) {
        if (isSwingLow(candles, i, 2))
            return candles[i].low;
    }
    return null;
}
function findRecentLowerHigh(candles, lookback = 60) {
    if (!candles || candles.length < 5)
        return null;
    const start = Math.max(2, candles.length - lookback);
    for (let i = candles.length - 3; i >= start; i--) {
        if (isSwingHigh(candles, i, 2))
            return candles[i].high;
    }
    return null;
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
const minNotionalFor = (symbol) => MIN_NOTIONAL_USD[symbol] ?? 5;
const openRiskUsd = (positions) => {
    return positions.reduce((sum, p) => {
        if (!Number.isFinite(p.entryPrice) || !Number.isFinite(p.sl))
            return MAX_TOTAL_RISK_USD;
        const size = p.size ?? p.qty ?? 0;
        if (!Number.isFinite(size) || size <= 0)
            return sum + MAX_TOTAL_RISK_USD;
        return sum + Math.abs(p.entryPrice - p.sl) * size;
    }, 0);
};
function computePositionSizing(symbol, entry, sl, useTestnet) {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0) {
        return { ok: false, reason: "Invalid entry/SL" };
    }
    const stopPct = Math.abs(entry - sl) / entry;
    if (stopPct < STOP_MIN_PCT) {
        return { ok: false, reason: "Stop too tight" };
    }
    const feePct = TAKER_FEE * 2; // konzervativně taker-in + taker-out
    const effRiskPct = stopPct + feePct;
    if (effRiskPct <= 0)
        return { ok: false, reason: "Effective risk invalid" };
    const positionNotional = RISK_PER_TRADE_USD / effRiskPct;
    const leverage = positionNotional / ACCOUNT_BALANCE_USD;
    if (leverage > MAX_LEVERAGE_ALLOWED) {
        return { ok: false, reason: `Leverage ${leverage.toFixed(2)} exceeds ${MAX_LEVERAGE_ALLOWED}` };
    }
    const minNotional = minNotionalFor(symbol);
    if (positionNotional < minNotional) {
        return { ok: false, reason: `Notional ${positionNotional.toFixed(2)} < min ${minNotional}` };
    }
    const rawQty = positionNotional / entry;
    const qty = clampQtyForSymbol(symbol, rawQty);
    if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, reason: "Qty invalid" };
    }
    const riskUsd = Math.abs(entry - sl) * qty;
    if (riskUsd > RISK_PER_TRADE_USD * 1.05) {
        return { ok: false, reason: `Risk ${riskUsd.toFixed(2)} exceeds per-trade cap` };
    }
    return { ok: true, qty, notional: qty * entry, leverage, stopPct, feePct, effRiskPct, riskUsd };
}
const netRrrWithFees = (entry, sl, tp, feePct) => {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp))
        return 0;
    const risk = Math.abs(entry - sl) + entry * feePct * 2;
    const reward = Math.abs(tp - entry) - entry * feePct * 2;
    if (risk <= 0)
        return 0;
    return reward / risk;
};
// ========== HLAVNÍ HOOK ==========
// Unified API Base URL helper
// Note: getApiBase and useNetworkConfig are already imported at top-level
// const { getApiBase } = useNetworkConfig(); // This hook usage was likely incorrect or redundant if getApiBase is a standalone utility or if we use the hook at component level.
// Actually, looking at imports:
// import { getApiBase, useNetworkConfig } from "../engine/networkConfig";
// We can just use getApiBase directly if it's a function, OR use the hook.
// Let's assume getApiBase is a helper function.
// FIX: Remove duplicate import if it exists as 'import ...' inside function? No, TS usually errors on top level duplicates. 
// The error says "Duplicate identifier", implying it's declared twice in the same scope or file module scope.
// Line 21 and 319. line 319 seems to contain `import ...`?
// Let's just remove the lines around 319 if they are imports.
// If they are destructurings: `const { ... } = ...`, and we already have them imported?
// Wait, `getApiBase` is imported at top level. If we declare `const getApiBase = ...` inside a function, it shadows. 
// But the error says "Duplicate identifier" at line 319. If it's a top-level import there, it's invalid JS/TS inside a function? Or is it another top-level import?
// Let's look at the file content from view_file.
// ... existing imports ...
// ========== HLAVNÍ HOOK ==========
export const useTradingBot = (mode, useTestnet, authToken) => {
    // FIX 1: Hard Frontend Routing via centralized config
    const apiPrefix = getApiBase(useTestnet);
    useEffect(() => {
    }, [useTestnet, apiPrefix]);
    const { httpBase } = useNetworkConfig(useTestnet);
    const envBase = import.meta.env?.VITE_API_BASE;
    const inferredBase = typeof window !== "undefined" ? window.location.origin : "";
    const apiBase = (envBase || inferredBase || "").replace(/\/$/, "");
    const [logEntries, setLogEntries] = useState([]);
    // Clear state on environment/auth change to prevent ghost positions
    useEffect(() => {
        setActivePositions([]);
        setPendingSignals([]);
        activePositionsRef.current = [];
        pendingSignalsRef.current = [];
    }, [authToken, useTestnet]);
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
    const [mainnetOrders, setMainnetOrders] = useState([]);
    const [mainnetTrades, setMainnetTrades] = useState([]);
    const [mainnetError, setMainnetError] = useState(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState({});
    const [settings, setSettings] = useState(() => {
        if (typeof window !== "undefined") {
            const stored = loadStoredSettings();
            if (stored)
                return stored;
        }
        return INITIAL_RISK_SETTINGS;
    });
    const [systemState, setSystemState] = useState({
        bybitStatus: "Connecting...",
        latency: 0,
        lastError: null,
        recentErrors: [],
    });
    const activePositionsRef = useRef([]);
    const closedPnlSeenRef = useRef(new Set());
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
    const executionLocksRef = useRef(new Set()); // Mutex for dedup
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
        const hist = loadEntryHistory();
        const trimmed = hist.slice(0, 8);
        if (hist.length !== trimmed.length) {
            persistEntryHistory(trimmed);
        }
        setEntryHistory(trimmed);
        setAssetPnlHistory(loadPnlHistory());
    }, []);
    // Keep only top-2 highest-risk pending signals to focus on nejpravděpodobnější obchody
    useEffect(() => {
        setPendingSignals((prev) => {
            if (prev.length <= 2)
                return prev;
            const sorted = [...prev].sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0));
            const trimmed = sorted.slice(0, 2);
            const same = trimmed.length === prev.length &&
                trimmed.every((s, i) => s.id === prev[i].id);
            return same ? prev : trimmed;
        });
    }, [pendingSignals]);
    useEffect(() => {
        pendingSignalsRef.current = pendingSignals;
    }, [pendingSignals]);
    useEffect(() => {
        activePositionsRef.current = activePositions;
    }, [activePositions]);
    // Generic fetchOrders that respects API prefix (unlike previous confusing split)
    const fetchOrders = useCallback(async () => {
        if (!authToken) {
            setTestnetOrders([]); // using same state variable for now, effectively "orders"
            if (useTestnet)
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
            // Dynamic URL based on apiPrefix (main or demo)
            const url = new URL(`${apiBase}${apiPrefix}/orders`);
            // Explicitly set 'net' param for logging/backend double-check
            url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            // console.log(`[fetchOrders] Fetching from: ${url.toString()}`);
            const res = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Orders API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            // FIX A2: Robust parsing for ApiResponse wrapping Bybit response
            const list = data?.data?.result?.list /* correct wrapper */ ||
                data?.data?.list /* flat data */ ||
                data?.list /* legacy root */ ||
                data?.result?.list /* legacy root bybit */ ||
                [];
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
            // For now, we store everything in "testnetOrders" state variable which is actually just "orders"
            setTestnetOrders(mapped);
        }
        catch (err) {
            console.error(`[fetchOrders] Error:`, err);
            setOrdersError(err?.message || "Failed to load orders");
        }
    }, [authToken, useTestnet, apiBase, apiPrefix, envBase, inferredBase]);
    // Pozice/PnL přímo z Bybitu – přepíší simulované activePositions
    // RECONCILE LOOP: Jednotný zdroj pravdy z backendu
    // RECONCILE LOOP: Jednotný zdroj pravdy z backendu
    useEffect(() => {
        if (!authToken)
            return;
        let cancel = false;
        const fetchReconcile = async () => {
            try {
                const url = new URL(`${apiBase}${apiPrefix}/reconcile`);
                url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
                const res = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                });
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`Reconcile API failed (${res.status}): ${txt}`);
                }
                const json = await res.json();
                if (cancel)
                    return;
                if (!json.ok || !json.data) {
                    // console.warn("Reconcile response not OK:", json);
                    return;
                }
                const { positions, orders, diffs, meta } = json.data;
                // 1. HARD SYNC POSITIONS
                const mappedPositions = Array.isArray(positions) ? positions : [];
                const prevPositions = activePositionsRef.current;
                const prevSymbols = new Set(prevPositions.map((p) => p.symbol));
                const newSymbols = new Set(mappedPositions.map((p) => p.symbol));
                mappedPositions.forEach((p) => {
                    if (!prevSymbols.has(p.symbol)) {
                        logAuditEntry("SYSTEM", p.symbol, "SYNC_POLICY", [{ name: "SYNC", result: "PASS" }], "TRADE", "Position recovered from exchange snapshot", { entry: p.entryPrice, sl: p.sl, tp: p.tp }, { notional: p.entryPrice * (p.size ?? p.qty ?? 0), leverage: leverageFor(p.symbol) });
                    }
                });
                prevPositions.forEach((p) => {
                    if (!newSymbols.has(p.symbol)) {
                        logAuditEntry("ERROR", p.symbol, "SYNC_POLICY", [{ name: "SYNC", result: "FAIL" }], "STOP", "Position missing in exchange snapshot", { entry: p.entryPrice, sl: p.sl, tp: p.tp }, { notional: p.entryPrice * (p.size ?? p.qty ?? 0), leverage: leverageFor(p.symbol) });
                    }
                });
                setActivePositions(mappedPositions);
                // 2. SYNC ORDERS
                const mappedOrders = Array.isArray(orders)
                    ? orders.map((o) => ({
                        orderId: o.orderId,
                        symbol: o.symbol,
                        side: o.side,
                        qty: Number(o.qty),
                        price: o.price ? Number(o.price) : null,
                        status: o.orderStatus,
                        createdTime: new Date(Number(o.createdTime)).toISOString(),
                    }))
                    : [];
                setTestnetOrders(mappedOrders);
                // 3. VISUAL INDICATORS
                if (diffs && diffs.length > 0) {
                    diffs.forEach((d) => {
                        if (d.severity === "HIGH") {
                            addLog({ action: "ERROR", message: `[Reconcile] ${d.message} (${d.symbol})` });
                        }
                    });
                }
                dataUnavailableRef.current = false;
                setSystemState((prev) => ({ ...prev, bybitStatus: "Connected", latency: meta?.latencyMs || json.meta?.latencyMs || 0 }));
                // 4. CLOSED PNL FETCH (Separate for now, simpler to keep existing logic)
                try {
                    const pnlRes = await fetch(`${apiBase}${apiPrefix}/closed-pnl?net=${useTestnet ? "testnet" : "mainnet"}`, {
                        headers: { Authorization: `Bearer ${authToken}` },
                    });
                    if (pnlRes.ok) {
                        const pnlJson = await pnlRes.json();
                        const pnlList = pnlJson?.data?.result?.list || pnlJson?.result?.list || [];
                        const records = Array.isArray(pnlList)
                            ? pnlList.map((r) => ({
                                symbol: r.symbol || "UNKNOWN",
                                pnl: Number(r.closedPnl ?? r.realisedPnl ?? 0),
                                timestamp: r.updatedTime ? new Date(Number(r.updatedTime)).toISOString() : new Date().toISOString(),
                                note: "Bybit closed pnl",
                            }))
                            : [];
                        setAssetPnlHistory((prev) => {
                            const next = { ...prev };
                            const seen = closedPnlSeenRef.current;
                            records.forEach((rec) => {
                                const key = `${rec.symbol}-${rec.timestamp}-${rec.pnl}`;
                                if (seen.has(key))
                                    return;
                                seen.add(key);
                                next[rec.symbol] = [rec, ...(next[rec.symbol] || [])].slice(0, 100);
                                addPnlRecord(rec);
                            });
                            if (seen.size > 500) {
                                const trimmed = Array.from(seen).slice(-400);
                                closedPnlSeenRef.current = new Set(trimmed);
                            }
                            return next;
                        });
                        const realized = records.reduce((sum, r) => sum + (r.pnl || 0), 0);
                        realizedPnlRef.current = realized; // Update ref for PnL tracking
                    }
                }
                catch (e) {
                    console.warn("Closed PnL fetch failed", e);
                }
            }
            catch (err) {
                if (cancel)
                    return;
                console.error("Reconcile error:", err);
                dataUnavailableRef.current = true;
                setSystemState((prev) => ({ ...prev, bybitStatus: "Error", latency: 0, lastError: err?.message || "reconcile error" }));
                logAuditEntry("ERROR", "MULTI", "DATA_FEED", [{ name: "API", result: "FAIL" }], "STOP", err?.message || "Reconcile API failed", {});
            }
        };
        const intervalId = setInterval(fetchReconcile, useTestnet ? 5000 : 3000);
        fetchReconcile();
        return () => {
            cancel = true;
            clearInterval(intervalId);
        };
    }, [authToken, useTestnet, apiBase, apiPrefix]);
    const fetchTrades = useCallback(async () => {
        if (!authToken) {
            setTestnetTrades([]);
            return;
        }
        try {
            const url = new URL(`${apiBase}${apiPrefix}/trades`);
            url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Trades API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
            const allowed = new Set(SYMBOLS);
            const mapped = Array.isArray(list)
                ? list
                    .filter((t) => allowed.has(t.symbol))
                    .map((t) => {
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
    }, [authToken, useTestnet, apiBase, apiPrefix, envBase, inferredBase]);
    // Orders are now synced via reconcile loop above (server-side strict sync)
    // We keep fetchTrades separate for now as it polls detailed history
    useEffect(() => {
        void fetchTrades();
        const id = setInterval(() => {
            void fetchTrades();
        }, 5000);
        return () => clearInterval(id);
    }, [fetchTrades]);
    // Keep refreshTestnetOrders pointing to fetchOrders for UI compatibility
    const refreshTestnetOrders = fetchOrders;
    const setLifecycle = (tradeId, status, note) => {
        lifecycleRef.current.set(tradeId, status);
        addLog({
            action: "SYSTEM",
            message: `[${tradeId}] ${status}${note ? ` | ${note}` : ""}`,
        });
    };
    const forceClosePosition = useCallback(async (pos) => {
        if (!authToken)
            return;
        const side = pos.side === "buy" ? "Sell" : "Buy";
        try {
            await fetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    symbol: pos.symbol,
                    side,
                    qty: Number(pos.size.toFixed(4)),
                    orderType: "Market",
                    timeInForce: "IOC",
                    reduceOnly: true,
                }),
            });
            addLog({
                action: "AUTO_CLOSE",
                message: `Forced reduce-only close ${pos.symbol} due to missing protection`,
            });
        }
        catch (err) {
            addLog({
                action: "ERROR",
                message: `Force close failed: ${err?.message || "unknown"}`,
            });
        }
    }, [apiBase, authToken, useTestnet]);
    const fetchPositionsOnce = useCallback(async (net) => {
        if (!authToken)
            return { list: [] };
        const url = new URL(`${apiBase}${apiPrefix}/positions`);
        url.searchParams.set("net", net);
        url.searchParams.set("settleCoin", "USDT");
        url.searchParams.set("category", "linear");
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok)
            throw new Error(`Positions fetch failed (${res.status})`);
        const json = await res.json();
        return {
            list: json?.data?.result?.list || json?.result?.list || json?.data?.list || [],
            retCode: json?.data?.retCode ?? json?.retCode,
            retMsg: json?.data?.retMsg ?? json?.retMsg,
        };
    }, [apiBase, apiPrefix, authToken]);
    const fetchOrdersOnce = useCallback(async (net) => {
        if (!authToken)
            return { list: [] };
        const url = new URL(`${apiBase}${apiPrefix}/orders`);
        url.searchParams.set("net", net);
        url.searchParams.set("settleCoin", "USDT");
        url.searchParams.set("category", "linear");
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok)
            throw new Error(`Orders fetch failed (${res.status})`);
        const data = await res.json();
        const retCode = data?.data?.retCode ?? data?.retCode;
        const retMsg = data?.data?.retMsg ?? data?.retMsg;
        const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
        return { list: Array.isArray(list) ? list : [], retCode, retMsg };
    }, [apiBase, apiPrefix, authToken]);
    const fetchOrderHistoryOnce = useCallback(async (net) => {
        if (!authToken)
            return { list: [] };
        const url = new URL(`${apiBase}${apiPrefix}/orders`);
        url.searchParams.set("net", net);
        url.searchParams.set("settleCoin", "USDT");
        url.searchParams.set("category", "linear");
        url.searchParams.set("history", "1");
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok)
            throw new Error(`Order history fetch failed (${res.status})`);
        const data = await res.json();
        const retCode = data?.data?.retCode ?? data?.retCode;
        const retMsg = data?.data?.retMsg ?? data?.retMsg;
        const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
        return { list: Array.isArray(list) ? list : [], retCode, retMsg };
    }, [apiBase, apiPrefix, authToken]);
    const fetchExecutionsOnce = useCallback(async (net, symbol) => {
        if (!authToken)
            return { list: [] };
        const url = new URL(`${apiBase}${apiPrefix}/executions`);
        url.searchParams.set("net", net);
        url.searchParams.set("limit", "100");
        url.searchParams.set("settleCoin", "USDT");
        url.searchParams.set("category", "linear");
        if (symbol)
            url.searchParams.set("symbol", symbol);
        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        if (!res.ok)
            throw new Error(`Executions fetch failed (${res.status})`);
        const data = await res.json();
        const retCode = data?.data?.retCode ?? data?.retCode;
        const retMsg = data?.data?.retMsg ?? data?.retMsg;
        const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
        return { list: Array.isArray(list) ? list : [], retCode, retMsg };
    }, [apiBase, apiPrefix, authToken]);
    const waitForFill = useCallback(async (tradeId, symbol, orderId, orderLinkId, maxWaitMs = 90000) => {
        const net = useTestnet ? "testnet" : "mainnet";
        const started = Date.now();
        let attempt = 0;
        while (Date.now() - started < maxWaitMs) {
            attempt += 1;
            // 1) In-memory executions seen by polling loop
            const execHit = executionEventsRef.current.find((e) => {
                if (e.symbol !== symbol)
                    return false;
                if (orderId && e.orderId && e.orderId === orderId)
                    return true;
                if (orderLinkId && e.orderLinkId && e.orderLinkId === orderLinkId)
                    return true;
                return !orderId && !orderLinkId;
            });
            if (execHit)
                return execHit;
            // 2) Fresh executions snapshot
            const executionsResp = await fetchExecutionsOnce(net, symbol);
            if (executionsResp.retCode && executionsResp.retCode !== 0) {
                addLog({
                    action: "ERROR",
                    message: `Executions retCode=${executionsResp.retCode} ${executionsResp.retMsg || ""}`,
                });
            }
            const execSnapshot = executionsResp.list.find((e) => {
                if (e.symbol !== symbol)
                    return false;
                if (orderId && e.orderId && e.orderId === orderId)
                    return true;
                if (orderLinkId && e.orderLinkId && e.orderLinkId === orderLinkId)
                    return true;
                return !orderId && !orderLinkId;
            });
            if (execSnapshot)
                return execSnapshot;
            // 3) Order history snapshot
            const historyResp = await fetchOrderHistoryOnce(net);
            if (historyResp.retCode && historyResp.retCode !== 0) {
                addLog({
                    action: "ERROR",
                    message: `Order history retCode=${historyResp.retCode} ${historyResp.retMsg || ""}`,
                });
            }
            const histMatch = historyResp.list.find((o) => {
                if (o.symbol !== symbol)
                    return false;
                if (orderId && o.orderId && o.orderId === orderId)
                    return true;
                if (orderLinkId && o.orderLinkId && o.orderLinkId === orderLinkId)
                    return true;
                return !orderId && !orderLinkId;
            });
            if (histMatch) {
                const st = String(histMatch.orderStatus || histMatch.status || "");
                if (st === "Filled" || st === "PartiallyFilled")
                    return histMatch;
                if (st === "Rejected")
                    throw new Error("Order Rejected");
                if (st === "Cancelled")
                    throw new Error("Order Cancelled");
            }
            // 4) Positions snapshot (with retCode log)
            const posResp = await fetchPositionsOnce(net);
            if (posResp.retCode && posResp.retCode !== 0) {
                addLog({
                    action: "ERROR",
                    message: `Positions retCode=${posResp.retCode} ${posResp.retMsg || ""}`,
                });
            }
            const found = posResp.list.find((p) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0);
            if (found)
                return found;
            await sleep(jitter(750, 1500));
        }
        const waitedSec = Math.round((Date.now() - started) / 1000);
        throw new Error(`Fill not confirmed for ${symbol} within ${waitedSec}s`);
    }, [addLog, fetchExecutionsOnce, fetchOrderHistoryOnce, fetchPositionsOnce, useTestnet]);
    const commitProtection = useCallback(async (tradeId, symbol, sl, tp, trailingStop) => {
        if (!authToken)
            return false;
        const net = useTestnet ? "testnet" : "mainnet";
        const tolerance = Math.abs((currentPricesRef.current[symbol] ?? 0) * 0.001) || 0.5;
        for (let attempt = 1; attempt <= 3; attempt++) {
            setLifecycle(tradeId, "PROTECTION_PENDING", `attempt ${attempt}`);
            const res = await fetch(`${apiBase}${apiPrefix}/protection?net=${net}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    symbol,
                    sl,
                    tp,
                    trailingStop,
                    positionIdx: 0,
                }),
            });
            if (!res.ok) {
                const txt = await res.text();
                addLog({
                    action: "ERROR",
                    message: `Protection set failed (${res.status}): ${txt}`,
                });
            }
            // verify
            try {
                const posResp = await fetchPositionsOnce(net);
                const found = posResp.list.find((p) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0);
                if (found) {
                    const tpOk = tp == null || Math.abs(Number(found.takeProfit ?? 0) - tp) <= tolerance;
                    const slOk = sl == null || Math.abs(Number(found.stopLoss ?? 0) - sl) <= tolerance;
                    const tsOk = trailingStop == null || Math.abs(Number(found.trailingStop ?? 0) - trailingStop) <= tolerance;
                    if (tpOk && slOk && tsOk) {
                        setLifecycle(tradeId, "PROTECTION_SET");
                        return true;
                    }
                }
            }
            catch (err) {
                addLog({ action: "ERROR", message: `Protection verify failed: ${err?.message || "unknown"}` });
            }
            await new Promise((r) => setTimeout(r, 800));
        }
        setLifecycle(tradeId, "PROTECTION_FAILED");
        addLog({
            action: "ERROR",
            message: `Protection not confirmed for ${symbol} after retries.`,
        });
        return false;
    }, [apiBase, authToken, fetchPositionsOnce, setLifecycle, useTestnet]);
    // Reconcile smyčka: hlídá stárnutí dat a ochranu
    useEffect(() => {
        if (!authToken)
            return;
        let cancel = false;
        const reconcile = async () => {
            const now = Date.now();
            const stale = now - lastPositionsSyncAtRef.current > 20000;
            if (stale) {
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Stale",
                    lastError: "Positions sync stale >20s",
                }));
            }
            // Daily Loss Halt (Realized + Unrealized)
            const positions = activePositionsRef.current;
            const realized = portfolioState.dailyPnl;
            const unrealized = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
            const totalDailyPnl = realized + unrealized;
            const maxLoss = -(portfolioState.totalCapital * (settingsRef.current.maxDailyLossPercent || 0.05));
            if (totalDailyPnl < maxLoss) {
                if (modeRef.current !== "OFF" && !dailyHaltAtRef.current) {
                    dailyHaltAtRef.current = Date.now();
                    addLog({ action: "SYSTEM", message: `DAILY LOSS HIT: ${totalDailyPnl.toFixed(2)} < ${maxLoss.toFixed(2)}. Halting.` });
                    // Logic to stop new entries is in performTrade (portfolioState check needed there or mode switch)
                    // Here we can force mode to OFF or specific HALT state if we had one.
                    // For now, we rely on dailyHaltAtRef to be checked in performTrade (it's not yet).
                    // Let's just log and update system state.
                    setSystemState(prev => ({ ...prev, lastError: "Daily Loss Limit Hit" }));
                }
            }
            else {
                dailyHaltAtRef.current = null; // Reset if recovered (optional, usually daily limit is sticky)
            }
            for (const p of positions) {
                if (!p || !p.symbol)
                    continue;
                const dir = p.side === "buy" ? 1 : -1;
                const price = currentPricesRef.current[p.symbol] || p.entryPrice;
                const oneR = Math.abs((p.entryPrice || 0) - (p.sl || p.entryPrice));
                if (!Number.isFinite(oneR) || oneR <= 0)
                    continue;
                const profit = (price - p.entryPrice) * dir;
                // SL/TP missing -> fail-safe close or set minimal protection
                const missingProtection = (p.sl == null || p.sl === 0) &&
                    (p.tp == null || p.tp === 0) &&
                    (p.currentTrailingStop == null || p.currentTrailingStop === 0);
                if (missingProtection && p.size > 0) {
                    const fallbackSl = dir > 0 ? p.entryPrice - oneR : p.entryPrice + oneR;
                    const fallbackTp = dir > 0 ? p.entryPrice + 2 * oneR : p.entryPrice - 2 * oneR;
                    const ok = await commitProtection(`recon-${p.id}`, p.symbol, fallbackSl, fallbackTp, undefined);
                    if (!ok)
                        await forceClosePosition(p);
                    continue;
                }
                // Trailing rules: +1R -> SL = BE+fees; +1.5R -> SL = entry + 0.5R*dir; +2R -> SL = entry + 1R*dir
                const feeShift = p.entryPrice * TAKER_FEE * 2;
                let newSl = null;
                if (profit >= oneR) {
                    newSl = p.entryPrice + dir * feeShift;
                }
                if (profit >= 1.5 * oneR) {
                    newSl = p.entryPrice + dir * (0.5 * oneR);
                }
                if (profit >= 2 * oneR) {
                    newSl = p.entryPrice + dir * oneR;
                    const swings = priceHistoryRef.current[p.symbol];
                    const swingLevel = dir > 0 ? findRecentHigherLow(swings) : findRecentLowerHigh(swings);
                    if (swingLevel != null) {
                        const buffer = p.entryPrice * STOP_MIN_PCT;
                        const swingStop = dir > 0 ? swingLevel - buffer : swingLevel + buffer;
                        if (dir > 0) {
                            if (swingStop > (p.sl ?? -Infinity)) {
                                newSl = Math.max(newSl ?? swingStop, swingStop);
                            }
                        }
                        else {
                            if (swingStop < (p.sl ?? Infinity)) {
                                newSl = Math.min(newSl ?? swingStop, swingStop);
                            }
                        }
                    }
                }
                if (newSl != null && Number.isFinite(newSl) && ((dir > 0 && newSl > (p.sl || 0)) || (dir < 0 && newSl < (p.sl || Infinity)))) {
                    const ok = await commitProtection(`trail-${p.id}`, p.symbol, newSl, p.tp, undefined);
                    if (ok) {
                        addLog({ action: "SYSTEM", message: `Trail rule applied ${p.symbol} profit ${profit.toFixed(4)} new SL ${newSl.toFixed(4)}` });
                    }
                }
            }
        };
        const id = setInterval(() => {
            if (!cancel)
                void reconcile();
        }, 12000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, commitProtection, forceClosePosition]);
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
    const lifecycleRef = useRef(new Map());
    const dailyHaltAtRef = useRef(null);
    const lastTestSignalAtRef = useRef(null);
    const lastKeepaliveAtRef = useRef(null);
    const coachStakeRef = useRef({});
    const dataUnavailableRef = useRef(false);
    const winStreakRef = useRef(0);
    const lossStreakRef = useRef(0);
    const rollingOutcomesRef = useRef([]);
    const lastPositionsSyncAtRef = useRef(0);
    const executionCursorRef = useRef(null);
    const processedExecIdsRef = useRef(new Set());
    const executionEventsRef = useRef([]);
    function addLog(entry) {
        const log = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date().toISOString(),
            ...entry,
        };
        setLogEntries((prev) => [log, ...prev].slice(0, 10));
    }
    function logAuditEntry(action, symbol, state, gates, decision, reason, prices, sizing, netRrr) {
        const gateMsg = gates.map((g) => `${g.name}:${g.result}`).join("|");
        addLog({
            action,
            message: `[${state}] ${decision} ${symbol} ${reason} | gates ${gateMsg} | prices e:${prices.entry?.toFixed?.(4) ?? "-"} sl:${prices.sl?.toFixed?.(4) ?? "-"} tp:${prices.tp?.toFixed?.(4) ?? "-"} | size ${sizing?.notional?.toFixed?.(2) ?? "-"} lev ${sizing?.leverage?.toFixed?.(2) ?? "-"} | netRRR ${netRrr != null ? netRrr.toFixed(2) : "-"}`,
        });
    }
    const shouldAllowMarketEntry = (spreadPct, depthOk, momentumOk) => {
        if (spreadPct <= 0.0005 && depthOk && momentumOk)
            return true; // 0.05 %
        return false;
    };
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
    const getVolatilityMultiplier = (symbol) => {
        const hist = priceHistoryRef.current[symbol] || [];
        if (!hist.length)
            return 1;
        const { atrShort, atrLong } = computeAtrPair(hist);
        if (!atrShort || !atrLong)
            return 1;
        const ratio = atrLong / Math.max(atrShort, 1e-8);
        return Math.min(4, Math.max(0.5, ratio * 0.8));
    };
    function buildDirectionalCandidate(symbol, candles) {
        if (!candles || candles.length < 30)
            return null;
        const price = candles[candles.length - 1]?.close;
        const prevClose = candles[candles.length - 2]?.close ?? price;
        if (!Number.isFinite(price) || price <= 0)
            return null;
        const { atrShort, atrLong } = computeAtrPair(candles);
        const atrPct = atrShort > 0 ? atrShort / price : 0;
        const emaFast = computeEma(candles.slice(-80), 14);
        const emaSlow = computeEma(candles.slice(-120), 50);
        const trendStrength = Math.abs(emaFast - emaSlow) / Math.max(price, 1e-8);
        let side = null;
        if (emaFast > emaSlow * 1.0003 && price > emaFast)
            side = "buy";
        if (emaFast < emaSlow * 0.9997 && price < emaFast)
            side = "sell";
        if (!side)
            return null;
        const recent = candles.slice(-6);
        const recentHigh = Math.max(...recent.map((c) => c.high));
        const recentLow = Math.min(...recent.map((c) => c.low));
        const pullbackTrigger = side === "buy"
            ? prevClose < emaFast && price > emaFast && price > prevClose && price >= emaFast * 0.997
            : prevClose > emaFast && price < emaFast && price < prevClose && price <= emaFast * 1.003;
        const breakoutTrigger = side === "buy"
            ? price > recentHigh && prevClose <= recentHigh * 1.0005
            : price < recentLow && prevClose >= recentLow * 0.9995;
        if (!pullbackTrigger && !breakoutTrigger)
            return null;
        const slDistance = Math.max(atrShort * 1.3, price * 0.0015);
        const tpDistance = slDistance * 2.2;
        const sl = side === "buy" ? price - slDistance : price + slDistance;
        const tp = side === "buy" ? price + tpDistance : price - tpDistance;
        const momentum = ((price - prevClose) / price) * (side === "buy" ? 1 : -1);
        const volScore = scoreVol(atrPct);
        const score = trendStrength * 2 + momentum * 3 + volScore;
        const risk = Math.max(0.5, Math.min(0.95, 0.55 + score));
        const triggerLabel = pullbackTrigger ? "pullback" : "breakout";
        const reason = `${symbol} ${side.toUpperCase()} | ${triggerLabel} | trend ${(trendStrength * 100).toFixed(2)}bps | ATR ${atrPct ? (atrPct * 100).toFixed(2) : "0"}%`;
        const signal = {
            id: `${symbol}-dir-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            symbol,
            profile: "intraday",
            kind: pullbackTrigger ? "PULLBACK" : "BREAKOUT",
            risk,
            createdAt: new Date().toISOString(),
            intent: {
                side,
                entry: price,
                sl,
                tp,
                symbol,
                qty: 0,
            },
            message: reason,
        };
        return { signal, score, reason };
    }
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
                const structCandidates = [];
                for (const symbol of SYMBOLS) {
                    const fetchInterval = async (interval, limit = 200) => {
                        const url = `${URL_KLINE}&symbol=${symbol}&interval=${interval}&limit=${limit}`;
                        const res = await fetch(url);
                        const json = await res.json();
                        if (json.retCode !== 0)
                            throw new Error(json.retMsg);
                        return parseKlines(json.result?.list ?? []);
                    };
                    const c5 = await fetchInterval("5", 200);
                    const c15 = await fetchInterval("15", 200);
                    const c1h = await fetchInterval("60", 200);
                    const c4h = await fetchInterval("240", 200);
                    if (!c5.length || !c15.length || !c1h.length || !c4h.length)
                        continue;
                    newHistory[symbol] = c5;
                    newPrices[symbol] = c5[c5.length - 1].close;
                    const structureDebug = evaluateMarketStructureWithReason(c4h, c1h, c15, c5, symbol);
                    const structure = structureDebug.structure;
                    if (structure && structure.netRrr >= 1.5) {
                        const sig = {
                            id: `${symbol}-ms-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
                            symbol,
                            profile: "intraday",
                            kind: "BREAKOUT",
                            risk: Math.min(0.95, Math.max(0.5, structure.netRrr / 2)),
                            createdAt: new Date().toISOString(),
                            intent: {
                                side: structure.direction,
                                entry: structure.entry,
                                sl: structure.sl,
                                tp: structure.tp2,
                                symbol,
                                qty: 0,
                            },
                            message: `MS ${structure.direction.toUpperCase()} netRRR ${structure.netRrr.toFixed(2)} gates ${structure.gates.join(",")}`,
                        };
                        const structureScore = structure.gates.length / 6;
                        structCandidates.push({ symbol, signal: sig, netRrr: structure.netRrr, structureScore });
                    }
                    else {
                        // Debug log for missing signals (sampled)
                        const nowSec = Math.floor(Date.now() / 1000);
                        if (nowSec % 180 === 0) {
                            addLog({
                                action: "SYSTEM",
                                message: `NO SIGNAL ${symbol} reason ${structureDebug.reason}`,
                            });
                        }
                    }
                }
                if (cancel)
                    return;
                priceHistoryRef.current = newHistory;
                setCurrentPrices(newPrices);
                currentPricesRef.current = newPrices;
                dataUnavailableRef.current = false;
                const latency = Math.round(performance.now() - started);
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Connected",
                    latency,
                    lastError: null,
                }));
                const priorityOrder = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];
                const priorityRank = (s) => priorityOrder.indexOf(s);
                const filtered = structCandidates.filter((c) => c.netRrr >= 1.5);
                const overrideSorted = filtered.sort((a, b) => {
                    const prDiff = priorityRank(a.symbol) - priorityRank(b.symbol);
                    if (prDiff !== 0) {
                        if (a.netRrr >= b.netRrr + 0.5 && a.structureScore >= b.structureScore + 0.2)
                            return -1;
                        if (b.netRrr >= a.netRrr + 0.5 && b.structureScore >= a.structureScore + 0.2)
                            return 1;
                    }
                    if (prDiff !== 0)
                        return prDiff;
                    return b.netRrr - a.netRrr;
                });
                const chosen = [];
                const activeSymbols = new Set(activePositionsRef.current.map((p) => p.symbol));
                const pendingSymbols = new Set(pendingSignalsRef.current.map((p) => p.symbol));
                const correlationOk = (cand) => {
                    const dir = cand.signal.intent.side;
                    const hasDir = (sym, d) => activePositionsRef.current.some((p) => p.symbol === sym && p.side === d) ||
                        pendingSignalsRef.current.some((p) => p.symbol === sym && p.intent.side === d);
                    if ((cand.symbol === "BTCUSDT" && hasDir("ETHUSDT", dir)) || (cand.symbol === "ETHUSDT" && hasDir("BTCUSDT", dir))) {
                        return false;
                    }
                    return true;
                };
                for (const cand of overrideSorted) {
                    if (chosen.length >= 2)
                        break;
                    if (activePositionsRef.current.length + chosen.length >= MAX_ACTIVE_TRADES)
                        break;
                    if (activeSymbols.has(cand.symbol) || pendingSymbols.has(cand.symbol))
                        continue;
                    if (!correlationOk(cand))
                        continue;
                    chosen.push(cand.signal);
                }
                if (chosen.length) {
                    setPendingSignals((prev) => [...chosen, ...prev]);
                    chosen.forEach((s) => addLog({
                        action: "SIGNAL",
                        message: s.message,
                    }));
                }
            }
            catch (err) {
                if (cancel)
                    return;
                const msg = err.message ?? "unknown";
                dataUnavailableRef.current = true;
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Error",
                    lastError: msg,
                    recentErrors: [msg, ...p.recentErrors].slice(0, 10),
                }));
                logAuditEntry("ERROR", "MULTI", "DATA_FEED", [{ name: "API", result: "FAIL" }], "STOP", `Market data unavailable: ${msg}`, {});
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
    // Executions polling (pro rychlejší fill detection)
    useEffect(() => {
        if (!authToken)
            return;
        let cancel = false;
        const poll = async () => {
            try {
                const url = new URL(`${apiBase}${apiPrefix}/executions`);
                url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
                if (executionCursorRef.current) {
                    url.searchParams.set("cursor", executionCursorRef.current);
                }
                const res = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                });
                if (!res.ok)
                    return;
                const json = await res.json();
                const list = json?.data?.result?.list || json?.result?.list || [];
                const cursor = json?.data?.result?.nextPageCursor || json?.result?.nextPageCursor;
                const seen = processedExecIdsRef.current;
                const allowedSymbols = new Set(SYMBOLS);
                list.forEach((e) => {
                    const id = e.execId || e.tradeId;
                    if (!id || seen.has(id))
                        return;
                    if (e.symbol && !allowedSymbols.has(e.symbol))
                        return;
                    seen.add(id);
                    executionEventsRef.current = [
                        {
                            id,
                            symbol: e.symbol || "",
                            orderId: e.orderId || e.orderID || e.clOrdId,
                            orderLinkId: e.orderLinkId || e.orderLinkID || e.clientOrderId,
                            price: Number(e.execPrice ?? e.price ?? 0),
                            qty: Number(e.execQty ?? e.qty ?? 0),
                            time: e.execTime ? new Date(Number(e.execTime)).toISOString() : new Date().toISOString(),
                        },
                        ...executionEventsRef.current,
                    ].slice(0, 200);
                    addLog({
                        action: "SYSTEM",
                        message: `FILL ${e.symbol || ""} ${e.side || ""} @ ${e.execPrice || e.price || "?"} qty ${e.execQty || e.qty || "?"}`,
                    });
                });
                if (seen.size > 2000) {
                    processedExecIdsRef.current = new Set(Array.from(seen).slice(-1000));
                }
                if (cursor)
                    executionCursorRef.current = cursor;
            }
            catch {
                // ignore polling errors
            }
        };
        poll();
        const id = setInterval(() => {
            if (!cancel)
                void poll();
        }, 5000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, apiBase, useTestnet]);
    // ========== EXECUTE TRADE (simulated + backend order) ==========
    const performTrade = async (signalId) => {
        // Locate signal
        const signal = pendingSignalsRef.current.find((s) => s.id === signalId);
        if (!signal)
            return false;
        if (dataUnavailableRef.current) {
            logAuditEntry("REJECT", signal.symbol, "DATA_FEED", [{ name: "API", result: "FAIL" }], "STOP", "Market data unavailable", {});
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        const { symbol, side } = signal.intent;
        const { sl, tp, qty, trailingStopDistance, price: intentPrice, triggerPrice: intentTrigger } = signal.intent;
        const lastPrice = currentPricesRef.current[symbol];
        const entryPrice = Number(intentPrice ??
            signal.intent.entry ??
            (Number.isFinite(lastPrice) ? lastPrice : NaN));
        const maxOpen = settingsRef.current.maxOpenPositions ?? 2;
        const activeCount = activePositionsRef.current.length;
        if (activeCount >= maxOpen || activeCount >= MAX_ACTIVE_TRADES) {
            const reason = `Max open positions reached (${activeCount})`;
            addLog({ action: "REJECT", message: `Skip ${symbol}: ${reason}` });
            logAuditEntry("REJECT", symbol, "EXECUTION", [{ name: "ACTIVE_TRADES_OK", result: "FAIL" }], "DENY", reason, { entry: entryPrice });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        const hasEntry = Number.isFinite(entryPrice);
        const isBuy = side === "buy" || side === "Buy";
        const safeEntry = Number.isFinite(entryPrice) ? entryPrice : Number.isFinite(lastPrice) ? lastPrice : 0;
        // Block duplicate entries for symbols with open positions
        const hasOpenPosition = activePositionsRef.current.some((p) => p.symbol === symbol);
        if (hasOpenPosition) {
            addLog({
                action: "REJECT",
                message: `Skip ${symbol}: position already open`,
            });
            logAuditEntry("REJECT", symbol, "EXECUTION", [{ name: "ACTIVE_TRADES_OK", result: "FAIL" }], "DENY", "Position already open", { entry: safeEntry });
            // Remove the pending signal to avoid reprocessing
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        // ROI-based TP/SL override for key symbols
        const roiTargets = { tp: 110, sl: -40 }; // ROI % (Bybit-style)
        const isRoiSymbol = symbol === "BTCUSDT" || symbol === "ETHUSDT" || symbol === "SOLUSDT" || symbol === "ADAUSDT";
        const lev = leverageFor(symbol);
        const baseEntryForRoi = Number.isFinite(entryPrice) ? entryPrice : Number.isFinite(intentTrigger) ? Number(intentTrigger) : safeEntry;
        const tpMove = (roiTargets.tp / 100) / Math.max(1, lev); // price move pct
        const slMove = (Math.abs(roiTargets.sl) / 100) / Math.max(1, lev);
        const roiTpPrice = Number.isFinite(baseEntryForRoi) && isRoiSymbol
            ? baseEntryForRoi * (1 + tpMove * (isBuy ? 1 : -1))
            : undefined;
        const roiSlPrice = Number.isFinite(baseEntryForRoi) && isRoiSymbol
            ? baseEntryForRoi * (1 - slMove * (isBuy ? 1 : -1))
            : undefined;
        const baseSl = Number.isFinite(sl) ? sl : Number.isFinite(safeEntry) ? (isBuy ? safeEntry * 0.99 : safeEntry * 1.01) : undefined;
        const finalTp = Number.isFinite(roiTpPrice) ? roiTpPrice : tp;
        const finalSl = Number.isFinite(roiSlPrice) ? roiSlPrice : baseSl;
        if (!Number.isFinite(finalSl)) {
            addLog({ action: "REJECT", message: `Skip ${symbol}: SL invalid` });
            logAuditEntry("REJECT", symbol, "EXECUTION", [{ name: "SL_SET_OK", result: "FAIL" }], "DENY", "SL invalid", { entry: safeEntry });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        const profileSetting = signal.profile ||
            (settingsRef.current.strategyProfile === "auto" ? "intraday" : settingsRef.current.strategyProfile);
        const profile = profileSetting === "scalp" ||
            profileSetting === "intraday" ||
            profileSetting === "swing" ||
            profileSetting === "trend" ||
            profileSetting === "coach"
            ? profileSetting
            : "intraday";
        const kind = signal.kind || "BREAKOUT";
        const rDist = Math.abs(safeEntry - finalSl);
        const tp1 = isBuy ? safeEntry + 1.5 * rDist : safeEntry - 1.5 * rDist;
        const tp2 = isBuy ? safeEntry + 2 * rDist : safeEntry - 2 * rDist;
        const stopLossValue = Number(finalSl ?? safeEntry ?? 0);
        const takeProfitValue = tp2;
        const netR = netRrrWithFees(safeEntry, stopLossValue, takeProfitValue, TAKER_FEE);
        const gatesAudit = [];
        gatesAudit.push({ name: "NET_RRR", result: netR >= 1.5 ? "PASS" : "FAIL" });
        gatesAudit.push({ name: "STOP_MIN", result: rDist / safeEntry >= STOP_MIN_PCT ? "PASS" : "FAIL" });
        if (netR < 1.5) {
            logAuditEntry("REJECT", symbol, "EXECUTION", gatesAudit, "DENY", "NET_RRR < 1.5", { entry: safeEntry, sl: stopLossValue, tp: takeProfitValue }, undefined, netR);
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        // Risk engine sizing
        const sizing = computePositionSizing(symbol, safeEntry, finalSl, useTestnet);
        if (sizing.ok === false) {
            const reason = sizing.reason;
            logAuditEntry("REJECT", symbol, "RISK_ENGINE", [...gatesAudit, { name: "SIZING", result: "FAIL" }], "DENY", reason, { entry: safeEntry, sl: stopLossValue, tp: takeProfitValue });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        const { qty: orderQty, notional: newTradeNotional, leverage: computedLeverage, riskUsd: sizingRisk } = sizing;
        const currentRisk = openRiskUsd(activePositionsRef.current);
        if (currentRisk + sizingRisk > MAX_TOTAL_RISK_USD) {
            logAuditEntry("REJECT", symbol, "RISK_ENGINE", [...gatesAudit, { name: "RISK_BUDGET", result: "FAIL" }], "DENY", `Risk budget exceeded ${(currentRisk + sizingRisk).toFixed(2)} > ${MAX_TOTAL_RISK_USD}`, { entry: safeEntry, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        logAuditEntry("SYSTEM", symbol, "RISK_ENGINE", [...gatesAudit, { name: "RISK_BUDGET", result: "PASS" }, { name: "SIZING", result: "PASS" }], "TRADE", "Sizing ok", { entry: safeEntry, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
        const orderType = "Limit";
        const price = safeEntry;
        const triggerPrice = undefined;
        const timeInForce = "GTC";
        const entryModeGate = { name: "ENTRY_MODE_OK", result: "PASS" };
        const isAutoMode = mode === TradingMode.AUTO_ON;
        const isPaperMode = mode === TradingMode.PAPER;
        // 0. STRICT MODE CHECK
        if (settings.strategyProfile === "auto" && !isAutoMode && !isPaperMode) {
            console.warn(`[Trade] Skipped - Mode is ${mode}, need AUTO_ON or PAPER`);
            return false;
        }
        // 0.1 PORTFOLIO RISK GATE (New)
        const currentPositions = activePositionsRef.current;
        const totalCapital = portfolioState.totalCapital || ACCOUNT_BALANCE_USD;
        const maxAlloc = portfolioState.maxAllocatedCapital || (totalCapital * (settingsRef.current.maxAllocatedCapitalPercent || 1));
        // 1. Max Exposure Check (margin-based so high leverage is allowed)
        const currentMargin = currentPositions.reduce((sum, p) => sum + marginFor(p.symbol, p.entryPrice, p.size ?? p.qty ?? 0), 0);
        const newTradeMargin = marginFor(symbol, safeEntry, orderQty);
        if (currentMargin + newTradeMargin > maxAlloc) {
            addLog({
                action: "REJECT",
                message: `Risk Gate: Max Margin Exceeded ${symbol} (${(currentMargin + newTradeMargin).toFixed(2)} > ${maxAlloc.toFixed(2)})`,
            });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        // 1.1 Net Delta Gate (Directional Exposure Limit) - also margin-based
        const netDelta = currentPositions.reduce((sum, p) => sum +
            (p.side === "buy" ? 1 : -1) *
                marginFor(p.symbol, p.entryPrice, p.size ?? p.qty ?? 0), 0);
        const newDelta = (isBuy ? 1 : -1) * newTradeMargin;
        const projectedDelta = netDelta + newDelta;
        const maxDelta = maxAlloc;
        if (Math.abs(projectedDelta) > maxDelta) {
            addLog({
                action: "REJECT",
                message: `Risk Gate: Max Net Delta Exceeded ${symbol} (${Math.abs(projectedDelta).toFixed(2)} > ${maxDelta.toFixed(2)})`,
            });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        // 2. Correlation / Concentration Limit (Max positions per "bucket" - simplistic symbol check)
        // If we have ETHUSDT, maybe don't open ETH-PERP? (Not applicable here as we assume linear perps)
        // Check simply max risk budget per symbol.
        const existingSymbolRisk = currentPositions
            .filter(p => p.symbol === symbol)
            .reduce((sum, p) => sum + (Math.abs(p.entryPrice - p.sl) * p.size), 0);
        const newTradeRisk = Math.abs(safeEntry - (Number(finalSl) || safeEntry)) * orderQty;
        const maxRiskPerSymbol = totalCapital * Math.min(settingsRef.current.maxPortfolioRiskPercent || 0.2, 0.2); // cap at 20 % of balance
        if (existingSymbolRisk + newTradeRisk > maxRiskPerSymbol) {
            addLog({ action: "REJECT", message: `Risk Gate: Max Symbol Risk Exceeded ${symbol} (${(existingSymbolRisk + newTradeRisk).toFixed(2)} > ${maxRiskPerSymbol.toFixed(2)})` });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        // 3. Min Edge Gate (Fee + Slippage vs Expected Reward)
        // Fee ~ 0.06% entry + 0.06% exit = 0.12%. Slippage ~ 0.05%. Total cost ~ 0.17% of notional.
        const estCost = newTradeNotional * 0.0017;
        const estReward = Math.abs(safeEntry - (Number(finalTp) || safeEntry)) * orderQty;
        // If reward is defined and < cost * 1.5, reject
        if (finalTp && estReward < estCost * 1.5) {
            addLog({ action: "REJECT", message: `Risk Gate: Edge too small (Reward ${estReward.toFixed(2)} < Cost ${estCost.toFixed(2)} * 1.5)` });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        // 1. MUTEX CHECK
        if (executionLocksRef.current.has(symbol)) {
            console.warn(`[Trade] Skipped - Execution locked for ${symbol}`);
            return false;
        }
        executionLocksRef.current.add(symbol);
        try {
            // Re-check pending (double check inside lock)
            if (!pendingSignalsRef.current.find((s) => s.id === signalId))
                return false;
            setLifecycle(signalId, "ENTRY_SUBMITTED");
            // Remove from pending immediately to prevent infinite loop re-processing
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            // Calculate metrics (re-use logic or trust intent)
            const clientOrderId = signalId.substring(0, 36);
            if (isAutoMode) {
                const payload = {
                    symbol,
                    side: side === "buy" ? "Buy" : "Sell",
                    qty: Number(orderQty.toFixed(4)),
                    orderType,
                    price,
                    triggerPrice,
                    timeInForce,
                    orderLinkId: clientOrderId,
                    sl: stopLossValue,
                    tp: takeProfitValue,
                    trailingStop: undefined,
                    trailingActivePrice: undefined,
                };
                const submitOrder = async () => {
                    try {
                        const res = await fetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${authToken}`
                            },
                            body: JSON.stringify(payload)
                        });
                        const status = res.status;
                        const body = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            const errMsg = body?.error || `Order API failed (${status})`;
                            return { ok: false, status, error: errMsg, body };
                        }
                        const retCode = body?.retCode ?? body?.data?.retCode ?? 0;
                        if (retCode && retCode !== 0) {
                            const retMsg = body?.retMsg ?? body?.data?.retMsg ?? "Unknown error";
                            return { ok: false, status, error: `Bybit Rejected: ${retMsg}`, body };
                        }
                        const orderId = body?.result?.orderId ||
                            body?.data?.result?.orderId ||
                            body?.data?.orderId ||
                            null;
                        return { ok: true, status, orderId, body };
                    }
                    catch (e) {
                        return { ok: false, status: 0, error: e?.message || "Order exception" };
                    }
                };
                const placeOrderWithRetry = async (maxRetry) => {
                    let attempt = 0;
                    let last = null;
                    while (attempt <= maxRetry) {
                        attempt += 1;
                        const res = await submitOrder();
                        if (res.ok)
                            return res;
                        last = res;
                        const retryable = res.status === 0 || res.status >= 500 || res.status === 429;
                        logAuditEntry("ERROR", symbol, "ORDER_SUBMIT", [...gatesAudit, entryModeGate], retryable && attempt <= maxRetry ? "RETRY" : "STOP", res.error || "Order failed", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
                        if (!retryable || attempt > maxRetry)
                            break;
                        await sleep(800 * attempt);
                    }
                    return last;
                };
                const submit = await placeOrderWithRetry(1);
                if (!submit?.ok) {
                    const msg = submit?.error || "Order failed";
                    addLog({ action: "ERROR", message: msg });
                    setLifecycle(signalId, "FAILED", msg);
                    setSystemState((prev) => ({ ...prev, lastError: msg, bybitStatus: "Error" }));
                    return false;
                }
                logAuditEntry("SYSTEM", symbol, "ORDER_SUBMIT", [...gatesAudit, entryModeGate], "TRADE", "Order placed", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
                const orderId = submit?.orderId ||
                    submit?.body?.result?.orderId ||
                    submit?.body?.data?.result?.orderId ||
                    submit?.body?.data?.orderId ||
                    null;
                try {
                    const fill = await waitForFill(signalId, symbol, orderId, clientOrderId, useTestnet ? 45000 : 90000);
                    if (fill) {
                        setLifecycle(signalId, "ENTRY_FILLED");
                        setLifecycle(signalId, "MANAGING");
                        logAuditEntry("SYSTEM", symbol, "ORDER_FILL", [...gatesAudit, entryModeGate], "TRADE", "Order filled", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
                        return true;
                    }
                }
                catch (err) {
                    addLog({
                        action: "ERROR",
                        message: `Fill not confirmed: ${err?.message || "unknown"}`,
                    });
                    setLifecycle(signalId, "FAILED", err?.message || "fill failed");
                    logAuditEntry("ERROR", symbol, "ORDER_FILL", [...gatesAudit, entryModeGate], "STOP", err?.message || "Fill failed", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
                    return false;
                }
                return false;
            }
            else if (isPaperMode) {
                const slPrice = Number.isFinite(stopLossValue) ? stopLossValue : safeEntry;
                const tpPrice = Number.isFinite(takeProfitValue) ? takeProfitValue : safeEntry;
                const openedAt = new Date().toISOString();
                const simulated = {
                    positionId: signalId,
                    id: signalId,
                    symbol,
                    side: isBuy ? "buy" : "sell",
                    qty: orderQty,
                    size: orderQty,
                    entryPrice: safeEntry,
                    sl: slPrice,
                    tp: tpPrice,
                    env: useTestnet ? "testnet" : "mainnet",
                    openedAt,
                    timestamp: openedAt,
                    currentTrailingStop: undefined,
                    unrealizedPnl: 0,
                    pnl: 0,
                    pnlValue: 0,
                };
                setActivePositions((prev) => {
                    const next = [...prev, simulated];
                    activePositionsRef.current = next;
                    return next;
                });
                setPortfolioState((p) => {
                    const notional = marginFor(symbol, safeEntry, orderQty);
                    return {
                        ...p,
                        openPositions: p.openPositions + 1,
                        allocatedCapital: Math.min(p.maxAllocatedCapital, p.allocatedCapital + notional),
                    };
                });
                setLifecycle(signalId, "ENTRY_FILLED", "Simulated");
                setLifecycle(signalId, "MANAGING", "Simulated");
                return true;
            }
            else {
                addLog({ action: "SYSTEM", message: `Mode ${mode} does not execute trades.` });
                return false;
            }
        }
        catch (err) {
            console.error("Trade exception", err);
            setLifecycle(signalId, "FAILED", err.message);
            addLog({ action: "ERROR", message: `Trade exception: ${err.message}` });
            return false;
        }
        finally {
            executionLocksRef.current.delete(symbol);
        }
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
        const canAutoExecute = modeRef.current === TradingMode.AUTO_ON ||
            modeRef.current === TradingMode.PAPER;
        if (!canAutoExecute)
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
            const freedNotional = marginFor(target.symbol, target.entryPrice, target.size);
            realizedPnlRef.current += pnl;
            registerOutcome(pnl);
            const limits = QTY_LIMITS[target.symbol];
            if (settingsRef.current.strategyProfile === "coach" && limits) {
                const nextStake = Math.max(limits.min * target.entryPrice, Math.min(limits.max * target.entryPrice, freedNotional * leverageFor(target.symbol) + pnl));
                coachStakeRef.current[target.symbol] = nextStake;
            }
            const record = {
                symbol: target.symbol,
                pnl,
                timestamp: new Date().toISOString(),
                note: `Closed at ${currentPrice.toFixed(4)} | size ${target.size.toFixed(4)}`,
            };
            if (authToken) {
                setAssetPnlHistory(() => addPnlRecord(record));
            }
            setEntryHistory(() => addEntryToHistory({
                id: `${target.id}-closed`,
                symbol: target.symbol,
                side: target.side.toLowerCase(), // FIX: strict lower case
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
            const relaxedEntry = patched.entryStrictness === "test"
                ? "relaxed"
                : patched.entryStrictness === "ultra"
                    ? "base"
                    : patched.entryStrictness;
            patched = {
                ...patched,
                baseRiskPerTrade: Math.max(0.01, Math.min(patched.baseRiskPerTrade, 0.02)),
                maxOpenPositions: 1,
                maxDailyLossPercent: Math.max(Math.min(patched.maxDailyLossPercent, 0.12), 0.08),
                maxDrawdownPercent: Math.max(patched.maxDrawdownPercent, 0.3),
                maxPortfolioRiskPercent: Math.max(Math.min(patched.maxPortfolioRiskPercent, 0.12), 0.08),
                enforceSessionHours: false,
                entryStrictness: relaxedEntry,
            };
        }
        // Hard clamp max open positions
        patched = { ...patched, maxOpenPositions: Math.min(2, patched.maxOpenPositions ?? 2) };
        setSettings(patched);
        settingsRef.current = patched;
        persistSettings(patched);
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
    const resetPnlHistory = () => {
        setAssetPnlHistory(() => clearPnlHistory());
        realizedPnlRef.current = 0;
        setPortfolioState((p) => ({
            ...p,
            dailyPnl: 0,
            currentDrawdown: 0,
        }));
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
        refreshTestnetOrders: fetchOrders,
        mainnetOrders: testnetOrders, // Unify state: always return current orders
        mainnetTrades: testnetTrades,
        mainnetError: ordersError,
        refreshMainnetOrders: fetchOrders,
        refreshMainnetTrades: fetchTrades,
        assetPnlHistory,
        removeEntryHistoryItem,
        resetPnlHistory,
    };
};
