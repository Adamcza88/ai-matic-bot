// hooks/useTradingBot.ts
import { useState, useEffect, useRef, useCallback } from "react";
import {
    TradingMode,
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

import { Candle } from "@/engine/botEngine";
import { getApiBase, useNetworkConfig } from "../engine/networkConfig";
import { addEntryToHistory, loadEntryHistory, removeEntryFromHistory, persistEntryHistory } from "../lib/entryHistory";
import { addPnlRecord, AssetPnlMap, clearPnlHistory, loadPnlHistory } from "../lib/pnlHistory";
import { computeAtr as scalpComputeAtr } from "../engine/ta";
import {
    computeEma as scalpComputeEma,
    computeSma as scalpComputeSma,
    computeSuperTrend,
    findLastPivotHigh,
    findLastPivotLow,
    roundDownToStep,
    roundToTick,
    type SuperTrendDir,
} from "../engine/deterministicScalp";

type ViteEnv = { VITE_API_BASE?: string };
type BybitListResponse<T> = { list: T[]; retCode?: number; retMsg?: string };
type BybitOrder = {
    orderId?: string;
    orderID?: string;
    orderLinkId?: string;
    orderLinkID?: string;
    clientOrderId?: string;
    id?: string;
    symbol?: string;
    side?: string;
    qty?: number | string;
    cumExecQty?: number | string;
    price?: number | string;
    avgPrice?: number | string;
    avg_price?: number | string;
    orderStatus?: string;
    order_status?: string;
    status?: string;
    createdTime?: number | string;
    created_at?: number | string;
};
type BybitPosition = {
    symbol?: string;
    size?: number | string;
    qty?: number | string;
    side?: string;
    entryPrice?: number | string;
    avgEntryPrice?: number | string;
    stopLoss?: number | string;
    takeProfit?: number | string;
    trailingStop?: number | string;
};
type BybitExecution = {
    execId?: string;
    tradeId?: string;
    symbol?: string;
    execTime?: number | string;
    execPrice?: number | string;
    execQty?: number | string;
    side?: string;
    orderId?: string;
    orderID?: string;
    clOrdId?: string;
    orderLinkId?: string;
    orderLinkID?: string;
    clientOrderId?: string;
    price?: number | string;
    qty?: number | string;
};
type BybitTrade = {
    execId?: string;
    tradeId?: string;
    symbol?: string;
    side?: string;
    execPrice?: number | string;
    price?: number | string;
    execQty?: number | string;
    qty?: number | string;
    execValue?: number | string;
    value?: number | string;
    execFee?: number | string;
    fee?: number | string;
    execTime?: number | string;
    transactTime?: number | string;
    createdTime?: number | string;
};
type BybitPnl = {
    symbol?: string;
    closedPnl?: number | string;
    realisedPnl?: number | string;
    updatedTime?: number | string;
    execTime?: number | string;
    createdTime?: number | string;
};
type CoinBalance = { coin?: string; walletBalance?: number | string; equity?: number | string };
type OpenPosition = ActivePosition | BybitPosition;

// SYMBOLS (Deterministic Scalp Profile 1)
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];
// SYMBOLS (AI-MATIC-SCALP)
const SMC_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];
const ALL_SYMBOLS = Array.from(new Set([...SYMBOLS, ...SMC_SYMBOLS]));

// SIMULOVANÝ / DEFAULT KAPITÁL
const INITIAL_CAPITAL = 100; // Unified Trading balance snapshot
const MIN_ENTRY_SPACING_MS = 3000;
const LEVERAGE: Record<string, number> = {
    BTCUSDT: 100,
    ETHUSDT: 100,
    SOLUSDT: 100,
    ADAUSDT: 75,
};
const QTY_LIMITS: Record<string, { min: number; max: number }> = {
    BTCUSDT: { min: 0, max: 0.005 },
    ETHUSDT: { min: 0, max: 0.15 },
    SOLUSDT: { min: 0, max: 3.5 },
    ADAUSDT: { min: 0, max: 858 },
};
const QTY_STEPS: Record<string, number> = {
    BTCUSDT: 0.001,
    ETHUSDT: 0.01,
    SOLUSDT: 0.1,
    ADAUSDT: 1,
};
const PRICE_TICKS: Record<string, number> = {
    BTCUSDT: 0.1,
    ETHUSDT: 0.01,
    SOLUSDT: 0.001,
    ADAUSDT: 0.0001,
};
const ACCOUNT_BALANCE_USD = 100;
const RISK_PER_TRADE_USD = 4;
const MAX_TOTAL_RISK_USD = 8;
const MAX_ACTIVE_TRADES = 2;
const STOP_MIN_PCT = 0.0015; // 0.15 %
const MAX_LEVERAGE_ALLOWED = 100;
const PROTECTION_POST_FILL_DELAY_MS = 2000;
const PROTECTION_VERIFY_COOLDOWN_MS = 15000;
const TP_EXTEND_MIN_R = 1.6;
const TP_EXTEND_STEP_R = 0.5;
const PARTIAL_EXIT_MIN_R = 0.8;
const PARTIAL_EXIT_FRACTION = 0.5;
const BE_TRIGGER_R = 0.35;
const TP2_R = 1.6;
const TIME_STOP_MIN_R = 0.15;
const TIME_STOP_BARS_1M = 10;
const TIME_STOP_BARS_3M = 6;
const LATE_ENTRY_ATR = 0.6;
const SCALE_IN_MIN_R = 0.8;
const SCALE_IN_MARGIN_FRACTION = 0.5;
const MIN_NET_PROFIT_USD = 1.0;
const SCALE_IN_MAX_MISSING_GATES = 2;
const TRAIL_MIN_RETRACE_PCT = 0.004;
const SL_SLA_MS = 2000;
const SL_MAX_ATTEMPTS = 2;
const SL_RETRY_BACKOFF_MS = 350;
const SAFE_SYMBOL_HOLD_MS = 10 * 60_000;
const LOSS_STREAK_SYMBOL_COOLDOWN_MS = 45 * 60_000;
const AI_MATIC_X_LOSS_COOLDOWN_MS = 5 * 60_000;
const AI_MATIC_X_LOSS_STREAK_COOLDOWN_MS = 15 * 60_000;
const AI_MATIC_X_RISK_PCT_MIN = 0.0025;
const AI_MATIC_X_RISK_PCT_MAX = 0.006;
const LOSS_STREAK_RISK_USD = 2;
const RANGE_RISK_USD = 2;
const RANGE_TIMEOUT_MULT = 0.7;
const ENTRY_TF_BASE_MS = 3 * 60_000;
const ENTRY_TF_BOOST_MS = 60_000;
const QUOTA_LOOKBACK_MS = 3 * 60 * 60_000;
const QUOTA_BEHIND_PCT = 0.4;
const QUOTA_BOOST_MS = 90 * 60_000;
const QUALITY_SCORE_SOFT_BOOST = 55;
const QUALITY_SCORE_MID = 65;
const QUALITY_SCORE_LOW = 55;
const BETA_BUCKET = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"]);
const TARGET_TRADES_PER_DAY: Record<string, number> = {
    BTCUSDT: 6,
    ETHUSDT: 6,
    SOLUSDT: 8,
    ADAUSDT: 4,
};
const ENTRY_REPRICE_AFTER_MS = 1200;
const EXIT_REPRICE_AFTER_MS = 1000;
const SYMBOL_COOLDOWN_MS = 15_000;
const ENTRY_TIMEOUT_MS: Record<string, number> = {
    BTCUSDT: 4000,
    ETHUSDT: 4000,
    SOLUSDT: 5500,
    ADAUSDT: 5500,
};
const ENTRY_MAX_DRIFT_BPS: Record<string, number> = {
    BTCUSDT: 6,
    ETHUSDT: 8,
    SOLUSDT: 10,
    ADAUSDT: 10,
};
const BBO_STALE_MS = 1500;
const BBO_HARD_MS = 1200;
const BBO_STALE_SOFT_MS = 5000;
const BBO_BACKOFF_BASE_MS = 400;
const BBO_BACKOFF_MAX_MS = 4000;
const priceTickFor = (symbol: string, fallbackPrice?: number) => {
    const tick = PRICE_TICKS[symbol];
    if (Number.isFinite(tick) && tick > 0) return tick;
    const base = Number.isFinite(fallbackPrice) && fallbackPrice > 0 ? fallbackPrice : 1;
    return Math.max(base * 0.0001, 0.1);
};
const roundPriceToTick = (symbol: string, price?: number, fallbackPrice?: number) => {
    if (!Number.isFinite(price)) return price;
    const tick = priceTickFor(symbol, fallbackPrice ?? price);
    return roundToTick(price, tick);
};
const entryTimeoutMsFor = (symbol: string, isRange = false) => {
    const base = ENTRY_TIMEOUT_MS[symbol] ?? 4500;
    if (!isRange) return base;
    return Math.max(1200, Math.floor(base * RANGE_TIMEOUT_MULT));
};
const entryMaxDriftBpsFor = (symbol: string) => ENTRY_MAX_DRIFT_BPS[symbol] ?? 8;
const normalizeTp = (tp?: number | null) => {
    const val = Number(tp ?? 0);
    return Number.isFinite(val) && val > 0 ? val : undefined;
};
const resolveTrailTp = (dir: number, price: number, tp: number | null | undefined, oneR: number) => {
    const baseTp = normalizeTp(tp);
    if (!baseTp) return { tp: undefined, bumped: false };
    const priceOk = dir > 0 ? price < baseTp : price > baseTp;
    if (priceOk) return { tp: baseTp, bumped: false };
    const bump = Math.max(TP_EXTEND_STEP_R * oneR, Math.abs(price) * 0.002);
    const nextTp = dir > 0 ? price + bump : price - bump;
    return { tp: nextTp, bumped: true };
};
const MIN_NOTIONAL_USD: Record<string, number> = {
    BTCUSDT: 5,
    ETHUSDT: 5,
    SOLUSDT: 5,
    ADAUSDT: 5,
};
const HARD_SPREAD_BPS: Record<string, number> = {
    BTCUSDT: 8,
    ETHUSDT: 10,
    SOLUSDT: 14,
    ADAUSDT: 18,
};
const SOFT_SPREAD_BPS: Record<string, number> = {
    BTCUSDT: 4,
    ETHUSDT: 6,
    SOLUSDT: 8,
    ADAUSDT: 10,
};
const BREAK_BUFFER_BPS: Record<string, number> = {
    BTCUSDT: 2,
    ETHUSDT: 3,
    SOLUSDT: 5,
    ADAUSDT: 8,
};
const ATR_SWEET_SPOT: Record<string, { low: number; high: number }> = {
    BTCUSDT: { low: 0.001, high: 0.0035 },
    ETHUSDT: { low: 0.0012, high: 0.0045 },
    SOLUSDT: { low: 0.0018, high: 0.007 },
    ADAUSDT: { low: 0.002, high: 0.008 },
};
const QUALITY_SCORE_HIGH = 75;


// RISK / STRATEGY
const AI_MATIC_PRESET: AISettings = {
    riskMode: "ai-matic",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    enableHardGates: true,
    enableSoftGates: true,
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

const AI_MATIC_X_PRESET: AISettings = {
    riskMode: "ai-matic-x",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    enableHardGates: true,
    enableSoftGates: true,
    baseRiskPerTrade: 0.005,
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
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 0,
    minWinRate: 65,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
};

const AI_MATIC_SCALP_PRESET: AISettings = {
    riskMode: "ai-matic-scalp",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    enableHardGates: true,
    enableSoftGates: true,
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

export const INITIAL_RISK_SETTINGS: AISettings = AI_MATIC_PRESET;

const SETTINGS_STORAGE_KEY = "ai-matic-settings";

function loadStoredSettings(): AISettings | null {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed) return null;
        return {
            ...INITIAL_RISK_SETTINGS,
            ...parsed,
            tradingDays: Array.isArray(parsed.tradingDays) ? parsed.tradingDays : INITIAL_RISK_SETTINGS.tradingDays,
            maxOpenPositions: Math.min(2, parsed.maxOpenPositions ?? INITIAL_RISK_SETTINGS.maxOpenPositions),
        } as AISettings;
    } catch {
        return null;
    }
}

function persistSettings(s: AISettings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
    } catch {
        // ignore storage errors
    }
}

// UTILS
type RawKlineRow = [unknown, unknown, unknown, unknown, unknown, unknown, ...unknown[]];
function parseKlines(list: unknown[]): Candle[] {
    if (!Array.isArray(list)) return [];
    const parsed = list
        .map((row) => {
            if (!Array.isArray(row) || row.length < 6) return null;
            const [ts, open, high, low, close, volume] = row as RawKlineRow;
            const openTime = Number(ts);
            const candle: Candle = {
                openTime,
                open: parseFloat(String(open)),
                high: parseFloat(String(high)),
                low: parseFloat(String(low)),
                close: parseFloat(String(close)),
                volume: parseFloat(String(volume)),
            };
            return Number.isFinite(candle.openTime) ? candle : null;
        })
        .filter((c): c is Candle => Boolean(c));
    return parsed.sort((a, b) => a.openTime - b.openTime);
}

function snapshotSettings(settings: AISettings): AISettings {
    return {
        ...settings,
        tradingDays: [...settings.tradingDays],
    };
}

const presetFor = (mode: AISettings["riskMode"]): AISettings =>
    mode === "ai-matic-x"
        ? AI_MATIC_X_PRESET
        : mode === "ai-matic-scalp"
            ? AI_MATIC_SCALP_PRESET
            : AI_MATIC_PRESET;

const clampQtyForSymbol = (symbol: string, qty: number) => {
    const limits = QTY_LIMITS[symbol];
    if (!limits) return qty;
    return Math.min(limits.max, Math.max(limits.min, qty));
};

const maxQtyForSymbol = (symbol: string) => QTY_LIMITS[symbol]?.max ?? Number.POSITIVE_INFINITY;
const qtyStepForSymbol = (symbol: string) => QTY_STEPS[symbol] ?? 0.001;

const leverageFor = (symbol: string) => LEVERAGE[symbol] ?? 1;
const marginFor = (symbol: string, entry: number, size: number) =>
    (entry * size) / Math.max(1, leverageFor(symbol));

const getErrorMessage = (err: unknown) =>
    err instanceof Error ? err.message : String(err);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) =>
    Math.floor(min + Math.random() * Math.max(0, max - min));

const TAKER_FEE = 0.0006; // orientační taker fee (0.06%)

// === Market Structure Helpers ===
function isSwingHigh(candles: Candle[], idx: number, n = 2) {
    const hi = candles[idx]?.high ?? 0;
    if (!Number.isFinite(hi)) return false;
    for (let i = 1; i <= n; i++) {
        if (!candles[idx - i] || !candles[idx + i]) return false;
        if (candles[idx - i].high >= hi || candles[idx + i].high >= hi) return false;
    }
    return true;
}

function isSwingLow(candles: Candle[], idx: number, n = 2) {
    const lo = candles[idx]?.low ?? 0;
    if (!Number.isFinite(lo)) return false;
    for (let i = 1; i <= n; i++) {
        if (!candles[idx - i] || !candles[idx + i]) return false;
        if (candles[idx - i].low <= lo || candles[idx + i].low <= lo) return false;
    }
    return true;
}

function findRecentHigherLow(candles: Candle[], lookback = 60) {
    if (!candles || candles.length < 5) return null;
    const start = Math.max(2, candles.length - lookback);
    for (let i = candles.length - 3; i >= start; i--) {
        if (isSwingLow(candles, i, 2)) return candles[i].low;
    }
    return null;
}

function findRecentLowerHigh(candles: Candle[], lookback = 60) {
    if (!candles || candles.length < 5) return null;
    const start = Math.max(2, candles.length - lookback);
    for (let i = candles.length - 3; i >= start; i--) {
        if (isSwingHigh(candles, i, 2)) return candles[i].high;
    }
    return null;
}

const isKillzone = (nowMs: number): boolean => {
    const hour = new Date(nowMs).getUTCHours();
    const inLondon = hour >= 7 && hour < 10;
    const inNewYork = hour >= 13 && hour < 16;
    return inLondon || inNewYork;
};

const getAsiaSessionBounds = (nowMs: number): { start: number; end: number } => {
    const now = new Date(nowMs);
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();
    let start = Date.UTC(year, month, day, 0, 0, 0);
    let end = Date.UTC(year, month, day, 5, 0, 0);
    if (nowMs < end) {
        const prev = new Date(start - 24 * 60 * 60_000);
        start = Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate(), 0, 0, 0);
        end = Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate(), 5, 0, 0);
    }
    return { start, end };
};

const computeAsiaRange = (candles: Candle[], nowMs: number): { valid: boolean; high: number; low: number } => {
    if (!candles || candles.length < 10) return { valid: false, high: 0, low: 0 };
    const { start, end } = getAsiaSessionBounds(nowMs);
    const slice = candles.filter((c) => typeof c.openTime === "number" && c.openTime >= start && c.openTime < end);
    if (slice.length < 10) return { valid: false, high: 0, low: 0 };
    let high = -Infinity;
    let low = Infinity;
    slice.forEach((c) => {
        if (Number.isFinite(c.high)) high = Math.max(high, c.high);
        if (Number.isFinite(c.low)) low = Math.min(low, c.low);
    });
    return { valid: Number.isFinite(high) && Number.isFinite(low), high, low };
};

const detectFvg = (candles: Candle[], dir: "long" | "short"): boolean => {
    if (!candles || candles.length < 3) return false;
    const left = candles[candles.length - 3];
    const right = candles[candles.length - 1];
    if (!left || !right) return false;
    if (dir === "long") return Number.isFinite(left.high) && Number.isFinite(right.low) && left.high < right.low;
    return Number.isFinite(left.low) && Number.isFinite(right.high) && left.low > right.high;
};

const detectSweep = (candles: Candle[], isLong: boolean, atr: number, tickSize: number): boolean => {
    if (!candles || candles.length < 6) return false;
    const last = candles[candles.length - 1];
    const buffer = Math.max(tickSize || 0, (atr || 0) * 0.2);
    if (isLong) {
        const swingLow = findLastPivotLow(candles, 2, 2);
        if (!swingLow) return false;
        return last.low < swingLow.price - buffer && last.close > swingLow.price;
    }
    const swingHigh = findLastPivotHigh(candles, 2, 2);
    if (!swingHigh) return false;
    return last.high > swingHigh.price + buffer && last.close < swingHigh.price;
};

const detectChoch = (candles: Candle[], isLong: boolean): boolean => {
    if (!candles || candles.length < 6) return false;
    const last = candles[candles.length - 1];
    if (isLong) {
        const swingHigh = findLastPivotHigh(candles, 2, 2);
        return Boolean(swingHigh && last.close > swingHigh.price);
    }
    const swingLow = findLastPivotLow(candles, 2, 2);
    return Boolean(swingLow && last.close < swingLow.price);
};

const minNotionalFor = (symbol: string) => MIN_NOTIONAL_USD[symbol] ?? 5;

const openRiskUsd = (positions: ActivePosition[]) => {
    return positions.reduce((sum, p) => {
        if (!Number.isFinite(p.entryPrice) || !Number.isFinite(p.sl)) return MAX_TOTAL_RISK_USD;
        const size = p.size ?? p.qty ?? 0;
        if (!Number.isFinite(size) || size <= 0) return sum + MAX_TOTAL_RISK_USD;
        return sum + Math.abs(p.entryPrice - (p.sl as number)) * size;
    }, 0);
};

type SizingResult =
    | { ok: true; qty: number; notional: number; leverage: number; stopPct: number; feePct: number; effRiskPct: number; riskUsd: number }
    | { ok: false; reason: string };

function computePositionSizing(symbol: string, entry: number, sl: number, riskBudgetUsd = RISK_PER_TRADE_USD): SizingResult {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0) {
        return { ok: false, reason: "Invalid entry/SL" };
    }
    const stopPct = Math.abs(entry - sl) / entry;
    if (stopPct < STOP_MIN_PCT) {
        return { ok: false, reason: "Stop too tight" };
    }
    const feePct = TAKER_FEE * 2; // konzervativně taker-in + taker-out
    const effRiskPct = stopPct + feePct;
    if (effRiskPct <= 0) return { ok: false, reason: "Effective risk invalid" };

    const positionNotional = riskBudgetUsd / effRiskPct;
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
    if (riskUsd > riskBudgetUsd * 1.05) {
        return { ok: false, reason: `Risk ${riskUsd.toFixed(2)} exceeds per-trade cap` };
    }

    return { ok: true, qty, notional: qty * entry, leverage, stopPct, feePct, effRiskPct, riskUsd };
}

const netRrrWithFees = (entry: number, sl: number, tp: number, feePct: number) => {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) return 0;
    const risk = Math.abs(entry - sl) + entry * feePct * 2;
    const reward = Math.abs(tp - entry) - entry * feePct * 2;
    if (risk <= 0) return 0;
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

export const useTradingBot = (
    mode: TradingMode,
    useTestnet: boolean,
    authToken?: string
) => {
    // FIX 1: Hard Frontend Routing via centralized config
    const apiPrefix = getApiBase(useTestnet);

    useEffect(() => {
    }, [useTestnet, apiPrefix]);
    const { httpBase } = useNetworkConfig(useTestnet);
    const envBase = (import.meta as ImportMeta & { env?: ViteEnv }).env?.VITE_API_BASE ?? "";
    const inferredBase =
        typeof window !== "undefined" ? window.location.origin : "";
    const isLocalEnvBase = /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(envBase.trim());
    const runtimeHost = typeof window !== "undefined" ? window.location.hostname : "";
    const isRuntimeLocal = ["localhost", "127.0.0.1", "0.0.0.0"].includes(runtimeHost);
    const resolvedBase = !envBase || (isLocalEnvBase && !isRuntimeLocal) ? inferredBase : envBase;
    const apiBase = (resolvedBase || "").replace(/\/$/, "");

    type RequestKind = "data" | "order";
    const requestQueueRef = useRef<Promise<void>>(Promise.resolve());
    const requestTokensRef = useRef({
        lastRefillMs: Date.now(),
        dataTokens: 8,
        orderTokens: 2,
    });
    const requestOutcomesRef = useRef<{ outcomes: boolean[]; idx: number }>({
        outcomes: new Array(50).fill(true),
        idx: 0,
    });

    const noteRequestOutcome = (ok: boolean) => {
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
        if (dtSec <= 0) return;
        t.lastRefillMs = now;
        t.dataTokens = Math.min(8, t.dataTokens + dtSec * 8);
        t.orderTokens = Math.min(2, t.orderTokens + dtSec * 2);
    };

    const waitForToken = async (kind: RequestKind) => {
        while (true) {
            refillTokens();
            const t = requestTokensRef.current;
            const available = kind === "order" ? t.orderTokens : t.dataTokens;
            if (available >= 1) {
                if (kind === "order") t.orderTokens -= 1;
                else t.dataTokens -= 1;
                return;
            }
            const rate = kind === "order" ? 2 : 8;
            const deficit = 1 - available;
            const waitMs = Math.ceil((deficit / Math.max(1e-6, rate)) * 1000);
            await sleep(Math.min(250, Math.max(25, waitMs)));
        }
    };

    const runQueued = useCallback(
        async <T,>(kind: RequestKind, fn: () => Promise<T>): Promise<T> => {
            let release!: () => void;
            const gate = new Promise<void>((r) => (release = r));
            const prev = requestQueueRef.current;
            requestQueueRef.current = prev.then(() => gate, () => gate);

            await prev;
            await waitForToken(kind);
            try {
                const out = await fn();
                noteRequestOutcome(true);
                return out;
            } catch (err) {
                noteRequestOutcome(false);
                throw err;
            } finally {
                release();
            }
        },
        []
    );

    const queuedFetch = useCallback(
        async (input: RequestInfo | URL, init?: RequestInit, kind: RequestKind = "data") => {
            return runQueued(kind, async () => {
                const controller = new AbortController();
                const timeoutMs = kind === "order" ? 12000 : 8000;
                const id = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const nextInit = { ...(init || {}), signal: controller.signal };
                    return await fetch(input, nextInit);
                } finally {
                    clearTimeout(id);
                }
            });
        },
        [runQueued]
    );

    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);

    // Clear state on environment/auth change to prevent ghost positions
    useEffect(() => {
        setActivePositions([]);
        setPendingSignals([]);
        activePositionsRef.current = [];
        pendingSignalsRef.current = [];
    }, [authToken, useTestnet]);

    const [activePositions, setActivePositions] = useState<ActivePosition[]>(
        []
    );
    const [closedPositions] = useState<ClosedPosition[]>([]);
    const [dynamicSymbols, setDynamicSymbols] = useState<string[]>([]);
    const [pendingSignals, setPendingSignals] = useState<PendingSignal[]>([]);
    const pendingSignalsRef = useRef<PendingSignal[]>([]);
    const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(
        {}
    );
    const currentPricesRef = useRef<Record<string, number>>({});
    const [portfolioHistory] = useState<{ timestamp: string; totalCapital: number }[]>([]);
    const [newsHeadlines] = useState<NewsItem[]>([]);
    const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
    const [entryHistory, setEntryHistory] = useState<EntryHistoryRecord[]>([]);
    const [testnetOrders, setTestnetOrders] = useState<TestnetOrder[]>([]);
    const [testnetTrades, setTestnetTrades] = useState<TestnetTrade[]>([]);
    const [ordersError, setOrdersError] = useState<string | null>(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState<AssetPnlMap>(() => loadPnlHistory());
    const [scanDiagnostics, setScanDiagnostics] = useState<Record<string, {
        symbol: string;
        lastUpdated: number;
        signalActive: boolean;
        executionAllowed: boolean | string;
        bboAgeMs: number;
        spreadBps?: number;
        atrPct?: number;
        emaSlopeAbs?: number;
        regime?: "TREND" | "RANGE";
        quotaBoost?: boolean;
        tradeCount3h?: number;
        tradeTarget3h?: number;
        qualityScore?: number;
        qualityTier?: "LOW" | "MID" | "HIGH";
        qualityThreshold?: number;
        qualityPass?: boolean;
        qualityBreakdown?: Record<string, number>;
        qualityTopReason?: string;
        hardEnabled?: boolean;
        softEnabled?: boolean;
        hardBlock?: string;
        hardBlocked?: boolean;
        gates: { name: string; ok: boolean }[];
    }>>({});
    const scanDiagnosticsRef = useRef<Record<string, {
        symbol: string;
        lastUpdated: number;
        signalActive: boolean;
        executionAllowed: boolean | string;
        bboAgeMs: number;
        spreadBps?: number;
        atrPct?: number;
        emaSlopeAbs?: number;
        regime?: "TREND" | "RANGE";
        quotaBoost?: boolean;
        tradeCount3h?: number;
        tradeTarget3h?: number;
        qualityScore?: number;
        qualityTier?: "LOW" | "MID" | "HIGH";
        qualityThreshold?: number;
        qualityPass?: boolean;
        qualityBreakdown?: Record<string, number>;
        qualityTopReason?: string;
        hardEnabled?: boolean;
        softEnabled?: boolean;
        hardBlock?: string;
        hardBlocked?: boolean;
        gates: { name: string; ok: boolean }[];
    }>>({});
    const [walletEquity, setWalletEquity] = useState<number | null>(null);
    const [settings, setSettings] = useState<AISettings>(() => {
        if (typeof window !== "undefined") {
            const stored = loadStoredSettings();
            if (stored) return stored;
        }
        return INITIAL_RISK_SETTINGS;
    });

    const [systemState, setSystemState] = useState({
        bybitStatus: "Connecting...",
        latency: 0,
        lastError: null as string | null,
        recentErrors: [] as string[],
    });
    const activePositionsRef = useRef<ActivePosition[]>([]);
    const tradeCountsRef = useRef<Record<string, number[]>>({});
    const tradeCountSeenRef = useRef<Set<string>>(new Set());
    const tradeQuotaBoostRef = useRef<Record<string, number>>({});
    const closedPnlSeenRef = useRef<Set<string>>(new Set());
    const manualPnlResetRef = useRef<number>(0);
    const slRepairRef = useRef<Record<string, number>>({});
    const protectionTargetsRef = useRef<Record<string, { sl?: number; tp?: number; trailingStop?: number }>>({});
    const protectionVerifyRef = useRef<Record<string, number>>({});
    const tpExtendRef = useRef<Record<string, number>>({});
    const partialExitRef = useRef<Record<string, number>>({});
    const timeStopRef = useRef<Record<string, number>>({});
    const manageBarRef = useRef<Record<string, number>>({});
    const scaleInRef = useRef<Record<string, boolean>>({});
    const commitProtectionRef = useRef<((tradeId: string, symbol: string, sl?: number, tp?: number, trailingStop?: number) => Promise<boolean>) | null>(null);

    const [portfolioState, setPortfolioState] = useState({
        totalCapital: INITIAL_CAPITAL,
        allocatedCapital: 0,
        maxAllocatedCapital:
            INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxAllocatedCapitalPercent,
        dailyPnl: 0,
        peakCapital: INITIAL_CAPITAL,
        currentDrawdown: 0,
        openPositions: 0,
        maxOpenPositions: INITIAL_RISK_SETTINGS.maxOpenPositions,
    });
    const lastEntryAtRef = useRef<number | null>(null);
    const entryQueueRef = useRef<Promise<void>>(Promise.resolve());
    const executionLocksRef = useRef<Set<string>>(new Set()); // Mutex for dedup
    const positionsCacheRef = useRef<{ ts: number; data: BybitListResponse<BybitPosition> }>({
        ts: 0,
        data: { list: [] },
    });
    const orderHistoryCacheRef = useRef<{ ts: number; data: BybitListResponse<BybitOrder> }>({
        ts: 0,
        data: { list: [] },
    });

    // Dynamicky uprav capital/max allocation pro testovací režim
    useEffect(() => {
        const isTest = settings.entryStrictness === "test";
        setPortfolioState((prev) => {
            const baseCapital = walletEquity ?? prev.totalCapital ?? INITIAL_CAPITAL;
            const totalCapital = isTest ? prev.totalCapital || baseCapital : baseCapital;
            const pctCap = totalCapital * settings.maxAllocatedCapitalPercent;
            const maxAlloc = isTest ? Math.min(1000000, pctCap) : pctCap;
            return {
                ...prev,
                totalCapital,
                maxAllocatedCapital: maxAlloc,
                allocatedCapital: isTest ? Math.min(prev.allocatedCapital, maxAlloc) : prev.allocatedCapital,
                maxOpenPositions: settings.maxOpenPositions,
            };
        });
    }, [
        settings.entryStrictness,
        settings.maxAllocatedCapitalPercent,
        settings.maxOpenPositions,
        walletEquity,
    ]);

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
        const checkReset = () => {
            const today = new Date().toISOString().split("T")[0];
            if (!lastResetDayRef.current) {
                lastResetDayRef.current = today;
                try {
                    if (typeof localStorage !== "undefined") {
                        localStorage.setItem("ai-matic:last-reset-day", today);
                    }
                } catch {
                    // ignore storage errors
                }
                return;
            }
            if (lastResetDayRef.current !== today) {
                lastResetDayRef.current = today;
                try {
                    if (typeof localStorage !== "undefined") {
                        localStorage.setItem("ai-matic:last-reset-day", today);
                    }
                } catch {
                    // ignore storage errors
                }
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
                    };
                });
                closedPnlSeenRef.current = new Set();
                symbolLossStreakRef.current = {};
                winStreakRef.current = 0;
                lossStreakRef.current = 0;
                riskCutActiveRef.current = false;
                tradeCountsRef.current = {};
                tradeCountSeenRef.current = new Set();
                tradeQuotaBoostRef.current = {};
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
        if (!authToken) return;
        let cancel = false;
        const fetchWallet = async () => {
            try {
                const url = new URL(`${apiBase}${apiPrefix}/wallet`);
                url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
                const res = await queuedFetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                }, "data");
                if (!res.ok) return;
                const json = await res.json();
                const payload = json?.data ?? json ?? {};
                const retCode = Number(payload?.retCode ?? 0);
                if (Number.isFinite(retCode) && retCode !== 0) return;
                const result = payload?.result ?? payload?.data?.result ?? payload ?? {};
                type UnifiedWalletEntry = {
                    coin?: unknown;
                    totalEquity?: number | string;
                    totalWalletBalance?: number | string;
                    totalMarginBalance?: number | string;
                    totalAvailableBalance?: number | string;
                    totalInitialMargin?: number | string;
                    totalPositionIM?: number | string;
                    totalOrderIM?: number | string;
                };
                const list = Array.isArray(result?.list)
                    ? (result.list as UnifiedWalletEntry[])
                    : Array.isArray(payload?.list)
                        ? (payload.list as UnifiedWalletEntry[])
                        : [];
                const first = list[0];
                const coins = Array.isArray(first?.coin) ? (first.coin as CoinBalance[]) : [];
                const pickCoin = coins.find((c) => c.coin === "USDT") || coins.find((c) => c.coin === "USD");
                const coinBalance = pickCoin ? Number(pickCoin.walletBalance ?? pickCoin.equity) : null;
                const totalEquityRaw = Number(
                    first?.totalEquity ??
                    result?.totalEquity ??
                    payload?.totalEquity ??
                    first?.totalWalletBalance ??
                    result?.totalWalletBalance ??
                    payload?.totalWalletBalance ??
                    first?.totalMarginBalance ??
                    result?.totalMarginBalance ??
                    payload?.totalMarginBalance ??
                    0
                );
                const totalAvailable = Number(first?.totalAvailableBalance ?? 0);
                const totalInitialMargin = Number(first?.totalInitialMargin ?? 0);
                const totalPositionIM = Number(first?.totalPositionIM ?? 0);
                const totalOrderIM = Number(first?.totalOrderIM ?? 0);
                const equityFallback = Number(
                    payload?.totalEquity ??
                    (json as { totalEquity?: number | string } | null)?.totalEquity ??
                    0
                );
                const equity = Number.isFinite(totalEquityRaw) && totalEquityRaw > 0
                    ? totalEquityRaw
                    : Number.isFinite(coinBalance ?? NaN) && (coinBalance as number) > 0
                        ? (coinBalance as number)
                        : Number.isFinite(equityFallback) && equityFallback > 0
                            ? equityFallback
                            : null;
                const marginUsed = Number.isFinite(totalInitialMargin) && totalInitialMargin > 0
                    ? totalInitialMargin
                    : (Number.isFinite(totalPositionIM) && totalPositionIM > 0) || (Number.isFinite(totalOrderIM) && totalOrderIM > 0)
                        ? Math.max(0, (Number.isFinite(totalPositionIM) ? totalPositionIM : 0) + (Number.isFinite(totalOrderIM) ? totalOrderIM : 0))
                        : null;
                const allocated = equity != null && Number.isFinite(totalAvailable) && totalAvailable > 0
                    ? Math.max(0, equity - totalAvailable)
                    : marginUsed;
                if (equity != null && !cancel) {
                    setPortfolioState((prev) => ({
                        ...prev,
                        totalCapital: equity,
                        allocatedCapital: Number.isFinite(allocated ?? NaN) ? (allocated as number) : prev.allocatedCapital,
                        maxAllocatedCapital: equity * (settingsRef.current.maxAllocatedCapitalPercent || 1),
                        peakCapital: Math.max(prev.peakCapital, equity),
                    }));
                    setWalletEquity(equity);
                }
            } catch {
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
            const currentDrawdown =
                peakCapital > 0 ? (peakCapital - equity) / peakCapital : 0;
            if (
                peakCapital === prev.peakCapital &&
                currentDrawdown === prev.currentDrawdown
            ) {
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
        closedPnlSeenRef.current = new Set();
    }, []);

    // Keep only top-2 highest-risk pending signals to focus on nejpravděpodobnější obchody
    useEffect(() => {
        setPendingSignals((prev) => {
            if (prev.length <= 2) return prev;
            const sorted = [...prev].sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0));
            const trimmed = sorted.slice(0, 2);
            const same =
                trimmed.length === prev.length &&
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

    useEffect(() => {
        scanDiagnosticsRef.current = scanDiagnostics;
    }, [scanDiagnostics]);

    useEffect(() => {
        const activeSymbols = new Set(activePositions.map((p) => p.symbol));
        for (const sym of Object.keys(protectionTargetsRef.current)) {
            if (!activeSymbols.has(sym)) {
                delete protectionTargetsRef.current[sym];
                delete protectionVerifyRef.current[sym];
                delete tpExtendRef.current[sym];
                delete partialExitRef.current[sym];
                delete timeStopRef.current[sym];
                delete manageBarRef.current[sym];
                delete scaleInRef.current[sym];
            }
        }
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
            if (useTestnet) setOrdersError("Missing auth token");
            return;
        }
        if (!apiBase) {
            setTestnetOrders([]);
            setOrdersError("Orders API unavailable: missing API base");
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
            const items: BybitOrder[] = Array.isArray(list) ? (list as BybitOrder[]) : [];
            const toIso = (ts: unknown) => {
                const n = Number(ts);
                return Number.isFinite(n) && n > 0
                    ? new Date(n).toISOString()
                    : new Date().toISOString();
            };
            const mapped: TestnetOrder[] = items.map((o) => ({
                orderId: String(o.orderId || o.orderLinkId || o.id || Date.now()),
                symbol: o.symbol || "",
                side: o.side === "Sell" ? "Sell" : "Buy",
                qty: Number(o.qty ?? o.cumExecQty ?? 0),
                price: o.price != null ? Number(o.price) : o.avgPrice != null ? Number(o.avgPrice) : null,
                status: o.orderStatus || o.status || "unknown",
                createdTime: toIso(o.createdTime ?? o.created_at ?? Date.now()),
            }));

            // For now, we store everything in "testnetOrders" state variable which is actually just "orders"
            setTestnetOrders(mapped);
        } catch (err) {
            console.error(`[fetchOrders] Error:`, err);
            setOrdersError(getErrorMessage(err) || "Failed to load orders");
        }
    }, [authToken, useTestnet, apiBase, apiPrefix, envBase, inferredBase]);

    // Pozice/PnL přímo z Bybitu – přepíší simulované activePositions
    // RECONCILE LOOP: Jednotný zdroj pravdy z backendu
    // RECONCILE LOOP: Jednotný zdroj pravdy z backendu
    useEffect(() => {
        if (!authToken) return;

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
                if (cancel) return;

                if (!json.ok || !json.data) {
                    // console.warn("Reconcile response not OK:", json);
                    return;
                }

                const { positions, orders, diffs, meta } = json.data;

                // 1. HARD SYNC POSITIONS
                const mappedPositions: ActivePosition[] = Array.isArray(positions) ? positions : [];
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
                const mappedOrders: TestnetOrder[] = Array.isArray(orders)
                    ? (orders as BybitOrder[]).map((o) => ({
                        orderId: String(o.orderId || o.orderLinkId || Date.now()),
                        symbol: o.symbol || "",
                        side: o.side === "Sell" ? "Sell" : "Buy",
                        qty: Number(o.qty ?? 0),
                        price: o.price != null ? Number(o.price) : null,
                        status: o.orderStatus || o.status || "unknown",
                        createdTime: new Date(Number(o.createdTime ?? Date.now())).toISOString(),
                    }))
                    : [];
                setTestnetOrders(mappedOrders);

                // 3. VISUAL INDICATORS
                const diffList = Array.isArray(diffs) ? diffs : [];
                if (diffList.length > 0) {
                    const nowMs = Date.now();
                    const repairCooldownMs = 30_000;
                    for (const d of diffList as { message?: unknown; symbol?: unknown; field?: unknown; severity?: unknown }[]) {
                        const msg = String(d?.message || "");
                        const symbol = String(d?.symbol || "");
                        const isMissingSl = d?.field === "sl" || msg.toLowerCase().includes("stop loss");
                        if (isMissingSl && symbol) {
                            const pos = mappedPositions.find((p) => p.symbol === symbol);
                            const lastRepairAt = slRepairRef.current[symbol] ?? 0;
                            if (pos && nowMs - lastRepairAt >= repairCooldownMs) {
                                const entry = Number(pos.entryPrice ?? 0);
                                const size = Number(pos.size ?? pos.qty ?? 0);
                                if (Number.isFinite(entry) && entry > 0 && Number.isFinite(size) && size > 0) {
                                    const dir = String(pos.side || "").toLowerCase() === "buy" ? 1 : -1;
                                    const baseR = Math.max(entry * STOP_MIN_PCT, entry * 0.002);
                                    const lastPx = currentPricesRef.current[symbol] || entry;
                                    const buffer = Math.max(entry * STOP_MIN_PCT, entry * 0.001, 0.1);
                                    const fallbackSl = dir > 0
                                        ? Math.min(entry - baseR, lastPx - buffer)
                                        : Math.max(entry + baseR, lastPx + buffer);
                                    const fallbackTp = dir > 0
                                        ? Math.max(entry + 1.4 * baseR, lastPx + buffer)
                                        : Math.min(entry - 1.4 * baseR, lastPx - buffer);
                                    slRepairRef.current[symbol] = nowMs;
                                    const commit = commitProtectionRef.current;
                                    if (commit) {
                                        void commit(`recon-fix-${symbol}-${nowMs}`, symbol, fallbackSl, fallbackTp);
                                        addLog({ action: "SYSTEM", message: `[Reconcile] Auto-fix SL/TP queued for ${symbol}` });
                                    }
                                    continue;
                                }
                            }
                        }
                        if (d.severity === "HIGH") {
                            addLog({ action: "ERROR", message: `[Reconcile] ${String(d.message || "")} (${symbol})` });
                        }
                    }
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
                            ? (pnlList as BybitPnl[]).map((r) => {
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
                        const filteredRecords: AssetPnlRecord[] = filtered.map((rec) => ({
                            symbol: rec.symbol,
                            pnl: rec.pnl,
                            timestamp: rec.timestamp,
                            note: rec.note,
                        }));

                        setAssetPnlHistory((prev) => {
                            const next: AssetPnlMap = { ...prev };
                            const seen = closedPnlSeenRef.current;
                            filteredRecords.forEach((rec) => {
                                const key = `${rec.symbol}-${rec.timestamp}-${rec.pnl}`;
                                if (seen.has(key)) return;
                                seen.add(key);
                                next[rec.symbol] = [rec, ...(next[rec.symbol] || [])].slice(0, 100);
                                addPnlRecord(rec);
                                registerOutcome(rec.symbol, rec.pnl);
                            });
                            if (seen.size > 500) {
                                const trimmed = Array.from(seen).slice(-400);
                                closedPnlSeenRef.current = new Set(trimmed);
                            }
                            return next;
                        });

                        const realizedToday = filteredRecords.reduce((sum, r) => sum + (r.pnl || 0), 0);
                        realizedPnlRef.current = realizedToday; // Daily realized PnL (today only)
                    } else {
                        realizedPnlRef.current = 0;
                    }
                } catch (e) {
                    console.warn("Closed PnL fetch failed", e);
                }

            } catch (err) {
                if (cancel) return;
                console.error("Reconcile error:", err);
                dataUnavailableRef.current = true;
                const message = getErrorMessage(err) || "reconcile error";
                setSystemState((prev) => ({ ...prev, bybitStatus: "Error", latency: 0, lastError: message }));
                logAuditEntry("ERROR", "MULTI", "DATA_FEED", [{ name: "API", result: "FAIL" }], "STOP", message, {});
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
            const allowed = new Set([...ALL_SYMBOLS, ...dynamicSymbolsRef.current]);
            const items: BybitTrade[] = Array.isArray(list) ? (list as BybitTrade[]) : [];
            const mapped: TestnetTrade[] = items
                .filter((t) => allowed.has(t.symbol || ""))
                .map((t) => {
                    const ts = Number(t.execTime ?? t.transactTime ?? t.createdTime ?? Date.now());
                    return {
                        id: String(t.execId || t.tradeId || Date.now()),
                        symbol: t.symbol || "",
                        side: t.side === "Sell" ? "Sell" : "Buy",
                        price: Number(t.execPrice ?? t.price ?? 0),
                        qty: Number(t.execQty ?? t.qty ?? 0),
                        value: Number(t.execValue ?? t.value ?? 0),
                        fee: Number(t.execFee ?? t.fee ?? 0),
                        time: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
                    };
                });
            setTestnetTrades(mapped);
        } catch (err) {
            setOrdersError((prev) => prev || getErrorMessage(err) || "Failed to load trades");
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

    const setLifecycle = (tradeId: string, status: string, note?: string) => {
        lifecycleRef.current.set(tradeId, status);
        addLog({
            action: "SYSTEM",
            message: `[${tradeId}] ${status}${note ? ` | ${note}` : ""}`,
        });
    };

    const forceClosePosition = useCallback(
        async (pos: ActivePosition) => {
            if (!authToken) return;
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
            } catch (err) {
                addLog({
                    action: "ERROR",
                    message: `Force close failed: ${getErrorMessage(err) || "unknown"}`,
                });
            }
        },
        [apiBase, authToken, useTestnet]
    );

    const fetchExitBbo = useCallback(
        async (symbol: string): Promise<{ bid: number; ask: number }> => {
            const url = `${httpBase}/v5/market/tickers?category=linear&symbol=${symbol}`;
            const res = await queuedFetch(url, undefined, "data");
            const json = await res.json();
            if (json.retCode !== 0) throw new Error(json.retMsg);
            const item = json?.result?.list?.[0];
            const bid = Number(item?.bid1Price ?? 0);
            const ask = Number(item?.ask1Price ?? 0);
            if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
                throw new Error(`Invalid BBO for ${symbol}`);
            }
            return { bid, ask };
        },
        [httpBase, queuedFetch]
    );

    const cancelOrderByLinkId = useCallback(
        async (symbol: string, orderLinkId: string) => {
            if (!authToken) return;
            const res = await queuedFetch(`${apiBase}${apiPrefix}/cancel?net=${useTestnet ? "testnet" : "mainnet"}`, {
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
            if (rc && rc !== 0) throw new Error(body?.data?.retMsg || body?.retMsg || "Cancel rejected");
        },
        [apiBase, apiPrefix, authToken, queuedFetch, useTestnet]
    );

    const placeReduceOnlyLimit = useCallback(
        async (symbol: string, side: "Buy" | "Sell", qty: number, price: number, timeInForce: "PostOnly" | "IOC", orderLinkId: string, reason: string) => {
            if (!authToken) return false;
            const step = qtyStepForSymbol(symbol);
            const safeQty = roundDownToStep(qty, step);
            if (!Number.isFinite(safeQty) || safeQty < step) return false;
            const safePrice = roundPriceToTick(symbol, price, currentPricesRef.current[symbol]);
            try {
                await queuedFetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                        symbol,
                        side,
                        qty: safeQty,
                        orderType: "Limit",
                        price: safePrice,
                        timeInForce,
                        reduceOnly: true,
                        orderLinkId,
                    }),
                }, "order");
                addLog({
                    action: "AUTO_CLOSE",
                    message: `Reduce-only exit ${symbol} qty=${safeQty} tif=${timeInForce} reason=${reason}`,
                });
                return true;
            } catch (err) {
                addLog({
                    action: "ERROR",
                    message: `Reduce-only exit failed ${symbol}: ${getErrorMessage(err) || "unknown"}`,
                });
                return false;
            }
        },
        [apiBase, apiPrefix, authToken, queuedFetch, useTestnet]
    );

    const fetchPositionsOnce = useCallback(
        async (net: "testnet" | "mainnet"): Promise<BybitListResponse<BybitPosition>> => {
            if (!authToken) return { list: [] };
            const now = Date.now();
            const cache = positionsCacheRef.current;
            if (now - cache.ts < 2000) return cache.data;

            const url = new URL(`${apiBase}${apiPrefix}/positions`);
            url.searchParams.set("net", net);
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            const res = await queuedFetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            }, "data");
            if (!res.ok) throw new Error(`Positions fetch failed (${res.status})`);
            const json = await res.json();
            const data: BybitListResponse<BybitPosition> = {
                list: Array.isArray(json?.data?.result?.list || json?.result?.list || json?.data?.list)
                    ? (json.data?.result?.list || json?.result?.list || json?.data?.list)
                    : [],
                retCode: json?.data?.retCode ?? json?.retCode,
                retMsg: json?.data?.retMsg ?? json?.retMsg,
            };
            positionsCacheRef.current = { ts: now, data };
            return data;
        },
        [apiBase, apiPrefix, authToken, queuedFetch]
    );

    const placeReduceOnlyExit = useCallback(
        async (symbol: string, side: "Buy" | "Sell", qty: number, reason: string) => {
            if (!authToken) return false;
            let bbo;
            try {
                bbo = await fetchExitBbo(symbol);
            } catch (err) {
                addLog({ action: "ERROR", message: `EXIT_BBO_FAIL ${symbol} ${getErrorMessage(err) || "unknown"}` });
                return false;
            }
            const makerPrice = side === "Sell" ? bbo.ask : bbo.bid;
            const aggressivePrice = side === "Sell" ? bbo.bid : bbo.ask;
            const orderLinkId = `exit:${reason}:${symbol}:${Date.now()}`;
            const placed = await placeReduceOnlyLimit(symbol, side, qty, makerPrice, "PostOnly", orderLinkId, reason);
            if (!placed) {
                return placeReduceOnlyLimit(symbol, side, qty, aggressivePrice, "IOC", `exit2:${reason}:${symbol}:${Date.now()}`, reason);
            }
            await sleep(EXIT_REPRICE_AFTER_MS);
            const posResp = await fetchPositionsOnce(useTestnet ? "testnet" : "mainnet");
            const pos = posResp.list.find((p) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0);
            if (!pos) return true;
            const remaining = Math.abs(Number(pos.size ?? 0));
            const step = qtyStepForSymbol(symbol);
            const remainingQty = roundDownToStep(Math.min(qty, remaining), step);
            if (!Number.isFinite(remainingQty) || remainingQty < step) return true;
            try {
                await cancelOrderByLinkId(symbol, orderLinkId);
            } catch {
                // ignore cancel errors (may already be filled)
            }
            return placeReduceOnlyLimit(symbol, side, remainingQty, aggressivePrice, "IOC", `exit2:${reason}:${symbol}:${Date.now()}`, reason);
        },
        [authToken, cancelOrderByLinkId, fetchExitBbo, fetchPositionsOnce, placeReduceOnlyLimit, useTestnet]
    );

    const placeAddMarket = useCallback(
        async (symbol: string, side: "Buy" | "Sell", qty: number, reason: string) => {
            if (!authToken) return false;
            try {
                const res = await queuedFetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
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
                        reduceOnly: false,
                        orderLinkId: `scalein-${symbol}-${Date.now()}`,
                        leverage: leverageFor(symbol),
                    }),
                }, "order");
                const body = await res.json().catch(() => ({}));
                if (!res.ok || body?.ok === false) {
                    throw new Error(body?.error || `Scale-in failed (${res.status})`);
                }
                const rc = body?.data?.retCode ?? body?.retCode;
                if (rc && rc !== 0) {
                    throw new Error(body?.data?.retMsg || body?.retMsg || "Scale-in rejected");
                }
                return true;
            } catch (err) {
                addLog({
                    action: "ERROR",
                    message: `Scale-in failed ${symbol}: ${getErrorMessage(err) || "unknown"}`,
                });
                return false;
            }
        },
        [apiBase, apiPrefix, authToken, queuedFetch, useTestnet]
    );

    const fetchOrderHistoryOnce = useCallback(
        async (net: "testnet" | "mainnet"): Promise<BybitListResponse<BybitOrder>> => {
            if (!authToken) return { list: [] };
            const now = Date.now();
            const cache = orderHistoryCacheRef.current;
            if (now - cache.ts < 2000) return cache.data;

            const url = new URL(`${apiBase}${apiPrefix}/orders`);
            url.searchParams.set("net", net);
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            url.searchParams.set("history", "1");
            const res = await queuedFetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            }, "data");
            if (!res.ok) throw new Error(`Order history fetch failed (${res.status})`);
            const data = await res.json();
            const retCode = data?.data?.retCode ?? data?.retCode;
            const retMsg = data?.data?.retMsg ?? data?.retMsg;
            const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
            const parsed: BybitListResponse<BybitOrder> = {
                list: Array.isArray(list) ? (list as BybitOrder[]) : [],
                retCode,
                retMsg,
            };
            orderHistoryCacheRef.current = { ts: now, data: parsed };
            return parsed;
        },
        [apiBase, apiPrefix, authToken]
    );

    const fetchExecutionsOnce = useCallback(
        async (
            net: "testnet" | "mainnet",
            symbol?: string
        ): Promise<BybitListResponse<BybitExecution>> => {
            if (!authToken) return { list: [] };
            const url = new URL(`${apiBase}${apiPrefix}/executions`);
            url.searchParams.set("net", net);
            url.searchParams.set("limit", "100");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            if (symbol) url.searchParams.set("symbol", symbol);
            const res = await queuedFetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            }, "data");
            if (!res.ok) throw new Error(`Executions fetch failed (${res.status})`);
            const data = await res.json();
            const retCode = data?.data?.retCode ?? data?.retCode;
            const retMsg = data?.data?.retMsg ?? data?.retMsg;
            const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
            return { list: Array.isArray(list) ? (list as BybitExecution[]) : [], retCode, retMsg };
        },
        [apiBase, apiPrefix, authToken]
    );

    const waitForFill = useCallback(
        async (
            tradeId: string,
            symbol: string,
            orderId?: string | null,
            orderLinkId?: string | null,
            maxWaitMs: number = 90000
        ) => {
            const net = useTestnet ? "testnet" : "mainnet";
            const started = Date.now();
            while (Date.now() - started < maxWaitMs) {
                // 1) In-memory executions seen by polling loop
                try {
                    const execHit = executionEventsRef.current.find((e) => {
                        if (e.symbol !== symbol) return false;
                        if (orderId && e.orderId && e.orderId === orderId) return true;
                        if (orderLinkId && e.orderLinkId && e.orderLinkId === orderLinkId) return true;
                        return !orderId && !orderLinkId;
                    });
                    if (execHit) return execHit;
                } catch {
                    /* ignore */
                }

                // 2) Fresh executions snapshot
                try {
                    const executionsResp = await fetchExecutionsOnce(net, symbol);
                    if (executionsResp.retCode && executionsResp.retCode !== 0) {
                        addLog({
                            action: "ERROR",
                            message: `Executions retCode=${executionsResp.retCode} ${executionsResp.retMsg || ""}`,
                        });
                    }
                    const execSnapshot = executionsResp.list.find((e) => {
                        if (e.symbol !== symbol) return false;
                        if (orderId && e.orderId && e.orderId === orderId) return true;
                        if (orderLinkId && e.orderLinkId && e.orderLinkId === orderLinkId) return true;
                        return !orderId && !orderLinkId;
                    });
                    if (execSnapshot) return execSnapshot;
                } catch (err) {
                    addLog({ action: "ERROR", message: `waitForFill check 'executions' failed: ${getErrorMessage(err)}`});
                }

                // 3) Order history snapshot
                try {
                    const historyResp = await fetchOrderHistoryOnce(net);
                    if (historyResp.retCode && historyResp.retCode !== 0) {
                        addLog({
                            action: "ERROR",
                            message: `Order history retCode=${historyResp.retCode} ${historyResp.retMsg || ""}`,
                        });
                    }
                    const histMatch = historyResp.list.find((o) => {
                        if (o.symbol !== symbol) return false;
                        if (orderId && o.orderId && o.orderId === orderId) return true;
                        if (orderLinkId && o.orderLinkId && o.orderLinkId === orderLinkId) return true;
                        return !orderId && !orderLinkId;
                    });
                    if (histMatch) {
                        const st = String(histMatch.orderStatus || histMatch.status || "");
                        if (st === "Filled" || st === "PartiallyFilled") return histMatch;
                        if (st === "Rejected") throw new Error("Order Rejected");
                        if (st === "Cancelled") throw new Error("Order Cancelled");
                    }
                } catch (err) {
                    addLog({ action: "ERROR", message: `waitForFill check 'history' failed: ${getErrorMessage(err)}`});
                }


                // 4) Positions snapshot (with retCode log)
                try {
                    const posResp = await fetchPositionsOnce(net);
                    if (posResp.retCode && posResp.retCode !== 0) {
                        addLog({
                            action: "ERROR",
                            message: `Positions retCode=${posResp.retCode} ${posResp.retMsg || ""}`,
                        });
                    }
                    const found = posResp.list.find((p) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0);
                    if (found) return found;
                } catch (err) {
                    addLog({ action: "ERROR", message: `waitForFill check 'positions' failed: ${getErrorMessage(err)}`});
                }


                await sleep(jitter(750, 1500));
            }
            const waitedSec = Math.round((Date.now() - started) / 1000);
            throw new Error(`Fill not confirmed for ${symbol} within ${waitedSec}s`);
        },
        [addLog, fetchExecutionsOnce, fetchOrderHistoryOnce, fetchPositionsOnce, useTestnet]
    );

    const commitProtection = useCallback(
        async (tradeId: string, symbol: string, sl?: number, tp?: number, trailingStop?: number) => {
            if (!authToken) return false;
            const net = useTestnet ? "testnet" : "mainnet";
            const tolerance = Math.abs((currentPricesRef.current[symbol] ?? 0) * 0.001) || 0.5;
            const findOpenPos = async () => {
                let pos: OpenPosition | undefined = activePositionsRef.current.find(
                    (p) => p.symbol === symbol && Math.abs(Number(p.size ?? p.qty ?? 0)) > 0
                );
                if (pos) return pos;
                try {
                    const posResp = await fetchPositionsOnce(net);
                    pos = posResp.list.find(
                        (p) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0
                    );
                    return pos || null;
                } catch (err) {
                    addLog({ action: "ERROR", message: `Protection precheck failed: ${getErrorMessage(err) || "unknown"}` });
                    return null;
                }
            };
            const safeSl = sl;
            let safeTp = tp;
            for (let attempt = 1; attempt <= 3; attempt++) {
                const foundPos = await findOpenPos();
                if (!foundPos) {
                    addLog({ action: "SYSTEM", message: `PROTECTION_WAIT ${symbol} no open position (attempt ${attempt})` });
                    await new Promise((r) => setTimeout(r, 600));
                    continue;
                }
                const lastPx = currentPricesRef.current[symbol] ?? Number(foundPos.entryPrice ?? foundPos.avgEntryPrice ?? 0);
                const isBuy = String(foundPos.side ?? "").toLowerCase() === "buy";
                const tick = priceTickFor(symbol, lastPx);
                const minGap = Math.max((lastPx || 1) * 0.0001, tick);
                const slRounded = roundPriceToTick(symbol, safeSl, lastPx);
                let tpRounded = roundPriceToTick(symbol, safeTp, lastPx);
                if (Number.isFinite(lastPx) && lastPx > 0) {
                    if (slRounded != null) {
                        const invalidSl = isBuy ? slRounded >= lastPx - minGap : slRounded <= lastPx + minGap;
                        if (invalidSl) {
                            addLog({ action: "ERROR", message: `PROTECTION_INVALID_SL ${symbol} sl=${slRounded} last=${lastPx}` });
                            return false;
                        }
                    }
                    if (tpRounded != null) {
                        const invalidTp = isBuy ? tpRounded <= lastPx + minGap : tpRounded >= lastPx - minGap;
                        if (invalidTp) {
                            safeTp = undefined;
                            tpRounded = undefined;
                            addLog({ action: "SYSTEM", message: `PROTECTION_DROP_TP ${symbol} tp=${tpRounded ?? tp} last=${lastPx}` });
                        }
                    }
                }
                setLifecycle(tradeId, "PROTECTION_PENDING", `attempt ${attempt}`);
                const res = await queuedFetch(`${apiBase}${apiPrefix}/protection?net=${net}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                        symbol,
                        sl: slRounded,
                        tp: tpRounded,
                        trailingStop,
                        positionIdx: 0,
                        slTriggerBy: "LastPrice",
                        tpTriggerBy: "LastPrice",
                    }),
                }, "order");
                if (!res.ok) {
                    const txt = await res.text();
                    addLog({
                        action: "ERROR",
                        message: `Protection set failed (${res.status}): ${txt}`,
                    });
                }
                const expectedSl = slRounded;
                const expectedTp = tpRounded;
                // verify
                try {
                    const posResp = await fetchPositionsOnce(net);
                    const found = posResp.list.find((p) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0);
                    if (found) {
                        const tpOk = expectedTp == null || Math.abs(Number(found.takeProfit ?? 0) - expectedTp) <= tolerance;
                        const slOk = expectedSl == null || Math.abs(Number(found.stopLoss ?? 0) - expectedSl) <= tolerance;
                        const tsOk = trailingStop == null || Math.abs(Number(found.trailingStop ?? 0) - trailingStop) <= tolerance;
                        if (tpOk && slOk && tsOk) {
                            setLifecycle(tradeId, "PROTECTION_SET");
                            return true;
                        }
                    }
                } catch (err) {
                    addLog({ action: "ERROR", message: `Protection verify failed: ${getErrorMessage(err) || "unknown"}` });
                }
                await new Promise((r) => setTimeout(r, 800));
            }
            setLifecycle(tradeId, "PROTECTION_FAILED");
            addLog({
                action: "ERROR",
                message: `Protection not confirmed for ${symbol} after retries.`,
            });
            return false;
        },
        [apiBase, authToken, fetchPositionsOnce, setLifecycle, useTestnet]
    );
    commitProtectionRef.current = commitProtection;

    // Reconcile smyčka: hlídá stárnutí dat a ochranu
    useEffect(() => {
                if (!authToken) return;
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
                    if (!p || !p.symbol) continue;
                    const dir = p.side === "buy" ? 1 : -1;
                    const price = currentPricesRef.current[p.symbol] || p.entryPrice;
                    const oneR = Math.abs((p.entryPrice || 0) - (p.sl || p.entryPrice));
                    if (!Number.isFinite(oneR) || oneR <= 0) continue;
                    const profit = (price - p.entryPrice) * dir;
                    const size = Math.abs(Number(p.size ?? p.qty ?? 0));
                    const feeEstimate = (Math.abs(p.entryPrice || 0) + Math.abs(price || 0)) * size * TAKER_FEE;
                    const netProfitUsd = profit * size - feeEstimate;

                    // SL/TP missing -> heal protection
                    const missingSl = p.sl == null || p.sl === 0;
                    const missingTp = p.tp == null || p.tp === 0;
                    if ((missingSl || missingTp) && p.size > 0) {
                        const candles = priceHistoryRef.current[p.symbol];
                        let atr = 0;
                        if (candles && candles.length > 15) {
                            atr = scalpComputeAtr(candles, 14).slice(-1)[0] ?? 0;
                        }
                        const entry = p.entryPrice;
                        const lastPx = currentPricesRef.current[p.symbol] || entry;
                        const buffer = Math.max(entry * STOP_MIN_PCT, entry * 0.001, 0.1);
                        const baseR = Math.max(
                            entry * STOP_MIN_PCT,
                            atr > 0 ? atr * 0.5 : entry * 0.002
                        );
                        const fallbackSl = missingSl
                            ? dir > 0
                                ? Math.min(entry - baseR, lastPx - buffer)
                                : Math.max(entry + baseR, lastPx + buffer)
                            : p.sl;
                        const fallbackTp = missingTp
                            ? dir > 0
                                ? Math.max(entry + 1.4 * baseR, lastPx + buffer)
                                : Math.min(entry - 1.4 * baseR, lastPx - buffer)
                            : p.tp;
                        const ok = await commitProtection(`recon-${p.id}`, p.symbol, fallbackSl, fallbackTp, undefined);
                        if (ok) {
                            protectionTargetsRef.current[p.symbol] = { sl: fallbackSl, tp: fallbackTp };
                            protectionVerifyRef.current[p.symbol] = now;
                        } else {
                            await forceClosePosition(p);
                        }
                        continue;
                    }

                    const expectedProtection = protectionTargetsRef.current[p.symbol];
                    if (expectedProtection) {
                        const lastVerifyAt = protectionVerifyRef.current[p.symbol] ?? 0;
                        if (now - lastVerifyAt >= PROTECTION_VERIFY_COOLDOWN_MS) {
                            const tol = Math.abs((price || p.entryPrice) * 0.001) || 0.5;
                            const slMismatch = expectedProtection.sl != null &&
                                Math.abs((p.sl ?? 0) - expectedProtection.sl) > tol;
                            const tpMismatch = expectedProtection.tp != null &&
                                Math.abs((p.tp ?? 0) - expectedProtection.tp) > tol;
                            const tsMismatch = expectedProtection.trailingStop != null &&
                                Math.abs((p.trailingStop ?? 0) - expectedProtection.trailingStop) > tol;
                            if (slMismatch || tpMismatch || tsMismatch) {
                                protectionVerifyRef.current[p.symbol] = now;
                                const ok = await commitProtection(
                                    `verify-${p.id}`,
                                    p.symbol,
                                    expectedProtection.sl ?? p.sl,
                                    expectedProtection.tp ?? p.tp,
                                    expectedProtection.trailingStop ?? p.trailingStop
                                );
                                if (ok) {
                                    addLog({ action: "SYSTEM", message: `PROTECTION_SYNC ${p.symbol} verified` });
                                }
                            }
                        }
                    }

                    const candles = priceHistoryRef.current[p.symbol];
                    const lastCandle = candles?.[candles.length - 1];
                    const prevCandle = candles?.[candles.length - 2];
                    const barOpenTime = lastCandle?.openTime;
                    const newClosedBar = barOpenTime != null && manageBarRef.current[p.symbol] !== barOpenTime;
                    if (newClosedBar && barOpenTime != null) {
                        manageBarRef.current[p.symbol] = barOpenTime;
                    }

                    const feeShift = p.entryPrice * TAKER_FEE * 2;
                    const profitR = profit / oneR;
                    const minNetR = Math.max(0.25, (feeShift * 1.5) / oneR);

                    let timeStopTriggered = false;
                    if (newClosedBar && lastCandle && !timeStopRef.current[p.symbol]) {
                        const entryMsRaw = Date.parse(p.openedAt || p.timestamp || "");
                        if (Number.isFinite(entryMsRaw)) {
                            const interval = prevCandle ? Math.max(60_000, lastCandle.openTime - prevCandle.openTime) : 60_000;
                            const barsNeeded = interval >= 170_000 ? TIME_STOP_BARS_3M : TIME_STOP_BARS_1M;
                            const barsElapsed = Math.floor((lastCandle.openTime - entryMsRaw) / interval);
                            if (barsElapsed >= barsNeeded && profitR < TIME_STOP_MIN_R) {
                                const step = qtyStepForSymbol(p.symbol);
                                const closeQty = roundDownToStep(size, step);
                                if (Number.isFinite(closeQty) && closeQty >= step) {
                                    const exitSide = dir > 0 ? "Sell" : "Buy";
                                    const ok = await placeReduceOnlyExit(p.symbol, exitSide, closeQty, "TIME_STOP");
                                    if (ok) {
                                        timeStopRef.current[p.symbol] = now;
                                        addLog({ action: "SYSTEM", message: `TIME_STOP ${p.symbol} bars=${barsElapsed} profitR=${profitR.toFixed(2)}` });
                                        timeStopTriggered = true;
                                    }
                                }
                            }
                        }
                    }
                    if (timeStopTriggered) {
                        continue;
                    }

                    let newSl: number | null = null;
                    if (size > 0 && profitR >= BE_TRIGGER_R) {
                        newSl = p.entryPrice + dir * feeShift;
                    }
                    if (newClosedBar && size > 0 && netProfitUsd >= MIN_NET_PROFIT_USD && profitR >= TP2_R) {
                        if (candles && candles.length >= 20) {
                            const stSeries = computeSuperTrend(candles, 10, 2.0);
                            const stLine = stSeries.line[stSeries.line.length - 1];
                            const atr = scalpComputeAtr(candles, 14).slice(-1)[0] ?? 0;
                            if (Number.isFinite(stLine)) {
                                const buffer = Math.max(p.entryPrice * STOP_MIN_PCT, atr * 0.2);
                                const trailSl = dir > 0 ? stLine - buffer : stLine + buffer;
                                if (Number.isFinite(trailSl)) {
                                    newSl = newSl == null
                                        ? trailSl
                                        : dir > 0
                                            ? Math.max(newSl, trailSl)
                                            : Math.min(newSl, trailSl);
                                }
                            }
                        }
                    }
                    if (newSl != null && Number.isFinite(newSl) && ((dir > 0 && newSl > (p.sl || 0)) || (dir < 0 && newSl < (p.sl || Infinity)))) {
                        const existingTp = normalizeTp(p.tp);
                        const tp2 = p.entryPrice + dir * TP2_R * oneR;
                        const nextTp = existingTp
                            ? (dir > 0 ? Math.max(existingTp, tp2) : Math.min(existingTp, tp2))
                            : tp2;
                        const ok = await commitProtection(`trail-${p.id}`, p.symbol, newSl, nextTp, undefined);
                        if (ok) {
                            const current = protectionTargetsRef.current[p.symbol] ?? {};
                            protectionTargetsRef.current[p.symbol] = { ...current, sl: newSl, tp: nextTp ?? current.tp };
                            protectionVerifyRef.current[p.symbol] = now;
                            addLog({ action: "SYSTEM", message: `MANAGE ${p.symbol} profitR=${profitR.toFixed(2)} newSL=${newSl.toFixed(4)}` });
                        }
                    }

                    const ema21 = candles && candles.length >= 21
                        ? scalpComputeEma(candles.map((c) => c.close), 21).slice(-1)[0]
                        : null;
                    const trendOk = lastCandle && Number.isFinite(ema21)
                        ? (dir > 0 ? lastCandle.close > (ema21 as number) : lastCandle.close < (ema21 as number))
                        : false;

                    const diag = scanDiagnosticsRef.current[p.symbol];
                    const gateTotal = diag?.gates?.length ?? 0;
                    const gateOk = diag?.gates?.filter((g) => g.ok).length ?? 0;
                    const requiredGates = gateTotal > 0
                        ? Math.max(0, gateTotal - SCALE_IN_MAX_MISSING_GATES)
                        : Number.POSITIVE_INFINITY;
                    const gatesSatisfied = gateTotal > 0 && gateOk >= requiredGates;

                    if (trendOk && gatesSatisfied && profitR >= Math.max(SCALE_IN_MIN_R, minNetR) && !scaleInRef.current[p.symbol]) {
                        if (modeRef.current === TradingMode.AUTO_ON) {
                            const maxQty = maxQtyForSymbol(p.symbol);
                            const remaining = Number.isFinite(maxQty) ? Math.max(0, maxQty - size) : Number.POSITIVE_INFINITY;
                            const step = qtyStepForSymbol(p.symbol);
                            const addQtyRaw = size * SCALE_IN_MARGIN_FRACTION;
                            const addQty = roundDownToStep(Math.min(addQtyRaw, remaining), step);
                            if (Number.isFinite(addQty) && addQty >= step) {
                                const side = dir > 0 ? "Buy" : "Sell";
                                const ok = await placeAddMarket(p.symbol, side, addQty, "TREND_OK");
                                if (ok) {
                                    scaleInRef.current[p.symbol] = true;
                                    protectionVerifyRef.current[p.symbol] = 0;
                                    addLog({ action: "SYSTEM", message: `SCALE_IN ${p.symbol} qty=${addQty} gates=${gateOk}/${gateTotal} profile=${settingsRef.current.riskMode}` });
                                }
                            }
                        }
                    }

                    if (trendOk && Number.isFinite(p.tp) && profitR >= TP_EXTEND_MIN_R) {
                        const lastShiftR = tpExtendRef.current[p.symbol] ?? 0;
                        if (profitR >= lastShiftR + TP_EXTEND_STEP_R) {
                            const newTp = (p.tp as number) + dir * TP_EXTEND_STEP_R * oneR;
                            const safeTp = dir > 0 ? newTp > (p.tp as number) && newTp > price + oneR * 0.1 : newTp < (p.tp as number) && newTp < price - oneR * 0.1;
                            if (safeTp) {
                                const ok = await commitProtection(`tp-extend-${p.id}`, p.symbol, p.sl, newTp, undefined);
                                if (ok) {
                                    const current = protectionTargetsRef.current[p.symbol] ?? {};
                                    protectionTargetsRef.current[p.symbol] = { ...current, tp: newTp };
                                    protectionVerifyRef.current[p.symbol] = now;
                                    tpExtendRef.current[p.symbol] = profitR;
                                    addLog({ action: "SYSTEM", message: `TP_EXTEND ${p.symbol} newTP=${newTp.toFixed(4)} profitR=${profitR.toFixed(2)}` });
                                }
                            }
                        }
                    }

                    if (profitR >= Math.max(PARTIAL_EXIT_MIN_R, minNetR) &&
                        netProfitUsd >= MIN_NET_PROFIT_USD) {
                        const lastPartialAt = partialExitRef.current[p.symbol] ?? 0;
                        if (lastPartialAt === 0) {
                            const step = qtyStepForSymbol(p.symbol);
                            const closeQty = roundDownToStep(size * PARTIAL_EXIT_FRACTION, step);
                            if (Number.isFinite(closeQty) && closeQty >= step) {
                                const exitSide = dir > 0 ? "Sell" : "Buy";
                                const ok = await placeReduceOnlyExit(p.symbol, exitSide, closeQty, "TP1");
                                if (ok) {
                                    partialExitRef.current[p.symbol] = now;
                                    addLog({ action: "SYSTEM", message: `TP1 ${p.symbol} qty=${closeQty} profitR=${profitR.toFixed(2)}` });
                                    const entry = Number(p.entryPrice ?? 0);
                                    if (Number.isFinite(entry) && entry > 0) {
                                        const desiredSl = entry + dir * feeShift;
                                        const improves = dir > 0 ? desiredSl > (p.sl ?? -Infinity) : desiredSl < (p.sl ?? Infinity);
                                        if (Number.isFinite(desiredSl) && improves) {
                                            const slOk = await commitProtection(`partial-sl-${p.id}`, p.symbol, desiredSl, p.tp, undefined);
                                            if (slOk) {
                                                const current = protectionTargetsRef.current[p.symbol] ?? {};
                                                protectionTargetsRef.current[p.symbol] = { ...current, sl: desiredSl };
                                                protectionVerifyRef.current[p.symbol] = now;
                                                addLog({ action: "SYSTEM", message: `SL_TO_ENTRY ${p.symbol} sl=${desiredSl.toFixed(4)}` });
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
        };

        const id = setInterval(() => {
            if (!cancel) void reconcile();
        }, 12000);

        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, commitProtection, forceClosePosition, placeReduceOnlyExit, placeAddMarket]);

    const [aiModelState] = useState({
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
    const dynamicSymbolsRef = useRef<string[]>([]);
    type ScalpInstrument = {
        tickSize: number;
        stepSize: number;
        minQty: number;
        minNotional: number;
        maxQty: number;
        contractValue: number;
    };
    type ScalpBbo = { bid: number; ask: number; ts: number };
    type ScalpBias = "LONG" | "SHORT" | "NONE";
    type ScalpRegime = "TREND" | "RANGE";
    type ScalpConfirm = {
        expectedOpenTime: number;
        stage: 0 | 1;
        attempts: number;
        lastClose?: number;
        lastHigh?: number;
        lastLow?: number;
        lastVolume?: number;
    };

    type ScalpHtfState = {
        barOpenTime: number;
        bias: ScalpBias;
        regime: ScalpRegime;
        ema200: number;
        emaSlopeNorm: number;
        atr14: number;
        close: number;
        blockedUntilBarOpenTime: number;
        stDir?: SuperTrendDir;
        prevStDir?: SuperTrendDir;
        stLine?: number;
    };
    type ScalpLtfState = {
        barOpenTime: number;
        candles: Candle[];
        stDir: SuperTrendDir;
        prevStDir: SuperTrendDir;
        stLine: number;
        ema20: number;
        emaSlopeAbs: number;
        atr14: number;
        smaVol20: number;
        rvol: number;
        last: Candle;
    };

    type ScalpPendingStage =
        | "READY_TO_PLACE"
        | "PLACED"
        | "PARTIAL_EXIT"
        | "TRAIL_SL_UPDATE"
        | "SAFE_CLOSE"
        | "CANCEL_SENT"
        | "CANCEL_VERIFY"
        | "FILLED_NEED_SL"
        | "SL_SENT"
        | "SL_VERIFY"
        | "TP_SENT"
        | "TP_VERIFY";

    type ScalpPending = {
        stage: ScalpPendingStage;
        orderLinkId: string;
        orderId?: string | null;
        symbol: string;
        side: "Buy" | "Sell";
        limitPrice: number;
        qty: number;
        closeQty?: number;
        newSl?: number;
        taskReason?: string;
        sl: number;
        tp: number;
        oneR: number;
        reservedRiskUsd: number;
        qualityScore?: number;
        qualityTier?: "LOW" | "MID" | "HIGH";
        extraTimeoutMs?: number;
        entryTimeoutMs?: number;
        htfBarOpenTime: number;
        ltfBarOpenTime: number;
        createdAt: number;
        placedAt?: number;
        repriceCount?: number;
        lastRepriceAt?: number;
        statusCheckAt: number;
        timeoutAt: number;
        cancelVerifyAt?: number;
        fillAt?: number;
        slVerifyAt?: number;
        tpVerifyAt?: number;
        cancelAttempts?: number;
        slSetAttempts?: number;
        slLastError?: string;
    };

    type ScalpManage = {
        symbol: string;
        side: "Buy" | "Sell";
        entry: number;
        qty: number;
        oneR: number;
        partialTaken: boolean;
        beMoved?: boolean;
        timeStopDone?: boolean;
        entryBarOpenTime: number;
        lastBarOpenTime?: number;
        maxPrice: number;
        minPrice: number;
    };

    type ScalpSymbolState = {
        symbol: string;
        instrument?: ScalpInstrument;
        bbo?: ScalpBbo;
        htf?: ScalpHtfState;
        ltf?: ScalpLtfState;
        ltfConfirm?: ScalpConfirm;
        htfConfirm?: ScalpConfirm;
        ltfLastScanBarOpenTime?: number;
        microBreakBarOpenTime?: number;
        pending?: ScalpPending;
        manage?: ScalpManage;
        bboNextFetchAt?: number;
        bboFailCount?: number;
        bboLastOkAt?: number;
        nextAllowedAt: number;
        pausedUntil: number;
        pausedReason?: string;
        cooldownUntil: number;
        safeUntil?: number;
        safeReason?: string;
    };

    const scalpStateRef = useRef<Record<string, ScalpSymbolState>>({});
    const scalpReservedRiskUsdRef = useRef(0);
    const scalpRecentIdsRef = useRef<Map<string, number>>(new Map());
    const scalpBusyRef = useRef(false);
    const scalpRotationIdxRef = useRef(0);
    const scalpActiveSymbolRef = useRef<string | null>(null);
    const scalpSymbolLockUntilRef = useRef(0);
    const staleBboLogRef = useRef<Record<string, number>>({});
    const scalpRejectLogRef = useRef<Record<string, number>>({});
    const scalpForceSafeUntilRef = useRef(0);
    const scalpSafeRef = useRef(false);
    const scalpGlobalCooldownUntilRef = useRef(0);

    const modeRef = useRef(mode);
    modeRef.current = mode;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const portfolioStateRef = useRef(portfolioState);
    portfolioStateRef.current = portfolioState;
    const walletEquityRef = useRef(walletEquity);
    walletEquityRef.current = walletEquity;
    const realizedPnlRef = useRef(0);
    const initialResetDay = (() => {
        try {
            return typeof localStorage === "undefined" ? null : localStorage.getItem("ai-matic:last-reset-day");
        } catch {
            return null;
        }
    })();
    const lastResetDayRef = useRef<string | null>(initialResetDay);

    const lifecycleRef = useRef<Map<string, string>>(new Map());
    const dataUnavailableRef = useRef<boolean>(false);
    const winStreakRef = useRef(0);
    const lossStreakRef = useRef(0);
    const symbolLossStreakRef = useRef<Record<string, number>>({});
    const riskCutActiveRef = useRef(false);
    const rollingOutcomesRef = useRef<boolean[]>([]);
    const lastPositionsSyncAtRef = useRef<number>(0);
    const executionCursorRef = useRef<string | null>(null);
    const processedExecIdsRef = useRef<Set<string>>(new Set());
    const executionEventsRef = useRef<
        { id: string; symbol: string; orderId?: string; orderLinkId?: string; price?: number; qty?: number; time?: string }[]
    >([]);

    function addLog(entry: Omit<LogEntry, "id" | "timestamp">) {
        const log: LogEntry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date().toISOString(),
            ...entry,
        };
        setLogEntries((prev) => [log, ...prev].slice(0, 50));
    }
    const logScalpReject = (
        symbol: string,
        reason: string,
        metrics?: {
            reasonCode?: string;
            spreadBps?: number;
            atrPct?: number;
            emaSlopeNorm?: number;
            distToEmaAtr?: number;
            mae?: number;
            mfe?: number;
            timeToFillMs?: number;
            timeToSlConfirmMs?: number;
        }
    ) => {
        const nowTs = Date.now();
        const last = scalpRejectLogRef.current[symbol] ?? 0;
        if (nowTs - last < 2000) return;
        scalpRejectLogRef.current[symbol] = nowTs;
        const code = metrics?.reasonCode ?? reason;
        const detail = metrics?.reasonCode && metrics.reasonCode !== reason ? ` detail=${reason}` : "";
        const spread = Number.isFinite(metrics?.spreadBps) ? metrics?.spreadBps?.toFixed(1) : "-";
        const atrPct = Number.isFinite(metrics?.atrPct) ? `${((metrics?.atrPct ?? 0) * 100).toFixed(3)}%` : "-";
        const slopeNorm = Number.isFinite(metrics?.emaSlopeNorm) ? metrics?.emaSlopeNorm?.toFixed(4) : "-";
        const distEma = Number.isFinite(metrics?.distToEmaAtr) ? metrics?.distToEmaAtr?.toFixed(2) : "-";
        const mae = Number.isFinite(metrics?.mae) ? metrics?.mae?.toFixed(4) : "-";
        const mfe = Number.isFinite(metrics?.mfe) ? metrics?.mfe?.toFixed(4) : "-";
        const tFill = Number.isFinite(metrics?.timeToFillMs) ? `${Math.round(metrics?.timeToFillMs ?? 0)}ms` : "-";
        const tSl = Number.isFinite(metrics?.timeToSlConfirmMs) ? `${Math.round(metrics?.timeToSlConfirmMs ?? 0)}ms` : "-";
        addLog({
            action: "REJECT",
            message: `SCALP ${symbol} ${code}${detail} | spreadBps=${spread} atrPct=${atrPct} emaSlopeNorm=${slopeNorm} distEmaATR=${distEma} | mae=${mae} mfe=${mfe} tFill=${tFill} tSL=${tSl}`,
        });
    };

    const recordTrade = (symbol: string, id?: string) => {
        if (!symbol) return;
        const now = Date.now();
        const key = id ? `${symbol}:${id}` : `${symbol}:${now}`;
        const seen = tradeCountSeenRef.current;
        if (seen.has(key)) return;
        seen.add(key);
        const list = tradeCountsRef.current[symbol] ?? [];
        const next = [...list, now].filter((ts) => now - ts <= 24 * 60 * 60_000);
        tradeCountsRef.current[symbol] = next;
        if (seen.size > 2000) {
            tradeCountSeenRef.current = new Set(Array.from(seen).slice(-1500));
        }
    };

    const countTrades = (symbol: string, windowMs: number, now: number) => {
        const list = tradeCountsRef.current[symbol] ?? [];
        return list.filter((ts) => now - ts <= windowMs).length;
    };

    const getQuotaState = (symbol: string, now: number) => {
        const target = TARGET_TRADES_PER_DAY[symbol] ?? 0;
        const expected = target * (QUOTA_LOOKBACK_MS / (24 * 60 * 60_000));
        const actual = countTrades(symbol, QUOTA_LOOKBACK_MS, now);
        const behind = expected > 0 && actual < expected * (1 - QUOTA_BEHIND_PCT);
        let boostUntil = tradeQuotaBoostRef.current[symbol] ?? 0;
        if (behind && now >= boostUntil) {
            boostUntil = now + QUOTA_BOOST_MS;
            tradeQuotaBoostRef.current[symbol] = boostUntil;
            addLog({
                action: "SYSTEM",
                message: `QUOTA_BOOST ${symbol} actual=${actual} expected=${expected.toFixed(1)} window=3h`,
            });
        }
        const boosted = now < boostUntil;
        return {
            boosted,
            qualityLowThreshold: boosted ? QUALITY_SCORE_SOFT_BOOST : QUALITY_SCORE_LOW,
            entryTfMs: boosted ? ENTRY_TF_BOOST_MS : ENTRY_TF_BASE_MS,
            actual3h: actual,
            expected3h: expected,
        };
    };

    type AuditDecision = "TRADE" | "DENY" | "STOP" | "RETRY";
    function logAuditEntry(
        action: "SYSTEM" | "ERROR" | "SIGNAL" | "REJECT",
        symbol: string,
        state: string,
        gates: { name: string; result: "PASS" | "FAIL" }[],
        decision: AuditDecision,
        reason: string,
        prices: { entry?: number; sl?: number; tp?: number },
        sizing?: { notional?: number; leverage?: number },
        netRrr?: number
    ) {
        const gateMsg = gates.map((g) => `${g.name}:${g.result}`).join("|");
        addLog({
            action,
            message: `[${state}] ${decision} ${symbol} ${reason} | gates ${gateMsg} | prices e:${prices.entry?.toFixed?.(4) ?? "-"} sl:${prices.sl?.toFixed?.(4) ?? "-"} tp:${prices.tp?.toFixed?.(4) ?? "-"} | size ${sizing?.notional?.toFixed?.(2) ?? "-"} lev ${sizing?.leverage?.toFixed?.(2) ?? "-"} | netRRR ${netRrr != null ? netRrr.toFixed(2) : "-"}`,
        });
    }

    const registerOutcome = (symbol: string, pnl: number) => {
        const win = pnl > 0;
        if (win) {
            winStreakRef.current += 1;
            lossStreakRef.current = 0;
        } else {
            lossStreakRef.current += 1;
            winStreakRef.current = 0;
        }
        rollingOutcomesRef.current = [...rollingOutcomesRef.current.slice(-9), win];
        if (symbol) {
            const map = symbolLossStreakRef.current;
            const nextStreak = win ? 0 : (map[symbol] ?? 0) + 1;
            map[symbol] = nextStreak;
            if (!win) {
                const stateMap = scalpStateRef.current;
                const st = stateMap[symbol] || {
                    symbol,
                    nextAllowedAt: 0,
                    pausedUntil: 0,
                    cooldownUntil: 0,
                    safeUntil: 0,
                };
                stateMap[symbol] = st;
                const isMaticX = settingsRef.current.riskMode === "ai-matic-x";
                if (isMaticX) {
                    const until = Date.now() + AI_MATIC_X_LOSS_COOLDOWN_MS;
                    st.cooldownUntil = Math.max(st.cooldownUntil, until);
                }
                if (nextStreak === 2) {
                    const cooldownMs = isMaticX ? AI_MATIC_X_LOSS_STREAK_COOLDOWN_MS : LOSS_STREAK_SYMBOL_COOLDOWN_MS;
                    const until = Date.now() + cooldownMs;
                    st.cooldownUntil = Math.max(st.cooldownUntil, until);
                    addLog({ action: "SYSTEM", message: `COOLDOWN ${symbol} loss-streak=2 hold=${Math.round(cooldownMs / 60000)}m` });
                }
            }
        }
        if (lossStreakRef.current >= 3 && !riskCutActiveRef.current) {
            riskCutActiveRef.current = true;
            addLog({ action: "SYSTEM", message: `RISK_CUT active risk=${LOSS_STREAK_RISK_USD}USD after 3 losses (session)` });
        }
    };

    // ========== DETERMINISTIC SCALP (Profile 1) ==========
    useEffect(() => {
        if (mode === TradingMode.OFF) {
            setSystemState((p) => ({ ...p, bybitStatus: "Disconnected" }));
            return;
        }
        const isMaticX = settings.riskMode === "ai-matic-x";
        const isSmcMode = settings.riskMode === "ai-matic-scalp";
        const activeSymbols = isSmcMode ? [...SMC_SYMBOLS] : [...SYMBOLS];
        if (!isMaticX) {
            dynamicSymbolsRef.current = [];
            setDynamicSymbols([]);
        }
        let cancel = false;
        let symbolRefreshId: ReturnType<typeof setInterval> | undefined;

        const BASE_CFG = {
            tickMs: 250,
            symbolFetchGapMs: 350,
            ltfCloseDelayMs: 1200,
            htfCloseDelayMs: 2500,
            orderStatusDelayMs: 400,
            postCancelVerifyDelayMs: 1000,
            postFillDelayMs: 200,
            postSlVerifyDelayMs: 300,
            postTpVerifyDelayMs: 300,
            spreadMaxPct: 0.0008, // 0.08%
            lowAtrMinPct: 0, // disabled: allow entries even in low ATR
            rvolMin: 1.2,
            stLtf: { atr: 10, mult: 2.0 },
            stHtf: { atr: 10, mult: 2.0 },
            emaPeriod: 20,
            htfEmaPeriod: 200,
            htfSlopeMinNorm: 0.03,
            atrPeriod: 14,
            touchBandAtrFrac: 0.1,
            offsetAtrFrac: 0.05,
            slBufferAtrFrac: 0.02,
            antiBreakoutRangeAtr: 1.5,
            antiBreakoutBodyFrac: 0.8,
            antiBreakoutCloseFrac: 0.85,
            momentumLookback: 10,
            momentumVolMult: 1.4,
            momentumPricePct: 0.008,
            dataAgeMaxMs: 2000,
            entryTimeoutMs: 0,
            tpR: 1.6,
            partialAtR: 0.8,
            partialFrac: 0.5,
            trailActivateR: 1.6,
            trailRetraceR: 0.4,
            maxRecentIdWindowMs: 5 * 60 * 1000,
        } as const;
        const MATIC_X_CFG = {
            ...BASE_CFG,
            spreadMaxPct: 0.0008,
            lowAtrMinPct: 0.0006,
            rvolMin: 1.15,
            stLtf: { atr: 10, mult: 2.0 },
            stHtf: { atr: 10, mult: 2.0 },
            emaPeriod: 21,
            tpR: 1.4,
            partialAtR: 1.0,
            trailActivateR: 0.8,
            momentumVolMult: 1.4,
            momentumPricePct: 0.008,
            dataAgeMaxMs: 2000,
            entryTimeoutMs: 60_000,
        } as const;
        const CFG = isMaticX ? MATIC_X_CFG : BASE_CFG;

        const net = useTestnet ? "testnet" : "mainnet";
        const canPlaceOrders = mode === TradingMode.AUTO_ON && Boolean(authToken);

        const expectedOpenTime = (nowMs: number, tfMs: number, delayMs: number) =>
            Math.floor((nowMs - delayMs) / tfMs) * tfMs;

        const spreadPct = (bid: number, ask: number) => {
            const mid = (bid + ask) / 2;
            if (!Number.isFinite(mid) || mid <= 0) return Infinity;
            return (ask - bid) / mid;
        };
        const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
        const hardSpreadBpsFor = (symbol: string) => HARD_SPREAD_BPS[symbol] ?? 12;
        const softSpreadBpsFor = (symbol: string) => SOFT_SPREAD_BPS[symbol] ?? Math.max(1, Math.round(hardSpreadBpsFor(symbol) * 0.7));
        const breakBufferBpsFor = (symbol: string) => BREAK_BUFFER_BPS[symbol] ?? 3;
        const atrSweetSpotFor = (symbol: string) => ATR_SWEET_SPOT[symbol] ?? { low: 0.001, high: 0.004 };
        const spreadBps = (bid: number, ask: number) => spreadPct(bid, ask) * 10000;
        type QualityCtx = {
            bboAgeMs: number;
            spreadBps: number;
            atrPct: number;
            emaSlopeAbs: number;
            range: number;
            atr: number;
            htfBias: ScalpBias;
            htfClose: number;
            htfEma200: number;
            htfSlopeNorm: number;
            htfAtr: number;
            ema20DistAtr?: number;
            microBreakAtr?: number;
            microBreakOk?: boolean;
            microBreakBars?: number;
            signalAgeMs?: number;
            entryTfMs?: number;
            betaSameSide?: boolean;
        };
        const shouldBlockEntry = (symbol: string, ctx: QualityCtx) => {
            const hardSpread = hardSpreadBpsFor(symbol);
            if (ctx.bboAgeMs > BBO_HARD_MS) return { blocked: true, reason: `BBO_AGE ${Math.round(ctx.bboAgeMs)}ms`, code: "BBO_STALE" };
            if (ctx.spreadBps > hardSpread) return { blocked: true, reason: `SPREAD ${ctx.spreadBps.toFixed(1)}bps>${hardSpread}`, code: "SPREAD_HARD" };
            if (ctx.atr > 0 && ctx.range > 3 * ctx.atr) return { blocked: true, reason: "IMPULSE_CANDLE", code: "IMPULSE" };
            return { blocked: false, reason: "", code: "" };
        };
        const qualityScoreFor = (symbol: string, ctx: QualityCtx) => {
            const hardSpread = hardSpreadBpsFor(symbol);
            const softSpread = softSpreadBpsFor(symbol);
            const sweetSpot = atrSweetSpotFor(symbol);
            const slopeMin = CFG.htfSlopeMinNorm;

            let htfScore = 0;
            if (ctx.htfBias === "LONG") {
                if (ctx.htfClose >= ctx.htfEma200) {
                    htfScore = ctx.htfSlopeNorm > slopeMin ? 25 : 10;
                }
            } else if (ctx.htfBias === "SHORT") {
                if (ctx.htfClose <= ctx.htfEma200) {
                    htfScore = ctx.htfSlopeNorm < -slopeMin ? 25 : 10;
                }
            }

            const distToEma = ctx.ema20DistAtr;
            let pullbackScore = 0;
            if (Number.isFinite(distToEma)) {
                if ((distToEma as number) <= 0.35) {
                    pullbackScore = 20;
                } else if ((distToEma as number) <= LATE_ENTRY_ATR) {
                    pullbackScore = 10;
                }
            }

            const microScore = ctx.microBreakOk ? 20 : 0;

            let atrScore = 0;
            if (ctx.atrPct > 0) {
                if (ctx.atrPct >= sweetSpot.low && ctx.atrPct <= sweetSpot.high) {
                    atrScore = 15;
                } else {
                    atrScore = 5;
                }
            }

            let spreadScore = 0;
            if (Number.isFinite(ctx.spreadBps)) {
                if (ctx.spreadBps <= softSpread) {
                    spreadScore = 10;
                } else if (ctx.spreadBps < hardSpread) {
                    spreadScore = 5;
                }
            }

            let freshnessScore = 0;
            const breakBars = ctx.microBreakBars;
            if (typeof breakBars === "number") {
                if (breakBars <= 1) freshnessScore = 10;
                else if (breakBars <= 2) freshnessScore = 5;
            }

            const score = clamp(
                Math.round(
                    htfScore +
                    pullbackScore +
                    microScore +
                    atrScore +
                    spreadScore +
                    freshnessScore
                ),
                0,
                100
            );

            const breakdown = {
                HTF: htfScore,
                Pullback: pullbackScore,
                Break: microScore,
                ATR: atrScore,
                Spread: spreadScore,
                Freshness: freshnessScore,
            };

            const missing = [
                { name: "HTF", missing: 25 - htfScore },
                { name: "Pullback", missing: 20 - pullbackScore },
                { name: "Break", missing: 20 - microScore },
                { name: "ATR", missing: 15 - atrScore },
                { name: "Spread", missing: 10 - spreadScore },
                { name: "Freshness", missing: 10 - freshnessScore },
            ];
            missing.sort((a, b) => b.missing - a.missing);
            const top = missing[0];
            let topReason = "";
            if (top.missing > 0) {
                switch (top.name) {
                    case "Pullback":
                        topReason = Number.isFinite(distToEma) && (distToEma as number) > LATE_ENTRY_ATR
                            ? "Late entry"
                            : "Pullback weak";
                        break;
                    case "Break":
                        topReason = "Break weak";
                        break;
                    case "ATR":
                        topReason = ctx.atrPct < sweetSpot.low ? "ATR low" : "ATR high";
                        break;
                    case "Spread":
                        topReason = "Spread wide";
                        break;
                    case "Freshness":
                        topReason = "Stale break";
                        break;
                    case "HTF":
                    default:
                        topReason = "HTF weak";
                        break;
                }
            }

            return { score, breakdown, topReason };
        };

        const isGateEnabled = (name: string) => {
            try {
                if (typeof localStorage === "undefined") return true;
                const raw = localStorage.getItem("ai-matic-checklist-enabled");
                if (!raw) return true;
                const parsed = JSON.parse(raw) as Record<string, boolean>;
                if (typeof parsed[name] === "boolean") return parsed[name];
            } catch {
                // ignore errors and treat as enabled
            }
            return true;
        };

        const isBboStale = (bbo: { ts: number } | undefined, nowMs: number, staleMs = 1500) => {
            if (!bbo) return true;
            return nowMs - bbo.ts > staleMs;
        };

        const isCancelSafeError = (err: unknown) => {
            const msg = getErrorMessage(err).toLowerCase();
            return msg.includes("order not exists") || msg.includes("too late");
        };

        const classifySafeDiag = (msg?: string) => {
            if (!msg) return "UNKNOWN";
            const lower = msg.toLowerCase();
            if (lower.includes("auth") || lower.includes("token") || lower.includes("permission")) return "AUTH";
            if (lower.includes("rate") || lower.includes("limit")) return "RATE_LIMIT";
            if (lower.includes("position") || lower.includes("not found") || lower.includes("no position")) return "POSITION_MISMATCH";
            if (lower.includes("fetch") || lower.includes("timeout") || lower.includes("endpoint") || lower.includes("network") || lower.includes("503")) return "ENDPOINT";
            return "UNKNOWN";
        };

        const setSymbolSafe = (symbol: string, reason: string, diag?: string) => {
            const st = ensureSymbolState(symbol);
            const until = Date.now() + SAFE_SYMBOL_HOLD_MS;
            st.safeUntil = until;
            st.safeReason = reason;
            st.pausedUntil = Math.max(st.pausedUntil, until);
            st.pausedReason = `SAFE_${reason}`;
            addLog({
                action: "ERROR",
                message: `SAFE_MODE ${symbol} reason=${reason}${diag ? ` diag=${diag}` : ""}`,
            });
        };

        const ensureSymbolState = (symbol: string) => {
            const map = scalpStateRef.current;
            if (!map[symbol]) {
                map[symbol] = {
                    symbol,
                    nextAllowedAt: 0,
                    pausedUntil: 0,
                    cooldownUntil: 0,
                    bboNextFetchAt: 0,
                    bboFailCount: 0,
                    bboLastOkAt: 0,
                    safeUntil: 0,
                };
            }
            return map[symbol];
        };

        const setActiveSymbols = (next: string[], reason?: string) => {
            const openSymbols = activePositionsRef.current
                .filter((p) => Math.abs(Number(p.size ?? p.qty ?? 0)) > 0)
                .map((p) => p.symbol)
                .filter(Boolean);
            const combined = [...next, ...openSymbols];
            const unique = Array.from(new Set(combined.filter(Boolean)));
            if (!unique.length) return;
            const prev = activeSymbols.join(",");
            activeSymbols.splice(0, activeSymbols.length, ...unique);
            if (isMaticX) {
                dynamicSymbolsRef.current = unique;
                setDynamicSymbols(unique);
            }
            scalpRotationIdxRef.current = 0;
            activeSymbols.forEach(ensureSymbolState);
            if (prev !== unique.join(",")) {
                addLog({
                    action: "SYSTEM",
                    message: `SYMBOLS ${unique.join(",")} ${reason ? `(${reason})` : ""}`.trim(),
                });
            }
        };
        activeSymbols.forEach(ensureSymbolState);

        const refreshMaticXSymbols = async () => {
            if (!isMaticX) return;
            try {
                const url = `${httpBase}/v5/market/tickers?category=linear`;
                const res = await queuedFetch(url, undefined, "data");
                const json = await res.json().catch(() => ({}));
                const list = json?.result?.list ?? json?.data?.result?.list ?? [];
                if (!Array.isArray(list)) return;
                const ranked = list
                    .map((item: { symbol?: string; turnover24h?: number | string; volume24h?: number | string }) => {
                        const symbol = String(item.symbol ?? "");
                        const volRaw = item.turnover24h ?? item.volume24h ?? 0;
                        const volume = Number(volRaw);
                        return { symbol, volume: Number.isFinite(volume) ? volume : 0 };
                    })
                    .filter((item) => /USDT$/.test(item.symbol) && item.volume > 0)
                    .sort((a, b) => b.volume - a.volume)
                    .slice(0, 5)
                    .map((item) => item.symbol);
                if (ranked.length) {
                    setActiveSymbols(ranked, "24h-top");
                }
            } catch (err) {
                addLog({ action: "ERROR", message: `SYMBOLS_UPDATE_FAIL ${getErrorMessage(err) || "unknown"}` });
            }
        };

        if (isMaticX) {
            void refreshMaticXSymbols();
            symbolRefreshId = setInterval(() => {
                if (!cancel) void refreshMaticXSymbols();
            }, 10 * 60_000);
        }

        const cleanupRecentIds = () => {
            const now = Date.now();
            const m = scalpRecentIdsRef.current;
            for (const [k, ts] of m.entries()) {
                if (now - ts > CFG.maxRecentIdWindowMs) m.delete(k);
            }
        };

        const fetchInstrument = async (symbol: string): Promise<ScalpInstrument> => {
            const url = `${httpBase}/v5/market/instruments-info?category=linear&symbol=${symbol}`;
            const res = await queuedFetch(url, undefined, "data");
            const json = await res.json();
            if (json.retCode !== 0) throw new Error(json.retMsg);
            const item = json?.result?.list?.[0];
            if (!item) throw new Error(`Instrument not found for ${symbol}`);
            return {
                tickSize: Number(item.priceFilter?.tickSize ?? 0),
                stepSize: Number(item.lotSizeFilter?.qtyStep ?? 0),
                minQty: Number(item.lotSizeFilter?.minOrderQty ?? 0),
                minNotional: Number(item.lotSizeFilter?.minNotionalValue ?? 0),
                maxQty: Number(item.lotSizeFilter?.maxOrderQty ?? Number.POSITIVE_INFINITY),
                contractValue: Number(item.contractSize ?? 1),
            };
        };

        const fetchBbo = async (symbol: string): Promise<ScalpBbo> => {
            const url = `${httpBase}/v5/market/tickers?category=linear&symbol=${symbol}`;
            const res = await queuedFetch(url, undefined, "data");
            const json = await res.json();
            if (json.retCode !== 0) throw new Error(json.retMsg);
            const item = json?.result?.list?.[0];
            const bid = Number(item?.bid1Price ?? 0);
            const ask = Number(item?.ask1Price ?? 0);
            if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) {
                throw new Error(`Invalid BBO for ${symbol}`);
            }
            return { bid, ask, ts: Date.now() };
        };

        const fetchKlines = async (symbol: string, interval: string, limit: number) => {
            const url = `${httpBase}/v5/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=${limit}`;
            const res = await queuedFetch(url, undefined, "data");
            const json = await res.json();
            if (json.retCode !== 0) throw new Error(json.retMsg);
            return parseKlines(json.result?.list ?? []);
        };

        const cancelOrderByLinkId = async (symbol: string, orderLinkId: string) => {
            if (!authToken) return;
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
            if (rc && rc !== 0) throw new Error(body?.data?.retMsg || body?.retMsg || "Cancel rejected");
            return body;
        };

        const placeLimit = async (p: ScalpPending) => {
            if (!authToken) throw new Error("Missing auth token for live trading");
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
                    leverage: leverageFor(p.symbol),
                }),
            }, "order");
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.ok === false) {
                throw new Error(body?.error || `Order failed (${res.status})`);
            }
            const rc = body?.data?.retCode ?? body?.retCode;
            if (rc && rc !== 0) throw new Error(body?.data?.retMsg || body?.retMsg || "Order rejected");
            return body;
        };

        const setProtection = async (symbol: string, sl?: number, tp?: number) => {
            if (!authToken) return null;
            const lastPx = currentPricesRef.current[symbol];
            const safeSl = roundPriceToTick(symbol, sl, lastPx);
            const safeTp = roundPriceToTick(symbol, tp, lastPx);
            const res = await queuedFetch(`${apiBase}${apiPrefix}/protection?net=${net}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ symbol, sl: safeSl, tp: safeTp, positionIdx: 0, slTriggerBy: "LastPrice", tpTriggerBy: "LastPrice" }),
            }, "order");
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.ok === false) {
                throw new Error(body?.error || `Protection failed (${res.status})`);
            }
            const rc = body?.data?.retCode ?? body?.retCode;
            if (rc && rc !== 0) throw new Error(body?.data?.retMsg || body?.retMsg || "Protection rejected");
            return body;
        };

        const getOpenPos = (symbol: string): ActivePosition | undefined =>
            activePositionsRef.current.find((p) => p.symbol === symbol && Math.abs(Number(p.size ?? p.qty ?? 0)) > 0);

        const getActiveSymbolStats = () => {
            const sizes: Record<string, number> = {};
            const symbols = new Set<string>();
            const allowedSymbols = new Set([...ALL_SYMBOLS, ...dynamicSymbolsRef.current]);
            for (const p of activePositionsRef.current) {
                const sym = p.symbol;
                if (!allowedSymbols.has(sym)) continue;
                const size = Math.abs(Number(p.size ?? p.qty ?? 0));
                if (!Number.isFinite(size) || size <= 0) continue;
                symbols.add(sym);
                sizes[sym] = (sizes[sym] || 0) + size;
            }
            return { symbols, sizes, count: symbols.size };
        };
        const isSymbolAtMaxQty = (symbol: string, sizes: Record<string, number>) => {
            const maxQty = maxQtyForSymbol(symbol);
            if (!Number.isFinite(maxQty)) return false;
            return (sizes[symbol] || 0) >= maxQty - 1e-8;
        };
        const hasMaxedPositions = (stats: { symbols: Set<string>; sizes: Record<string, number>; count: number }) =>
            stats.count >= 2 && Array.from(stats.symbols).every((sym) => isSymbolAtMaxQty(sym, stats.sizes));

        const computeOpenRiskUsd = () => openRiskUsd(activePositionsRef.current) + scalpReservedRiskUsdRef.current;

    const hashScalpId = (input: string) => {
        let hash = 0;
        for (let i = 0; i < input.length; i += 1) {
            hash = (hash * 31 + input.charCodeAt(i)) | 0;
        }
        return Math.abs(hash).toString(36);
    };
    const buildId = (symbol: string, side: "Buy" | "Sell", htfBar: number, ltfBar: number) => {
        const raw = `${symbol}:${side}:${htfBar}:${ltfBar}`;
        if (raw.length <= 36) return raw;
        const short = `${symbol}:${side}:${hashScalpId(raw)}`;
        return short.slice(0, 36);
    };
    const buildRepriceId = (base: string, attempt: number) => {
        const suffix = `-R${attempt}`;
        const next = `${base}${suffix}`;
        return next.length <= 36 ? next : next.slice(0, 36);
    };
    const computeEntryLimit = (st: ScalpSymbolState, side: "Buy" | "Sell") => {
        if (!st.instrument || !st.bbo) return null;
        const tick = st.instrument.tickSize;
        const atr = st.ltf?.atr14 ?? 0;
        const offset = Math.max(2 * tick, CFG.offsetAtrFrac * atr);
        const raw = side === "Buy"
            ? Math.min(st.bbo.ask - tick, st.bbo.bid + offset)
            : Math.max(st.bbo.bid + tick, st.bbo.ask - offset);
        const limit = roundToTick(raw, tick);
        if (side === "Buy" && limit >= st.bbo.ask) return null;
        if (side === "Sell" && limit <= st.bbo.bid) return null;
        return limit;
    };

        const handlePending = async (st: ScalpSymbolState, plannedAt: number, logTiming: (kind: string, reason?: string) => void): Promise<boolean> => {
            const p = st.pending;
            if (!p) return false;
            const now = Date.now();

            // Global "no burst": per-symbol throttle
            if (now < st.nextAllowedAt) return false;

            const posForPending = getOpenPos(p.symbol);
            const needsOpenPos = p.stage === "SL_SENT"
                || p.stage === "SL_VERIFY"
                || p.stage === "TP_SENT"
                || p.stage === "TP_VERIFY"
                || p.stage === "PARTIAL_EXIT"
                || p.stage === "TRAIL_SL_UPDATE";
            if (needsOpenPos && !posForPending) {
                st.pending = undefined;
                st.manage = undefined;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                addLog({ action: "SYSTEM", message: `PENDING_SKIP ${p.symbol} no open position for ${p.stage}` });
                return true;
            }
            const slSlaBreached = p.fillAt != null &&
                now - p.fillAt > SL_SLA_MS &&
                (p.stage === "FILLED_NEED_SL" || p.stage === "SL_SENT" || p.stage === "SL_VERIFY");
            if (slSlaBreached) {
                p.stage = "SAFE_CLOSE";
                p.taskReason = "SL_SLA_EXPIRED";
                setSymbolSafe(p.symbol, "SL_SLA_EXPIRED", classifySafeDiag(p.slLastError));
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            if (p.stage === "READY_TO_PLACE") {
                if (!canPlaceOrders) {
                    logScalpReject(p.symbol, "BLOCKED auto mode off or missing auth token");
                    return false;
                }
                if (scalpSafeRef.current) {
                    logScalpReject(p.symbol, "SAFE_MODE");
                    return false;
                }
                if (now < scalpGlobalCooldownUntilRef.current) {
                    logScalpReject(p.symbol, "GLOBAL_COOLDOWN");
                    return false;
                }
                if (st.htf && now < st.htf.blockedUntilBarOpenTime + CFG.htfCloseDelayMs) {
                    logScalpReject(p.symbol, "HTF_BLOCK");
                    return false;
                }

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
                } catch (err) {
                    scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                    st.pending = undefined;
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    addLog({ action: "ERROR", message: `PLACE_FAILED ${p.symbol} ${getErrorMessage(err) || "unknown"}` });
                    return true; // no retry
                }
                p.stage = "PLACED";
                p.placedAt = now;
                p.repriceCount = p.repriceCount ?? 0;
                p.statusCheckAt = now + CFG.orderStatusDelayMs;
                const entryTimeoutMs = p.entryTimeoutMs ?? entryTimeoutMsFor(p.symbol, st.htf?.regime === "RANGE");
                p.timeoutAt = now + entryTimeoutMs;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                addLog({ action: "SYSTEM", message: `PLACE ${p.symbol} ${p.side} limit=${p.limitPrice} qty=${p.qty} id=${p.orderLinkId}` });
                return true;
            }

            if (p.stage === "PLACED") {
                if (now < p.statusCheckAt) return false;

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
                        recordTrade(p.symbol, p.orderLinkId);
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
                            beMoved: false,
                            timeStopDone: false,
                            entryBarOpenTime: p.ltfBarOpenTime,
                            lastBarOpenTime: p.ltfBarOpenTime,
                            maxPrice: entry,
                            minPrice: entry,
                        };
                        addLog({ action: "SYSTEM", message: `FILL ${p.symbol} ${p.side} avg=${avg}` });
                    } else if (status === "Cancelled" || status === "Rejected") {
                        scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                        st.pending = undefined;
                        addLog({ action: "SYSTEM", message: `ENTRY_ABORT ${p.symbol} status=${status}` });
                    }
                }

                const canReprice = p.stage === "PLACED" &&
                    (p.repriceCount ?? 0) < 1 &&
                    p.placedAt != null &&
                    now >= p.placedAt + ENTRY_REPRICE_AFTER_MS &&
                    now < p.timeoutAt;
                if (canReprice && found) {
                    const status = found.orderStatus || found.order_status || found.status;
                    const isFilled = status === "Filled" || status === "PartiallyFilled";
                    const isFinal = status === "Cancelled" || status === "Rejected";
                    if (!isFilled && !isFinal) {
                        if (isBboStale(st.bbo, now, 1500)) {
                            logTiming("FETCH_BBO", "reprice");
                            const bbo = await fetchBbo(p.symbol);
                            st.bbo = bbo;
                        }
                        const nextLimit = computeEntryLimit(st, p.side);
                        if (nextLimit != null && Number.isFinite(nextLimit) && st.instrument) {
                            const worse = p.side === "Buy" ? nextLimit > p.limitPrice : nextLimit < p.limitPrice;
                            const driftBps = worse
                                ? Math.abs(nextLimit - p.limitPrice) / Math.max(1e-8, p.limitPrice) * 10_000
                                : 0;
                            const maxDrift = entryMaxDriftBpsFor(p.symbol);
                            if (worse && driftBps > maxDrift) {
                                logTiming("CANCEL_SEND", "drift");
                                try {
                                    await cancelOrderByLinkId(p.symbol, p.orderLinkId);
                                } catch (err) {
                                    if (!isCancelSafeError(err)) {
                                        throw err;
                                    }
                                }
                                p.stage = "CANCEL_SENT";
                                p.cancelVerifyAt = now + CFG.postCancelVerifyDelayMs;
                                p.cancelAttempts = 0;
                                st.cooldownUntil = Math.max(st.cooldownUntil, now + SYMBOL_COOLDOWN_MS);
                                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                                addLog({ action: "SYSTEM", message: `CANCEL ${p.symbol} id=${p.orderLinkId} reason=DRIFT_${driftBps.toFixed(1)}bps` });
                                return true;
                            }
                            if (Math.abs(nextLimit - p.limitPrice) >= st.instrument.tickSize) {
                                logTiming("CANCEL_SEND", "reprice");
                                try {
                                    await cancelOrderByLinkId(p.symbol, p.orderLinkId);
                                } catch (err) {
                                    if (isCancelSafeError(err)) {
                                        st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                                        return true;
                                    }
                                    throw err;
                                }
                                const attempt = (p.repriceCount ?? 0) + 1;
                                const nextId = buildRepriceId(p.orderLinkId, attempt);
                                p.orderLinkId = nextId;
                                p.limitPrice = nextLimit;
                                p.repriceCount = attempt;
                                p.lastRepriceAt = now;
                                logTiming("PLACE_LIMIT", "reprice");
                                try {
                                    await placeLimit(p);
                                } catch (err) {
                                    scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                                    st.pending = undefined;
                                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                                    addLog({ action: "ERROR", message: `REPRICE_FAILED ${p.symbol} ${getErrorMessage(err) || "unknown"}` });
                                    return true;
                                }
                                p.statusCheckAt = now + CFG.orderStatusDelayMs;
                                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                                addLog({ action: "SYSTEM", message: `REPRICE ${p.symbol} limit=${p.limitPrice} id=${p.orderLinkId}` });
                                return true;
                            }
                        }
                    }
                }

                // If still open and 1m bar done → cancel
                if (p.stage === "PLACED" && now >= p.timeoutAt) {
                    logTiming("CANCEL_SEND", "timeout");
                    try {
                        await cancelOrderByLinkId(p.symbol, p.orderLinkId);
                    } catch (err) {
                        if (isCancelSafeError(err)) {
                            // Treat as already cancelled/fill; advance to verify
                        } else {
                            throw err;
                        }
                    }
                    p.stage = "CANCEL_SENT";
                    p.cancelVerifyAt = now + CFG.postCancelVerifyDelayMs;
                    p.cancelAttempts = 0;
                    st.cooldownUntil = Math.max(st.cooldownUntil, now + SYMBOL_COOLDOWN_MS);
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
                if (!p.cancelVerifyAt || now < p.cancelVerifyAt) return false;
                p.stage = "CANCEL_VERIFY";
                return false;
            }

            if (p.stage === "CANCEL_VERIFY") {
                if ((p.cancelAttempts ?? 0) === 0) {
                    logTiming("CANCEL_VERIFY", "post_cancel_delay");
                }
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
                } else {
                    if (!found && st.pending?.stage === "CANCEL_SENT") {
                        // If cancel already processed on exchange, treat as OK
                        scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                        st.pending = undefined;
                        addLog({ action: "SYSTEM", message: `CANCEL_OK ${p.symbol} id=${p.orderLinkId} (missing in history)` });
                    } else {
                        p.cancelAttempts = (p.cancelAttempts ?? 0) + 1;
                        if (p.cancelAttempts === 1) {
                            try {
                                await cancelOrderByLinkId(p.symbol, p.orderLinkId);
                                addLog({ action: "SYSTEM", message: `CANCEL_RESEND ${p.symbol} id=${p.orderLinkId}` });
                            } catch (err) {
                                if (!isCancelSafeError(err)) {
                                    addLog({ action: "ERROR", message: `CANCEL_RESEND_FAILED ${p.symbol} ${getErrorMessage(err) || "unknown"}` });
                                }
                            }
                        }
                        if ((p.cancelAttempts ?? 0) >= 3) {
                            scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                            st.pending = undefined;
                            addLog({ action: "ERROR", message: `CANCEL_STUCK ${p.symbol} status=${status || "unknown"} force-clear` });
                            st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                            return true;
                        }
                        p.cancelVerifyAt = now + CFG.postCancelVerifyDelayMs;
                    }
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            if (p.stage === "FILLED_NEED_SL") {
                if (!p.fillAt || now < p.fillAt + CFG.postFillDelayMs) return false;
                if (p.slVerifyAt && now < p.slVerifyAt) return false;
                logTiming("PLACE_SL", "post_fill_delay");
                const attempts = p.slSetAttempts ?? 0;
                if (attempts >= SL_MAX_ATTEMPTS) {
                    p.stage = "SAFE_CLOSE";
                    p.taskReason = "SL_SET_FAILED_MAX_RETRY";
                    setSymbolSafe(p.symbol, "SL_SET_FAILED_MAX_RETRY", classifySafeDiag(p.slLastError));
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                try {
                    let pos: OpenPosition | undefined = getOpenPos(p.symbol);
                    if (!pos) {
                        try {
                            const posSnap = await fetchPositionsOnce(net);
                            pos = posSnap.list.find((pp) => pp.symbol === p.symbol && Math.abs(Number(pp.size ?? 0)) > 0);
                        } catch {
                            p.slLastError = "POSITION_MISMATCH";
                            p.slVerifyAt = now + SL_RETRY_BACKOFF_MS;
                            st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                            return true;
                        }
                        if (!pos) {
                            p.slLastError = "POSITION_MISMATCH";
                            p.slVerifyAt = now + SL_RETRY_BACKOFF_MS;
                            st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                            return true;
                        }
                    }
                    const lastPxRaw = currentPricesRef.current[p.symbol] || pos?.entryPrice || p.limitPrice || 0;
                    const lastPx = Number(lastPxRaw);
                    const tick = st.instrument?.tickSize ?? Math.max((lastPx || 1) * 0.0001, 0.1);
                    const isBuy = String(pos?.side ?? p.side ?? "").toLowerCase() === "buy";
                    let safeSl = p.sl;
                    if (Number.isFinite(lastPx) && lastPx > 0) {
                        if (isBuy && safeSl >= lastPx - tick) safeSl = lastPx - tick;
                        if (!isBuy && safeSl <= lastPx + tick) safeSl = lastPx + tick;
                    }
                    await setProtection(p.symbol, safeSl, undefined);
                    p.sl = safeSl;
                    p.slSetAttempts = attempts + 1;
                    p.slLastError = undefined;
                } catch (err) {
                    p.slLastError = getErrorMessage(err) || "SL_SET_FAILED";
                    p.slSetAttempts = attempts + 1;
                    p.slVerifyAt = now + SL_RETRY_BACKOFF_MS;
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                p.stage = "SL_SENT";
                p.slVerifyAt = now + CFG.postSlVerifyDelayMs;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            if (p.stage === "SL_SENT") {
                if (!p.slVerifyAt || now < p.slVerifyAt) return false;
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
                    const attempts = p.slSetAttempts ?? 0;
                    if (!found) {
                        p.slLastError = "POSITION_MISMATCH";
                    }
                    if (age > SL_SLA_MS) {
                        p.stage = "SAFE_CLOSE";
                        p.taskReason = "SL_SLA_EXPIRED";
                        setSymbolSafe(p.symbol, "SL_SLA_EXPIRED", classifySafeDiag(p.slLastError));
                    } else if (attempts < SL_MAX_ATTEMPTS) {
                        try {
                            await setProtection(p.symbol, p.sl, undefined);
                            p.slSetAttempts = attempts + 1;
                            p.slLastError = undefined;
                        } catch (err) {
                            p.slLastError = getErrorMessage(err) || "SL_SET_FAILED";
                            p.slSetAttempts = attempts + 1;
                        }
                        p.slVerifyAt = now + SL_RETRY_BACKOFF_MS;
                    } else {
                        p.stage = "SAFE_CLOSE";
                        p.taskReason = "SL_SET_FAILED_MAX_RETRY";
                        setSymbolSafe(p.symbol, "SL_SET_FAILED_MAX_RETRY", classifySafeDiag(p.slLastError));
                    }
                } else {
                    p.stage = "TP_SENT";
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            if (p.stage === "TP_SENT") {
                logTiming("PLACE_TP", "post_sl_verify");
                try {
                    await setProtection(p.symbol, undefined, p.tp);
                } catch (err) {
                    addLog({ action: "ERROR", message: `TP_SET_FAILED ${p.symbol} ${getErrorMessage(err) || "unknown"}` });
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
                if (!p.tpVerifyAt || now < p.tpVerifyAt) return false;
                logTiming("VERIFY_TP", "post_tp_delay");
                const posResp = await fetchPositionsOnce(net);
                const found = posResp.list.find((pp) => pp.symbol === p.symbol && Math.abs(Number(pp.size ?? 0)) > 0);
                const tol = Math.abs((currentPricesRef.current[p.symbol] ?? p.limitPrice) * 0.001) || 0.5;
                const ok = found && Math.abs(Number(found.takeProfit ?? 0) - p.tp) <= tol;
                if (ok) {
                    st.pending = undefined;
                    addLog({ action: "SYSTEM", message: `PROTECTION_OK ${p.symbol} SL/TP set` });
                } else {
                    p.tpVerifyAt = now + CFG.postTpVerifyDelayMs;
                }
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            if (p.stage === "PARTIAL_EXIT") {
                if (!canPlaceOrders) return false;
                const closeQty = p.closeQty ?? 0;
                if (!Number.isFinite(closeQty) || closeQty <= 0) {
                    st.pending = undefined;
                    return false;
                }
                    const exitSide = p.side === "Buy" ? "Sell" : "Buy";
                    const label = p.taskReason === "TIME_STOP"
                        ? "TIME_STOP"
                        : p.taskReason === "TP1"
                            ? "TP1"
                            : "PARTIAL";
                    const ok = await placeReduceOnlyExit(p.symbol, exitSide, closeQty, label);
                    if (!ok) {
                        addLog({ action: "ERROR", message: `PARTIAL_FAILED ${p.symbol}` });
                        st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                        return true;
                    }
                    if (st.manage && p.taskReason === "TP1") st.manage.partialTaken = true;
                    st.pending = undefined;
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    addLog({ action: "SYSTEM", message: `${label} ${p.symbol} qty=${closeQty}` });
                    return true;
                }

            if (p.stage === "TRAIL_SL_UPDATE") {
                if (!canPlaceOrders) return false;
                const newSl = p.newSl;
                if (!Number.isFinite(newSl)) {
                    st.pending = undefined;
                    return false;
                }
                const nextTp = normalizeTp(p.tp);
                const pos = posForPending;
                if (pos) {
                    const lastPx = currentPricesRef.current[p.symbol] || pos.entryPrice || 0;
                    const tick = st.instrument?.tickSize ?? Math.max((lastPx || 1) * 0.0001, 0.1);
                    const isBuy = String(pos.side || "").toLowerCase() === "buy";
                    const valid = isBuy ? newSl < lastPx - tick : newSl > lastPx + tick;
                    if (!valid) {
                        st.pending = undefined;
                        st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                        addLog({ action: "SYSTEM", message: `TRAIL_SKIP ${p.symbol} sl=${newSl} last=${lastPx}` });
                        return true;
                    }
                }
                try {
                    await setProtection(p.symbol, newSl, nextTp);
                } catch (err) {
                    const msg = getErrorMessage(err).toLowerCase();
                    if (msg.includes("not modified") || msg.includes("no change")) {
                        st.pending = undefined;
                        st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                        addLog({ action: "SYSTEM", message: `TRAIL_NOOP ${p.symbol} sl=${newSl}` });
                        return true;
                    }
                    addLog({ action: "ERROR", message: `TRAIL_FAILED ${p.symbol} ${getErrorMessage(err) || "unknown"}` });
                    st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                    return true;
                }
                st.pending = undefined;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                if (Number.isFinite(nextTp)) {
                    const current = protectionTargetsRef.current[p.symbol] ?? {};
                    protectionTargetsRef.current[p.symbol] = { ...current, sl: newSl, tp: nextTp ?? current.tp };
                    protectionVerifyRef.current[p.symbol] = now;
                } else {
                    const current = protectionTargetsRef.current[p.symbol] ?? {};
                    protectionTargetsRef.current[p.symbol] = { ...current, sl: newSl };
                    protectionVerifyRef.current[p.symbol] = now;
                }
                addLog({ action: "SYSTEM", message: `TRAIL ${p.symbol} newSL=${newSl}` });
                return true;
            }

            if (p.stage === "SAFE_CLOSE") {
                const pos = getOpenPos(p.symbol);
                if (pos) await forceClosePosition(pos);
                st.pending = undefined;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                addLog({ action: "ERROR", message: `SAFE_CLOSE ${p.symbol} reason=${p.taskReason || "UNKNOWN"}` });
                return true;
            }

            return false;
        };

        const processSymbol = async (symbol: string, plannedAt: number): Promise<boolean> => {
            const st = ensureSymbolState(symbol);
            const now = Date.now();

            const logTiming = (kind: string, reason?: string) => {
                const ts = Date.now();
                addLog({
                    action: "SYSTEM",
                    message: `TIMING ${kind} ${symbol} delay=${ts - plannedAt}ms reason=${reason || "-"}`,
                });
            };

            // Global active-symbol lock: only lock while pending entry/exit is in progress.
            const engaged = Boolean(st.pending);
            const locked = scalpActiveSymbolRef.current;
            if (locked && locked !== symbol) {
                if (engaged || now < scalpSymbolLockUntilRef.current) return false;
            }
            if (!locked && engaged) {
                scalpActiveSymbolRef.current = symbol;
                scalpSymbolLockUntilRef.current = now + CFG.symbolFetchGapMs;
            } else if (locked === symbol && engaged) {
                scalpSymbolLockUntilRef.current = Math.max(scalpSymbolLockUntilRef.current, now + CFG.symbolFetchGapMs);
            }

            if (now < st.nextAllowedAt) return false;

            const paused = now < st.pausedUntil;
            const activeStats = getActiveSymbolStats();
            const maxedPortfolio = hasMaxedPositions(activeStats);

            if (st.pending) {
                const allowManage = paused ? st.pending.stage !== "READY_TO_PLACE" : true;
                const allowSafe = scalpSafeRef.current ? st.pending.stage !== "READY_TO_PLACE" : true;
                if (allowManage && allowSafe) {
                    const did = await handlePending(st, plannedAt, logTiming);
                    if (did) return true;
                }
            }
            if (paused) {
                logScalpReject(symbol, `PAUSED ${st.pausedReason || "UNKNOWN"}`);
                return false;
            }
            if (scalpSafeRef.current) {
                logScalpReject(symbol, "SAFE_MODE");
                return false;
            }
            if (maxedPortfolio && !activeStats.symbols.has(symbol)) {
                return false;
            }

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
                const conf: ScalpConfirm =
                    st.htfConfirm && st.htfConfirm.expectedOpenTime === expected15
                        ? st.htfConfirm
                        : { expectedOpenTime: expected15, stage: 0 as const, attempts: 0 };
                logTiming("FETCH_HTF", st.htfConfirm ? "retry_confirm" : undefined);
                const candles = await fetchKlines(symbol, "15", 240);
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

                const closes = candles.map((c) => c.close);
                const emaSeries = scalpComputeEma(closes, CFG.htfEmaPeriod);
                const ema200 = emaSeries.slice(-1)[0] ?? last.close;
                const emaPrev = emaSeries.length > 1 ? emaSeries[emaSeries.length - 2] : ema200;
                const atr14 = scalpComputeAtr(candles, CFG.atrPeriod).slice(-1)[0] ?? 0;
                const emaSlopeNorm = atr14 > 0 ? (ema200 - emaPrev) / atr14 : 0;
                const regime: ScalpRegime = Math.abs(emaSlopeNorm) > CFG.htfSlopeMinNorm ? "TREND" : "RANGE";
                const stSeries = computeSuperTrend(candles, CFG.stHtf.atr, CFG.stHtf.mult);
                const stDir = stSeries.dir[stSeries.dir.length - 1];
                const prevStDir = stSeries.dir[stSeries.dir.length - 2] ?? stDir;
                const stLine = stSeries.line[stSeries.line.length - 1];
                let bias: ScalpBias = "NONE";
                if (isMaticX) {
                    bias = stDir === "UP" ? "LONG" : "SHORT";
                } else if (Number.isFinite(ema200) && Number.isFinite(last.close)) {
                    bias = last.close >= ema200 ? "LONG" : "SHORT";
                }
                let blockedUntilBarOpenTime = isMaticX ? (st.htf?.blockedUntilBarOpenTime ?? 0) : 0;
                if (isMaticX && stDir !== prevStDir) {
                    blockedUntilBarOpenTime = expected15 + htfMs;
                    if (st.pending) {
                        if (st.pending.stage === "READY_TO_PLACE") {
                            scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (st.pending.reservedRiskUsd || 0));
                        }
                        st.pending = undefined;
                    }
                    st.ltfLastScanBarOpenTime = undefined;
                    addLog({
                        action: "SYSTEM",
                        message: `HTF_FLIP ${symbol} block=15m cancel-pending`,
                    });
                }
                st.htf = {
                    barOpenTime: expected15,
                    bias,
                    regime,
                    ema200,
                    emaSlopeNorm,
                    atr14,
                    close: last.close,
                    blockedUntilBarOpenTime,
                    stDir,
                    prevStDir,
                    stLine,
                };
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            // LTF update (1m) with double-confirmation
            const ltfMs = 60_000;
            const expected1 = expectedOpenTime(now, ltfMs, CFG.ltfCloseDelayMs);
            if (!st.ltf || st.ltf.barOpenTime < expected1) {
                const conf: ScalpConfirm =
                    st.ltfConfirm && st.ltfConfirm.expectedOpenTime === expected1
                        ? st.ltfConfirm
                        : { expectedOpenTime: expected1, stage: 0 as const, attempts: 0 };
                logTiming("FETCH_LTF", st.ltfConfirm ? "retry_confirm" : undefined);
                const ltfLimit = isSmcMode ? 360 : 50;
                const candles = await fetchKlines(symbol, "1", ltfLimit);
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

                const same =
                    conf.lastClose === last.close &&
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
                const emaSeries = scalpComputeEma(closes, CFG.emaPeriod);
                const ema20 = emaSeries.slice(-1)[0] ?? last.close;
                const emaPrev = emaSeries.length > 1 ? emaSeries[emaSeries.length - 2] : ema20;
                const emaSlopeAbs = Number.isFinite(emaPrev) && Math.abs(emaPrev) > 0
                    ? Math.abs(ema20 - emaPrev) / Math.abs(emaPrev)
                    : 0;
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
                    candles,
                    stDir,
                    prevStDir,
                    stLine,
                    ema20,
                    emaSlopeAbs,
                    atr14,
                    smaVol20: volSma20,
                    rvol,
                    last,
                };
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            // Manage tasks (partial / trailing) based on current LTF close
            if (!st.manage && st.instrument && st.ltf) {
                const pos = getOpenPos(symbol);
                if (pos && Number.isFinite(pos.entryPrice) && Math.abs(Number(pos.size ?? pos.qty ?? 0)) > 0) {
                    const r = Math.abs((pos.entryPrice || 0) - (pos.sl ?? pos.entryPrice));
                    const openedAtMs = Date.parse(pos.openedAt ?? pos.timestamp ?? "");
                    const entryBarOpenTime = Number.isFinite(openedAtMs)
                        ? Math.floor(openedAtMs / 60_000) * 60_000
                        : st.ltf.barOpenTime;
                    st.manage = {
                        symbol,
                        side: pos.side === "buy" ? "Buy" : "Sell",
                        entry: pos.entryPrice,
                        qty: Number(pos.size ?? pos.qty ?? 0),
                        oneR: r > 0 ? r : Math.abs(pos.entryPrice * STOP_MIN_PCT),
                        partialTaken: false,
                        beMoved: false,
                        timeStopDone: false,
                        entryBarOpenTime,
                        lastBarOpenTime: st.ltf.barOpenTime,
                        maxPrice: st.ltf.last.high,
                        minPrice: st.ltf.last.low,
                    };
                }
            }

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
                    const qtyAbs = Math.abs(st.manage.qty);
                    const feeEstimate = (Math.abs(st.manage.entry) + Math.abs(px)) * qtyAbs * TAKER_FEE;
                    const netProfitUsd = profit * qtyAbs - feeEstimate;
                    if (r > 0 && !st.pending) {
                        const newBar = st.manage.lastBarOpenTime !== st.ltf.barOpenTime;
                        if (newBar) st.manage.lastBarOpenTime = st.ltf.barOpenTime;
                        const profitR = profit / r;
                        const feeShift = st.manage.entry * TAKER_FEE * 2;

                        if (newBar && !st.manage.timeStopDone) {
                            const barsElapsed = Math.floor((st.ltf.barOpenTime - st.manage.entryBarOpenTime) / 60_000);
                            if (barsElapsed >= TIME_STOP_BARS_1M && profitR < TIME_STOP_MIN_R) {
                                const closeQtyRaw = Math.abs(st.manage.qty);
                                const closeQty = roundDownToStep(closeQtyRaw, st.instrument.stepSize);
                                if (closeQty >= st.instrument.minQty) {
                                    st.manage.timeStopDone = true;
                                    st.pending = {
                                        stage: "PARTIAL_EXIT",
                                        orderLinkId: `timestop:${symbol}:${expected1}`,
                                        symbol,
                                        side: st.manage.side,
                                        limitPrice: 0,
                                        qty: st.manage.qty,
                                        closeQty,
                                        sl: 0,
                                        tp: 0,
                                        oneR: r,
                                        reservedRiskUsd: 0,
                                        taskReason: "TIME_STOP",
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

                        if (newBar && !st.manage.beMoved && profitR >= BE_TRIGGER_R) {
                            const currentSl = Number(pos.sl ?? 0) || 0;
                            const desiredSl = st.manage.entry + dir * feeShift;
                            const improves = st.manage.side === "Buy" ? desiredSl > currentSl : desiredSl < currentSl;
                            if (Number.isFinite(desiredSl) && improves) {
                                st.manage.beMoved = true;
                                st.pending = {
                                    stage: "TRAIL_SL_UPDATE",
                                    orderLinkId: `be:${symbol}:${expected1}`,
                                    symbol,
                                    side: st.manage.side,
                                    limitPrice: 0,
                                    qty: st.manage.qty,
                                    newSl: desiredSl,
                                    sl: 0,
                                    tp: pos.tp ?? 0,
                                    oneR: r,
                                    reservedRiskUsd: 0,
                                    taskReason: "BE_MOVE",
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

                        if (!st.manage.partialTaken &&
                            profit >= CFG.partialAtR * r &&
                            netProfitUsd >= MIN_NET_PROFIT_USD) {
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
                                    taskReason: "TP1",
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

                        if (newBar && profit >= CFG.trailActivateR * r && netProfitUsd >= MIN_NET_PROFIT_USD) {
                            const currentSl = Number(pos.sl ?? 0) || 0;
                            const atr = st.ltf.atr14 || 0;
                            const buffer = Math.max(st.instrument.tickSize, atr * 0.2);
                            const stLine = st.ltf.stLine;
                            let newSl =
                                st.manage.side === "Buy"
                                    ? stLine - buffer
                                    : stLine + buffer;
                            if (!Number.isFinite(newSl)) {
                                const minRetrace = Math.abs(px) * TRAIL_MIN_RETRACE_PCT;
                                const retrace = Math.max(CFG.trailRetraceR * r, minRetrace);
                                newSl = st.manage.side === "Buy"
                                    ? st.manage.maxPrice - retrace
                                    : st.manage.minPrice + retrace;
                            }
                            const improves = st.manage.side === "Buy" ? newSl > currentSl : newSl < currentSl;
                            if (Number.isFinite(newSl) && improves) {
                                const { tp: trailTp } = resolveTrailTp(dir, px, pos.tp, r);
                                const nextTp = trailTp ?? normalizeTp(pos.tp) ?? 0;
                                st.pending = {
                                    stage: "TRAIL_SL_UPDATE",
                                    orderLinkId: `trail:${symbol}:${expected1}`,
                                    symbol,
                                    side: st.manage.side,
                                    limitPrice: 0,
                                    qty: st.manage.qty,
                                    newSl,
                                    sl: 0,
                                    tp: nextTp,
                                    oneR: r,
                                    reservedRiskUsd: 0,
                                    taskReason: "TRAIL",
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
            if (!st.htf || !st.ltf || !st.instrument) return false;
            if (st.ltfLastScanBarOpenTime === st.ltf.barOpenTime) return false;
            if (scalpSafeRef.current) return false;
            if (now < scalpGlobalCooldownUntilRef.current) return false;
            if (now < st.cooldownUntil) {
                logScalpReject(symbol, `COOLDOWN ${(st.cooldownUntil - now) / 1000}s`);
                return false;
            }
            const biasOk = isGateEnabled("HTF bias") ? st.htf.bias !== "NONE" : true;
            if (!biasOk) return false;
            if (now < st.htf.blockedUntilBarOpenTime + CFG.htfCloseDelayMs) return false;
            const isRange = st.htf.regime === "RANGE";
            const quota = getQuotaState(symbol, now);
            const entryTfMs = isSmcMode ? 60_000 : isMaticX ? 60_000 : quota.entryTfMs;
            if (entryTfMs > 60_000 && st.ltf.barOpenTime % entryTfMs !== 0) {
                st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            const hasPending = Boolean(st.pending);
            const hasOpenPos = Boolean(getOpenPos(symbol));
            const isLong = st.htf.bias === "LONG";

            // Signal purely z OHLCV/indikátorů
            const prev = st.ltf.candles[st.ltf.candles.length - 2];
            if (!prev) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const pullbackRaw = isLong ? st.ltf.last.low <= st.ltf.ema20 : st.ltf.last.high >= st.ltf.ema20;
            const breakBufferBps = breakBufferBpsFor(symbol);
            const breakBuffer = (isLong ? prev.high : prev.low) * (breakBufferBps / 10000);
            const microBreakLevel = isLong ? prev.high + breakBuffer : prev.low - breakBuffer;
            const microBreakRaw = isLong ? st.ltf.last.close > microBreakLevel : st.ltf.last.close < microBreakLevel;
            const range = st.ltf.last.high - st.ltf.last.low;
            const emaVal = st.ltf.ema20;
            const atrPctNow = st.ltf.atr14 > 0 ? st.ltf.atr14 / Math.max(1e-8, st.ltf.last.close) : 0;
            const touchBand = Math.max(2 * st.instrument.tickSize, CFG.touchBandAtrFrac * st.ltf.atr14);
            const emaTouchRaw = Number.isFinite(emaVal)
                ? st.ltf.last.low <= (emaVal as number) + touchBand &&
                  st.ltf.last.high >= (emaVal as number) - touchBand
                : false;
            const stFlipRaw = isLong
                ? st.ltf.prevStDir === "DOWN" && st.ltf.stDir === "UP"
                : st.ltf.prevStDir === "UP" && st.ltf.stDir === "DOWN";
            const stCloseRaw = isLong ? st.ltf.last.close > st.ltf.stLine : st.ltf.last.close < st.ltf.stLine;
            const htfStLine = st.htf?.stLine;
            const htfLineRaw = Number.isFinite(htfStLine)
                ? isLong
                    ? st.ltf.last.close > (htfStLine as number)
                    : st.ltf.last.close < (htfStLine as number)
                : false;
            const rvolRaw = st.ltf.rvol >= CFG.rvolMin;
            const momentumLookback = Math.max(6, CFG.momentumLookback);
            const momentumCandles = st.ltf.candles.slice(-momentumLookback);
            const recentVolAvg = momentumCandles.length
                ? momentumCandles.reduce((sum, c) => sum + (c.volume || 0), 0) / momentumCandles.length
                : 0;
            const volSpikeRaw = momentumCandles.length > 0 ? st.ltf.last.volume > recentVolAvg * CFG.momentumVolMult : false;
            const impulseIdx = momentumCandles.length - 6;
            const impulseBase = impulseIdx >= 0 ? momentumCandles[impulseIdx].close : undefined;
            const priceImpulseRaw = Number.isFinite(impulseBase)
                ? Math.abs(st.ltf.last.close - (impulseBase as number)) / Math.max(1e-8, impulseBase as number) >= CFG.momentumPricePct
                : false;
            const momentumRaw = volSpikeRaw && priceImpulseRaw;
            const rangeTooWide = st.ltf.atr14 > 0 ? range >= CFG.antiBreakoutRangeAtr * st.ltf.atr14 : false;
            const closeChasing = range > 0
                ? isLong
                    ? st.ltf.last.close >= st.ltf.last.low + range * CFG.antiBreakoutCloseFrac
                    : st.ltf.last.close <= st.ltf.last.high - range * CFG.antiBreakoutCloseFrac
                : false;
            const antiBreakoutRaw = !rangeTooWide && !closeChasing;
            const atrOkRaw = st.ltf.atr14 > 0 ? atrPctNow >= CFG.lowAtrMinPct : false;

            // Apply UI toggles: disabled gate = auto-pass
            const pullback = isGateEnabled("EMA pullback") ? pullbackRaw : true;
            const microBreak = isGateEnabled("Micro break") ? microBreakRaw : true;
            const stFlip = isGateEnabled("ST1 flip") ? stFlipRaw : true;
            const emaTouch = isGateEnabled("EMA touch") ? emaTouchRaw : true;
            const stCloseOk = isGateEnabled("ST1 close") ? stCloseRaw : true;
            const htfLineOk = isGateEnabled("HTF ST line") ? htfLineRaw : true;
            const rvolOk = isGateEnabled("RVOL") ? rvolRaw : true;
            const momentumOk = isGateEnabled("Momentum") ? momentumRaw : true;
            const antiBreakoutOk = isGateEnabled("Anti-breakout") ? antiBreakoutRaw : true;
            const atrOk = isGateEnabled("ATR min") ? atrOkRaw : true;
            if (microBreakRaw) {
                if (!st.microBreakBarOpenTime) st.microBreakBarOpenTime = st.ltf.barOpenTime;
            } else {
                st.microBreakBarOpenTime = undefined;
            }
            const microBreakBars = st.microBreakBarOpenTime != null && entryTfMs > 0
                ? Math.floor((st.ltf.barOpenTime - st.microBreakBarOpenTime) / entryTfMs)
                : undefined;
            const sessionOkRaw = isSmcMode ? isKillzone(now) : true;
            const sessionOk = isGateEnabled("Session") ? sessionOkRaw : true;
            const asiaRange = isSmcMode ? computeAsiaRange(st.ltf.candles, now) : null;
            const asiaSweepRaw = isSmcMode && asiaRange?.valid
                ? isLong
                    ? st.ltf.last.low < asiaRange.low && st.ltf.last.close > asiaRange.low
                    : st.ltf.last.high > asiaRange.high && st.ltf.last.close < asiaRange.high
                : false;
            const asiaOk = isSmcMode
                ? isGateEnabled("Asia range")
                    ? asiaRange?.valid
                        ? asiaSweepRaw
                        : true
                    : true
                : true;
            const allowSmc = isSmcMode || isMaticX;
            const sweepRaw = allowSmc
                ? asiaRange?.valid
                    ? asiaSweepRaw
                    : detectSweep(st.ltf.candles, isLong, st.ltf.atr14, st.instrument.tickSize)
                : false;
            const sweepOk = isSmcMode ? (isGateEnabled("Sweep") ? sweepRaw : true) : true;
            const chochRaw = allowSmc ? detectChoch(st.ltf.candles, isLong) : false;
            const fvgRaw = isSmcMode ? detectFvg(st.ltf.candles, isLong ? "long" : "short") : false;
            const chochFvgRaw = isSmcMode ? chochRaw && fvgRaw : false;
            const chochFvgOk = isSmcMode ? (isGateEnabled("CHoCH+FVG") ? chochFvgRaw : true) : true;
            const smcSignal = allowSmc ? sweepRaw && chochRaw : false;
            const smcRequired = isMaticX && settingsRef.current.useLiquiditySweeps;

            const gateFailures: string[] = [];
            let signalActive = false;
            if (isSmcMode) {
                if (!sessionOk) gateFailures.push("Session");
                if (!asiaOk) gateFailures.push("Asia range");
                if (!sweepOk) gateFailures.push("Sweep");
                if (!chochFvgOk) gateFailures.push("CHoCH+FVG");
                signalActive = sessionOk && asiaOk && sweepOk && chochFvgOk;
            } else if (isMaticX) {
                if (!htfLineOk) gateFailures.push("HTF_ST");
                if (!stFlip) gateFailures.push("ST1_FLIP");
                if (!emaTouch) gateFailures.push("EMA_TOUCH");
                if (!stCloseOk) gateFailures.push("ST1_CLOSE");
                if (!rvolOk) gateFailures.push("RVOL");
                if (!momentumOk) gateFailures.push("MOMENTUM");
                if (!antiBreakoutOk) gateFailures.push("ANTI_BREAKOUT");
                if (!atrOk) gateFailures.push("LOW_ATR");
                if (smcRequired && !smcSignal) gateFailures.push("SMC");
                signalActive = htfLineOk && stFlip && emaTouch && stCloseOk && rvolOk && momentumOk && antiBreakoutOk && atrOk;
                if (smcRequired) signalActive = signalActive && smcSignal;
            } else {
                if (!pullback) gateFailures.push("EMA pullback");
                if (!microBreak) gateFailures.push("Micro break");
                signalActive = pullback && microBreak;
            }

            // BBO needed when signal active / pending / open pos; otherwise keep old snapshot to save API
            const needFreshBbo = signalActive || hasPending || hasOpenPos;
            const needBbo = !st.bbo || needFreshBbo;
            const bboStaleForUse = isBboStale(st.bbo, now, needFreshBbo ? BBO_STALE_MS : BBO_STALE_SOFT_MS);
            if (needBbo && bboStaleForUse) {
                const reason = st.bbo ? "stale" : "bootstrap";
                const last = staleBboLogRef.current[symbol] ?? 0;
                if (now - last > 2000) {
                    logTiming("FETCH_BBO", reason);
                    staleBboLogRef.current[symbol] = now;
                }
                const nextAllowed = st.bboNextFetchAt ?? 0;
                if (now < nextAllowed) {
                    if (needFreshBbo) {
                        st.nextAllowedAt = Math.max(st.nextAllowedAt, nextAllowed);
                        return true;
                    }
                } else {
                    try {
                        const bbo = await fetchBbo(symbol);
                        st.bbo = bbo;
                        st.bboFailCount = 0;
                        st.bboLastOkAt = now;
                        st.bboNextFetchAt = now + BBO_STALE_MS;
                    } catch (err) {
                        const fails = (st.bboFailCount ?? 0) + 1;
                        st.bboFailCount = fails;
                        const backoff = Math.min(BBO_BACKOFF_MAX_MS, BBO_BACKOFF_BASE_MS * (2 ** Math.min(6, fails - 1)));
                        st.bboNextFetchAt = now + backoff;
                        addLog({ action: "ERROR", message: `BBO_FETCH_FAIL ${symbol} backoff=${backoff}ms ${getErrorMessage(err) || "unknown"}` });
                        st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                        return true;
                    }
                }
            }

            const bboAgeMs = st.bbo ? now - st.bbo.ts : Infinity;
            const bboStale = isBboStale(st.bbo, now, BBO_STALE_MS);
            const spBps = st.bbo ? spreadBps(st.bbo.bid, st.bbo.ask) : Infinity;
            const spreadPctNow = Number.isFinite(spBps) ? spBps / 10000 : Infinity;
            const atrPct = atrPctNow;
            const dataAgeOk = !isMaticX || bboAgeMs <= CFG.dataAgeMaxMs;
            const spreadOk = !isMaticX || spreadPctNow <= CFG.spreadMaxPct;
            if (isMaticX && !dataAgeOk) {
                gateFailures.push("DATA_AGE");
                if (signalActive) {
                    scalpForceSafeUntilRef.current = Math.max(scalpForceSafeUntilRef.current, now + 5000);
                    logScalpReject(symbol, `DATA_AGE ${Math.round(bboAgeMs)}ms`, {
                        reasonCode: "DATA_AGE",
                        spreadBps: spBps,
                        atrPct,
                    });
                }
                signalActive = false;
            }
            if (isMaticX && !spreadOk) {
                gateFailures.push("SPREAD");
                signalActive = false;
            }
            const executionAllowed = signalActive ? !bboStale && (!isMaticX || (spreadOk && dataAgeOk)) : true;
            const emaSlopeAbs = st.ltf.emaSlopeAbs ?? 0;
            const hardEnabled = settingsRef.current.enableHardGates !== false;
            const softEnabled = settingsRef.current.enableSoftGates !== false;
            const offset = Math.max(2 * st.instrument.tickSize, CFG.offsetAtrFrac * st.ltf.atr14);
            const limitRaw = isLong
                ? Math.min(st.bbo.ask - st.instrument.tickSize, st.bbo.bid + offset)
                : Math.max(st.bbo.bid + st.instrument.tickSize, st.bbo.ask - offset);
            const limit = roundToTick(limitRaw, st.instrument.tickSize);
            const ema20 = st.ltf.ema20;
            const distToEmaAtr = st.ltf.atr14 > 0 && Number.isFinite(ema20)
                ? Math.abs(limit - (ema20 as number)) / st.ltf.atr14
                : undefined;
            const lateEntry =
                Number.isFinite(ema20) && st.ltf.atr14 > 0 && Math.abs(limit - (ema20 as number)) > LATE_ENTRY_ATR * st.ltf.atr14;
            const microBreakDist = isLong ? st.ltf.last.close - microBreakLevel : microBreakLevel - st.ltf.last.close;
            const microBreakAtr = st.ltf.atr14 > 0 ? Math.max(0, microBreakDist) / st.ltf.atr14 : undefined;
            const signalAgeMs = now - st.ltf.barOpenTime;
            const betaSameSide = BETA_BUCKET.has(symbol) &&
                activePositionsRef.current.some((p) => BETA_BUCKET.has(p.symbol) &&
                    String(p.side ?? "").toLowerCase() === (isLong ? "buy" : "sell"));
            const qualityCtx: QualityCtx = {
                bboAgeMs,
                spreadBps: spBps,
                atrPct,
                emaSlopeAbs,
                range,
                atr: st.ltf.atr14,
                htfBias: st.htf?.bias ?? "NONE",
                htfClose: st.htf?.close ?? st.ltf.last.close,
                htfEma200: st.htf?.ema200 ?? st.ltf.last.close,
                htfSlopeNorm: st.htf?.emaSlopeNorm ?? 0,
                htfAtr: st.htf?.atr14 ?? st.ltf.atr14,
                ema20DistAtr: distToEmaAtr,
                microBreakAtr,
                microBreakOk: microBreakRaw,
                microBreakBars,
                signalAgeMs,
                entryTfMs: entryTfMs,
                betaSameSide,
            };
            const emaSlopeNorm = st.htf?.emaSlopeNorm ?? 0;
            const rejectMetricsBase = {
                spreadBps: spBps,
                atrPct,
                emaSlopeNorm,
            };
            const qualityResult = qualityScoreFor(symbol, qualityCtx);
            const qualityScore = qualityResult.score;
            const baseMinScore = symbol === "ETHUSDT" ? QUALITY_SCORE_MID : QUALITY_SCORE_LOW;
            const qualityThreshold = softEnabled
                ? (quota.boosted ? Math.min(baseMinScore, QUALITY_SCORE_SOFT_BOOST) : baseMinScore)
                : QUALITY_SCORE_LOW;
            const qualityTier = qualityScore >= QUALITY_SCORE_HIGH
                ? "HIGH"
                : qualityScore >= QUALITY_SCORE_MID
                    ? "MID"
                    : "LOW";
            const hardGate = hardEnabled ? shouldBlockEntry(symbol, qualityCtx) : { blocked: false, reason: "", code: "" };
            const qualityPass = isMaticX ? true : (!softEnabled || qualityScore >= qualityThreshold);

            const gateDetails = isSmcMode
                ? `session=${sessionOkRaw}/${sessionOk} asia=${asiaSweepRaw}/${asiaOk} sweep=${sweepRaw}/${sweepOk} choch=${chochRaw} fvg=${fvgRaw} bboFresh=${!bboStale} q=${qualityScore}`
                : isMaticX
                    ? `htfSt=${htfLineRaw}/${htfLineOk} stFlip=${stFlipRaw}/${stFlip} emaTouch=${emaTouchRaw}/${emaTouch} stClose=${stCloseRaw}/${stCloseOk} rvol=${rvolRaw}/${rvolOk} mom=${momentumRaw}/${momentumOk} anti=${antiBreakoutRaw}/${antiBreakoutOk} atr=${atrOkRaw}/${atrOk} smc=${smcSignal}${smcRequired ? "/req" : ""} spreadOk=${spreadOk} bboFresh=${!bboStale}`
                    : `pullback=${pullbackRaw}/${pullback} micro=${microBreakRaw}/${microBreak} bboFresh=${!bboStale} late=${lateEntry ? "yes" : "no"} q=${qualityScore}`;
            addLog({
                action: "SIGNAL",
                message: `SCALP ${symbol} signal=${signalActive ? "ACTIVE" : "NONE"} execAllowed=${signalActive ? executionAllowed : "N/A"} bboAge=${Number.isFinite(bboAgeMs) ? bboAgeMs.toFixed(0) : "inf"}ms | fail=[${gateFailures.join(",") || "none"}] | gates raw/gated: ${gateDetails}`,
            });

            // Update diagnostics snapshot
            setScanDiagnostics((prev) => ({
                ...prev,
                [symbol]: {
                    symbol,
                    lastUpdated: now,
                    signalActive,
                    executionAllowed: signalActive ? executionAllowed : "N/A",
                    bboAgeMs: Number.isFinite(bboAgeMs) ? Math.floor(bboAgeMs) : Infinity,
                    spreadBps: Number.isFinite(spBps) ? Number(spBps.toFixed(2)) : Infinity,
                    atrPct,
                    emaSlopeAbs,
                    regime: isRange ? "RANGE" : "TREND",
                    quotaBoost: quota.boosted,
                    tradeCount3h: quota.actual3h,
                    tradeTarget3h: quota.expected3h,
                    qualityScore,
                    qualityTier,
                    qualityThreshold,
                    qualityPass,
                    qualityBreakdown: qualityResult.breakdown,
                    qualityTopReason: qualityResult.topReason,
                    hardEnabled,
                    softEnabled,
                    hardBlock: hardGate.blocked ? hardGate.reason : undefined,
                    hardBlocked: hardGate.blocked,
                    gates: isSmcMode
                        ? [
                            { name: "HTF bias", ok: st.htf?.bias !== "NONE" },
                            { name: "Session", ok: sessionOk },
                            { name: "Asia range", ok: asiaOk },
                            { name: "Sweep", ok: sweepOk },
                            { name: "CHoCH+FVG", ok: chochFvgOk },
                            { name: "PostOnly", ok: true },
                            { name: "BBO fresh", ok: !bboStale },
                        ]
                        : isMaticX
                            ? [
                                { name: "HTF ST", ok: htfLineOk },
                                { name: "ST1 flip", ok: stFlip },
                                { name: "EMA touch", ok: emaTouch },
                                { name: "ST1 close", ok: stCloseOk },
                                { name: "RVOL", ok: rvolOk },
                                { name: "Momentum", ok: momentumOk },
                                { name: "Anti-breakout", ok: antiBreakoutOk },
                                { name: "ATR min", ok: atrOk },
                                { name: "SMC", ok: smcRequired ? smcSignal : true },
                                { name: "Spread", ok: spreadOk },
                                { name: "BBO fresh", ok: !bboStale },
                            ]
                            : [
                                { name: "HTF bias", ok: st.htf?.bias !== "NONE" },
                                { name: "EMA pullback", ok: pullback },
                                { name: "Micro break", ok: microBreak },
                                { name: "BBO fresh", ok: !bboStale },
                            ],
                },
            }));

            if (!signalActive) {
                st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            if (!executionAllowed) {
                if (signalActive) {
                    if (!canPlaceOrders) {
                        logScalpReject(symbol, "BLOCKED auto mode off or missing auth token");
                    } else if (bboStale) {
                        logScalpReject(symbol, `BBO age=${Number.isFinite(bboAgeMs) ? bboAgeMs.toFixed(0) : "inf"}ms`, { ...rejectMetricsBase, reasonCode: "BBO_STALE" });
                    }
                }
                if (signalActive && bboAgeMs > 10_000) {
                    st.pausedUntil = now + 5_000;
                    st.pausedReason = "PAUSED_DATA_STALE";
                    addLog({ action: "SYSTEM", message: `PAUSE ${symbol} DATA_STALE age=${Number.isFinite(bboAgeMs) ? bboAgeMs.toFixed(0) : "inf"}ms` });
                }
                // signal držíme, čekáme na čerstvé BBO v dalším ticku (bez posunu scan markeru)
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            if (hardGate.blocked) {
                logScalpReject(symbol, hardGate.reason, { ...rejectMetricsBase, reasonCode: hardGate.code });
                st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            // Execution guardrails (spread/ATR)
            if (now < st.htf.blockedUntilBarOpenTime + CFG.htfCloseDelayMs) {
                logScalpReject(symbol, "HTF_BLOCK", rejectMetricsBase);
                return false;
            }
            // Build limit price (maker-first)
            if (isLong && limit >= st.bbo.ask) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (!isLong && limit <= st.bbo.bid) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            if (softEnabled && !isMaticX && qualityScore < qualityThreshold) {
                logScalpReject(symbol, `SOFT_SCORE ${qualityScore}<${qualityThreshold}`, { ...rejectMetricsBase, distToEmaAtr });
                st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            // SL from micro swing (L=3,R=3), fallback to ST line
            const slBuf = Math.max(st.instrument.tickSize, CFG.slBufferAtrFrac * st.ltf.atr14);
            const pivotLow = findLastPivotLow(st.ltf.candles, 3, 3);
            const pivotHigh = findLastPivotHigh(st.ltf.candles, 3, 3);
            const pivotLowPrice = pivotLow?.price;
            const pivotHighPrice = pivotHigh?.price;
            let sl = isLong
                ? (pivotLowPrice != null ? pivotLowPrice - slBuf : st.ltf.stLine - slBuf)
                : (pivotHighPrice != null ? pivotHighPrice + slBuf : st.ltf.stLine + slBuf);
            sl = roundToTick(sl, st.instrument.tickSize);
            if (isLong && sl >= limit) sl = roundToTick(st.ltf.stLine - slBuf, st.instrument.tickSize);
            if (!isLong && sl <= limit) sl = roundToTick(st.ltf.stLine + slBuf, st.instrument.tickSize);
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
            const side: "Buy" | "Sell" = isLong ? "Buy" : "Sell";

            // Risk sizing (4/8 USDT) with reservation
            const openRisk = computeOpenRiskUsd();
            const riskMultiplier = isMaticX
                ? 1
                : !softEnabled
                    ? 1
                    : qualityScore >= QUALITY_SCORE_HIGH
                        ? 1
                        : qualityScore >= QUALITY_SCORE_MID
                            ? 0.75
                            : 0.5;
            const maticXRiskPctRaw = settingsRef.current.baseRiskPerTrade || 0.005;
            const maticXRiskPct = clamp(maticXRiskPctRaw, AI_MATIC_X_RISK_PCT_MIN, AI_MATIC_X_RISK_PCT_MAX);
            const baseRiskUsd = riskCutActiveRef.current
                ? LOSS_STREAK_RISK_USD
                : isMaticX
                    ? ACCOUNT_BALANCE_USD * maticXRiskPct
                    : RISK_PER_TRADE_USD;
            const regimeRiskUsd = isRange ? Math.min(baseRiskUsd, RANGE_RISK_USD) : baseRiskUsd;
            const normalizeSide = (value: string | undefined) => (String(value).toLowerCase() === "buy" ? "Buy" : "Sell");
            const betaBucketSameSide = BETA_BUCKET.has(symbol) &&
                activePositionsRef.current.some((p) => BETA_BUCKET.has(p.symbol) && normalizeSide(p.side) === side);
            const bucketMultiplier = betaBucketSameSide ? 0.5 : 1;
            const riskTarget = Math.min(regimeRiskUsd * riskMultiplier * bucketMultiplier, Math.max(0, 8 - openRisk));
            if (riskTarget <= 0) {
                logScalpReject(symbol, `RISK_BUDGET openRisk=${openRisk.toFixed(2)} >= 8`, { ...rejectMetricsBase, distToEmaAtr });
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const qtyRaw = riskTarget / (oneR * Math.max(1e-8, st.instrument.contractValue));
            const qtyStep = roundDownToStep(qtyRaw, st.instrument.stepSize);
            const maxQty = maxQtyForSymbol(symbol);
            const currentQty = activeStats.sizes[symbol] || 0;
            const remainingQty = Number.isFinite(maxQty) ? Math.max(0, maxQty - currentQty) : Number.POSITIVE_INFINITY;
            if (Number.isFinite(maxQty) && remainingQty <= 0) {
                logScalpReject(symbol, `MAX_QTY size=${currentQty.toFixed(6)} >= ${maxQty}`, { ...rejectMetricsBase, distToEmaAtr });
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const maxQtyStep = Number.isFinite(remainingQty)
                ? roundDownToStep(remainingQty, st.instrument.stepSize)
                : qtyStep;
            const finalQty = Math.min(qtyStep, maxQtyStep);
            if (!Number.isFinite(finalQty) || finalQty < st.instrument.minQty) {
                logScalpReject(symbol, `QTY_TOO_SMALL qty=${Number.isFinite(finalQty) ? finalQty.toFixed(6) : "NaN"} min=${st.instrument.minQty}`, { ...rejectMetricsBase, distToEmaAtr });
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const reservedRiskUsd = oneR * finalQty * st.instrument.contractValue;
            if (reservedRiskUsd > 4 + 1e-6 || openRisk + reservedRiskUsd > 8 + 1e-6) {
                logScalpReject(symbol, `RISK_CAP reserved=${reservedRiskUsd.toFixed(3)} open=${openRisk.toFixed(3)}`, { ...rejectMetricsBase, distToEmaAtr });
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            const openCount = activeStats.count;
            if (openCount >= 2) {
                logScalpReject(symbol, `MAX_POSITIONS ${openCount} >= 2`, { ...rejectMetricsBase, distToEmaAtr });
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }

            const id = buildId(symbol, side, st.htf.barOpenTime, st.ltf.barOpenTime);
            const recentTs = scalpRecentIdsRef.current.get(id);
            if (recentTs && now - recentTs <= CFG.maxRecentIdWindowMs) {
                st.nextAllowedAt = now + CFG.symbolFetchGapMs;
                return true;
            }
            scalpRecentIdsRef.current.set(id, now);

            const gates: { name: string; result: "PASS" | "FAIL" }[] = isMaticX
                ? [
                    { name: "HTF_ST", result: htfLineOk ? "PASS" : "FAIL" },
                    { name: "ST1_FLIP", result: stFlip ? "PASS" : "FAIL" },
                    { name: "EMA_TOUCH", result: emaTouch ? "PASS" : "FAIL" },
                    { name: "ST1_CLOSE", result: stCloseOk ? "PASS" : "FAIL" },
                    { name: "RVOL", result: rvolOk ? "PASS" : "FAIL" },
                    { name: "MOMENTUM", result: momentumOk ? "PASS" : "FAIL" },
                    { name: "ANTI_BREAKOUT", result: antiBreakoutOk ? "PASS" : "FAIL" },
                    { name: "ATR_MIN", result: atrOk ? "PASS" : "FAIL" },
                    { name: "SMC", result: smcRequired ? (smcSignal ? "PASS" : "FAIL") : "PASS" },
                    { name: "SPREAD", result: spreadOk ? "PASS" : "FAIL" },
                ]
                : isSmcMode
                    ? [
                        { name: "SESSION", result: sessionOk ? "PASS" : "FAIL" },
                        { name: "ASIA_RANGE", result: asiaOk ? "PASS" : "FAIL" },
                        { name: "SWEEP", result: sweepOk ? "PASS" : "FAIL" },
                        { name: "CHOCH_FVG", result: chochFvgOk ? "PASS" : "FAIL" },
                    ]
                    : [
                        { name: "HTF_TREND", result: "PASS" },
                        { name: "EMA_PULLBACK", result: "PASS" },
                        { name: "MICRO_BREAK", result: "PASS" },
                        { name: "QUALITY_SCORE", result: qualityPass ? "PASS" : "FAIL" },
                    ];
            logAuditEntry("SIGNAL", symbol, "SCAN", gates, canPlaceOrders ? "TRADE" : "DENY", "SCALP_SIGNAL", { entry: limit, sl, tp }, { notional: limit * finalQty, leverage: leverageFor(symbol) });

            st.ltfLastScanBarOpenTime = st.ltf.barOpenTime;
            const extraTimeoutMs = !isMaticX && softEnabled && qualityScore > QUALITY_SCORE_HIGH ? 30_000 : 0;
            if (canPlaceOrders) {
                // Reserve risk only for actual pending entry orders
                scalpReservedRiskUsdRef.current += reservedRiskUsd;
                const entryTimeoutMs = isMaticX && CFG.entryTimeoutMs > 0 ? CFG.entryTimeoutMs : entryTimeoutMsFor(symbol, isRange);
                st.pending = {
                    stage: "READY_TO_PLACE",
                    orderLinkId: id,
                    symbol,
                    side,
                    limitPrice: limit,
                    qty: finalQty,
                    sl,
                    tp,
                    oneR,
                    reservedRiskUsd,
                    qualityScore,
                    qualityTier,
                    extraTimeoutMs,
                    entryTimeoutMs,
                    htfBarOpenTime: st.htf.barOpenTime,
                    ltfBarOpenTime: st.ltf.barOpenTime,
                    createdAt: now,
                    statusCheckAt: now + CFG.orderStatusDelayMs,
                    timeoutAt: now + entryTimeoutMs,
                };
            } else {
                logScalpReject(symbol, "BLOCKED auto mode off or missing auth token");
            }
            st.nextAllowedAt = now + CFG.symbolFetchGapMs;
            const stillEngaged = Boolean(st.pending);
            if (!stillEngaged && scalpActiveSymbolRef.current === symbol && now >= scalpSymbolLockUntilRef.current) {
                scalpActiveSymbolRef.current = null;
            }
            return true;
        };

        const tick = async () => {
            if (cancel) return;
            if (scalpBusyRef.current) return;
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
                        for (const sym of activeSymbols) {
                            const st = ensureSymbolState(sym);
                            const p = st.pending;
                            if (!p) continue;
                            if (p.stage === "READY_TO_PLACE") {
                                scalpReservedRiskUsdRef.current = Math.max(0, scalpReservedRiskUsdRef.current - (p.reservedRiskUsd || 0));
                                st.pending = undefined;
                            } else if (p.stage === "PLACED") {
                                p.timeoutAt = now;
                                p.taskReason = "SAFE_MODE";
                            }
                        }
                    }
                }

                const now = Date.now();

                const isSymbolReady = (sym: string) => {
                    const st = ensureSymbolState(sym);
                    return now >= st.nextAllowedAt && now >= st.pausedUntil;
                };

                // Urgent pending tasks always first
                let urgent: string | null = null;
                for (const sym of activeSymbols) {
                    if (scalpActiveSymbolRef.current && scalpActiveSymbolRef.current !== sym) continue;
                    const st = ensureSymbolState(sym);
                    const p = st.pending;
                    if (!p) continue;
                    const due =
                        p.stage === "READY_TO_PLACE" ||
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

                const htfDue = activeSymbols.find((sym) => {
                    if (scalpActiveSymbolRef.current && scalpActiveSymbolRef.current !== sym) return false;
                    const st = ensureSymbolState(sym);
                    if (!isSymbolReady(sym)) return false;
                    return !st.htf || st.htf.barOpenTime < expectedHtf || (st.htfConfirm && st.htfConfirm.expectedOpenTime === expectedHtf);
                });

                const ltfDue = activeSymbols.find((sym) => {
                    if (scalpActiveSymbolRef.current && scalpActiveSymbolRef.current !== sym) return false;
                    const st = ensureSymbolState(sym);
                    if (!isSymbolReady(sym)) return false;
                    return !st.ltf || st.ltf.barOpenTime < expectedLtf || (st.ltfConfirm && st.ltfConfirm.expectedOpenTime === expectedLtf);
                });

                const idx = scalpRotationIdxRef.current;
                let rotated = activeSymbols[idx % activeSymbols.length];
                scalpRotationIdxRef.current = idx + 1;
                if (scalpActiveSymbolRef.current) rotated = scalpActiveSymbolRef.current;

            const target = urgent || htfDue || ltfDue || rotated;
            await processSymbol(target, tickStarted);
        } catch (err) {
            const message = getErrorMessage(err) || "scalp tick error";
            setSystemState((p) => ({
                ...p,
                bybitStatus: "Error",
                lastError: message,
                recentErrors: [message, ...p.recentErrors].slice(0, 10),
            }));
            } finally {
                scalpBusyRef.current = false;
            }
        };

        const id = setInterval(() => void tick(), CFG.tickMs);
        void tick();
        return () => {
            cancel = true;
            clearInterval(id);
            if (symbolRefreshId) clearInterval(symbolRefreshId);
        };
    }, [mode, settings.riskMode, useTestnet, httpBase, authToken, apiBase, apiPrefix, queuedFetch, fetchOrderHistoryOnce, fetchPositionsOnce, forceClosePosition]);

    // ========== AI-MATIC-SCALP (SMC/AMD) ==========

    // Executions polling (pro rychlejší fill detection)
    useEffect(() => {
        if (!authToken) return;
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
                if (!res.ok) return;
                const json = await res.json();
                const list = json?.data?.result?.list || json?.result?.list || [];
                const cursor = json?.data?.result?.nextPageCursor || json?.result?.nextPageCursor;
                const seen = processedExecIdsRef.current;
                const allowedSymbols = new Set([...ALL_SYMBOLS, ...dynamicSymbolsRef.current]);
                const nowMs = Date.now();
                const freshMs = 5 * 60 * 1000; // show only last 5 minutes
                const items: BybitExecution[] = Array.isArray(list) ? (list as BybitExecution[]) : [];
                items.forEach((e) => {
                    const id = e.execId || e.tradeId;
                    if (!id || seen.has(id)) return;
                    if (e.symbol && !allowedSymbols.has(e.symbol)) return;
                    seen.add(id);
                    const execTs = e.execTime ? Number(e.execTime) : Date.now();
                    if (!Number.isFinite(execTs)) return;
                    const isFresh = nowMs - execTs <= freshMs;
                    if (!isFresh) return;
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
                if (cursor) executionCursorRef.current = cursor;
            } catch {
                // ignore polling errors
            }
        };
        poll();
        const id = setInterval(() => {
            if (!cancel) void poll();
        }, 5000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, apiBase, useTestnet]);

    // ========== EXECUTE TRADE (simulated + backend order) ==========
    const performTrade = async (signalId: string): Promise<boolean> => {
        // Locate signal
        const signal = pendingSignalsRef.current.find((s) => s.id === signalId);
        if (!signal) return false;

        if (dataUnavailableRef.current) {
            logAuditEntry("REJECT", signal.symbol, "DATA_FEED", [{ name: "API", result: "FAIL" }], "STOP", "Market data unavailable", {});
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        const { symbol, side } = signal.intent;
        const { sl, tp, price: intentPrice, triggerPrice: intentTrigger } = signal.intent;
        const lastPrice = currentPricesRef.current[symbol];
        const entryPrice = Number(
            intentPrice ??
            signal.intent.entry ??
            (Number.isFinite(lastPrice) ? lastPrice : NaN)
        );
        const maxOpen = settingsRef.current.maxOpenPositions ?? 2;
        const activeCount = new Set(
            activePositionsRef.current
                .filter((p) => Math.abs(Number(p.size ?? p.qty ?? 0)) > 0)
                .map((p) => p.symbol)
        ).size;
        if (activeCount >= maxOpen || activeCount >= MAX_ACTIVE_TRADES) {
            const reason = `Max open positions reached (${activeCount})`;
            addLog({ action: "REJECT", message: `Skip ${symbol}: ${reason}` });
            logAuditEntry("REJECT", symbol, "EXECUTION", [{ name: "ACTIVE_TRADES_OK", result: "FAIL" }], "DENY", reason, { entry: entryPrice });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        const isBuy = side === "buy" || side === "Buy";
        const safeEntry = Number.isFinite(entryPrice) ? entryPrice : Number.isFinite(lastPrice) ? (lastPrice as number) : 0;

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
            ? (baseEntryForRoi as number) * (1 + tpMove * (isBuy ? 1 : -1))
            : undefined;
        const roiSlPrice = Number.isFinite(baseEntryForRoi) && isRoiSymbol
            ? (baseEntryForRoi as number) * (1 - slMove * (isBuy ? 1 : -1))
            : undefined;
        const baseSl = Number.isFinite(sl) ? sl : Number.isFinite(safeEntry) ? (isBuy ? safeEntry * 0.99 : safeEntry * 1.01) : undefined;
        const finalTpRaw = Number.isFinite(roiTpPrice) ? roiTpPrice : tp;
        const finalSlRaw = Number.isFinite(roiSlPrice) ? roiSlPrice : baseSl;
        const tick = priceTickFor(symbol, safeEntry);
        let finalSl = Number.isFinite(finalSlRaw) ? roundToTick(finalSlRaw as number, tick) : undefined;
        if (Number.isFinite(finalSl)) {
            if (isBuy && finalSl >= safeEntry - tick) finalSl = roundToTick(safeEntry - tick, tick);
            if (!isBuy && finalSl <= safeEntry + tick) finalSl = roundToTick(safeEntry + tick, tick);
        }
        if (!Number.isFinite(finalSl)) {
            addLog({ action: "REJECT", message: `Skip ${symbol}: SL invalid` });
            logAuditEntry("REJECT", symbol, "EXECUTION", [{ name: "SL_SET_OK", result: "FAIL" }], "DENY", "SL invalid", { entry: safeEntry });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        const rDist = Math.abs(safeEntry - (finalSl as number));
        const tp2Raw = isBuy ? safeEntry + 2 * rDist : safeEntry - 2 * rDist;
        let tp2 = roundToTick(tp2Raw, tick);
        if (isBuy && tp2 <= safeEntry + tick) tp2 = roundToTick(safeEntry + tick, tick);
        if (!isBuy && tp2 >= safeEntry - tick) tp2 = roundToTick(safeEntry - tick, tick);
        let finalTp = Number.isFinite(finalTpRaw) ? roundToTick(finalTpRaw as number, tick) : undefined;
        if (Number.isFinite(finalTp)) {
            const invalid = isBuy ? (finalTp as number) <= safeEntry + tick : (finalTp as number) >= safeEntry - tick;
            if (invalid) finalTp = undefined;
        }
        const stopLossValue = Number(finalSl ?? safeEntry ?? 0);
        const takeProfitValue = tp2;
        const protectionTp = Number.isFinite(finalTp) ? (finalTp as number) : tp2;
        const netR = netRrrWithFees(safeEntry, stopLossValue, takeProfitValue, TAKER_FEE);
        const gatesAudit: { name: string; result: "PASS" | "FAIL" }[] = [];
        gatesAudit.push({ name: "NET_RRR", result: netR >= 1.5 ? "PASS" : "FAIL" });
        gatesAudit.push({ name: "STOP_MIN", result: rDist / safeEntry >= STOP_MIN_PCT ? "PASS" : "FAIL" });
        if (netR < 1.5) {
            logAuditEntry("REJECT", symbol, "EXECUTION", gatesAudit, "DENY", "NET_RRR < 1.5", { entry: safeEntry, sl: stopLossValue, tp: takeProfitValue }, undefined, netR);
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        // Risk engine sizing
        const normalizeSide = (value: string | undefined) => (String(value).toLowerCase() === "buy" ? "Buy" : "Sell");
        const betaBucketSameSide = BETA_BUCKET.has(symbol) &&
            activePositionsRef.current.some((p) => BETA_BUCKET.has(p.symbol) && normalizeSide(p.side) === normalizeSide(side));
        const bucketMultiplier = betaBucketSameSide ? 0.5 : 1;
        const riskBudgetUsd = (riskCutActiveRef.current ? LOSS_STREAK_RISK_USD : RISK_PER_TRADE_USD) * bucketMultiplier;
        const sizing = computePositionSizing(symbol, safeEntry, finalSl as number, riskBudgetUsd);
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
        const entryModeGate: { name: string; result: "PASS" | "FAIL" } = { name: "ENTRY_MODE_OK", result: "PASS" };
        const isAutoMode = mode === TradingMode.AUTO_ON;
        const isPaperMode = mode === TradingMode.PAPER;

        // 0.1 PORTFOLIO RISK GATE (New)
        const currentPositions = activePositionsRef.current;
        const totalCapital = portfolioState.totalCapital || ACCOUNT_BALANCE_USD;
        const maxAlloc = portfolioState.maxAllocatedCapital || (totalCapital * (settingsRef.current.maxAllocatedCapitalPercent || 1));

        // 1. Max Exposure Check (margin-based so high leverage is allowed)
        const currentMargin = currentPositions.reduce(
            (sum, p) => sum + marginFor(p.symbol, p.entryPrice, p.size ?? p.qty ?? 0),
            0
        );
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
        const netDelta = currentPositions.reduce(
            (sum, p) =>
                sum +
                (p.side === "buy" ? 1 : -1) *
                marginFor(p.symbol, p.entryPrice, p.size ?? p.qty ?? 0),
            0
        );
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
        const estReward = Math.abs(safeEntry - (Number(protectionTp) || safeEntry)) * orderQty;
        // If reward is defined and < cost * 1.5, reject
        if (protectionTp && estReward < estCost * 1.5) {
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
            if (!pendingSignalsRef.current.find((s) => s.id === signalId)) return false;

            setLifecycle(signalId, "ENTRY_SUBMITTED");

            // Remove from pending immediately to prevent infinite loop re-processing
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));

            // Calculate metrics (re-use logic or trust intent)
            const clientOrderId = signalId.substring(0, 36);

            if (isAutoMode) {
                const orderLeverage = Math.max(1, Math.min(MAX_LEVERAGE_ALLOWED, computedLeverage));
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
                    leverage: orderLeverage,
                };

                type SubmitResult = {
                    ok: boolean;
                    status: number;
                    orderId?: string | null;
                    error?: string;
                    body?: unknown;
                };
                const submitOrder = async (): Promise<SubmitResult> => {
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
                        const orderId =
                            body?.result?.orderId ||
                            body?.data?.result?.orderId ||
                            body?.data?.orderId ||
                            null;
                        return { ok: true, status, orderId, body };
                    } catch (err) {
                        return { ok: false, status: 0, error: getErrorMessage(err) || "Order exception" };
                    }
                };

                const placeOrderWithRetry = async (maxRetry: number) => {
                    let attempt = 0;
                    let last: SubmitResult | null = null;
                    while (attempt <= maxRetry) {
                        attempt += 1;
                        const res = await submitOrder();
                        if (res.ok) return res;
                        last = res;
                        if (!res.ok) {
                            const retryable = res.status === 0 || res.status >= 500 || res.status === 429;
                            logAuditEntry("ERROR", symbol, "ORDER_SUBMIT", [...gatesAudit, entryModeGate], retryable && attempt <= maxRetry ? "RETRY" : "STOP", res.error || "Order failed", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
                            if (!retryable || attempt > maxRetry) break;
                            await sleep(800 * attempt);
                        }
                    }
                    return last;
                };

                const submit = await placeOrderWithRetry(1);
                if (!submit || !submit.ok) {
                    const msg = submit && submit.error ? submit.error : "Order failed";
                    addLog({ action: "ERROR", message: msg });
                    setLifecycle(signalId, "FAILED", msg);
                    setSystemState((prev) => ({ ...prev, lastError: msg, bybitStatus: "Error" }));
                    return false;
                }

                logAuditEntry("SYSTEM", symbol, "ORDER_SUBMIT", [...gatesAudit, entryModeGate], "TRADE", "Order placed", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);

                const orderId = submit.orderId || null;

                try {
                    const fill = await waitForFill(
                        signalId,
                        symbol,
                        orderId,
                        clientOrderId,
                        useTestnet ? 45000 : 90000
                    );
                    if (fill) {
                        setLifecycle(signalId, "ENTRY_FILLED");
                        protectionTargetsRef.current[symbol] = { sl: finalSl, tp: protectionTp };
                        await sleep(PROTECTION_POST_FILL_DELAY_MS);
                        const protectionOk = await commitProtection(signalId, symbol, finalSl, protectionTp);

                        if (protectionOk) {
                            protectionVerifyRef.current[symbol] = Date.now();
                            setLifecycle(signalId, "MANAGING");
                            recordTrade(symbol, clientOrderId || orderId || signalId);
                            logAuditEntry("SYSTEM", symbol, "ORDER_FILL", [...gatesAudit, entryModeGate], "TRADE", "Order filled and protected", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
                        } else {
                            addLog({ action: "ERROR", message: `Initial protection failed for ${symbol}. Forcing close.` });
                            const posList = await fetchPositionsOnce(useTestnet ? "testnet" : "mainnet").then((r) => r.list).catch(() => []);
                            const pos = posList.find((p) => p.symbol === symbol);
                            if (pos) {
                                await forceClosePosition(pos);
                            }
                            setLifecycle(signalId, "FAILED", "Protection failed");
                            return false;
                        }
                        return true;
                    }
                } catch (err) {
                    const message = getErrorMessage(err);
                    addLog({
                        action: "ERROR",
                        message: `Fill not confirmed: ${message || "unknown"}`,
                    });
                    setLifecycle(signalId, "FAILED", message || "fill failed");
                    logAuditEntry("ERROR", symbol, "ORDER_FILL", [...gatesAudit, entryModeGate], "STOP", message || "Fill failed", { entry: price, sl: stopLossValue, tp: takeProfitValue }, { notional: newTradeNotional, leverage: computedLeverage }, netR);
                    return false;
                }
                return false;

            } else if (isPaperMode) {
                const slPrice = Number.isFinite(stopLossValue) ? (stopLossValue as number) : safeEntry;
                const tpPrice = Number.isFinite(takeProfitValue) ? (takeProfitValue as number) : safeEntry;
                const openedAt = new Date().toISOString();
                const simulated: ActivePosition = {
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
                recordTrade(symbol, signalId);
                return true;
            } else {
                addLog({ action: "SYSTEM", message: `Mode ${mode} does not execute trades.` });
                return false;
            }

        } catch (err) {
            const message = getErrorMessage(err);
            console.error("Trade exception", err);
            setLifecycle(signalId, "FAILED", message);
            addLog({ action: "ERROR", message: `Trade exception: ${message}` });
            return false;
        } finally {
            executionLocksRef.current.delete(symbol);
        }
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
        const canAutoExecute =
            modeRef.current === TradingMode.AUTO_ON ||
            modeRef.current === TradingMode.PAPER;
        if (!canAutoExecute) return;
        if (!pendingSignals.length) return;

        const sig = pendingSignals[0];
        if (settingsRef.current.requireConfirmationInAuto && sig.risk < 0.65)
            return;

        void executeTrade(sig.id);
    }, [pendingSignals]);



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

    const manualClosePosition = useCallback(
        async (pos: ActivePosition) => {
            if (!authToken) {
                addLog({ action: "ERROR", message: "Manual close failed: missing auth token" });
                return false;
            }
            const qtyRaw = Math.abs(Number(pos.size ?? pos.qty ?? 0));
            if (!Number.isFinite(qtyRaw) || qtyRaw <= 0) {
                addLog({ action: "ERROR", message: `Manual close failed: invalid qty ${pos.symbol}` });
                return false;
            }
            const step = qtyStepForSymbol(pos.symbol);
            const qty = roundDownToStep(qtyRaw, step);
            if (!Number.isFinite(qty) || qty < step) {
                addLog({ action: "ERROR", message: `Manual close failed: qty too small ${pos.symbol}` });
                return false;
            }
            const side = String(pos.side ?? "").toLowerCase() === "buy" ? "Sell" : "Buy";
            const ok = await placeReduceOnlyExit(pos.symbol, side, qty, "MANUAL");
            addLog({
                action: ok ? "SYSTEM" : "ERROR",
                message: ok ? `MANUAL_CLOSE ${pos.symbol} qty=${qty}` : `Manual close failed ${pos.symbol}`,
            });
            return ok;
        },
        [authToken, placeReduceOnlyExit]
    );

    const closePosition = (id: string) => {
        setActivePositions((prev) => {
            const target = prev.find((p) => p.id === id);
            if (!target) return prev;

            const currentPrice = currentPrices[target.symbol] ?? target.entryPrice;
            const dir = target.side === "buy" ? 1 : -1;
            const pnl = (currentPrice - target.entryPrice) * dir * target.size;
            const freedNotional = marginFor(target.symbol, target.entryPrice, target.size);

            realizedPnlRef.current += pnl;
            registerOutcome(target.symbol, pnl);

            const record: AssetPnlRecord = {
                symbol: target.symbol,
                pnl,
                timestamp: new Date().toISOString(),
                note: `Closed at ${currentPrice.toFixed(4)} | size ${target.size.toFixed(4)}`,
            };
            if (authToken) {
                setAssetPnlHistory(() => addPnlRecord(record));
            }
            setEntryHistory(() =>
                addEntryToHistory({
                    id: `${target.id}-closed`,
                    symbol: target.symbol,
                    side: target.side.toLowerCase() as "buy" | "sell", // FIX: strict lower case
                    entryPrice: target.entryPrice,
                    sl: target.sl,
                    tp: target.tp,
                    size: target.size,
                    createdAt: new Date().toISOString(),
                    settingsNote: `Closed at ${currentPrice.toFixed(4)} | PnL ${pnl.toFixed(2)} USDT`,
                    settingsSnapshot: snapshotSettings(settingsRef.current),
                })
            );

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
        const incomingMode = newS.riskMode ?? settingsRef.current.riskMode;
        const basePreset = presetFor(incomingMode);

        // If risk mode changes, snap to the preset for that mode (no mix of previous settings).
        // Otherwise merge incremental updates on top of the current state.
        const patched: AISettings =
            incomingMode !== settingsRef.current.riskMode
                ? { ...basePreset, riskMode: incomingMode }
                : { ...settingsRef.current, ...newS, riskMode: incomingMode };
        // Hard clamp max open positions
        const normalized: AISettings = { ...patched, maxOpenPositions: Math.min(2, patched.maxOpenPositions ?? 2) };

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
            };
        });
    };

    const removeEntryHistoryItem = (id: string) => {
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
        refreshTestnetOrders: fetchOrders,
        mainnetOrders: testnetOrders, // Unify state: always return current orders
        mainnetTrades: testnetTrades,
        mainnetError: ordersError,
        refreshMainnetOrders: fetchOrders,
        refreshMainnetTrades: fetchTrades,
        assetPnlHistory,
        removeEntryHistoryItem,
        resetPnlHistory,
        scanDiagnostics,
        manualClosePosition,
        dynamicSymbols,
    };
};

// ========= API TYPE EXPORT ==========
export type TradingBotApi = ReturnType<typeof useTradingBot>;
