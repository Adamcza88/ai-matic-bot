// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi";
import { EntryType, Profile, Symbol } from "../api/types";
import { getApiBase } from "../engine/networkConfig";
import { startPriceFeed } from "../engine/priceFeed";
import { evaluateStrategyForSymbol, resampleCandles, computeATR } from "../engine/botEngine";
import {
  evaluateAiMaticXStrategyForSymbol,
  type AiMaticXContext,
} from "../engine/aiMaticXStrategy";
import { evaluateHTFMultiTrend } from "../engine/htfTrendFilter";
import { computeEma, computeRsi, findPivotsHigh, findPivotsLow } from "../engine/ta";
import type { PriceFeedDecision } from "../engine/priceFeed";
import type { BotConfig, Candle } from "../engine/botEngine";
import { TradingMode } from "../types";
import {
  SUPPORTED_SYMBOLS,
  filterSupportedSymbols,
} from "../constants/symbols";
import type {
  AISettings,
  ActivePosition,
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
};
const CORE_V2_COOLDOWN_MS: Record<AISettings["riskMode"], number> = {
  "ai-matic": 30 * 60_000,
  "ai-matic-x": 60 * 60_000,
  "ai-matic-scalp": 20 * 60_000,
  "ai-matic-tree": 60 * 60_000,
};
const CORE_V2_VOLUME_PCTL: Record<AISettings["riskMode"], number> = {
  "ai-matic": 60,
  "ai-matic-x": 70,
  "ai-matic-scalp": 50,
  "ai-matic-tree": 65,
};
const CORE_V2_SCORE_GATE: Record<
  AISettings["riskMode"],
  { major: number; alt: number }
> = {
  "ai-matic": { major: 11, alt: 12 },
  "ai-matic-x": { major: 12, alt: 13 },
  "ai-matic-scalp": { major: 10, alt: 99 },
  "ai-matic-tree": { major: 11, alt: 13 },
};
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
  "Entry Logic: EMA Cross + RSI Divergence + Volume Spike.";
const SCALP_EXIT_GATE =
  "Exit Logic: Trailing Stop (ATR 2.5x) or Fixed TP (1.5 RRR).";
const MAX_OPEN_POSITIONS_CAP = 10000;
const ORDERS_PER_POSITION = 5;
const MAX_OPEN_ORDERS_CAP = MAX_OPEN_POSITIONS_CAP * ORDERS_PER_POSITION;
const TS_VERIFY_INTERVAL_MS = 180_000;
const TREND_GATE_STRONG_ADX = 25;
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
  htfClose: number;
  htfEma12: number;
  htfEma26: number;
  htfDiffPct: number;
  htfBias: "BULL" | "BEAR" | "NONE";
  htfAtr14: number;
  htfAtrPct: number;
  ema15m12: number;
  ema15m26: number;
  ema15mTrend: "BULL" | "BEAR" | "NONE";
  pullbackLong: boolean;
  pullbackShort: boolean;
  pivotHigh?: number;
  pivotLow?: number;
  microBreakLong: boolean;
  microBreakShort: boolean;
  rsiBullDiv: boolean;
  rsiBearDiv: boolean;
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
  const ltfClose = ltf.length ? ltf[ltf.length - 1].close : Number.NaN;
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

  const m15 = resampleCandles(candles, 15);
  const m15Closes = m15.map((c) => c.close);
  const ema15m12Arr = computeEma(m15Closes, 12);
  const ema15m26Arr = computeEma(m15Closes, 26);
  const ema15m12 = ema15m12Arr[ema15m12Arr.length - 1] ?? Number.NaN;
  const ema15m26 = ema15m26Arr[ema15m26Arr.length - 1] ?? Number.NaN;
  const ema15mTrend =
    Number.isFinite(ema15m12) && Number.isFinite(ema15m26)
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
  const rsiBullDiv =
    Boolean(prevLowPivot && lastLow) &&
    lastLow!.price < prevLowPivot!.price &&
    Number.isFinite(rsiArr[lastLow!.idx]) &&
    Number.isFinite(rsiArr[prevLowPivot!.idx]) &&
    rsiArr[lastLow!.idx] > rsiArr[prevLowPivot!.idx];
  const rsiBearDiv =
    Boolean(prevHighPivot && lastHigh) &&
    lastHigh!.price > prevHighPivot!.price &&
    Number.isFinite(rsiArr[lastHigh!.idx]) &&
    Number.isFinite(rsiArr[prevHighPivot!.idx]) &&
    rsiArr[lastHigh!.idx] < rsiArr[prevHighPivot!.idx];

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
    pullbackLong,
    pullbackShort,
    pivotHigh: prevHigh?.price,
    pivotLow: prevLow?.price,
    microBreakLong,
    microBreakShort,
    rsiBullDiv,
    rsiBearDiv,
  };
};

const computeScalpPrimaryChecklist = (
  core: CoreV2Metrics | undefined,
  volumeOk: boolean
) => {
  const ema15mTrend = core?.ema15mTrend ?? "NONE";
  const ltfOk = core?.ltfTimeframeMin === 1;
  const primaryOk = ema15mTrend !== "NONE" && ltfOk;
  const emaCrossOk =
    ema15mTrend === "BULL"
      ? Number.isFinite(core?.ema12) &&
        Number.isFinite(core?.ema26) &&
        core!.ema12 > core!.ema26
      : ema15mTrend === "BEAR"
        ? Number.isFinite(core?.ema12) &&
          Number.isFinite(core?.ema26) &&
          core!.ema12 < core!.ema26
        : false;
  const rsiOk =
    ema15mTrend === "BULL"
      ? Boolean(core?.rsiBullDiv)
      : ema15mTrend === "BEAR"
        ? Boolean(core?.rsiBearDiv)
        : false;
  const entryOk = Boolean(emaCrossOk && rsiOk && volumeOk);
  const exitOk = Number.isFinite(core?.atr14);
  return {
    primaryOk,
    entryOk,
    exitOk,
    ema15mTrend,
    ltfOk,
    emaCrossOk,
    rsiOk,
    volumeOk,
  };
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

const TRAIL_PROFILE_BY_RISK_MODE: Record<
  AISettings["riskMode"],
  { activateR: number; lockR: number; retracementRate?: number }
> = {
  "ai-matic": { activateR: 0.5, lockR: 0.3, retracementRate: 0.003 },
  "ai-matic-x": { activateR: 1.0, lockR: 0.3, retracementRate: 0.002 },
  "ai-matic-scalp": { activateR: 0.6, lockR: 0.3 },
  "ai-matic-tree": { activateR: 0.5, lockR: 0.3 },
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
};


export function useTradingBot(
  mode?: TradingMode,
  useTestnet = false,
  authToken?: string
) {
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
    const cheatSheetSetupId = settings.strategyCheatSheetEnabled
      ? CHEAT_SHEET_SETUP_BY_RISK_MODE[settings.riskMode]
      : undefined;
    const baseConfig: Partial<BotConfig> = {
      useStrategyCheatSheet: settings.strategyCheatSheetEnabled,
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
        partialSteps: [{ r: 1.0, exitFraction: 0.5 }],
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
      };
    }
    if (settings.riskMode === "ai-matic-x") {
      return {
        ...baseConfig,
        strategyProfile: "ai-matic-x",
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
    Map<string, { status: string; qty: number; price: number | null; side: string; symbol: string }>
  >(new Map());
  const positionSnapshotRef = useRef<Map<string, { size: number; side: string }>>(
    new Map()
  );
  const execSeenRef = useRef<Set<string>>(new Set());
  const pnlSeenRef = useRef<Set<string>>(new Set());
  const lastLossBySymbolRef = useRef<Map<string, number>>(new Map());
  const fastOkRef = useRef(false);
  const slowOkRef = useRef(false);
  const modeRef = useRef<TradingMode | undefined>(mode);
  const positionsRef = useRef<ActivePosition[]>([]);
  const ordersRef = useRef<TestnetOrder[]>([]);
  const cancelingOrdersRef = useRef<Set<string>>(new Set());
  const autoCloseCooldownRef = useRef<Map<string, number>>(new Map());
  const decisionRef = useRef<
    Record<string, { decision: PriceFeedDecision; ts: number }>
  >({});
  const signalSeenRef = useRef<Set<string>>(new Set());
  const intentPendingRef = useRef<Set<string>>(new Set());
  const trailingSyncRef = useRef<Map<string, number>>(new Map());
  const trailOffsetRef = useRef<Map<string, number>>(new Map());
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
      const symbolMode = TRAIL_SYMBOL_MODE[symbol];
      const forceTrail =
        settings.riskMode === "ai-matic" ||
        settings.riskMode === "ai-matic-x" ||
        settings.riskMode === "ai-matic-tree";
      if (symbolMode === "off") return null;
      if (!forceTrail && !settings.lockProfitsWithTrail && symbolMode !== "on") {
        return null;
      }
      const r = Math.abs(entry - sl);
      if (!Number.isFinite(r) || r <= 0) return null;
      const profile =
        TRAIL_PROFILE_BY_RISK_MODE[settings.riskMode] ??
        TRAIL_PROFILE_BY_RISK_MODE["ai-matic"];
      const activateR = profile.activateR;
      const lockR = profile.lockR;
      const overrideRate = trailOffsetRef.current.get(symbol);
      const effectiveRate =
        Number.isFinite(overrideRate) && overrideRate > 0
          ? overrideRate
          : profile.retracementRate;
      const distance = Number.isFinite(effectiveRate)
        ? entry * (effectiveRate as number)
        : Math.abs(activateR - lockR) * r;
      if (!Number.isFinite(distance) || distance <= 0) return null;
      const dir = side === "Buy" ? 1 : -1;
      const activePrice = entry + dir * activateR * r;
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

      for (const pos of positions) {
        const symbol = String(pos.symbol ?? "");
        if (!symbol) continue;
        const currentTrail = toNumber(pos.currentTrailingStop);
        if (Number.isFinite(currentTrail) && currentTrail > 0) {
          trailingSyncRef.current.delete(symbol);
          continue;
        }
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
        hardFailures.length > 0
          ? false
          : scoreTotal > 0
            ? score >= threshold
            : undefined;

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

  const enforceBtcBiasAlignment = useCallback(
    async (now: number) => {
      if (!authToken) return;
      const settings = settingsRef.current;
      if (settings.riskMode === "ai-matic-x") return;
      const btcBias = resolveBtcBias();
      if (!btcBias) return;
      const cooldown = autoCloseCooldownRef.current;
      const nextPositions = positionsRef.current;
      const nextOrders = ordersRef.current;

      const closeTargets = nextPositions.filter((pos) => {
        const size = toNumber(pos.size ?? pos.qty);
        if (!Number.isFinite(size) || size <= 0) return false;
        const bias = normalizeBias(pos.side);
        return bias != null && bias !== btcBias;
      });

      const cancelTargets = nextOrders.filter((order) => {
        if (!isEntryOrder(order)) return false;
        const bias = normalizeBias(order.side);
        return bias != null && bias !== btcBias;
      });

      if (!closeTargets.length && !cancelTargets.length) return;

      for (const pos of closeTargets) {
        const key = `pos:${pos.symbol}`;
        const last = cooldown.get(key) ?? 0;
        if (now - last < 15_000) continue;
        cooldown.set(key, now);
        const size = Math.abs(toNumber(pos.size ?? pos.qty));
        if (!Number.isFinite(size) || size <= 0) continue;
        const closeSide =
          String(pos.side).toLowerCase() === "buy" ? "Sell" : "Buy";
        try {
          await postJson("/order", {
            symbol: pos.symbol,
            side: closeSide,
            qty: size,
            orderType: "Market",
            reduceOnly: true,
            timeInForce: "IOC",
            positionIdx: Number.isFinite(pos.positionIdx)
              ? pos.positionIdx
              : undefined,
          });
          addLogEntries([
            {
              id: `btc-bias-close:${pos.symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "AUTO_CLOSE",
              message: `BTC bias ${btcBias} -> CLOSE ${pos.symbol} ${pos.side}`,
            },
          ]);
        } catch (err) {
          addLogEntries([
            {
              id: `btc-bias-close:error:${pos.symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
              message: `BTC bias close failed ${pos.symbol}: ${asErrorMessage(err)}`,
            },
          ]);
        }
      }

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
    [addLogEntries, authToken, isEntryOrder, normalizeBias, postJson, resolveBtcBias]
  );

  const resolveCorrelationGate = useCallback(
    (
      symbol: string,
      now = Date.now(),
      signal?: PriceFeedDecision["signal"] | null
    ) => {
      const details: string[] = [];
      let ok = true;
      const { biases: activeBiases } = getOpenBiasState();
      if (activeBiases.size > 1) {
        ok = false;
        details.push("mixed open bias");
      }
      const symbolUpper = String(symbol).toUpperCase();

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
    [getOpenBiasState, resolveBtcBias]
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
    if (hasPosition) return "MANAGE";
    const hasOrders = ordersRef.current.some(
      (o) => String(o.symbol ?? "") === symbol
    );
    if (hasOrders) return "MANAGE";
    const hasPendingIntent = intentPendingRef.current.has(symbol);
    if (hasPendingIntent) return "MANAGE";
    return "SCAN";
  }, []);

  const buildScanDiagnostics = useCallback(
    (symbol: string, decision: PriceFeedDecision, lastScanTs: number) => {
      const context = getSymbolContext(symbol, decision);
      const symbolState = resolveSymbolState(symbol);
      const lastTick = symbolTickRef.current.get(symbol) ?? 0;
      const feedAgeMs =
        lastTick > 0 ? Math.max(0, Date.now() - lastTick) : null;
      const feedAgeOk =
        feedAgeMs == null ? null : feedAgeMs <= FEED_AGE_OK_MS;
      const signalActive = Boolean(decision?.signal);
      const signal = decision?.signal ?? null;
      const quality = resolveQualityScore(symbol as Symbol, decision, signal, feedAgeMs);

      const gates: { name: string; ok: boolean; detail?: string }[] = [];
      const addGate = (name: string, ok: boolean, detail?: string) => {
        gates.push({ name, ok, detail });
      };

      const coreEval = evaluateCoreV2(
        symbol as Symbol,
        decision,
        signal,
        feedAgeMs
      );
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const volumeGate = coreEval.gates.find((g) => g.name === "Volume Pxx");
      const scalpPrimary = computeScalpPrimaryChecklist(
        core,
        volumeGate?.ok ?? false
      );
      const isScalpProfile = context.settings.riskMode === "ai-matic-scalp";
      const hasEntryOrder = ordersRef.current.some(
        (order) =>
          isEntryOrder(order) && String(order?.symbol ?? "") === symbol
      );
      const hasPendingIntent = intentPendingRef.current.has(symbol);
      const manageReason = context.hasPosition
        ? "open position"
        : hasEntryOrder
          ? "open order"
          : hasPendingIntent
            ? "pending intent"
            : null;

      coreEval.gates.forEach((gate) => addGate(gate.name, gate.ok, gate.detail));
      if (isScalpProfile) {
        addGate(
          SCALP_PRIMARY_GATE,
          scalpPrimary.primaryOk,
          `15m ${scalpPrimary.ema15mTrend} | LTF ${core?.ltfTimeframeMin ?? "—"}m`
        );
        addGate(
          SCALP_ENTRY_GATE,
          scalpPrimary.entryOk,
          `EMA ${scalpPrimary.emaCrossOk ? "OK" : "no"} | RSI ${
            scalpPrimary.rsiOk ? "OK" : "no"
          } | Vol ${scalpPrimary.volumeOk ? "OK" : "no"}`
        );
        addGate(
          SCALP_EXIT_GATE,
          scalpPrimary.exitOk,
          Number.isFinite(core?.atr14)
            ? `ATR ${formatNumber(core!.atr14, 4)} | TP 1.5R`
            : "ATR missing"
        );
      }

      const hardEnabled = context.settings.enableHardGates !== false;
      const softEnabled =
        !isScalpProfile && context.settings.enableSoftGates !== false;
      const hardReasons: string[] = [];
      if (hardEnabled) {
        if (!isScalpProfile) {
          coreEval.gates.forEach((gate) => {
            if (!gate.hard || gate.ok) return;
            if (!isGateEnabled(gate.name)) return;
            hardReasons.push(gate.name);
          });
        }
        if (isScalpProfile) {
          if (!scalpPrimary.primaryOk && isGateEnabled(SCALP_PRIMARY_GATE)) {
            hardReasons.push(SCALP_PRIMARY_GATE);
          }
          if (!scalpPrimary.entryOk && isGateEnabled(SCALP_ENTRY_GATE)) {
            hardReasons.push(SCALP_ENTRY_GATE);
          }
        }
      }

      const hardBlocked = hardEnabled && hardReasons.length > 0;
      const execEnabled = isGateEnabled("Exec allowed");
      const softBlocked = softEnabled && quality.pass === false;
      const executionAllowed = signalActive
        ? execEnabled
          ? hardReasons.length === 0 && !softBlocked
          : false
        : null;

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
        executionReason: signalActive
          ? execEnabled
            ? hardReasons.length > 0
              ? hardReasons.join(" · ")
              : softBlocked
                ? `Score ${quality.score ?? "—"} / ${quality.threshold ?? "—"}`
                : undefined
            : "Exec allowed (OFF)"
          : execEnabled
            ? "Waiting for signal"
            : "Exec allowed (OFF)",
        gates,
        qualityScore: quality.score,
        qualityThreshold: quality.threshold,
        qualityPass: quality.pass,
        lastScanTs,
        feedAgeMs,
        feedAgeOk,
      };
    },
    [
      evaluateCoreV2,
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
          const rrr =
            Number.isFinite(resolvedEntry) &&
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
            currentTrailingStop:
              Number.isFinite(trailingStop) && trailingStop > 0
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
      const next = mapped.filter((order) => {
        if (!isNewEntryOrder(order)) return true;
        const latest = latestNewIds.get(order.symbol);
        if (!latest) return true;
        return (
          (latest.orderId && order.orderId === latest.orderId) ||
          (latest.orderLinkId && order.orderLinkId === latest.orderLinkId)
        );
      });
      setOrders(next);
      ordersRef.current = next;
      setOrdersError(null);
      setLastSuccessAt(now);
      const cancelTargets =
        authToken
          ? mapped.filter((order) => {
              if (!isNewEntryOrder(order)) return false;
              const latest = latestNewIds.get(order.symbol);
              if (!latest) return false;
              const isLatest =
                (latest.orderId && order.orderId === latest.orderId) ||
                (latest.orderLinkId &&
                  order.orderLinkId === latest.orderLinkId);
              return !isLatest;
            })
          : [];
      if (cancelTargets.length) {
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
    fetchJson,
    refreshDiagnosticsFromDecisions,
    syncTrailingProtection,
    useTestnet,
  ]);

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
  }) {
    if (!authToken) throw new Error("missing_auth_token");
    const intent = {
      intentId: crypto.randomUUID(),
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

      const signal = decision?.signal ?? null;
      if (!signal) return;
      const signalActive = true;

      const signalId = String(signal.id ?? `${symbol}-${now}`);
      if (signalSeenRef.current.has(signalId)) return;
      signalSeenRef.current.add(signalId);

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

      addLogEntries([
        {
          id: `signal:${signalId}`,
          timestamp,
          action: "SIGNAL",
          message: msgParts.join(" | "),
        },
      ]);

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
      const xContext = (decision as any)?.xContext as AiMaticXContext | undefined;
      const hasSymbolPosition = context.hasPosition;
      const hasSymbolEntryOrder = ordersRef.current.some(
        (order) =>
          isEntryOrder(order) && String(order?.symbol ?? "") === symbol
      );
      const hasPendingIntent = intentPendingRef.current.has(symbol);
      const isMajorSymbol = MAJOR_SYMBOLS.has(symbol as Symbol);
      const coreMaxTotal = isMajorSymbol ? 2 : 1;
      const cooldownMs = CORE_V2_COOLDOWN_MS[context.settings.riskMode];
      const lastLossTs = lastLossBySymbolRef.current.get(symbol) ?? 0;
      const entryBlockReasons: string[] = [];
      if (hasSymbolPosition) entryBlockReasons.push("open position");
      if (hasSymbolEntryOrder) entryBlockReasons.push("open order");
      if (hasPendingIntent) entryBlockReasons.push("pending intent");
      if (context.openPositionsCount >= coreMaxTotal) {
        entryBlockReasons.push(isMajorSymbol ? "core max positions" : "core alt cap");
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

      const lastTick = symbolTickRef.current.get(symbol) ?? 0;
      const feedAgeMs = lastTick > 0 ? Math.max(0, now - lastTick) : null;
      const coreEval = evaluateCoreV2(
        symbol as Symbol,
        decision,
        signal,
        feedAgeMs
      );
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const volumeGate = coreEval.gates.find((g) => g.name === "Volume Pxx");
      const scalpPrimary = computeScalpPrimaryChecklist(
        core,
        volumeGate?.ok ?? false
      );
      const hardEnabled = context.settings.enableHardGates !== false;
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
      if (hardBlockReasons.length) {
        addLogEntries([
          {
            id: `signal:block:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "RISK_BLOCK",
            message: `${symbol} blocked by: ${hardBlockReasons.join(" · ")}`,
          },
        ]);
        return;
      }
      if (!isScalpProfile && softEnabled && coreEval.scorePass === false) {
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

      let resolvedSl = sl;
      let resolvedTp = tp;
      if (
        isScalpProfile &&
        (!Number.isFinite(resolvedSl) || resolvedSl <= 0) &&
        Number.isFinite(entry) &&
        entry > 0 &&
        Number.isFinite(core?.atr14) &&
        core!.atr14 > 0
      ) {
        const offset = core!.atr14 * 2.5;
        resolvedSl = side === "Buy" ? entry - offset : entry + offset;
      }
      if (
        isScalpProfile &&
        (!Number.isFinite(resolvedTp) || resolvedTp <= 0) &&
        Number.isFinite(resolvedSl) &&
        resolvedSl > 0 &&
        Number.isFinite(entry) &&
        entry > 0
      ) {
        const risk = Math.abs(entry - resolvedSl);
        if (Number.isFinite(risk) && risk > 0) {
          resolvedTp =
            side === "Buy"
              ? entry + 1.5 * risk
              : entry - 1.5 * risk;
        }
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
      const useFixedQty = fixedSizing?.ok === true;
      const qtyMode = useFixedQty ? "BASE_QTY" : "USDT_NOTIONAL";
      const qtyValue = useFixedQty ? sizing.qty : sizing.notional;

      let trailOffset = toNumber((decision as any)?.trailOffsetPct);
      if (
        isScalpProfile &&
        (!Number.isFinite(trailOffset) || trailOffset <= 0) &&
        Number.isFinite(core?.atr14) &&
        core!.atr14 > 0 &&
        Number.isFinite(entry) &&
        entry > 0
      ) {
        trailOffset = (core!.atr14 * 2.5) / entry;
      }
      if (Number.isFinite(trailOffset) && trailOffset > 0) {
        trailOffsetRef.current.set(symbol, trailOffset);
      } else {
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

      intentPendingRef.current.add(symbol);
      void (async () => {
        try {
          await autoTrade({
            symbol: symbol as Symbol,
            side,
            entryPrice: entry,
            entryType,
            triggerPrice,
            slPrice: resolvedSl,
            tpPrices: Number.isFinite(resolvedTp) ? [resolvedTp] : [],
            qtyMode,
            qtyValue,
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
      closedPnlRecords,
      computeFixedSizing,
      computeNotionalForSignal,
      evaluateCoreV2,
      getEquityValue,
      getSymbolContext,
      isGateEnabled,
      isEntryOrder,
    ]
  );

  useEffect(() => {
    handleDecisionRef.current = handleDecision;
  }, [handleDecision]);

  useEffect(() => {
    if (!authToken) return;

    signalSeenRef.current.clear();
    intentPendingRef.current.clear();
    decisionRef.current = {};
    setScanDiagnostics(null);

    const riskMode = settingsRef.current.riskMode;
    const isAiMaticX = riskMode === "ai-matic-x";
    const isAiMatic = riskMode === "ai-matic" || riskMode === "ai-matic-tree";
    const isScalp = riskMode === "ai-matic-scalp";
    const decisionFn = (
      symbol: string,
      candles: Parameters<typeof evaluateStrategyForSymbol>[1],
      config?: Partial<BotConfig>
    ) => {
      const baseDecision = isAiMaticX
        ? evaluateAiMaticXStrategyForSymbol(symbol, candles)
        : evaluateStrategyForSymbol(symbol, candles, config);
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
      const coreV2 = computeCoreV2Metrics(candles, riskMode);
      return { ...baseDecision, htfTrend, ltfTrend, emaTrend, scalpContext, coreV2 };
    };
    const maxCandles = isAiMaticX ? 5000 : isAiMatic ? 5000 : undefined;
    const backfill = isAiMaticX
      ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
      : isAiMatic
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
      const manage: string[] = [];
      for (const symbol of activeSymbols) {
        const state = resolveSymbolState(symbol);
        if (state === "MANAGE") manage.push(symbol);
        else scan.push(symbol);
      }

      const parts: string[] = [];
      if (scan.length) parts.push(`scan: ${scan.join(", ")}`);
      if (manage.length) parts.push(`manage: ${manage.join(", ")}`);
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
    [apiBase, authToken, refreshFast]
  );

  const cancelOrder = useCallback(
    async (order: TestnetOrder) => {
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
    [apiBase, authToken, refreshFast]
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
    dynamicSymbols: null,
    settings,
    updateSettings,
    updateGateOverrides,
  };
}

export type TradingBotApi = ReturnType<typeof useTradingBot>;
