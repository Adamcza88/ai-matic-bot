// hooks/useTradingBot.ts
import { useState, useEffect, useRef, useCallback } from "react";
import { TradingMode, } from "../types";
import { evaluateStrategyForSymbol } from "@/engine/botEngine";
import { getApiBase, useNetworkConfig } from "../engine/networkConfig";
import { addEntryToHistory, loadEntryHistory, removeEntryFromHistory, persistEntryHistory } from "../lib/entryHistory";
import { addPnlRecord, clearPnlHistory } from "../lib/pnlHistory";
import { computeAtr as scalpComputeAtr, computeEma as scalpComputeEma, computeSma as scalpComputeSma, computeSuperTrend, findLastPivotHigh, findLastPivotLow, roundDownToStep, roundToTick, } from "../engine/deterministicScalp";
// SYMBOLS (Deterministic Scalp Profile 1)
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
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
    maxDrawdownPercent: 0.7,
    baseRiskPerTrade: 0,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
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
    maxDrawdownPercent: 0.7,
    baseRiskPerTrade: 0,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
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
// Coach detection (Base 'n Break / Wedge Pop approximation)
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
    const requestQueueRef = useRef(Promise.resolve());
    const requestTokensRef = useRef({
        lastRefillMs: Date.now(),
        dataTokens: 8,
        orderTokens: 2,
    });
    const requestOutcomesRef = useRef({
        outcomes: new Array(50).fill(true),
        idx: 0,
    });
    const noteRequestOutcome = (ok) => {
        const ring = requestOutcomesRef.current;
        ring.outcomes[ring.idx] = ok;
        ring.idx = (ring.idx + 1) % ring.outcomes.length;
    };
    const getApiErrorRate = () => {
        const { outcomes } = requestOutcomesRef.current;
        const total = outcomes.length;
        const fails = outcomes.reduce((s, v) => s + (v ? 0 : 1), 0);
        return total > 0 ? fails / total : 0;
    };
    const refillTokens = () => {
        const t = requestTokensRef.current;
        const now = Date.now();
        const dtSec = Math.max(0, (now - t.lastRefillMs) / 1000);
        if (dtSec <= 0)
            return;
        t.lastRefillMs = now;
        t.dataTokens = Math.min(8, t.dataTokens + dtSec * 8);
        t.orderTokens = Math.min(2, t.orderTokens + dtSec * 2);
    };
    const waitForToken = async (kind) => {
        while (true) {
            refillTokens();
            const t = requestTokensRef.current;
            const available = kind === "order" ? t.orderTokens : t.dataTokens;
            if (available >= 1) {
                if (kind === "order")
                    t.orderTokens -= 1;
                else
                    t.dataTokens -= 1;
                return;
            }
            const rate = kind === "order" ? 2 : 8;
            const deficit = 1 - available;
            const waitMs = Math.ceil((deficit / Math.max(1e-6, rate)) * 1000);
            await sleep(Math.min(250, Math.max(25, waitMs)));
        }
    };
    const runQueued = useCallback(async (kind, fn) => {
        let release;
        const gate = new Promise((r) => (release = r));
        const prev = requestQueueRef.current;
        requestQueueRef.current = prev.then(() => gate, () => gate);
        await prev;
        await waitForToken(kind);
        try {
            const out = await fn();
            noteRequestOutcome(true);
            return out;
        }
        catch (err) {
            noteRequestOutcome(false);
            throw err;
        }
        finally {
            release();
        }
    }, []);
    const queuedFetch = useCallback(async (input, init, kind = "data") => {
        return runQueued(kind, () => fetch(input, init));
    }, [runQueued]);
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
    const [walletEquity, setWalletEquity] = useState(null);
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
    const manualPnlResetRef = useRef(0);
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
        const checkReset = () => {
            const today = new Date().toISOString().split("T")[0];
            if (lastResetDayRef.current !== today) {
                lastResetDayRef.current = today;
                realizedPnlRef.current = 0;
                manualPnlResetRef.current = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
                setPortfolioState((prev) => {
                    const baseCapital = walletEquity ?? prev.totalCapital;
                    return {
                        ...prev,
                        totalCapital: baseCapital,
                        dailyPnl: 0,
                        currentDrawdown: 0,
                        peakCapital: baseCapital,
                        maxDrawdown: settingsRef.current.maxDrawdownPercent,
                    };
                });
                closedPnlSeenRef.current = new Set();
                clearPnlHistory();
                setAssetPnlHistory({});
            }
        };
        checkReset();
        const id = setInterval(checkReset, 60_000);
        return () => clearInterval(id);
    }, [walletEquity]);
    // Pull wallet equity (Unified Trading, USDT/USD) from backend and map to totalCapital
    useEffect(() => {
        if (!authToken)
            return;
        let cancel = false;
        const fetchWallet = async () => {
            try {
                const url = new URL(`${apiBase}${apiPrefix}/wallet`);
                url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
                const res = await queuedFetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                }, "data");
                if (!res.ok)
                    return;
                const json = await res.json();
                const list = json?.data?.list ?? json?.list ?? [];
                const first = list?.[0] ?? {};
                const coins = Array.isArray(first.coin) ? first.coin : [];
                const pickCoin = coins.find((c) => c.coin === "USDT") || coins.find((c) => c.coin === "USD");
                const coinBalance = pickCoin ? Number(pickCoin.walletBalance ?? pickCoin.equity) : null;
                const equity = Number(first.totalEquity) ||
                    coinBalance ||
                    Number(json?.data?.totalEquity) ||
                    null;
                if (equity != null && !cancel) {
                    setPortfolioState((prev) => ({
                        ...prev,
                        totalCapital: equity,
                        peakCapital: Math.max(prev.peakCapital, equity),
                    }));
                    setWalletEquity(equity);
                }
            }
            catch {
                // ignore wallet fetch errors for UI
            }
        };
        fetchWallet();
        const id = setInterval(fetchWallet, 60_000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [apiBase, apiPrefix, authToken, useTestnet]);
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
        // Hard reset Daily PnL snapshot to zero (user request)
        realizedPnlRef.current = 0;
        manualPnlResetRef.current = Date.now();
        setPortfolioState((prev) => ({ ...prev, dailyPnl: 0 }));
        clearPnlHistory();
        setAssetPnlHistory({});
        closedPnlSeenRef.current = new Set();
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
    // Periodický status log každé 3 minuty (plus okamžitě na start)
    useEffect(() => {
        const tick = () => {
            const pos = activePositionsRef.current.length;
            const pending = pendingSignalsRef.current.length;
            const err = systemState.lastError || "none";
            const modeLabel = useTestnet ? "TESTNET" : "MAINNET";
            addLog({
                action: "STATUS",
                message: `${modeLabel} | positions=${pos} pending=${pending} lastError=${err}`,
            });
        };
        tick();
        const id = setInterval(tick, 180_000);
        return () => clearInterval(id);
    }, [useTestnet, systemState.lastError]);
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
            const res = await queuedFetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            }, "data");
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
                const res = await queuedFetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                }, "data");
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
                    const now = new Date();
                    const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
                    const startTime = Math.max(dayStart, manualPnlResetRef.current || 0);
                    const endTime = now.getTime();
                    const pnlUrl = new URL(`${apiBase}${apiPrefix}/closed-pnl`);
                    pnlUrl.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
                    pnlUrl.searchParams.set("startTime", String(startTime));
                    pnlUrl.searchParams.set("endTime", String(endTime));
                    pnlUrl.searchParams.set("limit", "200");
                    const pnlRes = await queuedFetch(pnlUrl.toString(), {
                        headers: { Authorization: `Bearer ${authToken}` },
                    }, "data");
                    if (pnlRes.ok) {
                        const pnlJson = await pnlRes.json();
                        const pnlList = pnlJson?.data?.result?.list || pnlJson?.result?.list || [];
                        const records = Array.isArray(pnlList)
                            ? pnlList.map((r) => {
                                const tsMsRaw = Number(r.updatedTime ?? r.execTime ?? r.createdTime ?? Date.now());
                                const tsMs = Number.isFinite(tsMsRaw) ? tsMsRaw : Date.now();
                                return {
                                    symbol: r.symbol || "UNKNOWN",
                                    pnl: Number(r.closedPnl ?? r.realisedPnl ?? 0),
                                    timestamp: new Date(tsMs).toISOString(),
                                    tsMs,
                                    note: "Bybit closed pnl",
                                };
                            })
                            : [];
                        // Filtruj striktně na dnešní den podle UTC, aby se do denního PnL nedostaly staré záznamy
                        const filtered = records.filter((rec) => rec.tsMs >= startTime && rec.tsMs <= endTime);
                        const filteredRecords = filtered.map(({ tsMs, ...rest }) => rest);
                        setAssetPnlHistory((prev) => {
                            const next = { ...prev };
                            const seen = closedPnlSeenRef.current;
                            filteredRecords.forEach((rec) => {
                                const key = `${rec.symbol}-${rec.timestamp}-${rec.pnl}`;
                                if (seen.has(key))
                                    return;
                                seen.add(key);
                                next[rec.symbol] = [rec, ...(next[rec.symbol] || [])].slice(0, 100);
                                addPnlRecord(rec);
                                registerOutcome(rec.pnl);
                                if (lossStreakRef.current >= 3) {
                                    scalpGlobalCooldownUntilRef.current = Date.now() + 30 * 60 * 1000;
                                }
                            });
                            if (seen.size > 500) {
                                const trimmed = Array.from(seen).slice(-400);
                                closedPnlSeenRef.current = new Set(trimmed);
                            }
                            return next;
                        });
                        const realizedToday = filteredRecords.reduce((sum, r) => sum + (r.pnl || 0), 0);
                        realizedPnlRef.current = realizedToday; // Daily realized PnL (today only)
                    }
                    else {
                        realizedPnlRef.current = 0;
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
            const res = await queuedFetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            }, "data");
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
            await queuedFetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
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
            }, "order");
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
        const res = await queuedFetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        }, "data");
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
        const res = await queuedFetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        }, "data");
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
        const res = await queuedFetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        }, "data");
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
        const res = await queuedFetch(url.toString(), {
            headers: { Authorization: `Bearer ${authToken}` },
        }, "data");
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
            const res = await queuedFetch(`${apiBase}${apiPrefix}/protection?net=${net}`, {
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
            }, "order");
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
            const positions = activePositionsRef.current;
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
    const scalpStateRef = useRef({});
    const scalpReservedRiskUsdRef = useRef(0);
    const scalpRecentIdsRef = useRef(new Map());
    const scalpBusyRef = useRef(false);
    const scalpRotationIdxRef = useRef(0);
    const scalpActiveSymbolRef = useRef(null);
    const scalpSymbolLockUntilRef = useRef(0);
    const staleBboLogRef = useRef({});
    const scalpForceSafeUntilRef = useRef(0);
    const scalpSafeRef = useRef(false);
    const scalpGlobalCooldownUntilRef = useRef(0);
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const realizedPnlRef = useRef(0);
    const lastResetDayRef = useRef(null);
    const lifecycleRef = useRef(new Map());
    const lastTestSignalAtRef = useRef(null);
    const lastKeepaliveAtRef = useRef(null);
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
        setLogEntries((prev) => [log, ...prev].slice(0, 50));
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
    function buildBotEngineCandidate(symbol, candles) {
        // Leverage původní TradingBot engine (ATR/ADX trend + state machine)
        // Používáme default config, lze doplnit overrides podle UI settings.
        const decision = evaluateStrategyForSymbol(symbol, candles, {});
        const sig = decision?.signal;
        if (!sig || !sig.intent)
            return null;
        const entry = Number(sig.intent.entry);
        const sl = Number(sig.intent.sl);
        const tp = Number(sig.intent.tp);
        if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp))
            return null;
        const net = netRrrWithFees(entry, sl, tp, TAKER_FEE);
        if (net < 1)
            return null;
        const pending = {
            id: `${symbol}-be-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            symbol,
            profile: "trend",
            kind: "OTHER",
            risk: Math.min(0.95, Math.max(0.5, net / 2)),
            createdAt: new Date().toISOString(),
            intent: {
                side: sig.intent.side || (sig.intent.side === "buy" ? "buy" : "sell"),
                entry,
                sl,
                tp,
                symbol,
                qty: 0,
            },
            message: `BOT_ENGINE ${symbol} netRRR ${net.toFixed(2)}`,
        };
        return { signal: pending, score: net, reason: pending.message };
    }
    // ========== DETERMINISTIC SCALP (Profile 1) ==========
    useEffect(() => {
        if (mode === TradingMode.OFF) {
            setSystemState((p) => ({ ...p, bybitStatus: "Disconnected" }));
            return;
        }
        let cancel = false;
        const CFG = {
            tickMs: 250,
            symbolFetchGapMs: 350,
            ltfCloseDelayMs: 1200,
            htfCloseDelayMs: 2500,
            orderStatusDelayMs: 400,
            postCancelVerifyDelayMs: 300,
            postFillDelayMs: 200,
            postSlVerifyDelayMs: 300,
            postTpVerifyDelayMs: 300,
            spreadMaxPct: 0.0008, // 0.08%
            lowAtrMinPct: 0.0005, // 0.05%
            rvolMin: 1.2,
            stHtf: { atr: 10, mult: 3.0 },
            stLtf: { atr: 10, mult: 2.0 },
            emaPeriod: 21,
            atrPeriod: 14,
            touchBandAtrFrac: 0.1,
            offsetAtrFrac: 0.05,
            slBufferAtrFrac: 0.02,
            antiBreakoutRangeAtr: 1.5,
            antiBreakoutBodyFrac: 0.8,
            tpR: 1.4,
            partialAtR: 1.0,
            partialFrac: 0.5,
            trailActivateR: 0.8,
            trailRetraceR: 0.4,
            maxRecentIdWindowMs: 5 * 60 * 1000,
        };
        const net = useTestnet ? "testnet" : "mainnet";
        const canPlaceOrders = mode === TradingMode.AUTO_ON && Boolean(authToken);
        const expectedOpenTime = (nowMs, tfMs, delayMs) => Math.floor((nowMs - delayMs) / tfMs) * tfMs;
        const spreadPct = (bid, ask) => {
            const mid = (bid + ask) / 2;
            if (!Number.isFinite(mid) || mid <= 0)
                return Infinity;
            return (ask - bid) / mid;
        };
        const isBboStale = (bbo, nowMs, staleMs = 1500) => {
            if (!bbo)
                return true;
            return nowMs - bbo.ts > staleMs;
        };
        const ensureSymbolState = (symbol) => {
            const map = scalpStateRef.current;
            if (!map[symbol]) {
                map[symbol] = {
                    symbol,
                    nextAllowedAt: 0,
                    pausedUntil: 0,
                    cooldownUntil: 0,
                };
            }
            return map[symbol];
        };
        SYMBOLS.forEach(ensureSymbolState);
        const cleanupRecentIds = () => {
            const now = Date.now();
            const m = scalpRecentIdsRef.current;
            for (const [k, ts] of m.entries()) {
                if (now - ts > CFG.maxRecentIdWindowMs)
                    m.delete(k);
            }
        };
        const fetchInstrument = async (symbol) => {
            const url = `${httpBase}/v5/market/instruments-info?category=linear&symbol=${symbol}`;
            const res = await queuedFetch(url, undefined, "data");
            const json = await res.json();
            if (json.retCode !== 0)
                throw new Error(json.retMsg);
            const item = json?.result?.list?.[0];
            if (!item)
                throw new Error(`Instrument not found for ${symbol}`);
            return {
                tickSize: Number(item.priceFilter?.tickSize ?? 0),
                stepSize: Number(item.lotSizeFilter?.qtyStep ?? 0),
                minQty: Number(item.lotSizeFilter?.minOrderQty ?? 0),
                contractValue: Number(item.contractSize ?? 1),
            };
        };
        const fetchBbo = async (symbol) => {
            const url = `${httpBase}/v5/market/tickers?category=linear&symbol=${symbol}`;
            const res = await queuedFetch(url, undefined, "data");
            const json = await res.json();
            if (json.retCode !== 0)
                throw new Error(json.retMsg);
            const item = json?.result?.list?.[0];
            const bid = Number(item?.bid1Price ?? 0);
            const ask = Number(item?.ask1Price ?? 0);
            if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
                throw new Error(`Invalid BBO for ${symbol}`);
            }
            return { bid, ask, ts: Date.now() };
        };
        const fetchKlines = async (symbol, interval, limit) => {
            const url = `${httpBase}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
            const res = await queuedFetch(url, undefined, "data");
            const json = await res.json();
            if (json.retCode !== 0)
                throw new Error(json.retMsg);
            return parseKlines(json.result?.list ?? []);
        };
        const cancelOrderByLinkId = async (symbol, orderLinkId) => {
            if (!authToken)
                return;
            const res = await queuedFetch(`${apiBase}${apiPrefix}/cancel?net=${net}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ symbol, orderLinkId }),
            }, "order");
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.ok === false) {
                throw new Error(body?.error || `Cancel failed (${res.status})`);
            }
            const rc = body?.data?.retCode ?? body?.retCode;
            if (rc && rc !== 0)
                throw new Error(body?.data?.retMsg || body?.retMsg || "Cancel rejected");
            return body;
        };
        const placeLimit = async (p) => {
            if (!authToken)
                throw new Error("Missing auth token for live trading");
            const res = await queuedFetch(`${apiBase}${apiPrefix}/order?net=${net}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    symbol: p.symbol,
                    side: p.side,
                    qty: p.qty,
                    orderType: "Limit",
                    price: p.limitPrice,
                    timeInForce: "PostOnly",
                    reduceOnly: false,
                    orderLinkId: p.orderLinkId,
                }),
            }, "order");
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.ok === false) {
                throw new Error(body?.error || `Order failed (${res.status})`);
            }
            const rc = body?.data?.retCode ?? body?.retCode;
            if (rc && rc !== 0)
                throw new Error(body?.data?.retMsg || body?.retMsg || "Order rejected");
            return body;
        };
        const setProtection = async (symbol, sl, tp) => {
            if (!authToken)
                return null;
            const res = await queuedFetch(`${apiBase}${apiPrefix}/protection?net=${net}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ symbol, sl, tp, positionIdx: 0 }),
            }, "order");
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.ok === false) {
                throw new Error(body?.error || `Protection failed (${res.status})`);
            }
            const rc = body?.data?.retCode ?? body?.retCode;
            if (rc && rc !== 0)
                throw new Error(body?.data?.retMsg || body?.retMsg || "Protection rejected");
            return body;
        };
        const placeReduceOnlyMarket = async (symbol, side, qty) => {
            if (!authToken)
                return null;
            const res = await queuedFetch(`${apiBase}${apiPrefix}/order?net=${net}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                    symbol,
                    side,
                    qty,
                    orderType: "Market",
                    timeInForce: "IOC",
                    reduceOnly: true,
                }),
            }, "order");
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.ok === false) {
                throw new Error(body?.error || `Close failed (${res.status})`);
            }
            const rc = body?.data?.retCode ?? body?.retCode;
            if (rc && rc !== 0)
                throw new Error(body?.data?.retMsg || body?.retMsg || "Close rejected");
            return body;
        };
        const getOpenPos = (symbol) => activePositionsRef.current.find((p) => p.symbol === symbol && Math.abs(Number(p.size ?? p.qty ?? 0)) > 0);
        const computeOpenRiskUsd = () => openRiskUsd(activePositionsRef.current) + scalpReservedRiskUsdRef.current;
        const buildId = (symbol, side, htfBar, ltfBar) => `${symbol}:${side}:${htfBar}:${ltfBar}`;
        const handlePending = async (st, plannedAt, logTiming) => {
            const p = st.pending;
            if (!p)
                return false;
            const now = Date.now();
            // Global "no burst": per-symbol throttle
            if (now < st.nextAllowedAt)
                return false;
            if (p.stage === "READY_TO_PLACE") {
                if (!canPlaceOrders)
                    return false;
                if (scalpSafeRef.current)
                    return false;
                if (now < scalpGlobalCooldownUntilRef.current)
                    return false;
                if (st.htf && now < st.htf.blockedUntilBarOpenTime + CFG.htfCloseDelayMs)
                    return false;
                // Refresh BBO just before place to keep it fresh
                if (isBboStale(st.bbo, now, 1500)) {
                    logTiming("FETCH_BBO", "pre_place");
                    const bbo = await fetchBbo(p.symbol);
                    st.bbo = bbo;
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                logTiming("PLACE_LIMIT", "entry");
                try {
                    await placeLimit(p);
                }
                catch (err) {
                    scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                    st.pending = undefined;
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    addLog({ action: "ERROR", message: `PLACE_FAILED ${p.symbol} ${err?.message || "unknown"}` });
                    return true; // no retry
                }
                p.stage = "PLACED";
                p.statusCheckAt = now + CFG.orderStatusDelayMs;
                // "1 closed 1m candle" timeout aligned to bar close + delay
                const nextBarClose = Math.floor(now / 60_000) * 60_000 + 60_000;
                p.timeoutAt = nextBarClose + CFG.ltfCloseDelayMs;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                addLog({ action: "SYSTEM", message: `PLACE ${p.symbol} ${p.side} limit=${p.limitPrice} qty=${p.qty} id=${p.orderLinkId}` });
                return true;
            }
            if (p.stage === "PLACED") {
                if (now < p.statusCheckAt)
                    return false;
                logTiming("READ_ORDER", "status_check");
                const hist = await fetchOrderHistoryOnce(net);
                const found = hist.list.find((o) => {
                    const link = o.orderLinkId || o.orderLinkID || o.clientOrderId;
                    return o.symbol === p.symbol && link === p.orderLinkId;
                });
                if (found) {
                    const status = found.orderStatus || found.order_status || found.status;
                    const avg = Number(found.avgPrice ?? found.avg_price ?? found.price ?? p.limitPrice);
                    if (status === "Filled" || status === "PartiallyFilled") {
                        scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                        p.reservedRiskUsd = 0;
                        const entry = Number.isFinite(avg) && avg > 0 ? avg : p.limitPrice;
                        const dir = p.side === "Buy" ? 1 : -1;
                        const oneR = Math.abs(entry - p.sl);
                        const tick = st.instrument?.tickSize ?? 0;
                        p.oneR = oneR;
                        p.tp = Number.isFinite(tick) && tick > 0
                            ? roundToTick(entry + dir * CFG.tpR * oneR, tick)
                            : entry + dir * CFG.tpR * oneR;
                        p.stage = "FILLED_NEED_SL";
                        p.fillAt = now;
                        st.manage = {
                            symbol: p.symbol,
                            side: p.side,
                            entry,
                            qty: p.qty,
                            oneR,
                            partialTaken: false,
                            maxPrice: entry,
                            minPrice: entry,
                        };
                        addLog({ action: "SYSTEM", message: `FILL ${p.symbol} ${p.side} avg=${avg}` });
                    }
                    else if (status === "Cancelled" || status === "Rejected") {
                        scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                        st.pending = undefined;
                        addLog({ action: "SYSTEM", message: `ENTRY_ABORT ${p.symbol} status=${status}` });
                    }
                }
                // If still open and 1m bar done → cancel
                if (p.stage === "PLACED" && now >= p.timeoutAt) {
                    logTiming("CANCEL_SEND", "timeout");
                    await cancelOrderByLinkId(p.symbol, p.orderLinkId);
                    p.stage = "CANCEL_SENT";
                    p.cancelVerifyAt = now + CFG.postCancelVerifyDelayMs;
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    addLog({ action: "SYSTEM", message: `CANCEL ${p.symbol} id=${p.orderLinkId} reason=TIMEOUT` });
                    return true;
                }
                if (p.stage === "PLACED") {
                    p.statusCheckAt = now + CFG.orderStatusDelayMs;
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (p.stage === "CANCEL_SENT") {
                if (!p.cancelVerifyAt || now < p.cancelVerifyAt)
                    return false;
                p.stage = "CANCEL_VERIFY";
                return false;
            }
            if (p.stage === "CANCEL_VERIFY") {
                logTiming("CANCEL_VERIFY", "post_cancel_delay");
                const hist = await fetchOrderHistoryOnce(net);
                const found = hist.list.find((o) => {
                    const link = o.orderLinkId || o.orderLinkID || o.clientOrderId;
                    return o.symbol === p.symbol && link === p.orderLinkId;
                });
                const status = found?.orderStatus || found?.order_status || found?.status;
                if (status === "Cancelled" || status === "Rejected") {
                    scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                    st.pending = undefined;
                    addLog({ action: "SYSTEM", message: `CANCEL_OK ${p.symbol} id=${p.orderLinkId}` });
                }
                else {
                    p.cancelVerifyAt = now + CFG.postCancelVerifyDelayMs;
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (p.stage === "FILLED_NEED_SL") {
                if (!p.fillAt || now < p.fillAt + CFG.postFillDelayMs)
                    return false;
                logTiming("PLACE_SL", "post_fill_delay");
                try {
                    await setProtection(p.symbol, p.sl, undefined);
                }
                catch (err) {
                    p.stage = "SAFE_CLOSE";
                    p.taskReason = `SL_SET_FAILED:${err?.message || "unknown"}`;
                    scalpForceSafeUntilRef.current = Date.now() + 30 * 60_000; // 30m safe window
                    scalpSafeRef.current = true;
                    addLog({ action: "ERROR", message: `SAFE_MODE triggered (SL_SET_FAILED ${p.symbol})` });
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                p.stage = "SL_SENT";
                p.slVerifyAt = now + CFG.postSlVerifyDelayMs;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (p.stage === "SL_SENT") {
                if (!p.slVerifyAt || now < p.slVerifyAt)
                    return false;
                p.stage = "SL_VERIFY";
                return false;
            }
            if (p.stage === "SL_VERIFY") {
                logTiming("VERIFY_SL", "post_sl_delay");
                const posResp = await fetchPositionsOnce(net);
                const found = posResp.list.find((pp) => pp.symbol === p.symbol && Math.abs(Number(pp.size ?? 0)) > 0);
                const tol = Math.abs((currentPricesRef.current[p.symbol] ?? p.limitPrice) * 0.001) || 0.5;
                const ok = found && Math.abs(Number(found.stopLoss ?? 0) - p.sl) <= tol;
                if (!ok) {
                    const age = p.fillAt ? now - p.fillAt : Infinity;
                    if (age > 2000) {
                        p.stage = "SAFE_CLOSE";
                        p.taskReason = "SL_MISSING";
                        scalpForceSafeUntilRef.current = Date.now() + 30 * 60_000; // 30m safe window
                        scalpSafeRef.current = true;
                        addLog({ action: "ERROR", message: `SAFE_MODE triggered (SL missing ${p.symbol})` });
                    }
                    else {
                        p.slVerifyAt = now + CFG.postSlVerifyDelayMs;
                    }
                }
                else {
                    p.stage = "TP_SENT";
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (p.stage === "TP_SENT") {
                logTiming("PLACE_TP", "post_sl_verify");
                try {
                    await setProtection(p.symbol, undefined, p.tp);
                }
                catch (err) {
                    addLog({ action: "ERROR", message: `TP_SET_FAILED ${p.symbol} ${err?.message || "unknown"}` });
                    p.tpVerifyAt = now + CFG.postTpVerifyDelayMs;
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                p.stage = "TP_VERIFY";
                p.tpVerifyAt = now + CFG.postTpVerifyDelayMs;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (p.stage === "TP_VERIFY") {
                if (!p.tpVerifyAt || now < p.tpVerifyAt)
                    return false;
                logTiming("VERIFY_TP", "post_tp_delay");
                const posResp = await fetchPositionsOnce(net);
                const found = posResp.list.find((pp) => pp.symbol === p.symbol && Math.abs(Number(pp.size ?? 0)) > 0);
                const tol = Math.abs((currentPricesRef.current[p.symbol] ?? p.limitPrice) * 0.001) || 0.5;
                const ok = found && Math.abs(Number(found.takeProfit ?? 0) - p.tp) <= tol;
                if (ok) {
                    st.pending = undefined;
                    addLog({ action: "SYSTEM", message: `PROTECTION_OK ${p.symbol} SL/TP set` });
                }
                else {
                    p.tpVerifyAt = now + CFG.postTpVerifyDelayMs;
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (p.stage === "PARTIAL_EXIT") {
                if (!canPlaceOrders)
                    return false;
                const closeQty = p.closeQty ?? 0;
                if (!Number.isFinite(closeQty) || closeQty <= 0) {
                    st.pending = undefined;
                    return false;
                }
                const exitSide = p.side === "Buy" ? "Sell" : "Buy";
                try {
                    await placeReduceOnlyMarket(p.symbol, exitSide, closeQty);
                }
                catch (err) {
                    addLog({ action: "ERROR", message: `PARTIAL_FAILED ${p.symbol} ${err?.message || "unknown"}` });
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                if (st.manage)
                    st.manage.partialTaken = true;
                st.pending = undefined;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                addLog({ action: "SYSTEM", message: `PARTIAL ${p.symbol} qty=${closeQty}` });
                return true;
            }
            if (p.stage === "TRAIL_SL_UPDATE") {
                if (!canPlaceOrders)
                    return false;
                const newSl = p.newSl;
                if (!Number.isFinite(newSl)) {
                    st.pending = undefined;
                    return false;
                }
                try {
                    await setProtection(p.symbol, newSl, undefined);
                }
                catch (err) {
                    addLog({ action: "ERROR", message: `TRAIL_FAILED ${p.symbol} ${err?.message || "unknown"}` });
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                st.pending = undefined;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                addLog({ action: "SYSTEM", message: `TRAIL ${p.symbol} newSL=${newSl}` });
                return true;
            }
            if (p.stage === "SAFE_CLOSE") {
                const pos = getOpenPos(p.symbol);
                if (pos)
                    await forceClosePosition(pos);
                st.pending = undefined;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                addLog({ action: "ERROR", message: `SAFE_CLOSE ${p.symbol} reason=${p.taskReason || "UNKNOWN"}` });
                return true;
            }
            return false;
        };
        const processSymbol = async (symbol, plannedAt) => {
            const st = ensureSymbolState(symbol);
            const now = Date.now();
            const logTiming = (kind, reason) => {
                const ts = Date.now();
                addLog({
                    action: "SYSTEM",
                    message: `TIMING ${kind} ${symbol} delay=${ts - plannedAt}ms reason=${reason || "-"}`,
                });
            };
            // Global active-symbol lock: if jiný symbol je v PLACE/MANAGE/EXIT, čekáme.
            const engaged = Boolean(st.pending || st.manage);
            const locked = scalpActiveSymbolRef.current;
            if (locked && locked !== symbol) {
                if (engaged || now < scalpSymbolLockUntilRef.current)
                    return false;
            }
            if (!locked && engaged) {
                scalpActiveSymbolRef.current = symbol;
                scalpSymbolLockUntilRef.current = now + CFG.symbolFetchGapMs;
            }
            else if (locked === symbol && engaged) {
                scalpSymbolLockUntilRef.current = Math.max(scalpSymbolLockUntilRef.current, now + CFG.symbolFetchGapMs);
            }
            if (now < st.nextAllowedAt)
                return false;
            const paused = now < st.pausedUntil;
            if (st.pending) {
                const allowManage = paused ? st.pending.stage !== "READY_TO_PLACE" : true;
                const allowSafe = scalpSafeRef.current ? st.pending.stage !== "READY_TO_PLACE" : true;
                if (allowManage && allowSafe) {
                    const did = await handlePending(st, plannedAt, logTiming);
                    if (did)
                        return true;
                }
            }
            if (paused || scalpSafeRef.current)
                return false;
            // If position closed on exchange, clear manage state
            if (st.manage && !getOpenPos(symbol)) {
                st.manage = undefined;
            }
            // Instrument bootstrap
            if (!st.instrument) {
                logTiming("FETCH_INSTRUMENT", locked && locked !== symbol ? "lock" : undefined);
                const info = await fetchInstrument(symbol);
                st.instrument = info;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            // HTF update (15m) with close-delay
            const htfMs = 15 * 60_000;
            const expected15 = expectedOpenTime(now, htfMs, CFG.htfCloseDelayMs);
            if (!st.htf || st.htf.barOpenTime < expected15) {
                const conf = st.htfConfirm && st.htfConfirm.expectedOpenTime === expected15
                    ? st.htfConfirm
                    : { expectedOpenTime: expected15, stage: 0, attempts: 0 };
                logTiming("FETCH_HTF", st.htfConfirm ? "retry_confirm" : undefined);
                const candles = await fetchKlines(symbol, "15", 60);
                const last = candles[candles.length - 1];
                if (!last || last.openTime !== expected15) {
                    conf.attempts += 1;
                    st.htfConfirm = conf;
                    st.nextAllowedAt = now + 250;
                    if (conf.attempts >= 3) {
                        st.pausedUntil = now + 60_000;
                        st.pausedReason = "HTF_DATA_MISSING";
                    }
                    return true;
                }
                if (conf.stage === 0) {
                    conf.stage = 1;
                    conf.lastClose = last.close;
                    st.htfConfirm = conf;
                    st.nextAllowedAt = now + 250;
                    return true;
                }
                if (conf.lastClose !== last.close) {
                    conf.attempts += 1;
                    conf.lastClose = last.close;
                    st.htfConfirm = conf;
                    st.nextAllowedAt = now + 250;
                    return true;
                }
                st.htfConfirm = undefined;
                const stSeries = computeSuperTrend(candles, CFG.stHtf.atr, CFG.stHtf.mult);
                const dir = stSeries.dir[stSeries.dir.length - 1];
                const line = stSeries.line[stSeries.line.length - 1];
                const bias = dir === "UP" ? "LONG" : "SHORT";
                const prevDir = st.htf?.stDir;
                const flipped = prevDir && prevDir !== dir;
                // Flip handling: block entries for next 15m candle and cancel pending entries/signals
                const blockedUntil = flipped ? expected15 + htfMs : (st.htf?.blockedUntilBarOpenTime ?? 0);
                st.htf = { barOpenTime: expected15, stDir: dir, stLine: line, bias, blockedUntilBarOpenTime: blockedUntil };
                if (flipped) {
                    addLog({ action: "SYSTEM", message: `HTF_FLIP ${symbol} ${prevDir}→${dir} blockUntil=${new Date(blockedUntil).toISOString()}` });
                    logTiming("HTF_FLIP", "cancel_pending");
                    if (st.pending?.stage === "PLACED") {
                        st.pending.timeoutAt = now;
                        st.pending.taskReason = "HTF_FLIP";
                    }
                    else if (st.pending) {
                        scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (st.pending.reservedRiskUsd || 0));
                        st.pending = undefined;
                    }
                    // clear any manage state; do not open new entries until block lifts
                    st.manage = undefined;
                    setPendingSignals((prev) => prev.filter((s) => s.symbol !== symbol));
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            // LTF update (1m) with double-confirmation
            const ltfMs = 60_000;
            const expected1 = expectedOpenTime(now, ltfMs, CFG.ltfCloseDelayMs);
            if (!st.ltf || st.ltf.barOpenTime < expected1) {
                const conf = st.ltfConfirm && st.ltfConfirm.expectedOpenTime === expected1
                    ? st.ltfConfirm
                    : { expectedOpenTime: expected1, stage: 0, attempts: 0 };
                logTiming("FETCH_LTF", st.ltfConfirm ? "retry_confirm" : undefined);
                const candles = await fetchKlines(symbol, "1", 50);
                const last = candles[candles.length - 1];
                if (!last || last.openTime !== expected1) {
                    conf.attempts += 1;
                    st.ltfConfirm = conf;
                    st.nextAllowedAt = now + 250;
                    if (conf.attempts >= 3) {
                        st.pausedUntil = now + 60_000;
                        st.pausedReason = "LTF_DATA_MISSING";
                    }
                    return true;
                }
                const same = conf.lastClose === last.close &&
                    conf.lastHigh === last.high &&
                    conf.lastLow === last.low &&
                    conf.lastVolume === last.volume;
                if (conf.stage === 0) {
                    conf.stage = 1;
                    conf.lastClose = last.close;
                    conf.lastHigh = last.high;
                    conf.lastLow = last.low;
                    conf.lastVolume = last.volume;
                    st.ltfConfirm = conf;
                    st.nextAllowedAt = now + 250;
                    return true;
                }
                if (!same) {
                    conf.attempts += 1;
                    conf.lastClose = last.close;
                    conf.lastHigh = last.high;
                    conf.lastLow = last.low;
                    conf.lastVolume = last.volume;
                    st.ltfConfirm = conf;
                    st.nextAllowedAt = now + 250;
                    return true;
                }
                st.ltfConfirm = undefined;
                // Indicators
                const closes = candles.map((c) => c.close);
                const ema21 = scalpComputeEma(closes, CFG.emaPeriod).slice(-1)[0] ?? last.close;
                const atr14 = scalpComputeAtr(candles, CFG.atrPeriod).slice(-1)[0] ?? 0;
                const volSma20 = scalpComputeSma(candles.map((c) => c.volume), 20).slice(-1)[0] ?? last.volume;
                const rvol = volSma20 > 0 ? last.volume / volSma20 : 0;
                const stSeries = computeSuperTrend(candles, CFG.stLtf.atr, CFG.stLtf.mult);
                const stDir = stSeries.dir[stSeries.dir.length - 1];
                const prevStDir = stSeries.dir[stSeries.dir.length - 2] ?? stDir;
                const stLine = stSeries.line[stSeries.line.length - 1];
                priceHistoryRef.current = { ...priceHistoryRef.current, [symbol]: candles };
                setCurrentPrices((prev) => {
                    const next = { ...prev, [symbol]: last.close };
                    currentPricesRef.current = next;
                    return next;
                });
                dataUnavailableRef.current = false;
                setSystemState((p) => ({ ...p, bybitStatus: "Connected", lastError: null }));
                st.ltf = {
                    barOpenTime: expected1,
                    candles: candles,
                    stDir,
                    prevStDir,
                    stLine,
                    ema21,
                    atr14,
                    smaVol20: volSma20,
                    rvol,
                    last: last,
                };
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            // Manage tasks (partial / trailing) based on current LTF close
            if (st.manage && st.instrument && st.ltf) {
                const pos = getOpenPos(symbol);
                if (pos) {
                    const dir = st.manage.side === "Buy" ? 1 : -1;
                    const px = st.ltf.last.close;
                    const hi = st.ltf.last.high;
                    const lo = st.ltf.last.low;
                    st.manage.maxPrice = Math.max(st.manage.maxPrice, hi);
                    st.manage.minPrice = Math.min(st.manage.minPrice, lo);
                    const profit = (px - st.manage.entry) * dir;
                    const r = st.manage.oneR || Math.abs(st.manage.entry - (pos.sl ?? st.manage.entry));
                    if (r > 0) {
                        if (!st.manage.partialTaken && profit >= CFG.partialAtR * r) {
                            const closeQtyRaw = st.manage.qty * CFG.partialFrac;
                            const closeQty = roundDownToStep(closeQtyRaw, st.instrument.stepSize);
                            if (closeQty >= st.instrument.minQty) {
                                st.pending = {
                                    stage: "PARTIAL_EXIT",
                                    orderLinkId: `partial:${symbol}:${expected1}`,
                                    symbol,
                                    side: st.manage.side,
                                    limitPrice: 0,
                                    qty: st.manage.qty,
                                    closeQty,
                                    sl: 0,
                                    tp: 0,
                                    oneR: r,
                                    reservedRiskUsd: 0,
                                    htfBarOpenTime: st.htf?.barOpenTime ?? 0,
                                    ltfBarOpenTime: st.ltf.barOpenTime,
                                    createdAt: now,
                                    statusCheckAt: now,
                                    timeoutAt: now,
                                };
                                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                                return true;
                            }
                        }
                        if (profit >= CFG.trailActivateR * r) {
                            const currentSl = Number(pos.sl ?? 0) || 0;
                            const newSlRaw = st.manage.side === "Buy"
                                ? st.manage.maxPrice - CFG.trailRetraceR * r
                                : st.manage.minPrice + CFG.trailRetraceR * r;
                            const newSl = roundToTick(newSlRaw, st.instrument.tickSize);
                            const improves = st.manage.side === "Buy" ? newSl > currentSl : newSl < currentSl;
                            if (Number.isFinite(newSl) && improves) {
                                st.pending = {
                                    stage: "TRAIL_SL_UPDATE",
                                    orderLinkId: `trail:${symbol}:${expected1}`,
                                    symbol,
                                    side: st.manage.side,
                                    limitPrice: 0,
                                    qty: st.manage.qty,
                                    newSl,
                                    sl: 0,
                                    tp: 0,
                                    oneR: r,
                                    reservedRiskUsd: 0,
                                    htfBarOpenTime: st.htf?.barOpenTime ?? 0,
                                    ltfBarOpenTime: st.ltf.barOpenTime,
                                    createdAt: now,
                                    statusCheckAt: now,
                                    timeoutAt: now,
                                };
                                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                                return true;
                            }
                        }
                    }
                }
            }
            // Entry scan (signal + execution separated)
            if (!st.htf || !st.ltf || !st.instrument)
                return false;
            if (st.ltfLastScanBarOpenTime === st.ltf.barOpenTime)
                return false;
            if (scalpSafeRef.current)
                return false;
            if (now < scalpGlobalCooldownUntilRef.current)
                return false;
            if (st.htf.bias === "NONE")
                return false;
            if (now < st.htf.blockedUntilBarOpenTime + CFG.htfCloseDelayMs)
                return false;
            const hasPending = Boolean(st.pending);
            const hasOpenPos = Boolean(getOpenPos(symbol));
            const isLong = st.htf.bias === "LONG";
            const wantsDir = isLong ? "UP" : "DOWN";
            // Signal purely z OHLCV/indikátorů
            const flipped = st.ltf.prevStDir !== st.ltf.stDir && st.ltf.stDir === wantsDir;
            const touchBand = Math.max(2 * st.instrument.tickSize, CFG.touchBandAtrFrac * st.ltf.atr14);
            const closeToEma = Math.abs(st.ltf.last.close - st.ltf.ema21) <= touchBand;
            const touched = isLong ? st.ltf.last.low <= st.ltf.ema21 + touchBand : st.ltf.last.high >= st.ltf.ema21 - touchBand;
            const closeVsSt = isLong ? st.ltf.last.close > st.ltf.stLine : st.ltf.last.close < st.ltf.stLine;
            const htfProj = isLong ? st.ltf.last.close > st.htf.stLine : st.ltf.last.close < st.htf.stLine;
            const rvolOk = st.ltf.rvol >= CFG.rvolMin;
            const range = st.ltf.last.high - st.ltf.last.low;
            const body = Math.abs(st.ltf.last.close - st.ltf.last.open);
            const antiBreakout = !(range >= CFG.antiBreakoutRangeAtr * st.ltf.atr14) && !(range > 0 && body >= CFG.antiBreakoutBodyFrac * range);
            const signalActive = flipped && (closeToEma || touched) && closeVsSt && htfProj && rvolOk && antiBreakout;
            // BBO needed only when signal active or we have pending/position, but always bootstrap if missing
            const needBbo = !st.bbo || signalActive || hasPending || hasOpenPos;
            if (needBbo && isBboStale(st.bbo, now, 1500)) {
                const reason = st.bbo ? "stale" : "bootstrap";
                if (reason === "stale") {
                    const last = staleBboLogRef.current[symbol] ?? 0;
                    if (now - last > 2000) {
                        logTiming("FETCH_BBO", reason);
                        staleBboLogRef.current[symbol] = now;
                    }
                }
                else {
                    logTiming("FETCH_BBO", reason);
                }
                const bbo = await fetchBbo(symbol);
                st.bbo = bbo;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const bboAgeMs = st.bbo ? now - st.bbo.ts : Infinity;
            const executionAllowed = !isBboStale(st.bbo, now, 1500);
            addLog({
                action: "SIGNAL",
                message: `SCALP ${symbol} signal=${signalActive ? "ACTIVE" : "NONE"} execAllowed=${executionAllowed} bboAge=${Number.isFinite(bboAgeMs) ? bboAgeMs.toFixed(0) : "inf"}ms`,
            });
            if (!signalActive) {
                st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (!executionAllowed) {
                if (bboAgeMs > 10_000) {
                    st.pausedUntil = now + 5_000;
                    st.pausedReason = "PAUSED_DATA_STALE";
                    addLog({ action: "SYSTEM", message: `PAUSE ${symbol} DATA_STALE age=${Number.isFinite(bboAgeMs) ? bboAgeMs.toFixed(0) : "inf"}ms` });
                }
                // signal držíme, čekáme na čerstvé BBO v dalším ticku (bez posunu scan markeru)
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            // Execution guardrails (spread/ATR)
            const sp = spreadPct(st.bbo.bid, st.bbo.ask);
            if (sp > CFG.spreadMaxPct) {
                st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const atrPct = st.ltf.atr14 > 0 ? st.ltf.atr14 / Math.max(1e-8, st.ltf.last.close) : 0;
            if (atrPct < CFG.lowAtrMinPct) {
                st.pausedUntil = now + 30 * 60 * 1000;
                st.pausedReason = "STOP_LOW_ATR";
                st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            // Build limit price (maker-first)
            const offset = Math.max(2 * st.instrument.tickSize, CFG.offsetAtrFrac * st.ltf.atr14);
            const limitRaw = isLong
                ? Math.min(st.bbo.ask - st.instrument.tickSize, st.bbo.bid + offset)
                : Math.max(st.bbo.bid + st.instrument.tickSize, st.bbo.ask - offset);
            const limit = roundToTick(limitRaw, st.instrument.tickSize);
            if (isLong && limit >= st.bbo.ask) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (!isLong && limit <= st.bbo.bid) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            // SL from micro swing (L=3,R=3), fallback to ST line
            const slBuf = Math.max(st.instrument.tickSize, CFG.slBufferAtrFrac * st.ltf.atr14);
            const pivotLow = findLastPivotLow(st.ltf.candles, 3, 3);
            const pivotHigh = findLastPivotHigh(st.ltf.candles, 3, 3);
            let sl = isLong ? (pivotLow != null ? pivotLow - slBuf : st.ltf.stLine - slBuf) : (pivotHigh != null ? pivotHigh + slBuf : st.ltf.stLine + slBuf);
            sl = roundToTick(sl, st.instrument.tickSize);
            if (isLong && sl >= limit)
                sl = roundToTick(st.ltf.stLine - slBuf, st.instrument.tickSize);
            if (!isLong && sl <= limit)
                sl = roundToTick(st.ltf.stLine + slBuf, st.instrument.tickSize);
            if (isLong && sl >= limit) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (!isLong && sl <= limit) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const oneR = Math.abs(limit - sl);
            if (!Number.isFinite(oneR) || oneR <= 0) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const tp = roundToTick(isLong ? limit + CFG.tpR * oneR : limit - CFG.tpR * oneR, st.instrument.tickSize);
            // Risk sizing (4/8 USDT) with reservation
            const openRisk = computeOpenRiskUsd();
            const riskTarget = Math.min(4, Math.max(0, 8 - openRisk));
            if (riskTarget <= 0) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const qtyRaw = riskTarget / (oneR * Math.max(1e-8, st.instrument.contractValue));
            const qty = roundDownToStep(qtyRaw, st.instrument.stepSize);
            if (!Number.isFinite(qty) || qty < st.instrument.minQty) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const reservedRiskUsd = oneR * qty * st.instrument.contractValue;
            if (reservedRiskUsd > 4 + 1e-6 || openRisk + reservedRiskUsd > 8 + 1e-6) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const openCount = activePositionsRef.current.filter((p) => {
                if (!SYMBOLS.includes(p.symbol))
                    return false;
                return Math.abs(Number(p.size ?? p.qty ?? 0)) > 0;
            }).length;
            if (openCount >= 2) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const side = isLong ? "Buy" : "Sell";
            const id = buildId(symbol, side, st.htf.barOpenTime, st.ltf.barOpenTime);
            const recent = scalpRecentIdsRef.current.get(id);
            if (recent && now - recent <= CFG.maxRecentIdWindowMs) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            scalpRecentIdsRef.current.set(id, now);
            const gates = [
                { name: "SPREAD", result: "PASS" },
                { name: "HTF_BIAS", result: "PASS" },
                { name: "LTF_FLIP", result: "PASS" },
                { name: "PULLBACK", result: "PASS" },
                { name: "RVOL", result: "PASS" },
            ];
            logAuditEntry("SIGNAL", symbol, "SCAN", gates, canPlaceOrders ? "TRADE" : "DENY", "SCALP_SIGNAL", { entry: limit, sl, tp }, { notional: limit * qty, leverage: leverageFor(symbol) });
            st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
            if (canPlaceOrders) {
                // Reserve risk only for actual pending entry orders
                scalpReservedRiskUsdRef.current += reservedRiskUsd;
                st.pending = {
                    stage: "READY_TO_PLACE",
                    orderLinkId: id,
                    symbol,
                    side,
                    limitPrice: limit,
                    qty,
                    sl,
                    tp,
                    oneR,
                    reservedRiskUsd,
                    htfBarOpenTime: st.htf.barOpenTime,
                    ltfBarOpenTime: st.ltf.barOpenTime,
                    createdAt: now,
                    statusCheckAt: now + CFG.orderStatusDelayMs,
                    timeoutAt: now + 60_000,
                };
            }
            st.nextAllowedAt = now + CFG.symbolFetchGapMs;
            const stillEngaged = Boolean(st.pending || st.manage);
            if (!stillEngaged && scalpActiveSymbolRef.current === symbol && now >= scalpSymbolLockUntilRef.current) {
                scalpActiveSymbolRef.current = null;
            }
            return true;
        };
        const tick = async () => {
            if (cancel)
                return;
            if (scalpBusyRef.current)
                return;
            scalpBusyRef.current = true;
            try {
                const tickStarted = Date.now();
                cleanupRecentIds();
                const safeNow = getApiErrorRate() > 0.05 || scalpForceSafeUntilRef.current > Date.now();
                if (safeNow !== scalpSafeRef.current) {
                    scalpSafeRef.current = safeNow;
                    addLog({
                        action: safeNow ? "ERROR" : "SYSTEM",
                        message: safeNow ? "SAFE_MODE: api error-rate > 5% (last 50)" : "SAFE_MODE cleared",
                    });
                    if (safeNow) {
                        const now = Date.now();
                        for (const sym of SYMBOLS) {
                            const st = ensureSymbolState(sym);
                            const p = st.pending;
                            if (!p)
                                continue;
                            if (p.stage === "READY_TO_PLACE") {
                                scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                                st.pending = undefined;
                            }
                            else if (p.stage === "PLACED") {
                                p.timeoutAt = now;
                                p.taskReason = "SAFE_MODE";
                            }
                        }
                    }
                }
                const now = Date.now();
                const isSymbolReady = (sym) => {
                    const st = ensureSymbolState(sym);
                    return now >= st.nextAllowedAt && now >= st.pausedUntil;
                };
                // Urgent pending tasks always first
                let urgent = null;
                for (const sym of SYMBOLS) {
                    if (scalpActiveSymbolRef.current && scalpActiveSymbolRef.current !== sym)
                        continue;
                    const st = ensureSymbolState(sym);
                    const p = st.pending;
                    if (!p)
                        continue;
                    const due = p.stage === "READY_TO_PLACE" ||
                        p.stage === "PARTIAL_EXIT" ||
                        p.stage === "TRAIL_SL_UPDATE" ||
                        p.stage === "SAFE_CLOSE" ||
                        (p.stage === "PLACED" && (now >= p.statusCheckAt || now >= p.timeoutAt)) ||
                        (p.stage === "CANCEL_SENT" && p.cancelVerifyAt != null && now >= p.cancelVerifyAt) ||
                        p.stage === "CANCEL_VERIFY" ||
                        (p.stage === "FILLED_NEED_SL" && p.fillAt != null && now >= p.fillAt + CFG.postFillDelayMs) ||
                        (p.stage === "SL_SENT" && p.slVerifyAt != null && now >= p.slVerifyAt) ||
                        p.stage === "SL_VERIFY" ||
                        p.stage === "TP_SENT" ||
                        (p.stage === "TP_VERIFY" && p.tpVerifyAt != null && now >= p.tpVerifyAt);
                    if (due && isSymbolReady(sym)) {
                        urgent = sym;
                        break;
                    }
                }
                const htfMs = 15 * 60_000;
                const ltfMs = 60_000;
                const expectedHtf = expectedOpenTime(now, htfMs, CFG.htfCloseDelayMs);
                const expectedLtf = expectedOpenTime(now, ltfMs, CFG.ltfCloseDelayMs);
                const htfDue = SYMBOLS.find((sym) => {
                    if (scalpActiveSymbolRef.current && scalpActiveSymbolRef.current !== sym)
                        return false;
                    const st = ensureSymbolState(sym);
                    if (!isSymbolReady(sym))
                        return false;
                    return !st.htf || st.htf.barOpenTime < expectedHtf || (st.htfConfirm && st.htfConfirm.expectedOpenTime === expectedHtf);
                });
                const ltfDue = SYMBOLS.find((sym) => {
                    if (scalpActiveSymbolRef.current && scalpActiveSymbolRef.current !== sym)
                        return false;
                    const st = ensureSymbolState(sym);
                    if (!isSymbolReady(sym))
                        return false;
                    return !st.ltf || st.ltf.barOpenTime < expectedLtf || (st.ltfConfirm && st.ltfConfirm.expectedOpenTime === expectedLtf);
                });
                const idx = scalpRotationIdxRef.current;
                let rotated = SYMBOLS[idx % SYMBOLS.length];
                scalpRotationIdxRef.current = idx + 1;
                if (scalpActiveSymbolRef.current)
                    rotated = scalpActiveSymbolRef.current;
                const target = urgent || htfDue || ltfDue || rotated;
                await processSymbol(target, tickStarted);
            }
            catch (err) {
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Error",
                    lastError: err?.message || "scalp tick error",
                    recentErrors: [err?.message || "scalp tick error", ...p.recentErrors].slice(0, 10),
                }));
            }
            finally {
                scalpBusyRef.current = false;
            }
        };
        const id = setInterval(() => void tick(), CFG.tickMs);
        void tick();
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [mode, useTestnet, httpBase, authToken, apiBase, apiPrefix, queuedFetch, fetchOrderHistoryOnce, fetchPositionsOnce, forceClosePosition]);
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
                const res = await queuedFetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                }, "data");
                if (!res.ok)
                    return;
                const json = await res.json();
                const list = json?.data?.result?.list || json?.result?.list || [];
                const cursor = json?.data?.result?.nextPageCursor || json?.result?.nextPageCursor;
                const seen = processedExecIdsRef.current;
                const allowedSymbols = new Set(SYMBOLS);
                const nowMs = Date.now();
                const freshMs = 5 * 60 * 1000; // show only last 5 minutes
                list.forEach((e) => {
                    const id = e.execId || e.tradeId;
                    if (!id || seen.has(id))
                        return;
                    if (e.symbol && !allowedSymbols.has(e.symbol))
                        return;
                    seen.add(id);
                    const execTs = e.execTime ? Number(e.execTime) : Date.now();
                    if (!Number.isFinite(execTs))
                        return;
                    const isFresh = nowMs - execTs <= freshMs;
                    if (!isFresh)
                        return;
                    executionEventsRef.current = [
                        {
                            id,
                            symbol: e.symbol || "",
                            orderId: e.orderId || e.orderID || e.clOrdId,
                            orderLinkId: e.orderLinkId || e.orderLinkID || e.clientOrderId,
                            price: Number(e.execPrice ?? e.price ?? 0),
                            qty: Number(e.execQty ?? e.qty ?? 0),
                            time: new Date(execTs).toISOString(),
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
        const profile = signal.profile && (signal.profile === "scalp" ||
            signal.profile === "intraday" ||
            signal.profile === "swing" ||
            signal.profile === "trend" ||
            signal.profile === "coach")
            ? signal.profile
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
                        const res = await queuedFetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${authToken}`
                            },
                            body: JSON.stringify(payload)
                        }, "order");
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
        const basePreset = presetFor(incomingMode);
        // If risk mode changes, snap to the preset for that mode (no mix of previous settings).
        // Otherwise merge incremental updates on top of the current state.
        const patched = incomingMode !== settingsRef.current.riskMode
            ? { ...basePreset, riskMode: incomingMode }
            : { ...settingsRef.current, ...newS, riskMode: incomingMode };
        // Hard clamp max open positions
        const normalized = { ...patched, maxOpenPositions: Math.min(2, patched.maxOpenPositions ?? 2) };
        setSettings(normalized);
        settingsRef.current = normalized;
        persistSettings(normalized);
        setPortfolioState((p) => {
            const maxAlloc = p.totalCapital * normalized.maxAllocatedCapitalPercent;
            return {
                ...p,
                maxOpenPositions: normalized.maxOpenPositions,
                maxAllocatedCapital: maxAlloc,
                allocatedCapital: Math.min(p.allocatedCapital, maxAlloc),
                maxDailyLoss: p.totalCapital * normalized.maxDailyLossPercent,
                maxDailyProfit: p.totalCapital * normalized.maxDailyProfitPercent,
                maxDrawdown: normalized.maxDrawdownPercent,
            };
        });
    };
    const removeEntryHistoryItem = (id) => {
        setEntryHistory(() => removeEntryFromHistory(id));
    };
    const resetPnlHistory = () => {
        setAssetPnlHistory(() => clearPnlHistory());
        realizedPnlRef.current = 0;
        manualPnlResetRef.current = Date.now();
        closedPnlSeenRef.current = new Set();
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
