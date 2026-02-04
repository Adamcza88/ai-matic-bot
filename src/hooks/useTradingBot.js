// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi.js";
import { getApiBase } from "../engine/networkConfig.js";
import { startPriceFeed } from "../engine/priceFeed.js";
import { evaluateStrategyForSymbol, resampleCandles, computeATR } from "../engine/botEngine.js";
import { evaluateAiMaticXStrategyForSymbol, } from "../engine/aiMaticXStrategy.js";
import { evaluateAiMaticProStrategyForSymbol } from "../engine/aiMaticProStrategy.js";
import { evaluateHTFMultiTrend } from "../engine/htfTrendFilter.js";
import { computeEma, computeRsi, findPivotsHigh, findPivotsLow } from "../engine/ta.js";
import { CandlestickAnalyzer } from "../engine/universal-candlestick-analyzer.js";
import { computeMarketProfile } from "../engine/marketProfile.js";
import { updateOpenInterest } from "../engine/orderflow.js";
import { TradingMode } from "../types.js";
import { SUPPORTED_SYMBOLS, filterSupportedSymbols, } from "../constants/symbols.js";
import { loadPnlHistory, mergePnlRecords, resetPnlHistoryMap, } from "../lib/pnlHistory.js";
const SETTINGS_STORAGE_KEY = "ai-matic-settings";
const LOG_DEDUPE_WINDOW_MS = 1500;
const FEED_AGE_OK_MS = 60_000;
const MIN_POSITION_NOTIONAL_USD = 100;
const MAX_POSITION_NOTIONAL_USD = 10000;
const ORDER_VALUE_BY_SYMBOL = {
    BTCUSDT: 10000,
    ETHUSDT: 10000,
    SOLUSDT: 10000,
    ADAUSDT: 7500,
    XRPUSDT: 7500,
    SUIUSDT: 5000,
    DOGEUSDT: 7500,
    LINKUSDT: 5000,
    ZILUSDT: 2500,
    AVAXUSDT: 5000,
    HYPEUSDT: 7500,
    OPUSDT: 5000,
};
const MAJOR_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
const CORE_V2_RISK_PCT = {
    "ai-matic": 0.004,
    "ai-matic-x": 0.003,
    "ai-matic-scalp": 0.0025,
    "ai-matic-tree": 0.003,
    "ai-matic-pro": 0.003,
};
const CORE_V2_COOLDOWN_MS = {
    "ai-matic": 0,
    "ai-matic-x": 0,
    "ai-matic-scalp": 0,
    "ai-matic-tree": 0,
    "ai-matic-pro": 0,
};
const CORE_V2_VOLUME_PCTL = {
    "ai-matic": 60,
    "ai-matic-x": 70,
    "ai-matic-scalp": 50,
    "ai-matic-tree": 65,
    "ai-matic-pro": 65,
};
const CORE_V2_SCORE_GATE = {
    "ai-matic": { major: 11, alt: 12 },
    "ai-matic-x": { major: 12, alt: 13 },
    "ai-matic-scalp": { major: 10, alt: 99 },
    "ai-matic-tree": { major: 11, alt: 13 },
    "ai-matic-pro": { major: 10, alt: 10 },
};
const MIN_CHECKLIST_PASS = 8;
const REENTRY_COOLDOWN_MS = 15000;
const SIGNAL_LOG_THROTTLE_MS = 10000;
const SKIP_LOG_THROTTLE_MS = 10000;
const INTENT_COOLDOWN_MS = 8000;
const ENTRY_ORDER_LOCK_MS = 20000;
const CORE_V2_EMA_SEP1_MIN = 0.18;
const CORE_V2_EMA_SEP2_MIN = 0.12;
const CORE_V2_ATR_MIN_PCT_MAJOR = 0.0012;
const CORE_V2_ATR_MIN_PCT_ALT = 0.0018;
const CORE_V2_HTF_BUFFER_PCT = 0.001;
const CORE_V2_NOTIONAL_CAP_PCT = 0.01;
const CORE_V2_BBO_AGE_BY_SYMBOL = {
    BTCUSDT: 800,
    ETHUSDT: 800,
    SOLUSDT: 700,
};
const CORE_V2_BBO_AGE_DEFAULT_MS = 1000;
const SCALP_PRIMARY_GATE = "Primary Timeframe: 15m for trend, 1m for entry.";
const SCALP_ENTRY_GATE = "Entry Logic: Fibo retracement + 1 confirmation (OB/GAP/VP/EMA TL).";
const SCALP_EXIT_GATE = "Exit Logic: Fibo extension TP (dynamic) or ATR trailing (2.5x).";
const MAX_OPEN_POSITIONS_CAP = 10000;
const ORDERS_PER_POSITION = 5;
const MAX_OPEN_ORDERS_CAP = MAX_OPEN_POSITIONS_CAP * ORDERS_PER_POSITION;
const TS_VERIFY_INTERVAL_MS = 180_000;
const TREND_GATE_STRONG_ADX = 25;
const TREND_DAY_ADX_MIN = 20;
const TREND_GATE_STRONG_SCORE = 3;
const TREND_GATE_REVERSE_ADX = 19;
const TREND_GATE_REVERSE_SCORE = 1;
const HTF_TIMEFRAMES_MIN = [60, 240, 1440];
const AI_MATIC_HTF_TIMEFRAMES_MIN = [60, 15];
const AI_MATIC_LTF_TIMEFRAMES_MIN = [5, 1];
const SCALP_LTF_TIMEFRAMES_MIN = [5, 1];
const DEFAULT_AUTO_REFRESH_MINUTES = 3;
const EMA_TREND_PERIOD = 50;
const EMA_TREND_CONFIRM_BARS = 2;
const EMA_TREND_TOUCH_LOOKBACK = 2;
const EMA_TREND_TIMEFRAMES_MIN = [60, 15, 5];
const SCALP_EMA_PERIOD = 21;
const SCALP_SWING_LOOKBACK = 2;
const SCALP_EMA_FLAT_PCT = 0.02;
const SCALP_EMA_CROSS_LOOKBACK = 6;
const SCALP_SL_ATR_BUFFER = 0.3;
const SCALP_FIB_LEVELS = [0.382, 0.5, 0.618];
const SCALP_FIB_EXT = [0.618, 1.0, 1.618];
const SCALP_FIB_TOL_ATR = 0.2;
const SCALP_FIB_TOL_PCT = 0.0005;
const NONSCALP_PARTIAL_TAKE_R = 1.0;
const NONSCALP_PARTIAL_FRACTION = 0.35;
const NONSCALP_PARTIAL_COOLDOWN_MS = 60_000;
const AI_MATIC_HARD_MIN = 3;
const AI_MATIC_ENTRY_FACTOR_MIN = 1;
const AI_MATIC_CHECKLIST_MIN = 3;
const AI_MATIC_EMA_CROSS_LOOKBACK = 6;
const AI_MATIC_POI_DISTANCE_PCT = 0.0015;
const AI_MATIC_SL_ATR_BUFFER = 0.3;
const AI_MATIC_TRAIL_ATR_MULT = 1.5;
const AI_MATIC_MIN_RR = 1.2;
const AI_MATIC_TRAIL_ACTIVATE_PCT = 0.01;
const AI_MATIC_TRAIL_RETRACE_PCT = 0.006;
const AI_MATIC_TP1_PCT_MIN = 0.009;
const AI_MATIC_TP1_PCT_MAX = 0.012;
const AI_MATIC_RSI_OVERSOLD = 35;
const AI_MATIC_RSI_OVERBOUGHT = 70;
const AI_MATIC_LIQ_SWEEP_LOOKBACK = 15;
const AI_MATIC_LIQ_SWEEP_ATR_MULT = 0.5;
const AI_MATIC_LIQ_SWEEP_VOL_MULT = 1.0;
const AI_MATIC_BREAK_RETEST_LOOKBACK = 6;
const DEFAULT_SETTINGS = {
    riskMode: "ai-matic",
    trendGateMode: "adaptive",
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    enableHardGates: true,
    enableSoftGates: true,
    entryStrictness: "base",
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    autoRefreshEnabled: false,
    autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
    maxOpenPositions: 5,
    maxOpenOrders: 16,
    selectedSymbols: [...SUPPORTED_SYMBOLS],
    requireConfirmationInAuto: false,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    makerFeePct: 0.01,
    takerFeePct: 0.06,
    slippageBufferPct: 0.02,
};
function loadStoredSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        const merged = { ...DEFAULT_SETTINGS, ...parsed };
        if (merged.trendGateMode !== "adaptive" &&
            merged.trendGateMode !== "follow" &&
            merged.trendGateMode !== "reverse") {
            merged.trendGateMode = "adaptive";
        }
        if (typeof merged.autoRefreshEnabled !== "boolean") {
            merged.autoRefreshEnabled = DEFAULT_SETTINGS.autoRefreshEnabled;
        }
        if (!Number.isFinite(merged.autoRefreshMinutes)) {
            merged.autoRefreshMinutes = DEFAULT_SETTINGS.autoRefreshMinutes;
        }
        else {
            merged.autoRefreshMinutes = Math.max(1, Math.round(merged.autoRefreshMinutes));
        }
        if (!Number.isFinite(merged.maxOpenPositions)) {
            merged.maxOpenPositions = DEFAULT_SETTINGS.maxOpenPositions;
        }
        else {
            merged.maxOpenPositions = Math.min(MAX_OPEN_POSITIONS_CAP, Math.max(0, Math.round(merged.maxOpenPositions)));
        }
        if (!Number.isFinite(merged.maxOpenOrders)) {
            merged.maxOpenOrders = DEFAULT_SETTINGS.maxOpenOrders;
        }
        else {
            merged.maxOpenOrders = Math.min(MAX_OPEN_ORDERS_CAP, Math.max(0, Math.round(merged.maxOpenOrders)));
        }
        if (!Number.isFinite(merged.makerFeePct) || merged.makerFeePct < 0) {
            merged.makerFeePct = DEFAULT_SETTINGS.makerFeePct;
        }
        if (!Number.isFinite(merged.takerFeePct) || merged.takerFeePct < 0) {
            merged.takerFeePct = DEFAULT_SETTINGS.takerFeePct;
        }
        if (!Number.isFinite(merged.slippageBufferPct) || merged.slippageBufferPct < 0) {
            merged.slippageBufferPct = DEFAULT_SETTINGS.slippageBufferPct;
        }
        const selectedSymbols = filterSupportedSymbols(merged.selectedSymbols);
        merged.selectedSymbols =
            selectedSymbols.length > 0
                ? selectedSymbols
                : [...DEFAULT_SETTINGS.selectedSymbols];
        return merged;
    }
    catch {
        return null;
    }
}
function persistSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
    catch {
        // ignore storage errors
    }
}
function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
}
function resolveOrderNotional(symbol) {
    const value = ORDER_VALUE_BY_SYMBOL[symbol];
    if (Number.isFinite(value) && value > 0)
        return value;
    return MIN_POSITION_NOTIONAL_USD;
}
function evaluateEmaMultiTrend(candles, opts) {
    const timeframes = opts?.timeframesMin ?? EMA_TREND_TIMEFRAMES_MIN;
    const emaPeriod = opts?.emaPeriod ?? EMA_TREND_PERIOD;
    const touchLookback = Math.max(1, opts?.touchLookback ?? EMA_TREND_TOUCH_LOOKBACK);
    const confirmBars = Math.max(1, opts?.confirmBars ?? EMA_TREND_CONFIRM_BARS);
    const byTimeframe = timeframes.map((tf) => {
        const sampled = resampleCandles(candles, tf);
        const minBars = Math.max(emaPeriod, touchLookback, confirmBars + 1);
        if (!sampled.length || sampled.length < minBars) {
            return {
                timeframeMin: tf,
                direction: "none",
                ema: Number.NaN,
                close: Number.NaN,
                touched: false,
                confirmed: false,
            };
        }
        const closes = sampled.map((c) => c.close);
        const emaArr = computeEma(closes, emaPeriod);
        const emaNow = emaArr[emaArr.length - 1];
        const close = closes[closes.length - 1];
        const direction = close > emaNow ? "bull" : close < emaNow ? "bear" : "none";
        let touched = false;
        const touchStart = Math.max(0, sampled.length - touchLookback);
        for (let i = touchStart; i < sampled.length; i++) {
            const candle = sampled[i];
            const emaAt = emaArr[i];
            if (!candle || !Number.isFinite(emaAt))
                continue;
            if (candle.low <= emaAt && candle.high >= emaAt) {
                touched = true;
                break;
            }
        }
        let confirmed = true;
        if (touched) {
            if (direction === "none") {
                confirmed = false;
            }
            else {
                const confirmStart = Math.max(0, sampled.length - confirmBars);
                for (let i = confirmStart; i < sampled.length; i++) {
                    const candle = sampled[i];
                    const emaAt = emaArr[i];
                    if (!candle || !Number.isFinite(emaAt)) {
                        confirmed = false;
                        break;
                    }
                    if (direction === "bull" && candle.close <= emaAt) {
                        confirmed = false;
                        break;
                    }
                    if (direction === "bear" && candle.close >= emaAt) {
                        confirmed = false;
                        break;
                    }
                }
            }
        }
        return {
            timeframeMin: tf,
            direction,
            ema: emaNow,
            close,
            touched,
            confirmed,
        };
    });
    const bull = byTimeframe.filter((t) => t.direction === "bull").length;
    const bear = byTimeframe.filter((t) => t.direction === "bear").length;
    const consensus = bull === timeframes.length
        ? "bull"
        : bear === timeframes.length
            ? "bear"
            : "none";
    const alignedCount = Math.max(bull, bear);
    const tags = [];
    if (consensus !== "none")
        tags.push(`ALIGN_${consensus.toUpperCase()}`);
    if (byTimeframe.some((t) => t.touched && !t.confirmed)) {
        tags.push("TOUCH_UNCONFIRMED");
    }
    return { consensus, alignedCount, byTimeframe, tags };
}

const toAnalyzerCandles = (candles) => candles.map((c, idx) => ({
    time: Number.isFinite(c.openTime) ? c.openTime : idx * 60_000,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
}));

const resolveAiMaticHtfDirection = (decision, core) => {
    const consensus = String(decision?.htfTrend?.consensus ?? "").toLowerCase();
    if (consensus === "bull" || consensus === "bear")
        return consensus;
    const bias = core?.htfBias ?? "NONE";
    if (bias === "BULL")
        return "bull";
    if (bias === "BEAR")
        return "bear";
    const trendRaw = String(decision?.trend ?? "").toLowerCase();
    if (trendRaw === "bull" || trendRaw === "bear")
        return trendRaw;
    return "none";
};

const resolveRecentCross = (fast, slow, lookback) => {
    const size = Math.min(fast.length, slow.length);
    if (size < 3)
        return false;
    const span = Math.min(size - 1, Math.max(2, lookback));
    let prev = Math.sign(fast[size - span - 1] - slow[size - span - 1]);
    for (let i = size - span; i < size; i++) {
        const next = Math.sign(fast[i] - slow[i]);
        if (next !== 0 && prev !== 0 && next !== prev)
            return true;
        if (next !== 0)
            prev = next;
    }
    return false;
};

const resolveAiMaticEmaFlags = (candles) => {
    const closes = candles.map((c) => c.close);
    const ema20Arr = computeEma(closes, 20);
    const ema50Arr = computeEma(closes, 50);
    const ema200Arr = computeEma(closes, 200);
    const ema20 = ema20Arr[ema20Arr.length - 1] ?? Number.NaN;
    const ema50 = ema50Arr[ema50Arr.length - 1] ?? Number.NaN;
    const ema200 = ema200Arr[ema200Arr.length - 1] ?? Number.NaN;
    const close = closes[closes.length - 1] ?? Number.NaN;
    const bullOk = Number.isFinite(close) &&
        close > ema20 &&
        ema20 > ema50 &&
        ema50 > ema200;
    const bearOk = Number.isFinite(close) &&
        close < ema20 &&
        ema20 < ema50 &&
        ema50 < ema200;
    const crossRecent =
        resolveRecentCross(ema20Arr, ema50Arr, AI_MATIC_EMA_CROSS_LOOKBACK) ||
            resolveRecentCross(ema50Arr, ema200Arr, AI_MATIC_EMA_CROSS_LOOKBACK);
    return { bullOk, bearOk, crossRecent, ema20, ema50, ema200, close };
};

const resolveAiMaticPivots = (candles, lookback = 2) => {
    if (!candles.length)
        return { lastHigh: undefined, lastLow: undefined };
    const highs = findPivotsHigh(candles, lookback, lookback);
    const lows = findPivotsLow(candles, lookback, lookback);
    const lastHigh = highs[highs.length - 1]?.price;
    const lastLow = lows[lows.length - 1]?.price;
    return { lastHigh, lastLow };
};

const resolveStructureState = (candles, lookback = 2) => {
    const highs = findPivotsHigh(candles, lookback, lookback);
    const lows = findPivotsLow(candles, lookback, lookback);
    const lastHigh = highs[highs.length - 1]?.price;
    const prevHigh = highs[highs.length - 2]?.price;
    const lastLow = lows[lows.length - 1]?.price;
    const prevLow = lows[lows.length - 2]?.price;
    const lastHighType = Number.isFinite(lastHigh) && Number.isFinite(prevHigh)
        ? lastHigh > prevHigh
            ? "HH"
            : lastHigh < prevHigh
                ? "LH"
                : "NONE"
        : "NONE";
    const lastLowType = Number.isFinite(lastLow) && Number.isFinite(prevLow)
        ? lastLow > prevLow
            ? "HL"
            : lastLow < prevLow
                ? "LL"
                : "NONE"
        : "NONE";
    const structureTrend = lastHighType === "HH" && lastLowType === "HL"
        ? "BULL"
        : lastHighType === "LH" && lastLowType === "LL"
            ? "BEAR"
            : "RANGE";
    const lastClose = candles[candles.length - 1]?.close ?? Number.NaN;
    const bosUp = structureTrend === "BULL" &&
        Number.isFinite(lastHigh) &&
        Number.isFinite(lastClose) &&
        lastClose > lastHigh;
    const bosDown = structureTrend === "BEAR" &&
        Number.isFinite(lastLow) &&
        Number.isFinite(lastClose) &&
        lastClose < lastLow;
    const chochDown = structureTrend === "BULL" &&
        Number.isFinite(lastLow) &&
        Number.isFinite(lastClose) &&
        lastClose < lastLow;
    const chochUp = structureTrend === "BEAR" &&
        Number.isFinite(lastHigh) &&
        Number.isFinite(lastClose) &&
        lastClose > lastHigh;
    return {
        structureTrend,
        lastHighType,
        lastLowType,
        bosUp,
        bosDown,
        chochUp,
        chochDown,
        lastHigh,
        lastLow,
    };
};

const resolveAiMaticPatterns = (candles) => {
    if (candles.length < 2) {
        return {
            pinbarBull: false,
            pinbarBear: false,
            engulfBull: false,
            engulfBear: false,
            insideBar: false,
            trapBull: false,
            trapBear: false,
        };
    }
    const prev = candles[candles.length - 2];
    const curr = candles[candles.length - 1];
    const range = Math.max(curr.high - curr.low, 1e-8);
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.close, curr.open);
    const lowerWick = Math.min(curr.close, curr.open) - curr.low;
    const pinbarBull = body <= 0.3 * range && lowerWick >= 0.6 * range;
    const pinbarBear = body <= 0.3 * range && upperWick >= 0.6 * range;
    const prevBodyHigh = Math.max(prev.open, prev.close);
    const prevBodyLow = Math.min(prev.open, prev.close);
    const currBodyHigh = Math.max(curr.open, curr.close);
    const currBodyLow = Math.min(curr.open, curr.close);
    const engulfBull = curr.close > curr.open &&
        prev.close < prev.open &&
        currBodyHigh >= prevBodyHigh &&
        currBodyLow <= prevBodyLow;
    const engulfBear = curr.close < curr.open &&
        prev.close > prev.open &&
        currBodyHigh >= prevBodyHigh &&
        currBodyLow <= prevBodyLow;
    const insideBar = curr.high <= prev.high && curr.low >= prev.low;
    const trapBull = curr.low < prev.low && curr.close > prev.low;
    const trapBear = curr.high > prev.high && curr.close < prev.high;
    return {
        pinbarBull,
        pinbarBear,
        engulfBull,
        engulfBear,
        insideBar,
        trapBull,
        trapBear,
    };
};

const resolveAiMaticBreakRetest = (candles, level, dir) => {
    if (!Number.isFinite(level) || candles.length < 3)
        return false;
    const recent = candles.slice(-AI_MATIC_BREAK_RETEST_LOOKBACK - 1, -1);
    const broke = recent.some((c) => dir === "bull" ? c.close > level : c.close < level);
    if (!broke)
        return false;
    const last = candles[candles.length - 1];
    const retest = last.low <= level && last.high >= level;
    const closeOk = dir === "bull" ? last.close >= level : last.close <= level;
    return retest && closeOk;
};

const resolvePoiReaction = (pois, price, candle, dir) => {
    if (!Number.isFinite(price) || !candle || !pois.length)
        return false;
    const closeOk = dir === "bull" ? candle.close >= candle.open : candle.close <= candle.open;
    if (!closeOk)
        return false;
    return pois.some((poi) => {
        const poiDir = String(poi.direction ?? "").toLowerCase();
        const dirOk = dir === "bull"
            ? poiDir === "bullish" || poiDir === "bull"
            : poiDir === "bearish" || poiDir === "bear";
        if (!dirOk)
            return false;
        return price >= poi.low && price <= poi.high;
    });
};

const resolveLvnRejection = (profile, candle) => {
    if (!profile || !candle || !Array.isArray(profile.lvn)) {
        return { bull: false, bear: false };
    }
    const price = candle.close;
    const tolerance = price * AI_MATIC_POI_DISTANCE_PCT;
    const touched = profile.lvn.some((lvn) => Math.abs(price - lvn) <= tolerance);
    if (!touched)
        return { bull: false, bear: false };
    return {
        bull: candle.close >= candle.open,
        bear: candle.close <= candle.open,
    };
};

const resolveGapPresent = (pois) => pois.some((poi) => {
    const type = String(poi.type ?? "").toLowerCase();
    return type.includes("fvg") || type.includes("gap");
});

const resolvePoiTouch = (pois, price) => {
    if (!Number.isFinite(price) || !pois.length)
        return false;
    return pois.some((poi) => Number.isFinite(poi.low) &&
        Number.isFinite(poi.high) &&
        price >= poi.low &&
        price <= poi.high);
};

const resolveMacdState = (closes) => {
    if (closes.length < 3) {
        return {
            macdHist: Number.NaN,
            macdSignal: Number.NaN,
            macdCrossUp: false,
            macdCrossDown: false,
            macdAlignedUp: false,
            macdAlignedDown: false,
        };
    }
    const ema12 = computeEma(closes, 12);
    const ema26 = computeEma(closes, 26);
    const size = Math.min(ema12.length, ema26.length);
    const macd = ema12.slice(0, size).map((v, i) => v - (ema26[i] ?? 0));
    const signal = computeEma(macd, 9);
    const hist = macd.map((v, i) => v - (signal[i] ?? 0));
    const macdHist = hist[hist.length - 1] ?? Number.NaN;
    const macdHistPrev = hist[hist.length - 2] ?? Number.NaN;
    const macdSignal = signal[signal.length - 1] ?? Number.NaN;
    const macdCrossUp = macdHist > 0 && macdHistPrev <= 0;
    const macdCrossDown = macdHist < 0 && macdHistPrev >= 0;
    return {
        macdHist,
        macdSignal,
        macdCrossUp,
        macdCrossDown,
        macdAlignedUp: macdHist > 0,
        macdAlignedDown: macdHist < 0,
    };
};

const resolveVolumeRising = (candles, lookback = 8) => {
    if (candles.length < lookback * 2)
        return false;
    const recent = candles.slice(-lookback);
    const prev = candles.slice(-lookback * 2, -lookback);
    const avg = (slice) => slice.reduce((s, c) => s + (c.volume ?? 0), 0) / Math.max(1, slice.length);
    const recentAvg = avg(recent);
    const prevAvg = avg(prev);
    return Number.isFinite(recentAvg) && Number.isFinite(prevAvg) && recentAvg > prevAvg * 1.1;
};

const resolveLiquiditySweep = (candles) => {
    if (candles.length < AI_MATIC_LIQ_SWEEP_LOOKBACK + 2) {
        return {
            sweepHigh: false,
            sweepLow: false,
            sweepHighWick: Number.NaN,
            sweepLowWick: Number.NaN,
            swingHigh: Number.NaN,
            swingLow: Number.NaN,
        };
    }
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const vols = candles.map((c) => c.volume ?? 0);
    const atrArr = computeATR(highs, lows, closes, 14);
    const atr = atrArr[atrArr.length - 1] || 0;
    const lb = AI_MATIC_LIQ_SWEEP_LOOKBACK;
    const swingHigh = Math.max(...highs.slice(-lb - 1, -1));
    const swingLow = Math.min(...lows.slice(-lb - 1, -1));
    const last = candles[candles.length - 1];
    const volSmaWindow = Math.min(vols.length, 50);
    const volSma = vols.slice(-volSmaWindow).reduce((a, b) => a + b, 0) /
        Math.max(1, volSmaWindow);
    const volOk = (last.volume ?? 0) > AI_MATIC_LIQ_SWEEP_VOL_MULT * volSma;
    const sweptHigh = last.high > swingHigh + AI_MATIC_LIQ_SWEEP_ATR_MULT * atr &&
        last.close < swingHigh;
    const sweptLow = last.low < swingLow - AI_MATIC_LIQ_SWEEP_ATR_MULT * atr &&
        last.close > swingLow;
    const sweepHigh = Boolean(volOk && sweptHigh);
    const sweepLow = Boolean(volOk && sweptLow);
    return {
        sweepHigh,
        sweepLow,
        sweepHighWick: sweepHigh ? last.high : Number.NaN,
        sweepLowWick: sweepLow ? last.low : Number.NaN,
        swingHigh: Number.isFinite(swingHigh) ? swingHigh : Number.NaN,
        swingLow: Number.isFinite(swingLow) ? swingLow : Number.NaN,
    };
};

const resolveAiMaticPhase = (args) => {
    const trend = String(args.trend ?? "").toLowerCase();
    const lowAdx = Number.isFinite(args.adx) && args.adx < 20;
    const rangeLike = trend === "range" || lowAdx;
    const poc = args.profile?.poc ?? Number.NaN;
    const vah = args.profile?.vah ?? Number.NaN;
    const val = args.profile?.val ?? Number.NaN;
    if (rangeLike &&
        args.sweepLow &&
        args.volumeRising &&
        Number.isFinite(poc) &&
        args.price > poc) {
        return "ACCUMULATION";
    }
    if (rangeLike &&
        args.sweepHigh &&
        args.volumeRising &&
        Number.isFinite(poc) &&
        args.price < poc) {
        return "DISTRIBUTION";
    }
    if (args.volumeSpike &&
        ((args.sweepLow && trend === "bear") || (args.sweepHigh && trend === "bull"))) {
        return "MANIPULATION";
    }
    if (rangeLike &&
        args.sweepHigh &&
        args.volumeRising &&
        Number.isFinite(vah) &&
        args.price < vah) {
        return "DISTRIBUTION";
    }
    if (rangeLike &&
        args.sweepLow &&
        args.volumeRising &&
        Number.isFinite(val) &&
        args.price > val) {
        return "ACCUMULATION";
    }
    return "TREND";
};

const buildAiMaticContext = (candles, decision, core, opts) => {
    const resample = opts?.resample ?? ((tf) => resampleCandles(candles, tf));
    const htf = resample(60);
    const mtf = resample(15);
    const ltf = resample(5);
    if (!htf.length || !mtf.length || !ltf.length)
        return null;
    const htfPois = new CandlestickAnalyzer(toAnalyzerCandles(htf)).getPointsOfInterest();
    const mtfPois = new CandlestickAnalyzer(toAnalyzerCandles(mtf)).getPointsOfInterest();
    const profile = computeMarketProfile({ candles: mtf });
    const ltfLast = ltf[ltf.length - 1];
    const htfStructure = resolveStructureState(htf);
    const mtfStructure = resolveStructureState(mtf);
    const ltfStructure = resolveStructureState(ltf);
    const htfEma = resolveAiMaticEmaFlags(htf);
    const mtfEma = resolveAiMaticEmaFlags(mtf);
    const emaFlags = resolveAiMaticEmaFlags(ltf);
    const patterns = resolveAiMaticPatterns(ltf);
    const mtfPatterns = resolveAiMaticPatterns(mtf);
    const htfSweep = resolveLiquiditySweep(htf);
    const mtfSweep = resolveLiquiditySweep(mtf);
    const ltfSweep = resolveLiquiditySweep(ltf);
    const htfDir = resolveAiMaticHtfDirection(decision, core);
    const bosUp = ltfStructure.bosUp;
    const bosDown = ltfStructure.bosDown;
    const breakRetestUp = resolveAiMaticBreakRetest(ltf, ltfStructure.lastHigh, "bull");
    const breakRetestDown = resolveAiMaticBreakRetest(ltf, ltfStructure.lastLow, "bear");
    const ltfVolumeReaction = Boolean(core?.volumeSpike) ||
        (Number.isFinite(core?.volumeCurrent) &&
            Number.isFinite(core?.volumeP60) &&
            core.volumeCurrent >= core.volumeP60);
    const htfAdx = toNumber(decision?.trendAdx);
    const htfVolumeRising = resolveVolumeRising(htf);
    const price = Number.isFinite(ltfLast?.close) ? ltfLast.close : Number.NaN;
    const ltfCloses = ltf.map((c) => c.close);
    const ltfRsiArr = computeRsi(ltfCloses, 14);
    const ltfRsi = ltfRsiArr[ltfRsiArr.length - 1] ?? Number.NaN;
    const rsiExtremeLong = Number.isFinite(ltfRsi) && ltfRsi <= AI_MATIC_RSI_OVERSOLD;
    const rsiExtremeShort = Number.isFinite(ltfRsi) && ltfRsi >= AI_MATIC_RSI_OVERBOUGHT;
    const macdState = resolveMacdState(ltfCloses);
    const momentumLongOk = rsiExtremeLong && (macdState.macdCrossUp || macdState.macdAlignedUp);
    const momentumShortOk = rsiExtremeShort && (macdState.macdCrossDown || macdState.macdAlignedDown);
    const gapPresent = resolveGapPresent([...htfPois, ...mtfPois]);
    const obRetest = resolvePoiTouch([...htfPois, ...mtfPois], price);
    const pocNear = profile &&
        Number.isFinite(price) &&
        Number.isFinite(profile.poc) &&
        Math.abs(price - profile.poc) <= price * AI_MATIC_POI_DISTANCE_PCT;
    const lvnRejection = resolveLvnRejection(profile, ltfLast);
    const poiReactionBull = resolvePoiReaction(htfPois, price, ltfLast, "bull");
    const poiReactionBear = resolvePoiReaction(htfPois, price, ltfLast, "bear");
    const mtfPoiReactionBull = resolvePoiReaction(mtfPois, price, ltfLast, "bull");
    const mtfPoiReactionBear = resolvePoiReaction(mtfPois, price, ltfLast, "bear");
    const phase = resolveAiMaticPhase({
        trend: String(decision?.trend ?? ""),
        adx: htfAdx,
        sweepHigh: htfSweep.sweepHigh,
        sweepLow: htfSweep.sweepLow,
        volumeRising: htfVolumeRising,
        profile,
        price,
        volumeSpike: Boolean(core?.volumeSpike),
    });
    return {
        htf: {
            direction: htfDir,
            adx: htfAdx,
            phase,
            ema: htfEma,
            sweepHigh: htfSweep.sweepHigh,
            sweepLow: htfSweep.sweepLow,
            sweepHighWick: htfSweep.sweepHighWick,
            sweepLowWick: htfSweep.sweepLowWick,
        swingHigh: htfSweep.swingHigh,
        swingLow: htfSweep.swingLow,
        volumeRising: htfVolumeRising,
        structureTrend: htfStructure.structureTrend,
        lastHighType: htfStructure.lastHighType,
        lastLowType: htfStructure.lastLowType,
            bosUp: htfStructure.bosUp,
            bosDown: htfStructure.bosDown,
            chochUp: htfStructure.chochUp,
            chochDown: htfStructure.chochDown,
            pivotHigh: htfStructure.lastHigh,
            pivotLow: htfStructure.lastLow,
            pois: htfPois,
            poiReactionBull,
            poiReactionBear,
        },
        mtf: {
            sweepHigh: mtfSweep.sweepHigh,
            sweepLow: mtfSweep.sweepLow,
            sweepHighWick: mtfSweep.sweepHighWick,
            sweepLowWick: mtfSweep.sweepLowWick,
            swingHigh: mtfSweep.swingHigh,
            swingLow: mtfSweep.swingLow,
            profile,
            pocNear: Boolean(pocNear),
            lvnRejectionBull: lvnRejection.bull,
            lvnRejectionBear: lvnRejection.bear,
            ema: mtfEma,
            patterns: mtfPatterns,
            gapPresent,
            obRetest,
            structureTrend: mtfStructure.structureTrend,
            lastHighType: mtfStructure.lastHighType,
            lastLowType: mtfStructure.lastLowType,
            bosUp: mtfStructure.bosUp,
            bosDown: mtfStructure.bosDown,
            chochUp: mtfStructure.chochUp,
            chochDown: mtfStructure.chochDown,
            pivotHigh: mtfStructure.lastHigh,
            pivotLow: mtfStructure.lastLow,
            pois: mtfPois,
            poiReactionBull: mtfPoiReactionBull,
            poiReactionBear: mtfPoiReactionBear,
        },
        ltf: {
            patterns,
            bosUp,
            bosDown,
            chochUp: ltfStructure.chochUp,
            chochDown: ltfStructure.chochDown,
            breakRetestUp,
            breakRetestDown,
            fakeoutHigh: Boolean(core?.ltfFakeBreakHigh),
            fakeoutLow: Boolean(core?.ltfFakeBreakLow),
            rsi: ltfRsi,
            rsiExtremeLong,
            rsiExtremeShort,
            macdHist: macdState.macdHist,
            macdSignal: macdState.macdSignal,
            macdCrossUp: macdState.macdCrossUp,
            macdCrossDown: macdState.macdCrossDown,
            momentumLongOk,
            momentumShortOk,
            sweepHigh: ltfSweep.sweepHigh,
            sweepLow: ltfSweep.sweepLow,
            sweepHighWick: ltfSweep.sweepHighWick,
        sweepLowWick: ltfSweep.sweepLowWick,
        swingHigh: ltfSweep.swingHigh,
        swingLow: ltfSweep.swingLow,
        ema: emaFlags,
        volumeReaction: ltfVolumeReaction,
        structureTrend: ltfStructure.structureTrend,
        lastHighType: ltfStructure.lastHighType,
        lastLowType: ltfStructure.lastLowType,
        },
    };
};

const minFinite = (...values) => {
    const filtered = values.filter((v) => Number.isFinite(v));
    if (!filtered.length)
        return Number.NaN;
    return Math.min(...filtered);
};

const maxFinite = (...values) => {
    const filtered = values.filter((v) => Number.isFinite(v));
    if (!filtered.length)
        return Number.NaN;
    return Math.max(...filtered);
};

const resolveNearestPoiBoundary = (pois, side, entry) => {
    if (!Number.isFinite(entry) || !pois.length)
        return Number.NaN;
    if (side === "Buy") {
        const candidates = pois
            .map((poi) => poi.low)
            .filter((v) => Number.isFinite(v) && v < entry);
        return candidates.length ? Math.max(...candidates) : Number.NaN;
    }
    const candidates = pois
        .map((poi) => poi.high)
        .filter((v) => Number.isFinite(v) && v > entry);
    return candidates.length ? Math.min(...candidates) : Number.NaN;
};

const resolveAiMaticStopLoss = (args) => {
    const { side, entry, currentSl, atr, aiMatic, core } = args;
    if (!Number.isFinite(entry) || entry <= 0)
        return Number.NaN;
    const pivotLow = minFinite(aiMatic?.htf.pivotLow, aiMatic?.mtf.pivotLow, core?.lastPivotLow, core?.pivotLow);
    const pivotHigh = maxFinite(aiMatic?.htf.pivotHigh, aiMatic?.mtf.pivotHigh, core?.lastPivotHigh, core?.pivotHigh);
    const pois = [...(aiMatic?.htf.pois ?? []), ...(aiMatic?.mtf.pois ?? [])];
    const poiBoundary = resolveNearestPoiBoundary(pois, side, entry);
    const sweepBase = side === "Buy"
        ? minFinite(aiMatic?.ltf.sweepLowWick, aiMatic?.mtf.sweepLowWick, aiMatic?.htf.sweepLowWick)
        : maxFinite(aiMatic?.ltf.sweepHighWick, aiMatic?.mtf.sweepHighWick, aiMatic?.htf.sweepHighWick);
    const buffer = Number.isFinite(atr) ? atr * AI_MATIC_SL_ATR_BUFFER : 0;
    let candidate = Number.NaN;
    if (side === "Buy") {
        const base = minFinite(pivotLow, poiBoundary, sweepBase);
        if (Number.isFinite(base)) {
            candidate = base - buffer;
        }
    }
    else {
        const base = maxFinite(pivotHigh, poiBoundary, sweepBase);
        if (Number.isFinite(base)) {
            candidate = base + buffer;
        }
    }
    if (!Number.isFinite(candidate) || candidate <= 0)
        return Number.NaN;
    if (!Number.isFinite(currentSl))
        return candidate;
    if (side === "Buy") {
        return candidate < currentSl ? candidate : Number.NaN;
    }
    return candidate > currentSl ? candidate : Number.NaN;
};

const resolveAiMaticTargets = (args) => {
    const { side, entry, sl, aiMatic } = args;
    if (!Number.isFinite(entry) || !Number.isFinite(sl))
        return Number.NaN;
    const risk = Math.abs(entry - sl);
    if (!Number.isFinite(risk) || risk <= 0)
        return Number.NaN;
    const targets = new Set();
    const add = (value) => {
        if (!Number.isFinite(value))
            return;
        targets.add(value);
    };
    const profile = aiMatic?.mtf.profile ?? null;
    if (profile) {
        add(profile.poc);
        if (side === "Buy") {
            add(profile.vah);
            profile.hvn?.forEach(add);
        }
        else {
            add(profile.val);
            profile.lvn?.forEach(add);
        }
    }
    const pois = [...(aiMatic?.htf.pois ?? []), ...(aiMatic?.mtf.pois ?? [])];
    for (const poi of pois) {
        if (side === "Buy")
            add(poi.high);
        else
            add(poi.low);
    }
    if (side === "Buy")
        add(aiMatic?.htf.pivotHigh ?? aiMatic?.mtf.pivotHigh);
    else
        add(aiMatic?.htf.pivotLow ?? aiMatic?.mtf.pivotLow);
    const list = Array.from(targets)
        .filter((v) => side === "Buy" ? v > entry : v < entry)
        .sort((a, b) => Math.abs(a - entry) - Math.abs(b - entry));
    const band = list.filter((candidate) => {
        const pctMove = Math.abs(candidate - entry) / Math.max(entry, 1e-8);
        return (pctMove >= AI_MATIC_TP1_PCT_MIN &&
            pctMove <= AI_MATIC_TP1_PCT_MAX);
    });
    if (band.length)
        return band[0];
    const minTarget = side === "Buy" ? entry + risk * AI_MATIC_MIN_RR : entry - risk * AI_MATIC_MIN_RR;
    for (const candidate of list) {
        if (side === "Buy" ? candidate >= minTarget : candidate <= minTarget) {
            return candidate;
        }
    }
    return Number.NaN;
};

const resolveAiMaticEntryType = (args) => {
    const { aiMatic, side, entry } = args;
    const dir = side === "Buy" ? "bull" : "bear";
    const patterns = aiMatic.ltf.patterns;
    const strongPattern = dir === "bull"
        ? patterns.pinbarBull || patterns.engulfBull || patterns.trapBull
        : patterns.pinbarBear || patterns.engulfBear || patterns.trapBear;
    const momentumOk = dir === "bull" ? aiMatic.ltf.momentumLongOk : aiMatic.ltf.momentumShortOk;
    const strongReaction = strongPattern && aiMatic.ltf.volumeReaction && momentumOk;
    if (strongReaction) {
        return { entryType: "MARKET", allowMarket: true };
    }
    const breakoutOk = dir === "bull"
        ? aiMatic.ltf.bosUp || aiMatic.ltf.breakRetestUp
        : aiMatic.ltf.bosDown || aiMatic.ltf.breakRetestDown;
    if (breakoutOk) {
        const triggerBase = dir === "bull"
            ? maxFinite(entry, aiMatic.ltf.swingHigh, aiMatic.mtf.pivotHigh, aiMatic.htf.pivotHigh)
            : minFinite(entry, aiMatic.ltf.swingLow, aiMatic.mtf.pivotLow, aiMatic.htf.pivotLow);
        const triggerPrice = Number.isFinite(triggerBase) && triggerBase > 0 ? triggerBase : undefined;
        return { entryType: "CONDITIONAL", triggerPrice, allowMarket: false };
    }
    return { entryType: "LIMIT", allowMarket: false };
};

const evaluateAiMaticGatesCore = (args) => {
    const aiMatic = args.decision?.aiMatic ?? null;
    const signal = args.signal ?? null;
    const empty = {
        hardGates: [],
        entryFactors: [],
        checklist: [],
        hardPass: false,
        entryFactorsPass: false,
        checklistPass: false,
        pass: false,
    };
    if (!aiMatic || !signal)
        return empty;
    const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
    const dir = sideRaw === "buy" ? "bull" : sideRaw === "sell" ? "bear" : null;
    if (!dir)
        return empty;
    const structureAligned = dir === "bull"
        ? aiMatic.htf.structureTrend === "BULL"
        : aiMatic.htf.structureTrend === "BEAR";
    const htfEmaOk = dir === "bull" ? aiMatic.htf.ema?.bullOk : aiMatic.htf.ema?.bearOk;
    const htfEmaValid = [aiMatic.htf.ema?.ema20, aiMatic.htf.ema?.ema50, aiMatic.htf.ema?.ema200].every(Number.isFinite);
    const htfAligned = htfEmaValid ? Boolean(htfEmaOk) : structureAligned;
    const mtfEmaOk = dir === "bull" ? aiMatic.mtf.ema?.bullOk : aiMatic.mtf.ema?.bearOk;
    const mtfEmaValid = [aiMatic.mtf.ema?.ema20, aiMatic.mtf.ema?.ema50, aiMatic.mtf.ema?.ema200].every(Number.isFinite);
    const mtfAligned = mtfEmaValid ? Boolean(mtfEmaOk) : true;
    const emaStackOk = dir === "bull" ? Boolean(aiMatic.ltf.ema?.bullOk) : Boolean(aiMatic.ltf.ema?.bearOk);
    const emaCrossOk = !(aiMatic.ltf.ema?.crossRecent ?? false);
    const patternOk = dir === "bull"
        ? aiMatic.ltf.patterns.pinbarBull ||
            aiMatic.ltf.patterns.engulfBull ||
            aiMatic.ltf.patterns.trapBull ||
            aiMatic.ltf.patterns.insideBar
        : aiMatic.ltf.patterns.pinbarBear ||
            aiMatic.ltf.patterns.engulfBear ||
            aiMatic.ltf.patterns.trapBear ||
            aiMatic.ltf.patterns.insideBar;
    const mtfPatternOk = dir === "bull"
        ? aiMatic.mtf.patterns.pinbarBull ||
            aiMatic.mtf.patterns.engulfBull ||
            aiMatic.mtf.patterns.trapBull ||
            aiMatic.mtf.patterns.insideBar
        : aiMatic.mtf.patterns.pinbarBear ||
            aiMatic.mtf.patterns.engulfBear ||
            aiMatic.mtf.patterns.trapBear ||
            aiMatic.mtf.patterns.insideBar;
    const sweepOk = dir === "bull"
        ? aiMatic.htf.sweepLow ||
            aiMatic.mtf.sweepLow ||
            aiMatic.ltf.sweepLow ||
            aiMatic.ltf.fakeoutLow
        : aiMatic.htf.sweepHigh ||
            aiMatic.mtf.sweepHigh ||
            aiMatic.ltf.sweepHigh ||
            aiMatic.ltf.fakeoutHigh;
    const htfPoiReaction = dir === "bull" ? aiMatic.htf.poiReactionBull : aiMatic.htf.poiReactionBear;
    const mtfPoiReaction = dir === "bull" ? aiMatic.mtf.poiReactionBull : aiMatic.mtf.poiReactionBear;
    const obReactionOk = htfPoiReaction || mtfPoiReaction;
    const obCloseOk = mtfPoiReaction;
    const gapPresent = aiMatic.mtf.gapPresent;
    const obRetestOk = aiMatic.mtf.obRetest;
    const momentumOk = dir === "bull" ? aiMatic.ltf.momentumLongOk : aiMatic.ltf.momentumShortOk;
    const volumeOk = aiMatic.ltf.volumeReaction;
    const hardGates = [
        { name: "HTF EMA trend", ok: htfAligned },
        { name: "MTF EMA confirm", ok: mtfAligned },
        { name: "EMA 20/50/200 stack", ok: emaStackOk },
        { name: "EMA no-cross", ok: emaCrossOk },
        { name: "Pattern confirm", ok: patternOk },
        { name: "Volume confirm", ok: volumeOk },
    ];
    const entryFactors = [
        { name: "Sweep return", ok: sweepOk },
        { name: "OB reaction", ok: obReactionOk },
        { name: "OB retrace", ok: obRetestOk },
        { name: "GAP present", ok: gapPresent },
        { name: "RSI/MACD", ok: momentumOk },
    ];
    const checklist = [
        { name: "HTF EMA trend", ok: htfAligned },
        { name: "MTF EMA confirm", ok: mtfAligned },
        { name: "EMA 20/50/200 stack", ok: emaStackOk },
        { name: "EMA no-cross", ok: emaCrossOk },
        { name: "Pattern confirm", ok: patternOk },
        { name: "Volume confirm", ok: volumeOk },
        { name: "Likvidita (sweep)", ok: sweepOk },
    ];
    const hardOkCount = hardGates.filter((g) => g.ok).length;
    const hardPass = hardOkCount >= AI_MATIC_HARD_MIN;
    const entryFactorsPass = entryFactors.filter((g) => g.ok).length >= AI_MATIC_ENTRY_FACTOR_MIN;
    const checklistPass = checklist.filter((g) => g.ok).length >= AI_MATIC_CHECKLIST_MIN;
    return {
        hardGates,
        entryFactors,
        checklist,
        hardPass,
        entryFactorsPass,
        checklistPass,
        pass: hardPass && entryFactorsPass && checklistPass,
    };
};

export const __aiMaticTest = {
    resolveAiMaticPatterns,
    resolveAiMaticEmaFlags,
    resolveAiMaticBreakRetest,
    resolveLiquiditySweep,
    resolveStructureState,
    resolveAiMaticStopLoss,
    resolveAiMaticTargets,
    evaluateAiMaticGatesCore,
    buildAiMaticContext,
};
export const __scalpTest = {
    resolveScalpSwing,
    resolveScalpFibLevels,
    resolveFibHitLevel,
    buildScalpFibData,
    resolveScalpConfirmation,
    resolveScalpFibStop,
    resolveScalpFibTarget,
};
function buildScalpTrend(candles, timeframeMin) {
    const sampled = resampleCandles(candles, timeframeMin);
    const minBars = Math.max(SCALP_EMA_PERIOD + 2, SCALP_SWING_LOOKBACK * 2 + 3);
    if (!sampled.length || sampled.length < minBars)
        return undefined;
    const closes = sampled.map((c) => c.close);
    const emaArr = computeEma(closes, SCALP_EMA_PERIOD);
    if (emaArr.length < 2)
        return undefined;
    const ema21 = emaArr[emaArr.length - 1];
    const ema21Prev = emaArr[emaArr.length - 2];
    const close = closes[closes.length - 1];
    const aboveEma = close > ema21;
    const belowEma = close < ema21;
    const emaSlopePct = ema21Prev
        ? ((ema21 - ema21Prev) / Math.abs(ema21Prev)) * 100
        : 0;
    const emaFlat = Math.abs(emaSlopePct) <= SCALP_EMA_FLAT_PCT;
    const highs = findPivotsHigh(sampled, SCALP_SWING_LOOKBACK, SCALP_SWING_LOOKBACK);
    const lows = findPivotsLow(sampled, SCALP_SWING_LOOKBACK, SCALP_SWING_LOOKBACK);
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    let structure = "NONE";
    if (lastHigh && prevHigh && lastLow && prevLow) {
        const hh = lastHigh.price > prevHigh.price;
        const hl = lastLow.price > prevLow.price;
        const ll = lastLow.price < prevLow.price;
        const lh = lastHigh.price < prevHigh.price;
        if (hh && hl)
            structure = "HH_HL";
        else if (ll && lh)
            structure = "LL_LH";
        else
            structure = "MIXED";
    }
    let direction = "NONE";
    if (structure === "HH_HL" && aboveEma)
        direction = "BULL";
    if (structure === "LL_LH" && belowEma)
        direction = "BEAR";
    return {
        timeframeMin,
        close,
        ema21,
        ema21Prev,
        emaSlopePct,
        emaFlat,
        aboveEma,
        belowEma,
        structure,
        direction,
    };
}
function buildScalpContext(candles) {
    const h1 = buildScalpTrend(candles, 60);
    const m15 = buildScalpTrend(candles, 15);
    let ema15mCrossCount = 0;
    let ema15mChoppy = false;
    if (m15) {
        const sampled = resampleCandles(candles, 15);
        const closes = sampled.map((c) => c.close);
        const ema8 = computeEma(closes, 8);
        const ema21 = computeEma(closes, 21);
        const size = Math.min(ema8.length, ema21.length);
        const lookback = Math.min(size, SCALP_EMA_CROSS_LOOKBACK + 1);
        if (lookback >= 3) {
            let prevSign = Math.sign(ema8[size - lookback] - ema21[size - lookback]);
            for (let i = size - lookback + 1; i < size; i++) {
                const sign = Math.sign(ema8[i] - ema21[i]);
                if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
                    ema15mCrossCount += 1;
                }
                if (sign !== 0)
                    prevSign = sign;
            }
            ema15mChoppy = ema15mCrossCount >= 2;
        }
    }
    return { h1, m15, ema15mCrossCount, ema15mChoppy };
}
function percentile(values, p) {
    if (!values.length)
        return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[rank];
}
const resolveEntryTfMin = (riskMode) => riskMode === "ai-matic-scalp" ? 1 : 5;
const resolveBboAgeLimit = (symbol) => CORE_V2_BBO_AGE_BY_SYMBOL[symbol] ?? CORE_V2_BBO_AGE_DEFAULT_MS;
const createResampleCache = (candles) => {
    const cache = new Map();
    return (timeframeMin) => {
        const cached = cache.get(timeframeMin);
        if (cached)
            return cached;
        const next = resampleCandles(candles, timeframeMin);
        cache.set(timeframeMin, next);
        return next;
    };
};
const resolveScalpSwing = (pivotsHigh, pivotsLow, direction) => {
    if (!pivotsHigh.length || !pivotsLow.length)
        return null;
    if (direction === "BULL") {
        const lastHigh = pivotsHigh[pivotsHigh.length - 1];
        const lastLow = [...pivotsLow].reverse().find((p) => p.idx < lastHigh.idx);
        if (!lastHigh || !lastLow)
            return null;
        const range = lastHigh.price - lastLow.price;
        if (!Number.isFinite(range) || range <= 0)
            return null;
        return { high: lastHigh.price, low: lastLow.price, range };
    }
    const lastLow = pivotsLow[pivotsLow.length - 1];
    const lastHigh = [...pivotsHigh].reverse().find((p) => p.idx < lastLow.idx);
    if (!lastHigh || !lastLow)
        return null;
    const range = lastHigh.price - lastLow.price;
    if (!Number.isFinite(range) || range <= 0)
        return null;
    return { high: lastHigh.price, low: lastLow.price, range };
};
const resolveScalpFibLevels = (swing, direction) => {
    const retrace = {
        "38.2": Number.NaN,
        "50": Number.NaN,
        "61.8": Number.NaN,
    };
    const ext = {
        "61.8": Number.NaN,
        "100": Number.NaN,
        "161.8": Number.NaN,
    };
    if (direction === "BULL") {
        retrace["38.2"] = swing.high - swing.range * SCALP_FIB_LEVELS[0];
        retrace["50"] = swing.high - swing.range * SCALP_FIB_LEVELS[1];
        retrace["61.8"] = swing.high - swing.range * SCALP_FIB_LEVELS[2];
        ext["61.8"] = swing.high + swing.range * SCALP_FIB_EXT[0];
        ext["100"] = swing.high + swing.range * SCALP_FIB_EXT[1];
        ext["161.8"] = swing.high + swing.range * SCALP_FIB_EXT[2];
    }
    else {
        retrace["38.2"] = swing.low + swing.range * SCALP_FIB_LEVELS[0];
        retrace["50"] = swing.low + swing.range * SCALP_FIB_LEVELS[1];
        retrace["61.8"] = swing.low + swing.range * SCALP_FIB_LEVELS[2];
        ext["61.8"] = swing.low - swing.range * SCALP_FIB_EXT[0];
        ext["100"] = swing.low - swing.range * SCALP_FIB_EXT[1];
        ext["161.8"] = swing.low - swing.range * SCALP_FIB_EXT[2];
    }
    return { retrace, ext };
};
const resolveFibHitLevel = (price, retrace, tolerance) => {
    if (!Number.isFinite(price) || !Number.isFinite(tolerance) || tolerance <= 0) {
        return undefined;
    }
    const levels = [
        ["38.2", retrace["38.2"]],
        ["50", retrace["50"]],
        ["61.8", retrace["61.8"]],
    ];
    let best = undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const [level, value] of levels) {
        if (!Number.isFinite(value))
            continue;
        const dist = Math.abs(price - value);
        if (dist < bestDist) {
            bestDist = dist;
            best = level;
        }
    }
    if (best && bestDist <= tolerance)
        return best;
    return undefined;
};
const buildScalpFibData = (args) => {
    const swing = resolveScalpSwing(args.m15Highs, args.m15Lows, args.direction);
    if (!swing)
        return null;
    const levels = resolveScalpFibLevels(swing, args.direction);
    const price = Number.isFinite(args.ltfClose) ? args.ltfClose : args.m5Close;
    const tolAtr = Number.isFinite(args.atr) && args.atr > 0 ? args.atr * SCALP_FIB_TOL_ATR : 0;
    const tolPct = Number.isFinite(price) && price > 0 ? price * SCALP_FIB_TOL_PCT : 0;
    const tolerance = Math.max(tolAtr, tolPct);
    const m5Level = resolveFibHitLevel(args.m5Close, levels.retrace, tolerance);
    const ltfLevel = resolveFibHitLevel(args.ltfClose, levels.retrace, tolerance);
    const m5InZone = Boolean(m5Level);
    const ltfInZone = Boolean(ltfLevel);
    const hitLevel = ltfLevel ?? m5Level;
    return {
        direction: args.direction,
        swingHigh: swing.high,
        swingLow: swing.low,
        range: swing.range,
        retrace: levels.retrace,
        ext: levels.ext,
        m5InZone,
        ltfInZone,
        hitLevel,
        m5Level,
        ltfLevel,
    };
};
const resolveScalpConfirmation = (args) => {
    const priceOk = Number.isFinite(args.price);
    const dirOk = (poi) => {
        const poiDir = String(poi.direction ?? "").toLowerCase();
        return args.direction === "BULL"
            ? poiDir === "bullish" || poiDir === "bull"
            : poiDir === "bearish" || poiDir === "bear";
    };
    const inZone = (poi) => priceOk && Number.isFinite(poi.low) && Number.isFinite(poi.high)
        ? args.price >= poi.low && args.price <= poi.high
        : false;
    const obTouch = args.pois.some((poi) => String(poi.type).toLowerCase() === "ob" && dirOk(poi) && inZone(poi));
    const gapTouch = args.pois.some((poi) => {
        const type = String(poi.type ?? "").toLowerCase();
        return (type === "fvg" || type.includes("gap")) && dirOk(poi) && inZone(poi);
    });
    const vpConfirm = Boolean(args.vpConfirm);
    const tlPullback = Boolean(args.tlPullback);
    return {
        obTouch,
        gapTouch,
        vpConfirm,
        tlPullback,
        any: obTouch || gapTouch || vpConfirm || tlPullback,
    };
};
const resolveScalpFibStop = (entry, side, fib, atr, structure) => {
    if (!fib || !Number.isFinite(entry) || entry <= 0)
        return Number.NaN;
    const hit = fib.hitLevel;
    if (!hit)
        return Number.NaN;
    const buffer = Number.isFinite(atr) && atr > 0 ? atr * SCALP_SL_ATR_BUFFER : 0;
    let stop = Number.NaN;
    if (hit === "38.2") {
        stop = fib.retrace["50"];
    }
    else if (hit === "50") {
        stop = fib.retrace["61.8"];
    }
    else if (hit === "61.8") {
        stop = side === "Buy" ? fib.swingLow : fib.swingHigh;
    }
    if (!Number.isFinite(stop) || stop <= 0) {
        stop = Number.isFinite(structure) ? structure : Number.NaN;
    }
    if (!Number.isFinite(stop) || stop <= 0)
        return Number.NaN;
    const buffered = side === "Buy" ? stop - buffer : stop + buffer;
    if (!Number.isFinite(buffered) || buffered <= 0)
        return Number.NaN;
    if (side === "Buy" && buffered >= entry)
        return Number.NaN;
    if (side === "Sell" && buffered <= entry)
        return Number.NaN;
    return buffered;
};
const resolveScalpFibTarget = (entry, side, fib, core) => {
    if (!fib || !Number.isFinite(entry) || entry <= 0)
        return Number.NaN;
    const trendOk = core?.ema15mTrend === "BULL" || core?.ema15mTrend === "BEAR";
    const trendWeak = Boolean(core?.m15MacdWeak2) ||
        Boolean(core?.m15MacdWeak3) ||
        Boolean(core?.m15EmaCompression) ||
        Boolean(core?.m15WickIndecisionSoft) ||
        Boolean(core?.m15ImpulseWeak);
    const extLevel = trendWeak ? "61.8" : trendOk ? "161.8" : "100";
    const target = fib.ext[extLevel];
    if (!Number.isFinite(target) || target <= 0)
        return Number.NaN;
    if (side === "Buy" && target <= entry)
        return Number.NaN;
    if (side === "Sell" && target >= entry)
        return Number.NaN;
    return target;
};
const computeCoreV2Metrics = (candles, riskMode, opts) => {
    const ltfTimeframeMin = resolveEntryTfMin(riskMode);
    const resample = opts?.resample ?? ((tf) => resampleCandles(candles, tf));
    const ltf = resample(ltfTimeframeMin);
    const ltfLast = ltf.length ? ltf[ltf.length - 1] : undefined;
    const ltfClose = ltfLast ? ltfLast.close : Number.NaN;
    const ltfCloses = ltf.map((c) => c.close);
    const ltfHighs = ltf.map((c) => c.high);
    const ltfLows = ltf.map((c) => c.low);
    const ema8Arr = computeEma(ltfCloses, 8);
    const ema12Arr = computeEma(ltfCloses, 12);
    const ema21Arr = computeEma(ltfCloses, 21);
    const ema26Arr = computeEma(ltfCloses, 26);
    const ema50Arr = computeEma(ltfCloses, 50);
    const ema8 = ema8Arr[ema8Arr.length - 1] ?? Number.NaN;
    const ema12 = ema12Arr[ema12Arr.length - 1] ?? Number.NaN;
    const ema21 = ema21Arr[ema21Arr.length - 1] ?? Number.NaN;
    const ema26 = ema26Arr[ema26Arr.length - 1] ?? Number.NaN;
    const ema50 = ema50Arr[ema50Arr.length - 1] ?? Number.NaN;
    const emaCrossLookback = Math.min(Math.max(4, SCALP_EMA_CROSS_LOOKBACK + 2), Math.min(ema12Arr.length, ema26Arr.length));
    let emaCrossDir = "NONE";
    let emaCrossBarsAgo = undefined;
    if (emaCrossLookback >= 3) {
        const size = Math.min(ema12Arr.length, ema26Arr.length);
        let prevSign = Math.sign(ema12Arr[size - emaCrossLookback] - ema26Arr[size - emaCrossLookback]);
        for (let i = size - emaCrossLookback + 1; i < size; i++) {
            const sign = Math.sign(ema12Arr[i] - ema26Arr[i]);
            if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
                emaCrossDir = sign > 0 ? "BULL" : "BEAR";
                emaCrossBarsAgo = size - 1 - i;
            }
            if (sign !== 0)
                prevSign = sign;
        }
    }
    const atrArr = computeATR(ltfHighs, ltfLows, ltfCloses, 14);
    const atr14 = atrArr[atrArr.length - 1] ?? Number.NaN;
    const atrPct = Number.isFinite(atr14) && Number.isFinite(ltfClose) && ltfClose > 0
        ? atr14 / ltfClose
        : Number.NaN;
    const sep1 = Number.isFinite(atr14) && atr14 > 0
        ? Math.abs(ema8 - ema21) / atr14
        : Number.NaN;
    const sep2 = Number.isFinite(atr14) && atr14 > 0
        ? Math.abs(ema21 - ema50) / atr14
        : Number.NaN;
    const vols = ltf.map((c) => toNumber(c.volume));
    const recentVols = vols.slice(-200).filter((v) => Number.isFinite(v));
    const volumeCurrent = recentVols[recentVols.length - 1] ?? Number.NaN;
    const volumeP50 = percentile(recentVols, 50);
    const volumeP60 = percentile(recentVols, 60);
    const volumeP65 = percentile(recentVols, 65);
    const volumeP70 = percentile(recentVols, 70);
    const htf = resample(60);
    const htfCloses = htf.map((c) => c.close);
    const htfHighs = htf.map((c) => c.high);
    const htfLows = htf.map((c) => c.low);
    const htfClose = htf.length ? htf[htf.length - 1].close : Number.NaN;
    const htfEma12Arr = computeEma(htfCloses, 12);
    const htfEma26Arr = computeEma(htfCloses, 26);
    const htfEma12 = htfEma12Arr[htfEma12Arr.length - 1] ?? Number.NaN;
    const htfEma26 = htfEma26Arr[htfEma26Arr.length - 1] ?? Number.NaN;
    const htfDiffPct = Number.isFinite(htfClose) && htfClose > 0
        ? Math.abs(htfEma12 - htfEma26) / htfClose
        : Number.NaN;
    const htfBias = Number.isFinite(htfEma12) && Number.isFinite(htfEma26)
        ? htfEma12 > htfEma26
            ? "BULL"
            : htfEma12 < htfEma26
                ? "BEAR"
                : "NONE"
        : "NONE";
    const htfAtrArr = computeATR(htfHighs, htfLows, htfCloses, 14);
    const htfAtr14 = htfAtrArr[htfAtrArr.length - 1] ?? Number.NaN;
    const htfAtrPct = Number.isFinite(htfAtr14) && Number.isFinite(htfClose) && htfClose > 0
        ? htfAtr14 / htfClose
        : Number.NaN;
    const m15 = resample(15);
    const m15Closes = m15.map((c) => c.close);
    const m15PivotsHigh = findPivotsHigh(m15, 2, 2);
    const m15PivotsLow = findPivotsLow(m15, 2, 2);
    const ema15m12Arr = computeEma(m15Closes, 12);
    const ema15m26Arr = computeEma(m15Closes, 26);
    const ema15m12 = ema15m12Arr[ema15m12Arr.length - 1] ?? Number.NaN;
    const ema15m26 = ema15m26Arr[ema15m26Arr.length - 1] ?? Number.NaN;
    const ema15mTrend = Number.isFinite(ema15m12) && Number.isFinite(ema15m26)
        ? ema15m12 > ema15m26
            ? "BULL"
            : ema15m12 < ema15m26
                ? "BEAR"
                : "NONE"
        : "NONE";
    const pullbackLookback = 12;
    let pullbackLong = false;
    let pullbackShort = false;
    for (let i = Math.max(0, ltf.length - pullbackLookback); i < ltf.length; i++) {
        const candle = ltf[i];
        const ema12At = ema12Arr[i];
        const ema26At = ema26Arr[i];
        if (!candle || !Number.isFinite(ema12At) || !Number.isFinite(ema26At))
            continue;
        const lowZone = Math.min(ema12At, ema26At);
        const highZone = Math.max(ema12At, ema26At);
        if (candle.close <= ema12At || (candle.close >= lowZone && candle.close <= highZone)) {
            pullbackLong = true;
        }
        if (candle.close >= ema12At || (candle.close >= lowZone && candle.close <= highZone)) {
            pullbackShort = true;
        }
    }
    const pivotsHigh = findPivotsHigh(ltf, 2, 2);
    const pivotsLow = findPivotsLow(ltf, 2, 2);
    const rsiArr = computeRsi(ltfCloses, 14);
    const lastLow = pivotsLow[pivotsLow.length - 1];
    const lastHigh = pivotsHigh[pivotsHigh.length - 1];
    const prevHigh = lastLow ? pivotsHigh.filter((p) => p.idx < lastLow.idx).pop() : undefined;
    const prevLow = lastHigh ? pivotsLow.filter((p) => p.idx < lastHigh.idx).pop() : undefined;
    const prevLowPivot = pivotsLow[pivotsLow.length - 2];
    const prevHighPivot = pivotsHigh[pivotsHigh.length - 2];
    const microBreakLong = Boolean(prevHigh && lastLow) &&
        Number.isFinite(ltfClose) &&
        ltfClose > prevHigh.price;
    const microBreakShort = Boolean(prevLow && lastHigh) &&
        Number.isFinite(ltfClose) &&
        ltfClose < prevLow.price;
    const rsiBullDiv = Boolean(prevLowPivot && lastLow) &&
        lastLow.price < prevLowPivot.price &&
        Number.isFinite(rsiArr[lastLow.idx]) &&
        Number.isFinite(rsiArr[prevLowPivot.idx]) &&
        rsiArr[lastLow.idx] > rsiArr[prevLowPivot.idx];
    const rsiBearDiv = Boolean(prevHighPivot && lastHigh) &&
        lastHigh.price > prevHighPivot.price &&
        Number.isFinite(rsiArr[lastHigh.idx]) &&
        Number.isFinite(rsiArr[prevHighPivot.idx]) &&
        rsiArr[lastHigh.idx] < rsiArr[prevHighPivot.idx];
    let scalpFib = undefined;
    let scalpConfirm = undefined;
    if (riskMode === "ai-matic-scalp") {
        const direction = ema15mTrend === "BULL" ? "BULL" : ema15mTrend === "BEAR" ? "BEAR" : "NONE";
        if (direction !== "NONE") {
            const m5 = resample(5);
            const m5Last = m5.length ? m5[m5.length - 1] : undefined;
            const m5Close = m5Last ? m5Last.close : Number.NaN;
            const fib = buildScalpFibData({
                m15Highs: m15PivotsHigh,
                m15Lows: m15PivotsLow,
                direction,
                m5Close,
                ltfClose,
                atr: atr14,
            });
            if (fib)
                scalpFib = fib;
            const m15Pois = m15.length
                ? new CandlestickAnalyzer(toAnalyzerCandles(m15)).getPointsOfInterest()
                : [];
            const m5Pois = m5.length
                ? new CandlestickAnalyzer(toAnalyzerCandles(m5)).getPointsOfInterest()
                : [];
            const profile = m15.length ? computeMarketProfile({ candles: m15 }) : null;
            const price = ltfClose;
            const pocNear = profile &&
                Number.isFinite(price) &&
                Number.isFinite(profile.poc) &&
                Math.abs(price - profile.poc) <= price * AI_MATIC_POI_DISTANCE_PCT;
            const lvnRejection = resolveLvnRejection(profile, ltfLast);
            const lvnOk = direction === "BULL" ? lvnRejection.bull : lvnRejection.bear;
            const vpConfirm = Boolean(pocNear || lvnOk);
            const tlPullback = direction === "BULL" ? pullbackLong : pullbackShort;
            scalpConfirm = resolveScalpConfirmation({
                pois: [...m15Pois, ...m5Pois],
                price,
                direction,
                vpConfirm,
                tlPullback,
            });
        }
    }
    return {
        ltfTimeframeMin,
        ltfClose,
        ema8,
        ema12,
        ema21,
        ema26,
        ema50,
        atr14,
        atrPct,
        sep1,
        sep2,
        volumeCurrent,
        volumeP50,
        volumeP60,
        volumeP65,
        volumeP70,
        htfClose,
        htfEma12,
        htfEma26,
        htfDiffPct,
        htfBias,
        htfAtr14,
        htfAtrPct,
        ema15m12,
        ema15m26,
        ema15mTrend,
        emaCrossDir,
        emaCrossBarsAgo,
        pullbackLong,
        pullbackShort,
        pivotHigh: prevHigh?.price,
        pivotLow: prevLow?.price,
        microBreakLong,
        microBreakShort,
        rsiBullDiv,
        rsiBearDiv,
        scalpFib,
        scalpConfirm,
    };
};
const computeScalpPrimaryChecklist = (core) => {
    const ltfOk = core?.ltfTimeframeMin === 1;
    const trendLongOk = core?.ema15mTrend === "BULL";
    const trendShortOk = core?.ema15mTrend === "BEAR";
    const primaryOk = ltfOk && (trendLongOk || trendShortOk);
    const fibOk = Boolean(core?.scalpFib?.m5InZone && core?.scalpFib?.ltfInZone);
    const confirmOk = Boolean(core?.scalpConfirm?.any);
    const entryOk = primaryOk && fibOk && confirmOk;
    const exitOk = Number.isFinite(core?.atr14);
    return {
        primaryOk,
        entryOk,
        exitOk,
        ltfOk,
        trendLongOk,
        trendShortOk,
        fibOk,
        confirmOk,
        emaCrossBarsAgo: core?.emaCrossBarsAgo,
    };
};
function toEpoch(value) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
        return n < 1e12 ? n * 1000 : n;
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : Number.NaN;
    }
    return Number.NaN;
}
function toIso(ts) {
    const epoch = toEpoch(ts);
    return Number.isFinite(epoch) ? new Date(epoch).toISOString() : "";
}
function formatNumber(value, digits = 4) {
    return Number.isFinite(value) ? value.toFixed(digits) : "";
}
function asErrorMessage(err) {
    return err instanceof Error ? err.message : String(err ?? "unknown_error");
}
function extractList(data) {
    return data?.result?.list ?? data?.list ?? [];
}
function buildEntryFallback(list) {
    const map = new Map();
    for (const o of list) {
        const symbol = String(o?.symbol ?? "");
        const side = String(o?.side ?? "");
        if (!symbol || !side)
            continue;
        const reduceOnly = Boolean(o?.reduceOnly ?? o?.reduce_only ?? o?.reduce);
        if (reduceOnly)
            continue;
        const triggerPrice = toNumber(o?.triggerPrice ?? o?.trigger_price);
        const price = toNumber(o?.price);
        if (!Number.isFinite(triggerPrice) && !Number.isFinite(price))
            continue;
        const ts = toEpoch(o?.createdTime ?? o?.created_at ?? o?.updatedTime ?? o?.updated_at);
        const entry = {
            triggerPrice: Number.isFinite(triggerPrice) ? triggerPrice : undefined,
            price: Number.isFinite(price) ? price : undefined,
            ts: Number.isFinite(ts) ? ts : 0,
        };
        const key = `${symbol}:${side}`;
        const prev = map.get(key);
        if (!prev || entry.ts >= prev.ts) {
            map.set(key, entry);
        }
    }
    return map;
}
function computeLossStreak(records, maxCheck = 3) {
    if (!Array.isArray(records) || records.length === 0)
        return 0;
    const sorted = [...records].sort((a, b) => b.ts - a.ts);
    let streak = 0;
    for (const r of sorted) {
        if (r.pnl < 0) {
            streak += 1;
            if (streak >= maxCheck)
                break;
        }
        else {
            break;
        }
    }
    return streak;
}
const MIN_PROTECTION_DISTANCE_PCT = 0.0005;
const MIN_PROTECTION_ATR_FACTOR = 0.05;
const TRAIL_ACTIVATION_R_MULTIPLIER = 0.5;
function resolveMinProtectionDistance(entry, atr) {
    const pctDistance = entry * MIN_PROTECTION_DISTANCE_PCT;
    const atrDistance = Number.isFinite(atr) ? atr * MIN_PROTECTION_ATR_FACTOR : 0;
    return Math.max(pctDistance, atrDistance);
}
function normalizeProtectionLevels(entry, side, sl, tp, atr) {
    if (!Number.isFinite(entry) || entry <= 0) {
        return { sl, tp, minDistance: Number.NaN };
    }
    const minDistance = resolveMinProtectionDistance(entry, atr);
    let nextSl = sl;
    let nextTp = tp;
    if (side === "Buy") {
        if (Number.isFinite(nextSl) && nextSl >= entry - minDistance) {
            nextSl = entry - minDistance;
        }
        if (Number.isFinite(nextTp) && nextTp <= entry + minDistance) {
            nextTp = entry + minDistance;
        }
    }
    else {
        if (Number.isFinite(nextSl) && nextSl <= entry + minDistance) {
            nextSl = entry + minDistance;
        }
        if (Number.isFinite(nextTp) && nextTp >= entry - minDistance) {
            nextTp = entry - minDistance;
        }
    }
    return { sl: nextSl, tp: nextTp, minDistance };
}
function computeRMultiple(entry, sl, price, side) {
    const risk = Math.abs(entry - sl);
    if (!Number.isFinite(risk) || risk <= 0)
        return Number.NaN;
    const move = side === "Buy" ? price - entry : entry - price;
    return move / risk;
}
const TRAIL_PROFILE_BY_RISK_MODE = {
    "ai-matic": { activateR: 0.5, lockR: 0.3, retracementRate: 0.003 },
    "ai-matic-x": { activateR: 1.0, lockR: 0.3, retracementRate: 0.002 },
    "ai-matic-scalp": { activateR: 1.2, lockR: 0.6 },
    "ai-matic-tree": { activateR: 0.5, lockR: 0.3 },
    "ai-matic-pro": { activateR: 0.5, lockR: 0.3 },
};
const TRAIL_SYMBOL_MODE = {
    SOLUSDT: "on",
    ADAUSDT: "on",
    BTCUSDT: "on",
    ETHUSDT: "on",
};
const PROFILE_BY_RISK_MODE = {
    "ai-matic": "AI-MATIC",
    "ai-matic-x": "AI-MATIC-X",
    "ai-matic-scalp": "AI-MATIC-SCALP",
    "ai-matic-tree": "AI-MATIC-TREE",
    "ai-matic-pro": "AI-MATIC-PRO",
};
export function useTradingBot(mode, useTestnet = false, authToken) {
    const allowPositionClose = true;
    const allowOrderCancel = true;
    const [settings, setSettings] = useState(() => loadStoredSettings() ?? DEFAULT_SETTINGS);
    const apiBase = useMemo(() => getApiBase(Boolean(useTestnet)), [useTestnet]);
    const activeSymbols = useMemo(() => {
        const next = filterSupportedSymbols(settings.selectedSymbols);
        return next.length > 0 ? next : [...SUPPORTED_SYMBOLS];
    }, [settings.selectedSymbols]);
    const feedSymbols = useMemo(() => {
        if (activeSymbols.includes("BTCUSDT"))
            return activeSymbols;
        return ["BTCUSDT", ...activeSymbols];
    }, [activeSymbols]);
    const engineConfig = useMemo(() => {
        const baseConfig = {};
        const strictness = settings.entryStrictness === "base"
            ? "ultra"
            : settings.entryStrictness;
        if (settings.riskMode === "ai-matic" || settings.riskMode === "ai-matic-tree") {
            return {
                ...baseConfig,
                strategyProfile: settings.riskMode === "ai-matic" ? "ai-matic" : "ai-matic-tree",
                baseTimeframe: "1h",
                signalTimeframe: "5m",
                aiMaticMultiTf: true,
                aiMaticHtfTimeframe: "1h",
                aiMaticMidTimeframe: "15m",
                aiMaticEntryTimeframe: "5m",
                aiMaticExecTimeframe: "1m",
                entryStrictness: strictness,
                partialSteps: [
                    { r: 1.0, exitFraction: 0.35 },
                    { r: 2.0, exitFraction: 0.25 },
                ],
                adxThreshold: 20,
                aggressiveAdxThreshold: 28,
                minAtrFractionOfPrice: 0.0004,
                atrEntryMultiplier: 1.6,
                entryStopMode: "swing",
                entrySwingBackoffAtr: 1.0,
                swingBackoffAtr: 0.6,
                liquiditySweepVolumeMult: 1.0,
                volExpansionAtrMult: 1.15,
                volExpansionVolMult: 1.1,
                cooldownBars: 0,
            };
        }
        if (settings.riskMode === "ai-matic-scalp") {
            const strictness = settings.entryStrictness === "base"
                ? "ultra"
                : settings.entryStrictness;
            return {
                ...baseConfig,
                strategyProfile: "ai-matic-scalp",
                baseTimeframe: "15m",
                signalTimeframe: "1m",
                entryStrictness: strictness,
                cooldownBars: 0,
            };
        }
        if (settings.riskMode === "ai-matic-x") {
            return {
                ...baseConfig,
                strategyProfile: "ai-matic-x",
                partialSteps: [
                    { r: 1.0, exitFraction: 0.35 },
                    { r: 2.0, exitFraction: 0.25 },
                ],
                cooldownBars: 0,
            };
        }
        if (settings.riskMode === "ai-matic-pro") {
            return {
                ...baseConfig,
                strategyProfile: "ai-matic-pro",
                baseTimeframe: "1h",
                signalTimeframe: "5m",
                entryStrictness: "base",
                cooldownBars: 0,
            };
        }
        return baseConfig;
    }, [settings.entryStrictness, settings.riskMode]);
    const [positions, setPositions] = useState(null);
    const [orders, setOrders] = useState(null);
    const [trades, setTrades] = useState(null);
    const [logEntries, setLogEntries] = useState(null);
    const [scanDiagnostics, setScanDiagnostics] = useState(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState(() => loadPnlHistory());
    const [closedPnlRecords, setClosedPnlRecords] = useState(null);
    const [walletSnapshot, setWalletSnapshot] = useState(null);
    const [ordersError, setOrdersError] = useState(null);
    const [systemError, setSystemError] = useState(null);
    const [recentErrors, setRecentErrors] = useState([]);
    const [lastLatencyMs, setLastLatencyMs] = useState(null);
    const [lastSuccessAt, setLastSuccessAt] = useState(null);
    const fastPollRef = useRef(false);
    const slowPollRef = useRef(false);
    const orderSnapshotRef = useRef(new Map());
    const positionSnapshotRef = useRef(new Map());
    const execSeenRef = useRef(new Set());
    const pnlSeenRef = useRef(new Set());
    const lastLossBySymbolRef = useRef(new Map());
    const lastCloseBySymbolRef = useRef(new Map());
    const lastIntentBySymbolRef = useRef(new Map());
    const entryOrderLockRef = useRef(new Map());
    const signalLogThrottleRef = useRef(new Map());
    const skipLogThrottleRef = useRef(new Map());
    const fastOkRef = useRef(false);
    const slowOkRef = useRef(false);
    const modeRef = useRef(mode);
    const positionsRef = useRef([]);
    const ordersRef = useRef([]);
    const cancelingOrdersRef = useRef(new Set());
    const autoCloseCooldownRef = useRef(new Map());
    const partialExitRef = useRef(new Map());
    const proTargetsRef = useRef(new Map());
    const proPartialRef = useRef(new Map());
    const decisionRef = useRef({});
    const signalSeenRef = useRef(new Set());
    const intentPendingRef = useRef(new Set());
    const trailingSyncRef = useRef(new Map());
    const trailOffsetRef = useRef(new Map());
    const aiMaticTp1Ref = useRef(new Map());
    const aiMaticTrailCooldownRef = useRef(new Map());
    const aiMaticStructureLogRef = useRef(new Map());
    const settingsRef = useRef(settings);
    const walletRef = useRef(walletSnapshot);
    const handleDecisionRef = useRef(null);
    const feedLogRef = useRef(null);
    const logDedupeRef = useRef(new Map());
    const gateOverridesRef = useRef({});
    const feedLastTickRef = useRef(0);
    const lastHeartbeatRef = useRef(0);
    const lastStateRef = useRef(new Map());
    const lastRestartRef = useRef(0);
    const [feedEpoch, setFeedEpoch] = useState(0);
    const symbolTickRef = useRef(new Map());
    useEffect(() => {
        persistSettings(settings);
    }, [settings]);
    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);
    useEffect(() => {
        walletRef.current = walletSnapshot;
    }, [walletSnapshot]);
    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);
    useEffect(() => {
        if (positions)
            positionsRef.current = positions;
    }, [positions]);
    useEffect(() => {
        if (orders)
            ordersRef.current = orders;
    }, [orders]);
    const fetchJson = useCallback(async (path, params) => {
        if (!authToken) {
            throw new Error("missing_auth_token");
        }
        const qs = params ? `?${new URLSearchParams(params)}` : "";
        const url = `${apiBase}${path}${qs}`;
        const started = performance.now();
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${authToken}` },
        });
        const json = await res.json().catch(() => ({}));
        const latency = Math.round(performance.now() - started);
        setLastLatencyMs(latency);
        if (!res.ok || json?.ok === false) {
            throw new Error(json?.error || `HTTP_${res.status}`);
        }
        return json?.data ?? json;
    }, [apiBase, authToken]);
    const postJson = useCallback(async (path, body) => {
        if (!authToken) {
            throw new Error("missing_auth_token");
        }
        const url = `${apiBase}${path}`;
        const started = performance.now();
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(body ?? {}),
        });
        const json = await res.json().catch(() => ({}));
        const latency = Math.round(performance.now() - started);
        setLastLatencyMs(latency);
        if (!res.ok || json?.ok === false) {
            throw new Error(json?.error || `HTTP_${res.status}`);
        }
        return json?.data ?? json;
    }, [apiBase, authToken]);
    const addLogEntries = useCallback((entries) => {
        if (!entries.length)
            return;
        const dedupe = logDedupeRef.current;
        const now = Date.now();
        const filtered = [];
        for (const entry of entries) {
            const key = `${entry.action}:${entry.message}`;
            const last = dedupe.get(key);
            if (last && now - last < LOG_DEDUPE_WINDOW_MS)
                continue;
            dedupe.set(key, now);
            filtered.push(entry);
        }
        if (dedupe.size > 1000) {
            for (const [key, ts] of dedupe.entries()) {
                if (now - ts > 60_000)
                    dedupe.delete(key);
            }
        }
        if (!filtered.length)
            return;
        setLogEntries((prev) => {
            const list = prev ? [...prev] : [];
            const map = new Map(list.map((entry) => [entry.id, entry]));
            for (const entry of filtered) {
                map.set(entry.id, entry);
            }
            const merged = Array.from(map.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return merged.slice(0, 200);
        });
    }, []);
    const isGateEnabled = useCallback((name) => {
        const value = gateOverridesRef.current?.[name];
        return typeof value === "boolean" ? value : true;
    }, []);

    const evaluateChecklistPass = useCallback((gates) => {
        const eligible = gates.filter((gate) => isGateEnabled(gate.name) && gate.detail !== "not required");
        const passed = eligible.filter((gate) => gate.ok).length;
        return {
            eligibleCount: eligible.length,
            passedCount: passed,
            pass: eligible.length > 0 ? passed >= MIN_CHECKLIST_PASS : false,
        };
    }, [isGateEnabled]);

    const buildChecklistSignal = useCallback((symbol, decision, now) => {
        const core = decision?.coreV2;
        if (!core)
            return null;
        const normalizedEntry = toNumber(core.ltfClose);
        const normalizedAtr = toNumber(core.atr14);
        const normalizedPivotLow = toNumber(core.pivotLow);
        const normalizedPivotHigh = toNumber(core.pivotHigh);
        if (!Number.isFinite(normalizedEntry) || normalizedEntry <= 0)
            return null;
        let scale = 1;
        if (Number.isFinite(normalizedPivotLow) && normalizedPivotLow > 0) {
            const ratio = Math.max(normalizedPivotLow, normalizedEntry) /
                Math.min(normalizedPivotLow, normalizedEntry);
            if (ratio >= 5)
                scale = normalizedEntry / normalizedPivotLow;
        }
        else if (Number.isFinite(normalizedPivotHigh) && normalizedPivotHigh > 0) {
            const ratio = Math.max(normalizedPivotHigh, normalizedEntry) /
                Math.min(normalizedPivotHigh, normalizedEntry);
            if (ratio >= 5)
                scale = normalizedEntry / normalizedPivotHigh;
        }
        const bias = core.htfBias !== "NONE"
            ? core.htfBias
            : core.ema15mTrend !== "NONE"
                ? core.ema15mTrend
                : core.emaCrossDir !== "NONE"
                    ? core.emaCrossDir
                    : "NONE";
        if (bias === "NONE")
            return null;
        const entry = normalizedEntry;
        if (!Number.isFinite(entry) || entry <= 0)
            return null;
        const atr = Number.isFinite(normalizedAtr) ? normalizedAtr * scale : Number.NaN;
        const fallbackOffset = Number.isFinite(atr) && atr > 0 ? atr * 1.5 : Number.NaN;
        let sl = bias === "BULL"
            ? (Number.isFinite(normalizedPivotLow) ? normalizedPivotLow * scale : Number.NaN)
            : (Number.isFinite(normalizedPivotHigh) ? normalizedPivotHigh * scale : Number.NaN);
        if (!Number.isFinite(sl) || sl <= 0) {
            if (!Number.isFinite(fallbackOffset))
                return null;
            sl = bias === "BULL" ? entry - fallbackOffset : entry + fallbackOffset;
        }
        if (!Number.isFinite(sl) || sl <= 0 || sl === entry)
            return null;
        const risk = Math.abs(entry - sl);
        const tp = bias === "BULL" ? entry + 2 * risk : entry - 2 * risk;
        if (!Number.isFinite(tp) || tp <= 0)
            return null;
        return {
            id: `${symbol}-${now}-checklist`,
            symbol,
            intent: {
                side: bias === "BULL" ? "buy" : "sell",
                entry,
                sl,
                tp,
            },
            entryType: "LIMIT_MAKER_FIRST",
            kind: "PULLBACK",
            risk: 0.6,
            message: "Checklist auto-signal",
            createdAt: new Date(now).toISOString(),
        };
    }, []);
    const normalizeBias = useCallback((value) => {
        const raw = String(value ?? "").trim().toLowerCase();
        if (!raw)
            return null;
        if (raw === "buy" || raw === "long" || raw === "bull")
            return "bull";
        if (raw === "sell" || raw === "short" || raw === "bear")
            return "bear";
        return null;
    }, []);
    const isEntryOrder = useCallback((order) => {
        if (!order)
            return false;
        const reduceOnly = Boolean(order?.reduceOnly ?? order?.reduce_only ?? order?.reduce);
        if (reduceOnly)
            return false;
        const filter = String(order?.orderFilter ?? order?.order_filter ?? "").toLowerCase();
        const stopType = String(order?.stopOrderType ?? order?.stop_order_type ?? "").toLowerCase();
        if (filter === "tpsl" || stopType === "takeprofit" || stopType === "stoploss" || stopType === "trailingstop") {
            return false;
        }
        const status = String(order?.status ?? "").toLowerCase();
        if (!status)
            return true;
        if (status.includes("filled") || status.includes("cancel") || status.includes("reject")) {
            return false;
        }
        return true;
    }, []);

    const isActiveEntryOrder = useCallback((order) => {
        if (!isEntryOrder(order))
            return false;
        const status = String(order?.status ?? "").toLowerCase();
        if (!status)
            return false;
        return (status.includes("new") ||
            status.includes("open") ||
            status.includes("partially") ||
            status.includes("created") ||
            status.includes("trigger") ||
            status.includes("active"));
    }, [isEntryOrder]);
    const getOpenBiasState = useCallback(() => {
        const biases = new Set();
        let btcBias = null;
        positionsRef.current.forEach((p) => {
            const size = toNumber(p.size ?? p.qty);
            if (!Number.isFinite(size) || size <= 0)
                return;
            const bias = normalizeBias(p.side);
            if (!bias)
                return;
            biases.add(bias);
            if (String(p.symbol ?? "").toUpperCase() === "BTCUSDT" && !btcBias) {
                btcBias = bias;
            }
        });
        ordersRef.current.forEach((o) => {
            if (!isEntryOrder(o))
                return;
            const bias = normalizeBias(o.side);
            if (!bias)
                return;
            biases.add(bias);
            if (String(o.symbol ?? "").toUpperCase() === "BTCUSDT" && !btcBias) {
                btcBias = bias;
            }
        });
        return { biases, btcBias };
    }, [isEntryOrder, normalizeBias]);
    const resolveBtcBias = useCallback((fallbackDir, symbolUpper) => {
        const { btcBias: openBtcBias } = getOpenBiasState();
        let btcBias = openBtcBias ?? null;
        if (!btcBias) {
            const btcDecision = decisionRef.current["BTCUSDT"]?.decision;
            const btcConsensus = btcDecision?.htfTrend?.consensus;
            const btcDir = btcConsensus === "bull" || btcConsensus === "bear"
                ? btcConsensus
                : String(btcDecision?.trend ?? "").toLowerCase();
            if (btcDir === "bull" || btcDir === "bear") {
                btcBias = btcDir;
            }
        }
        if (!btcBias && symbolUpper === "BTCUSDT" && fallbackDir) {
            btcBias = fallbackDir;
        }
        return btcBias;
    }, [getOpenBiasState]);
    const getEquityValue = useCallback(() => {
        const wallet = walletRef.current;
        const availableBalance = toNumber(wallet?.availableBalance);
        if (useTestnet && Number.isFinite(availableBalance) && availableBalance > 0) {
            return availableBalance;
        }
        const totalEquity = toNumber(wallet?.totalEquity);
        if (Number.isFinite(totalEquity) && totalEquity > 0)
            return totalEquity;
        const totalWalletBalance = toNumber(wallet?.totalWalletBalance);
        if (Number.isFinite(totalWalletBalance) && totalWalletBalance > 0) {
            return totalWalletBalance;
        }
        if (Number.isFinite(availableBalance) && availableBalance > 0) {
            return availableBalance;
        }
        return Number.NaN;
    }, [useTestnet]);
    const isSessionAllowed = useCallback((_now, _next) => true, []);
    const computeNotionalForSignal = useCallback((symbol, entry, sl) => {
        const equity = getEquityValue();
        if (!Number.isFinite(equity) || equity <= 0) {
            return { ok: false, reason: "missing_equity" };
        }
        const riskPerUnit = Math.abs(entry - sl);
        if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
            return { ok: false, reason: "invalid_sl_distance" };
        }
        const settings = settingsRef.current;
        const riskPct = CORE_V2_RISK_PCT[settings.riskMode] ?? 0;
        const riskBudget = equity * riskPct;
        if (!Number.isFinite(riskBudget) || riskBudget <= 0) {
            return { ok: false, reason: "invalid_risk_budget" };
        }
        let qty = riskBudget / riskPerUnit;
        let notional = qty * entry;
        if (!Number.isFinite(notional) || notional <= 0) {
            return { ok: false, reason: "invalid_notional" };
        }
        const notionalCap = equity * CORE_V2_NOTIONAL_CAP_PCT;
        if (Number.isFinite(notionalCap) && notionalCap > 0 && notional > notionalCap) {
            notional = notionalCap;
            qty = notional / entry;
        }
        if (notional < MIN_POSITION_NOTIONAL_USD) {
            return { ok: false, reason: "below_min_notional" };
        }
        if (notional > MAX_POSITION_NOTIONAL_USD) {
            notional = MAX_POSITION_NOTIONAL_USD;
            qty = notional / entry;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
            return { ok: false, reason: "invalid_qty" };
        }
        const riskUsd = riskPerUnit * qty;
        return { ok: true, notional, qty, riskUsd, equity };
    }, [getEquityValue]);
    const computeFixedSizing = useCallback((symbol, entry, sl) => {
        if (!useTestnet)
            return null;
        if (!Number.isFinite(entry) || entry <= 0) {
            return { ok: false, reason: "invalid_entry" };
        }
        const targetNotional = Math.min(Math.max(resolveOrderNotional(symbol), MIN_POSITION_NOTIONAL_USD), MAX_POSITION_NOTIONAL_USD);
        const resolvedQty = targetNotional / entry;
        if (!Number.isFinite(resolvedQty) || resolvedQty <= 0) {
            return { ok: false, reason: "invalid_fixed_qty" };
        }
        const notional = resolvedQty * entry;
        if (!Number.isFinite(notional) || notional <= 0) {
            return { ok: false, reason: "invalid_fixed_notional" };
        }
        const riskPerUnit = Math.abs(entry - sl);
        const riskUsd = Number.isFinite(riskPerUnit) && riskPerUnit > 0
            ? riskPerUnit * resolvedQty
            : Number.NaN;
        const equity = getEquityValue();
        let adjustedNotional = notional;
        let adjustedQty = resolvedQty;
        return { ok: true, notional: adjustedNotional, qty: adjustedQty, riskUsd, equity };
    }, [getEquityValue, useTestnet]);
    const computeTrailingPlan = useCallback((entry, sl, side, symbol) => {
        const settings = settingsRef.current;
        const isScalpProfile = settings.riskMode === "ai-matic-scalp";
        const symbolMode = TRAIL_SYMBOL_MODE[symbol];
        const forceTrail = settings.riskMode === "ai-matic" ||
            settings.riskMode === "ai-matic-x" ||
            settings.riskMode === "ai-matic-tree";
        if (isScalpProfile)
            return null;
        if (symbolMode === "off")
            return null;
        if (!forceTrail && !settings.lockProfitsWithTrail && symbolMode !== "on") {
            return null;
        }
        const normalized = normalizeProtectionLevels(entry, side, sl);
        const normalizedSl = Number.isFinite(normalized.sl) ? normalized.sl : sl;
        const r = Math.abs(entry - normalizedSl);
        if (!Number.isFinite(r) || r <= 0)
            return null;
        const profile = TRAIL_PROFILE_BY_RISK_MODE[settings.riskMode] ??
            TRAIL_PROFILE_BY_RISK_MODE["ai-matic"];
        const activateR = profile.activateR;
        const lockR = profile.lockR;
        const overrideRate = trailOffsetRef.current.get(symbol);
        const usePercentActivation = isScalpProfile ||
            (settings.riskMode === "ai-matic-tree" &&
                Number.isFinite(overrideRate) &&
                overrideRate > 0);
        const effectiveRate = Number.isFinite(overrideRate) && overrideRate > 0
            ? overrideRate
            : profile.retracementRate;
        const minDistance = resolveMinProtectionDistance(entry);
        const rawDistance = Number.isFinite(effectiveRate)
            ? entry * effectiveRate
            : Math.abs(activateR - lockR) * r;
        const distance = Math.max(rawDistance, minDistance);
        if (!Number.isFinite(distance) || distance <= 0)
            return null;
        const dir = side === "Buy" ? 1 : -1;
        const activePrice = usePercentActivation
            ? entry + dir * distance
            : entry + dir * Math.max(activateR * TRAIL_ACTIVATION_R_MULTIPLIER * r, minDistance);
        if (!Number.isFinite(activePrice) || activePrice <= 0)
            return null;
        return { trailingStop: distance, trailingActivePrice: activePrice };
    }, []);
    const syncTrailingProtection = useCallback(async (positions) => {
        const now = Date.now();
        const seenSymbols = new Set(positions.map((p) => String(p.symbol ?? "")).filter(Boolean));
        for (const symbol of trailingSyncRef.current.keys()) {
            if (!seenSymbols.has(symbol)) {
                trailingSyncRef.current.delete(symbol);
            }
        }
        for (const symbol of trailOffsetRef.current.keys()) {
            const hasPosition = seenSymbols.has(symbol);
            const hasPending = intentPendingRef.current.has(symbol);
            const hasOrder = ordersRef.current.some((order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol);
            if (!hasPosition && !hasOrder && !hasPending) {
                trailOffsetRef.current.delete(symbol);
            }
        }
        for (const symbol of aiMaticTp1Ref.current.keys()) {
            const hasPosition = seenSymbols.has(symbol);
            const hasPending = intentPendingRef.current.has(symbol);
            const hasOrder = ordersRef.current.some((order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol);
            if (!hasPosition && !hasOrder && !hasPending) {
                aiMaticTp1Ref.current.delete(symbol);
                aiMaticTrailCooldownRef.current.delete(symbol);
            }
        }
        for (const symbol of proTargetsRef.current.keys()) {
            const hasPosition = seenSymbols.has(symbol);
            const hasPending = intentPendingRef.current.has(symbol);
            const hasOrder = ordersRef.current.some((order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol);
            if (!hasPosition && !hasOrder && !hasPending) {
                proTargetsRef.current.delete(symbol);
            }
        }
        const activePositionKeys = new Set(positions
            .map((pos) => String(pos.positionId || pos.id || `${pos.symbol}:${pos.openedAt}`))
            .filter(Boolean));
        for (const key of partialExitRef.current.keys()) {
            if (!activePositionKeys.has(key)) {
                partialExitRef.current.delete(key);
            }
        }
        for (const key of proPartialRef.current.keys()) {
            if (!activePositionKeys.has(key)) {
                proPartialRef.current.delete(key);
            }
        }
        for (const pos of positions) {
            const symbol = String(pos.symbol ?? "");
            if (!symbol)
                continue;
            const settings = settingsRef.current;
            const isScalpProfile = settings.riskMode === "ai-matic-scalp";
            const isProProfile = settings.riskMode === "ai-matic-pro";
            const positionKey = String(pos.positionId || pos.id || `${pos.symbol}:${pos.openedAt}`);
            const currentTrail = toNumber(pos.currentTrailingStop);
            const entry = toNumber(pos.entryPrice);
            const sl = toNumber(pos.sl);
            if (!Number.isFinite(entry) ||
                !Number.isFinite(sl) ||
                entry <= 0 ||
                sl <= 0) {
                continue;
            }
            const side = pos.side === "Sell" ? "Sell" : "Buy";
            if (isProProfile && positionKey) {
                const price = toNumber(pos.markPrice);
                const sizeRaw = Math.abs(toNumber(pos.size ?? pos.qty));
                let proState = proPartialRef.current.get(positionKey);
                if (!proState) {
                    const seed = proTargetsRef.current.get(symbol);
                    if (seed &&
                        Number.isFinite(seed.entryPrice) &&
                        Number.isFinite(entry) &&
                        Math.abs(seed.entryPrice - entry) / entry <= 0.01) {
                        proState = {
                            t1: seed.t1,
                            t2: seed.t2,
                            timeStopMinutes: seed.timeStopMinutes,
                            entryPrice: seed.entryPrice,
                            side: seed.side,
                            t1Taken: false,
                            lastAttempt: 0,
                        };
                        proPartialRef.current.set(positionKey, proState);
                    }
                }
                if (proState) {
                    const openedAtMs = Date.parse(pos.openedAt);
                    if (Number.isFinite(openedAtMs) &&
                        proState.timeStopMinutes > 0 &&
                        now - openedAtMs >= proState.timeStopMinutes * 60_000 &&
                        now - proState.lastAttempt >= 30_000) {
                        proState.lastAttempt = now;
                        proPartialRef.current.set(positionKey, proState);
                        try {
                            await postJson("/order", {
                                symbol,
                                side: side === "Buy" ? "Sell" : "Buy",
                                qty: sizeRaw,
                                orderType: "Market",
                                reduceOnly: true,
                                timeInForce: "IOC",
                                positionIdx: Number.isFinite(pos.positionIdx)
                                    ? pos.positionIdx
                                    : undefined,
                            });
                            addLogEntries([
                                {
                                    id: `pro-timestop:${symbol}:${now}`,
                                    timestamp: new Date(now).toISOString(),
                                    action: "STATUS",
                                    message: `${symbol} PRO time stop -> EXIT`,
                                },
                            ]);
                        }
                        catch (err) {
                            addLogEntries([
                                {
                                    id: `pro-timestop:error:${symbol}:${now}`,
                                    timestamp: new Date(now).toISOString(),
                                    action: "ERROR",
                                    message: `${symbol} PRO time stop failed: ${asErrorMessage(err)}`,
                                },
                            ]);
                        }
                        continue;
                    }
                    const t1Hit = Number.isFinite(price) &&
                        Number.isFinite(proState.t1) &&
                        (side === "Buy" ? price >= proState.t1 : price <= proState.t1);
                    if (t1Hit &&
                        !proState.t1Taken &&
                        now - proState.lastAttempt >= 30_000 &&
                        Number.isFinite(sizeRaw) &&
                        sizeRaw > 0) {
                        proState.lastAttempt = now;
                        const reduceQty = Math.min(sizeRaw, sizeRaw * 0.6);
                        try {
                            await postJson("/order", {
                                symbol,
                                side: side === "Buy" ? "Sell" : "Buy",
                                qty: reduceQty,
                                orderType: "Market",
                                reduceOnly: true,
                                timeInForce: "IOC",
                                positionIdx: Number.isFinite(pos.positionIdx)
                                    ? pos.positionIdx
                                    : undefined,
                            });
                            proState.t1Taken = true;
                            proPartialRef.current.set(positionKey, proState);
                            const minDistance = resolveMinProtectionDistance(entry);
                            const beSl = side === "Buy" ? entry - minDistance : entry + minDistance;
                            await postJson("/protection", {
                                symbol,
                                sl: beSl,
                                positionIdx: Number.isFinite(pos.positionIdx)
                                    ? pos.positionIdx
                                    : undefined,
                            });
                            addLogEntries([
                                {
                                    id: `pro-t1:${symbol}:${now}`,
                                    timestamp: new Date(now).toISOString(),
                                    action: "STATUS",
                                    message: `${symbol} PRO T1 partial 60% + BE`,
                                },
                            ]);
                        }
                        catch (err) {
                            addLogEntries([
                                {
                                    id: `pro-t1:error:${symbol}:${now}`,
                                    timestamp: new Date(now).toISOString(),
                                    action: "ERROR",
                                    message: `${symbol} PRO T1 partial failed: ${asErrorMessage(err)}`,
                                },
                            ]);
                        }
                    }
                }
            }
            if (!isScalpProfile && !isProProfile && positionKey) {
                const partialState = partialExitRef.current.get(positionKey);
                const lastAttempt = partialState?.lastAttempt ?? 0;
                const price = toNumber(pos.markPrice);
                const rMultiple = Number.isFinite(price) && Number.isFinite(sl)
                    ? computeRMultiple(entry, sl, price, side)
                    : Number.NaN;
                if (Number.isFinite(rMultiple) &&
                    rMultiple >= NONSCALP_PARTIAL_TAKE_R &&
                    (!partialState || !partialState.taken) &&
                    now - lastAttempt >= NONSCALP_PARTIAL_COOLDOWN_MS) {
                    partialExitRef.current.set(positionKey, {
                        taken: false,
                        lastAttempt: now,
                    });
                    const sizeRaw = Math.abs(toNumber(pos.size ?? pos.qty));
                    const reduceQty = Math.min(sizeRaw, sizeRaw * NONSCALP_PARTIAL_FRACTION);
                    if (Number.isFinite(reduceQty) && reduceQty > 0) {
                        const closeSide = side === "Buy" ? "Sell" : "Buy";
                        try {
                            await postJson("/order", {
                                symbol,
                                side: closeSide,
                                qty: reduceQty,
                                orderType: "Market",
                                reduceOnly: true,
                                timeInForce: "IOC",
                                positionIdx: Number.isFinite(pos.positionIdx)
                                    ? pos.positionIdx
                                    : undefined,
                            });
                            partialExitRef.current.set(positionKey, {
                                taken: true,
                                lastAttempt: now,
                            });
                            const minDistance = resolveMinProtectionDistance(entry);
                            const beSl = side === "Buy" ? entry - minDistance : entry + minDistance;
                            await postJson("/protection", {
                                symbol,
                                sl: beSl,
                                positionIdx: Number.isFinite(pos.positionIdx)
                                    ? pos.positionIdx
                                    : undefined,
                            });
                            addLogEntries([
                                {
                                    id: `partial:non-scalp:${symbol}:${now}`,
                                    timestamp: new Date(now).toISOString(),
                                    action: "STATUS",
                                    message: `${symbol} partial ${Math.round(NONSCALP_PARTIAL_FRACTION * 100)}% @ ${NONSCALP_PARTIAL_TAKE_R}R + BE`,
                                },
                            ]);
                        }
                        catch (err) {
                            addLogEntries([
                                {
                                    id: `partial:non-scalp:error:${symbol}:${now}`,
                                    timestamp: new Date(now).toISOString(),
                                    action: "ERROR",
                                    message: `${symbol} partial failed: ${asErrorMessage(err)}`,
                                },
                            ]);
                        }
                    }
                }
            }
            if (Number.isFinite(currentTrail) && currentTrail > 0) {
                trailingSyncRef.current.delete(symbol);
                continue;
            }
            const plan = computeTrailingPlan(entry, sl, side, symbol);
            if (!plan)
                continue;
            const lastAttempt = trailingSyncRef.current.get(symbol);
            if (lastAttempt && now - lastAttempt < TS_VERIFY_INTERVAL_MS) {
                continue;
            }
            trailingSyncRef.current.set(symbol, now);
            try {
                await postJson("/protection", {
                    symbol,
                    trailingStop: plan.trailingStop,
                    trailingActivePrice: plan.trailingActivePrice,
                    positionIdx: Number.isFinite(pos.positionIdx)
                        ? pos.positionIdx
                        : 0,
                });
                addLogEntries([
                    {
                        id: `trail:set:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `${symbol} TS nastaven | aktivace ${formatNumber(plan.trailingActivePrice ?? Number.NaN, 6)} | distance ${formatNumber(plan.trailingStop ?? Number.NaN, 6)}`,
                    },
                ]);
            }
            catch (err) {
                addLogEntries([
                    {
                        id: `trail:error:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "ERROR",
                        message: `${symbol} TS update failed: ${asErrorMessage(err)}`,
                    },
                ]);
            }
        }
    }, [addLogEntries, computeTrailingPlan, isEntryOrder, postJson]);
    const getSymbolContext = useCallback((symbol, decision) => {
        const settings = settingsRef.current;
        const now = new Date();
        const sessionOk = isSessionAllowed(now, settings);
        const maxPositions = toNumber(settings.maxOpenPositions);
        const pendingIntents = intentPendingRef.current.size;
        const openPositionsCount = positionsRef.current.length + (useTestnet ? 0 : pendingIntents);
        const maxPositionsOk = !Number.isFinite(maxPositions)
            ? true
            : maxPositions > 0
                ? openPositionsCount < maxPositions
                : false;
        const hasPosition = positionsRef.current.some((p) => {
            if (p.symbol !== symbol)
                return false;
            const size = toNumber(p.size ?? p.qty);
            return Number.isFinite(size) && size > 0;
        });
        const openOrdersCount = ordersRef.current.length + (useTestnet ? 0 : pendingIntents);
        const maxOrders = toNumber(settings.maxOpenOrders);
        const ordersClearOk = !Number.isFinite(maxOrders)
            ? true
            : maxOrders > 0
                ? openOrdersCount < maxOrders
                : false;
        const engineOk = !(decision?.halted ?? false);
        return {
            settings,
            now,
            sessionOk,
            maxPositionsOk,
            maxPositions,
            maxOrders,
            openPositionsCount,
            hasPosition,
            openOrdersCount,
            ordersClearOk,
            engineOk,
        };
    }, [isSessionAllowed, useTestnet]);
    const resolveTrendGate = useCallback((decision, signal) => {
        const settings = settingsRef.current;
        if (settings.riskMode === "ai-matic-pro") {
            return { ok: true, detail: "disabled (PRO)" };
        }
        const isAiMaticX = settings.riskMode === "ai-matic-x";
        const xContext = decision?.xContext;
        if (isAiMaticX && xContext) {
            const detailParts = [
                `X 1h ${xContext.htfTrend}`,
                `5m ${xContext.ltfTrend}`,
                `setup ${xContext.setup}`,
            ];
            if (xContext.mode)
                detailParts.push(`mode ${xContext.mode}`);
            if (Number.isFinite(xContext.acceptanceCloses) && xContext.acceptanceCloses > 0) {
                detailParts.push(`accept ${xContext.acceptanceCloses}`);
            }
            if (xContext.strongTrendExpanse)
                detailParts.push("expanse");
            if (xContext.riskOff)
                detailParts.push("riskOff");
            const detail = detailParts.join(" | ");
            if (!signal) {
                return { ok: true, detail };
            }
            const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
            const signalDir = sideRaw === "buy" ? "BULL" : sideRaw === "sell" ? "BEAR" : "";
            let ok = Boolean(signalDir);
            if (xContext.setup === "NO_TRADE")
                ok = false;
            if (xContext.setup === "TREND_PULLBACK" || xContext.setup === "TREND_CONTINUATION") {
                if (xContext.htfTrend !== signalDir || xContext.ltfTrend !== signalDir) {
                    ok = false;
                }
            }
            else if (xContext.setup === "RANGE_BREAK_FLIP") {
                const htfOk = xContext.htfTrend === "RANGE" || xContext.htfTrend === signalDir;
                const ltfOk = xContext.ltfTrend === signalDir;
                if (!htfOk || !ltfOk)
                    ok = false;
            }
            else if (xContext.setup === "RANGE_FADE") {
                if (xContext.mode !== "RANGE" && xContext.htfTrend !== "RANGE") {
                    ok = false;
                }
                if (xContext.ltfTrend !== "RANGE")
                    ok = false;
            }
            return { ok, detail };
        }
        const htfTrend = decision?.htfTrend;
        const ltfTrend = decision?.ltfTrend;
        const emaTrend = decision?.emaTrend;
        const htfConsensusRaw = typeof htfTrend?.consensus === "string" ? htfTrend.consensus : "";
        const htfConsensus = htfConsensusRaw === "bull" || htfConsensusRaw === "bear"
            ? htfConsensusRaw
            : "";
        const ltfConsensus = typeof ltfTrend?.consensus === "string" ? ltfTrend.consensus : "";
        const normalizeTrend = (value) => {
            const upper = value.trim().toUpperCase();
            if (!upper || upper === "—")
                return "—";
            if (upper.startsWith("BULL") || upper === "UP")
                return "BULL";
            if (upper.startsWith("BEAR") || upper === "DOWN")
                return "BEAR";
            if (upper.startsWith("RANGE") || upper === "NONE" || upper === "NEUTRAL") {
                return "RANGE";
            }
            return upper;
        };
        const trendRaw = htfConsensusRaw ||
            String(decision?.trendH1 ?? decision?.trend ?? "");
        const htfDir = normalizeTrend(trendRaw);
        let ltfDir = normalizeTrend(ltfConsensus);
        const adx = toNumber(decision?.trendAdx);
        const htfScore = toNumber(htfTrend?.score);
        const score = Number.isFinite(htfScore)
            ? htfScore
            : toNumber(decision?.trendScore);
        const alignedCount = toNumber(htfTrend?.alignedCount);
        const htfStrong = Number.isFinite(alignedCount) && alignedCount >= 2;
        const strong = (Number.isFinite(adx) && adx >= TREND_GATE_STRONG_ADX) ||
            (Number.isFinite(score) && score >= TREND_GATE_STRONG_SCORE) ||
            htfStrong;
        const modeSetting = settings.trendGateMode ?? "adaptive";
        const reverseAllowed = (Number.isFinite(adx) ? adx <= TREND_GATE_REVERSE_ADX : false) &&
            (Number.isFinite(score) ? score <= TREND_GATE_REVERSE_SCORE : false) &&
            !htfStrong;
        let mode = "FOLLOW";
        if (modeSetting === "adaptive") {
            mode = reverseAllowed && !strong ? "REVERSE" : "FOLLOW";
        }
        else if (modeSetting === "reverse") {
            mode = reverseAllowed ? "REVERSE" : "FOLLOW";
        }
        else {
            mode = "FOLLOW";
        }
        if (ltfDir === "RANGE" && Array.isArray(ltfTrend?.byTimeframe)) {
            const dirs = ltfTrend.byTimeframe.map((entry) => String(entry?.result?.direction ?? "none").toLowerCase());
            const hasBull = dirs.includes("bull");
            const hasBear = dirs.includes("bear");
            if (hasBull && hasBear)
                ltfDir = "MIXED";
        }
        const hasLtf = Array.isArray(ltfTrend?.byTimeframe) && ltfTrend.byTimeframe.length > 0;
        const htfIsTrend = htfDir === "BULL" || htfDir === "BEAR";
        const ltfIsTrend = ltfDir === "BULL" || ltfDir === "BEAR";
        const ltfMatchesSignal = (signalDir) => !hasLtf || (ltfIsTrend && ltfDir === signalDir);
        const isAiMaticProfile = settings.riskMode === "ai-matic" || settings.riskMode === "ai-matic-tree";
        const trendLabel = (dir) => {
            if (dir === "BULL")
                return "Bull";
            if (dir === "BEAR")
                return "Bear";
            if (dir === "MIXED")
                return "Mixed";
            return "Range";
        };
        const emaTfLabel = (tf) => {
            if (tf >= 60)
                return `${Math.round(tf / 60)}h`;
            return `${tf}m`;
        };
        const emaFrames = Array.isArray(emaTrend?.byTimeframe)
            ? emaTrend.byTimeframe
            : [];
        const emaByTf = EMA_TREND_TIMEFRAMES_MIN.map((tf) => {
            const entry = emaFrames.find((item) => Number(item?.timeframeMin) === tf);
            return {
                timeframeMin: tf,
                direction: String(entry?.direction ?? "none").toUpperCase(),
                touched: Boolean(entry?.touched),
                confirmed: Boolean(entry?.confirmed),
            };
        });
        const emaDetailParts = emaByTf.map((entry) => {
            const label = trendLabel(entry.direction);
            const touchFlag = entry.touched ? (entry.confirmed ? "*" : "!") : "";
            return `${emaTfLabel(entry.timeframeMin)} ${label}${touchFlag}`;
        });
        const detailParts = isAiMaticProfile
            ? [
                `HTF / 1hod ${trendLabel(htfDir)}`,
                `LTF / 5min ${trendLabel(ltfDir)}`,
            ]
            : [`HTF ${htfDir}`];
        if (!isAiMaticProfile && ltfConsensus) {
            detailParts.push(`LTF ${ltfDir}`);
        }
        if (!isAiMaticProfile && htfConsensus) {
            const total = Array.isArray(htfTrend?.byTimeframe)
                ? htfTrend.byTimeframe.length
                : 0;
            const countLabel = Number.isFinite(alignedCount) && total > 0
                ? ` (${alignedCount}/${total})`
                : "";
            detailParts.push(`Consensus ${htfConsensus.toUpperCase()}${countLabel}`);
        }
        if (!isAiMaticProfile && Number.isFinite(adx)) {
            detailParts.push(`ADX ${formatNumber(adx, 1)}`);
        }
        if (!isAiMaticProfile && Number.isFinite(score)) {
            detailParts.push(`score ${formatNumber(score, 0)}`);
        }
        if (!isAiMaticProfile && Array.isArray(htfTrend?.byTimeframe)) {
            const tfLabel = (tf) => {
                if (tf >= 1440)
                    return `${Math.round(tf / 1440)}D`;
                if (tf >= 60)
                    return `${Math.round(tf / 60)}H`;
                return `${tf}m`;
            };
            const tfParts = htfTrend.byTimeframe.map((entry) => {
                const dir = String(entry?.result?.direction ?? "none").toUpperCase();
                return `${tfLabel(Number(entry?.timeframeMin ?? 0))} ${dir}`;
            });
            if (tfParts.length)
                detailParts.push(`HTF ${tfParts.join(" · ")}`);
        }
        if (!isAiMaticProfile && Array.isArray(ltfTrend?.byTimeframe)) {
            const tfLabel = (tf) => {
                if (tf >= 1440)
                    return `${Math.round(tf / 1440)}D`;
                if (tf >= 60)
                    return `${Math.round(tf / 60)}H`;
                return `${tf}m`;
            };
            const tfParts = ltfTrend.byTimeframe.map((entry) => {
                const dir = String(entry?.result?.direction ?? "none").toUpperCase();
                return `${tfLabel(Number(entry?.timeframeMin ?? 0))} ${dir}`;
            });
            if (tfParts.length)
                detailParts.push(`LTF ${tfParts.join(" · ")}`);
        }
        if (emaDetailParts.length) {
            detailParts.push(`EMA50 ${emaDetailParts.join(" · ")}`);
        }
        if (emaByTf.some((entry) => entry.touched && !entry.confirmed)) {
            detailParts.push("EMA50 touch unconfirmed");
        }
        if (!isAiMaticProfile) {
            detailParts.push(`mode ${mode}${modeSetting === "adaptive" ? " (adaptive)" : ""}`);
        }
        const detail = detailParts.join(" | ");
        if (!signal) {
            return { ok: true, detail };
        }
        const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
        const signalDir = sideRaw === "buy" ? "BULL" : "BEAR";
        const kind = signal.kind ?? "OTHER";
        const isMeanRev = kind === "MEAN_REVERSION";
        const emaTarget = signalDir === "BULL" ? "BULL" : "BEAR";
        const emaAligned = emaByTf.length > 0 &&
            emaByTf.every((entry) => entry.direction === emaTarget);
        const emaTouched = emaByTf.some((entry) => entry.touched);
        const emaConfirmOk = !emaByTf.some((entry) => entry.touched && !entry.confirmed);
        const emaPullbackOk = !emaTouched || kind === "PULLBACK";
        if (!htfIsTrend) {
            return { ok: false, detail };
        }
        if (hasLtf && !ltfIsTrend) {
            return { ok: false, detail };
        }
        if (!emaAligned || !emaConfirmOk || !emaPullbackOk) {
            return { ok: false, detail };
        }
        const ltfOk = ltfMatchesSignal(signalDir);
        let ok = false;
        if (mode === "FOLLOW") {
            ok = signalDir === htfDir && ltfOk;
        }
        else {
            ok = isMeanRev && signalDir !== htfDir && ltfOk;
        }
        return { ok, detail };
    }, []);
    const isBtcDecoupling = useCallback(() => {
        const btcDecision = decisionRef.current["BTCUSDT"]?.decision;
        if (!btcDecision)
            return false;
        const trend = btcDecision?.trend;
        const adx = toNumber(btcDecision?.trendAdx);
        return String(trend).toLowerCase() === "range" && Number.isFinite(adx) && adx < 25;
    }, []);
    const resolveCorrelationGate = useCallback((symbol, now = Date.now(), signal) => {
        const details = [];
        let ok = true;
        const decoupling = isBtcDecoupling();
        const { biases: activeBiases } = getOpenBiasState();
        if (activeBiases.size > 1 && !decoupling) {
            ok = false;
            details.push("mixed open bias");
        }
        const symbolUpper = String(symbol).toUpperCase();
        if (symbolUpper !== "BTCUSDT" && decoupling) {
            return { ok: true, detail: "BTC Range (Decoupling)" };
        }
        if (!signal) {
            details.push("no signal");
            return { ok, detail: details.join(" | ") };
        }
        const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
        const signalDir = sideRaw === "buy" ? "bull" : sideRaw === "sell" ? "bear" : "none";
        if (signalDir === "none") {
            ok = false;
            details.push("signal dir unknown");
            return { ok, detail: details.join(" | ") };
        }
        const btcBias = resolveBtcBias(signalDir, symbolUpper);
        if (!btcBias) {
            ok = false;
            details.push("btc direction unknown");
            return { ok, detail: details.join(" | ") };
        }
        if (activeBiases.size === 1) {
            const [openBias] = Array.from(activeBiases);
            if (openBias !== btcBias) {
                ok = false;
                details.push(`open ${openBias} vs btc ${btcBias}`);
            }
        }
        if (signalDir !== btcBias) {
            ok = false;
            details.push(`signal ${signalDir} vs btc ${btcBias}`);
        }
        else {
            details.push(`btc ${btcBias} aligned`);
        }
        return { ok, detail: details.join(" | ") };
    }, [getOpenBiasState, resolveBtcBias, isBtcDecoupling]);
    const evaluateAiMaticGates = useCallback((symbol, decision, signal) => {
        const correlation = resolveCorrelationGate(symbol, Date.now(), signal);
        const dominanceOk = isBtcDecoupling() || correlation.ok;
        const result = evaluateAiMaticGatesCore({
            decision,
            signal,
            correlationOk: correlation.ok,
            dominanceOk,
        });
        return {
            ...result,
            correlationDetail: correlation.detail,
            dominanceOk,
        };
    }, [resolveCorrelationGate, isBtcDecoupling]);
    const evaluateCoreV2 = useCallback((symbol, decision, signal, feedAgeMs) => {
        const settings = settingsRef.current;
        const core = decision?.coreV2;
        const signalActive = Boolean(signal);
        const sideRaw = String(signal?.intent?.side ?? "").toLowerCase();
        const signalDir = sideRaw === "buy" ? "BULL" : sideRaw === "sell" ? "BEAR" : "";
        const htfConsensusRaw = String(decision?.htfTrend?.consensus ?? "").toLowerCase();
        const htfConsensus = htfConsensusRaw === "bull"
            ? "BULL"
            : htfConsensusRaw === "bear"
                ? "BEAR"
                : "";
        const htfDir = settings.riskMode === "ai-matic-x"
            ? core?.htfBias ?? "NONE"
            : htfConsensus || core?.htfBias || "NONE";
        const direction = signalDir || htfDir || "NONE";
        const isMajor = MAJOR_SYMBOLS.has(symbol);
        const atrMin = isMajor ? CORE_V2_ATR_MIN_PCT_MAJOR : CORE_V2_ATR_MIN_PCT_ALT;
        const volumePct = CORE_V2_VOLUME_PCTL[settings.riskMode];
        const volumeThreshold = core == null
            ? Number.NaN
            : volumePct === 50
                ? core.volumeP50
                : volumePct === 60
                    ? core.volumeP60
                    : volumePct === 65
                        ? core.volumeP65
                        : core.volumeP70;
        const htfBiasOk = direction !== "NONE" &&
            htfDir === direction &&
            (settings.riskMode !== "ai-matic-x" ||
                (Number.isFinite(core?.htfDiffPct) &&
                    core.htfDiffPct >= CORE_V2_HTF_BUFFER_PCT));
        const emaOrderOk = direction === "BULL"
            ? Number.isFinite(core?.ltfClose) &&
                core.ltfClose > core.ema8 &&
                core.ema8 > core.ema21 &&
                core.ema21 > core.ema50
            : direction === "BEAR"
                ? Number.isFinite(core?.ltfClose) &&
                    core.ltfClose < core.ema8 &&
                    core.ema8 < core.ema21 &&
                    core.ema21 < core.ema50
                : false;
        const sep1Ok = Number.isFinite(core?.sep1) && core.sep1 >= CORE_V2_EMA_SEP1_MIN;
        const sep2Ok = Number.isFinite(core?.sep2) && core.sep2 >= CORE_V2_EMA_SEP2_MIN;
        const atrOk = Number.isFinite(core?.atrPct) && core.atrPct >= atrMin;
        const volumeOk = Number.isFinite(core?.volumeCurrent) &&
            Number.isFinite(volumeThreshold) &&
            core.volumeCurrent > volumeThreshold;
        const requireMicro = settings.riskMode === "ai-matic-x";
        const pullbackOk = !requireMicro
            ? true
            : direction === "BULL"
                ? Boolean(core?.pullbackLong)
                : direction === "BEAR"
                    ? Boolean(core?.pullbackShort)
                    : false;
        const pivotOk = !requireMicro
            ? true
            : direction === "BULL"
                ? Number.isFinite(core?.pivotLow) && Number.isFinite(core?.pivotHigh)
                : direction === "BEAR"
                    ? Number.isFinite(core?.pivotHigh) && Number.isFinite(core?.pivotLow)
                    : false;
        const microBreakOk = !requireMicro
            ? true
            : direction === "BULL"
                ? Boolean(core?.microBreakLong)
                : direction === "BEAR"
                    ? Boolean(core?.microBreakShort)
                    : false;
        const bboLimit = resolveBboAgeLimit(symbol);
        const bboFreshOk = feedAgeMs != null;
        const bboAgeOk = feedAgeMs != null && feedAgeMs <= bboLimit;
        const entryType = signal?.entryType ?? "LIMIT_MAKER_FIRST";
        const makerOk = entryType === "LIMIT_MAKER_FIRST" || entryType === "LIMIT";
        const sl = toNumber(signal?.intent?.sl);
        const slOk = !signalActive ? true : Number.isFinite(sl) && sl > 0;
        const adx = toNumber(decision?.trendAdx);
        const htfAtrOk = Number.isFinite(core?.htfAtrPct) && core.htfAtrPct >= atrMin;
        const trendStrengthOk = (Number.isFinite(adx) && adx >= 18) || htfAtrOk;
        const gates = [
            {
                name: "HTF bias",
                ok: htfBiasOk,
                detail: settings.riskMode === "ai-matic-x"
                    ? Number.isFinite(core?.htfEma12) && Number.isFinite(core?.htfEma26)
                        ? `EMA12 ${formatNumber(core.htfEma12, 3)} | EMA26 ${formatNumber(core.htfEma26, 3)} | diff ${formatNumber((core.htfDiffPct ?? 0) * 100, 2)}%`
                        : "missing"
                    : htfConsensus
                        ? `Consensus ${htfConsensus}${Number.isFinite(decision?.htfTrend?.alignedCount)
                            ? ` (${decision?.htfTrend?.alignedCount}/${Array.isArray(decision?.htfTrend?.byTimeframe)
                                ? decision?.htfTrend?.byTimeframe.length
                                : 0})`
                            : ""}`
                        : "missing",
                hard: true,
            },
            {
                name: "EMA order",
                ok: emaOrderOk,
                detail: Number.isFinite(core?.ltfClose)
                    ? `close ${formatNumber(core.ltfClose, 4)} | EMA8 ${formatNumber(core.ema8, 4)} | EMA21 ${formatNumber(core.ema21, 4)} | EMA50 ${formatNumber(core.ema50, 4)}`
                    : "missing",
                hard: true,
            },
            {
                name: "EMA sep1",
                ok: sep1Ok,
                detail: Number.isFinite(core?.sep1)
                    ? `sep1 ${formatNumber(core.sep1, 2)} (min ${CORE_V2_EMA_SEP1_MIN})`
                    : "missing",
                hard: true,
            },
            {
                name: "EMA sep2",
                ok: sep2Ok,
                detail: Number.isFinite(core?.sep2)
                    ? `sep2 ${formatNumber(core.sep2, 2)} (min ${CORE_V2_EMA_SEP2_MIN})`
                    : "missing",
                hard: true,
            },
            {
                name: "ATR% window",
                ok: atrOk,
                detail: Number.isFinite(core?.atrPct)
                    ? `ATR% ${formatNumber(core.atrPct * 100, 3)} (min ${formatNumber(atrMin * 100, 3)})`
                    : "missing",
                hard: true,
            },
            {
                name: "Volume Pxx",
                ok: volumeOk,
                detail: Number.isFinite(core?.volumeCurrent) && Number.isFinite(volumeThreshold)
                    ? `vol ${formatNumber(core.volumeCurrent, 0)} > P${volumePct} ${formatNumber(volumeThreshold, 0)}`
                    : "missing",
                hard: true,
            },
            {
                name: "LTF pullback",
                ok: pullbackOk,
                detail: requireMicro ? (pullbackOk ? "EMA12/26 zone touched" : "no pullback") : "not required",
            },
            {
                name: "Micro pivot",
                ok: pivotOk,
                detail: requireMicro
                    ? Number.isFinite(core?.pivotHigh) || Number.isFinite(core?.pivotLow)
                        ? `pivotHi ${formatNumber(core?.pivotHigh ?? Number.NaN, 4)} | pivotLo ${formatNumber(core?.pivotLow ?? Number.NaN, 4)}`
                        : "missing"
                    : "not required",
            },
            {
                name: "Micro break close",
                ok: microBreakOk,
                detail: requireMicro ? (microBreakOk ? "break confirmed" : "no break") : "not required",
            },
            {
                name: "BBO fresh",
                ok: bboFreshOk,
                detail: feedAgeMs != null ? `age ${Math.round(feedAgeMs)}ms` : "no feed",
            },
            {
                name: "BBO age",
                ok: bboAgeOk,
                detail: feedAgeMs != null ? `${Math.round(feedAgeMs)}ms ≤ ${bboLimit}ms` : "no feed",
            },
            {
                name: "Trend strength",
                ok: trendStrengthOk,
                detail: Number.isFinite(adx) || Number.isFinite(core?.htfAtrPct)
                    ? `ADX ${formatNumber(adx, 1)} | 1h ATR% ${formatNumber((core?.htfAtrPct ?? Number.NaN) * 100, 2)}`
                    : "missing",
            },
            {
                name: "Maker entry",
                ok: makerOk,
                detail: entryType,
            },
            {
                name: "SL structural",
                ok: slOk,
                detail: Number.isFinite(sl)
                    ? `SL ${formatNumber(sl, 6)}`
                    : signalActive
                        ? "SL missing"
                        : "waiting",
                hard: true,
            },
        ];
        const scoreItems = gates;
        const scoreTotal = scoreItems.length;
        const score = scoreItems.filter((g) => g.ok).length;
        const scoreCfg = CORE_V2_SCORE_GATE[settings.riskMode];
        const baseThreshold = isMajor ? scoreCfg.major : scoreCfg.alt;
        const strongTrend = (Number.isFinite(adx) && adx >= 25) ||
            (Number.isFinite(core?.htfAtrPct) && core.htfAtrPct >= atrMin) ||
            decision?.htfTrend?.alignedCount >= 2;
        const threshold = settings.riskMode === "ai-matic-tree"
            ? strongTrend
                ? scoreCfg.major
                : scoreCfg.alt
            : baseThreshold;
        const hardFailures = gates.filter((g) => g.hard && !g.ok).map((g) => g.name);
        const scorePass = scoreTotal > 0 ? score >= threshold : undefined;
        return {
            gates,
            score,
            scoreTotal,
            threshold,
            scorePass,
            hardFailures,
            atrMin,
            volumePct,
            isMajor,
        };
    }, []);
    const evaluateProGates = useCallback((decision, signal) => {
        const regime = decision?.proRegime;
        const profile = decision?.marketProfile;
        const orderflow = decision?.orderflow;
        const hurstOk = Number.isFinite(regime?.hurst) && (regime?.hurst ?? 1) < 0.45;
        const chopOk = Number.isFinite(regime?.chop) && (regime?.chop ?? 0) > 60;
        const hmmOk = Number.isFinite(regime?.hmmProb) && (regime?.hmmProb ?? 0) >= 0.7;
        const vpinOk = Number.isFinite(regime?.vpin ?? orderflow?.vpin) &&
            (regime?.vpin ?? orderflow?.vpin ?? 1) < 0.8;
        const absorptionScore = orderflow?.absorptionScore ?? 0;
        const absorptionOk = Number.isFinite(absorptionScore) && absorptionScore >= 2;
        const ofi = orderflow?.ofi ?? 0;
        const delta = orderflow?.delta ?? 0;
        const ofiPrev = orderflow?.ofiPrev ?? 0;
        const deltaPrev = orderflow?.deltaPrev ?? 0;
        const ofiUp = Number.isFinite(ofi) && ofi > 0;
        const ofiDown = Number.isFinite(ofi) && ofi < 0;
        const deltaUp = Number.isFinite(delta) && delta > 0;
        const deltaDown = Number.isFinite(delta) && delta < 0;
        const ofiFlipUp = ofiUp && ofiPrev <= 0;
        const ofiFlipDown = ofiDown && ofiPrev >= 0;
        const deltaFlipUp = deltaUp && deltaPrev <= 0;
        const deltaFlipDown = deltaDown && deltaPrev >= 0;
        const flowBuy = absorptionOk && ofiUp && deltaUp && (ofiFlipUp || deltaFlipUp);
        const flowSell = absorptionOk && ofiDown && deltaDown && (ofiFlipDown || deltaFlipDown);
        const ofiDeltaOk = flowBuy || flowSell || Boolean(signal);
        const absorptionGateOk = absorptionOk || Boolean(signal);
        const vaOk = Number.isFinite(profile?.vah) &&
            Number.isFinite(profile?.val) &&
            (profile?.vah ?? 0) > 0 &&
            (profile?.val ?? 0) > 0;
        const gates = [
            {
                name: "Hurst < 0.45",
                ok: hurstOk,
                detail: Number.isFinite(regime?.hurst)
                    ? `H ${formatNumber(regime.hurst, 3)}`
                    : "missing",
                hard: false,
            },
            {
                name: "CHOP > 60",
                ok: chopOk,
                detail: Number.isFinite(regime?.chop)
                    ? `CHOP ${formatNumber(regime.chop, 1)}`
                    : "missing",
                hard: false,
            },
            {
                name: "HMM state0 p>=0.7",
                ok: hmmOk,
                detail: Number.isFinite(regime?.hmmProb)
                    ? `p ${formatNumber(regime.hmmProb, 2)}`
                    : "missing",
                hard: false,
            },
            {
                name: "VPIN < 0.8",
                ok: vpinOk,
                detail: Number.isFinite(regime?.vpin ?? orderflow?.vpin)
                    ? `VPIN ${formatNumber((regime?.vpin ?? orderflow?.vpin ?? 0), 2)}`
                    : "missing",
                hard: false,
            },
            {
                name: "Absorption >= 2",
                ok: absorptionGateOk,
                detail: Number.isFinite(absorptionScore)
                    ? `Abs ${formatNumber(absorptionScore, 2)}`
                    : signal
                        ? "signal"
                        : "missing",
                hard: false,
            },
            {
                name: "OFI/Delta absorpce",
                ok: ofiDeltaOk,
                detail: Number.isFinite(orderflow?.ofi) || Number.isFinite(orderflow?.delta)
                    ? `OFI ${formatNumber(orderflow?.ofi ?? 0, 2)} | Δ ${formatNumber(orderflow?.delta ?? 0, 2)}`
                    : signal
                        ? "signal"
                        : "missing",
                hard: false,
            },
            {
                name: "VA edge",
                ok: vaOk,
                detail: Number.isFinite(profile?.vah) && Number.isFinite(profile?.val)
                    ? `VAL ${formatNumber(profile.val, 2)} | VAH ${formatNumber(profile.vah, 2)}`
                    : "missing",
                hard: false,
            },
        ];
        const score = gates.filter((g) => g.ok).length;
        const scoreTotal = gates.length;
        const scorePass = scoreTotal > 0 ? gates.every((g) => g.ok) : true;
        return {
            gates,
            score,
            scoreTotal,
            threshold: scoreTotal,
            scorePass,
            hardFailures: gates.filter((g) => !g.ok).map((g) => g.name),
            atrMin: Number.NaN,
            volumePct: 0,
            isMajor: false,
        };
    }, []);
    const enforceBtcBiasAlignment = useCallback(async (now) => {
        if (!authToken)
            return;
        const btcBias = resolveBtcBias();
        if (!btcBias)
            return;
        const cooldown = autoCloseCooldownRef.current;
        const nextOrders = ordersRef.current;
        const isTriggerEntryOrder = (order) => {
            const filter = String(order?.orderFilter ?? order?.order_filter ?? "").toLowerCase();
            const trigger = toNumber(order?.triggerPrice ?? order?.trigger_price);
            return filter === "stoporder" || (Number.isFinite(trigger) && trigger > 0);
        };
        const cancelTargets = nextOrders.filter((order) => {
            if (!isEntryOrder(order))
                return false;
            if (isTriggerEntryOrder(order))
                return false;
            const bias = normalizeBias(order.side);
            return bias != null && bias !== btcBias;
        });
        if (!cancelTargets.length)
            return;
        for (const order of cancelTargets) {
            const orderId = order.orderId || "";
            const orderLinkId = order.orderLinkId || "";
            const key = orderId || orderLinkId || `ord:${order.symbol}:${order.side}`;
            const last = cooldown.get(key) ?? 0;
            if (now - last < 15000)
                continue;
            cooldown.set(key, now);
            try {
                await postJson("/cancel", {
                    symbol: order.symbol,
                    orderId: orderId || undefined,
                    orderLinkId: orderLinkId || undefined,
                });
                addLogEntries([
                    {
                        id: `btc-bias-cancel:${key}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `BTC bias ${btcBias} -> CANCEL ${order.symbol} ${order.side}`,
                    },
                ]);
            }
            catch (err) {
                addLogEntries([
                    {
                        id: `btc-bias-cancel:error:${key}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "ERROR",
                        message: `BTC bias cancel failed ${order.symbol}: ${asErrorMessage(err)}`,
                    },
                ]);
            }
        }
    }, [addLogEntries, authToken, isEntryOrder, normalizeBias, postJson, resolveBtcBias]);
    const resolveQualityScore = useCallback((symbol, decision, signal, feedAgeMs) => {
        if (!decision)
            return { score: null, threshold: null, pass: undefined };
        const evalResult = evaluateCoreV2(symbol, decision, signal, feedAgeMs);
        return {
            score: Number.isFinite(evalResult.score) ? evalResult.score : null,
            threshold: Number.isFinite(evalResult.threshold) ? evalResult.threshold : null,
            pass: evalResult.scorePass,
        };
    }, [evaluateCoreV2]);
    const resolveSymbolState = useCallback((symbol) => {
        const hasPosition = positionsRef.current.some((p) => {
            if (p.symbol !== symbol)
                return false;
            const size = toNumber(p.size ?? p.qty);
            return Number.isFinite(size) && size > 0;
        });
        if (hasPosition)
            return "HOLD";
        const hasOrders = ordersRef.current.some((o) => isActiveEntryOrder(o) && String(o.symbol ?? "") === symbol);
        if (hasOrders)
            return "HOLD";
        return "SCAN";
    }, [isActiveEntryOrder]);
    const buildScanDiagnostics = useCallback((symbol, decision, lastScanTs) => {
        const context = getSymbolContext(symbol, decision);
        const symbolState = resolveSymbolState(symbol);
        const lastTick = symbolTickRef.current.get(symbol) ?? 0;
        const feedAgeMs = lastTick > 0 ? Math.max(0, Date.now() - lastTick) : null;
        const feedAgeOk = feedAgeMs == null ? null : feedAgeMs <= FEED_AGE_OK_MS;
        const signal = decision?.signal ?? null;
        const isAiMaticProfile = context.settings.riskMode === "ai-matic";
        const aiMaticContext = decision?.aiMatic ?? null;
        const inferredSide = aiMaticContext?.htf?.ema?.bullOk
            ? "buy"
            : aiMaticContext?.htf?.ema?.bearOk
                ? "sell"
                : aiMaticContext?.htf?.structureTrend === "BULL"
                    ? "buy"
                    : aiMaticContext?.htf?.structureTrend === "BEAR"
                        ? "sell"
                        : null;
        const signalForEval = signal ??
            (inferredSide ? { intent: { side: inferredSide } } : null);
        const aiMaticEval = isAiMaticProfile && signalForEval
            ? evaluateAiMaticGates(symbol, decision, signalForEval)
            : null;
        const quality = resolveQualityScore(symbol, decision, signal, feedAgeMs);
        const gates = [];
        const addGate = (name, ok, detail) => {
            gates.push({ name, ok, detail });
        };
        const isProProfile = context.settings.riskMode === "ai-matic-pro";
        const coreEval = isProProfile
            ? evaluateProGates(decision, signal)
            : evaluateCoreV2(symbol, decision, signal, feedAgeMs);
        const core = decision?.coreV2;
        const volumeGate = coreEval.gates.find((g) => g.name === "Volume Pxx");
        const scalpPrimary = computeScalpPrimaryChecklist(core);
        const isScalpProfile = context.settings.riskMode === "ai-matic-scalp";
        const hasEntryOrder = ordersRef.current.some((order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol);
        const hasPendingIntent = intentPendingRef.current.has(symbol);
        const manageReason = context.hasPosition
            ? "open position"
            : hasEntryOrder
                ? "open order"
                : hasPendingIntent
                    ? "pending intent"
                    : null;
        if (isAiMaticProfile) {
            if (aiMaticEval) {
                const hardOkCount = aiMaticEval.hardGates.filter((g) => g.ok).length;
                const hardTotal = aiMaticEval.hardGates.length;
                addGate("Hard: 3 of 6", hardOkCount >= AI_MATIC_HARD_MIN, `${hardOkCount}/${hardTotal}`);
                const entryOkCount = aiMaticEval.entryFactors.filter((g) => g.ok).length;
                addGate("Entry: Any of 5", entryOkCount >= AI_MATIC_ENTRY_FACTOR_MIN, `${entryOkCount}/5`);
                const checklistOkCount = aiMaticEval.checklist.filter((g) => g.ok).length;
                addGate("Checklist: 3 of 7", checklistOkCount >= AI_MATIC_CHECKLIST_MIN, `${checklistOkCount}/7`);
            }
        }
        else {
            coreEval.gates.forEach((gate) => addGate(gate.name, gate.ok, gate.detail));
        }
        if (isScalpProfile) {
            addGate(SCALP_PRIMARY_GATE, scalpPrimary.primaryOk, `15m ${scalpPrimary.trendLongOk
                ? "LONG"
                : scalpPrimary.trendShortOk
                    ? "SHORT"
                    : "NONE"} | LTF ${core?.ltfTimeframeMin ?? "—"}m`);
            addGate(SCALP_ENTRY_GATE, scalpPrimary.entryOk, `${core?.scalpFib
                ? `FIB ${core.scalpFib.hitLevel ?? "—"} | 5m ${core.scalpFib.m5InZone ? "OK" : "no"} | 1m ${core.scalpFib.ltfInZone ? "OK" : "no"}`
                : "FIB —"} | ${core?.scalpConfirm
                ? `OB ${core.scalpConfirm.obTouch ? "OK" : "no"} · GAP ${core.scalpConfirm.gapTouch ? "OK" : "no"} · VP ${core.scalpConfirm.vpConfirm ? "OK" : "no"} · TL ${core.scalpConfirm.tlPullback ? "OK" : "no"}`
                : "Confirm —"}`);
            addGate(SCALP_EXIT_GATE, scalpPrimary.exitOk, Number.isFinite(core?.atr14)
                ? `ATR ${formatNumber(core.atr14, 4)} | TP fib ext`
                : "ATR missing");
        }
        const hardEnabled = isAiMaticProfile ? true : false;
        const softEnabled = isAiMaticProfile
            ? false
            : context.settings.enableSoftGates !== false;
        const hardReasons = [];
        const hardBlocked = isAiMaticProfile && aiMaticEval ? !aiMaticEval.hardPass : false;
        const execEnabled = isGateEnabled("Exec allowed");
        const softBlocked = softEnabled && quality.pass === false;
        const checklist = isAiMaticProfile && aiMaticEval
            ? {
                eligibleCount: aiMaticEval.checklist.length,
                passedCount: aiMaticEval.checklist.filter((g) => g.ok).length,
                pass: aiMaticEval.checklistPass,
            }
            : evaluateChecklistPass(gates);
        const signalActive = Boolean(signal) || checklist.pass;
        let executionAllowed = null;
        let executionReason;
        if (!execEnabled) {
            executionAllowed = false;
            executionReason = "Exec OFF";
        }
        else if (!signalActive) {
            executionAllowed = null;
            executionReason = "čeká na signál";
        }
        else if (isAiMaticProfile && aiMaticEval && !aiMaticEval.pass) {
            const hardCount = aiMaticEval.hardGates.filter((g) => g.ok).length;
            const entryCount = aiMaticEval.entryFactors.filter((g) => g.ok).length;
            const checklistCount = aiMaticEval.checklist.filter((g) => g.ok).length;
            executionAllowed = false;
            executionReason = `AI-MATIC gates hard ${hardCount}/${AI_MATIC_HARD_MIN} · entry ${entryCount}/${AI_MATIC_ENTRY_FACTOR_MIN} · checklist ${checklistCount}/${AI_MATIC_CHECKLIST_MIN}`;
        }
        else if (!checklist.pass) {
            executionAllowed = false;
            executionReason = `Checklist ${checklist.passedCount}/${MIN_CHECKLIST_PASS}`;
        }
        else if (softBlocked) {
            executionAllowed = false;
            executionReason = `Score ${quality.score ?? "—"} / ${quality.threshold ?? "—"}`;
        }
        else {
            executionAllowed = true;
        }
        return {
            symbolState,
            manageReason,
            hasPosition: context.hasPosition,
            hasEntryOrder,
            hasPendingIntent,
            signalActive,
            hardEnabled,
            softEnabled,
            hardBlocked,
            hardBlock: hardBlocked ? hardReasons.join(" · ") : undefined,
            executionAllowed,
            executionReason,
            gates,
            qualityScore: quality.score,
            qualityThreshold: quality.threshold,
            qualityPass: quality.pass,
            proState: decision?.proState ?? null,
            manipActive: decision?.proRegime?.manipActive ?? null,
            liqProximityPct: decision?.proSignals?.liqProximityPct ??
                decision?.orderflow?.liqProximityPct ??
                null,
            lastScanTs,
            feedAgeMs,
            feedAgeOk,
        };
    }, [
        evaluateChecklistPass,
        evaluateCoreV2,
        evaluateProGates,
        getSymbolContext,
        isGateEnabled,
        resolveQualityScore,
        resolveSymbolState,
    ]);
    const refreshDiagnosticsFromDecisions = useCallback(() => {
        const entries = Object.entries(decisionRef.current);
        if (!entries.length)
            return;
        setScanDiagnostics((prev) => {
            const next = { ...(prev ?? {}) };
            for (const [symbol, data] of entries) {
                if (!activeSymbols.includes(symbol))
                    continue;
                next[symbol] = buildScanDiagnostics(symbol, data.decision, data.ts);
            }
            return next;
        });
    }, [activeSymbols, buildScanDiagnostics]);
    const updateGateOverrides = useCallback((overrides) => {
        gateOverridesRef.current = { ...overrides };
        refreshDiagnosticsFromDecisions();
    }, [refreshDiagnosticsFromDecisions]);
    const refreshFast = useCallback(async () => {
        if (fastPollRef.current)
            return;
        fastPollRef.current = true;
        const now = Date.now();
        const results = await Promise.allSettled([
            fetchJson("/positions"),
            fetchJson("/orders", { limit: "50" }),
            fetchJson("/executions", { limit: "50" }),
        ]);
        let sawError = false;
        const newLogs = [];
        const [positionsRes, ordersRes, executionsRes] = results;
        const entryFallbackByKey = ordersRes.status === "fulfilled"
            ? buildEntryFallback(extractList(ordersRes.value))
            : new Map();
        if (positionsRes.status === "fulfilled") {
            const list = extractList(positionsRes.value);
            const prevPositions = positionSnapshotRef.current;
            const nextPositions = new Map();
            const next = list
                .map((p) => {
                const size = toNumber(p?.size ?? p?.qty);
                if (!Number.isFinite(size) || size <= 0)
                    return null;
                const sideRaw = String(p?.side ?? "");
                const side = sideRaw.toLowerCase() === "buy" ? "Buy" : "Sell";
                const symbol = String(p?.symbol ?? "");
                const positionIdxRaw = toNumber(p?.positionIdx);
                const positionIdx = Number.isFinite(positionIdxRaw)
                    ? positionIdxRaw
                    : undefined;
                const entryPrice = toNumber(p?.entryPrice ?? p?.avgEntryPrice ?? p?.avgPrice);
                const unrealized = toNumber(p?.unrealisedPnl ?? p?.unrealizedPnl);
                const openEpoch = toEpoch(p?.openTime);
                const updatedEpoch = toEpoch(p?.updatedTime ?? p?.updated_at);
                const openedAt = Number.isFinite(openEpoch)
                    ? new Date(openEpoch).toISOString()
                    : "";
                const updatedAt = Number.isFinite(updatedEpoch)
                    ? new Date(updatedEpoch).toISOString()
                    : "";
                const triggerFromPos = toNumber(p?.triggerPrice ?? p?.trigger_price);
                const sl = toNumber(p?.stopLoss ?? p?.sl);
                const tp = toNumber(p?.takeProfit ?? p?.tp);
                const trailingStop = toNumber(p?.trailingStop ??
                    p?.trailingStopDistance ??
                    p?.trailingStopPrice ??
                    p?.trailPrice);
                const fallback = entryFallbackByKey.get(`${symbol}:${side}`) ?? null;
                const triggerPrice = Number.isFinite(triggerFromPos)
                    ? triggerFromPos
                    : fallback?.triggerPrice;
                const resolvedEntry = Number.isFinite(entryPrice)
                    ? entryPrice
                    : Number.isFinite(triggerPrice)
                        ? triggerPrice
                        : Number.isFinite(fallback?.price)
                            ? fallback?.price
                            : Number.NaN;
                const rrr = Number.isFinite(resolvedEntry) &&
                    Number.isFinite(sl) &&
                    Number.isFinite(tp) &&
                    resolvedEntry !== sl
                    ? Math.abs(tp - resolvedEntry) /
                        Math.abs(resolvedEntry - sl)
                    : Number.NaN;
                nextPositions.set(symbol, { size, side });
                return {
                    positionId: String(p?.positionId ?? `${p?.symbol}-${sideRaw}`),
                    id: String(p?.positionId ?? ""),
                    symbol,
                    side,
                    qty: size,
                    size,
                    entryPrice: Number.isFinite(resolvedEntry)
                        ? resolvedEntry
                        : Number.NaN,
                    triggerPrice: Number.isFinite(triggerPrice)
                        ? triggerPrice
                        : undefined,
                    sl: Number.isFinite(sl) ? sl : undefined,
                    tp: Number.isFinite(tp) ? tp : undefined,
                    currentTrailingStop: Number.isFinite(trailingStop) && trailingStop > 0
                        ? trailingStop
                        : undefined,
                    unrealizedPnl: Number.isFinite(unrealized)
                        ? unrealized
                        : Number.NaN,
                    openedAt: openedAt || "",
                    rrr: Number.isFinite(rrr) ? rrr : undefined,
                    lastUpdateReason: String(p?.lastUpdateReason ?? "") || undefined,
                    timestamp: updatedAt || openedAt || "",
                    env: useTestnet ? "testnet" : "mainnet",
                    positionIdx,
                };
            })
                .filter((p) => Boolean(p));
            setPositions(next);
            positionsRef.current = next;
            setLastSuccessAt(now);
            void syncTrailingProtection(next);
            for (const [symbol, nextPos] of nextPositions.entries()) {
                const prev = prevPositions.get(symbol);
                if (!prev) {
                    newLogs.push({
                        id: `pos-open:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `POSITION OPEN ${symbol} ${nextPos.side} size ${formatNumber(nextPos.size, 4)}`,
                    });
                    continue;
                }
                if (Number.isFinite(prev.size) && prev.size !== nextPos.size) {
                    newLogs.push({
                        id: `pos-size:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `POSITION SIZE ${symbol} ${formatNumber(prev.size, 4)} → ${formatNumber(nextPos.size, 4)}`,
                    });
                }
            }
        for (const [symbol, prevPos] of prevPositions.entries()) {
            if (!nextPositions.has(symbol)) {
                lastCloseBySymbolRef.current.set(symbol, now);
                newLogs.push({
                    id: `pos-close:${symbol}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                        message: `POSITION CLOSED ${symbol} ${prevPos.side} size ${formatNumber(prevPos.size, 4)}`,
                    });
                }
            }
            positionSnapshotRef.current = nextPositions;
        }
        if (ordersRes.status === "fulfilled") {
            const list = extractList(ordersRes.value);
            const prevOrders = orderSnapshotRef.current;
            const nextOrders = new Map();
            const mapped = list
                .map((o) => {
                const qty = toNumber(o?.qty ?? o?.orderQty ?? o?.leavesQty);
                const price = toNumber(o?.price);
                const triggerPrice = toNumber(o?.triggerPrice ?? o?.trigger_price);
                const orderId = String(o?.orderId ?? o?.orderID ?? o?.id ?? "");
                const orderLinkId = String(o?.orderLinkId ?? o?.order_link_id ?? o?.orderLinkID ?? "");
                const symbol = String(o?.symbol ?? "");
                const side = String(o?.side ?? "Buy");
                const status = String(o?.orderStatus ?? o?.order_status ?? o?.status ?? "");
                const orderType = String(o?.orderType ?? o?.order_type ?? "");
                const stopOrderType = String(o?.stopOrderType ?? o?.stop_order_type ?? "");
                const orderFilter = String(o?.orderFilter ?? o?.order_filter ?? "");
                const reduceOnly = Boolean(o?.reduceOnly ?? o?.reduce_only ?? o?.reduce);
                const entry = {
                    orderId,
                    orderLinkId: orderLinkId || undefined,
                    symbol,
                    side: side,
                    qty: Number.isFinite(qty) ? qty : Number.NaN,
                    price: Number.isFinite(price) ? price : null,
                    triggerPrice: Number.isFinite(triggerPrice) ? triggerPrice : null,
                    orderType: orderType || undefined,
                    stopOrderType: stopOrderType || undefined,
                    orderFilter: orderFilter || undefined,
                    reduceOnly,
                    status,
                    createdTime: toIso(o?.createdTime ?? o?.created_at) || "",
                };
                if (orderId || orderLinkId) {
                    nextOrders.set(orderId || orderLinkId, {
                        status,
                        qty: Number.isFinite(qty) ? qty : Number.NaN,
                        price: Number.isFinite(price) ? price : null,
                        side,
                        symbol,
                        orderLinkId: orderLinkId || undefined,
                    });
                }
                return entry;
            })
                .filter((o) => Boolean(o.orderId || o.orderLinkId));
        const isProtectionOrder = (order) => {
            const stopType = String(order.stopOrderType ?? "").toLowerCase();
            const filter = String(order.orderFilter ?? "").toLowerCase();
            return (order.reduceOnly ||
                filter === "tpsl" ||
                stopType === "takeprofit" ||
                stopType === "stoploss" ||
                stopType === "trailingstop");
        };
        const isTriggerEntryOrder = (order) => {
            const filter = String(order.orderFilter ?? "").toLowerCase();
            const trigger = toNumber(order.triggerPrice);
            return filter === "stoporder" || (Number.isFinite(trigger) && trigger > 0);
        };
        const isNewEntryOrder = (order) => {
            if (isProtectionOrder(order))
                return false;
            const status = String(order.status ?? "").toLowerCase();
            return status === "new" || status === "created";
            };
            const latestNewBySymbol = new Map();
            for (const order of mapped) {
                if (!isNewEntryOrder(order))
                    continue;
                const ts = toEpoch(order.createdTime);
                const resolvedTs = Number.isFinite(ts) ? ts : 0;
                const prev = latestNewBySymbol.get(order.symbol);
                if (!prev || resolvedTs >= prev.ts) {
                    latestNewBySymbol.set(order.symbol, {
                        order,
                        ts: resolvedTs,
                    });
                }
            }
            const latestNewIds = new Map();
            for (const [symbol, data] of latestNewBySymbol.entries()) {
                latestNewIds.set(symbol, {
                    orderId: data.order.orderId,
                    orderLinkId: data.order.orderLinkId,
                });
            }
        const next = mapped.filter((order) => {
            if (!isNewEntryOrder(order))
                return true;
            if (isTriggerEntryOrder(order))
                return true;
            const latest = latestNewIds.get(order.symbol);
            if (!latest)
                return true;
            return ((latest.orderId && order.orderId === latest.orderId) ||
                (latest.orderLinkId && order.orderLinkId === latest.orderLinkId));
        });
        setOrders(next);
        ordersRef.current = next;
        setOrdersError(null);
        setLastSuccessAt(now);
        const activeEntrySymbols = new Set(next
            .filter((order) => isEntryOrder(order))
            .map((order) => String(order.symbol ?? ""))
            .filter(Boolean));
        for (const [symbol, ts] of entryOrderLockRef.current.entries()) {
            const hasEntry = activeEntrySymbols.has(symbol);
            const hasPending = intentPendingRef.current.has(symbol);
            const hasPos = positionsRef.current.some((p) => String(p.symbol ?? "") === symbol);
            if (!hasEntry && !hasPending && !hasPos) {
                entryOrderLockRef.current.delete(symbol);
            }
            else if (!hasEntry && !hasPos && now - ts >= ENTRY_ORDER_LOCK_MS) {
                entryOrderLockRef.current.delete(symbol);
            }
        }
        const cancelTargets = authToken
            ? mapped.filter((order) => {
                if (!isNewEntryOrder(order))
                    return false;
                if (isTriggerEntryOrder(order))
                    return false;
                const latest = latestNewIds.get(order.symbol);
                if (!latest)
                    return false;
                const isLatest = (latest.orderId && order.orderId === latest.orderId) ||
                    (latest.orderLinkId &&
                            order.orderLinkId === latest.orderLinkId);
                    return !isLatest;
                })
                : [];
            if (cancelTargets.length) {
                void (async () => {
                    for (const order of cancelTargets) {
                        const key = order.orderId || order.orderLinkId;
                        if (!key || cancelingOrdersRef.current.has(key))
                            continue;
                        cancelingOrdersRef.current.add(key);
                        try {
                            const res = await fetch(`${apiBase}/cancel`, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${authToken}`,
                                },
                                body: JSON.stringify({
                                    symbol: order.symbol,
                                    orderId: order.orderId || undefined,
                                    orderLinkId: order.orderLinkId || undefined,
                                }),
                            });
                            const json = await res.json().catch(() => ({}));
                            if (res.ok && json?.ok !== false) {
                                addLogEntries([
                                    {
                                        id: `order-prune:${key}:${Date.now()}`,
                                        timestamp: new Date().toISOString(),
                                        action: "STATUS",
                                        message: `ORDER PRUNE (NEW) ${order.symbol} ${order.side} ${key}`,
                                    },
                                ]);
                            }
                        }
                        catch {
                            // ignore cancel errors in enforcement loop
                        }
                        finally {
                            cancelingOrdersRef.current.delete(key);
                        }
                    }
                })();
            }
            for (const [orderId, nextOrder] of nextOrders.entries()) {
                const prev = prevOrders.get(orderId);
                if (!prev) {
                    newLogs.push({
                        id: `order-new:${orderId}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `ORDER NEW ${nextOrder.symbol} ${nextOrder.side} ${formatNumber(nextOrder.qty, 4)} @ ${nextOrder.price ?? "mkt"} | ${nextOrder.status}`,
                    });
                    continue;
                }
                if (prev.status !== nextOrder.status) {
                    newLogs.push({
                        id: `order-status:${orderId}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `ORDER STATUS ${nextOrder.symbol} ${prev.status} → ${nextOrder.status}`,
                    });
                }
            }
        for (const [orderId, prevOrder] of prevOrders.entries()) {
            if (!nextOrders.has(orderId)) {
                newLogs.push({
                    id: `order-closed:${orderId}:${now}`,
                    timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `ORDER CLOSED ${prevOrder.symbol} ${prevOrder.side} ${formatNumber(prevOrder.qty, 4)} | ${prevOrder.status}`,
                    });
                }
            }
            orderSnapshotRef.current = nextOrders;
            if (positionsRes.status === "fulfilled") {
                void enforceBtcBiasAlignment(now);
            }
        }
        else {
            const msg = asErrorMessage(ordersRes.reason);
            setOrdersError(msg);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (executionsRes.status === "fulfilled") {
            const list = extractList(executionsRes.value);
            const execSeen = execSeenRef.current;
            const nextTrades = list.map((t) => {
                const price = toNumber(t?.execPrice ?? t?.price);
                const qty = toNumber(t?.execQty ?? t?.qty);
                const value = toNumber(t?.execValue ?? t?.value);
                const fee = toNumber(t?.execFee ?? t?.fee);
                return {
                    id: String(t?.execId ?? t?.tradeId ?? ""),
                    symbol: String(t?.symbol ?? ""),
                    side: (t?.side ?? "Buy"),
                    price: Number.isFinite(price) ? price : Number.NaN,
                    qty: Number.isFinite(qty) ? qty : Number.NaN,
                    value: Number.isFinite(value) ? value : Number.NaN,
                    fee: Number.isFinite(fee) ? fee : Number.NaN,
                    time: toIso(t?.execTime ?? t?.transactTime ?? t?.createdTime) || "",
                };
            });
            setTrades(nextTrades);
            const tradeLogs = list
                .map((t) => {
                const timestamp = toIso(t?.execTime ?? t?.transactTime ?? t?.createdTime);
                if (!timestamp)
                    return null;
                const symbol = String(t?.symbol ?? "");
                const side = String(t?.side ?? "");
                const qty = toNumber(t?.execQty ?? t?.qty);
                const price = toNumber(t?.execPrice ?? t?.price);
                const value = toNumber(t?.execValue ?? t?.value);
                const fee = toNumber(t?.execFee ?? t?.fee);
                const execType = String(t?.execType ?? t?.exec_type ?? "");
                const orderId = String(t?.orderId ?? t?.orderID ?? "");
                const orderLinkId = String(t?.orderLinkId ?? t?.orderLinkID ?? t?.clOrdId ?? "");
                const isMaker = typeof t?.isMaker === "boolean" ? t.isMaker : undefined;
                const parts = [];
                if (symbol &&
                    side &&
                    Number.isFinite(qty) &&
                    Number.isFinite(price)) {
                    parts.push(`${symbol} ${side} ${formatNumber(qty, 4)} @ ${formatNumber(price, 6)}`);
                }
                else if (symbol && side) {
                    parts.push(`${symbol} ${side}`);
                }
                if (Number.isFinite(value)) {
                    parts.push(`value ${formatNumber(value, 4)}`);
                }
                if (Number.isFinite(fee)) {
                    parts.push(`fee ${formatNumber(fee, 4)}`);
                }
                if (execType)
                    parts.push(`type ${execType}`);
                if (orderId)
                    parts.push(`order ${orderId}`);
                if (orderLinkId)
                    parts.push(`link ${orderLinkId}`);
                if (typeof isMaker === "boolean") {
                    parts.push(isMaker ? "maker" : "taker");
                }
                const message = parts.filter(Boolean).join(" | ");
                if (!message)
                    return null;
                const id = String(t?.execId ?? t?.tradeId ?? `${symbol}-${timestamp}`);
                if (execSeen.has(id))
                    return null;
                execSeen.add(id);
                return {
                    id,
                    timestamp,
                    action: "SYSTEM",
                    message,
                };
            })
                .filter((entry) => Boolean(entry));
            if (tradeLogs.length) {
                addLogEntries(tradeLogs);
            }
            else {
                setLogEntries((prev) => prev ?? []);
            }
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(executionsRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (newLogs.length) {
            addLogEntries(newLogs);
        }
        refreshDiagnosticsFromDecisions();
        fastOkRef.current = !sawError;
        if (!sawError && slowOkRef.current) {
            setSystemError(null);
        }
        fastPollRef.current = false;
    }, [
        addLogEntries,
        apiBase,
        authToken,
        enforceBtcBiasAlignment,
        fetchJson,
        refreshDiagnosticsFromDecisions,
        syncTrailingProtection,
        useTestnet,
    ]);
    const refreshSlow = useCallback(async () => {
        if (slowPollRef.current)
            return;
        slowPollRef.current = true;
        const now = Date.now();
        const results = await Promise.allSettled([
            fetchJson("/wallet"),
            fetchJson("/closed-pnl", { limit: "200" }),
            fetchJson("/reconcile"),
        ]);
        let sawError = false;
        const newLogs = [];
        const [walletRes, closedPnlRes, reconcileRes] = results;
        if (walletRes.status === "fulfilled") {
            const list = extractList(walletRes.value);
            const row = list[0] ?? {};
            const totalEquity = toNumber(row?.totalEquity ?? row?.totalWalletBalance);
            const availableBalance = toNumber(row?.totalAvailableBalance ?? row?.availableBalance);
            const totalWalletBalance = toNumber(row?.totalWalletBalance);
            setWalletSnapshot({
                totalEquity,
                availableBalance,
                totalWalletBalance,
            });
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(walletRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (closedPnlRes.status === "fulfilled") {
            const list = extractList(closedPnlRes.value);
            const records = list
                .map((r) => {
                const ts = toNumber(r?.execTime ?? r?.updatedTime ?? r?.createdTime);
                const pnl = toNumber(r?.closedPnl ?? r?.realisedPnl);
                const symbol = String(r?.symbol ?? "");
                if (!symbol || !Number.isFinite(ts) || !Number.isFinite(pnl))
                    return null;
                return { symbol, pnl, ts };
            })
                .filter((r) => Boolean(r));
            const lastLossMap = new Map(lastLossBySymbolRef.current);
            for (const r of records) {
                if (r.pnl >= 0)
                    continue;
                const prev = lastLossMap.get(r.symbol) ?? 0;
                if (r.ts > prev)
                    lastLossMap.set(r.symbol, r.ts);
            }
            lastLossBySymbolRef.current = lastLossMap;
            const pnlRecords = records.map((r) => ({
                symbol: r.symbol,
                pnl: r.pnl,
                timestamp: new Date(r.ts).toISOString(),
            }));
            const map = mergePnlRecords(pnlRecords);
            setClosedPnlRecords(records);
            setAssetPnlHistory(map);
            const pnlSeen = pnlSeenRef.current;
            for (const r of records) {
                const id = `pnl:${r.symbol}:${r.ts}`;
                if (pnlSeen.has(id))
                    continue;
                pnlSeen.add(id);
                newLogs.push({
                    id,
                    timestamp: new Date(r.ts).toISOString(),
                    action: "SYSTEM",
                    message: `PNL ${r.symbol} ${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(2)}`,
                });
            }
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(closedPnlRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (reconcileRes.status === "fulfilled") {
            const payload = reconcileRes.value ?? {};
            const reconDiffs = payload?.diffs ?? [];
            for (const diff of reconDiffs) {
                const sym = String(diff?.symbol ?? "");
                const label = String(diff?.message ?? diff?.field ?? diff?.type ?? "");
                if (!label)
                    continue;
                const severity = String(diff?.severity ?? "").toUpperCase();
                newLogs.push({
                    id: `reconcile:${sym}:${label}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: severity === "HIGH" ? "ERROR" : "STATUS",
                    message: `RECONCILE ${sym} ${label}`,
                });
            }
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(reconcileRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (newLogs.length) {
            addLogEntries(newLogs);
        }
        else {
            setLogEntries((prev) => prev ?? []);
        }
        slowOkRef.current = !sawError;
        if (!sawError && fastOkRef.current) {
            setSystemError(null);
        }
        slowPollRef.current = false;
    }, [addLogEntries, fetchJson]);
    useEffect(() => {
        if (!authToken) {
            setSystemError("missing_auth_token");
            return;
        }
        let alive = true;
        const tickFast = async () => {
            if (!alive)
                return;
            await refreshFast();
        };
        const tickSlow = async () => {
            if (!alive)
                return;
            await refreshSlow();
        };
        const fastId = setInterval(tickFast, 1000);
        const slowId = setInterval(tickSlow, 10000);
        const tsId = setInterval(() => {
            void syncTrailingProtection(positionsRef.current);
        }, TS_VERIFY_INTERVAL_MS);
        tickFast();
        tickSlow();
        return () => {
            alive = false;
            clearInterval(fastId);
            clearInterval(slowId);
            clearInterval(tsId);
        };
    }, [authToken, refreshFast, refreshSlow, syncTrailingProtection]);
    async function autoTrade(signal) {
        if (!authToken)
            throw new Error("missing_auth_token");
        const intentId = signal.intentId ?? crypto.randomUUID();
        const intent = {
            intentId,
            createdAt: Date.now(),
            profile: PROFILE_BY_RISK_MODE[settingsRef.current.riskMode] ?? "AI-MATIC",
            symbol: signal.symbol,
            side: signal.side,
            entryType: signal.entryType,
            entryPrice: signal.entryPrice,
            triggerPrice: signal.triggerPrice,
            qtyMode: signal.qtyMode,
            qtyValue: signal.qtyValue,
            slPrice: signal.slPrice,
            tpPrices: signal.tpPrices ?? [],
            expireAfterMs: 30_000,
            tags: { env: useTestnet ? "testnet" : "mainnet", mode: "intent" },
        };
        await sendIntent(intent, { authToken, useTestnet });
    }
    const handleDecision = useCallback((symbol, decision) => {
        const now = Date.now();
        const isSelected = activeSymbols.includes(symbol);
        const scalpActive = settingsRef.current.riskMode === "ai-matic-scalp";
        const isProProfile = settingsRef.current.riskMode === "ai-matic-pro";
        const isAiMaticProfile = settingsRef.current.riskMode === "ai-matic";
        feedLastTickRef.current = now;
        symbolTickRef.current.set(symbol, now);
        decisionRef.current[symbol] = { decision, ts: now };
        if (isSelected) {
            setScanDiagnostics((prev) => ({
                ...(prev ?? {}),
                [symbol]: buildScanDiagnostics(symbol, decision, now),
            }));
        }
        if (!isSelected) {
            return;
        }
        const hasPosition = positionsRef.current.some((p) => {
            if (p.symbol !== symbol)
                return false;
            const size = toNumber(p.size ?? p.qty);
            return Number.isFinite(size) && size > 0;
        });
        const hasEntryOrder = ordersRef.current.some((order) => isActiveEntryOrder(order) && String(order?.symbol ?? "") === symbol);
        if (isProProfile && decision?.proRegime?.shock) {
            const shockKey = `pro-shock:${symbol}`;
            const last = autoCloseCooldownRef.current.get(shockKey) ?? 0;
            if (now - last >= 15000) {
                autoCloseCooldownRef.current.set(shockKey, now);
                const cancelTargets = ordersRef.current.filter((order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol);
                cancelTargets.forEach((order) => {
                    const orderId = order.orderId || "";
                    const orderLinkId = order.orderLinkId || "";
                    postJson("/cancel", {
                        symbol,
                        orderId: orderId || undefined,
                        orderLinkId: orderLinkId || undefined,
                    }).catch(() => null);
                });
                if (hasPosition) {
                    const pos = positionsRef.current.find((p) => p.symbol === symbol);
                    if (pos) {
                        submitReduceOnlyOrder(pos, Math.abs(toNumber(pos.size ?? pos.qty))).catch(() => null);
                    }
                }
                addLogEntries([
                    {
                        id: `pro-shock:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "RISK_BLOCK",
                        message: `${symbol} PRO shock regime -> CLOSE & CANCEL`,
                    },
                ]);
            }
            return;
        }
        if (hasPosition || hasEntryOrder) {
            if (hasPosition && scalpActive) {
                handleScalpInTrade(symbol, decision, now);
            }
            if (hasPosition && isProProfile) {
                const orderflow = decision?.orderflow;
                const pos = positionsRef.current.find((p) => p.symbol === symbol);
                if (pos && orderflow) {
                    const side = String(pos.side ?? "");
                    const ofi = toNumber(orderflow.ofi);
                    const cvd = toNumber(orderflow.cvd);
                    const cvdPrev = toNumber(orderflow.cvdPrev);
                    const cvdChange = Number.isFinite(cvd) && Number.isFinite(cvdPrev)
                        ? cvd - cvdPrev
                        : Number.NaN;
                    const ofiFlip = side === "Buy"
                        ? Number.isFinite(ofi) && ofi < 0
                        : Number.isFinite(ofi) && ofi > 0;
                    const cvdFlip = side === "Buy"
                        ? Number.isFinite(cvdChange) && cvdChange < 0
                        : Number.isFinite(cvdChange) && cvdChange > 0;
                    if (ofiFlip || cvdFlip) {
                        const flipKey = `pro-flip:${symbol}`;
                        const last = autoCloseCooldownRef.current.get(flipKey) ?? 0;
                        if (now - last >= 15000) {
                            autoCloseCooldownRef.current.set(flipKey, now);
                            submitReduceOnlyOrder(pos, Math.abs(toNumber(pos.size ?? pos.qty))).catch(() => null);
                            addLogEntries([
                                {
                                    id: `pro-flip:${symbol}:${now}`,
                                    timestamp: new Date(now).toISOString(),
                                    action: "RISK_BLOCK",
                                    message: `${symbol} PRO flow flip -> EXIT (${ofiFlip ? "OFI" : "CVD"})`,
                                },
                            ]);
                        }
                    }
                }
            }
            if (hasPosition && settingsRef.current.riskMode === "ai-matic") {
                const aiMatic = decision?.aiMatic ?? null;
                const pos = positionsRef.current.find((p) => p.symbol === symbol);
                const side = pos?.side === "Sell" ? "Sell" : "Buy";
                const structureTrend = aiMatic?.htf?.structureTrend ?? "RANGE";
                const htfFlip = side === "Buy" ? structureTrend === "BEAR" : structureTrend === "BULL";
                const chochAgainst = side === "Buy" ? aiMatic?.ltf?.chochDown : aiMatic?.ltf?.chochUp;
                if (htfFlip || chochAgainst) {
                    const reason = htfFlip ? "HTF flip" : "CHoCH";
                    const key = `ai-matic-struct:${symbol}:${reason}`;
                    const last = aiMaticStructureLogRef.current.get(key) ?? 0;
                    if (now - last >= 15000) {
                        aiMaticStructureLogRef.current.set(key, now);
                        addLogEntries([
                            {
                                id: `ai-matic-structure:${symbol}:${now}`,
                                timestamp: new Date(now).toISOString(),
                                action: "STATUS",
                                message: `${symbol} STRUCTURE CHANGE -> MANUAL EXIT (${reason})`,
                            },
                        ]);
                    }
                }
            }
            return;
        }
        const nextState = String(decision?.state ?? "").toUpperCase();
        if (nextState) {
            const prevState = lastStateRef.current.get(symbol);
            if (prevState && prevState !== nextState) {
                addLogEntries([
                    {
                        id: `state:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `${symbol} state ${prevState} → ${nextState}`,
                    },
                ]);
            }
            lastStateRef.current.set(symbol, nextState);
        }
        const rawSignal = decision?.signal ?? null;
        const lastTick = symbolTickRef.current.get(symbol) ?? 0;
        const feedAgeMs = lastTick > 0 ? Math.max(0, now - lastTick) : null;
        const coreEval = isProProfile
            ? evaluateProGates(decision, rawSignal)
            : evaluateCoreV2(symbol, decision, rawSignal, feedAgeMs);
        const checklistBase = evaluateChecklistPass(coreEval.gates);
        let signal = rawSignal;
        if (!signal && checklistBase.pass && !isProProfile) {
            signal = buildChecklistSignal(symbol, decision, now);
        }
        if (!signal)
            return;
        const signalId = String(signal.id ?? `${symbol}-${now}`);
        if (signalSeenRef.current.has(signalId))
            return;
        signalSeenRef.current.add(signalId);
        let aiMaticEval = null;
        if (isAiMaticProfile) {
            aiMaticEval = evaluateAiMaticGates(symbol, decision, signal);
            if (!aiMaticEval.pass) {
                const hardFails = aiMaticEval.hardGates.filter((g) => !g.ok).map((g) => g.name);
                const entryFails = aiMaticEval.entryFactors.filter((g) => !g.ok).map((g) => g.name);
                const checklistFails = aiMaticEval.checklist.filter((g) => !g.ok).map((g) => g.name);
                    const hardCount = aiMaticEval.hardGates.filter((g) => g.ok).length;
                    const entryCount = aiMaticEval.entryFactors.filter((g) => g.ok).length;
                    const checklistCount = aiMaticEval.checklist.filter((g) => g.ok).length;
                    const reasons = [];
                if (!aiMaticEval.hardPass && hardFails.length) {
                    reasons.push(`hard: ${hardFails.join(", ")}`);
                }
                if (!aiMaticEval.entryFactorsPass && entryFails.length) {
                    reasons.push(`entry: ${entryFails.join(", ")}`);
                }
                if (!aiMaticEval.checklistPass && checklistFails.length) {
                    reasons.push(`checklist: ${checklistFails.join(", ")}`);
                }
                addLogEntries([
                    {
                        id: `ai-matic-gate:${signalId}`,
                        timestamp: new Date(now).toISOString(),
                        action: "RISK_BLOCK",
                        message: `${symbol} AI-MATIC gate hard ${hardCount}/${AI_MATIC_HARD_MIN} | entry ${entryCount}/${AI_MATIC_ENTRY_FACTOR_MIN} | checklist ${checklistCount}/${AI_MATIC_CHECKLIST_MIN} -> NO TRADE${reasons.length ? ` (${reasons.join(" | ")})` : ""}`,
                    },
                ]);
                return;
            }
        }
        const intent = signal.intent;
        const entry = toNumber(intent?.entry);
        const sl = toNumber(intent?.sl);
        const tp = toNumber(intent?.tp);
        const side = String(intent?.side ?? "").toLowerCase() === "buy" ? "Buy" : "Sell";
        let entryType = signal.entryType === "CONDITIONAL" ||
            signal.entryType === "LIMIT" ||
            signal.entryType === "LIMIT_MAKER_FIRST" ||
            signal.entryType === "MARKET"
            ? signal.entryType
            : "LIMIT_MAKER_FIRST";
        const timestamp = signal.createdAt || new Date(now).toISOString();
        const msgParts = [`${symbol} ${side}`];
        if (Number.isFinite(entry)) {
            msgParts.push(`entry ${formatNumber(entry, 6)}`);
        }
        if (Number.isFinite(sl)) {
            msgParts.push(`sl ${formatNumber(sl, 6)}`);
        }
        if (Number.isFinite(tp)) {
            msgParts.push(`tp ${formatNumber(tp, 6)}`);
        }
        if (signal.message)
            msgParts.push(signal.message);
        const isChecklistSignal = signal.message === "Checklist auto-signal";
        const signalKey = `${symbol}:${side}`;
        const lastSignalLog = signalLogThrottleRef.current.get(signalKey) ?? 0;
        const shouldLogSignal = !isChecklistSignal || now - lastSignalLog >= SIGNAL_LOG_THROTTLE_MS;
        if (shouldLogSignal) {
            signalLogThrottleRef.current.set(signalKey, now);
            addLogEntries([
                {
                    id: `signal:${signalId}`,
                    timestamp,
                    action: "SIGNAL",
                    message: msgParts.join(" | "),
                },
            ]);
        }
        if (modeRef.current !== TradingMode.AUTO_ON) {
            addLogEntries([
                {
                    id: `signal:auto-off:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                    message: `AUTO_OFF ${symbol} signal not executed`,
                },
            ]);
            return;
        }
        const context = getSymbolContext(symbol, decision);
        const isAiMaticX = context.settings.riskMode === "ai-matic-x";
        const isScalpProfile = context.settings.riskMode === "ai-matic-scalp";
        const xContext = decision?.xContext;
        const hasSymbolPosition = context.hasPosition;
        const hasSymbolEntryOrder = ordersRef.current.some((order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol);
        const hasPendingIntent = intentPendingRef.current.has(symbol);
        const cooldownMs = CORE_V2_COOLDOWN_MS[context.settings.riskMode];
        const lastLossTs = lastLossBySymbolRef.current.get(symbol) ?? 0;
        const lastCloseTs = lastCloseBySymbolRef.current.get(symbol) ?? 0;
        const lastIntentTs = lastIntentBySymbolRef.current.get(symbol) ?? 0;
        const entryLockTs = entryOrderLockRef.current.get(symbol) ?? 0;
        const entryBlockReasons = [];
        if (hasSymbolPosition)
            entryBlockReasons.push("open position");
        if (hasSymbolEntryOrder)
            entryBlockReasons.push("open order");
        if (hasPendingIntent)
            entryBlockReasons.push("pending intent");
        if (entryLockTs && now - entryLockTs < ENTRY_ORDER_LOCK_MS) {
            const remainingMs = Math.max(0, ENTRY_ORDER_LOCK_MS - (now - entryLockTs));
            const remainingSec = Math.ceil(remainingMs / 1000);
            entryBlockReasons.push(`entry lock ${remainingSec}s`);
        }
        if (lastIntentTs && now - lastIntentTs < INTENT_COOLDOWN_MS) {
            const remainingMs = Math.max(0, INTENT_COOLDOWN_MS - (now - lastIntentTs));
            const remainingSec = Math.ceil(remainingMs / 1000);
            entryBlockReasons.push(`recent intent ${remainingSec}s`);
        }
        if (lastCloseTs && now - lastCloseTs < REENTRY_COOLDOWN_MS) {
            const remainingMs = Math.max(0, REENTRY_COOLDOWN_MS - (now - lastCloseTs));
            const remainingSec = Math.ceil(remainingMs / 1000);
            entryBlockReasons.push(`recent close ${remainingSec}s`);
        }
        if (lastLossTs && now - lastLossTs < cooldownMs) {
            const remainingMs = Math.max(0, cooldownMs - (now - lastLossTs));
            const remainingMin = Math.ceil(remainingMs / 60_000);
            entryBlockReasons.push(`cooldown ${remainingMin}m`);
        }
        if (!context.maxPositionsOk)
            entryBlockReasons.push("max positions");
        if (!context.ordersClearOk)
            entryBlockReasons.push("max orders");
        if (entryBlockReasons.length > 0) {
            const profileLabel = PROFILE_BY_RISK_MODE[context.settings.riskMode] ?? "AI-MATIC";
            const skipKey = `${symbol}:${entryBlockReasons.join(",")}`;
            const lastSkipLog = skipLogThrottleRef.current.get(skipKey) ?? 0;
            if (now - lastSkipLog >= SKIP_LOG_THROTTLE_MS) {
                skipLogThrottleRef.current.set(skipKey, now);
                addLogEntries([
                    {
                        id: `signal:max-pos:${signalId}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `${symbol} ${profileLabel} gate: ${entryBlockReasons.join(", ")} -> skip entry`,
                    },
                ]);
            }
            return;
        }
        let riskOff = false;
        const riskReasons = [];
        if (isAiMaticX) {
            if (xContext?.riskOff) {
                riskOff = true;
                riskReasons.push("chop");
            }
        }
        const riskOn = !riskOff;
        if (!riskOn) {
            addLogEntries([
                {
                    id: `signal:risk:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "RISK_BLOCK",
                    message: `${symbol} risk block: ${riskReasons.join(", ")}`,
                },
            ]);
            return;
        }
        // reuse feedAgeMs + coreEval computed above
        const core = decision?.coreV2;
        const volumeGate = coreEval.gates.find((g) => g.name === "Volume Pxx");
        const scalpPrimary = computeScalpPrimaryChecklist(core);
        const hardEnabled = false;
        const softEnabled = context.settings.enableSoftGates !== false;
        const hardBlockReasons = [];
        if (hardEnabled) {
            if (!isScalpProfile) {
                coreEval.gates.forEach((gate) => {
                    if (!gate.hard || gate.ok)
                        return;
                    if (!isGateEnabled(gate.name))
                        return;
                    hardBlockReasons.push(gate.name);
                });
            }
            if (isScalpProfile) {
                if (!scalpPrimary.primaryOk && isGateEnabled(SCALP_PRIMARY_GATE)) {
                    hardBlockReasons.push(SCALP_PRIMARY_GATE);
                }
                if (!scalpPrimary.entryOk && isGateEnabled(SCALP_ENTRY_GATE)) {
                    hardBlockReasons.push(SCALP_ENTRY_GATE);
                }
            }
        }
        const execEnabled = isGateEnabled("Exec allowed");
        if (!execEnabled) {
            addLogEntries([
                {
                    id: `signal:exec-off:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                    message: `${symbol} exec disabled (manual)`,
                },
            ]);
            return;
        }
        if (softEnabled && coreEval.scorePass === false && !isAiMaticProfile) {
            addLogEntries([
                {
                    id: `signal:score:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "RISK_BLOCK",
                    message: `${symbol} score gate ${coreEval.score}/${coreEval.threshold}`,
                },
            ]);
            return;
        }
        let aiMaticMarketAllowed = false;
        let aiMaticTriggerOverride = undefined;
        if (isAiMaticProfile && aiMaticEval && aiMaticEval.pass) {
            const aiMatic = decision?.aiMatic ?? null;
            if (aiMatic) {
                const resolved = resolveAiMaticEntryType({
                    aiMatic,
                    side,
                    entry,
                });
                entryType = resolved.entryType;
                aiMaticMarketAllowed = resolved.allowMarket;
                if (Number.isFinite(resolved.triggerPrice)) {
                    aiMaticTriggerOverride = resolved.triggerPrice;
                }
            }
        }
        const checklistGates = [...coreEval.gates];
        if (isScalpProfile) {
            checklistGates.push({
                name: SCALP_PRIMARY_GATE,
                ok: scalpPrimary.primaryOk,
                detail: `15m ${scalpPrimary.trendLongOk
                    ? "LONG"
                    : scalpPrimary.trendShortOk
                        ? "SHORT"
                        : "NONE"} | LTF ${core?.ltfTimeframeMin ?? "—"}m`,
            });
            checklistGates.push({
                name: SCALP_ENTRY_GATE,
                ok: scalpPrimary.entryOk,
                detail: `${core?.scalpFib
                    ? `FIB ${core.scalpFib.hitLevel ?? "—"} | 5m ${core.scalpFib.m5InZone ? "OK" : "no"} | 1m ${core.scalpFib.ltfInZone ? "OK" : "no"}`
                    : "FIB —"} | ${core?.scalpConfirm
                    ? `OB ${core.scalpConfirm.obTouch ? "OK" : "no"} · GAP ${core.scalpConfirm.gapTouch ? "OK" : "no"} · VP ${core.scalpConfirm.vpConfirm ? "OK" : "no"} · TL ${core.scalpConfirm.tlPullback ? "OK" : "no"}`
                    : "Confirm —"}`,
            });
            checklistGates.push({
                name: SCALP_EXIT_GATE,
                ok: scalpPrimary.exitOk,
                detail: Number.isFinite(core?.atr14)
                    ? `ATR ${formatNumber(core.atr14, 4)} | TP fib ext`
                    : "ATR missing",
            });
        }
        const checklistExec = isProProfile
            ? {
                eligibleCount: coreEval.scoreTotal,
                passedCount: coreEval.score,
                pass: coreEval.scorePass !== false,
            }
            : isAiMaticProfile
                ? {
                    eligibleCount: AI_MATIC_CHECKLIST_MIN,
                    passedCount: AI_MATIC_CHECKLIST_MIN,
                    pass: true,
                }
                : evaluateChecklistPass(checklistGates);
        if (!checklistExec.pass) {
            addLogEntries([
                {
                    id: `signal:checklist:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "RISK_BLOCK",
                    message: `${symbol} checklist ${checklistExec.passedCount}/${MIN_CHECKLIST_PASS}`,
                },
            ]);
            return;
        }
        if (entryType === "MARKET") {
            const allowMarket = (isAiMaticX && riskOn && xContext?.strongTrendExpanse) ||
                (isAiMaticProfile && aiMaticMarketAllowed);
            if (!allowMarket) {
                entryType = "LIMIT";
            }
        }
        const triggerPrice = entryType === "CONDITIONAL"
            ? Number.isFinite(aiMaticTriggerOverride)
                ? aiMaticTriggerOverride
                : Number.isFinite(signal.triggerPrice)
                    ? signal.triggerPrice
                    : entry
            : undefined;
        const proTargets = isProProfile ? signal?.proTargets : null;
        let resolvedSl = sl;
        let resolvedTp = tp;
        if (isScalpProfile &&
            Number.isFinite(entry) &&
            entry > 0 &&
            Number.isFinite(core?.atr14) &&
            core.atr14 > 0) {
            const atr = core.atr14;
            const structure = side === "Buy" ? core?.pivotLow : core?.pivotHigh;
            const atrStop = side === "Buy" ? entry - atr * 2.5 : entry + atr * 2.5;
            let baseStop = Number.isFinite(structure) ? structure : atrStop;
            if (Number.isFinite(structure)) {
                baseStop = side === "Buy"
                    ? Math.min(structure, atrStop)
                    : Math.max(structure, atrStop);
            }
            const bufferedStop = side === "Buy"
                ? baseStop - atr * SCALP_SL_ATR_BUFFER
                : baseStop + atr * SCALP_SL_ATR_BUFFER;
            const fibOk = Boolean(core?.scalpFib?.m5InZone && core?.scalpFib?.ltfInZone);
            let usedFibSl = false;
            if (fibOk) {
                const fibStop = resolveScalpFibStop(entry, side, core?.scalpFib, atr, structure);
                if (Number.isFinite(fibStop) && fibStop > 0) {
                    resolvedSl = fibStop;
                    usedFibSl = true;
                }
                const fibTp = resolveScalpFibTarget(entry, side, core?.scalpFib, core);
                if (Number.isFinite(fibTp) && fibTp > 0) {
                    resolvedTp = fibTp;
                }
            }
            if (!usedFibSl) {
                if (!Number.isFinite(resolvedSl) ||
                    resolvedSl <= 0 ||
                    (side === "Buy" && bufferedStop < resolvedSl) ||
                    (side === "Sell" && bufferedStop > resolvedSl)) {
                    resolvedSl = bufferedStop;
                }
            }
            if ((!Number.isFinite(resolvedTp) || resolvedTp <= 0) &&
                Number.isFinite(resolvedSl) &&
                resolvedSl > 0) {
                const risk = Math.abs(entry - resolvedSl);
                if (Number.isFinite(risk) && risk > 0) {
                    resolvedTp = side === "Buy"
                        ? entry + 1.5 * risk
                        : entry - 1.5 * risk;
                }
            }
        }
        if (isAiMaticProfile) {
            const aiMatic = decision?.aiMatic ?? null;
            const nextSl = resolveAiMaticStopLoss({
                side,
                entry,
                currentSl: resolvedSl,
                atr: core?.atr14,
                aiMatic,
                core,
            });
            if (Number.isFinite(nextSl) && nextSl > 0) {
                resolvedSl = nextSl;
            }
            const nextTp = resolveAiMaticTargets({
                side,
                entry,
                sl: resolvedSl,
                aiMatic,
            });
            if (Number.isFinite(nextTp) && nextTp > 0) {
                resolvedTp = nextTp;
            }
        }
        const normalized = normalizeProtectionLevels(entry, side, resolvedSl, resolvedTp, core?.atr14);
        resolvedSl = normalized.sl;
        resolvedTp = normalized.tp;
        if (isAiMaticProfile &&
            Number.isFinite(resolvedSl) &&
            Number.isFinite(resolvedTp)) {
            const minGap = Number.isFinite(normalized.minDistance)
                ? normalized.minDistance
                : resolveMinProtectionDistance(entry, core?.atr14);
            if (side === "Buy" && resolvedSl >= resolvedTp) {
                resolvedTp = resolvedSl + minGap;
            }
            if (side === "Sell" && resolvedSl <= resolvedTp) {
                resolvedTp = resolvedSl - minGap;
            }
        }
        if (isProProfile && proTargets && Number.isFinite(proTargets.t2)) {
            resolvedTp = proTargets.t2;
        }
        if (!Number.isFinite(entry) ||
            !Number.isFinite(resolvedSl) ||
            entry <= 0 ||
            resolvedSl <= 0) {
            addLogEntries([
                {
                    id: `signal:invalid:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "ERROR",
                    message: `${symbol} invalid signal params (entry/sl)`,
                },
            ]);
            return;
        }
        if (isAiMaticProfile && Number.isFinite(resolvedTp) && resolvedTp > 0) {
            aiMaticTp1Ref.current.set(symbol, {
                entry,
                tp1: resolvedTp,
                side,
                setAt: now,
            });
        }
        if (isProProfile &&
            proTargets &&
            Number.isFinite(entry) &&
            Number.isFinite(proTargets.t1) &&
            Number.isFinite(proTargets.t2)) {
            proTargetsRef.current.set(symbol, {
                t1: proTargets.t1,
                t2: proTargets.t2,
                timeStopMinutes: Number.isFinite(proTargets.timeStopMinutes)
                    ? proTargets.timeStopMinutes
                    : 60,
                entryTfMin: Number.isFinite(proTargets.entryTfMin)
                    ? proTargets.entryTfMin
                    : 5,
                entryPrice: entry,
                side,
                setAt: now,
            });
        }
        const fixedSizing = computeFixedSizing(symbol, entry, resolvedSl);
        const sizing = fixedSizing ?? computeNotionalForSignal(symbol, entry, resolvedSl);
        if (!sizing.ok) {
            addLogEntries([
                {
                    id: `signal:sizing:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "ERROR",
                    message: `${symbol} sizing failed: ${sizing.reason}`,
                },
            ]);
            return;
        }
        const useFixedQty = fixedSizing?.ok === true;
        const qtyMode = useFixedQty ? "BASE_QTY" : "USDT_NOTIONAL";
        const qtyValue = useFixedQty ? sizing.qty : sizing.notional;
        let trailOffset = toNumber(decision?.trailOffsetPct);
        if (isScalpProfile &&
            (!Number.isFinite(trailOffset) || trailOffset <= 0) &&
            Number.isFinite(core?.atr14) &&
            core.atr14 > 0 &&
            Number.isFinite(entry) &&
            entry > 0) {
            trailOffset = (core.atr14 * 2.5) / entry;
        }
        if (Number.isFinite(trailOffset) && trailOffset > 0) {
            trailOffsetRef.current.set(symbol, trailOffset);
        }
        else {
            trailOffsetRef.current.delete(symbol);
        }
        if (intentPendingRef.current.has(symbol)) {
            addLogEntries([
                {
                    id: `signal:pending:${signalId}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                    message: `${symbol} intent pending`,
                },
            ]);
            return;
        }
        const intentId = crypto.randomUUID();
        intentPendingRef.current.add(symbol);
        lastIntentBySymbolRef.current.set(symbol, now);
        entryOrderLockRef.current.set(symbol, now);
        const tpPrices = isProProfile && proTargets
            ? [proTargets.t1, proTargets.t2].filter((value) => Number.isFinite(value) && value > 0)
            : Number.isFinite(resolvedTp)
                ? [resolvedTp]
                : [];
        void (async () => {
            try {
                await autoTrade({
                    symbol: symbol,
                    side,
                    entryPrice: entry,
                    entryType,
                    triggerPrice,
                    slPrice: resolvedSl,
                    tpPrices,
                    qtyMode,
                    qtyValue,
                    intentId,
                });
                addLogEntries([
                    {
                        id: `signal:sent:${signalId}`,
                        timestamp: new Date().toISOString(),
                        action: "STATUS",
                        message: `${symbol} intent sent | qty ${formatNumber(sizing.qty, 6)} | notional ${formatNumber(sizing.notional, 2)}`,
                    },
                ]);
            }
            catch (err) {
                addLogEntries([
                    {
                        id: `signal:error:${signalId}`,
                        timestamp: new Date().toISOString(),
                        action: "ERROR",
                        message: `${symbol} intent failed: ${asErrorMessage(err)}`,
                    },
                ]);
            }
            finally {
                intentPendingRef.current.delete(symbol);
            }
        })();
    }, [
        addLogEntries,
        activeSymbols,
        autoTrade,
        buildScanDiagnostics,
        buildChecklistSignal,
        closedPnlRecords,
        computeFixedSizing,
        computeNotionalForSignal,
        evaluateAiMaticGates,
        evaluateChecklistPass,
        evaluateCoreV2,
        evaluateProGates,
        getEquityValue,
        getSymbolContext,
        isGateEnabled,
        isEntryOrder,
        postJson,
        submitReduceOnlyOrder,
    ]);
    useEffect(() => {
        handleDecisionRef.current = handleDecision;
    }, [handleDecision]);
    useEffect(() => {
        if (!authToken)
            return;
        signalSeenRef.current.clear();
        intentPendingRef.current.clear();
        aiMaticTp1Ref.current.clear();
        aiMaticTrailCooldownRef.current.clear();
        aiMaticStructureLogRef.current.clear();
        partialExitRef.current.clear();
        proTargetsRef.current.clear();
        proPartialRef.current.clear();
        decisionRef.current = {};
        setScanDiagnostics(null);
        const riskMode = settingsRef.current.riskMode;
        const isAiMaticX = riskMode === "ai-matic-x";
        const isAiMatic = riskMode === "ai-matic" || riskMode === "ai-matic-tree";
        const isAiMaticCore = riskMode === "ai-matic";
        const isScalp = riskMode === "ai-matic-scalp";
        const isPro = riskMode === "ai-matic-pro";
        const decisionFn = (symbol, candles, config) => {
            const baseDecision = isPro
                ? evaluateAiMaticProStrategyForSymbol(symbol, candles, { entryTfMin: 5 })
                : isAiMaticX
                    ? evaluateAiMaticXStrategyForSymbol(symbol, candles)
                    : evaluateStrategyForSymbol(symbol, candles, config);
            const resample = createResampleCache(candles);
            const coreV2 = computeCoreV2Metrics(candles, riskMode, { resample });
            if (isPro) {
                return { ...baseDecision, coreV2 };
            }
            const htfTimeframes = isAiMatic
                ? AI_MATIC_HTF_TIMEFRAMES_MIN
                : HTF_TIMEFRAMES_MIN;
            const ltfTimeframes = isAiMatic
                ? AI_MATIC_LTF_TIMEFRAMES_MIN
                : isScalp
                    ? SCALP_LTF_TIMEFRAMES_MIN
                    : null;
            const htfTrend = evaluateHTFMultiTrend(candles, {
                timeframesMin: htfTimeframes,
                resample,
            });
            const ltfTrend = ltfTimeframes
                ? evaluateHTFMultiTrend(candles, {
                    timeframesMin: ltfTimeframes,
                    resample,
                })
                : null;
            const emaTrend = evaluateEmaMultiTrend(candles, {
                timeframesMin: EMA_TREND_TIMEFRAMES_MIN,
            });
            const scalpContext = isScalp ? buildScalpContext(candles) : undefined;
            const aiMaticContext = isAiMaticCore
                ? buildAiMaticContext(candles, baseDecision, coreV2, { resample })
                : null;
            return {
                ...baseDecision,
                htfTrend,
                ltfTrend,
                emaTrend,
                scalpContext,
                coreV2,
                ...(aiMaticContext ? { aiMatic: aiMaticContext } : {}),
            };
        };
        const maxCandles = isAiMaticX || isAiMatic || isPro ? 5000 : undefined;
        const backfill = isAiMaticX
            ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
            : isAiMatic
                ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
                : isPro
                    ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
                    : undefined;
        const stop = startPriceFeed(feedSymbols, (symbol, decision) => {
            handleDecisionRef.current?.(symbol, decision);
        }, {
            useTestnet,
            timeframe: "1",
            configOverrides: engineConfig,
            decisionFn,
            maxCandles,
            backfill,
            orderflow: isPro ? { enabled: true, depth: 50 } : undefined,
        });
        const envLabel = useTestnet ? "testnet" : "mainnet";
        const lastLog = feedLogRef.current;
        const now = Date.now();
        if (!lastLog || lastLog.env !== envLabel || now - lastLog.ts > 5000) {
            feedLogRef.current = { env: envLabel, ts: now };
            addLogEntries([
                {
                    id: `feed:start:${envLabel}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                    message: `Price feed connected (${envLabel})`,
                },
            ]);
        }
        return () => {
            stop();
        };
    }, [addLogEntries, authToken, engineConfig, feedEpoch, feedSymbols, useTestnet]);
    useEffect(() => {
        if (!authToken)
            return;
        let active = true;
        const baseUrl = useTestnet
            ? "https://api-testnet.bybit.com"
            : "https://api.bybit.com";
        const intervalMs = 30000;
        const pollOpenInterest = async () => {
            if (!active)
                return;
            if (settingsRef.current.riskMode !== "ai-matic-pro")
                return;
            const symbols = activeSymbols.length ? activeSymbols : [];
            if (!symbols.length)
                return;
            await Promise.all(symbols.map(async (symbol) => {
                try {
                    const url = `${baseUrl}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=1`;
                    const res = await fetch(url);
                    const json = await res.json().catch(() => ({}));
                    const list = json?.result?.list ??
                        json?.result?.data ??
                        json?.result ??
                        json?.list ??
                        [];
                    const row = Array.isArray(list) ? list[0] : list;
                    const raw = row?.openInterest ??
                        row?.open_interest ??
                        row?.value ??
                        row?.openInterestValue ??
                        row?.sumOpenInterest;
                    const oi = toNumber(raw);
                    if (Number.isFinite(oi) && oi > 0) {
                        updateOpenInterest(String(symbol), oi);
                    }
                }
                catch (_a) {
                    // ignore OI errors
                }
            }));
        };
        const id = setInterval(pollOpenInterest, intervalMs);
        pollOpenInterest();
        return () => {
            active = false;
            clearInterval(id);
        };
    }, [activeSymbols, authToken, useTestnet]);
    useEffect(() => {
        if (!authToken)
            return;
        const heartbeatId = setInterval(() => {
            const now = Date.now();
            const lastTick = feedLastTickRef.current;
            const staleMs = lastTick ? now - lastTick : Number.POSITIVE_INFINITY;
            if (staleMs > 60_000) {
                const lastRestart = lastRestartRef.current;
                if (now - lastRestart > 120_000) {
                    lastRestartRef.current = now;
                    addLogEntries([
                        {
                            id: `feed:stale:${now}`,
                            timestamp: new Date(now).toISOString(),
                            action: "ERROR",
                            message: `Price feed stale (${Math.round(staleMs / 1000)}s) - reconnecting`,
                        },
                    ]);
                    setFeedEpoch((v) => v + 1);
                }
            }
            if (now - lastHeartbeatRef.current < 60_000)
                return;
            lastHeartbeatRef.current = now;
        const scan = [];
        const hold = [];
        for (const symbol of activeSymbols) {
            const state = resolveSymbolState(symbol);
            if (state === "HOLD")
                hold.push(symbol);
            else
                scan.push(symbol);
        }
        const parts = [];
        if (scan.length)
            parts.push(`scan: ${scan.join(", ")}`);
        if (hold.length)
            parts.push(`hold: ${hold.join(", ")}`);
            const message = parts.length
                ? `BOT HEARTBEAT | ${parts.join(" | ")}`
                : "BOT HEARTBEAT | idle";
            addLogEntries([
                {
                    id: `heartbeat:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                    message,
                },
            ]);
        }, 30_000);
        return () => {
            clearInterval(heartbeatId);
        };
    }, [activeSymbols, addLogEntries, authToken, resolveSymbolState]);
    const systemState = useMemo(() => {
        const hasSuccess = Boolean(lastSuccessAt);
        const status = !authToken
            ? "Disconnected"
            : systemError
                ? "Error"
                : hasSuccess
                    ? "Connected"
                    : "Connecting...";
        return {
            bybitStatus: status,
            latency: lastLatencyMs ?? Number.NaN,
            lastError: systemError ?? null,
            recentErrors,
        };
    }, [authToken, lastLatencyMs, lastSuccessAt, recentErrors, systemError]);
    const portfolioState = useMemo(() => {
        const totalEquity = walletSnapshot?.totalEquity ?? Number.NaN;
        const availableBalance = walletSnapshot?.availableBalance ?? Number.NaN;
        const totalWalletBalance = walletSnapshot?.totalWalletBalance ?? Number.NaN;
        const openPositions = Array.isArray(positions)
            ? positions.length
            : Number.NaN;
        const allocatedCapital = Array.isArray(positions)
            ? positions.reduce((sum, p) => {
                const size = toNumber(p.size ?? p.qty);
                const entry = toNumber(p.entryPrice);
                if (!Number.isFinite(size) || !Number.isFinite(entry))
                    return sum;
                return sum + Math.abs(size * entry);
            }, 0)
            : Number.NaN;
        const dailyPnl = Array.isArray(closedPnlRecords)
            ? closedPnlRecords.reduce((sum, r) => {
                const dayAgo = Date.now() - 24 * 60 * 60_000;
                if (r.ts < dayAgo)
                    return sum;
                return sum + r.pnl;
            }, 0)
            : Number.NaN;
        return {
            totalEquity,
            availableBalance,
            dailyPnl,
            openPositions,
            totalCapital: Number.isFinite(totalEquity)
                ? totalEquity
                : totalWalletBalance,
            allocatedCapital,
            maxAllocatedCapital: totalWalletBalance,
            peakCapital: totalWalletBalance,
            currentDrawdown: Number.NaN,
            maxOpenPositions: settings.maxOpenPositions,
        };
    }, [closedPnlRecords, positions, settings.maxOpenPositions, walletSnapshot]);
    const resetPnlHistory = useCallback(() => {
        const symbols = new Set();
        if (assetPnlHistory) {
            Object.keys(assetPnlHistory).forEach((symbol) => {
                if (symbol)
                    symbols.add(symbol);
            });
        }
        if (Array.isArray(positions)) {
            positions.forEach((pos) => {
                if (pos.symbol)
                    symbols.add(pos.symbol);
            });
        }
        if (symbols.size === 0) {
            activeSymbols.forEach((symbol) => symbols.add(symbol));
        }
        const next = resetPnlHistoryMap(Array.from(symbols));
        setAssetPnlHistory(next);
        setClosedPnlRecords([]);
        pnlSeenRef.current = new Set();
    }, [activeSymbols, assetPnlHistory, positions]);
    const manualClosePosition = useCallback(async (pos) => {
        if (!allowPositionClose) {
            throw new Error("close_disabled");
        }
        if (!authToken)
            throw new Error("missing_auth_token");
        const sizeRaw = toNumber(pos.size ?? pos.qty);
        if (!Number.isFinite(sizeRaw) || sizeRaw <= 0) {
            throw new Error("invalid_position_qty");
        }
        const closeSide = String(pos.side).toLowerCase() === "buy" ? "Sell" : "Buy";
        const payload = {
            symbol: pos.symbol,
            side: closeSide,
            qty: Math.abs(sizeRaw),
            orderType: "Market",
            reduceOnly: true,
            timeInForce: "IOC",
            positionIdx: Number.isFinite(pos.positionIdx)
                ? pos.positionIdx
                : undefined,
        };
        const res = await fetch(`${apiBase}/order`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify(payload),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) {
            throw new Error(json?.error || `close_failed:${res.status}`);
        }
        await refreshFast();
        return true;
    }, [apiBase, authToken, refreshFast]);
    const cancelOrder = useCallback(async (order) => {
        if (!allowOrderCancel) {
            throw new Error("cancel_disabled");
        }
        if (!authToken)
            throw new Error("missing_auth_token");
        if (!order?.symbol)
            throw new Error("missing_order_symbol");
        const orderId = order?.orderId || "";
        const orderLinkId = order?.orderLinkId || "";
        if (!orderId && !orderLinkId)
            throw new Error("missing_order_id");
        const res = await fetch(`${apiBase}/cancel`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
                symbol: order.symbol,
                orderId: orderId || undefined,
                orderLinkId: orderLinkId || undefined,
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) {
            throw new Error(json?.error || `cancel_failed:${res.status}`);
        }
        await refreshFast();
        return true;
    }, [allowOrderCancel, apiBase, authToken, refreshFast]);
    const updateSettings = useCallback((next) => {
        setSettings(next);
    }, []);
    return {
        autoTrade,
        systemState,
        portfolioState,
        activePositions: positions,
        logEntries,
        testnetOrders: orders,
        testnetTrades: trades,
        ordersError,
        refreshTestnetOrders: refreshFast,
        assetPnlHistory,
        resetPnlHistory,
        scanDiagnostics,
        manualClosePosition,
        allowPositionClose,
        cancelOrder,
        allowOrderCancel,
        dynamicSymbols: null,
        settings,
        updateSettings,
        updateGateOverrides,
    };
}
