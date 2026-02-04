// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi";
import { EntryType, Profile, Symbol } from "../api/types";
import { getApiBase } from "../engine/networkConfig";
import { startPriceFeed } from "../engine/priceFeed";
import { evaluateStrategyForSymbol, resampleCandles } from "../engine/botEngine";
import {
  evaluateAiMaticXStrategyForSymbol,
  type AiMaticXContext,
} from "../engine/aiMaticXStrategy";
import {
  decideCombinedEntry,
  type DependencyFlags as TreeDeps,
  type MarketSignals as TreeSignals,
} from "../engine/combinedEntryStrategy";
import { evaluateHTFMultiTrend } from "../engine/htfTrendFilter";
import { computeEma, computeRsi, findPivotsHigh, findPivotsLow, computeATR } from "../engine/ta";
import { CandlestickAnalyzer } from "../engine/universal-candlestick-analyzer";
import { computeMarketProfile, type MarketProfile } from "../engine/marketProfile";
import type { PriceFeedDecision } from "../engine/priceFeed";
import type { BotConfig, Candle } from "../engine/botEngine";
import { TradingMode } from "../types";
import { evaluateAiMaticProStrategyForSymbol } from "../engine/aiMaticProStrategy";
import { updateOpenInterest } from "../engine/orderflow";
import {
  SUPPORTED_SYMBOLS,
  filterSupportedSymbols,
} from "../constants/symbols";
import type {
  AISettings,
  ActivePosition as BaseActivePosition,
  LogEntry,
  PortfolioState,
  SystemState,
  TestnetOrder,
  TestnetTrade,
} from "../types";
import {
  loadPnlHistory,
  mergePnlRecords,
  resetPnlHistoryMap,
} from "../lib/pnlHistory";
import type { AssetPnlMap } from "../lib/pnlHistory";

export type ActivePosition = BaseActivePosition & { isBreakeven?: boolean };

const SETTINGS_STORAGE_KEY = "ai-matic-settings";
const LOG_DEDUPE_WINDOW_MS = 1500;
const FEED_AGE_OK_MS = 60_000;
const MIN_POSITION_NOTIONAL_USD = 100;
const MAX_POSITION_NOTIONAL_USD = 10000;
const ORDER_VALUE_BY_SYMBOL: Record<Symbol, number> = {
  BTCUSDT: 10000,
  ETHUSDT: 10000,
  SOLUSDT: 10000,
  ADAUSDT: 7500,
  XRPUSDT: 7500,
  XMRUSDT: 2500,
  DOGEUSDT: 7500,
  LINKUSDT: 5000,
  MELANIAUSDT: 2000,
  XPLUSDT: 7500,
  HYPEUSDT: 7500,
  FARTCOINUSDT: 7500,
};
const MAJOR_SYMBOLS = new Set<Symbol>(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
const CORE_V2_RISK_PCT: Record<AISettings["riskMode"], number> = {
  "ai-matic": 0.004,
  "ai-matic-x": 0.003,
  "ai-matic-scalp": 0.0025,
  "ai-matic-tree": 0.003,
  "ai-matic-pro": 0.003,
};
const CORE_V2_COOLDOWN_MS: Record<AISettings["riskMode"], number> = {
  "ai-matic": 0,
  "ai-matic-x": 0,
  "ai-matic-scalp": 0,
  "ai-matic-tree": 0,
  "ai-matic-pro": 0,
};
const CORE_V2_VOLUME_PCTL: Record<AISettings["riskMode"], number> = {
  "ai-matic": 60,
  "ai-matic-x": 70,
  "ai-matic-scalp": 50,
  "ai-matic-tree": 65,
  "ai-matic-pro": 65,
};
const CORE_V2_SCORE_GATE: Record<
  AISettings["riskMode"],
  { major: number; alt: number }
> = {
  "ai-matic": { major: 11, alt: 12 },
  "ai-matic-x": { major: 12, alt: 13 },
  "ai-matic-scalp": { major: 10, alt: 99 },
  "ai-matic-tree": { major: 11, alt: 13 },
  "ai-matic-pro": { major: 10, alt: 10 },
};
const MIN_CHECKLIST_PASS = 8;
const REENTRY_COOLDOWN_MS = 15_000;
const SIGNAL_LOG_THROTTLE_MS = 10_000;
const SKIP_LOG_THROTTLE_MS = 10_000;
const INTENT_COOLDOWN_MS = 8_000;
const ENTRY_ORDER_LOCK_MS = 20_000;
const CORE_V2_EMA_SEP1_MIN = 0.18;
const CORE_V2_EMA_SEP2_MIN = 0.12;
const CORE_V2_ATR_MIN_PCT_MAJOR = 0.0012;
const CORE_V2_ATR_MIN_PCT_ALT = 0.0018;
const CORE_V2_HTF_BUFFER_PCT = 0.001;
const CORE_V2_NOTIONAL_CAP_PCT = 0.01;
const CORE_V2_BBO_AGE_BY_SYMBOL: Partial<Record<Symbol, number>> = {
  BTCUSDT: 800,
  ETHUSDT: 800,
  SOLUSDT: 700,
};
const CORE_V2_BBO_AGE_DEFAULT_MS = 1000;
const SCALP_PRIMARY_GATE =
  "Primary Timeframe: 15m for trend, 1m for entry.";
const SCALP_ENTRY_GATE =
  "Entry Logic: EMA Cross (last <= 6 bars) + RSI Divergence + Volume Spike.";
const SCALP_EXIT_GATE =
  "Exit Logic: Trailing Stop (ATR 2.5x) or Fixed TP (1.5 RRR).";
const SCALP_DRIFT_GATE = "HTF Drift Guard (15m)";
const SCALP_FAKE_MOMENTUM_GATE = "Fake Momentum Filter (1m)";
const SCALP_PROTECTED_ENTRY_GATE = "Protected Entry Mode";
const MAX_OPEN_POSITIONS_CAP = 10000;
const ORDERS_PER_POSITION = 5;
const MAX_OPEN_ORDERS_CAP = MAX_OPEN_POSITIONS_CAP * ORDERS_PER_POSITION;
const TS_VERIFY_INTERVAL_MS = 180_000;
const AUTO_CANCEL_ENTRY_ORDERS = false;
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
const SCALP_DIV_LOOKBACK = 20;
const SCALP_PIVOT_MIN_GAP = 5;
const SCALP_PIVOT_MAX_GAP = 20;
const SCALP_VOL_LEN = 20;
const SCALP_VOL_SPIKE_MULT = 1.8;
const SCALP_VOL_Z_MIN = 2.0;
const SCALP_RANGE_SMA_LEN = 20;
const SCALP_RANGE_EXP_MULT = 1.8;
const SCALP_TREND_MIN_SPREAD = 0.0015;
const SCALP_OVERLAP_RATIO = 0.6;
const SCALP_OVERLAP_BARS = 4;
const SCALP_COOLDOWN_MS = 5 * 60_000;
const SCALP_RISK_OFF_MULT = 0.25;
const SCALP_ATR_MULT_INITIAL = 1.3;
const SCALP_MAX_LOSSES_IN_ROW = 2;
const SCALP_MAX_DAILY_LOSS_R = -2.0;
const SCALP_M15_EMA_COMPRESSION_ATR = 0.35;
const SCALP_M15_EMA_COMPRESSION_SOFT_ATR = 0.55;
const SCALP_M15_WICK_RATIO = 0.6;
const SCALP_M15_WICK_MIN_COUNT = 2;
const SCALP_M15_WICK_MIN_COUNT_SOFT = 1;
const SCALP_M15_IMPULSE_LOOKBACK = 8;
const SCALP_FAKE_RANGE_LOOKBACK = 10;
const SCALP_VOLUME_SPIKE_LOOKBACK = 20;
const SCALP_RANGE_EXP_ATR = 1.4;
const SCALP_TIME_DECAY_MAX_BARS = 8;
const SCALP_RSI_NEUTRAL_LOW = 45;
const SCALP_RSI_NEUTRAL_HIGH = 55;
const SCALP_VOLUME_TREND_LOOKBACK = 3;
const SCALP_PROTECTED_RISK_MULT = 0.5;
const SCALP_PROTECTED_SL_ATR_BUFFER = 0.3;
const SCALP_SL_ATR_BUFFER = 0.3;
const SCALP_TRAIL_TIGHTEN_ATR = 1.5;
const SCALP_EXIT_TRAIL_ATR = 2.5;
const SCALP_HTF_NEAR_ATR = 0.6;
const NONSCALP_PARTIAL_TAKE_R = 1.0;
const NONSCALP_PARTIAL_FRACTION = 0.35;
const NONSCALP_PARTIAL_COOLDOWN_MS = 60_000;
const CHEAT_LIMIT_WAIT_WINDOWS_MIN = {
  SCALP: { min: 5, max: 10 },
  INTRADAY: { min: 15, max: 30 },
  SWING: { min: 60, max: 180 },
} as const;
const CHEAT_LIMIT_RUNAWAY_BPS = 30;
const CHEAT_LIMIT_MIN_RRR = 1;
const TREE_SCALP_TRAIL_PCT = 0.006;
const AI_MATIC_ENTRY_FACTOR_MIN = 3;
const AI_MATIC_CHECKLIST_MIN = 4;
const AI_MATIC_EMA_CROSS_LOOKBACK = 6;
const AI_MATIC_POI_DISTANCE_PCT = 0.0015;
const AI_MATIC_SL_ATR_BUFFER = 0.3;
const AI_MATIC_TRAIL_ATR_MULT = 1.5;
const AI_MATIC_TRAIL_PCT = 0.004;
const AI_MATIC_MIN_RR = 1.2;
const AI_MATIC_TRAIL_PROTECT_R = 0.5;
const AI_MATIC_LIQ_SWEEP_LOOKBACK = 15;
const AI_MATIC_LIQ_SWEEP_ATR_MULT = 0.5;
const AI_MATIC_LIQ_SWEEP_VOL_MULT = 1.0;
const AI_MATIC_BREAK_RETEST_LOOKBACK = 6;

const DEFAULT_SETTINGS: AISettings = {
  riskMode: "ai-matic",
  trendGateMode: "adaptive",
  pauseOnHighVolatility: false,
  avoidLowLiquidity: false,
  useTrendFollowing: true,
  smcScalpMode: true,
  useLiquiditySweeps: false,
  strategyCheatSheetEnabled: false,
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

function loadStoredSettings(): AISettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const merged = { ...DEFAULT_SETTINGS, ...parsed } as AISettings;
    if (
      merged.trendGateMode !== "adaptive" &&
      merged.trendGateMode !== "follow" &&
      merged.trendGateMode !== "reverse"
    ) {
      merged.trendGateMode = "adaptive";
    }
    if (typeof merged.autoRefreshEnabled !== "boolean") {
      merged.autoRefreshEnabled = DEFAULT_SETTINGS.autoRefreshEnabled;
    }
    if (!Number.isFinite(merged.autoRefreshMinutes)) {
      merged.autoRefreshMinutes = DEFAULT_SETTINGS.autoRefreshMinutes;
    } else {
      merged.autoRefreshMinutes = Math.max(
        1,
        Math.round(merged.autoRefreshMinutes)
      );
    }
    if (!Number.isFinite(merged.maxOpenPositions)) {
      merged.maxOpenPositions = DEFAULT_SETTINGS.maxOpenPositions;
    } else {
      merged.maxOpenPositions = Math.min(
        MAX_OPEN_POSITIONS_CAP,
        Math.max(0, Math.round(merged.maxOpenPositions))
      );
    }
    if (!Number.isFinite(merged.maxOpenOrders)) {
      merged.maxOpenOrders = DEFAULT_SETTINGS.maxOpenOrders;
    } else {
      merged.maxOpenOrders = Math.min(
        MAX_OPEN_ORDERS_CAP,
        Math.max(0, Math.round(merged.maxOpenOrders))
      );
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
  } catch {
    return null;
  }
}

function persistSettings(settings: AISettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

type CheatLimitMeta = {
  intentId: string;
  symbol: string;
  side: "Buy" | "Sell";
  entryPrice: number;
  slPrice?: number;
  tpPrice?: number;
  createdAt: number;
  mode?: "SCALP" | "INTRADAY" | "SWING" | null;
  timeframeMin?: number | null;
};

function resolveCheatLimitWindowMs(
  mode?: CheatLimitMeta["mode"] | null,
  timeframeMin?: number | null
) {
  if (mode && mode in CHEAT_LIMIT_WAIT_WINDOWS_MIN) {
    const window = CHEAT_LIMIT_WAIT_WINDOWS_MIN[mode];
    return {
      minMs: window.min * 60_000,
      maxMs: window.max * 60_000,
      label: `${window.min}–${window.max}m`,
    };
  }
  if (Number.isFinite(timeframeMin) && (timeframeMin as number) > 0) {
    const min = Math.max(1, Math.round((timeframeMin as number) * 2));
    const max = Math.max(min, Math.round((timeframeMin as number) * 4));
    return {
      minMs: min * 60_000,
      maxMs: max * 60_000,
      label: `${min}–${max}m`,
    };
  }
  return null;
}

function resolveOrderNotional(symbol: Symbol) {
  const value = ORDER_VALUE_BY_SYMBOL[symbol];
  if (Number.isFinite(value) && value > 0) return value;
  return MIN_POSITION_NOTIONAL_USD;
}

type EmaTrendFrame = {
  timeframeMin: number;
  direction: "bull" | "bear" | "none";
  ema: number;
  close: number;
  touched: boolean;
  confirmed: boolean;
};

type EmaTrendResult = {
  consensus: "bull" | "bear" | "none";
  alignedCount: number;
  byTimeframe: EmaTrendFrame[];
  tags: string[];
};

function evaluateEmaMultiTrend(
  candles: Candle[],
  opts?: {
    timeframesMin?: number[];
    emaPeriod?: number;
    touchLookback?: number;
    confirmBars?: number;
  }
): EmaTrendResult {
  const timeframes = opts?.timeframesMin ?? EMA_TREND_TIMEFRAMES_MIN;
  const emaPeriod = opts?.emaPeriod ?? EMA_TREND_PERIOD;
  const touchLookback = Math.max(1, opts?.touchLookback ?? EMA_TREND_TOUCH_LOOKBACK);
  const confirmBars = Math.max(1, opts?.confirmBars ?? EMA_TREND_CONFIRM_BARS);
  const byTimeframe: EmaTrendFrame[] = timeframes.map((tf) => {
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
    const direction =
      close > emaNow ? "bull" : close < emaNow ? "bear" : "none";
    let touched = false;
    const touchStart = Math.max(0, sampled.length - touchLookback);
    for (let i = touchStart; i < sampled.length; i++) {
      const candle = sampled[i];
      const emaAt = emaArr[i];
      if (!candle || !Number.isFinite(emaAt)) continue;
      if (candle.low <= emaAt && candle.high >= emaAt) {
        touched = true;
        break;
      }
    }
    let confirmed = true;
    if (touched) {
      if (direction === "none") {
        confirmed = false;
      } else {
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
  const consensus =
    bull === timeframes.length
      ? "bull"
      : bear === timeframes.length
        ? "bear"
        : "none";
  const alignedCount = Math.max(bull, bear);
  const tags: string[] = [];
  if (consensus !== "none") tags.push(`ALIGN_${consensus.toUpperCase()}`);
  if (byTimeframe.some((t) => t.touched && !t.confirmed)) {
    tags.push("TOUCH_UNCONFIRMED");
  }
  return { consensus, alignedCount, byTimeframe, tags };
}

type AiMaticPoi = {
  type: string;
  direction: string;
  high: number;
  low: number;
  time: number;
  mitigated?: boolean;
  priority?: number;
  touches?: number;
};

type AiMaticPatterns = {
  pinbarBull: boolean;
  pinbarBear: boolean;
  engulfBull: boolean;
  engulfBear: boolean;
  insideBar: boolean;
  trapBull: boolean;
  trapBear: boolean;
};

type AiMaticEmaFlags = {
  bullOk: boolean;
  bearOk: boolean;
  crossRecent: boolean;
  ema8: number;
  ema21: number;
  ema50: number;
  close: number;
};

type StructureState = {
  structureTrend: "BULL" | "BEAR" | "RANGE";
  lastHighType: "HH" | "LH" | "NONE";
  lastLowType: "HL" | "LL" | "NONE";
  bosUp: boolean;
  bosDown: boolean;
  chochUp: boolean;
  chochDown: boolean;
  lastHigh?: number;
  lastLow?: number;
};

type AiMaticContext = {
  htf: {
    direction: "bull" | "bear" | "none";
    adx: number;
    phase: "ACCUMULATION" | "DISTRIBUTION" | "MANIPULATION" | "TREND";
    structureTrend: "BULL" | "BEAR" | "RANGE";
    lastHighType: "HH" | "LH" | "NONE";
    lastLowType: "HL" | "LL" | "NONE";
    bosUp: boolean;
    bosDown: boolean;
    chochUp: boolean;
    chochDown: boolean;
    sweepHigh: boolean;
    sweepLow: boolean;
    volumeRising: boolean;
    pivotHigh?: number;
    pivotLow?: number;
    pois: AiMaticPoi[];
    poiReactionBull: boolean;
    poiReactionBear: boolean;
  };
  mtf: {
    sweepHigh: boolean;
    sweepLow: boolean;
    profile: MarketProfile | null;
    pocNear: boolean;
    lvnRejectionBull: boolean;
    lvnRejectionBear: boolean;
    structureTrend: "BULL" | "BEAR" | "RANGE";
    lastHighType: "HH" | "LH" | "NONE";
    lastLowType: "HL" | "LL" | "NONE";
    bosUp: boolean;
    bosDown: boolean;
    chochUp: boolean;
    chochDown: boolean;
    pivotHigh?: number;
    pivotLow?: number;
    pois: AiMaticPoi[];
    poiReactionBull: boolean;
    poiReactionBear: boolean;
  };
  ltf: {
    patterns: AiMaticPatterns;
    bosUp: boolean;
    bosDown: boolean;
    chochUp: boolean;
    chochDown: boolean;
    breakRetestUp: boolean;
    breakRetestDown: boolean;
    fakeoutHigh: boolean;
    fakeoutLow: boolean;
    ema: AiMaticEmaFlags;
    volumeReaction: boolean;
    structureTrend: "BULL" | "BEAR" | "RANGE";
    lastHighType: "HH" | "LH" | "NONE";
    lastLowType: "HL" | "LL" | "NONE";
  };
};

const toAnalyzerCandles = (candles: Candle[]) =>
  candles.map((c, idx) => ({
    time: Number.isFinite(c.openTime) ? (c.openTime as number) : idx * 60_000,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

const resolveAiMaticHtfDirection = (
  decision: PriceFeedDecision | null | undefined,
  core?: CoreV2Metrics
) => {
  const consensus = String((decision as any)?.htfTrend?.consensus ?? "").toLowerCase();
  if (consensus === "bull" || consensus === "bear") return consensus;
  const bias = core?.htfBias ?? "NONE";
  if (bias === "BULL") return "bull";
  if (bias === "BEAR") return "bear";
  const trendRaw = String((decision as any)?.trend ?? "").toLowerCase();
  if (trendRaw === "bull" || trendRaw === "bear") return trendRaw;
  return "none";
};

const resolveRecentCross = (
  fast: number[],
  slow: number[],
  lookback: number
) => {
  const size = Math.min(fast.length, slow.length);
  if (size < 3) return false;
  const span = Math.min(size - 1, Math.max(2, lookback));
  let prev = Math.sign(fast[size - span - 1] - slow[size - span - 1]);
  for (let i = size - span; i < size; i++) {
    const next = Math.sign(fast[i] - slow[i]);
    if (next !== 0 && prev !== 0 && next !== prev) return true;
    if (next !== 0) prev = next;
  }
  return false;
};

const resolveAiMaticEmaFlags = (candles: Candle[]): AiMaticEmaFlags => {
  const closes = candles.map((c) => c.close);
  const ema8Arr = computeEma(closes, 8);
  const ema21Arr = computeEma(closes, 21);
  const ema50Arr = computeEma(closes, 50);
  const ema8 = ema8Arr[ema8Arr.length - 1] ?? Number.NaN;
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? Number.NaN;
  const ema50 = ema50Arr[ema50Arr.length - 1] ?? Number.NaN;
  const close = closes[closes.length - 1] ?? Number.NaN;
  const bullOk =
    Number.isFinite(close) &&
    close > ema8 &&
    ema8 > ema21 &&
    ema21 > ema50;
  const bearOk =
    Number.isFinite(close) &&
    close < ema8 &&
    ema8 < ema21 &&
    ema21 < ema50;
  const crossRecent =
    resolveRecentCross(ema8Arr, ema21Arr, AI_MATIC_EMA_CROSS_LOOKBACK) ||
    resolveRecentCross(ema21Arr, ema50Arr, AI_MATIC_EMA_CROSS_LOOKBACK);
  return { bullOk, bearOk, crossRecent, ema8, ema21, ema50, close };
};

const resolveAiMaticPivots = (candles: Candle[], lookback = 2) => {
  if (!candles.length) return { lastHigh: undefined, lastLow: undefined };
  const highs = findPivotsHigh(candles, lookback, lookback);
  const lows = findPivotsLow(candles, lookback, lookback);
  const lastHigh = highs[highs.length - 1]?.price;
  const lastLow = lows[lows.length - 1]?.price;
  return { lastHigh, lastLow };
};

const resolveStructureState = (
  candles: Candle[],
  lookback = 2
): StructureState => {
  const highs = findPivotsHigh(candles, lookback, lookback);
  const lows = findPivotsLow(candles, lookback, lookback);
  const lastHigh = highs[highs.length - 1]?.price;
  const prevHigh = highs[highs.length - 2]?.price;
  const lastLow = lows[lows.length - 1]?.price;
  const prevLow = lows[lows.length - 2]?.price;
  const lastHighType =
    Number.isFinite(lastHigh) && Number.isFinite(prevHigh)
      ? lastHigh! > prevHigh!
        ? "HH"
        : lastHigh! < prevHigh!
          ? "LH"
          : "NONE"
      : "NONE";
  const lastLowType =
    Number.isFinite(lastLow) && Number.isFinite(prevLow)
      ? lastLow! > prevLow!
        ? "HL"
        : lastLow! < prevLow!
          ? "LL"
          : "NONE"
      : "NONE";
  const structureTrend =
    lastHighType === "HH" && lastLowType === "HL"
      ? "BULL"
      : lastHighType === "LH" && lastLowType === "LL"
        ? "BEAR"
        : "RANGE";
  const lastClose = candles[candles.length - 1]?.close ?? Number.NaN;
  const bosUp =
    structureTrend === "BULL" &&
    Number.isFinite(lastHigh) &&
    Number.isFinite(lastClose) &&
    lastClose > (lastHigh as number);
  const bosDown =
    structureTrend === "BEAR" &&
    Number.isFinite(lastLow) &&
    Number.isFinite(lastClose) &&
    lastClose < (lastLow as number);
  const chochDown =
    structureTrend === "BULL" &&
    Number.isFinite(lastLow) &&
    Number.isFinite(lastClose) &&
    lastClose < (lastLow as number);
  const chochUp =
    structureTrend === "BEAR" &&
    Number.isFinite(lastHigh) &&
    Number.isFinite(lastClose) &&
    lastClose > (lastHigh as number);
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

const resolveAiMaticPatterns = (candles: Candle[]): AiMaticPatterns => {
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
  const engulfBull =
    curr.close > curr.open &&
    prev.close < prev.open &&
    currBodyHigh >= prevBodyHigh &&
    currBodyLow <= prevBodyLow;
  const engulfBear =
    curr.close < curr.open &&
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

const resolveAiMaticBreakRetest = (
  candles: Candle[],
  level: number | undefined,
  dir: "bull" | "bear"
) => {
  if (!Number.isFinite(level) || candles.length < 3) return false;
  const recent = candles.slice(-AI_MATIC_BREAK_RETEST_LOOKBACK - 1, -1);
  const broke = recent.some((c) =>
    dir === "bull" ? c.close > (level as number) : c.close < (level as number)
  );
  if (!broke) return false;
  const last = candles[candles.length - 1];
  const retest =
    last.low <= (level as number) && last.high >= (level as number);
  const closeOk =
    dir === "bull" ? last.close >= (level as number) : last.close <= (level as number);
  return retest && closeOk;
};

const resolvePoiReaction = (
  pois: AiMaticPoi[],
  price: number,
  candle: Candle | undefined,
  dir: "bull" | "bear"
) => {
  if (!Number.isFinite(price) || !candle || !pois.length) return false;
  const closeOk = dir === "bull" ? candle.close >= candle.open : candle.close <= candle.open;
  if (!closeOk) return false;
  return pois.some((poi) => {
    const poiDir = String(poi.direction ?? "").toLowerCase();
    const dirOk =
      dir === "bull"
        ? poiDir === "bullish" || poiDir === "bull"
        : poiDir === "bearish" || poiDir === "bear";
    if (!dirOk) return false;
    return price >= poi.low && price <= poi.high;
  });
};

const resolveLvnRejection = (
  profile: MarketProfile | null,
  candle: Candle | undefined
) => {
  if (!profile || !candle || !Array.isArray(profile.lvn)) {
    return { bull: false, bear: false };
  }
  const price = candle.close;
  const tolerance = price * AI_MATIC_POI_DISTANCE_PCT;
  const touched = profile.lvn.some((lvn) =>
    Math.abs(price - lvn) <= tolerance
  );
  if (!touched) return { bull: false, bear: false };
  return {
    bull: candle.close >= candle.open,
    bear: candle.close <= candle.open,
  };
};

const resolveVolumeRising = (candles: Candle[], lookback = 8) => {
  if (candles.length < lookback * 2) return false;
  const recent = candles.slice(-lookback);
  const prev = candles.slice(-lookback * 2, -lookback);
  const avg = (slice: Candle[]) =>
    slice.reduce((s, c) => s + (c.volume ?? 0), 0) / Math.max(1, slice.length);
  const recentAvg = avg(recent);
  const prevAvg = avg(prev);
  return Number.isFinite(recentAvg) && Number.isFinite(prevAvg) && recentAvg > prevAvg * 1.1;
};

const resolveLiquiditySweep = (candles: Candle[]) => {
  if (candles.length < AI_MATIC_LIQ_SWEEP_LOOKBACK + 2) {
    return { sweepHigh: false, sweepLow: false };
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
  const volSma =
    vols.slice(-volSmaWindow).reduce((a, b) => a + b, 0) /
    Math.max(1, volSmaWindow);
  const volOk = (last.volume ?? 0) > AI_MATIC_LIQ_SWEEP_VOL_MULT * volSma;
  const sweptHigh =
    last.high > swingHigh + AI_MATIC_LIQ_SWEEP_ATR_MULT * atr &&
    last.close < swingHigh;
  const sweptLow =
    last.low < swingLow - AI_MATIC_LIQ_SWEEP_ATR_MULT * atr &&
    last.close > swingLow;
  return {
    sweepHigh: Boolean(volOk && sweptHigh),
    sweepLow: Boolean(volOk && sweptLow),
  };
};

const resolveAiMaticPhase = (args: {
  trend: string;
  adx: number;
  sweepHigh: boolean;
  sweepLow: boolean;
  volumeRising: boolean;
  profile: MarketProfile | null;
  price: number;
  volumeSpike: boolean;
}) => {
  const trend = String(args.trend ?? "").toLowerCase();
  const lowAdx = Number.isFinite(args.adx) && args.adx < 20;
  const rangeLike = trend === "range" || lowAdx;
  const poc = args.profile?.poc ?? Number.NaN;
  const vah = args.profile?.vah ?? Number.NaN;
  const val = args.profile?.val ?? Number.NaN;
  if (
    rangeLike &&
    args.sweepLow &&
    args.volumeRising &&
    Number.isFinite(poc) &&
    args.price > poc
  ) {
    return "ACCUMULATION";
  }
  if (
    rangeLike &&
    args.sweepHigh &&
    args.volumeRising &&
    Number.isFinite(poc) &&
    args.price < poc
  ) {
    return "DISTRIBUTION";
  }
  if (
    args.volumeSpike &&
    ((args.sweepLow && trend === "bear") || (args.sweepHigh && trend === "bull"))
  ) {
    return "MANIPULATION";
  }
  if (
    rangeLike &&
    args.sweepHigh &&
    args.volumeRising &&
    Number.isFinite(vah) &&
    args.price < vah
  ) {
    return "DISTRIBUTION";
  }
  if (
    rangeLike &&
    args.sweepLow &&
    args.volumeRising &&
    Number.isFinite(val) &&
    args.price > val
  ) {
    return "ACCUMULATION";
  }
  return "TREND";
};

const buildAiMaticContext = (
  candles: Candle[],
  decision: PriceFeedDecision | null | undefined,
  core?: CoreV2Metrics
): AiMaticContext | null => {
  const htf = resampleCandles(candles, 60);
  const mtf = resampleCandles(candles, 15);
  const ltf = resampleCandles(candles, 5);
  if (!htf.length || !mtf.length || !ltf.length) return null;
  const htfPois = new CandlestickAnalyzer(toAnalyzerCandles(htf)).getPointsOfInterest() as AiMaticPoi[];
  const mtfPois = new CandlestickAnalyzer(toAnalyzerCandles(mtf)).getPointsOfInterest() as AiMaticPoi[];
  const profile = computeMarketProfile({ candles: mtf });
  const ltfLast = ltf[ltf.length - 1];
  const htfStructure = resolveStructureState(htf);
  const mtfStructure = resolveStructureState(mtf);
  const ltfStructure = resolveStructureState(ltf);
  const emaFlags = resolveAiMaticEmaFlags(ltf);
  const patterns = resolveAiMaticPatterns(ltf);
  const htfSweep = resolveLiquiditySweep(htf);
  const mtfSweep = resolveLiquiditySweep(mtf);
  const htfDir = resolveAiMaticHtfDirection(decision, core);
  const bosUp = ltfStructure.bosUp;
  const bosDown = ltfStructure.bosDown;
  const breakRetestUp = resolveAiMaticBreakRetest(
    ltf,
    ltfStructure.lastHigh,
    "bull"
  );
  const breakRetestDown = resolveAiMaticBreakRetest(
    ltf,
    ltfStructure.lastLow,
    "bear"
  );
  const ltfVolumeReaction =
    Boolean(core?.volumeSpike) ||
    (Number.isFinite(core?.volumeCurrent) &&
      Number.isFinite(core?.volumeP60) &&
      core!.volumeCurrent >= core!.volumeP60);
  const htfAdx = toNumber((decision as any)?.trendAdx);
  const htfVolumeRising = resolveVolumeRising(htf);
  const price = Number.isFinite(ltfLast?.close) ? ltfLast.close : Number.NaN;
  const pocNear =
    profile &&
    Number.isFinite(price) &&
    Number.isFinite(profile.poc) &&
    Math.abs(price - profile.poc) <= price * AI_MATIC_POI_DISTANCE_PCT;
  const lvnRejection = resolveLvnRejection(profile, ltfLast);
  const poiReactionBull = resolvePoiReaction(htfPois, price, ltfLast, "bull");
  const poiReactionBear = resolvePoiReaction(htfPois, price, ltfLast, "bear");
  const mtfPoiReactionBull = resolvePoiReaction(mtfPois, price, ltfLast, "bull");
  const mtfPoiReactionBear = resolvePoiReaction(mtfPois, price, ltfLast, "bear");
  const phase = resolveAiMaticPhase({
    trend: String((decision as any)?.trend ?? ""),
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
      sweepHigh: htfSweep.sweepHigh,
      sweepLow: htfSweep.sweepLow,
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
      profile,
      pocNear: Boolean(pocNear),
      lvnRejectionBull: lvnRejection.bull,
      lvnRejectionBear: lvnRejection.bear,
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
      ema: emaFlags,
      volumeReaction: ltfVolumeReaction,
      structureTrend: ltfStructure.structureTrend,
      lastHighType: ltfStructure.lastHighType,
      lastLowType: ltfStructure.lastLowType,
    },
  };
};

const minFinite = (...values: Array<number | undefined | null>) => {
  const filtered = values.filter((v): v is number => Number.isFinite(v));
  if (!filtered.length) return Number.NaN;
  return Math.min(...filtered);
};

const maxFinite = (...values: Array<number | undefined | null>) => {
  const filtered = values.filter((v): v is number => Number.isFinite(v));
  if (!filtered.length) return Number.NaN;
  return Math.max(...filtered);
};

const resolveNearestPoiBoundary = (
  pois: AiMaticPoi[],
  side: "Buy" | "Sell",
  entry: number
) => {
  if (!Number.isFinite(entry) || !pois.length) return Number.NaN;
  if (side === "Buy") {
    const candidates = pois
      .map((poi) => poi.low)
      .filter((v) => Number.isFinite(v) && v < entry);
    return candidates.length ? Math.max(...(candidates as number[])) : Number.NaN;
  }
  const candidates = pois
    .map((poi) => poi.high)
    .filter((v) => Number.isFinite(v) && v > entry);
  return candidates.length ? Math.min(...(candidates as number[])) : Number.NaN;
};

const resolveAiMaticStopLoss = (args: {
  side: "Buy" | "Sell";
  entry: number;
  currentSl?: number;
  atr?: number;
  aiMatic?: AiMaticContext | null;
  core?: CoreV2Metrics;
}) => {
  const { side, entry, currentSl, atr, aiMatic, core } = args;
  if (!Number.isFinite(entry) || entry <= 0) return Number.NaN;
  const pivotLow = minFinite(
    aiMatic?.htf.pivotLow,
    aiMatic?.mtf.pivotLow,
    core?.lastPivotLow,
    core?.pivotLow
  );
  const pivotHigh = maxFinite(
    aiMatic?.htf.pivotHigh,
    aiMatic?.mtf.pivotHigh,
    core?.lastPivotHigh,
    core?.pivotHigh
  );
  const pois = [
    ...(aiMatic?.htf.pois ?? []),
    ...(aiMatic?.mtf.pois ?? []),
  ];
  const poiBoundary = resolveNearestPoiBoundary(pois, side, entry);
  const buffer = Number.isFinite(atr) ? atr * AI_MATIC_SL_ATR_BUFFER : 0;
  let candidate = Number.NaN;
  if (side === "Buy") {
    const base = minFinite(pivotLow, poiBoundary);
    if (Number.isFinite(base)) {
      candidate = base - buffer;
    }
  } else {
    const base = maxFinite(pivotHigh, poiBoundary);
    if (Number.isFinite(base)) {
      candidate = base + buffer;
    }
  }
  if (!Number.isFinite(candidate) || candidate <= 0) return Number.NaN;
  if (!Number.isFinite(currentSl)) return candidate;
  if (side === "Buy") {
    return candidate < (currentSl as number) ? candidate : Number.NaN;
  }
  return candidate > (currentSl as number) ? candidate : Number.NaN;
};

const resolveAiMaticTargets = (args: {
  side: "Buy" | "Sell";
  entry: number;
  sl: number;
  aiMatic?: AiMaticContext | null;
}) => {
  const { side, entry, sl, aiMatic } = args;
  if (!Number.isFinite(entry) || !Number.isFinite(sl)) return Number.NaN;
  const risk = Math.abs(entry - sl);
  if (!Number.isFinite(risk) || risk <= 0) return Number.NaN;
  const targets = new Set<number>();
  const add = (value: number | undefined | null) => {
    if (!Number.isFinite(value)) return;
    targets.add(value as number);
  };
  const profile = aiMatic?.mtf.profile ?? null;
  if (profile) {
    add(profile.poc);
    if (side === "Buy") {
      add(profile.vah);
      profile.hvn?.forEach(add);
    } else {
      add(profile.val);
      profile.lvn?.forEach(add);
    }
  }
  const pois = [
    ...(aiMatic?.htf.pois ?? []),
    ...(aiMatic?.mtf.pois ?? []),
  ];
  for (const poi of pois) {
    if (side === "Buy") add(poi.high);
    else add(poi.low);
  }
  if (side === "Buy") add(aiMatic?.htf.pivotHigh ?? aiMatic?.mtf.pivotHigh);
  else add(aiMatic?.htf.pivotLow ?? aiMatic?.mtf.pivotLow);

  const list = Array.from(targets)
    .filter((v) =>
      side === "Buy" ? v > entry : v < entry
    )
    .sort((a, b) => Math.abs(a - entry) - Math.abs(b - entry));
  const minTarget =
    side === "Buy" ? entry + risk * AI_MATIC_MIN_RR : entry - risk * AI_MATIC_MIN_RR;
  for (const candidate of list) {
    if (side === "Buy" ? candidate >= minTarget : candidate <= minTarget) {
      return candidate;
    }
  }
  return Number.NaN;
};

type AiMaticGate = { name: string; ok: boolean; detail?: string };
type AiMaticGateEval = {
  hardGates: AiMaticGate[];
  entryFactors: AiMaticGate[];
  checklist: AiMaticGate[];
  hardPass: boolean;
  entryFactorsPass: boolean;
  checklistPass: boolean;
  pass: boolean;
};

const evaluateAiMaticGatesCore = (args: {
  decision: PriceFeedDecision | null | undefined;
  signal: PriceFeedDecision["signal"] | null | undefined;
  correlationOk: boolean;
  dominanceOk: boolean;
}): AiMaticGateEval => {
  const aiMatic = (args.decision as any)?.aiMatic as AiMaticContext | null;
  const signal = args.signal ?? null;
  const empty: AiMaticGateEval = {
    hardGates: [],
    entryFactors: [],
    checklist: [],
    hardPass: false,
    entryFactorsPass: false,
    checklistPass: false,
    pass: false,
  };
  if (!aiMatic || !signal) return empty;
  const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
  const dir = sideRaw === "buy" ? "bull" : sideRaw === "sell" ? "bear" : null;
  if (!dir) return empty;
  const structureAligned =
    dir === "bull"
      ? aiMatic.htf.structureTrend === "BULL"
      : aiMatic.htf.structureTrend === "BEAR";
  const htfAligned = structureAligned;
  const emaStackOk =
    dir === "bull" ? aiMatic.ltf.ema.bullOk : aiMatic.ltf.ema.bearOk;
  const emaCrossOk = !aiMatic.ltf.ema.crossRecent;
  const patternOk =
    dir === "bull"
      ? aiMatic.ltf.patterns.pinbarBull ||
        aiMatic.ltf.patterns.engulfBull ||
        aiMatic.ltf.patterns.trapBull ||
        aiMatic.ltf.patterns.insideBar
      : aiMatic.ltf.patterns.pinbarBear ||
        aiMatic.ltf.patterns.engulfBear ||
        aiMatic.ltf.patterns.trapBear ||
        aiMatic.ltf.patterns.insideBar;
  const bosOk =
    dir === "bull"
      ? aiMatic.ltf.bosUp || aiMatic.ltf.breakRetestUp
      : aiMatic.ltf.bosDown || aiMatic.ltf.breakRetestDown;
  const sweepOk =
    dir === "bull"
      ? aiMatic.htf.sweepLow || aiMatic.mtf.sweepLow || aiMatic.ltf.fakeoutLow
      : aiMatic.htf.sweepHigh || aiMatic.mtf.sweepHigh || aiMatic.ltf.fakeoutHigh;
  const poiOk =
    dir === "bull"
      ? aiMatic.htf.poiReactionBull ||
        aiMatic.mtf.poiReactionBull ||
        aiMatic.mtf.pocNear ||
        aiMatic.mtf.lvnRejectionBull
      : aiMatic.htf.poiReactionBear ||
        aiMatic.mtf.poiReactionBear ||
        aiMatic.mtf.pocNear ||
        aiMatic.mtf.lvnRejectionBear;
  const volumeOk = aiMatic.ltf.volumeReaction;

  const emaConsensus = String((args.decision as any)?.emaTrend?.consensus ?? "").toLowerCase();
  const emaTrendOk = emaConsensus === dir;

  const chochAgainst =
    dir === "bull"
      ? aiMatic.htf.chochDown || aiMatic.ltf.chochDown
      : aiMatic.htf.chochUp || aiMatic.ltf.chochUp;
  const hardGates: AiMaticGate[] = [
    { name: "Structure trend", ok: htfAligned },
    { name: "EMA 8/21/50 stack", ok: emaStackOk },
    { name: "EMA cross recent", ok: emaCrossOk },
    { name: "CHoCH", ok: !chochAgainst },
  ];
  const entryFactors: AiMaticGate[] = [
    { name: "Pattern", ok: patternOk },
    { name: "BOS/Retest", ok: bosOk },
    { name: "Sweep/Fakeout", ok: sweepOk },
    { name: "POI/POC reaction", ok: poiOk },
    { name: "Volume reaction", ok: volumeOk },
  ];
  const checklist: AiMaticGate[] = [
    { name: "EMA trend", ok: emaTrendOk },
    { name: "Structure trend", ok: htfAligned },
    { name: "Pattern", ok: patternOk },
    { name: "Volume", ok: volumeOk },
    { name: "BTC correlation", ok: args.correlationOk },
    { name: "OB/POC reaction", ok: poiOk },
    { name: "Liquidity sweep", ok: sweepOk },
    { name: "BTC dominance proxy", ok: args.dominanceOk },
  ];
  const hardPass = hardGates.every((g) => g.ok);
  const entryFactorsPass =
    entryFactors.filter((g) => g.ok).length >= AI_MATIC_ENTRY_FACTOR_MIN;
  const checklistPass =
    checklist.filter((g) => g.ok).length >= AI_MATIC_CHECKLIST_MIN;
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
  resolveStructureState,
  resolveAiMaticStopLoss,
  resolveAiMaticTargets,
  evaluateAiMaticGatesCore,
  buildAiMaticContext,
};

type ScalpTrendDirection = "BULL" | "BEAR" | "NONE";
type ScalpStructure = "HH_HL" | "LL_LH" | "MIXED" | "NONE";

type ScalpTrend = {
  timeframeMin: number;
  close: number;
  ema21: number;
  ema21Prev: number;
  emaSlopePct: number;
  emaFlat: boolean;
  aboveEma: boolean;
  belowEma: boolean;
  structure: ScalpStructure;
  direction: ScalpTrendDirection;
};

type ScalpContext = {
  h1?: ScalpTrend;
  m15?: ScalpTrend;
  ema15mCrossCount: number;
  ema15mChoppy: boolean;
};

function buildScalpTrend(candles: Candle[], timeframeMin: number): ScalpTrend | undefined {
  const sampled = resampleCandles(candles, timeframeMin);
  const minBars = Math.max(SCALP_EMA_PERIOD + 2, SCALP_SWING_LOOKBACK * 2 + 3);
  if (!sampled.length || sampled.length < minBars) return undefined;

  const closes = sampled.map((c) => c.close);
  const emaArr = computeEma(closes, SCALP_EMA_PERIOD);
  if (emaArr.length < 2) return undefined;
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

  let structure: ScalpStructure = "NONE";
  if (lastHigh && prevHigh && lastLow && prevLow) {
    const hh = lastHigh.price > prevHigh.price;
    const hl = lastLow.price > prevLow.price;
    const ll = lastLow.price < prevLow.price;
    const lh = lastHigh.price < prevHigh.price;
    if (hh && hl) structure = "HH_HL";
    else if (ll && lh) structure = "LL_LH";
    else structure = "MIXED";
  }

  let direction: ScalpTrendDirection = "NONE";
  if (structure === "HH_HL" && aboveEma) direction = "BULL";
  if (structure === "LL_LH" && belowEma) direction = "BEAR";

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

function buildScalpContext(candles: Candle[]): ScalpContext {
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
        if (sign !== 0) prevSign = sign;
      }
      ema15mChoppy = ema15mCrossCount >= 2;
    }
  }

  return { h1, m15, ema15mCrossCount, ema15mChoppy };
}

type CoreV2Metrics = {
  ltfTimeframeMin: number;
  ltfClose: number;
  ltfOpen: number;
  ltfHigh: number;
  ltfLow: number;
  ltfVolume: number;
  ltfPrevClose: number;
  ltfPrevHigh: number;
  ltfPrevLow: number;
  ltfPrevVolume: number;
  ema8: number;
  ema12: number;
  ema21: number;
  ema26: number;
  ema50: number;
  atr14: number;
  atrPct: number;
  sep1: number;
  sep2: number;
  volumeCurrent: number;
  volumeP50: number;
  volumeP60: number;
  volumeP65: number;
  volumeP70: number;
  volumeSma: number;
  volumeStd: number;
  volumeZ: number;
  volumeSpike: boolean;
  ltfRange: number;
  ltfRangeSma: number;
  ltfRangeExpansionSma: boolean;
  ltfUp3: boolean;
  ltfDown3: boolean;
  ltfVolDown3: boolean;
  ltfFakeBreakHigh: boolean;
  ltfFakeBreakLow: boolean;
  volumeSpikeCurrent: number;
  volumeSpikePrev: number;
  volumeSpikeFading: boolean;
  volumeFalling: boolean;
  volumeRising: boolean;
  ltfRangeExpansion: boolean;
  ltfRangeExpVolume: boolean;
  ltfSweepBackInside: boolean;
  ltfRsi: number;
  ltfRsiNeutral: boolean;
  ltfNoNewHigh: boolean;
  ltfNoNewLow: boolean;
  htfClose: number;
  htfEma12: number;
  htfEma26: number;
  htfDiffPct: number;
  htfBias: "BULL" | "BEAR" | "NONE";
  htfAtr14: number;
  htfAtrPct: number;
  htfPivotHigh?: number;
  htfPivotLow?: number;
  m15Close: number;
  m15Atr14: number;
  m15AtrPct: number;
  m15EmaSpreadPct: number;
  m15OverlapWicky: boolean;
  m15TrendLongOk: boolean;
  m15TrendShortOk: boolean;
  m15DriftBlocked: boolean;
  m15EmaCompression: boolean;
  m15EmaCompressionSoft: boolean;
  m15MacdHist: number;
  m15MacdHistPrev: number;
  m15MacdHistPrev2: number;
  m15MacdWeak3: boolean;
  m15MacdWeak2: boolean;
  m15ImpulseWeak: boolean;
  m15WickIndecision: boolean;
  m15WickIndecisionSoft: boolean;
  ema15m12: number;
  ema15m26: number;
  ema15mTrend: "BULL" | "BEAR" | "NONE";
  emaCrossDir: "BULL" | "BEAR" | "NONE";
  emaCrossBarsAgo?: number;
  pullbackLong: boolean;
  pullbackShort: boolean;
  pivotHigh?: number;
  pivotLow?: number;
  lastPivotHigh?: number;
  lastPivotLow?: number;
  prevPivotHigh?: number;
  prevPivotLow?: number;
  microBreakLong: boolean;
  microBreakShort: boolean;
  rsiBullDiv: boolean;
  rsiBearDiv: boolean;
  ltfCrossRsiAgainst: boolean;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[rank];
};

const resolveEntryTfMin = (riskMode: AISettings["riskMode"]) =>
  riskMode === "ai-matic-scalp" ? 1 : 5;

const resolveBboAgeLimit = (symbol: Symbol) =>
  CORE_V2_BBO_AGE_BY_SYMBOL[symbol] ?? CORE_V2_BBO_AGE_DEFAULT_MS;

const computeCoreV2Metrics = (
  candles: Candle[],
  riskMode: AISettings["riskMode"]
): CoreV2Metrics => {
  const ltfTimeframeMin = resolveEntryTfMin(riskMode);
  const ltf = resampleCandles(candles, ltfTimeframeMin);
  const ltfLast = ltf.length ? ltf[ltf.length - 1] : undefined;
  const ltfPrev = ltf.length > 1 ? ltf[ltf.length - 2] : undefined;
  const ltfClose = ltfLast ? ltfLast.close : Number.NaN;
  const ltfOpen = ltfLast ? ltfLast.open : Number.NaN;
  const ltfHigh = ltfLast ? ltfLast.high : Number.NaN;
  const ltfLow = ltfLast ? ltfLast.low : Number.NaN;
  const ltfVolume = ltfLast ? toNumber(ltfLast.volume) : Number.NaN;
  const ltfPrevClose = ltfPrev ? ltfPrev.close : Number.NaN;
  const ltfPrevHigh = ltfPrev ? ltfPrev.high : Number.NaN;
  const ltfPrevLow = ltfPrev ? ltfPrev.low : Number.NaN;
  const ltfPrevVolume = ltfPrev ? toNumber(ltfPrev.volume) : Number.NaN;
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
  const emaCrossLookback = Math.min(
    Math.max(4, SCALP_EMA_CROSS_LOOKBACK + 2),
    Math.min(ema12Arr.length, ema26Arr.length)
  );
  let emaCrossDir: CoreV2Metrics["emaCrossDir"] = "NONE";
  let emaCrossBarsAgo: number | undefined;
  if (emaCrossLookback >= 3) {
    const size = Math.min(ema12Arr.length, ema26Arr.length);
    let prevSign = Math.sign(
      ema12Arr[size - emaCrossLookback] - ema26Arr[size - emaCrossLookback]
    );
    for (let i = size - emaCrossLookback + 1; i < size; i++) {
      const sign = Math.sign(ema12Arr[i] - ema26Arr[i]);
      if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
        emaCrossDir = sign > 0 ? "BULL" : "BEAR";
        emaCrossBarsAgo = size - 1 - i;
      }
      if (sign !== 0) prevSign = sign;
    }
  }
  const atrArr = computeATR(ltfHighs, ltfLows, ltfCloses, 14);
  const atr14 = atrArr[atrArr.length - 1] ?? Number.NaN;
  const atrPct =
    Number.isFinite(atr14) && Number.isFinite(ltfClose) && ltfClose > 0
      ? atr14 / ltfClose
      : Number.NaN;
  const sep1 =
    Number.isFinite(atr14) && atr14 > 0
      ? Math.abs(ema8 - ema21) / atr14
      : Number.NaN;
  const sep2 =
    Number.isFinite(atr14) && atr14 > 0
      ? Math.abs(ema21 - ema50) / atr14
      : Number.NaN;

  const vols = ltf.map((c) => toNumber(c.volume));
  const recentVols = vols.slice(-200).filter((v) => Number.isFinite(v));
  const volumeCurrent = recentVols[recentVols.length - 1] ?? Number.NaN;
  const volumeP50 = percentile(recentVols, 50);
  const volumeP60 = percentile(recentVols, 60);
  const volumeP65 = percentile(recentVols, 65);
  const volumeP70 = percentile(recentVols, 70);
  const volSlice = recentVols.slice(-SCALP_VOL_LEN);
  const volumeSma =
    volSlice.length > 0
      ? volSlice.reduce((s, v) => s + v, 0) / volSlice.length
      : Number.NaN;
  const volumeStd =
    volSlice.length > 1 && Number.isFinite(volumeSma)
      ? Math.sqrt(
          volSlice.reduce((s, v) => s + Math.pow(v - volumeSma, 2), 0) /
            volSlice.length
        )
      : Number.NaN;
  const volumeZ =
    Number.isFinite(volumeStd) && volumeStd > 0 && Number.isFinite(volumeCurrent)
      ? (volumeCurrent - volumeSma) / volumeStd
      : Number.NaN;
  const volumeSpike =
    Number.isFinite(volumeCurrent) &&
    Number.isFinite(volumeSma) &&
    volumeSma > 0 &&
    (volumeCurrent >= volumeSma * SCALP_VOL_SPIKE_MULT ||
      (Number.isFinite(volumeZ) && volumeZ >= SCALP_VOL_Z_MIN));
  let volumeSpikeCurrent = Number.NaN;
  let volumeSpikePrev = Number.NaN;
  let volumeSpikeFading = false;
  if (recentVols.length >= 2 && Number.isFinite(volumeP70)) {
    const start = Math.max(0, recentVols.length - SCALP_VOLUME_SPIKE_LOOKBACK);
    for (let i = start; i < recentVols.length; i++) {
      const v = recentVols[i];
      if (!Number.isFinite(v) || v < volumeP70) continue;
      volumeSpikePrev = volumeSpikeCurrent;
      volumeSpikeCurrent = v;
      if (i === recentVols.length - 1 && Number.isFinite(volumeSpikePrev)) {
        volumeSpikeFading = volumeSpikeCurrent < volumeSpikePrev;
      }
    }
  }
  const volTrendLookback = SCALP_VOLUME_TREND_LOOKBACK;
  const recentSlice = recentVols.slice(-volTrendLookback);
  const prevSlice = recentVols.slice(-volTrendLookback * 2, -volTrendLookback);
  const avg = (list: number[]) =>
    list.length ? list.reduce((s, v) => s + v, 0) / list.length : Number.NaN;
  const recentAvgVol = avg(recentSlice);
  const prevAvgVol = avg(prevSlice);
  const volumeFalling =
    Number.isFinite(recentAvgVol) && Number.isFinite(prevAvgVol)
      ? recentAvgVol < prevAvgVol
      : false;
  const volumeRising =
    Number.isFinite(recentAvgVol) && Number.isFinite(prevAvgVol)
      ? recentAvgVol > prevAvgVol
      : false;
  const ltfRange =
    Number.isFinite(ltfHigh) && Number.isFinite(ltfLow)
      ? ltfHigh - ltfLow
      : Number.NaN;
  const rangeSlice = ltf
    .slice(-SCALP_RANGE_SMA_LEN)
    .map((c) => c.high - c.low)
    .filter((v) => Number.isFinite(v));
  const ltfRangeSma =
    rangeSlice.length > 0
      ? rangeSlice.reduce((s, v) => s + v, 0) / rangeSlice.length
      : Number.NaN;
  const ltfRangeExpansionSma =
    Number.isFinite(ltfRange) &&
    Number.isFinite(ltfRangeSma) &&
    ltfRangeSma > 0 &&
    ltfRange > ltfRangeSma * SCALP_RANGE_EXP_MULT;
  const ltfRangeExpansion =
    Number.isFinite(atr14) &&
    Number.isFinite(ltfHigh) &&
    Number.isFinite(ltfLow) &&
    atr14 > 0 &&
    ltfHigh - ltfLow >= atr14 * SCALP_RANGE_EXP_ATR;
  const ltfRangeExpVolume =
    Number.isFinite(volumeCurrent) &&
    Number.isFinite(volumeP70) &&
    volumeCurrent > volumeP70;
  const ltfSweepBackInside = (() => {
    if (ltf.length <= 1) return false;
    const lookback = Math.min(
      SCALP_FAKE_RANGE_LOOKBACK,
      Math.max(0, ltf.length - 1)
    );
    if (lookback <= 1) return false;
    const rangeHigh = Math.max(
      ...ltfHighs.slice(-lookback - 1, -1)
    );
    const rangeLow = Math.min(
      ...ltfLows.slice(-lookback - 1, -1)
    );
    if (!Number.isFinite(rangeHigh) || !Number.isFinite(rangeLow)) return false;
    const sweepHigh =
      Number.isFinite(ltfHigh) &&
      Number.isFinite(ltfClose) &&
      ltfHigh > rangeHigh &&
      ltfClose <= rangeHigh;
    const sweepLow =
      Number.isFinite(ltfLow) &&
      Number.isFinite(ltfClose) &&
      ltfLow < rangeLow &&
      ltfClose >= rangeLow;
    return sweepHigh || sweepLow;
  })();
  const ltfNoNewHigh = (() => {
    if (ltf.length < SCALP_TIME_DECAY_MAX_BARS * 2) return false;
    const recentHigh = Math.max(
      ...ltfHighs.slice(-SCALP_TIME_DECAY_MAX_BARS)
    );
    const prevHigh = Math.max(
      ...ltfHighs.slice(
        -SCALP_TIME_DECAY_MAX_BARS * 2,
        -SCALP_TIME_DECAY_MAX_BARS
      )
    );
    return (
      Number.isFinite(recentHigh) &&
      Number.isFinite(prevHigh) &&
      recentHigh <= prevHigh
    );
  })();
  const ltfNoNewLow = (() => {
    if (ltf.length < SCALP_TIME_DECAY_MAX_BARS * 2) return false;
    const recentLow = Math.min(
      ...ltfLows.slice(-SCALP_TIME_DECAY_MAX_BARS)
    );
    const prevLow = Math.min(
      ...ltfLows.slice(
        -SCALP_TIME_DECAY_MAX_BARS * 2,
        -SCALP_TIME_DECAY_MAX_BARS
      )
    );
    return (
      Number.isFinite(recentLow) &&
      Number.isFinite(prevLow) &&
      recentLow >= prevLow
    );
  })();
  const ltfUp3 =
    ltfCloses.length >= 3 &&
    ltfCloses[ltfCloses.length - 1] > ltfCloses[ltfCloses.length - 2] &&
    ltfCloses[ltfCloses.length - 2] > ltfCloses[ltfCloses.length - 3];
  const ltfDown3 =
    ltfCloses.length >= 3 &&
    ltfCloses[ltfCloses.length - 1] < ltfCloses[ltfCloses.length - 2] &&
    ltfCloses[ltfCloses.length - 2] < ltfCloses[ltfCloses.length - 3];
  const ltfVolDown3 =
    recentVols.length >= 3 &&
    recentVols[recentVols.length - 1] < recentVols[recentVols.length - 2] &&
    recentVols[recentVols.length - 2] < recentVols[recentVols.length - 3];

  const htf = resampleCandles(candles, 60);
  const htfCloses = htf.map((c) => c.close);
  const htfHighs = htf.map((c) => c.high);
  const htfLows = htf.map((c) => c.low);
  const htfClose = htf.length ? htf[htf.length - 1].close : Number.NaN;
  const htfEma12Arr = computeEma(htfCloses, 12);
  const htfEma26Arr = computeEma(htfCloses, 26);
  const htfEma12 = htfEma12Arr[htfEma12Arr.length - 1] ?? Number.NaN;
  const htfEma26 = htfEma26Arr[htfEma26Arr.length - 1] ?? Number.NaN;
  const htfDiffPct =
    Number.isFinite(htfClose) && htfClose > 0
      ? Math.abs(htfEma12 - htfEma26) / htfClose
      : Number.NaN;
  const htfBias =
    Number.isFinite(htfEma12) && Number.isFinite(htfEma26)
      ? htfEma12 > htfEma26
        ? "BULL"
        : htfEma12 < htfEma26
          ? "BEAR"
          : "NONE"
      : "NONE";
  const htfAtrArr = computeATR(htfHighs, htfLows, htfCloses, 14);
  const htfAtr14 = htfAtrArr[htfAtrArr.length - 1] ?? Number.NaN;
  const htfAtrPct =
    Number.isFinite(htfAtr14) && Number.isFinite(htfClose) && htfClose > 0
      ? htfAtr14 / htfClose
      : Number.NaN;
  const htfPivotsHigh = findPivotsHigh(htf, 2, 2);
  const htfPivotsLow = findPivotsLow(htf, 2, 2);
  const htfPivotHigh = htfPivotsHigh[htfPivotsHigh.length - 1]?.price;
  const htfPivotLow = htfPivotsLow[htfPivotsLow.length - 1]?.price;

  const m15 = resampleCandles(candles, 15);
  const m15Last = m15.length ? m15[m15.length - 1] : undefined;
  const m15Closes = m15.map((c) => c.close);
  const m15Highs = m15.map((c) => c.high);
  const m15Lows = m15.map((c) => c.low);
  const ema15m12Arr = computeEma(m15Closes, 12);
  const ema15m26Arr = computeEma(m15Closes, 26);
  const ema15m12 = ema15m12Arr[ema15m12Arr.length - 1] ?? Number.NaN;
  const ema15m26 = ema15m26Arr[ema15m26Arr.length - 1] ?? Number.NaN;
  const m15Close = m15Last ? m15Last.close : Number.NaN;
  const ema15mTrend =
    Number.isFinite(ema15m12) && Number.isFinite(ema15m26)
      ? ema15m12 > ema15m26
        ? "BULL"
        : ema15m12 < ema15m26
          ? "BEAR"
          : "NONE"
      : "NONE";
  const m15AtrArr = computeATR(m15Highs, m15Lows, m15Closes, 14);
  const m15Atr14 = m15AtrArr[m15AtrArr.length - 1] ?? Number.NaN;
  const m15AtrPct =
    Number.isFinite(m15Atr14) && Number.isFinite(m15Close) && m15Close > 0
      ? m15Atr14 / m15Close
      : Number.NaN;
  const m15EmaSpreadPct =
    Number.isFinite(ema15m12) &&
    Number.isFinite(ema15m26) &&
    Number.isFinite(m15Close) &&
    m15Close > 0
      ? Math.abs(ema15m12 - ema15m26) / m15Close
      : Number.NaN;
  let m15OverlapWicky = false;
  if (m15.length >= SCALP_OVERLAP_BARS + 1) {
    let overlapCount = 0;
    for (let i = m15.length - SCALP_OVERLAP_BARS; i < m15.length; i++) {
      const curr = m15[i];
      const prev = m15[i - 1];
      if (!curr || !prev) continue;
      const overlap =
        Math.min(curr.high, prev.high) - Math.max(curr.low, prev.low);
      const range = Math.max(curr.high - curr.low, 1e-8);
      if (overlap / range >= SCALP_OVERLAP_RATIO) overlapCount += 1;
    }
    m15OverlapWicky = overlapCount >= SCALP_OVERLAP_BARS - 1;
  }
  const m15TrendLongOk =
    Number.isFinite(m15Close) &&
    Number.isFinite(ema15m26) &&
    Number.isFinite(ema15m12) &&
    m15Close > ema15m26 &&
    ema15m12 > ema15m26;
  const m15TrendShortOk =
    Number.isFinite(m15Close) &&
    Number.isFinite(ema15m26) &&
    Number.isFinite(ema15m12) &&
    m15Close < ema15m26 &&
    ema15m12 < ema15m26;
  const m15EmaSep =
    Number.isFinite(ema15m12) && Number.isFinite(ema15m26)
      ? Math.abs(ema15m12 - ema15m26)
      : Number.NaN;
  const m15EmaSepAtr =
    Number.isFinite(m15EmaSep) && Number.isFinite(m15Atr14) && m15Atr14 > 0
      ? m15EmaSep / m15Atr14
      : Number.NaN;
  const m15EmaCompression =
    Number.isFinite(m15EmaSepAtr) &&
    m15EmaSepAtr <= SCALP_M15_EMA_COMPRESSION_ATR;
  const m15EmaCompressionSoft =
    Number.isFinite(m15EmaSepAtr) &&
    m15EmaSepAtr <= SCALP_M15_EMA_COMPRESSION_SOFT_ATR;
  const m15Macd = ema15m12Arr.map((v, i) => v - (ema15m26Arr[i] ?? 0));
  const m15Signal = computeEma(m15Macd, 9);
  const m15Hist = m15Macd.map((v, i) => v - (m15Signal[i] ?? 0));
  const m15MacdHist = m15Hist[m15Hist.length - 1] ?? Number.NaN;
  const m15MacdHistPrev = m15Hist[m15Hist.length - 2] ?? Number.NaN;
  const m15MacdHistPrev2 = m15Hist[m15Hist.length - 3] ?? Number.NaN;
  const macdAligned = (value: number) =>
    ema15mTrend === "BULL"
      ? value > 0
      : ema15mTrend === "BEAR"
        ? value < 0
        : false;
  const m15MacdWeak3 =
    [m15MacdHist, m15MacdHistPrev, m15MacdHistPrev2].every(Number.isFinite) &&
    macdAligned(m15MacdHist) &&
    macdAligned(m15MacdHistPrev) &&
    macdAligned(m15MacdHistPrev2) &&
    Math.abs(m15MacdHist) < Math.abs(m15MacdHistPrev) &&
    Math.abs(m15MacdHistPrev) < Math.abs(m15MacdHistPrev2);
  const m15MacdWeak2 =
    [m15MacdHist, m15MacdHistPrev].every(Number.isFinite) &&
    macdAligned(m15MacdHist) &&
    macdAligned(m15MacdHistPrev) &&
    Math.abs(m15MacdHist) < Math.abs(m15MacdHistPrev);
  let m15ImpulseWeak = false;
  if (m15.length >= 3) {
    const impulses: Candle[] = [];
    const lookback = Math.min(SCALP_M15_IMPULSE_LOOKBACK, m15.length);
    for (let i = m15.length - 1; i >= m15.length - lookback; i--) {
      const candle = m15[i];
      if (!candle) continue;
      const isImpulse =
        ema15mTrend === "BULL"
          ? candle.close > candle.open
          : ema15mTrend === "BEAR"
            ? candle.close < candle.open
            : false;
      if (isImpulse) impulses.push(candle);
      if (impulses.length >= 2) break;
    }
    if (impulses.length >= 2) {
      const last = impulses[0];
      const prev = impulses[1];
      const lastBody = Math.abs(last.close - last.open);
      const prevBody = Math.abs(prev.close - prev.open);
      const lastVol = toNumber(last.volume);
      const prevVol = toNumber(prev.volume);
      m15ImpulseWeak =
        Number.isFinite(lastBody) &&
        Number.isFinite(prevBody) &&
        Number.isFinite(lastVol) &&
        Number.isFinite(prevVol) &&
        lastBody < prevBody &&
        lastVol < prevVol;
    }
  }
  let m15WickIndecision = false;
  let m15WickIndecisionSoft = false;
  if (m15.length >= 2) {
    const checkCount = Math.min(3, m15.length);
    let wickCount = 0;
    for (let i = m15.length - checkCount; i < m15.length; i++) {
      const candle = m15[i];
      if (!candle) continue;
      const body = Math.max(Math.abs(candle.close - candle.open), 1e-8);
      const upper = candle.high - Math.max(candle.open, candle.close);
      const lower = Math.min(candle.open, candle.close) - candle.low;
      if (
        upper >= body * SCALP_M15_WICK_RATIO &&
        lower >= body * SCALP_M15_WICK_RATIO
      ) {
        wickCount += 1;
      }
    }
    m15WickIndecision = wickCount >= SCALP_M15_WICK_MIN_COUNT;
    m15WickIndecisionSoft = wickCount >= SCALP_M15_WICK_MIN_COUNT_SOFT;
  }
  const m15DriftBlocked =
    (Number.isFinite(m15EmaSpreadPct) &&
      m15EmaSpreadPct < SCALP_TREND_MIN_SPREAD) ||
    m15MacdWeak3 ||
    m15OverlapWicky;

  const pullbackLookback = 12;
  let pullbackLong = false;
  let pullbackShort = false;
  for (let i = Math.max(0, ltf.length - pullbackLookback); i < ltf.length; i++) {
    const candle = ltf[i];
    const ema12At = ema12Arr[i];
    const ema26At = ema26Arr[i];
    if (!candle || !Number.isFinite(ema12At) || !Number.isFinite(ema26At)) continue;
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
  const prevHigh =
    lastLow ? pivotsHigh.filter((p) => p.idx < lastLow.idx).pop() : undefined;
  const prevLow =
    lastHigh ? pivotsLow.filter((p) => p.idx < lastHigh.idx).pop() : undefined;
  const prevLowPivot = pivotsLow[pivotsLow.length - 2];
  const prevHighPivot = pivotsHigh[pivotsHigh.length - 2];
  const microBreakLong =
    Boolean(prevHigh && lastLow) &&
    Number.isFinite(ltfClose) &&
    ltfClose > prevHigh!.price;
  const microBreakShort =
    Boolean(prevLow && lastHigh) &&
    Number.isFinite(ltfClose) &&
    ltfClose < prevLow!.price;
  const rsiBullDiv = (() => {
    if (!pivotsLow.length || ltfCloses.length < SCALP_DIV_LOOKBACK) return false;
    const startIdx = Math.max(0, ltfCloses.length - SCALP_DIV_LOOKBACK);
    const candidates = pivotsLow.filter((p) => p.idx >= startIdx);
    if (candidates.length < 2) return false;
    const last = candidates[candidates.length - 1];
    let prev: typeof last | undefined;
    for (let i = candidates.length - 2; i >= 0; i--) {
      const cand = candidates[i];
      const gap = last.idx - cand.idx;
      if (gap >= SCALP_PIVOT_MIN_GAP && gap <= SCALP_PIVOT_MAX_GAP) {
        prev = cand;
        break;
      }
    }
    if (!prev) return false;
    return (
      last.price < prev.price &&
      Number.isFinite(rsiArr[last.idx]) &&
      Number.isFinite(rsiArr[prev.idx]) &&
      rsiArr[last.idx] > rsiArr[prev.idx]
    );
  })();
  const rsiBearDiv = (() => {
    if (!pivotsHigh.length || ltfCloses.length < SCALP_DIV_LOOKBACK) return false;
    const startIdx = Math.max(0, ltfCloses.length - SCALP_DIV_LOOKBACK);
    const candidates = pivotsHigh.filter((p) => p.idx >= startIdx);
    if (candidates.length < 2) return false;
    const last = candidates[candidates.length - 1];
    let prev: typeof last | undefined;
    for (let i = candidates.length - 2; i >= 0; i--) {
      const cand = candidates[i];
      const gap = last.idx - cand.idx;
      if (gap >= SCALP_PIVOT_MIN_GAP && gap <= SCALP_PIVOT_MAX_GAP) {
        prev = cand;
        break;
      }
    }
    if (!prev) return false;
    return (
      last.price > prev.price &&
      Number.isFinite(rsiArr[last.idx]) &&
      Number.isFinite(rsiArr[prev.idx]) &&
      rsiArr[last.idx] < rsiArr[prev.idx]
    );
  })();
  const ltfRsi = rsiArr[rsiArr.length - 1] ?? Number.NaN;
  const ltfRsiNeutral =
    Number.isFinite(ltfRsi) &&
    ltfRsi >= SCALP_RSI_NEUTRAL_LOW &&
    ltfRsi <= SCALP_RSI_NEUTRAL_HIGH;
  const ltfCrossRsiAgainst =
    (emaCrossDir === "BULL" && rsiBearDiv) ||
    (emaCrossDir === "BEAR" && rsiBullDiv);
  const ltfFakeBreakHigh =
    Number.isFinite(lastHigh?.price) &&
    Number.isFinite(ltfHigh) &&
    Number.isFinite(ltfClose) &&
    ltfHigh > (lastHigh?.price as number) &&
    ltfClose < (lastHigh?.price as number);
  const ltfFakeBreakLow =
    Number.isFinite(lastLow?.price) &&
    Number.isFinite(ltfLow) &&
    Number.isFinite(ltfClose) &&
    ltfLow < (lastLow?.price as number) &&
    ltfClose > (lastLow?.price as number);
  const lastPivotHigh = lastHigh?.price;
  const lastPivotLow = lastLow?.price;
  const prevPivotHigh = prevHighPivot?.price;
  const prevPivotLow = prevLowPivot?.price;

  return {
    ltfTimeframeMin,
    ltfClose,
    ltfOpen,
    ltfHigh,
    ltfLow,
    ltfVolume,
    ltfPrevClose,
    ltfPrevHigh,
    ltfPrevLow,
    ltfPrevVolume,
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
    volumeSma,
    volumeStd,
    volumeZ,
    volumeSpike,
    ltfRange,
    ltfRangeSma,
    ltfRangeExpansionSma,
    ltfUp3,
    ltfDown3,
    ltfVolDown3,
    ltfFakeBreakHigh,
    ltfFakeBreakLow,
    volumeSpikeCurrent,
    volumeSpikePrev,
    volumeSpikeFading,
    volumeFalling,
    volumeRising,
    ltfRangeExpansion,
    ltfRangeExpVolume,
    ltfSweepBackInside,
    ltfRsi,
    ltfRsiNeutral,
    ltfNoNewHigh,
    ltfNoNewLow,
    htfClose,
    htfEma12,
    htfEma26,
    htfDiffPct,
    htfBias,
    htfAtr14,
    htfAtrPct,
    htfPivotHigh,
    htfPivotLow,
    m15Close,
    m15Atr14,
    m15AtrPct,
    m15EmaSpreadPct,
    m15OverlapWicky,
    m15TrendLongOk,
    m15TrendShortOk,
    m15DriftBlocked,
    m15EmaCompression,
    m15EmaCompressionSoft,
    m15MacdHist,
    m15MacdHistPrev,
    m15MacdHistPrev2,
    m15MacdWeak3,
    m15MacdWeak2,
    m15ImpulseWeak,
    m15WickIndecision,
    m15WickIndecisionSoft,
    ema15m12,
    ema15m26,
    ema15mTrend,
    emaCrossDir,
    emaCrossBarsAgo,
    pullbackLong,
    pullbackShort,
    pivotHigh: prevHigh?.price,
    pivotLow: prevLow?.price,
    lastPivotHigh,
    lastPivotLow,
    prevPivotHigh,
    prevPivotLow,
    microBreakLong,
    microBreakShort,
    rsiBullDiv,
    rsiBearDiv,
    ltfCrossRsiAgainst,
  };
};

const computeScalpPrimaryChecklist = (core: CoreV2Metrics | undefined) => {
  const ltfOk = core?.ltfTimeframeMin === 1;
  const trendLongOk = Boolean(core?.m15TrendLongOk);
  const trendShortOk = Boolean(core?.m15TrendShortOk);
  const primaryOk = ltfOk && (trendLongOk || trendShortOk);
  const crossBullOk =
    core?.emaCrossDir === "BULL" &&
    Number.isFinite(core?.emaCrossBarsAgo) &&
    (core?.emaCrossBarsAgo as number) <= SCALP_EMA_CROSS_LOOKBACK;
  const crossBearOk =
    core?.emaCrossDir === "BEAR" &&
    Number.isFinite(core?.emaCrossBarsAgo) &&
    (core?.emaCrossBarsAgo as number) <= SCALP_EMA_CROSS_LOOKBACK;
  const divBullOk = Boolean(core?.rsiBullDiv);
  const divBearOk = Boolean(core?.rsiBearDiv);
  const volumeOk = Boolean(core?.volumeSpike);
  const entryOk = trendLongOk
    ? Boolean(crossBullOk && divBullOk && volumeOk)
    : trendShortOk
      ? Boolean(crossBearOk && divBearOk && volumeOk)
      : false;
  const exitOk = Number.isFinite(core?.atr14);
  return {
    primaryOk,
    entryOk,
    exitOk,
    ltfOk,
    trendLongOk,
    trendShortOk,
    crossBullOk,
    crossBearOk,
    divBullOk,
    divBearOk,
    volumeOk,
    emaCrossBarsAgo: core?.emaCrossBarsAgo,
  };
};

type ScalpGuardStatus = {
  driftBlocked: boolean;
  driftReasons: string[];
  fakeBlocked: boolean;
  fakeReasons: string[];
  protectedEntry: boolean;
  protectedReasons: string[];
};

const evaluateScalpGuards = (
  core: CoreV2Metrics | undefined
): ScalpGuardStatus => {
  if (!core) {
    return {
      driftBlocked: false,
      driftReasons: [],
      fakeBlocked: false,
      fakeReasons: [],
      protectedEntry: false,
      protectedReasons: [],
    };
  }
  const driftReasons: string[] = [];
  if (
    Number.isFinite(core.m15EmaSpreadPct) &&
    core.m15EmaSpreadPct < SCALP_TREND_MIN_SPREAD
  ) {
    driftReasons.push("EMA spread low");
  }
  if (core.m15MacdWeak3) driftReasons.push("MACD weakening");
  if (core.m15OverlapWicky) driftReasons.push("15m overlap/wicky");
  const driftBlocked = driftReasons.length > 0;

  const fakeReasons: string[] = [];
  const trendLongOk = core.m15TrendLongOk;
  const trendShortOk = core.m15TrendShortOk;
  if (trendLongOk && core.ltfUp3 && core.ltfVolDown3) {
    fakeReasons.push("price up / vol down");
  }
  if (trendShortOk && core.ltfDown3 && core.ltfVolDown3) {
    fakeReasons.push("price down / vol down");
  }
  if (core.ltfCrossRsiAgainst) {
    fakeReasons.push("RSI divergence vs cross");
  }
  if (core.volumeSpikeFading) {
    fakeReasons.push("volume spike fading");
  }
  if (core.ltfSweepBackInside) {
    fakeReasons.push("sweep back inside");
  }
  if (trendLongOk && core.ltfFakeBreakHigh) {
    fakeReasons.push("fake break high");
  }
  if (trendShortOk && core.ltfFakeBreakLow) {
    fakeReasons.push("fake break low");
  }
  const rsiExtremeLong =
    trendLongOk && Number.isFinite(core.ltfRsi) && core.ltfRsi > 75;
  const rsiExtremeShort =
    trendShortOk && Number.isFinite(core.ltfRsi) && core.ltfRsi < 25;
  if (rsiExtremeLong || rsiExtremeShort) {
    fakeReasons.push("RSI extreme");
  }
  const onlyRsiExtreme =
    fakeReasons.length === 1 && fakeReasons[0] === "RSI extreme";
  const fakeBlocked = fakeReasons.length > 0 && !onlyRsiExtreme;

  const protectedReasons: string[] = [];
  const trendOk = trendLongOk || trendShortOk;
  const momentumReasons: string[] = [];
  if (core.m15MacdWeak2) momentumReasons.push("MACD soft");
  if (core.m15ImpulseWeak) momentumReasons.push("impulse soft");
  if (core.m15WickIndecisionSoft) momentumReasons.push("wicky");
  if (core.m15EmaCompressionSoft) momentumReasons.push("EMA compression");
  const momentumWeakening = momentumReasons.length > 0;
  const protectedEntry =
    onlyRsiExtreme ||
    (trendOk && momentumWeakening && !driftBlocked && !fakeBlocked);
  if (protectedEntry) {
    if (onlyRsiExtreme) {
      protectedReasons.push("RSI extreme");
    } else {
      protectedReasons.push(...momentumReasons);
    }
  }

  return {
    driftBlocked,
    driftReasons,
    fakeBlocked,
    fakeReasons,
    protectedEntry,
    protectedReasons,
  };
};

const resolveProtectedScalpStop = (
  core: CoreV2Metrics | undefined,
  side: "Buy" | "Sell",
  entry: number,
  fallbackSl?: number
) => {
  if (!core || !Number.isFinite(entry) || entry <= 0) return fallbackSl;
  const atr = core.atr14;
  const buffer =
    Number.isFinite(atr) && atr > 0 ? atr * SCALP_PROTECTED_SL_ATR_BUFFER : 0;
  const structure =
    side === "Buy"
      ? core.lastPivotLow ?? core.pivotLow
      : core.lastPivotHigh ?? core.pivotHigh;
  if (Number.isFinite(structure) && structure > 0) {
    return side === "Buy" ? structure - buffer : structure + buffer;
  }
  if (Number.isFinite(atr) && atr > 0) {
    return side === "Buy" ? entry - atr * 2 : entry + atr * 2;
  }
  return fallbackSl;
};

function toEpoch(value: unknown) {
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

function toIso(ts: unknown) {
  const epoch = toEpoch(ts);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : "";
}

function formatNumber(value: number, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function normalizeTrendDir(value: string) {
  const upper = value.trim().toUpperCase();
  if (!upper || upper === "—") return "—";
  if (upper.startsWith("BULL") || upper === "UP") return "BULL";
  if (upper.startsWith("BEAR") || upper === "DOWN") return "BEAR";
  if (upper.startsWith("RANGE") || upper === "NONE" || upper === "NEUTRAL") {
    return "RANGE";
  }
  return upper;
}

function buildTreeInputs(
  depsRaw: any,
  sigRaw: any
): { deps: TreeDeps; signals: TreeSignals } {
  const deps: TreeDeps = {
    hasVP: Boolean(depsRaw?.hasVP),
    hasOB: Boolean(depsRaw?.hasOB),
    hasGAP: Boolean(depsRaw?.hasGAP),
    hasTrap: Boolean(depsRaw?.hasTrap),
    hasLowVol: Boolean(depsRaw?.hasLowVol),
  };
  const signals: TreeSignals = {
    inLowVolume: Boolean(sigRaw?.inLowVolume),
    htfReactionConfirmed: Boolean(sigRaw?.htfReactionConfirmed),
    structureReadable: Boolean(sigRaw?.structureReadable),
    sessionOk: sigRaw?.sessionOk !== false,
    bosUp: Boolean(sigRaw?.bosUp),
    bosDown: Boolean(sigRaw?.bosDown),
    returnToLevel: Boolean(sigRaw?.returnToLevel),
    rejectionInLVN: Boolean(sigRaw?.rejectionInLVN),
    touchOB: Boolean(sigRaw?.touchOB),
    rejectionInOB: Boolean(sigRaw?.rejectionInOB),
    trapReaction: Boolean(sigRaw?.trapReaction),
  };
  return { deps, signals };
}

function resolveH1M15TrendGate(
  core: CoreV2Metrics | undefined,
  signal: PriceFeedDecision["signal"] | null
) {
  if (!signal) {
    return { ok: true, detail: "no signal" };
  }
  const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
  const signalDir =
    sideRaw === "buy" ? "BULL" : sideRaw === "sell" ? "BEAR" : "";
  if (!signalDir) {
    return { ok: false, detail: "signal side missing" };
  }
  if (!core) {
    return { ok: false, detail: "trend data missing" };
  }
  const h1Dir =
    core.htfBias === "BULL" || core.htfBias === "BEAR"
      ? core.htfBias
      : "NONE";
  let m15Dir: "BULL" | "BEAR" | "NONE" = "NONE";
  if (core.m15TrendLongOk) m15Dir = "BULL";
  else if (core.m15TrendShortOk) m15Dir = "BEAR";
  else if (core.ema15mTrend === "BULL" || core.ema15mTrend === "BEAR") {
    m15Dir = core.ema15mTrend;
  }
  const againstH1 = (h1Dir === "BULL" || h1Dir === "BEAR") && h1Dir !== signalDir;
  const againstM15 =
    (m15Dir === "BULL" || m15Dir === "BEAR") && m15Dir !== signalDir;
  const ok = !againstH1 && !againstM15;
  const detail = `1h ${h1Dir} | 15m ${m15Dir}`;
  return { ok, detail };
}

function asErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "unknown_error");
}

function extractList(data: any) {
  return data?.result?.list ?? data?.list ?? [];
}

type EntryFallback = { triggerPrice?: number; price?: number; ts: number };

function buildEntryFallback(list: any[]) {
  const map = new Map<string, EntryFallback>();
  for (const o of list) {
    const symbol = String(o?.symbol ?? "");
    const side = String(o?.side ?? "");
    if (!symbol || !side) continue;
    const reduceOnly = Boolean(o?.reduceOnly ?? o?.reduce_only ?? o?.reduce);
    if (reduceOnly) continue;
    const triggerPrice = toNumber(o?.triggerPrice ?? o?.trigger_price);
    const price = toNumber(o?.price);
    if (!Number.isFinite(triggerPrice) && !Number.isFinite(price)) continue;
    const ts = toEpoch(
      o?.createdTime ?? o?.created_at ?? o?.updatedTime ?? o?.updated_at
    );
    const entry: EntryFallback = {
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

type ClosedPnlRecord = { symbol: string; pnl: number; ts: number };

function computeLossStreak(
  records: ClosedPnlRecord[] | null | undefined,
  maxCheck = 3
) {
  if (!Array.isArray(records) || records.length === 0) return 0;
  const sorted = [...records].sort((a, b) => b.ts - a.ts);
  let streak = 0;
  for (const r of sorted) {
    if (r.pnl < 0) {
      streak += 1;
      if (streak >= maxCheck) break;
    } else {
      break;
    }
  }
  return streak;
}

const MIN_PROTECTION_DISTANCE_PCT = 0.0005;
const MIN_PROTECTION_ATR_FACTOR = 0.05;
const TRAIL_ACTIVATION_R_MULTIPLIER = 1.0;

function resolveMinProtectionDistance(entry: number, atr?: number) {
  const pctDistance = entry * MIN_PROTECTION_DISTANCE_PCT;
  const atrDistance = Number.isFinite(atr)
    ? (atr as number) * MIN_PROTECTION_ATR_FACTOR
    : 0;
  return Math.max(pctDistance, atrDistance);
}

function normalizeProtectionLevels(
  entry: number,
  side: "Buy" | "Sell",
  sl?: number,
  tp?: number,
  atr?: number
) {
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
  } else {
    if (Number.isFinite(nextSl) && nextSl <= entry + minDistance) {
      nextSl = entry + minDistance;
    }
    if (Number.isFinite(nextTp) && nextTp >= entry - minDistance) {
      nextTp = entry - minDistance;
    }
  }
  return { sl: nextSl, tp: nextTp, minDistance };
}

function computeRMultiple(
  entry: number,
  sl: number,
  price: number,
  side: "Buy" | "Sell"
) {
  const risk = Math.abs(entry - sl);
  if (!Number.isFinite(risk) || risk <= 0) return Number.NaN;
  const move = side === "Buy" ? price - entry : entry - price;
  return move / risk;
}

const TRAIL_PROFILE_BY_RISK_MODE: Record<
  AISettings["riskMode"],
  { activateR: number; lockR: number; retracementRate?: number }
> = {
  "ai-matic": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
  "ai-matic-x": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
  "ai-matic-scalp": { activateR: 0.6, lockR: 0.3 },
  "ai-matic-tree": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
  "ai-matic-pro": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
};
const TRAIL_PROFILE_BY_RISK_MODE_CHEAT: Record<
  AISettings["riskMode"],
  { activateR: number; lockR: number; retracementRate?: number }
> = {
  "ai-matic": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
  "ai-matic-x": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
  "ai-matic-scalp": { activateR: 0.6, lockR: 0.3 },
  "ai-matic-tree": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
  "ai-matic-pro": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
};
const TRAIL_SYMBOL_MODE: Partial<Record<Symbol, "on" | "off">> = {
  SOLUSDT: "on",
  ADAUSDT: "on",
  BTCUSDT: "on",
  ETHUSDT: "on",
};
const CHEAT_SHEET_SETUP_BY_RISK_MODE: Partial<
  Record<AISettings["riskMode"], string>
> = {
  "ai-matic": "ai-matic-core",
  "ai-matic-x": "ai-matic-x-smart-money-combo",
  "ai-matic-scalp": "ai-matic-scalp-scalpera",
  "ai-matic-tree": "ai-matic-decision-tree",
};

const PROFILE_BY_RISK_MODE: Record<AISettings["riskMode"], Profile> = {
  "ai-matic": "AI-MATIC",
  "ai-matic-x": "AI-MATIC-X",
  "ai-matic-scalp": "AI-MATIC-SCALP",
  "ai-matic-tree": "AI-MATIC-TREE",
  "ai-matic-pro": "AI-MATIC-PRO",
};


export function useTradingBot(
  mode?: TradingMode,
  useTestnet = false,
  authToken?: string
) {
  const allowOrderCancel = true;
  const allowPositionClose = true;
  const [settings, setSettings] = useState<AISettings>(
    () => loadStoredSettings() ?? DEFAULT_SETTINGS
  );
  const apiBase = useMemo(() => getApiBase(Boolean(useTestnet)), [useTestnet]);
  const activeSymbols = useMemo<Symbol[]>(() => {
    const next = filterSupportedSymbols(settings.selectedSymbols);
    return next.length > 0 ? next : [...SUPPORTED_SYMBOLS];
  }, [settings.selectedSymbols]);
  const feedSymbols = useMemo<Symbol[]>(() => {
    if (activeSymbols.includes("BTCUSDT")) return activeSymbols;
    return ["BTCUSDT", ...activeSymbols];
  }, [activeSymbols]);
  const engineConfig = useMemo<Partial<BotConfig>>(() => {
    const proMode = settings.riskMode === "ai-matic-pro";
    const cheatSheetEnabled = settings.strategyCheatSheetEnabled && !proMode;
    const cheatSheetSetupId = cheatSheetEnabled
      ? CHEAT_SHEET_SETUP_BY_RISK_MODE[settings.riskMode]
      : undefined;
    const baseConfig: Partial<BotConfig> = {
      useStrategyCheatSheet: cheatSheetEnabled,
      ...(cheatSheetSetupId ? { cheatSheetSetupId } : {}),
    };
    const strictness =
      settings.entryStrictness === "base"
        ? "ultra"
        : settings.entryStrictness;
    if (settings.riskMode === "ai-matic" || settings.riskMode === "ai-matic-tree") {
      return {
        ...baseConfig,
        strategyProfile:
          settings.riskMode === "ai-matic" ? "ai-matic" : "ai-matic-tree",
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
      const strictness =
        settings.entryStrictness === "base"
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
  }, [settings.entryStrictness, settings.riskMode, settings.strategyCheatSheetEnabled]);

  const [positions, setPositions] = useState<ActivePosition[] | null>(null);
  const [orders, setOrders] = useState<TestnetOrder[] | null>(null);
  const [trades, setTrades] = useState<TestnetTrade[] | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[] | null>(null);
  const [scanDiagnostics, setScanDiagnostics] = useState<
    Record<string, any> | null
  >(null);
  const [assetPnlHistory, setAssetPnlHistory] = useState<AssetPnlMap | null>(
    () => loadPnlHistory()
  );
  const [closedPnlRecords, setClosedPnlRecords] = useState<
    ClosedPnlRecord[] | null
  >(null);
  const [walletSnapshot, setWalletSnapshot] = useState<{
    totalEquity: number;
    availableBalance: number;
    totalWalletBalance: number;
  } | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [recentErrors, setRecentErrors] = useState<string[]>([]);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const fastPollRef = useRef(false);
  const slowPollRef = useRef(false);
  const orderSnapshotRef = useRef<
    Map<
      string,
      {
        status: string;
        qty: number;
        price: number | null;
        side: string;
        symbol: string;
        orderLinkId?: string;
      }
    >
  >(new Map());
  const positionSnapshotRef = useRef<Map<string, { size: number; side: string }>>(
    new Map()
  );
  const execSeenRef = useRef<Set<string>>(new Set());
  const pnlSeenRef = useRef<Set<string>>(new Set());
  const lastLossBySymbolRef = useRef<Map<string, number>>(new Map());
  const lastCloseBySymbolRef = useRef<Map<string, number>>(new Map());
  const lastIntentBySymbolRef = useRef<Map<string, number>>(new Map());
  const entryOrderLockRef = useRef<Map<string, number>>(new Map());
  const signalLogThrottleRef = useRef<Map<string, number>>(new Map());
  const skipLogThrottleRef = useRef<Map<string, number>>(new Map());
  const fastOkRef = useRef(false);
  const slowOkRef = useRef(false);
  const modeRef = useRef<TradingMode | undefined>(mode);
  const positionsRef = useRef<ActivePosition[]>([]);
  const ordersRef = useRef<TestnetOrder[]>([]);
  const cancelingOrdersRef = useRef<Set<string>>(new Set());
  const autoCloseCooldownRef = useRef<Map<string, number>>(new Map());
  const cheatLimitMetaRef = useRef<Map<string, CheatLimitMeta>>(new Map());
  const partialExitRef = useRef<Map<string, { taken: boolean; lastAttempt: number }>>(
    new Map()
  );
  const proTargetsRef = useRef<
    Map<
      string,
      {
        t1: number;
        t2: number;
        timeStopMinutes: number;
        entryTfMin: number;
        entryPrice: number;
        side: "Buy" | "Sell";
        setAt: number;
      }
    >
  >(new Map());
  const proPartialRef = useRef<
    Map<
      string,
      {
        t1: number;
        t2: number;
        timeStopMinutes: number;
        entryPrice: number;
        side: "Buy" | "Sell";
        t1Taken: boolean;
        lastAttempt: number;
      }
    >
  >(new Map());
  const decisionRef = useRef<
    Record<string, { decision: PriceFeedDecision; ts: number }>
  >({});
  const signalSeenRef = useRef<Set<string>>(new Set());
  const intentPendingRef = useRef<Set<string>>(new Set());
  const feedPauseRef = useRef<Set<string>>(new Set());
  const trailingSyncRef = useRef<Map<string, number>>(new Map());
  const trailOffsetRef = useRef<Map<string, number>>(new Map());
  const aiMaticTp1Ref = useRef<
    Map<string, { entry: number; tp1: number; side: "Buy" | "Sell"; setAt: number }>
  >(new Map());
  const aiMaticTrailCooldownRef = useRef<Map<string, number>>(new Map());
  const aiMaticStructureLogRef = useRef<Map<string, number>>(new Map());
  const scalpExitStateRef = useRef<
    Map<string, { mode: "TRAIL" | "TP"; switched: boolean; decidedAt: number }>
  >(new Map());
  const scalpActionCooldownRef = useRef<Map<string, number>>(new Map());
  const scalpPartialCooldownRef = useRef<Map<string, number>>(new Map());
  const scalpTrailCooldownRef = useRef<Map<string, number>>(new Map());
  const settingsRef = useRef<AISettings>(settings);
  const walletRef = useRef<typeof walletSnapshot | null>(walletSnapshot);
  const handleDecisionRef = useRef<
    ((symbol: string, decision: PriceFeedDecision) => void) | null
  >(null);
  const feedLogRef = useRef<{ env: string; ts: number } | null>(null);
  const logDedupeRef = useRef<Map<string, number>>(new Map());
  const gateOverridesRef = useRef<Record<string, boolean>>({});
  const feedLastTickRef = useRef(0);
  const lastHeartbeatRef = useRef(0);
  const lastStateRef = useRef<Map<string, string>>(new Map());
  const lastRestartRef = useRef(0);
  const [feedEpoch, setFeedEpoch] = useState(0);
  const symbolTickRef = useRef<Map<string, number>>(new Map());

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
    if (positions) positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (orders) ordersRef.current = orders;
  }, [orders]);

  const fetchJson = useCallback(
    async (path: string, params?: Record<string, string>) => {
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
    },
    [apiBase, authToken]
  );

  const postJson = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
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
    },
    [apiBase, authToken]
  );

  const addLogEntries = useCallback((entries: LogEntry[]) => {
    if (!entries.length) return;
    const dedupe = logDedupeRef.current;
    const now = Date.now();
    const filtered: LogEntry[] = [];
    for (const entry of entries) {
      const key = `${entry.action}:${entry.message}`;
      const last = dedupe.get(key);
      if (last && now - last < LOG_DEDUPE_WINDOW_MS) continue;
      dedupe.set(key, now);
      filtered.push(entry);
    }
    if (dedupe.size > 1000) {
      for (const [key, ts] of dedupe.entries()) {
        if (now - ts > 60_000) dedupe.delete(key);
      }
    }
    if (!filtered.length) return;
    setLogEntries((prev) => {
      const list = prev ? [...prev] : [];
      const map = new Map(list.map((entry) => [entry.id, entry]));
      for (const entry of filtered) {
        map.set(entry.id, entry);
      }
      const merged = Array.from(map.values()).sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      return merged.slice(0, 200);
    });
  }, []);


  const isGateEnabled = useCallback((name: string) => {
    const value = gateOverridesRef.current?.[name];
    return typeof value === "boolean" ? value : true;
  }, []);

  const evaluateChecklistPass = useCallback(
    (gates: { name: string; ok: boolean; detail?: string }[]) => {
      const eligible = gates.filter(
        (gate) =>
          isGateEnabled(gate.name) && gate.detail !== "not required"
      );
      const passed = eligible.filter((gate) => gate.ok).length;
      return {
        eligibleCount: eligible.length,
        passedCount: passed,
        pass: eligible.length > 0 ? passed >= MIN_CHECKLIST_PASS : false,
      };
    },
    [isGateEnabled]
  );

  const buildBiasSignal = useCallback(
    (
      symbol: Symbol,
      core: CoreV2Metrics,
      now: number,
      bias: "BULL" | "BEAR",
      message: string,
      risk = 0.6
    ) => {
      if (!core) return null;
      const normalizedEntry = toNumber(core.ltfClose);
      const normalizedAtr = toNumber(core.atr14);
      const normalizedPivotLow = toNumber(core.pivotLow);
      const normalizedPivotHigh = toNumber(core.pivotHigh);
      if (!Number.isFinite(normalizedEntry) || normalizedEntry <= 0) return null;
      let scale = 1;
      if (Number.isFinite(normalizedPivotLow) && normalizedPivotLow > 0) {
        const ratio = Math.max(normalizedPivotLow, normalizedEntry) /
          Math.min(normalizedPivotLow, normalizedEntry);
        if (ratio >= 5) scale = normalizedEntry / normalizedPivotLow;
      } else if (Number.isFinite(normalizedPivotHigh) && normalizedPivotHigh > 0) {
        const ratio = Math.max(normalizedPivotHigh, normalizedEntry) /
          Math.min(normalizedPivotHigh, normalizedEntry);
        if (ratio >= 5) scale = normalizedEntry / normalizedPivotHigh;
      }
      const entry = normalizedEntry;
      if (!Number.isFinite(entry) || entry <= 0) return null;
      const atr = Number.isFinite(normalizedAtr) ? normalizedAtr * scale : Number.NaN;
      const fallbackOffset =
        Number.isFinite(atr) && atr > 0 ? atr * 1.5 : Number.NaN;
      let sl =
        bias === "BULL"
          ? (Number.isFinite(normalizedPivotLow) ? normalizedPivotLow * scale : Number.NaN)
          : (Number.isFinite(normalizedPivotHigh) ? normalizedPivotHigh * scale : Number.NaN);
      if (!Number.isFinite(sl) || sl <= 0) {
        if (!Number.isFinite(fallbackOffset)) return null;
        sl = bias === "BULL" ? entry - fallbackOffset : entry + fallbackOffset;
      }
      if (bias === "BULL" && sl >= entry) {
        sl = Number.isFinite(fallbackOffset) ? entry - fallbackOffset : Number.NaN;
      }
      if (bias === "BEAR" && sl <= entry) {
        sl = Number.isFinite(fallbackOffset) ? entry + fallbackOffset : Number.NaN;
      }
      if (!Number.isFinite(sl) || sl <= 0 || sl === entry) return null;
      const riskSize = Math.abs(entry - sl);
      const tp = bias === "BULL" ? entry + 2 * riskSize : entry - 2 * riskSize;
      if (!Number.isFinite(tp) || tp <= 0) return null;
      return {
        id: `${symbol}-${now}-bias`,
        symbol,
        intent: {
          side: bias === "BULL" ? "buy" : "sell",
          entry,
          sl,
          tp,
        },
        entryType: "LIMIT_MAKER_FIRST",
        kind: "PULLBACK",
        risk,
        message,
        createdAt: new Date(now).toISOString(),
      } as PriceFeedDecision["signal"];
    },
    []
  );

  const buildChecklistSignal = useCallback(
    (symbol: Symbol, decision: PriceFeedDecision, now: number) => {
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      if (!core) return null;
      const bias =
        core.htfBias !== "NONE"
          ? core.htfBias
          : core.ema15mTrend !== "NONE"
            ? core.ema15mTrend
            : core.emaCrossDir !== "NONE"
              ? core.emaCrossDir
              : "NONE";
      if (bias !== "BULL" && bias !== "BEAR") return null;
      const next = buildBiasSignal(
        symbol,
        core,
        now,
        bias,
        "Checklist auto-signál",
        0.6
      );
      if (next) {
        next.id = `${symbol}-${now}-checklist`;
      }
      return next;
    },
    [buildBiasSignal]
  );

  const normalizeBias = useCallback((value: unknown): "bull" | "bear" | null => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "buy" || raw === "long" || raw === "bull") return "bull";
    if (raw === "sell" || raw === "short" || raw === "bear") return "bear";
    return null;
  }, []);

  const isEntryOrder = useCallback((order: TestnetOrder | any): boolean => {
    if (!order) return false;
    const reduceOnly = Boolean(order?.reduceOnly ?? order?.reduce_only ?? order?.reduce);
    if (reduceOnly) return false;
    const filter = String(order?.orderFilter ?? order?.order_filter ?? "").toLowerCase();
    const stopType = String(order?.stopOrderType ?? order?.stop_order_type ?? "").toLowerCase();
    if (
      filter === "tpsl" ||
      stopType === "takeprofit" ||
      stopType === "stoploss" ||
      stopType === "trailingstop"
    ) {
      return false;
    }
    const status = String(order?.status ?? "").toLowerCase();
    if (!status) return true;
    if (status.includes("filled") || status.includes("cancel") || status.includes("reject")) {
      return false;
    }
    return true;
  }, []);

  const isActiveEntryOrder = useCallback(
    (order: TestnetOrder | any): boolean => {
      if (!isEntryOrder(order)) return false;
      const status = String(order?.status ?? "").toLowerCase();
      if (!status) return false;
      return (
        status.includes("new") ||
        status.includes("open") ||
        status.includes("partially") ||
        status.includes("created") ||
        status.includes("trigger") ||
        status.includes("active")
      );
    },
    [isEntryOrder]
  );

  const getOpenBiasState = useCallback(() => {
    const biases = new Set<"bull" | "bear">();
    let btcBias: "bull" | "bear" | null = null;
    positionsRef.current.forEach((p) => {
      const size = toNumber(p.size ?? p.qty);
      if (!Number.isFinite(size) || size <= 0) return;
      const bias = normalizeBias(p.side);
      if (!bias) return;
      biases.add(bias);
      if (String(p.symbol ?? "").toUpperCase() === "BTCUSDT" && !btcBias) {
        btcBias = bias;
      }
    });
    ordersRef.current.forEach((o: any) => {
      if (!isEntryOrder(o)) return;
      const bias = normalizeBias(o.side);
      if (!bias) return;
      biases.add(bias);
      if (String(o.symbol ?? "").toUpperCase() === "BTCUSDT" && !btcBias) {
        btcBias = bias;
      }
    });
    return { biases, btcBias };
  }, [isEntryOrder, normalizeBias]);

  const resolveBtcBias = useCallback(
    (fallbackDir?: "bull" | "bear", symbolUpper?: string) => {
      const { btcBias: openBtcBias } = getOpenBiasState();
      let btcBias = openBtcBias ?? null;
      if (!btcBias) {
        const btcDecision = decisionRef.current["BTCUSDT"]?.decision;
        const btcConsensus = (btcDecision as any)?.htfTrend?.consensus;
        const btcDir =
          btcConsensus === "bull" || btcConsensus === "bear"
            ? btcConsensus
            : String((btcDecision as any)?.trend ?? "").toLowerCase();
        if (btcDir === "bull" || btcDir === "bear") {
          btcBias = btcDir;
        }
      }
      if (!btcBias && symbolUpper === "BTCUSDT" && fallbackDir) {
        btcBias = fallbackDir;
      }
      return btcBias;
    },
    [getOpenBiasState]
  );

  const getEquityValue = useCallback(() => {
    const wallet = walletRef.current;
    const availableBalance = toNumber(wallet?.availableBalance);
    if (useTestnet && Number.isFinite(availableBalance) && availableBalance > 0) {
      return availableBalance;
    }
    const totalEquity = toNumber(wallet?.totalEquity);
    if (Number.isFinite(totalEquity) && totalEquity > 0) return totalEquity;
    const totalWalletBalance = toNumber(wallet?.totalWalletBalance);
    if (Number.isFinite(totalWalletBalance) && totalWalletBalance > 0) {
      return totalWalletBalance;
    }
    if (Number.isFinite(availableBalance) && availableBalance > 0) {
      return availableBalance;
    }
    return Number.NaN;
  }, [useTestnet]);

  const isSessionAllowed = useCallback(
    (_now: Date, _next: AISettings) => true,
    []
  );

  const computeNotionalForSignal = useCallback(
    (symbol: Symbol, entry: number, sl: number) => {
      const equity = getEquityValue();
      if (!Number.isFinite(equity) || equity <= 0) {
        return { ok: false, reason: "missing_equity" as const };
      }

      const riskPerUnit = Math.abs(entry - sl);
      if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
        return { ok: false, reason: "invalid_sl_distance" as const };
      }

      const settings = settingsRef.current;
      const riskPct = CORE_V2_RISK_PCT[settings.riskMode] ?? 0;
      const riskBudget = equity * riskPct;
      if (!Number.isFinite(riskBudget) || riskBudget <= 0) {
        return { ok: false, reason: "invalid_risk_budget" as const };
      }

      let qty = riskBudget / riskPerUnit;
      let notional = qty * entry;
      if (!Number.isFinite(notional) || notional <= 0) {
        return { ok: false, reason: "invalid_notional" as const };
      }

      const notionalCap = equity * CORE_V2_NOTIONAL_CAP_PCT;
      if (Number.isFinite(notionalCap) && notionalCap > 0 && notional > notionalCap) {
        notional = notionalCap;
        qty = notional / entry;
      }

      if (notional < MIN_POSITION_NOTIONAL_USD) {
        return { ok: false, reason: "below_min_notional" as const };
      }
      if (notional > MAX_POSITION_NOTIONAL_USD) {
        notional = MAX_POSITION_NOTIONAL_USD;
        qty = notional / entry;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, reason: "invalid_qty" as const };
      }
      const riskUsd = riskPerUnit * qty;
      return { ok: true as const, notional, qty, riskUsd, equity };
    },
    [getEquityValue]
  );

  const computeFixedSizing = useCallback(
    (symbol: Symbol, entry: number, sl: number) => {
      if (!useTestnet) return null;
      if (!Number.isFinite(entry) || entry <= 0) {
        return { ok: false as const, reason: "invalid_entry" as const };
      }
      const targetNotional = Math.min(
        Math.max(resolveOrderNotional(symbol), MIN_POSITION_NOTIONAL_USD),
        MAX_POSITION_NOTIONAL_USD
      );
      const resolvedQty = targetNotional / entry;
      if (!Number.isFinite(resolvedQty) || resolvedQty <= 0) {
        return { ok: false as const, reason: "invalid_fixed_qty" as const };
      }
      const notional = resolvedQty * entry;
      if (!Number.isFinite(notional) || notional <= 0) {
        return { ok: false as const, reason: "invalid_fixed_notional" as const };
      }
      const riskPerUnit = Math.abs(entry - sl);
      const riskUsd =
        Number.isFinite(riskPerUnit) && riskPerUnit > 0
          ? riskPerUnit * resolvedQty
          : Number.NaN;
      const equity = getEquityValue();
      let adjustedNotional = notional;
      let adjustedQty = resolvedQty;
      return {
        ok: true as const,
        notional: adjustedNotional,
        qty: adjustedQty,
        riskUsd,
        equity,
      };
    },
    [getEquityValue, useTestnet]
  );

  const computeTrailingPlan = useCallback(
    (entry: number, sl: number, side: "Buy" | "Sell", symbol: Symbol) => {
      const settings = settingsRef.current;
      const isScalpProfile = settings.riskMode === "ai-matic-scalp";
      const isAiMaticProfile = settings.riskMode === "ai-matic";
      if (isScalpProfile) {
        return null;
      }
      if (isAiMaticProfile) {
        return null;
      }
      const symbolMode = TRAIL_SYMBOL_MODE[symbol];
      const forceTrail =
        settings.riskMode === "ai-matic" ||
        settings.riskMode === "ai-matic-x" ||
        settings.riskMode === "ai-matic-tree";
      if (symbolMode === "off") return null;
      if (!forceTrail && !settings.lockProfitsWithTrail && symbolMode !== "on") {
        return null;
      }
      const normalized = normalizeProtectionLevels(entry, side, sl);
      const normalizedSl = Number.isFinite(normalized.sl) ? normalized.sl : sl;
      const r = Math.abs(entry - normalizedSl);
      if (!Number.isFinite(r) || r <= 0) return null;
      const profileMap = settings.strategyCheatSheetEnabled
        ? TRAIL_PROFILE_BY_RISK_MODE_CHEAT
        : TRAIL_PROFILE_BY_RISK_MODE;
      const profile =
        profileMap[settings.riskMode] ?? profileMap["ai-matic"];
      const activateR = profile.activateR;
      const lockR = profile.lockR;
      const overrideRate = trailOffsetRef.current.get(symbol);
      const usePercentActivation =
        isScalpProfile ||
        (settings.riskMode === "ai-matic-tree" &&
          Number.isFinite(overrideRate) &&
          (overrideRate as number) > 0);
      const effectiveRate =
        Number.isFinite(overrideRate) && overrideRate > 0
          ? overrideRate
          : profile.retracementRate;
      const minDistance = resolveMinProtectionDistance(entry);
      const rawDistance = Number.isFinite(effectiveRate)
        ? entry * (effectiveRate as number)
        : Math.abs(activateR - lockR) * r;
      const distance = Math.max(rawDistance, minDistance);
      if (!Number.isFinite(distance) || distance <= 0) return null;
      const dir = side === "Buy" ? 1 : -1;
      const activePrice = usePercentActivation
        ? entry + dir * distance
        : entry +
          dir *
            Math.max(
              activateR * TRAIL_ACTIVATION_R_MULTIPLIER * r,
              minDistance
            );
      if (!Number.isFinite(activePrice) || activePrice <= 0) return null;
      return { trailingStop: distance, trailingActivePrice: activePrice };
    },
    []
  );

  const syncTrailingProtection = useCallback(
    async (positions: ActivePosition[]) => {
      const now = Date.now();
      const seenSymbols = new Set(
        positions.map((p) => String(p.symbol ?? "")).filter(Boolean)
      );
      for (const symbol of trailingSyncRef.current.keys()) {
        if (!seenSymbols.has(symbol)) {
          trailingSyncRef.current.delete(symbol);
        }
      }
      for (const symbol of trailOffsetRef.current.keys()) {
        const hasPosition = seenSymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasOrder = ordersRef.current.some(
          (order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol
        );
        if (!hasPosition && !hasOrder && !hasPending) {
          trailOffsetRef.current.delete(symbol);
        }
      }
      for (const symbol of aiMaticTp1Ref.current.keys()) {
        const hasPosition = seenSymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasOrder = ordersRef.current.some(
          (order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol
        );
        if (!hasPosition && !hasOrder && !hasPending) {
          aiMaticTp1Ref.current.delete(symbol);
          aiMaticTrailCooldownRef.current.delete(symbol);
        }
      }
      for (const symbol of proTargetsRef.current.keys()) {
        const hasPosition = seenSymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasOrder = ordersRef.current.some(
          (order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol
        );
        if (!hasPosition && !hasOrder && !hasPending) {
          proTargetsRef.current.delete(symbol);
        }
      }
      for (const symbol of scalpExitStateRef.current.keys()) {
        const hasPosition = seenSymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasOrder = ordersRef.current.some(
          (order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol
        );
        if (!hasPosition && !hasOrder && !hasPending) {
          scalpExitStateRef.current.delete(symbol);
          scalpActionCooldownRef.current.delete(symbol);
          scalpPartialCooldownRef.current.delete(symbol);
          scalpTrailCooldownRef.current.delete(symbol);
        }
      }
      const activePositionKeys = new Set(
        positions
          .map((pos) =>
            String(pos.positionId || pos.id || `${pos.symbol}:${pos.openedAt}`)
          )
          .filter(Boolean)
      );
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
        if (!symbol) continue;
        const settings = settingsRef.current;
        const isScalpProfile = settings.riskMode === "ai-matic-scalp";
        const isProProfile = settings.riskMode === "ai-matic-pro";
        const positionKey = String(
          pos.positionId || pos.id || `${pos.symbol}:${pos.openedAt}`
        );
        const currentTrail = toNumber(pos.currentTrailingStop);
        const entry = toNumber(pos.entryPrice);
        const sl = toNumber(pos.sl);
        if (
          !Number.isFinite(entry) ||
          !Number.isFinite(sl) ||
          entry <= 0 ||
          sl <= 0
        ) {
          continue;
        }
        const side = pos.side === "Sell" ? "Sell" : "Buy";
        if (isProProfile && positionKey) {
          const price = toNumber(pos.markPrice);
          const sizeRaw = Math.abs(toNumber(pos.size ?? pos.qty));
          let proState = proPartialRef.current.get(positionKey);
          if (!proState) {
            const seed = proTargetsRef.current.get(symbol);
            if (
              seed &&
              Number.isFinite(seed.entryPrice) &&
              Number.isFinite(entry) &&
              Math.abs(seed.entryPrice - entry) / entry <= 0.01
            ) {
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
            if (
              Number.isFinite(openedAtMs) &&
              proState.timeStopMinutes > 0 &&
              now - openedAtMs >= proState.timeStopMinutes * 60_000 &&
              now - proState.lastAttempt >= 30_000
            ) {
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
              } catch (err) {
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
            const t1Hit =
              Number.isFinite(price) &&
              Number.isFinite(proState.t1) &&
              (side === "Buy" ? price >= proState.t1 : price <= proState.t1);
            if (
              t1Hit &&
              !proState.t1Taken &&
              now - proState.lastAttempt >= 30_000 &&
              Number.isFinite(sizeRaw) &&
              sizeRaw > 0
            ) {
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
                const beSl =
                  side === "Buy"
                    ? entry - minDistance
                    : entry + minDistance;
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
              } catch (err) {
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
        if (!isScalpProfile && !isProProfile && settings.riskMode === "ai-matic") {
          const tpMeta = aiMaticTp1Ref.current.get(symbol);
          const price = toNumber(pos.markPrice);
          const trailingActive = toNumber(
            (pos as any)?.trailingActivePrice ??
              (pos as any)?.activePrice ??
              (pos as any)?.activationPrice
          );
          const trailingStop = toNumber(
            (pos as any)?.trailingStop ??
              (pos as any)?.trailingStopDistance ??
              (pos as any)?.trailingStopPrice ??
              (pos as any)?.trailPrice
          );
          const hasTrail =
            Number.isFinite(trailingActive) || Number.isFinite(trailingStop);
          const rMultiple =
            Number.isFinite(price) && Number.isFinite(sl)
              ? computeRMultiple(entry, sl, price, side)
              : Number.NaN;
          if (!hasTrail && Number.isFinite(rMultiple) && rMultiple >= AI_MATIC_TRAIL_PROTECT_R) {
            const lastAttempt = aiMaticTrailCooldownRef.current.get(symbol) ?? 0;
            if (now - lastAttempt >= 30_000) {
              aiMaticTrailCooldownRef.current.set(symbol, now);
              const atr = toNumber(
                (decisionRef.current[symbol]?.decision as any)?.coreV2?.atr14
              );
              const minDistance = resolveMinProtectionDistance(entry);
              const risk = Math.abs(entry - sl);
              const activationDistance = Math.max(
                Number.isFinite(risk) ? risk * AI_MATIC_TRAIL_PROTECT_R : 0,
                minDistance
              );
              const distance = Math.max(
                Number.isFinite(atr) ? atr * AI_MATIC_TRAIL_ATR_MULT : 0,
                entry * AI_MATIC_TRAIL_PCT,
                minDistance
              );
              const dir = side === "Buy" ? 1 : -1;
              const activePrice = entry + dir * activationDistance;
              if (Number.isFinite(distance) && distance > 0 && Number.isFinite(activePrice) && activePrice > 0) {
                try {
                  await postJson("/protection", {
                    symbol,
                    trailingStop: distance,
                    trailingActivePrice: activePrice,
                    positionIdx: Number.isFinite(pos.positionIdx)
                      ? pos.positionIdx
                      : undefined,
                  });
                  addLogEntries([
                    {
                      id: `ai-matic-trail:${symbol}:${now}`,
                      timestamp: new Date(now).toISOString(),
                      action: "STATUS",
                      message: `${symbol} AI-MATIC trailing protection active`,
                    },
                  ]);
                } catch (err) {
                  addLogEntries([
                    {
                      id: `ai-matic-trail:error:${symbol}:${now}`,
                      timestamp: new Date(now).toISOString(),
                      action: "ERROR",
                      message: `${symbol} AI-MATIC trailing protection failed: ${asErrorMessage(err)}`,
                    },
                  ]);
                }
              }
            }
          }
          if (
            tpMeta &&
            Number.isFinite(entry) &&
            Number.isFinite(tpMeta.entry) &&
            Math.abs(tpMeta.entry - entry) / Math.max(entry, 1e-8) <= 0.01
          ) {
            const tpHit =
              Number.isFinite(price) &&
              Number.isFinite(tpMeta.tp1) &&
              (tpMeta.side === "Buy" ? price >= tpMeta.tp1 : price <= tpMeta.tp1);
            if (tpHit && !hasTrail) {
              const lastAttempt = aiMaticTrailCooldownRef.current.get(symbol) ?? 0;
              if (now - lastAttempt >= 30_000) {
                aiMaticTrailCooldownRef.current.set(symbol, now);
                const atr = toNumber(
                  (decisionRef.current[symbol]?.decision as any)?.coreV2?.atr14
                );
                const distance = Math.max(
                  Number.isFinite(atr) ? atr * AI_MATIC_TRAIL_ATR_MULT : 0,
                  entry * AI_MATIC_TRAIL_PCT
                );
                if (Number.isFinite(distance) && distance > 0) {
                  try {
                    await postJson("/protection", {
                      symbol,
                      trailingStop: distance,
                      trailingActivePrice: tpMeta.tp1,
                      positionIdx: Number.isFinite(pos.positionIdx)
                        ? pos.positionIdx
                        : undefined,
                    });
                    addLogEntries([
                      {
                        id: `ai-matic-tp1:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `${symbol} TP1 hit -> trailing activated`,
                      },
                    ]);
                    aiMaticTp1Ref.current.delete(symbol);
                  } catch (err) {
                    addLogEntries([
                      {
                        id: `ai-matic-tp1:error:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "ERROR",
                        message: `${symbol} TP1 trailing failed: ${asErrorMessage(err)}`,
                      },
                    ]);
                  }
                }
              }
            }
          }
        }
        if (!isScalpProfile && !isProProfile && positionKey) {
          const partialState = partialExitRef.current.get(positionKey);
          const lastAttempt = partialState?.lastAttempt ?? 0;
          const price = toNumber(pos.markPrice);
          const rMultiple =
            Number.isFinite(price) && Number.isFinite(sl)
              ? computeRMultiple(entry, sl, price, side)
              : Number.NaN;
          if (
            Number.isFinite(rMultiple) &&
            rMultiple >= NONSCALP_PARTIAL_TAKE_R &&
            (!partialState || !partialState.taken) &&
            now - lastAttempt >= NONSCALP_PARTIAL_COOLDOWN_MS
          ) {
            partialExitRef.current.set(positionKey, {
              taken: false,
              lastAttempt: now,
            });
            const sizeRaw = Math.abs(toNumber(pos.size ?? pos.qty));
            const reduceQty = Math.min(
              sizeRaw,
              sizeRaw * NONSCALP_PARTIAL_FRACTION
            );
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
                const beSl =
                  side === "Buy"
                    ? entry - minDistance
                    : entry + minDistance;
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
                    message: `${symbol} partial ${Math.round(
                      NONSCALP_PARTIAL_FRACTION * 100
                    )}% @ ${NONSCALP_PARTIAL_TAKE_R}R + BE`,
                  },
                ]);
              } catch (err) {
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
        const plan = computeTrailingPlan(
          entry,
          sl,
          side,
          symbol as Symbol
        );
        if (!plan) continue;

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
              message: `${symbol} TS nastaven | aktivace ${formatNumber(
                plan.trailingActivePrice ?? Number.NaN,
                6
              )} | distance ${formatNumber(
                plan.trailingStop ?? Number.NaN,
                6
              )}`,
            },
          ]);
        } catch (err) {
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
    },
    [addLogEntries, computeTrailingPlan, isEntryOrder, postJson]
  );

  const getSymbolContext = useCallback(
    (symbol: string, decision?: PriceFeedDecision | null) => {
      const settings = settingsRef.current;
      const now = new Date();
      const sessionOk = isSessionAllowed(now, settings);
      const maxPositions = toNumber(settings.maxOpenPositions);
      const pendingIntents = intentPendingRef.current.size;
      const openPositionsCount =
        positionsRef.current.length + (useTestnet ? 0 : pendingIntents);
      const maxPositionsOk = !Number.isFinite(maxPositions)
        ? true
        : maxPositions > 0
          ? openPositionsCount < maxPositions
          : false;
      const hasPosition = positionsRef.current.some((p) => {
        if (p.symbol !== symbol) return false;
        const size = toNumber(p.size ?? p.qty);
        return Number.isFinite(size) && size > 0;
      });
      const openOrdersCount =
        ordersRef.current.length + (useTestnet ? 0 : pendingIntents);
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
    },
    [isSessionAllowed, useTestnet]
  );

  const resolveTrendGate = useCallback(
    (
      decision: PriceFeedDecision | null | undefined,
      signal?: PriceFeedDecision["signal"] | null
    ) => {
      const settings = settingsRef.current;
      if (settings.riskMode === "ai-matic-pro") {
        return { ok: true, detail: "disabled (PRO)" };
      }
      const isAiMaticX = settings.riskMode === "ai-matic-x";
      const xContext = (decision as any)?.xContext as AiMaticXContext | undefined;
      if (isAiMaticX && xContext) {
        const detailParts = [
          `X 1h ${xContext.htfTrend}`,
          `5m ${xContext.ltfTrend}`,
          `setup ${xContext.setup}`,
        ];
        if (xContext.mode) detailParts.push(`mode ${xContext.mode}`);
        if (Number.isFinite(xContext.acceptanceCloses) && xContext.acceptanceCloses > 0) {
          detailParts.push(`accept ${xContext.acceptanceCloses}`);
        }
        if (xContext.strongTrendExpanse) detailParts.push("expanse");
        if (xContext.riskOff) detailParts.push("riskOff");
        const detail = detailParts.join(" | ");

        if (!signal) {
          return { ok: true, detail };
        }
        const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
        const signalDir =
          sideRaw === "buy" ? "BULL" : sideRaw === "sell" ? "BEAR" : "";
        let ok = Boolean(signalDir);
        if (xContext.setup === "NO_TRADE") ok = false;
        if (xContext.setup === "TREND_PULLBACK" || xContext.setup === "TREND_CONTINUATION") {
          if (xContext.htfTrend !== signalDir || xContext.ltfTrend !== signalDir) {
            ok = false;
          }
        } else if (xContext.setup === "RANGE_BREAK_FLIP") {
          const htfOk =
            xContext.htfTrend === "RANGE" || xContext.htfTrend === signalDir;
          const ltfOk = xContext.ltfTrend === signalDir;
          if (!htfOk || !ltfOk) ok = false;
        } else if (xContext.setup === "RANGE_FADE") {
          if (xContext.mode !== "RANGE" && xContext.htfTrend !== "RANGE") {
            ok = false;
          }
          if (xContext.ltfTrend !== "RANGE") ok = false;
        }
        return { ok, detail };
      }
      const htfTrend = (decision as any)?.htfTrend;
      const ltfTrend = (decision as any)?.ltfTrend;
      const emaTrend = (decision as any)?.emaTrend as
        | EmaTrendResult
        | undefined;
      const htfConsensusRaw =
        typeof htfTrend?.consensus === "string" ? htfTrend.consensus : "";
      const htfConsensus =
        htfConsensusRaw === "bull" || htfConsensusRaw === "bear"
          ? htfConsensusRaw
          : "";
      const ltfConsensus =
        typeof ltfTrend?.consensus === "string" ? ltfTrend.consensus : "";
      const normalizeTrend = (value: string) => {
        const upper = value.trim().toUpperCase();
        if (!upper || upper === "—") return "—";
        if (upper.startsWith("BULL") || upper === "UP") return "BULL";
        if (upper.startsWith("BEAR") || upper === "DOWN") return "BEAR";
        if (upper.startsWith("RANGE") || upper === "NONE" || upper === "NEUTRAL") {
          return "RANGE";
        }
        return upper;
      };
      const trendRaw =
        htfConsensusRaw ||
        String((decision as any)?.trendH1 ?? decision?.trend ?? "");
      const htfDir = normalizeTrend(trendRaw);
      let ltfDir = normalizeTrend(ltfConsensus);
      const adx = toNumber((decision as any)?.trendAdx);
      const htfScore = toNumber(htfTrend?.score);
      const score = Number.isFinite(htfScore)
        ? htfScore
        : toNumber((decision as any)?.trendScore);
      const alignedCount = toNumber(htfTrend?.alignedCount);
      const htfStrong = Number.isFinite(alignedCount) && alignedCount >= 2;
      const strong =
        (Number.isFinite(adx) && adx >= TREND_GATE_STRONG_ADX) ||
        (Number.isFinite(score) && score >= TREND_GATE_STRONG_SCORE) ||
        htfStrong;
      const modeSetting = settings.trendGateMode ?? "adaptive";
      const reverseAllowed =
        (Number.isFinite(adx) ? adx <= TREND_GATE_REVERSE_ADX : false) &&
        (Number.isFinite(score) ? score <= TREND_GATE_REVERSE_SCORE : false) &&
        !htfStrong;
      let mode: "FOLLOW" | "REVERSE" = "FOLLOW";
      if (modeSetting === "adaptive") {
        mode = reverseAllowed && !strong ? "REVERSE" : "FOLLOW";
      } else if (modeSetting === "reverse") {
        mode = reverseAllowed ? "REVERSE" : "FOLLOW";
      } else {
        mode = "FOLLOW";
      }
      if (ltfDir === "RANGE" && Array.isArray(ltfTrend?.byTimeframe)) {
        const dirs = ltfTrend.byTimeframe.map((entry: any) =>
          String(entry?.result?.direction ?? "none").toLowerCase()
        );
        const hasBull = dirs.includes("bull");
        const hasBear = dirs.includes("bear");
        if (hasBull && hasBear) ltfDir = "MIXED";
      }
      const hasLtf =
        Array.isArray(ltfTrend?.byTimeframe) && ltfTrend.byTimeframe.length > 0;
      const htfIsTrend = htfDir === "BULL" || htfDir === "BEAR";
      const ltfIsTrend = ltfDir === "BULL" || ltfDir === "BEAR";
      const ltfMatchesSignal = (signalDir: "BULL" | "BEAR") =>
        !hasLtf || (ltfIsTrend && ltfDir === signalDir);
      const isAiMaticProfile =
        settings.riskMode === "ai-matic" || settings.riskMode === "ai-matic-tree";
      const trendLabel = (dir: string) => {
        if (dir === "BULL") return "Bull";
        if (dir === "BEAR") return "Bear";
        if (dir === "MIXED") return "Mixed";
        return "Range";
      };
      const emaTfLabel = (tf: number) => {
        if (tf >= 60) return `${Math.round(tf / 60)}h`;
        return `${tf}m`;
      };
      const emaFrames = Array.isArray(emaTrend?.byTimeframe)
        ? emaTrend!.byTimeframe
        : [];
      const emaByTf = EMA_TREND_TIMEFRAMES_MIN.map((tf) => {
        const entry = emaFrames.find(
          (item) => Number(item?.timeframeMin) === tf
        );
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
        const countLabel =
          Number.isFinite(alignedCount) && total > 0
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
        const tfLabel = (tf: number) => {
          if (tf >= 1440) return `${Math.round(tf / 1440)}D`;
          if (tf >= 60) return `${Math.round(tf / 60)}H`;
          return `${tf}m`;
        };
        const tfParts = htfTrend.byTimeframe.map((entry: any) => {
          const dir = String(entry?.result?.direction ?? "none").toUpperCase();
          return `${tfLabel(Number(entry?.timeframeMin ?? 0))} ${dir}`;
        });
        if (tfParts.length) detailParts.push(`HTF ${tfParts.join(" · ")}`);
      }
      if (!isAiMaticProfile && Array.isArray(ltfTrend?.byTimeframe)) {
        const tfLabel = (tf: number) => {
          if (tf >= 1440) return `${Math.round(tf / 1440)}D`;
          if (tf >= 60) return `${Math.round(tf / 60)}H`;
          return `${tf}m`;
        };
        const tfParts = ltfTrend.byTimeframe.map((entry: any) => {
          const dir = String(entry?.result?.direction ?? "none").toUpperCase();
          return `${tfLabel(Number(entry?.timeframeMin ?? 0))} ${dir}`;
        });
        if (tfParts.length) detailParts.push(`LTF ${tfParts.join(" · ")}`);
      }
      if (emaDetailParts.length) {
        detailParts.push(`EMA50 ${emaDetailParts.join(" · ")}`);
      }
      if (emaByTf.some((entry) => entry.touched && !entry.confirmed)) {
        detailParts.push("EMA50 touch unconfirmed");
      }
      if (!isAiMaticProfile) {
        detailParts.push(
          `mode ${mode}${modeSetting === "adaptive" ? " (adaptive)" : ""}`
        );
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
      const emaAligned =
        emaByTf.length > 0 &&
        emaByTf.every((entry) => entry.direction === emaTarget);
      const emaTouched = emaByTf.some((entry) => entry.touched);
      const emaConfirmOk = !emaByTf.some(
        (entry) => entry.touched && !entry.confirmed
      );
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
      } else {
        ok = isMeanRev && signalDir !== htfDir && ltfOk;
      }
      return { ok, detail };
    },
    [getOpenBiasState, resolveBtcBias]
  );

  const evaluateCoreV2 = useCallback(
    (
      symbol: Symbol,
      decision: PriceFeedDecision | null | undefined,
      signal: PriceFeedDecision["signal"] | null,
      feedAgeMs: number | null
    ) => {
      const settings = settingsRef.current;
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const signalActive = Boolean(signal);
      const sideRaw = String(signal?.intent?.side ?? "").toLowerCase();
      const signalDir =
        sideRaw === "buy" ? "BULL" : sideRaw === "sell" ? "BEAR" : "";
      const htfConsensusRaw = String(
        (decision as any)?.htfTrend?.consensus ?? ""
      ).toLowerCase();
      const htfConsensus =
        htfConsensusRaw === "bull"
          ? "BULL"
          : htfConsensusRaw === "bear"
            ? "BEAR"
            : "";
      const htfDir =
        settings.riskMode === "ai-matic-x"
          ? core?.htfBias ?? "NONE"
          : htfConsensus || core?.htfBias || "NONE";
      const direction = signalDir || htfDir || "NONE";
      const isMajor = MAJOR_SYMBOLS.has(symbol);
      const atrMin = isMajor ? CORE_V2_ATR_MIN_PCT_MAJOR : CORE_V2_ATR_MIN_PCT_ALT;
      const volumePct = CORE_V2_VOLUME_PCTL[settings.riskMode];
      const volumeThreshold =
        core == null
          ? Number.NaN
          : volumePct === 50
            ? core.volumeP50
            : volumePct === 60
              ? core.volumeP60
              : volumePct === 65
                ? core.volumeP65
                : core.volumeP70;
      const htfBiasOk =
        direction !== "NONE" &&
        htfDir === direction &&
        (settings.riskMode !== "ai-matic-x" ||
          (Number.isFinite(core?.htfDiffPct) &&
            core!.htfDiffPct >= CORE_V2_HTF_BUFFER_PCT));
      const emaOrderOk =
        direction === "BULL"
          ? Number.isFinite(core?.ltfClose) &&
            core!.ltfClose > core!.ema8 &&
            core!.ema8 > core!.ema21 &&
            core!.ema21 > core!.ema50
          : direction === "BEAR"
            ? Number.isFinite(core?.ltfClose) &&
              core!.ltfClose < core!.ema8 &&
              core!.ema8 < core!.ema21 &&
              core!.ema21 < core!.ema50
            : false;
      const sep1Ok =
        Number.isFinite(core?.sep1) && core!.sep1 >= CORE_V2_EMA_SEP1_MIN;
      const sep2Ok =
        Number.isFinite(core?.sep2) && core!.sep2 >= CORE_V2_EMA_SEP2_MIN;
      const atrOk =
        Number.isFinite(core?.atrPct) && core!.atrPct >= atrMin;
      const volumeOk =
        Number.isFinite(core?.volumeCurrent) &&
        Number.isFinite(volumeThreshold) &&
        core!.volumeCurrent > volumeThreshold;
      const requireMicro = settings.riskMode === "ai-matic-x";
      const pullbackOk =
        !requireMicro
          ? true
          : direction === "BULL"
            ? Boolean(core?.pullbackLong)
            : direction === "BEAR"
              ? Boolean(core?.pullbackShort)
              : false;
      const pivotOk =
        !requireMicro
          ? true
          : direction === "BULL"
            ? Number.isFinite(core?.pivotLow) && Number.isFinite(core?.pivotHigh)
            : direction === "BEAR"
              ? Number.isFinite(core?.pivotHigh) && Number.isFinite(core?.pivotLow)
              : false;
      const microBreakOk =
        !requireMicro
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
      const makerOk =
        entryType === "LIMIT_MAKER_FIRST" || entryType === "LIMIT";
      const sl = toNumber(signal?.intent?.sl);
      const slOk = !signalActive
        ? true
        : Number.isFinite(sl) && sl > 0;
      const adx = toNumber((decision as any)?.trendAdx);
      const htfAtrOk =
        Number.isFinite(core?.htfAtrPct) && core!.htfAtrPct >= atrMin;
      const trendStrengthOk =
        (Number.isFinite(adx) && adx >= 18) || htfAtrOk;

      const gates = [
        {
          name: "HTF bias",
          ok: htfBiasOk,
          detail:
            settings.riskMode === "ai-matic-x"
              ? Number.isFinite(core?.htfEma12) && Number.isFinite(core?.htfEma26)
                ? `EMA12 ${formatNumber(core!.htfEma12, 3)} | EMA26 ${formatNumber(
                    core!.htfEma26,
                    3
                  )} | diff ${formatNumber((core!.htfDiffPct ?? 0) * 100, 2)}%`
                : "missing"
              : htfConsensus
                ? `Consensus ${htfConsensus}${
                    Number.isFinite((decision as any)?.htfTrend?.alignedCount)
                      ? ` (${(decision as any)?.htfTrend?.alignedCount}/${Array.isArray((decision as any)?.htfTrend?.byTimeframe) ? (decision as any)?.htfTrend?.byTimeframe.length : 0})`
                      : ""
                  }`
                : "missing",
          hard: true,
        },
        {
          name: "EMA order",
          ok: emaOrderOk,
          detail: Number.isFinite(core?.ltfClose)
            ? `close ${formatNumber(core!.ltfClose, 4)} | EMA8 ${formatNumber(
                core!.ema8,
                4
              )} | EMA21 ${formatNumber(core!.ema21, 4)} | EMA50 ${formatNumber(
                core!.ema50,
                4
              )}`
            : "missing",
          hard: true,
        },
        {
          name: "EMA sep1",
          ok: sep1Ok,
          detail: Number.isFinite(core?.sep1)
            ? `sep1 ${formatNumber(core!.sep1, 2)} (min ${CORE_V2_EMA_SEP1_MIN})`
            : "missing",
          hard: true,
        },
        {
          name: "EMA sep2",
          ok: sep2Ok,
          detail: Number.isFinite(core?.sep2)
            ? `sep2 ${formatNumber(core!.sep2, 2)} (min ${CORE_V2_EMA_SEP2_MIN})`
            : "missing",
          hard: true,
        },
        {
          name: "ATR% window",
          ok: atrOk,
          detail: Number.isFinite(core?.atrPct)
            ? `ATR% ${formatNumber(core!.atrPct * 100, 3)} (min ${formatNumber(
                atrMin * 100,
                3
              )})`
            : "missing",
          hard: true,
        },
        {
          name: "Volume Pxx",
          ok: volumeOk,
          detail:
            Number.isFinite(core?.volumeCurrent) && Number.isFinite(volumeThreshold)
              ? `vol ${formatNumber(core!.volumeCurrent, 0)} > P${volumePct} ${formatNumber(
                  volumeThreshold,
                  0
                )}`
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
              ? `pivotHi ${formatNumber(core?.pivotHigh ?? Number.NaN, 4)} | pivotLo ${formatNumber(
                  core?.pivotLow ?? Number.NaN,
                  4
                )}`
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
          detail:
            feedAgeMs != null ? `age ${Math.round(feedAgeMs)}ms` : "no feed",
        },
        {
          name: "BBO age",
          ok: bboAgeOk,
          detail:
            feedAgeMs != null
              ? `${Math.round(feedAgeMs)}ms ≤ ${bboLimit}ms`
              : "no feed",
        },
        {
          name: "Trend strength",
          ok: trendStrengthOk,
          detail:
            Number.isFinite(adx) || Number.isFinite(core?.htfAtrPct)
              ? `ADX ${formatNumber(adx, 1)} | 1h ATR% ${formatNumber(
                  (core?.htfAtrPct ?? Number.NaN) * 100,
                  2
                )}`
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
      const strongTrend =
        (Number.isFinite(adx) && adx >= 25) ||
        (Number.isFinite(core?.htfAtrPct) && core!.htfAtrPct >= atrMin) ||
        (decision as any)?.htfTrend?.alignedCount >= 2;
      const threshold =
        settings.riskMode === "ai-matic-tree"
          ? strongTrend
            ? scoreCfg.major
            : scoreCfg.alt
          : baseThreshold;
      const hardFailures = gates
        .filter((g) => g.hard && !g.ok)
        .map((g) => g.name);
      const scorePass =
        scoreTotal > 0 ? score >= threshold : undefined;

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
    },
    []
  );

  const evaluateProGates = useCallback(
    (
      decision: PriceFeedDecision | null | undefined,
      signal: PriceFeedDecision["signal"] | null
    ) => {
      const regime = (decision as any)?.proRegime as
        | {
            hurst: number;
            chop: number;
            hmmProb: number;
            hmmState: number;
            vpin: number;
            ofi: number;
            delta: number;
            regimeOk: boolean;
            shock: boolean;
          }
        | undefined;
      const profile = (decision as any)?.marketProfile as
        | { vah?: number; val?: number; poc?: number }
        | undefined;
      const orderflow = (decision as any)?.orderflow as
        | {
            ofi?: number;
            ofiPrev?: number;
            delta?: number;
            deltaPrev?: number;
            vpin?: number;
            absorptionScore?: number;
          }
        | undefined;
      const hurstOk =
        Number.isFinite(regime?.hurst) && (regime?.hurst ?? 1) < 0.45;
      const chopOk =
        Number.isFinite(regime?.chop) && (regime?.chop ?? 0) > 60;
      const hmmOk =
        Number.isFinite(regime?.hmmProb) && (regime?.hmmProb ?? 0) >= 0.7;
      const vpinOk =
        Number.isFinite(regime?.vpin ?? orderflow?.vpin) &&
        (regime?.vpin ?? orderflow?.vpin ?? 1) < 0.8;
      const absorptionScore = orderflow?.absorptionScore ?? 0;
      const absorptionOk =
        Number.isFinite(absorptionScore) && absorptionScore >= 2;
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
      const flowSell =
        absorptionOk && ofiDown && deltaDown && (ofiFlipDown || deltaFlipDown);
      const ofiDeltaOk = flowBuy || flowSell || Boolean(signal);
      const absorptionGateOk = absorptionOk || Boolean(signal);
      const vaOk =
        Number.isFinite(profile?.vah) &&
        Number.isFinite(profile?.val) &&
        (profile?.vah ?? 0) > 0 &&
        (profile?.val ?? 0) > 0;
      const gates = [
        {
          name: "Hurst < 0.45",
          ok: hurstOk,
          detail: Number.isFinite(regime?.hurst)
            ? `H ${formatNumber(regime!.hurst, 3)}`
            : "missing",
          hard: false,
        },
        {
          name: "CHOP > 60",
          ok: chopOk,
          detail: Number.isFinite(regime?.chop)
            ? `CHOP ${formatNumber(regime!.chop, 1)}`
            : "missing",
          hard: false,
        },
        {
          name: "HMM state0 p>=0.7",
          ok: hmmOk,
          detail: Number.isFinite(regime?.hmmProb)
            ? `p ${formatNumber(regime!.hmmProb, 2)}`
            : "missing",
          hard: false,
        },
        {
          name: "VPIN < 0.8",
          ok: vpinOk,
          detail: Number.isFinite(regime?.vpin ?? orderflow?.vpin)
            ? `VPIN ${formatNumber(
                (regime?.vpin ?? orderflow?.vpin ?? 0),
                2
              )}`
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
          detail:
            Number.isFinite(orderflow?.ofi) || Number.isFinite(orderflow?.delta)
              ? `OFI ${formatNumber(orderflow?.ofi ?? 0, 2)} | Δ ${formatNumber(
                  orderflow?.delta ?? 0,
                  2
                )}`
              : signal
                ? "signal"
                : "missing",
          hard: false,
        },
        {
          name: "VA edge",
          ok: vaOk,
          detail:
            Number.isFinite(profile?.vah) && Number.isFinite(profile?.val)
              ? `VAL ${formatNumber(profile!.val, 2)} | VAH ${formatNumber(
                  profile!.vah,
                  2
                )}`
              : "missing",
          hard: false,
        },
      ];
      const score = gates.filter((g) => g.ok).length;
      const scoreTotal = gates.length;
      const scorePass =
        scoreTotal > 0 ? gates.every((g) => g.ok) : true;
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
    },
    []
  );

  const isBtcDecoupling = useCallback(() => {
    const btcDecision = decisionRef.current["BTCUSDT"]?.decision;
    if (!btcDecision) return false;
    const trend = (btcDecision as any)?.trend;
    const adx = toNumber((btcDecision as any)?.trendAdx);
    // Condition: BTC Range AND ADX < 25 (Low Volatility / Sideways) -> Altseason/Decoupling
    return String(trend).toLowerCase() === "range" && Number.isFinite(adx) && adx < 25;
  }, []);

  const enforceBtcBiasAlignment = useCallback(
    async (now: number) => {
      if (!AUTO_CANCEL_ENTRY_ORDERS) return;
      if (!authToken) return;
      if (isBtcDecoupling()) return; // Skip enforcement during decoupling
      const btcBias = resolveBtcBias(); 
      if (!btcBias) return;
      const cooldown = autoCloseCooldownRef.current;
      const nextOrders = ordersRef.current;
      const isTriggerEntryOrder = (order: TestnetOrder | any) => {
        const filter = String(order?.orderFilter ?? order?.order_filter ?? "").toLowerCase();
        const trigger = toNumber(order?.triggerPrice ?? order?.trigger_price);
        return filter === "stoporder" || (Number.isFinite(trigger) && trigger > 0);
      };

      const cancelTargets = nextOrders.filter((order) => {
        if (!isEntryOrder(order)) return false;
        if (isTriggerEntryOrder(order)) return false;
        const bias = normalizeBias(order.side);
        return bias != null && bias !== btcBias;
      });

      if (!cancelTargets.length) return;

      for (const order of cancelTargets) {
        const orderId = order.orderId || "";
        const orderLinkId = order.orderLinkId || "";
        const key = orderId || orderLinkId || `ord:${order.symbol}:${order.side}`;
        const last = cooldown.get(key) ?? 0;
        if (now - last < 15_000) continue;
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
        } catch (err) {
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
    },
    [addLogEntries, authToken, isEntryOrder, normalizeBias, postJson, resolveBtcBias, isBtcDecoupling]
  );

  const enforceCheatLimitExpiry = useCallback(
    async (now: number, nextOrders: TestnetOrder[]) => {
      const settings = settingsRef.current;
      if (!authToken) return;
      const isTreeProfile = settings.riskMode === "ai-matic-tree";
      const cheatEnabled = settings.strategyCheatSheetEnabled;
      const useCheatTree = isTreeProfile;
      const useCoreOff = !cheatEnabled && !isTreeProfile;
      if (!useCheatTree && !useCoreOff) return;
      if (!Array.isArray(nextOrders) || nextOrders.length === 0) return;
      const cooldown = autoCloseCooldownRef.current;
      const cancelLabel = useCheatTree ? "TREE" : "CHEAT";

      const isTriggerEntryOrder = (order: TestnetOrder) => {
        const filter = String(order.orderFilter ?? "").toLowerCase();
        const trigger = toNumber(order.triggerPrice);
        return filter === "stoporder" || (Number.isFinite(trigger) && trigger > 0);
      };

      for (const order of nextOrders) {
        if (!isEntryOrder(order)) continue;
        if (isTriggerEntryOrder(order)) continue;
        const status = String(order.status ?? "").toLowerCase();
        if (
          status.includes("filled") ||
          status.includes("cancel") ||
          status.includes("reject")
        ) {
          continue;
        }
        const active =
          status.includes("new") ||
          status.includes("created") ||
          status.includes("open") ||
          status.includes("partially") ||
          status.includes("active");
        if (!active) continue;

        const symbol = String(order.symbol ?? "");
        const orderId = String(order.orderId ?? "");
        const orderLinkId = String(order.orderLinkId ?? "");
        const metaKey = orderLinkId || orderId;
        if (!metaKey) continue;
        const side =
          String(order.side ?? "Buy").toLowerCase() === "sell" ? "Sell" : "Buy";
        const entryPrice = toNumber(order.price);
        const createdTs = toEpoch(order.createdTime);
        const decision = decisionRef.current[symbol]?.decision;
        let meta =
          (orderLinkId && cheatLimitMetaRef.current.get(orderLinkId)) ||
          (orderId && cheatLimitMetaRef.current.get(orderId)) ||
          null;

        if (!meta) {
          const createdAt = Number.isFinite(createdTs) ? createdTs : now;
          const ltfMinRaw = toNumber((decision as any)?.coreV2?.ltfTimeframeMin);
          let mode: CheatLimitMeta["mode"] | null = null;
          if (useCheatTree && decision) {
            const depsRaw = (decision as any)?.cheatDeps;
            const sigRaw = (decision as any)?.cheatSignals;
            if (depsRaw && sigRaw) {
              const treeInputs = buildTreeInputs(depsRaw, sigRaw);
              const derived = decideCombinedEntry(
                treeInputs.deps,
                treeInputs.signals
              );
              mode = derived.mode ?? null;
            }
          }
          meta = {
            intentId: metaKey,
            symbol,
            side,
            entryPrice: Number.isFinite(entryPrice) ? entryPrice : Number.NaN,
            createdAt,
            mode,
            timeframeMin: Number.isFinite(ltfMinRaw) ? ltfMinRaw : null,
          };
          cheatLimitMetaRef.current.set(metaKey, meta);
        }

        let treeInvalid = false;
        let treeReason: string | null = null;
        if (useCheatTree) {
          if (!decision) {
            treeInvalid = true;
            treeReason = "TREE_DATA_MISSING";
          } else {
            const depsRaw = (decision as any)?.cheatDeps;
            const sigRaw = (decision as any)?.cheatSignals;
            if (!depsRaw || !sigRaw) {
              treeInvalid = true;
              treeReason = "TREE_DATA_MISSING";
            } else {
              const treeInputs = buildTreeInputs(depsRaw, sigRaw);
              const derived = decideCombinedEntry(
                treeInputs.deps,
                treeInputs.signals
              );
              if (!derived.ok) {
                treeInvalid = true;
                treeReason = derived.blocks?.length
                  ? derived.blocks.join(", ")
                  : "NO_VALID_ENTRY";
              } else if (meta?.mode && derived.mode && meta.mode !== derived.mode) {
                treeInvalid = true;
                treeReason = `TREE_MODE ${meta.mode}→${derived.mode}`;
              } else if (derived.side) {
                const derivedSide =
                  derived.side === "LONG"
                    ? "Buy"
                    : derived.side === "SHORT"
                      ? "Sell"
                      : null;
                if (derivedSide && derivedSide !== side) {
                  treeInvalid = true;
                  treeReason = `TREE_SIDE ${side}→${derivedSide}`;
                }
              } else if (!meta?.mode && derived.mode) {
                meta = { ...meta, mode: derived.mode };
                cheatLimitMetaRef.current.set(metaKey, meta);
              }
            }
          }
        }

        const ltfMin =
          meta?.timeframeMin ??
          toNumber((decision as any)?.coreV2?.ltfTimeframeMin);
        let window = resolveCheatLimitWindowMs(
          meta?.mode ?? null,
          Number.isFinite(ltfMin) ? ltfMin : null
        );
        if (!window) {
          const fallbackMode =
            settings.riskMode === "ai-matic-scalp" ? "SCALP" : "INTRADAY";
          window = resolveCheatLimitWindowMs(fallbackMode, null);
        }
        if (!window) continue;
        const createdAt = Number.isFinite(createdTs)
          ? createdTs
          : meta?.createdAt ?? Number.NaN;
        if (!Number.isFinite(createdAt)) continue;
        const ageMs = now - createdAt;
        if (!Number.isFinite(ageMs) || ageMs < 0) continue;

        const currentPrice = toNumber((decision as any)?.coreV2?.ltfClose);
        let runaway = false;
        let runawayBps = Number.NaN;
        if (Number.isFinite(currentPrice) && Number.isFinite(entryPrice) && entryPrice > 0) {
          const move =
            side === "Buy" ? currentPrice - entryPrice : entryPrice - currentPrice;
          if (move > 0) {
            runawayBps = (move / entryPrice) * 10_000;
            runaway = runawayBps >= CHEAT_LIMIT_RUNAWAY_BPS;
          }
        }

        let rrrInvalid = false;
        let rrr = Number.NaN;
        if (
          Number.isFinite(currentPrice) &&
          Number.isFinite(meta?.slPrice) &&
          Number.isFinite(meta?.tpPrice)
        ) {
          const sl = meta!.slPrice as number;
          const tp = meta!.tpPrice as number;
          const reward =
            side === "Buy" ? tp - currentPrice : currentPrice - tp;
          const risk =
            side === "Buy" ? currentPrice - sl : sl - currentPrice;
          if (reward <= 0 || risk <= 0) {
            rrrInvalid = true;
          } else {
            rrr = reward / risk;
            rrrInvalid = rrr < CHEAT_LIMIT_MIN_RRR;
          }
        }

        const expired = ageMs >= window.maxMs;
        if (!expired && !runaway && !rrrInvalid && !treeInvalid) continue;
        const last = cooldown.get(metaKey) ?? 0;
        if (now - last < 15_000) continue;
        cooldown.set(metaKey, now);
        cancelingOrdersRef.current.add(metaKey);
        const reason = treeInvalid
          ? `tree ${treeReason ?? "NO_TRADE"}`
          : expired
            ? `limit_wait ${window.label}`
            : runaway
              ? `price_away ${formatNumber(runawayBps, 1)}bps`
              : `rrr ${Number.isFinite(rrr) ? rrr.toFixed(2) : "n/a"}`;
        try {
          await postJson("/cancel", {
            symbol: order.symbol,
            orderId: order.orderId || undefined,
            orderLinkId: order.orderLinkId || undefined,
          });
          cheatLimitMetaRef.current.delete(metaKey);
          addLogEntries([
            {
              id: `cheat-limit-cancel:${metaKey}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
            message: `${symbol} ${cancelLabel} LIMIT CANCEL (${reason})`,
            },
          ]);
        } catch (err) {
          addLogEntries([
            {
              id: `cheat-limit-cancel:error:${metaKey}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
            message: `${symbol} ${cancelLabel.toLowerCase()} limit cancel failed: ${asErrorMessage(err)}`,
            },
          ]);
        } finally {
          cancelingOrdersRef.current.delete(metaKey);
        }
      }
    },
    [addLogEntries, authToken, isEntryOrder, postJson]
  );

  const resolveCorrelationGate = useCallback(
    (
      symbol: string,
      now = Date.now(),
      signal?: PriceFeedDecision["signal"] | null
    ) => {
      const details: string[] = [];
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
      const signalDir =
        sideRaw === "buy" ? "bull" : sideRaw === "sell" ? "bear" : "none";
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
      } else {
        details.push(`btc ${btcBias} aligned`);
      }
      return { ok, detail: details.join(" | ") };
    },
    [getOpenBiasState, resolveBtcBias, isBtcDecoupling]
  );

  const evaluateAiMaticGates = useCallback(
    (
      symbol: string,
      decision: PriceFeedDecision | null | undefined,
      signal: PriceFeedDecision["signal"] | null
    ) => {
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
    },
    [resolveCorrelationGate, isBtcDecoupling]
  );

  const resolveQualityScore = useCallback(
    (
      symbol: Symbol,
      decision: PriceFeedDecision | null | undefined,
      signal: PriceFeedDecision["signal"] | null,
      feedAgeMs: number | null
    ) => {
      if (!decision) return { score: null, threshold: null, pass: undefined };
      const evalResult = evaluateCoreV2(symbol, decision, signal, feedAgeMs);
      return {
        score: Number.isFinite(evalResult.score)
          ? evalResult.score
          : null,
        threshold: Number.isFinite(evalResult.threshold)
          ? evalResult.threshold
          : null,
        pass: evalResult.scorePass,
      };
    },
    [evaluateCoreV2]
  );

  const resolveSymbolState = useCallback((symbol: string) => {
    const hasPosition = positionsRef.current.some((p) => {
      if (p.symbol !== symbol) return false;
      const size = toNumber(p.size ?? p.qty);
      return Number.isFinite(size) && size > 0;
    });
    if (hasPosition) return "HOLD";
    const hasOrders = ordersRef.current.some(
      (o) => isActiveEntryOrder(o) && String(o.symbol ?? "") === symbol
    );
    if (hasOrders) return "HOLD";
    return "SCAN";
  }, [isActiveEntryOrder]);

  const buildScanDiagnostics = useCallback(
    (symbol: string, decision: PriceFeedDecision, lastScanTs: number) => {
      const context = getSymbolContext(symbol, decision);
      const symbolState = resolveSymbolState(symbol);
      const lastTick = symbolTickRef.current.get(symbol) ?? 0;
      const feedAgeMs =
        lastTick > 0 ? Math.max(0, Date.now() - lastTick) : null;
      const feedAgeOk =
        feedAgeMs == null ? null : feedAgeMs <= FEED_AGE_OK_MS;
      const signal = decision?.signal ?? null;
      const quality = resolveQualityScore(symbol as Symbol, decision, signal, feedAgeMs);
      const now = Number.isFinite(lastScanTs) ? lastScanTs : Date.now();

      const gates: { name: string; ok: boolean; detail?: string }[] = [];
      const addGate = (name: string, ok: boolean, detail?: string) => {
        gates.push({ name, ok, detail });
      };

      const correlation = resolveCorrelationGate(symbol, now, signal);
      if (symbol !== "BTCUSDT") {
        addGate("BTC Correlation", correlation.ok, correlation.detail);
      };

      const isProProfile = context.settings.riskMode === "ai-matic-pro";
      const coreEval = isProProfile
        ? evaluateProGates(decision, signal)
        : evaluateCoreV2(symbol as Symbol, decision, signal, feedAgeMs);
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const scalpPrimary = computeScalpPrimaryChecklist(core);
      const isScalpProfile = context.settings.riskMode === "ai-matic-scalp";
      const scalpGuards = isScalpProfile ? evaluateScalpGuards(core) : null;
      const hasEntryOrder = ordersRef.current.some(
        (order) =>
          isEntryOrder(order) && String(order?.symbol ?? "") === symbol
      );
      const hasPendingIntent = intentPendingRef.current.has(symbol);
      const entryBlockReasons: string[] = [];
      const addBlockReason = (label: string) => {
        entryBlockReasons.push(label);
      };
      const entryLockTs = entryOrderLockRef.current.get(symbol) ?? 0;
      const lastIntentTs = lastIntentBySymbolRef.current.get(symbol) ?? 0;
      const lastCloseTs = lastCloseBySymbolRef.current.get(symbol) ?? 0;
      const lastLossTs = lastLossBySymbolRef.current.get(symbol) ?? 0;
      const cooldownMs = CORE_V2_COOLDOWN_MS[context.settings.riskMode];
      const closeCooldownMs = isScalpProfile
        ? SCALP_COOLDOWN_MS
        : REENTRY_COOLDOWN_MS;
      if (context.hasPosition) addBlockReason("pozice");
      if (hasEntryOrder) addBlockReason("order");
      if (hasPendingIntent) addBlockReason("intent");
      if (entryLockTs && now - entryLockTs < ENTRY_ORDER_LOCK_MS) {
        const remainingMs = Math.max(0, ENTRY_ORDER_LOCK_MS - (now - entryLockTs));
        addBlockReason(`lock ${Math.ceil(remainingMs / 1000)}s`);
      }
      if (lastIntentTs && now - lastIntentTs < INTENT_COOLDOWN_MS) {
        const remainingMs = Math.max(0, INTENT_COOLDOWN_MS - (now - lastIntentTs));
        addBlockReason(`intent ${Math.ceil(remainingMs / 1000)}s`);
      }
      if (lastCloseTs && now - lastCloseTs < closeCooldownMs) {
        const remainingMs = Math.max(0, closeCooldownMs - (now - lastCloseTs));
        addBlockReason(`re-entry ${Math.ceil(remainingMs / 1000)}s`);
      }
      if (lastLossTs && now - lastLossTs < cooldownMs) {
        const remainingMs = Math.max(0, cooldownMs - (now - lastLossTs));
        addBlockReason(`cooldown ${Math.ceil(remainingMs / 60_000)}m`);
      }
      if (!context.maxPositionsOk) addBlockReason("max pozic");
      if (!context.ordersClearOk) addBlockReason("max orderů");
      if (
        context.settings.riskMode === "ai-matic-x" &&
        (decision as any)?.xContext?.riskOff
      ) {
        addBlockReason("risk off");
      }
      // Hard guard: otevřená pozice nebo order → žádná nová intent ani po přepnutí Exec ON
      if (entryBlockReasons.includes("pozice") || entryBlockReasons.includes("order")) {
        const logId = `entry-block:${symbol}:${now}`;
        addLogEntries([
          {
            id: logId,
            timestamp: new Date(now).toISOString(),
            action: "RISK_BLOCK",
            message: `${symbol} blokováno (open pos/order): ${entryBlockReasons.join(", ")}`,
          },
        ]);
        return;
      }
      const manageReason =
        entryBlockReasons.length > 0 ? entryBlockReasons.join(" • ") : null;

      coreEval.gates.forEach((gate) => addGate(gate.name, gate.ok, gate.detail));
      if (isScalpProfile) {
        addGate(
          SCALP_PRIMARY_GATE,
          scalpPrimary.primaryOk,
          `15m ${
            scalpPrimary.trendLongOk
              ? "LONG"
              : scalpPrimary.trendShortOk
                ? "SHORT"
                : "NONE"
          } | spread ${
            Number.isFinite(core?.m15EmaSpreadPct)
              ? formatNumber(core!.m15EmaSpreadPct, 4)
              : "—"
          } | LTF ${core?.ltfTimeframeMin ?? "—"}m`
        );
        addGate(
          SCALP_ENTRY_GATE,
          scalpPrimary.entryOk,
          `EMA cross ${
            scalpPrimary.crossBullOk
              ? "BULL"
              : scalpPrimary.crossBearOk
                ? "BEAR"
                : "no cross"
          }${Number.isFinite(scalpPrimary.emaCrossBarsAgo) ? " <=6b" : ""} | Div ${
            scalpPrimary.divBullOk
              ? "BULL"
              : scalpPrimary.divBearOk
                ? "BEAR"
                : "no"
          } | Vol ${scalpPrimary.volumeOk ? "OK" : "no"}`
        );
        addGate(
          SCALP_EXIT_GATE,
          scalpPrimary.exitOk,
          Number.isFinite(core?.atr14)
            ? `ATR ${formatNumber(core!.atr14, 4)} | TP 1.5R`
            : "ATR missing"
        );
        if (scalpGuards) {
          addGate(
            SCALP_DRIFT_GATE,
            !scalpGuards.driftBlocked,
            scalpGuards.driftReasons.length
              ? scalpGuards.driftReasons.join(", ")
              : "OK"
          );
          addGate(
            SCALP_FAKE_MOMENTUM_GATE,
            !scalpGuards.fakeBlocked,
            scalpGuards.fakeReasons.length
              ? scalpGuards.fakeReasons.join(", ")
              : "OK"
          );
          if (scalpGuards.protectedEntry) {
            addGate(
              SCALP_PROTECTED_ENTRY_GATE,
              true,
              scalpGuards.protectedReasons.join(", ") || "active"
            );
          }
        }
      }

      const hardEnabled = false;
      const softEnabled = context.settings.enableSoftGates !== false;
      const hardReasons: string[] = [];
      const hardBlocked = false;
      const execEnabled = isGateEnabled("Exec allowed");
      const softBlocked = softEnabled && quality.pass === false;
      const checklist = evaluateChecklistPass(gates);
      const signalActive = Boolean(signal) || checklist.pass;
      let executionAllowed: boolean | null = null;
      let executionReason: string | undefined;
      if (!execEnabled) {
        executionAllowed = false;
        executionReason = "Exec OFF";
      } else if (entryBlockReasons.length > 0) {
        executionAllowed = false;
        executionReason = entryBlockReasons.join(", ");
      } else if (!signalActive) {
        executionAllowed = null;
        executionReason = "čeká na signál";
      } else if (!checklist.pass) {
        executionAllowed = false;
        executionReason = `Checklist ${checklist.passedCount}/${MIN_CHECKLIST_PASS}`;
      } else if (softBlocked) {
        executionAllowed = false;
        executionReason = `Score ${quality.score ?? "—"} / ${quality.threshold ?? "—"}`;
      } else {
        executionAllowed = true;
      }

      return {
        symbolState,
        manageReason,
        entryBlockReasons,
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
        proState: (decision as any)?.proState ?? null,
        manipActive: (decision as any)?.proRegime?.manipActive ?? null,
        liqProximityPct:
          (decision as any)?.proSignals?.liqProximityPct ??
          (decision as any)?.orderflow?.liqProximityPct ??
          null,
        lastScanTs,
        feedAgeMs,
        feedAgeOk,
      };
    },
    [
      evaluateCoreV2,
      evaluateProGates,
      evaluateChecklistPass,
      getSymbolContext,
      isGateEnabled,
      resolveQualityScore,
      resolveSymbolState,
    ]
  );

  const refreshDiagnosticsFromDecisions = useCallback(() => {
    const entries = Object.entries(decisionRef.current);
    if (!entries.length) return;
    setScanDiagnostics((prev) => {
      const next = { ...(prev ?? {}) };
      for (const [symbol, data] of entries) {
        if (!activeSymbols.includes(symbol as Symbol)) continue;
        next[symbol] = buildScanDiagnostics(
          symbol,
          data.decision,
          data.ts
        );
      }
      return next;
    });
  }, [activeSymbols, buildScanDiagnostics]);

  const updateGateOverrides = useCallback(
    (overrides: Record<string, boolean>) => {
      gateOverridesRef.current = { ...overrides };
      refreshDiagnosticsFromDecisions();
    },
    [refreshDiagnosticsFromDecisions]
  );

  const refreshFast = useCallback(async () => {
    if (fastPollRef.current) return;
    fastPollRef.current = true;

    const now = Date.now();
    const results = await Promise.allSettled([
      fetchJson("/positions"),
      fetchJson("/orders", { limit: "50" }),
      fetchJson("/executions", { limit: "50" }),
    ]);

    let sawError = false;
    const newLogs: LogEntry[] = [];
    const [positionsRes, ordersRes, executionsRes] = results;
    const entryFallbackByKey =
      ordersRes.status === "fulfilled"
        ? buildEntryFallback(extractList(ordersRes.value))
        : new Map<string, EntryFallback>();

    if (positionsRes.status === "fulfilled") {
      const list = extractList(positionsRes.value);
      const prevPositions = positionSnapshotRef.current;
      const nextPositions = new Map<string, { size: number; side: string }>();
      const next = list
        .map((p: any) => {
          const size = toNumber(p?.size ?? p?.qty);
          if (!Number.isFinite(size) || size <= 0) return null;
          const sideRaw = String(p?.side ?? "");
          const side =
            sideRaw.toLowerCase() === "buy" ? "Buy" : "Sell";
          const symbol = String(p?.symbol ?? "");
          const positionIdxRaw = toNumber(p?.positionIdx);
          const positionIdx = Number.isFinite(positionIdxRaw)
            ? positionIdxRaw
            : undefined;
          const entryPrice = toNumber(
            p?.entryPrice ?? p?.avgEntryPrice ?? p?.avgPrice
          );
          const unrealized = toNumber(
            p?.unrealisedPnl ?? p?.unrealizedPnl
          );
          const openEpoch = toEpoch(p?.openTime);
          const updatedEpoch = toEpoch(p?.updatedTime ?? p?.updated_at);
          const openedAt = Number.isFinite(openEpoch)
            ? new Date(openEpoch).toISOString()
            : "";
          const updatedAt = Number.isFinite(updatedEpoch)
            ? new Date(updatedEpoch).toISOString()
            : "";
          const triggerFromPos = toNumber(
            p?.triggerPrice ?? p?.trigger_price
          );
          const sl = toNumber(p?.stopLoss ?? p?.sl);
          const tp = toNumber(p?.takeProfit ?? p?.tp);
          const trailingActiveRaw = toNumber(
            p?.trailingActivePrice ?? p?.activePrice ?? p?.activationPrice
          );
          const markPrice = toNumber(
            p?.markPrice ?? p?.lastPrice ?? p?.indexPrice
          );
          const trailingStop = toNumber(
            p?.trailingStop ??
              p?.trailingStopDistance ??
              p?.trailingStopPrice ??
              p?.trailPrice
          );
          const fallback =
            entryFallbackByKey.get(`${symbol}:${side}`) ?? null;
          const triggerPrice = Number.isFinite(triggerFromPos)
            ? triggerFromPos
            : fallback?.triggerPrice;
          const resolvedEntry = Number.isFinite(entryPrice)
            ? entryPrice
            : Number.isFinite(triggerPrice)
              ? triggerPrice
              : Number.isFinite(fallback?.price)
                ? (fallback?.price as number)
                : Number.NaN;
          const trailPlan =
            Number.isFinite(resolvedEntry) &&
            Number.isFinite(sl) &&
            sl > 0
              ? computeTrailingPlan(
                  resolvedEntry,
                  sl,
                  side === "Sell" ? "Sell" : "Buy",
                  symbol as Symbol
                )
              : null;
          const trailingActivePrice = Number.isFinite(trailingActiveRaw)
            ? trailingActiveRaw
            : trailPlan?.trailingActivePrice;
          const rrr =
            Number.isFinite(resolvedEntry) &&
            Number.isFinite(sl) &&
            Number.isFinite(tp) &&
            resolvedEntry !== sl
              ? Math.abs(tp - resolvedEntry) /
                Math.abs(resolvedEntry - sl)
              : Number.NaN;
          
          // Calculate Breakeven Status
          const isBreakeven = side === "Buy" 
            ? Number.isFinite(sl) && sl >= resolvedEntry
            : Number.isFinite(sl) && sl <= resolvedEntry;

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
            trailingActivePrice: Number.isFinite(trailingActivePrice)
              ? trailingActivePrice
              : undefined,
            markPrice: Number.isFinite(markPrice) ? markPrice : undefined,
            currentTrailingStop:
              Number.isFinite(trailingStop) && trailingStop > 0
                ? trailingStop
                : undefined,
            trailPlanned: Boolean(trailPlan),
            unrealizedPnl: Number.isFinite(unrealized)
              ? unrealized
              : Number.NaN,
            openedAt: openedAt || "",
            rrr: Number.isFinite(rrr) ? rrr : undefined,
            lastUpdateReason: String(p?.lastUpdateReason ?? "") || undefined,
            timestamp: updatedAt || openedAt || "",
            env: useTestnet ? "testnet" : "mainnet",
            positionIdx,
            isBreakeven, // Pass to UI
          } satisfies ActivePosition;
        })
        .filter((p: ActivePosition | null): p is ActivePosition => Boolean(p));
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
            message: `POSITION OPEN ${symbol} ${nextPos.side} size ${formatNumber(
              nextPos.size,
              4
            )}`,
          });
          continue;
        }
        if (Number.isFinite(prev.size) && prev.size !== nextPos.size) {
          newLogs.push({
            id: `pos-size:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `POSITION SIZE ${symbol} ${formatNumber(
              prev.size,
              4
            )} → ${formatNumber(nextPos.size, 4)}`,
          });
        }
      }
      for (const [symbol, prevPos] of prevPositions.entries()) {
        if (!nextPositions.has(symbol)) {
          lastCloseBySymbolRef.current.set(symbol, now);
          scalpExitStateRef.current.delete(symbol);
          scalpActionCooldownRef.current.delete(symbol);
          scalpPartialCooldownRef.current.delete(symbol);
          scalpTrailCooldownRef.current.delete(symbol);
          newLogs.push({
            id: `pos-close:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `POSITION CLOSED ${symbol} ${prevPos.side} size ${formatNumber(
              prevPos.size,
              4
            )}`,
          });
        }
      }
      positionSnapshotRef.current = nextPositions;
    }

    if (ordersRes.status === "fulfilled") {
      const list = extractList(ordersRes.value);
      const prevOrders = orderSnapshotRef.current;
      const nextOrders = new Map<
        string,
        {
          status: string;
          qty: number;
          price: number | null;
          side: string;
          symbol: string;
          orderLinkId?: string;
        }
      >();
      const mapped = list
        .map((o: any) => {
          const qty = toNumber(o?.qty ?? o?.orderQty ?? o?.leavesQty);
          const price = toNumber(o?.price);
          const triggerPrice = toNumber(o?.triggerPrice ?? o?.trigger_price);
          const orderId = String(o?.orderId ?? o?.orderID ?? o?.id ?? "");
          const orderLinkId = String(
            o?.orderLinkId ?? o?.order_link_id ?? o?.orderLinkID ?? ""
          );
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
            side: side as "Buy" | "Sell",
            qty: Number.isFinite(qty) ? qty : Number.NaN,
            price: Number.isFinite(price) ? price : null,
            triggerPrice: Number.isFinite(triggerPrice) ? triggerPrice : null,
            orderType: orderType || undefined,
            stopOrderType: stopOrderType || undefined,
            orderFilter: orderFilter || undefined,
            reduceOnly,
            status,
            createdTime: toIso(o?.createdTime ?? o?.created_at) || "",
          } as TestnetOrder;
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
        .filter((o: TestnetOrder) => Boolean(o.orderId || o.orderLinkId));
      const isProtectionOrder = (order: TestnetOrder) => {
        const stopType = String(order.stopOrderType ?? "").toLowerCase();
        const filter = String(order.orderFilter ?? "").toLowerCase();
        return (
          order.reduceOnly ||
          filter === "tpsl" ||
          stopType === "takeprofit" ||
          stopType === "stoploss" ||
          stopType === "trailingstop"
        );
      };
      const isTriggerEntryOrder = (order: TestnetOrder) => {
        const filter = String(order.orderFilter ?? "").toLowerCase();
        const trigger = toNumber(order.triggerPrice);
        return filter === "stoporder" || (Number.isFinite(trigger) && trigger > 0);
      };
      const isNewEntryOrder = (order: TestnetOrder) => {
        if (isProtectionOrder(order)) return false;
        const status = String(order.status ?? "").toLowerCase();
        return status === "new" || status === "created";
      };
      const latestNewBySymbol = new Map<
        string,
        { order: TestnetOrder; ts: number }
      >();
      for (const order of mapped) {
        if (!isNewEntryOrder(order)) continue;
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
      const latestNewIds = new Map<
        string,
        { orderId: string; orderLinkId?: string }
      >();
      for (const [symbol, data] of latestNewBySymbol.entries()) {
        latestNewIds.set(symbol, {
          orderId: data.order.orderId,
          orderLinkId: data.order.orderLinkId,
        });
      }
      const next = AUTO_CANCEL_ENTRY_ORDERS
        ? mapped.filter((order) => {
            if (!isNewEntryOrder(order)) return true;
            if (isTriggerEntryOrder(order)) return true;
            const latest = latestNewIds.get(order.symbol);
            if (!latest) return true;
            return (
              (latest.orderId && order.orderId === latest.orderId) ||
              (latest.orderLinkId && order.orderLinkId === latest.orderLinkId)
            );
          })
        : mapped;
      for (const order of mapped) {
        const orderId = order.orderId;
        const orderLinkId = order.orderLinkId;
        if (!orderId || !orderLinkId) continue;
        const meta = cheatLimitMetaRef.current.get(orderLinkId);
        if (meta && !cheatLimitMetaRef.current.has(orderId)) {
          cheatLimitMetaRef.current.set(orderId, meta);
        }
      }
      setOrders(next);
      ordersRef.current = next;
      setOrdersError(null);
      setLastSuccessAt(now);
      const activeEntrySymbols = new Set(
        next
          .filter((order) => isEntryOrder(order))
          .map((order) => String(order.symbol ?? ""))
          .filter(Boolean)
      );
      for (const [symbol, ts] of entryOrderLockRef.current.entries()) {
        const hasEntry = activeEntrySymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasPos = positionsRef.current.some(
          (p) => String(p.symbol ?? "") === symbol
        );
        if (!hasEntry && !hasPending && !hasPos) {
          entryOrderLockRef.current.delete(symbol);
        } else if (!hasEntry && !hasPos && now - ts >= ENTRY_ORDER_LOCK_MS) {
          entryOrderLockRef.current.delete(symbol);
        }
      }
      const cancelTargets =
        AUTO_CANCEL_ENTRY_ORDERS && authToken
          ? mapped.filter((order) => {
              if (!isNewEntryOrder(order)) return false;
              if (isTriggerEntryOrder(order)) return false;
              const latest = latestNewIds.get(order.symbol);
              if (!latest) return false;
              const isLatest =
                (latest.orderId && order.orderId === latest.orderId) ||
                (latest.orderLinkId &&
                  order.orderLinkId === latest.orderLinkId);
              return !isLatest;
            })
          : [];
      if (cancelTargets.length && AUTO_CANCEL_ENTRY_ORDERS) {
        void (async () => {
          for (const order of cancelTargets) {
            const key = order.orderId || order.orderLinkId;
            if (!key || cancelingOrdersRef.current.has(key)) continue;
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
            } catch {
              // ignore cancel errors in enforcement loop
            } finally {
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
            message: `ORDER NEW ${nextOrder.symbol} ${nextOrder.side} ${formatNumber(
              nextOrder.qty,
              4
            )} @ ${nextOrder.price ?? "mkt"} | ${nextOrder.status}`,
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
          cheatLimitMetaRef.current.delete(orderId);
          if (prevOrder.orderLinkId) {
            cheatLimitMetaRef.current.delete(prevOrder.orderLinkId);
          }
          newLogs.push({
            id: `order-closed:${orderId}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `ORDER CLOSED ${prevOrder.symbol} ${prevOrder.side} ${formatNumber(
              prevOrder.qty,
              4
            )} | ${prevOrder.status}`,
          });
        }
      }
      orderSnapshotRef.current = nextOrders;
      if (positionsRes.status === "fulfilled") {
        void enforceCheatLimitExpiry(now, next);
        void enforceBtcBiasAlignment(now);
      }
    } else {
      const msg = asErrorMessage(ordersRes.reason);
      setOrdersError(msg);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (executionsRes.status === "fulfilled") {
      const list = extractList(executionsRes.value);
      const execSeen = execSeenRef.current;
      const nextTrades = list.map((t: any) => {
        const price = toNumber(t?.execPrice ?? t?.price);
        const qty = toNumber(t?.execQty ?? t?.qty);
        const value = toNumber(t?.execValue ?? t?.value);
        const fee = toNumber(t?.execFee ?? t?.fee);
        return {
          id: String(t?.execId ?? t?.tradeId ?? ""),
          symbol: String(t?.symbol ?? ""),
          side: (t?.side ?? "Buy") as "Buy" | "Sell",
          price: Number.isFinite(price) ? price : Number.NaN,
          qty: Number.isFinite(qty) ? qty : Number.NaN,
          value: Number.isFinite(value) ? value : Number.NaN,
          fee: Number.isFinite(fee) ? fee : Number.NaN,
          time: toIso(t?.execTime ?? t?.transactTime ?? t?.createdTime) || "",
        } as TestnetTrade;
      });
      setTrades(nextTrades);
      const tradeLogs = list
        .map((t: any) => {
          const timestamp = toIso(
            t?.execTime ?? t?.transactTime ?? t?.createdTime
          );
          if (!timestamp) return null;
          const symbol = String(t?.symbol ?? "");
          const side = String(t?.side ?? "");
          const qty = toNumber(t?.execQty ?? t?.qty);
          const price = toNumber(t?.execPrice ?? t?.price);
          const value = toNumber(t?.execValue ?? t?.value);
          const fee = toNumber(t?.execFee ?? t?.fee);
          const execType = String(t?.execType ?? t?.exec_type ?? "");
          const orderId = String(t?.orderId ?? t?.orderID ?? "");
          const orderLinkId = String(
            t?.orderLinkId ?? t?.orderLinkID ?? t?.clOrdId ?? ""
          );
          const isMaker =
            typeof t?.isMaker === "boolean" ? t.isMaker : undefined;

          const parts: string[] = [];
          if (
            symbol &&
            side &&
            Number.isFinite(qty) &&
            Number.isFinite(price)
          ) {
            parts.push(
              `${symbol} ${side} ${formatNumber(qty, 4)} @ ${formatNumber(
                price,
                6
              )}`
            );
          } else if (symbol && side) {
            parts.push(`${symbol} ${side}`);
          }
          if (Number.isFinite(value)) {
            parts.push(`value ${formatNumber(value, 4)}`);
          }
          if (Number.isFinite(fee)) {
            parts.push(`fee ${formatNumber(fee, 4)}`);
          }
          if (execType) parts.push(`type ${execType}`);
          if (orderId) parts.push(`order ${orderId}`);
          if (orderLinkId) parts.push(`link ${orderLinkId}`);
          if (typeof isMaker === "boolean") {
            parts.push(isMaker ? "maker" : "taker");
          }

          const message = parts.filter(Boolean).join(" | ");
          if (!message) return null;
          const id = String(
            t?.execId ?? t?.tradeId ?? `${symbol}-${timestamp}`
          );
          if (execSeen.has(id)) return null;
          execSeen.add(id);
          return {
            id,
            timestamp,
            action: "SYSTEM",
            message,
          } as LogEntry;
        })
        .filter((entry: LogEntry | null): entry is LogEntry => Boolean(entry));
      if (tradeLogs.length) {
        addLogEntries(tradeLogs);
      } else {
        setLogEntries((prev) => prev ?? []);
      }
      setLastSuccessAt(now);
    } else {
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
    enforceCheatLimitExpiry,
    fetchJson,
    refreshDiagnosticsFromDecisions,
    syncTrailingProtection,
    useTestnet,
  ]);

  const submitReduceOnlyOrder = useCallback(
    async (pos: ActivePosition, qty: number) => {
      if (!authToken) throw new Error("missing_auth_token");
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("invalid_reduce_qty");
      }
      const closeSide =
        String(pos.side).toLowerCase() === "buy" ? "Sell" : "Buy";
      const payload = {
        symbol: pos.symbol,
        side: closeSide,
        qty: Math.abs(qty),
        orderType: "Market",
        reduceOnly: true,
        timeInForce: "IOC",
        positionIdx: Number.isFinite(pos.positionIdx)
          ? pos.positionIdx
          : undefined,
      };
      await postJson("/order", payload as unknown as Record<string, unknown>);
      await refreshFast();
      return true;
    },
    [authToken, postJson, refreshFast]
  );

  const updateProtection = useCallback(
    async (payload: {
      symbol: string;
      sl?: number;
      tp?: number;
      trailingStop?: number;
      trailingActivePrice?: number;
      positionIdx?: number;
    }) => {
      await postJson("/protection", payload as unknown as Record<string, unknown>);
    },
    [postJson]
  );

  const resolveScalpExitMode = useCallback(
    (
      symbol: Symbol,
      decision: PriceFeedDecision,
      side: "Buy" | "Sell",
      entry: number
    ) => {
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      if (!core || !Number.isFinite(entry) || entry <= 0) {
        return { mode: "TRAIL" as const, reason: "default" };
      }
      const trendOk = core.m15TrendLongOk || core.m15TrendShortOk;
      const trendWeak =
        !trendOk ||
        core.m15MacdWeak2 ||
        core.m15MacdWeak3 ||
        core.m15EmaCompression ||
        core.m15WickIndecisionSoft ||
        core.m15ImpulseWeak;
      const atr =
        Number.isFinite(core.m15Atr14) && core.m15Atr14 > 0
          ? core.m15Atr14
          : core.htfAtr14;
      const htfLevel =
        side === "Buy"
          ? core.htfPivotHigh ?? core.htfPivotLow
          : core.htfPivotLow ?? core.htfPivotHigh;
      const nearHtf =
        Number.isFinite(htfLevel) &&
        Number.isFinite(atr) &&
        atr > 0 &&
        Math.abs((htfLevel as number) - entry) <= atr * SCALP_HTF_NEAR_ATR;
      if (nearHtf) {
        return { mode: "TP" as const, reason: "near_htf" };
      }
      if (trendWeak) {
        return { mode: "TP" as const, reason: "weak_trend" };
      }
      return { mode: "TRAIL" as const, reason: "strong_trend" };
    },
    []
  );

  const handleScalpInTrade = useCallback(
    async (symbol: string, decision: PriceFeedDecision, now: number) => {
      const pos = positionsRef.current.find((p) => p.symbol === symbol);
      if (!pos) return;
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      if (!core) return;
      const sizeRaw = toNumber(pos.size ?? pos.qty);
      if (!Number.isFinite(sizeRaw) || sizeRaw <= 0) return;
      const side = pos.side === "Sell" ? "Sell" : "Buy";
      const entry = toNumber(pos.entryPrice);
      const sl = toNumber(pos.sl);
      const price = Number.isFinite(pos.markPrice)
        ? toNumber(pos.markPrice)
        : toNumber(core.ltfClose);
      if (
        !Number.isFinite(entry) ||
        !Number.isFinite(sl) ||
        !Number.isFinite(price)
      ) {
        return;
      }
      const risk = Math.abs(entry - sl);
      const rMultiple = computeRMultiple(entry, sl, price, side);
      const hasTrailing =
        Number.isFinite(pos.currentTrailingStop) && (pos.currentTrailingStop as number) > 0;

      const exitKey = symbol;
      if (!scalpExitStateRef.current.has(exitKey)) {
        const resolved = resolveScalpExitMode(
          symbol as Symbol,
          decision,
          side,
          entry
        );
        scalpExitStateRef.current.set(exitKey, {
          mode: resolved.mode,
          switched: false,
          decidedAt: now,
        });
        if (resolved.mode === "TRAIL" && Number.isFinite(core.atr14) && core.atr14 > 0) {
          const offset = (core.atr14 * SCALP_EXIT_TRAIL_ATR) / entry;
          if (Number.isFinite(offset) && offset > 0) {
            trailOffsetRef.current.set(symbol, offset);
          }
        } else {
          trailOffsetRef.current.delete(symbol);
        }
        addLogEntries([
          {
            id: `scalp-exit:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `${symbol} scalp exit mode ${resolved.mode} (${resolved.reason})`,
          },
        ]);
      }

      const currentExit = scalpExitStateRef.current.get(exitKey);
      if (currentExit && !currentExit.switched) {
        const nextPref = resolveScalpExitMode(
          symbol as Symbol,
          decision,
          side,
          entry
        );
        if (nextPref.mode !== currentExit.mode) {
          scalpExitStateRef.current.set(exitKey, {
            ...currentExit,
            mode: nextPref.mode,
            switched: true,
          });
          if (nextPref.mode === "TRAIL") {
            if (Number.isFinite(core.atr14) && core.atr14 > 0) {
              const distance = Math.max(
                core.atr14 * SCALP_EXIT_TRAIL_ATR,
                resolveMinProtectionDistance(entry, core.atr14)
              );
              const dir = side === "Buy" ? 1 : -1;
              const riskDistance =
                Number.isFinite(risk) && risk > 0 ? risk : distance;
              const activePrice = entry + dir * riskDistance;
              if (Number.isFinite(activePrice) && activePrice > 0) {
                try {
                  await updateProtection({
                    symbol,
                    trailingStop: distance,
                    trailingActivePrice: activePrice,
                    positionIdx: Number.isFinite(pos.positionIdx)
                      ? pos.positionIdx
                      : undefined,
                  });
                  trailOffsetRef.current.set(symbol, distance / entry);
                } catch (err) {
                  addLogEntries([
                    {
                      id: `scalp-exit:trail:error:${symbol}:${now}`,
                      timestamp: new Date(now).toISOString(),
                      action: "ERROR",
                      message: `${symbol} scalp trail switch failed: ${asErrorMessage(err)}`,
                    },
                  ]);
                }
              }
            }
          } else {
            const risk = Math.abs(entry - sl);
            if (Number.isFinite(risk) && risk > 0) {
              const tp =
                side === "Buy" ? entry + 1.5 * risk : entry - 1.5 * risk;
              try {
                await updateProtection({
                  symbol,
                  tp,
                  positionIdx: Number.isFinite(pos.positionIdx)
                    ? pos.positionIdx
                    : undefined,
                });
              } catch (err) {
                addLogEntries([
                  {
                    id: `scalp-exit:tp:error:${symbol}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "ERROR",
                    message: `${symbol} scalp TP switch failed: ${asErrorMessage(err)}`,
                  },
                ]);
              }
            }
          }
          addLogEntries([
            {
              id: `scalp-exit:switch:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} scalp exit switch -> ${nextPref.mode}`,
            },
          ]);
        }
      }

      const exitMode = scalpExitStateRef.current.get(exitKey)?.mode ?? "TRAIL";
      if (
        exitMode === "TRAIL" &&
        !hasTrailing &&
        Number.isFinite(rMultiple) &&
        rMultiple >= 1 &&
        Number.isFinite(core.atr14) &&
        core.atr14 > 0 &&
        Number.isFinite(risk) &&
        risk > 0
      ) {
        const distance = Math.max(
          core.atr14 * SCALP_EXIT_TRAIL_ATR,
          resolveMinProtectionDistance(entry, core.atr14)
        );
        const dir = side === "Buy" ? 1 : -1;
        const activePrice = entry + dir * risk;
        if (Number.isFinite(activePrice) && activePrice > 0) {
          try {
            await updateProtection({
              symbol,
              trailingStop: distance,
              trailingActivePrice: activePrice,
              positionIdx: Number.isFinite(pos.positionIdx)
                ? pos.positionIdx
                : undefined,
            });
            trailOffsetRef.current.set(symbol, distance / entry);
            scalpTrailCooldownRef.current.set(symbol, now);
            addLogEntries([
              {
                id: `scalp-trail:activate:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} trail active @ +1R | dist ${formatNumber(
                  distance,
                  6
                )}`,
              },
            ]);
          } catch (err) {
            addLogEntries([
              {
                id: `scalp-trail:activate:error:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "ERROR",
                message: `${symbol} trail activation failed: ${asErrorMessage(err)}`,
              },
            ]);
          }
        }
      }

      const shouldRun = (key: string, cooldownMs: number) => {
        const last = scalpActionCooldownRef.current.get(key) ?? 0;
        if (now - last < cooldownMs) return false;
        scalpActionCooldownRef.current.set(key, now);
        return true;
      };

      const candleAgainst =
        side === "Buy"
          ? Number.isFinite(core.ltfClose) && Number.isFinite(core.ltfOpen)
            ? core.ltfClose < core.ltfOpen
            : false
          : Number.isFinite(core.ltfClose) && Number.isFinite(core.ltfOpen)
            ? core.ltfClose > core.ltfOpen
            : false;
      const killReasons: string[] = [];
      const chochAgainst = side === "Buy" ? core.microBreakShort : core.microBreakLong;
      if (chochAgainst) killReasons.push("CHoCH");
      const closeBreak =
        side === "Buy"
          ? Number.isFinite(core.lastPivotLow) && core.ltfClose < (core.lastPivotLow as number)
          : Number.isFinite(core.lastPivotHigh) && core.ltfClose > (core.lastPivotHigh as number);
      if (closeBreak) killReasons.push("HL/LH break");
      if (core.ltfRangeExpansionSma && core.volumeSpike && candleAgainst) {
        killReasons.push("range exp + vol");
      }

      if (killReasons.length && shouldRun(`${symbol}:kill`, 15_000)) {
        try {
          await submitReduceOnlyOrder(pos, Math.abs(sizeRaw));
          addLogEntries([
            {
              id: `scalp-kill:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} scalp kill-switch: ${killReasons.join(", ")} -> EXIT`,
            },
          ]);
        } catch (err) {
          addLogEntries([
            {
              id: `scalp-kill:error:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
              message: `${symbol} scalp kill failed: ${asErrorMessage(err)}`,
            },
          ]);
        }
        return;
      }

      const timeDecay =
        (side === "Buy" ? core.ltfNoNewHigh : core.ltfNoNewLow) &&
        core.ltfRsiNeutral &&
        (core.volumeFalling ||
          (Number.isFinite(core.volumeCurrent) &&
            Number.isFinite(core.volumeSma) &&
            core.volumeCurrent < core.volumeSma));
      if (timeDecay && shouldRun(`${symbol}:decay`, 30_000)) {
        if (!Number.isFinite(rMultiple) || rMultiple < 1) {
          try {
            await submitReduceOnlyOrder(pos, Math.abs(sizeRaw));
            addLogEntries([
              {
                id: `scalp-decay:exit:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} time decay <1R -> EXIT`,
              },
            ]);
          } catch (err) {
            addLogEntries([
              {
                id: `scalp-decay:error:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "ERROR",
                message: `${symbol} time decay exit failed: ${asErrorMessage(err)}`,
              },
            ]);
          }
          return;
        }
        const lastPartial = scalpPartialCooldownRef.current.get(symbol) ?? 0;
        if (now - lastPartial >= 30_000) {
          const partialQty = Math.abs(sizeRaw) * 0.5;
          try {
            await submitReduceOnlyOrder(pos, partialQty);
            scalpPartialCooldownRef.current.set(symbol, now);
            await updateProtection({
              symbol,
              sl: entry,
              positionIdx: Number.isFinite(pos.positionIdx)
                ? pos.positionIdx
                : undefined,
            });
            addLogEntries([
              {
                id: `scalp-decay:partial:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} time decay >=1R -> PARTIAL + BE`,
              },
            ]);
          } catch (err) {
            addLogEntries([
              {
                id: `scalp-decay:partial:error:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "ERROR",
                message: `${symbol} time decay partial failed: ${asErrorMessage(err)}`,
              },
            ]);
          }
        }
        return;
      }

      const volumeSpikeAgainst =
        candleAgainst &&
        Number.isFinite(core.volumeCurrent) &&
        Number.isFinite(core.volumeSma) &&
        core.volumeCurrent >= core.volumeSma * SCALP_VOL_SPIKE_MULT;
      const priceStalled = side === "Buy" ? core.ltfNoNewHigh : core.ltfNoNewLow;
      const volumeReversal =
        volumeSpikeAgainst && priceStalled && core.volumeRising;

      if (volumeReversal && shouldRun(`${symbol}:vol`, 20_000)) {
        const lastTrail = scalpTrailCooldownRef.current.get(symbol) ?? 0;
        if (
          Number.isFinite(core.atr14) &&
          core.atr14 > 0 &&
          now - lastTrail >= 20_000
        ) {
          const distance = Math.max(
            core.atr14 * SCALP_TRAIL_TIGHTEN_ATR,
            resolveMinProtectionDistance(entry, core.atr14)
          );
          const dir = side === "Buy" ? 1 : -1;
          const activePrice = entry + dir * distance;
          if (Number.isFinite(activePrice) && activePrice > 0) {
            try {
              await updateProtection({
                symbol,
                trailingStop: distance,
                trailingActivePrice: activePrice,
                positionIdx: Number.isFinite(pos.positionIdx)
                  ? pos.positionIdx
                  : undefined,
              });
              scalpTrailCooldownRef.current.set(symbol, now);
              trailOffsetRef.current.set(symbol, distance / entry);
              addLogEntries([
                {
                  id: `scalp-vol:trail:${symbol}:${now}`,
                  timestamp: new Date(now).toISOString(),
                  action: "STATUS",
                  message: `${symbol} vol reversal -> tighten trail ${formatNumber(
                    distance,
                    6
                  )}`,
                },
              ]);
              return;
            } catch (err) {
              addLogEntries([
                {
                  id: `scalp-vol:trail:error:${symbol}:${now}`,
                  timestamp: new Date(now).toISOString(),
                  action: "ERROR",
                  message: `${symbol} vol trail tighten failed: ${asErrorMessage(err)}`,
                },
              ]);
            }
          }
        }
        const lastPartial = scalpPartialCooldownRef.current.get(symbol) ?? 0;
        if (now - lastPartial >= 30_000) {
          const partialQty = Math.abs(sizeRaw) * 0.5;
          try {
            await submitReduceOnlyOrder(pos, partialQty);
            scalpPartialCooldownRef.current.set(symbol, now);
            addLogEntries([
              {
                id: `scalp-vol:partial:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} vol reversal -> partial 50%`,
              },
            ]);
          } catch (err) {
            addLogEntries([
              {
                id: `scalp-vol:partial:error:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "ERROR",
                message: `${symbol} vol partial failed: ${asErrorMessage(err)}`,
              },
            ]);
          }
        }
      }
    },
    [
      addLogEntries,
      resolveScalpExitMode,
      submitReduceOnlyOrder,
      updateProtection,
    ]
  );

  const refreshSlow = useCallback(async () => {
    if (slowPollRef.current) return;
    slowPollRef.current = true;

    const now = Date.now();
    const results = await Promise.allSettled([
      fetchJson("/wallet"),
      fetchJson("/closed-pnl", { limit: "200" }),
      fetchJson("/reconcile"),
    ]);

    let sawError = false;
    const newLogs: LogEntry[] = [];
    const [walletRes, closedPnlRes, reconcileRes] = results;

    if (walletRes.status === "fulfilled") {
      const list = extractList(walletRes.value);
      const row = list[0] ?? {};
      const totalEquity = toNumber(
        row?.totalEquity ?? row?.totalWalletBalance
      );
      const availableBalance = toNumber(
        row?.totalAvailableBalance ?? row?.availableBalance
      );
      const totalWalletBalance = toNumber(row?.totalWalletBalance);
      setWalletSnapshot({
        totalEquity,
        availableBalance,
        totalWalletBalance,
      });
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(walletRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (closedPnlRes.status === "fulfilled") {
      const list = extractList(closedPnlRes.value);
      const records = list
        .map((r: any) => {
          const ts = toNumber(r?.execTime ?? r?.updatedTime ?? r?.createdTime);
          const pnl = toNumber(r?.closedPnl ?? r?.realisedPnl);
          const symbol = String(r?.symbol ?? "");
          if (!symbol || !Number.isFinite(ts) || !Number.isFinite(pnl))
            return null;
          return { symbol, pnl, ts };
        })
        .filter((r: ClosedPnlRecord | null): r is ClosedPnlRecord =>
          Boolean(r)
        );
      const lastLossMap = new Map(lastLossBySymbolRef.current);
      for (const r of records) {
        if (r.pnl >= 0) continue;
        const prev = lastLossMap.get(r.symbol) ?? 0;
        if (r.ts > prev) lastLossMap.set(r.symbol, r.ts);
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
        if (pnlSeen.has(id)) continue;
        pnlSeen.add(id);
        newLogs.push({
          id,
          timestamp: new Date(r.ts).toISOString(),
          action: "SYSTEM",
          message: `PNL ${r.symbol} ${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(
            2
          )}`,
        });
      }
      setLastSuccessAt(now);
    } else {
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
        if (!label) continue;
        const severity = String(diff?.severity ?? "").toUpperCase();
        newLogs.push({
          id: `reconcile:${sym}:${label}:${now}`,
          timestamp: new Date(now).toISOString(),
          action: severity === "HIGH" ? "ERROR" : "STATUS",
          message: `RECONCILE ${sym} ${label}`,
        });
      }
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(reconcileRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (newLogs.length) {
      addLogEntries(newLogs);
    } else {
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
      if (!alive) return;
      await refreshFast();
    };
    const tickSlow = async () => {
      if (!alive) return;
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

  async function autoTrade(signal: {
    symbol: Symbol;
    side: "Buy" | "Sell";
    entryPrice: number;
    slPrice: number;
    tpPrices: number[];
    entryType: EntryType;
    triggerPrice?: number;
    qtyMode: "USDT_NOTIONAL" | "BASE_QTY";
    qtyValue: number;
    intentId?: string;
  }) {
    if (!authToken) throw new Error("missing_auth_token");
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
    } as const;

    await sendIntent(intent, { authToken, useTestnet });
  }

  const handleDecision = useCallback(
    (symbol: string, decision: PriceFeedDecision) => {
      const now = Date.now();
      const isSelected = activeSymbols.includes(symbol as Symbol);
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
        if (p.symbol !== symbol) return false;
        const size = toNumber(p.size ?? p.qty);
        return Number.isFinite(size) && size > 0;
      });
      const hasEntryOrder = ordersRef.current.some(
        (order) =>
          isActiveEntryOrder(order) && String(order?.symbol ?? "") === symbol
      );
      const hasPendingIntent = intentPendingRef.current.has(symbol);
      const paused = feedPauseRef.current.has(symbol);
      // Pokud je feed pro tento symbol pozastavený, čekáme dokud se nevyčistí
      // pending intent / otevřená pozice / entry order, potom automaticky obnovíme.
      if (paused) {
        if (hasPosition && scalpActive) {
          void handleScalpInTrade(symbol, decision, now);
        }
        if (hasPosition || hasEntryOrder || hasPendingIntent) {
          return;
        }
        feedPauseRef.current.delete(symbol);
      }
      if (isProProfile) {
        const proRegime = (decision as any)?.proRegime as { shock?: boolean } | undefined;
        if (proRegime?.shock) {
          const shockKey = `pro-shock:${symbol}`;
          const last = autoCloseCooldownRef.current.get(shockKey) ?? 0;
          if (now - last >= 15_000) {
            autoCloseCooldownRef.current.set(shockKey, now);
            const cancelTargets = ordersRef.current.filter(
              (order) =>
                isEntryOrder(order) && String(order?.symbol ?? "") === symbol
            );
            cancelTargets.forEach((order) => {
              const orderId = order.orderId || "";
              const orderLinkId = order.orderLinkId || "";
              void postJson("/cancel", {
                symbol,
                orderId: orderId || undefined,
                orderLinkId: orderLinkId || undefined,
              }).catch(() => null);
            });
            if (hasPosition) {
              const pos = positionsRef.current.find((p) => p.symbol === symbol);
              if (pos) {
                void submitReduceOnlyOrder(pos, Math.abs(toNumber(pos.size ?? pos.qty))).catch(
                  () => null
                );
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
      }
      const cheatHold =
        settingsRef.current.riskMode === "ai-matic-x" &&
        settingsRef.current.strategyCheatSheetEnabled;
      if (cheatHold) {
        if (hasPosition || hasEntryOrder) {
          const reason = hasPosition ? "position" : "order";
          const key = `cheat-hold:${symbol}:${reason}`;
          const last = logDedupeRef.current.get(key) ?? 0;
          if (now - last > 10_000) {
            logDedupeRef.current.set(key, now);
            addLogEntries([
              {
                id: `cheat-hold:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} CHEAT HOLD (${reason})`,
              },
            ]);
          }
          return;
        }
      } else if (hasPosition || hasEntryOrder) {
        if (hasPosition && scalpActive) {
          void handleScalpInTrade(symbol, decision, now);
        }
        if (hasPosition && isProProfile) {
          const orderflow = (decision as any)?.orderflow as
            | { ofi?: number; cvd?: number; cvdPrev?: number }
            | undefined;
          const pos = positionsRef.current.find((p) => p.symbol === symbol);
          if (pos && orderflow) {
            const side = String(pos.side ?? "");
            const ofi = toNumber(orderflow.ofi);
            const cvd = toNumber(orderflow.cvd);
            const cvdPrev = toNumber(orderflow.cvdPrev);
            const cvdChange =
              Number.isFinite(cvd) && Number.isFinite(cvdPrev)
                ? cvd - cvdPrev
                : Number.NaN;
            const ofiFlip =
              side === "Buy"
                ? Number.isFinite(ofi) && ofi < 0
                : Number.isFinite(ofi) && ofi > 0;
            const cvdFlip =
              side === "Buy"
                ? Number.isFinite(cvdChange) && cvdChange < 0
                : Number.isFinite(cvdChange) && cvdChange > 0;
            if (ofiFlip || cvdFlip) {
              const flipKey = `pro-flip:${symbol}`;
              const last = autoCloseCooldownRef.current.get(flipKey) ?? 0;
              if (now - last >= 15_000) {
                autoCloseCooldownRef.current.set(flipKey, now);
                void submitReduceOnlyOrder(
                  pos,
                  Math.abs(toNumber(pos.size ?? pos.qty))
                ).catch(() => null);
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
          const aiMatic = (decision as any)?.aiMatic as AiMaticContext | null;
          const pos = positionsRef.current.find((p) => p.symbol === symbol);
          const side = pos?.side === "Sell" ? "Sell" : "Buy";
          const structureTrend = aiMatic?.htf.structureTrend ?? "RANGE";
          const htfFlip =
            side === "Buy" ? structureTrend === "BEAR" : structureTrend === "BULL";
          const chochAgainst =
            side === "Buy" ? aiMatic?.ltf.chochDown : aiMatic?.ltf.chochUp;
          if (htfFlip || chochAgainst) {
            const reason = htfFlip ? "HTF flip" : "CHoCH";
            const key = `ai-matic-struct:${symbol}:${reason}`;
            const last = aiMaticStructureLogRef.current.get(key) ?? 0;
            if (now - last >= 15_000) {
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
        : evaluateCoreV2(symbol as Symbol, decision, rawSignal, feedAgeMs);
      const checklistBase = evaluateChecklistPass(coreEval.gates);
      let signal = rawSignal;
      if (!signal && checklistBase.pass && !isProProfile) {
        signal = buildChecklistSignal(symbol as Symbol, decision, now);
      }
      if (!signal) return;

      const signalId = String(signal.id ?? `${symbol}-${now}`);
      if (signalSeenRef.current.has(signalId)) return;
      signalSeenRef.current.add(signalId);

      if (isAiMaticProfile) {
        const aiMaticEval = evaluateAiMaticGates(symbol, decision, signal);
        if (!aiMaticEval.pass) {
          const hardFails = aiMaticEval.hardGates
            .filter((g) => !g.ok)
            .map((g) => g.name);
          const entryFails = aiMaticEval.entryFactors
            .filter((g) => !g.ok)
            .map((g) => g.name);
          const checklistFails = aiMaticEval.checklist
            .filter((g) => !g.ok)
            .map((g) => g.name);
          const entryCount = aiMaticEval.entryFactors.filter((g) => g.ok).length;
          const checklistCount = aiMaticEval.checklist.filter((g) => g.ok).length;
          const reasons: string[] = [];
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
              message: `${symbol} AI-MATIC gate entry ${entryCount}/${AI_MATIC_ENTRY_FACTOR_MIN} | checklist ${checklistCount}/${AI_MATIC_CHECKLIST_MIN} -> NO TRADE${reasons.length ? ` (${reasons.join(" | ")})` : ""}`,
            },
          ]);
          return;
        }
      }

      const isTreeProfile = settingsRef.current.riskMode === "ai-matic-tree";
      const treePayload = (decision as any)?.cheatSignals;
      const treeDepsRaw = (decision as any)?.cheatDeps;
      let treeInputs: { deps: TreeDeps; signals: TreeSignals } | null = null;
      let treeDecision: ReturnType<typeof decideCombinedEntry> | null = null;
      let treeTrailOverride: number | null = null;
      if (isTreeProfile) {
        if (!treePayload || !treeDepsRaw) {
          addLogEntries([
            {
              id: `tree-missing:${symbol}:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} TREE no-trade: missing signals/deps`,
            },
          ]);
          return;
        }
        treeInputs = buildTreeInputs(treeDepsRaw, treePayload);
        treeDecision = decideCombinedEntry(treeInputs.deps, treeInputs.signals);
        if (!treeDecision.ok) {
          const reason = treeDecision.blocks?.length
            ? treeDecision.blocks.join(", ")
            : "NO_VALID_ENTRY";
          addLogEntries([
            {
              id: `tree-block:${symbol}:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} TREE no-trade: ${reason}`,
            },
          ]);
          return;
        }
        const impacts =
          treeDecision.blocks?.filter((block) => block.startsWith("IMPACT:")) ??
          [];
        if (impacts.length) {
          addLogEntries([
            {
              id: `tree-impact:${symbol}:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} TREE impacts: ${impacts.join(", ")}`,
            },
          ]);
        }
        if (treeDecision.trailing === "ACTIVATE_AFTER_0_5_TO_0_7_PCT") {
          treeTrailOverride = TREE_SCALP_TRAIL_PCT;
        }
      }
      const treeAddonActive =
        isTreeProfile &&
        Boolean(treeDecision?.ok) &&
        Boolean(treeInputs?.signals.structureReadable);

      if (treeAddonActive) {
        const kind = signal.kind ?? "OTHER";
        if (kind !== "PULLBACK" && kind !== "MEAN_REVERSION") {
          addLogEntries([
            {
              id: `tree-kind-block:${symbol}:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} TREE kind block: ${kind}`,
            },
          ]);
          return;
        }
      }

      if (isTreeProfile && treeDecision?.side) {
        const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
        const signalSide =
          sideRaw === "buy" ? "LONG" : sideRaw === "sell" ? "SHORT" : null;
        if (signalSide && signalSide !== treeDecision.side) {
          const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
          const forcedBias = treeDecision.side === "LONG" ? "BULL" : "BEAR";
          const forcedMessage = signal.message
            ? `${signal.message} | TREE side forced ${treeDecision.side}`
            : `TREE side forced ${treeDecision.side}`;
          const forcedSignal = core
            ? buildBiasSignal(symbol as Symbol, core, now, forcedBias, forcedMessage)
            : null;
          if (!forcedSignal) {
            addLogEntries([
              {
                id: `tree-force-fail:${symbol}:${signalId}`,
                timestamp: new Date(now).toISOString(),
                action: "RISK_BLOCK",
                message: `${symbol} TREE force failed: missing core/pivots/atr`,
              },
            ]);
            return;
          }
          forcedSignal.id = signalId;
          signal = forcedSignal;
        }
      }

      const trendGateSetting = settingsRef.current.trendGateMode ?? "adaptive";
      const treeAdaptiveGate = isTreeProfile && trendGateSetting === "adaptive";
      if (treeAdaptiveGate) {
        const trendAdx = toNumber((decision as any)?.trendAdx);
        const trendScore = toNumber((decision as any)?.trendScore);
        const alignedCount = toNumber((decision as any)?.htfTrend?.alignedCount);
        const trendRaw = String(
          (decision as any)?.trend ?? (decision as any)?.trendH1 ?? ""
        );
        const trendDir = normalizeTrendDir(trendRaw);
        const structureStrong =
          (Number.isFinite(trendScore) &&
            trendScore >= TREND_GATE_STRONG_SCORE) ||
          (Number.isFinite(alignedCount) && alignedCount >= 2) ||
          trendDir === "BULL" ||
          trendDir === "BEAR";
        let expectedKind: "MEAN_REVERSION" | "PULLBACK" | null = null;
        if (Number.isFinite(trendAdx) && trendAdx < TREND_DAY_ADX_MIN) {
          expectedKind = "MEAN_REVERSION";
        } else if (
          Number.isFinite(trendAdx) &&
          trendAdx >= TREND_GATE_STRONG_ADX &&
          structureStrong
        ) {
          expectedKind = "PULLBACK";
        }
        if (expectedKind) {
          const kind = signal.kind ?? "OTHER";
          if (kind !== expectedKind) {
            addLogEntries([
              {
                id: `tree-trend-gate:${symbol}:${signalId}`,
                timestamp: new Date(now).toISOString(),
                action: "RISK_BLOCK",
                message: `${symbol} TREE adaptive gate: ADX ${formatNumber(
                  trendAdx,
                  1
                )} → expect ${expectedKind}, got ${kind}`,
              },
            ]);
            return;
          }
        }
      }

      const intent = signal.intent;
      const entry = toNumber(intent?.entry);
      const sl = toNumber(intent?.sl);
      const tp = toNumber(intent?.tp);
      const side =
        String(intent?.side ?? "").toLowerCase() === "buy" ? "Buy" : "Sell";
      let entryType =
        signal.entryType === "CONDITIONAL" ||
        signal.entryType === "LIMIT" ||
        signal.entryType === "LIMIT_MAKER_FIRST" ||
        signal.entryType === "MARKET"
          ? signal.entryType
          : "LIMIT_MAKER_FIRST";
      const timestamp =
        signal.createdAt || new Date(now).toISOString();

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
      if (signal.message) msgParts.push(signal.message);

      const isChecklistSignal =
        signal.message === "Checklist auto-signál" ||
        signal.message === "Checklist auto-signal";
      const signalKey = `${symbol}:${side}`;
      const lastSignalLog = signalLogThrottleRef.current.get(signalKey) ?? 0;
      const shouldLogSignal =
        !isChecklistSignal || now - lastSignalLog >= SIGNAL_LOG_THROTTLE_MS;
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

      const trendCore = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const trendGate = resolveH1M15TrendGate(trendCore, signal);
      if (!trendGate.ok) {
        addLogEntries([
          {
            id: `signal:trend-gate:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "RISK_BLOCK",
            message: `${symbol} trend gate 1h/15m: ${trendGate.detail}`,
          },
        ]);
        return;
      }

      const context = getSymbolContext(symbol, decision);
      const isAiMaticX = context.settings.riskMode === "ai-matic-x";
      const isScalpProfile = context.settings.riskMode === "ai-matic-scalp";
      const xContext = (decision as any)?.xContext as AiMaticXContext | undefined;
      const hasSymbolPosition = context.hasPosition;
      const hasSymbolEntryOrder = ordersRef.current.some(
        (order) =>
          isEntryOrder(order) && String(order?.symbol ?? "") === symbol
      );
      const cooldownMs = CORE_V2_COOLDOWN_MS[context.settings.riskMode];
      const lastLossTs = lastLossBySymbolRef.current.get(symbol) ?? 0;
      const lastCloseTs = lastCloseBySymbolRef.current.get(symbol) ?? 0;
      const lastIntentTs = lastIntentBySymbolRef.current.get(symbol) ?? 0;
      const entryLockTs = entryOrderLockRef.current.get(symbol) ?? 0;
      const entryBlockReasons: string[] = [];
      if (hasSymbolPosition) entryBlockReasons.push("open position");
      if (hasSymbolEntryOrder) entryBlockReasons.push("open order");
      if (hasPendingIntent) entryBlockReasons.push("pending intent");
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
      const closeCooldownMs = isScalpProfile
        ? SCALP_COOLDOWN_MS
        : REENTRY_COOLDOWN_MS;
      if (lastCloseTs && now - lastCloseTs < closeCooldownMs) {
        const remainingMs = Math.max(0, closeCooldownMs - (now - lastCloseTs));
        const remainingSec = Math.ceil(remainingMs / 1000);
        entryBlockReasons.push(`recent close ${remainingSec}s`);
      }
      if (lastLossTs && now - lastLossTs < cooldownMs) {
        const remainingMs = Math.max(0, cooldownMs - (now - lastLossTs));
        const remainingMin = Math.ceil(remainingMs / 60_000);
        entryBlockReasons.push(`cooldown ${remainingMin}m`);
      }
      if (!context.maxPositionsOk) entryBlockReasons.push("max positions");
      if (!context.ordersClearOk) entryBlockReasons.push("max orders");
      if (entryBlockReasons.length > 0) {
        const profileLabel =
          PROFILE_BY_RISK_MODE[context.settings.riskMode] ?? "AI-MATIC";
        const skipKey = `${symbol}:${entryBlockReasons.join(",")}`;
        const lastSkipLog = skipLogThrottleRef.current.get(skipKey) ?? 0;
        if (now - lastSkipLog >= SKIP_LOG_THROTTLE_MS) {
          skipLogThrottleRef.current.set(skipKey, now);
          addLogEntries([
            {
              id: `signal:max-pos:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} ${profileLabel} gate: ${entryBlockReasons.join(
                ", "
              )} -> skip entry`,
            },
          ]);
        }
        return;
      }
      let riskOff = false;
      const riskReasons: string[] = [];
      if (isAiMaticX) {
        if (xContext?.riskOff) {
          riskOff = true;
          riskReasons.push("chop");
        }
      }
      if (isScalpProfile) {
        const lossStreak = computeLossStreak(
          closedPnlRecords,
          SCALP_MAX_LOSSES_IN_ROW
        );
        const equity = getEquityValue();
        const riskBudget =
          Number.isFinite(equity) && equity > 0
            ? equity * (CORE_V2_RISK_PCT["ai-matic-scalp"] ?? 0)
            : Number.NaN;
        const dayAgo = now - 24 * 60 * 60_000;
        const dailyPnlUsd = Array.isArray(closedPnlRecords)
          ? closedPnlRecords.reduce((sum, r) => {
              if (r.ts < dayAgo) return sum;
              return sum + r.pnl;
            }, 0)
          : Number.NaN;
        const dailyLossR =
          Number.isFinite(riskBudget) && riskBudget > 0
            ? dailyPnlUsd / riskBudget
            : Number.NaN;
        if (lossStreak >= SCALP_MAX_LOSSES_IN_ROW) {
          riskOff = true;
          riskReasons.push(`loss_streak ${lossStreak}`);
        }
        if (
          Number.isFinite(dailyLossR) &&
          dailyLossR <= SCALP_MAX_DAILY_LOSS_R
        ) {
          riskOff = true;
          riskReasons.push(`daily_R ${dailyLossR.toFixed(2)}`);
        }
      }
      const riskOn = !riskOff;
      if (!riskOn) {
        addLogEntries([
          {
            id: `signal:risk:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "RISK_BLOCK",
            message: `${symbol} risk off: ${riskReasons.join(", ")}`,
          },
        ]);
        if (!isScalpProfile) {
          return;
        }
      }

      // reuse feedAgeMs + coreEval computed above
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const scalpPrimary = computeScalpPrimaryChecklist(core);
      const scalpGuards = isScalpProfile ? evaluateScalpGuards(core) : null;
      if (isScalpProfile && scalpGuards) {
        const guardReasons: string[] = [];
        if (isGateEnabled(SCALP_DRIFT_GATE)) {
          if (scalpGuards.driftBlocked) {
            guardReasons.push(...scalpGuards.driftReasons);
          }
        }
        if (isGateEnabled(SCALP_FAKE_MOMENTUM_GATE)) {
          if (scalpGuards.fakeBlocked) {
            guardReasons.push(...scalpGuards.fakeReasons);
          }
        }
        if (guardReasons.length > 0) {
          const guardKey = `scalp-guard:${symbol}:${guardReasons.join("|")}`;
          const last = skipLogThrottleRef.current.get(guardKey) ?? 0;
          if (now - last >= SKIP_LOG_THROTTLE_MS) {
            skipLogThrottleRef.current.set(guardKey, now);
            addLogEntries([
              {
                id: `signal:scalp-guard:${signalId}`,
                timestamp: new Date(now).toISOString(),
                action: "RISK_BLOCK",
                message: `${symbol} scalp no-trade: ${guardReasons.join(", ")}`,
              },
            ]);
          }
          return;
        }
      }
      const protectedEntry =
        isScalpProfile &&
        isGateEnabled(SCALP_PROTECTED_ENTRY_GATE) &&
        Boolean(scalpGuards?.protectedEntry);
      if (isScalpProfile) {
        const primaryBlocked =
          isGateEnabled(SCALP_PRIMARY_GATE) && !scalpPrimary.primaryOk;
        const entryBlocked =
          isGateEnabled(SCALP_ENTRY_GATE) && !scalpPrimary.entryOk;
        if (primaryBlocked || entryBlocked) {
          addLogEntries([
            {
              id: `signal:scalp-gate:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} scalp gate: ${
                primaryBlocked ? "trend" : "entry"
              } -> NO TRADE`,
            },
          ]);
          return;
        }
      }
      const hardEnabled = false;
      const softEnabled = context.settings.enableSoftGates !== false;
      const hardBlockReasons: string[] = [];
      if (hardEnabled) {
        if (!isScalpProfile) {
          coreEval.gates.forEach((gate) => {
            if (!gate.hard || gate.ok) return;
            if (!isGateEnabled(gate.name)) return;
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

      if (isTreeProfile) {
        entryType = "LIMIT_MAKER_FIRST";
      }
      const checklistGates = [...coreEval.gates];
      if (isScalpProfile) {
        checklistGates.push({
          name: SCALP_PRIMARY_GATE,
          ok: scalpPrimary.primaryOk,
          detail: `15m ${
            scalpPrimary.trendLongOk
              ? "LONG"
              : scalpPrimary.trendShortOk
                ? "SHORT"
                : "NONE"
          } | spread ${
            Number.isFinite(core?.m15EmaSpreadPct)
              ? formatNumber(core!.m15EmaSpreadPct, 4)
              : "—"
          } | LTF ${core?.ltfTimeframeMin ?? "—"}m`,
        });
        checklistGates.push({
          name: SCALP_ENTRY_GATE,
          ok: scalpPrimary.entryOk,
          detail: `EMA cross ${
            scalpPrimary.crossBullOk
              ? "BULL"
              : scalpPrimary.crossBearOk
                ? "BEAR"
                : "no cross"
          }${Number.isFinite(scalpPrimary.emaCrossBarsAgo) ? " <=6b" : ""} | Div ${
            scalpPrimary.divBullOk
              ? "BULL"
              : scalpPrimary.divBearOk
                ? "BEAR"
                : "no"
          } | Vol ${scalpPrimary.volumeOk ? "OK" : "no"}`,
        });
        checklistGates.push({
          name: SCALP_EXIT_GATE,
          ok: scalpPrimary.exitOk,
          detail: Number.isFinite(core?.atr14)
            ? `ATR ${formatNumber(core!.atr14, 4)} | TP 1.5R`
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
        const allowMarket = isAiMaticX && riskOn && xContext?.strongTrendExpanse;
        if (!allowMarket) {
          entryType = "LIMIT";
        }
      }
      const triggerPrice =
        entryType === "CONDITIONAL"
          ? Number.isFinite(signal.triggerPrice)
            ? signal.triggerPrice
            : entry
          : undefined;

      const proTargets = isProProfile ? (signal as any)?.proTargets : null;
      let resolvedSl = sl;
      let resolvedTp = tp;
      if (
        isScalpProfile &&
        Number.isFinite(entry) &&
        entry > 0 &&
        Number.isFinite(core?.atr14) &&
        core!.atr14 > 0
      ) {
        const atr = core!.atr14;
        const structure =
          side === "Buy"
            ? core.lastPivotLow ?? core.pivotLow
            : core.lastPivotHigh ?? core.pivotHigh;
        const atrStop =
          side === "Buy"
            ? entry - SCALP_ATR_MULT_INITIAL * atr
            : entry + SCALP_ATR_MULT_INITIAL * atr;
        let baseStop = Number.isFinite(structure) ? (structure as number) : atrStop;
        if (Number.isFinite(structure)) {
          baseStop =
            side === "Buy"
              ? Math.min(structure as number, atrStop)
              : Math.max(structure as number, atrStop);
        }
        const bufferedStop =
          side === "Buy"
            ? baseStop - atr * SCALP_SL_ATR_BUFFER
            : baseStop + atr * SCALP_SL_ATR_BUFFER;
        if (
          !Number.isFinite(resolvedSl) ||
          resolvedSl <= 0 ||
          (side === "Buy" && bufferedStop < resolvedSl) ||
          (side === "Sell" && bufferedStop > resolvedSl)
        ) {
          resolvedSl = bufferedStop;
        }
        if (Number.isFinite(resolvedSl) && resolvedSl > 0) {
          const risk = Math.abs(entry - resolvedSl);
          if (Number.isFinite(risk) && risk > 0) {
            resolvedTp =
              side === "Buy"
                ? entry + 1.5 * risk
                : entry - 1.5 * risk;
          }
        }
      }
      if (protectedEntry) {
        const protectedSl = resolveProtectedScalpStop(
          core,
          side,
          entry,
          resolvedSl
        );
        if (Number.isFinite(protectedSl) && protectedSl > 0) {
          resolvedSl = protectedSl;
        }
        if (
          isScalpProfile &&
          Number.isFinite(entry) &&
          entry > 0 &&
          Number.isFinite(resolvedSl) &&
          resolvedSl > 0
        ) {
          const risk = Math.abs(entry - resolvedSl);
          if (Number.isFinite(risk) && risk > 0) {
            resolvedTp =
              side === "Buy"
                ? entry + 1.5 * risk
                : entry - 1.5 * risk;
          }
        }
      }

      if (isAiMaticProfile) {
        const aiMatic = (decision as any)?.aiMatic as AiMaticContext | null;
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

      const normalized = normalizeProtectionLevels(
        entry,
        side,
        resolvedSl,
        resolvedTp,
        core?.atr14
      );
      resolvedSl = normalized.sl;
      resolvedTp = normalized.tp;
      if (isProProfile && proTargets && Number.isFinite(proTargets.t2)) {
        resolvedTp = proTargets.t2;
      }

      if (
        !Number.isFinite(entry) ||
        !Number.isFinite(resolvedSl) ||
        entry <= 0 ||
        resolvedSl <= 0
      ) {
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

      if (
        isProProfile &&
        proTargets &&
        Number.isFinite(entry) &&
        Number.isFinite(proTargets.t1) &&
        Number.isFinite(proTargets.t2)
      ) {
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

      let scalpExitMode: "TRAIL" | "TP" | null = null;
      let scalpExitReason: string | null = null;
      if (isScalpProfile) {
        const exitPref = resolveScalpExitMode(
          symbol as Symbol,
          decision,
          side,
          entry
        );
        scalpExitMode = exitPref.mode;
        scalpExitReason = exitPref.reason;
      }

      const fixedSizing = computeFixedSizing(symbol as Symbol, entry, resolvedSl);
      const sizing =
        fixedSizing ?? computeNotionalForSignal(symbol as Symbol, entry, resolvedSl);
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
      const riskOffMultiplier =
        isScalpProfile && riskOff ? SCALP_RISK_OFF_MULT : 1;
      const riskMultiplier = Math.min(
        protectedEntry ? SCALP_PROTECTED_RISK_MULT : 1,
        riskOffMultiplier
      );
      const useFixedQty = fixedSizing?.ok === true;
      const qtyMode = useFixedQty ? "BASE_QTY" : "USDT_NOTIONAL";
      const baseQty = sizing.qty;
      const baseNotional = sizing.notional;
      const adjustedQty =
        Number.isFinite(baseQty) && baseQty > 0 ? baseQty * riskMultiplier : baseQty;
      const adjustedNotional =
        Number.isFinite(baseNotional) && baseNotional > 0
          ? baseNotional * riskMultiplier
          : baseNotional;
      const qtyValue = useFixedQty ? adjustedQty : adjustedNotional;
      if (protectedEntry) {
        addLogEntries([
          {
            id: `signal:protected:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `${symbol} protected entry (risk ${Math.round(
              SCALP_PROTECTED_RISK_MULT * 100
            )}%)`,
          },
        ]);
      }
      if (isScalpProfile && riskOff) {
        addLogEntries([
          {
            id: `signal:riskoff:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `${symbol} risk-off sizing (${Math.round(
              SCALP_RISK_OFF_MULT * 100
            )}%)`,
          },
        ]);
      }

      let trailOffset = toNumber((decision as any)?.trailOffsetPct);
      if (treeTrailOverride != null) {
        trailOffset = treeTrailOverride;
      }
      const allowScalpTrail = !isScalpProfile;
      if (allowScalpTrail && Number.isFinite(trailOffset) && trailOffset > 0) {
        trailOffsetRef.current.set(symbol, trailOffset);
      } else if (treeTrailOverride == null) {
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
      const trackCheatLimit =
        (entryType === "LIMIT" || entryType === "LIMIT_MAKER_FIRST");
      if (trackCheatLimit && Number.isFinite(entry) && entry > 0) {
        cheatLimitMetaRef.current.set(intentId, {
          intentId,
          symbol,
          side,
          entryPrice: entry,
          slPrice: Number.isFinite(resolvedSl) ? resolvedSl : undefined,
          tpPrice: Number.isFinite(resolvedTp) ? resolvedTp : undefined,
          createdAt: now,
          mode: treeDecision?.mode ?? null,
          timeframeMin: Number.isFinite(core?.ltfTimeframeMin)
            ? core!.ltfTimeframeMin
            : null,
        });
      }

      intentPendingRef.current.add(symbol);
      if (isScalpProfile && scalpExitMode) {
        scalpExitStateRef.current.set(symbol, {
          mode: scalpExitMode,
          switched: false,
          decidedAt: now,
        });
        if (scalpExitReason) {
          addLogEntries([
            {
              id: `signal:scalp-exit:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} scalp exit mode ${scalpExitMode} (${scalpExitReason})`,
            },
          ]);
        }
      }
      lastIntentBySymbolRef.current.set(symbol, now);
      entryOrderLockRef.current.set(symbol, now);
      // Pozastavíme feed pro tento symbol, dokud nedoběhne intent/pozice,
      // aby se nevyvolávaly nové obchody při Exec allowed ON.
      feedPauseRef.current.add(symbol);
      const tpPrices =
        isProProfile && proTargets
          ? [proTargets.t1, proTargets.t2].filter(
              (value) => Number.isFinite(value) && value > 0
            )
          : Number.isFinite(resolvedTp)
            ? [resolvedTp]
            : [];
      void (async () => {
        try {
          await autoTrade({
            symbol: symbol as Symbol,
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
              message: `${symbol} intent sent | qty ${formatNumber(
                sizing.qty,
                6
              )} | notional ${formatNumber(sizing.notional, 2)}`,
            },
          ]);
        } catch (err) {
          if (trackCheatLimit) {
            cheatLimitMetaRef.current.delete(intentId);
          }
          addLogEntries([
            {
              id: `signal:error:${signalId}`,
              timestamp: new Date().toISOString(),
              action: "ERROR",
              message: `${symbol} intent failed: ${asErrorMessage(err)}`,
            },
          ]);
        } finally {
          intentPendingRef.current.delete(symbol);
        }
      })();
    },
    [
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
      handleScalpInTrade,
      isGateEnabled,
      isEntryOrder,
      postJson,
      resolveScalpExitMode,
      submitReduceOnlyOrder,
    ]
  );

  useEffect(() => {
    handleDecisionRef.current = handleDecision;
  }, [handleDecision]);

  useEffect(() => {
    if (!authToken) return;

    signalSeenRef.current.clear();
    intentPendingRef.current.clear();
    scalpExitStateRef.current.clear();
    scalpActionCooldownRef.current.clear();
    scalpPartialCooldownRef.current.clear();
    scalpTrailCooldownRef.current.clear();
    aiMaticTp1Ref.current.clear();
    aiMaticTrailCooldownRef.current.clear();
    aiMaticStructureLogRef.current.clear();
    cheatLimitMetaRef.current.clear();
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
    const decisionFn = (
      symbol: string,
      candles: Parameters<typeof evaluateStrategyForSymbol>[1],
      config?: Partial<BotConfig>
    ) => {
      const baseDecision = isPro
        ? evaluateAiMaticProStrategyForSymbol(symbol, candles, { entryTfMin: 5 })
        : isAiMaticX
          ? evaluateAiMaticXStrategyForSymbol(symbol, candles)
          : evaluateStrategyForSymbol(symbol, candles, config);
      const coreV2 = computeCoreV2Metrics(candles, riskMode);
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
      });
      const ltfTrend = ltfTimeframes
        ? evaluateHTFMultiTrend(candles, {
            timeframesMin: ltfTimeframes,
          })
        : null;
      const emaTrend = evaluateEmaMultiTrend(candles, {
        timeframesMin: EMA_TREND_TIMEFRAMES_MIN,
      });
      const scalpContext = isScalp ? buildScalpContext(candles) : undefined;
      const aiMaticContext = isAiMaticCore
        ? buildAiMaticContext(candles, baseDecision, coreV2)
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
    const stop = startPriceFeed(
      feedSymbols,
      (symbol, decision) => {
        handleDecisionRef.current?.(symbol, decision);
      },
      {
        useTestnet,
        timeframe: "1",
        configOverrides: engineConfig,
        decisionFn,
        maxCandles,
        backfill,
        orderflow: isPro ? { enabled: true, depth: 50 } : undefined,
      }
    );

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
    if (!authToken) return;
    let active = true;
    const baseUrl = useTestnet
      ? "https://api-testnet.bybit.com"
      : "https://api.bybit.com";
    const intervalMs = 30_000;

    const pollOpenInterest = async () => {
      if (!active) return;
      if (settingsRef.current.riskMode !== "ai-matic-pro") return;
      const symbols = activeSymbols.length ? activeSymbols : [];
      if (!symbols.length) return;
      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const url = `${baseUrl}/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=1`;
            const res = await fetch(url);
            const json = await res.json().catch(() => ({}));
            const list =
              json?.result?.list ??
              json?.result?.data ??
              json?.result ??
              json?.list ??
              [];
            const row = Array.isArray(list) ? list[0] : list;
            const raw =
              row?.openInterest ??
              row?.open_interest ??
              row?.value ??
              row?.openInterestValue ??
              row?.sumOpenInterest;
            const oi = toNumber(raw);
            if (Number.isFinite(oi) && oi > 0) {
              updateOpenInterest(String(symbol), oi);
            }
          } catch {
            // ignore OI errors
          }
        })
      );
    };

    const id = setInterval(pollOpenInterest, intervalMs);
    void pollOpenInterest();
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [activeSymbols, authToken, useTestnet]);

  useEffect(() => {
    if (!authToken) return;
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

      if (now - lastHeartbeatRef.current < 60_000) return;
      lastHeartbeatRef.current = now;

      const scan: string[] = [];
      const hold: string[] = [];
      for (const symbol of activeSymbols) {
        const state = resolveSymbolState(symbol);
        if (state === "HOLD") hold.push(symbol);
        else scan.push(symbol);
      }

      const parts: string[] = [];
      if (scan.length) parts.push(`scan: ${scan.join(", ")}`);
      if (hold.length) parts.push(`hold: ${hold.join(", ")}`);
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

  const systemState = useMemo<SystemState>(() => {
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

  const portfolioState = useMemo<PortfolioState>(() => {
    const totalEquity = walletSnapshot?.totalEquity ?? Number.NaN;
    const availableBalance = walletSnapshot?.availableBalance ?? Number.NaN;
    const totalWalletBalance =
      walletSnapshot?.totalWalletBalance ?? Number.NaN;
    const openPositions = Array.isArray(positions)
      ? positions.length
      : Number.NaN;
    const allocatedCapital = Array.isArray(positions)
      ? positions.reduce((sum, p) => {
          const size = toNumber(p.size ?? p.qty);
          const entry = toNumber(p.entryPrice);
          if (!Number.isFinite(size) || !Number.isFinite(entry)) return sum;
          return sum + Math.abs(size * entry);
        }, 0)
      : Number.NaN;
    const dailyPnl = Array.isArray(closedPnlRecords)
      ? closedPnlRecords.reduce((sum, r) => {
          const dayAgo = Date.now() - 24 * 60 * 60_000;
          if (r.ts < dayAgo) return sum;
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
  }, [
    closedPnlRecords,
    positions,
    settings.maxOpenPositions,
    walletSnapshot,
  ]);

  const resetPnlHistory = useCallback(() => {
    const symbols = new Set<string>();
    if (assetPnlHistory) {
      Object.keys(assetPnlHistory).forEach((symbol) => {
        if (symbol) symbols.add(symbol);
      });
    }
    if (Array.isArray(positions)) {
      positions.forEach((pos) => {
        if (pos.symbol) symbols.add(pos.symbol);
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

  const manualClosePosition = useCallback(
    async (pos: ActivePosition) => {
      if (!allowPositionClose) {
        throw new Error("close_disabled");
      }
      if (!authToken) throw new Error("missing_auth_token");
      const sizeRaw = toNumber(pos.size ?? pos.qty);
      if (!Number.isFinite(sizeRaw) || sizeRaw <= 0) {
        throw new Error("invalid_position_qty");
      }
      const closeSide =
        String(pos.side).toLowerCase() === "buy" ? "Sell" : "Buy";
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
    },
    [allowPositionClose, apiBase, authToken, refreshFast]
  );

  const cancelOrder = useCallback(
    async (order: TestnetOrder) => {
      if (!allowOrderCancel) {
        throw new Error("cancel_disabled");
      }
      if (!authToken) throw new Error("missing_auth_token");
      if (!order?.symbol) throw new Error("missing_order_symbol");
      const orderId = order?.orderId || "";
      const orderLinkId = order?.orderLinkId || "";
      if (!orderId && !orderLinkId) throw new Error("missing_order_id");
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
    },
    [allowOrderCancel, apiBase, authToken, refreshFast]
  );

  const updateSettings = useCallback((next: AISettings) => {
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
    cancelOrder,
    allowPositionClose,
    allowOrderCancel,
    dynamicSymbols: null,
    settings,
    updateSettings,
    updateGateOverrides,
  };
}

export type TradingBotApi = ReturnType<typeof useTradingBot>;
