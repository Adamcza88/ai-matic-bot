// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi";
import { EntryType, Profile, Symbol } from "../api/types";
import { getApiBase } from "../engine/networkConfig";
import { startPriceFeed } from "../engine/priceFeed";
import {
  computeTimeOfDayVolumeGate,
  computeCorrelatedExposureScale,
  computeRsiBollingerEnvelope,
  evaluateAltseasonRegime,
  evaluateStrategyForSymbol,
  resampleCandles,
  resolveRegimeAwareRsiBounds,
} from "../engine/botEngine";
import {
  evaluateAiMaticXStrategyForSymbol,
  type AiMaticXContext,
} from "../engine/aiMaticXStrategy";
import {
  evaluateAiMaticAmdStrategyForSymbol,
  type AmdContext,
} from "../engine/aiMaticAmdStrategy";
import {
  evaluateAiMaticOliKellaStrategyForSymbol,
  type AiMaticOliKellaContext,
} from "../engine/aiMaticOliKellaStrategy";
import { evaluateHTFMultiTrend } from "../engine/htfTrendFilter";
import { computeEma, computeRsi, findPivotsHigh, findPivotsLow, computeATR } from "../engine/ta";
import { CandlestickAnalyzer } from "../engine/universal-candlestick-analyzer";
import { computeMarketProfile, type MarketProfile } from "../engine/marketProfile";
import type { PriceFeedDecision } from "../engine/priceFeed";
import type {
  AltseasonRegimeSnapshot,
  BotConfig,
  Candle,
  PortfolioExposure,
} from "../engine/botEngine";
import { TradingMode } from "../types";
import { evaluateAiMaticProStrategyForSymbol } from "../engine/aiMaticProStrategy";
import { getOrderFlowSnapshot, updateOpenInterest } from "../engine/orderflow";
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
  OLIKELLA_GATE_ENTRY_CONDITIONS,
  OLIKELLA_GATE_EXIT_CONDITIONS,
  OLIKELLA_GATE_RISK_RULES,
  OLIKELLA_GATE_SIGNAL_CHECKLIST,
  OLIKELLA_PROFILE_LABEL,
  OLIKELLA_RISK_PER_TRADE,
  migrateRiskMode,
} from "../lib/oliKellaProfile";
import {
  resolveOrderPriceFields,
  resolveTrailingFields,
  stopValidityGate,
  treeTrendGate5m,
} from "./tradingGuards";
import {
  loadPnlHistory,
  mergePnlRecords,
  resetPnlHistoryMap,
} from "../lib/pnlHistory";
import type { AssetPnlMap } from "../lib/pnlHistory";
import { buildEntryGateProgress } from "../lib/entryGateProgressModel";

export type ActivePosition = BaseActivePosition & { isBreakeven?: boolean };

const SETTINGS_STORAGE_KEY = "ai-matic-settings";
const LOG_DEDUPE_WINDOW_MS = 1500;
const DATA_HEALTH_LAG_FACTOR = 2;
const FEED_TIMEFRAME_MS_BY_RISK_MODE: Record<AISettings["riskMode"], number> = {
  "ai-matic": 60_000,
  "ai-matic-x": 60_000,
  "ai-matic-amd": 60_000,
  "ai-matic-olikella": 15 * 60_000,
  "ai-matic-tree": 60_000,
  "ai-matic-pro": 60_000,
};
const PROTECTION_RETRY_INTERVAL_MS = 5_000;
const PROTECTION_RETRY_LOG_TTL_MS = 30_000;
const PROTECTION_ATTACH_GRACE_MS = 8_000;
const PROTECTION_SYNC_STALE_MS = 4_000;
const MIN_POSITION_NOTIONAL_USD = 5;
const MAX_POSITION_NOTIONAL_USD = 50000;
const DEFAULT_TESTNET_PER_TRADE_USD = 50;
const DEFAULT_MAINNET_PER_TRADE_USD = 20;
const MAJOR_SYMBOLS = new Set<Symbol>(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
const CORE_V2_RISK_PCT: Record<AISettings["riskMode"], number> = {
  "ai-matic": 0.12,
  "ai-matic-x": 0.003,
  "ai-matic-amd": 0.003,
  "ai-matic-olikella": OLIKELLA_RISK_PER_TRADE,
  "ai-matic-tree": 0.003,
  "ai-matic-pro": 0.003,
};
const CORE_V2_COOLDOWN_MS: Record<AISettings["riskMode"], number> = {
  "ai-matic": 0,
  "ai-matic-x": 0,
  "ai-matic-amd": 0,
  "ai-matic-olikella": 0,
  "ai-matic-tree": 0,
  "ai-matic-pro": 0,
};
const CORE_V2_VOLUME_PCTL: Record<AISettings["riskMode"], number> = {
  "ai-matic": 60,
  "ai-matic-x": 70,
  "ai-matic-amd": 65,
  "ai-matic-olikella": 50,
  "ai-matic-tree": 65,
  "ai-matic-pro": 65,
};
const CORE_V2_VOLUME_TOD_LOOKBACK_DAYS = 10;
const CORE_V2_VOLUME_TOD_MIN_SAMPLES = 6;
const CORE_V2_SCORE_GATE: Record<
  AISettings["riskMode"],
  { major: number; alt: number }
> = {
  "ai-matic": { major: 11, alt: 12 },
  "ai-matic-x": { major: 12, alt: 13 },
  "ai-matic-amd": { major: 12, alt: 12 },
  "ai-matic-olikella": { major: 10, alt: 99 },
  "ai-matic-tree": { major: 11, alt: 13 },
  "ai-matic-pro": { major: 10, alt: 10 },
};
const MIN_CHECKLIST_PASS = 8;
const REENTRY_COOLDOWN_MS = 15_000;
const SIGNAL_LOG_THROTTLE_MS = 10_000;
const SIGNAL_LOG_SIMILAR_THROTTLE_MS = 6_000;
const SIGNAL_LOG_PRICE_BUCKET_RATIO = 0.0002;
const SIGNAL_LOG_MIN_PRICE_BUCKET = 0.0005;
const SKIP_LOG_THROTTLE_MS = 10_000;
const POSITION_GATE_TTL_MS = 60_000;
const MAX_POS_GATE_TTL_MS = 30_000;
const MAX_ORDERS_GATE_TTL_MS = 30_000;
const CAPACITY_RECHECK_MS = 30_000;
const POSITION_RECONCILE_INTERVAL_MS = 5_000;
const INTENT_COOLDOWN_MS = 8_000;
const ENTRY_ORDER_LOCK_MS = 20_000;
const CORE_V2_EMA_SEP1_MIN = 0.18;
const CORE_V2_EMA_SEP2_MIN = 0.12;
const CORE_V2_ATR_MIN_PCT_MAJOR = 0.0012;
const CORE_V2_ATR_MIN_PCT_ALT = 0.0018;
const CORE_V2_HTF_BUFFER_PCT = 0.001;
const CORE_V2_NOTIONAL_CAP_PCT = 0.1;
const CORRELATION_RISK_THRESHOLD = 0.8;
const CORRELATION_RISK_MIN_SCALE = 0.2;
const MAINNET_FALLBACK_LEVERAGE = 50;
const ALTSEASON_SAMPLE_MS = 60_000;
const ALTSEASON_HISTORY_POINTS = 12;
const ALTSEASON_DOMINANCE_DROP_THRESHOLD = 0.05;
const ALTSEASON_ALT_ATR_EXPANSION_RATIO = 1.15;
const CORE_V2_BBO_AGE_BY_SYMBOL: Partial<Record<Symbol, number>> = {
  BTCUSDT: 800,
  ETHUSDT: 800,
  SOLUSDT: 700,
};
const CORE_V2_BBO_AGE_DEFAULT_MS = 1000;
const SCALP_PRIMARY_GATE = OLIKELLA_GATE_SIGNAL_CHECKLIST;
const SCALP_ENTRY_GATE = OLIKELLA_GATE_ENTRY_CONDITIONS;
const SCALP_EXIT_GATE = OLIKELLA_GATE_EXIT_CONDITIONS;
const SCALP_DRIFT_GATE = "OLIkella Trend Stability";
const SCALP_FAKE_MOMENTUM_GATE = "OLIkella False Momentum";
const SCALP_PROTECTED_ENTRY_GATE = OLIKELLA_GATE_RISK_RULES;
const SKIP_STATUS_SUPPRESSED_CODES = new Set([
  "MAX_POS",
  "MAX_ORDERS",
  "MAX_POS+MAX_ORDERS",
  "OPEN_POSITION",
]);
const MAX_OPEN_POSITIONS_CAP = 50000;
const ORDERS_PER_POSITION = 5;
const MAX_OPEN_ORDERS_CAP = MAX_OPEN_POSITIONS_CAP * ORDERS_PER_POSITION;
const TS_VERIFY_INTERVAL_MS = 180_000;
const AUTO_CANCEL_ENTRY_ORDERS = false;
const TREND_GATE_STRONG_ADX = 25;
const TREND_DAY_ADX_MIN = 20;
const TREND_GATE_STRONG_SCORE = 3;
const TREND_GATE_REVERSE_ADX = 19;
const TREND_GATE_REVERSE_SCORE = 1;
const HTF_TIMEFRAMES_MIN = [5];
const AI_MATIC_HTF_TIMEFRAMES_MIN = [5];
const AI_MATIC_LTF_TIMEFRAMES_MIN = [5];
const SCALP_LTF_TIMEFRAMES_MIN = [15];
const DEFAULT_AUTO_REFRESH_MINUTES = 3;
const EMA_TREND_PERIOD = 200;
const MIN_EMA_TREND_PERIOD = 10;
const MAX_EMA_TREND_PERIOD = 500;
const EMA_TREND_CONFIRM_BARS = 2;
const EMA_TREND_TOUCH_LOOKBACK = 8;
const EMA_TREND_TIMEFRAMES_MIN = [5];
const SCALP_EMA_PERIOD = 21;
const SCALP_SWING_LOOKBACK = 2;
const SCALP_EMA_FLAT_PCT = 0.02;
const SCALP_EMA_CROSS_LOOKBACK = 6;
const SCALP_DIV_LOOKBACK = 20;
const SCALP_PIVOT_MIN_GAP = 5;
const SCALP_PIVOT_MAX_GAP = 20;
const SCALP_FIB_LEVELS = [0.382, 0.5, 0.618] as const;
const SCALP_FIB_EXT = [0.618, 1.0, 1.618] as const;
const SCALP_FIB_TOL_ATR = 0.2;
const SCALP_FIB_TOL_PCT = 0.0005;
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
const AI_MATIC_HARD_MIN = 4;
const AI_MATIC_HARD_TOTAL = 4;
const AI_MATIC_ENTRY_FACTOR_MIN = 3;
const AI_MATIC_ENTRY_FACTOR_TOTAL = 4;
const AI_MATIC_CHECKLIST_MIN = 5;
const AI_MATIC_CHECKLIST_TOTAL = 8;
const AMD_ENTRY_RULE_NAMES = [
  "AMD: Phase sequence",
  "AMD: Killzone active",
  "AMD: Midnight open set",
  "AMD: Asia range valid",
  "AMD: Liquidity sweep",
  "AMD: Inversion FVG confirm",
  "AMD: Target model valid",
] as const;
const AI_MATIC_EMA_CROSS_LOOKBACK = 6;
const AI_MATIC_POI_DISTANCE_PCT = 0.0015;
const AI_MATIC_SL_ATR_BUFFER = 0.3;
const AI_MATIC_MIN_RR = 1.5;
const AI_MATIC_ENTRY_PULLBACK_MAX_PCT = 0.008;
const AI_MATIC_ENTRY_RVOL_MIN = 1.3;
const AI_MATIC_ENTRY_RVOL_MIN_ETH = 1.4;
const AI_MATIC_ENTRY_WICK_BODY_MIN = 0.5;
const AI_MATIC_CHECKLIST_ADX_MIN = 22;
const AI_MATIC_CHECKLIST_SPREAD_MAX_PCT = 0.0002;
const AI_MATIC_CHECKLIST_FUNDING_ABS_MAX = 0.0002;
const AI_MATIC_TP1_ATR_MULT = 1.5;
const AI_MATIC_TP1_PCT_MIN = 0.009;
const AI_MATIC_TP1_PCT_MAX = 0.012;
const AI_MATIC_TP2_PCT_MIN = 0.02;
const AI_MATIC_TP2_PCT_MAX = 0.03;
const AI_MATIC_TP1_PARTIAL_FRACTION = 0.7;
const AI_MATIC_SIGNAL_EXPIRE_BARS = 2;
const AI_MATIC_TRAIL_ACTIVATE_PCT = 0.01;
const AI_MATIC_TRAIL_RETRACE_PCT_MIN = 0.005;
const AI_MATIC_TRAIL_RETRACE_PCT_MAX = 0.008;
const AI_MATIC_TRAIL_RETRACE_PCT =
  (AI_MATIC_TRAIL_RETRACE_PCT_MIN + AI_MATIC_TRAIL_RETRACE_PCT_MAX) / 2;
const AI_MATIC_SL_HARD_CAP_PCT = 0.018;
const AI_MATIC_SL_HARD_CAP_ATR_MULT = 3.0;
const AI_MATIC_BE_MIN_R = 1.0;
const AI_MATIC_NO_PROGRESS_BARS = 6;
const AI_MATIC_NO_PROGRESS_MFE_ATR = 0.8;
const AI_MATIC_NO_PROGRESS_EXIT_COOLDOWN_MS = 30_000;
const AI_MATIC_TRAIL_ACTIVATE_ATR_MULT = 1.5;
const AI_MATIC_TRAIL_RETRACE_ATR_MULT = 0.5;
const AI_MATIC_RSI_OVERSOLD = 35;
const AI_MATIC_RSI_OVERBOUGHT = 70;
const AI_MATIC_LIQ_SWEEP_LOOKBACK = 15;
const AI_MATIC_LIQ_SWEEP_ATR_MULT = 0.5;
const AI_MATIC_LIQ_SWEEP_VOL_MULT = 1.0;
const AI_MATIC_BREAK_RETEST_LOOKBACK = 6;
const AI_MATIC_RETEST_PRIMARY_RATIO = 0.6;
const AI_MATIC_RETEST_SECONDARY_RATIO = 0.4;
const AI_MATIC_RETEST_FALLBACK_BARS = 2;
const AI_MATIC_RETEST_ABSORPTION_MIN = 2.5;
const AI_MATIC_RETEST_DELTA_DOMINANCE_RATIO = 1.4;
const AI_MATIC_RETEST_TWAP_SLICES = 2;
const AI_MATIC_RETEST_TWAP_DELAY_MS = 1500;
const AI_MATIC_SWING_K_5M = 3;
const AI_MATIC_SWING_K_15M = 2;
const AI_MATIC_SWING_RANGE_ATR_MIN_5M = 1.8;
const AI_MATIC_SWING_RANGE_ATR_MIN_15M = 1.5;
const AI_MATIC_SWING_ZONE_ATR = 0.25;
const AI_MATIC_SWING_LIMIT_OFFSET_ATR = 0.1;
const AI_MATIC_SWING_CONFIRM_OFFSET_ATR = 0.35;
const AI_MATIC_SWING_CONFIRM_LIMIT_OFFSET_ATR = 0.05;
const AI_MATIC_SWING_SL_OFFSET_ATR = 0.45;
const AI_MATIC_SWING_TP2_FRONTRUN_ATR = 0.2;
const AI_MATIC_SWING_CANCEL_RUNAWAY_ATR = 0.6;
const AI_MATIC_SWING_TP1_PARTIAL_FRACTION = 0.45;
const AI_MATIC_SWING_BE_MIN_R = 0.9;
const AI_MATIC_SWING_COOLDOWN_BARS_5M = 15;
const AI_MATIC_SWING_COOLDOWN_BARS_15M = 8;
const AI_MATIC_SWING_MIN_NOTIONAL = 150;
const AI_MATIC_EMA200_MODULE_BREAKOUT_LOOKBACK = 8;
const AI_MATIC_EMA200_MODULE_VOL_SMA_PERIOD = 20;
const AI_MATIC_EMA200_MODULE_SL_ATR_MULT = 1.5;
const AI_MATIC_EMA200_MODULE_AOI_TOUCH_ATR = 0.2;
const AI_MATIC_EMA200_MODULE_MICRO_VOL_SMA_PERIOD = 20;

type AiMaticAdaptiveRiskParams = {
  hardCapPct: number;
  hardCapAtrMult: number;
  beMinR: number;
  noProgressBars: number;
  noProgressMfeAtr: number;
};

const DEFAULT_SETTINGS: AISettings = {
  riskMode: "ai-matic",
  trendGateMode: "follow",
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
  perTradeTestnetUsd: DEFAULT_TESTNET_PER_TRADE_USD,
  perTradeMainnetUsd: DEFAULT_MAINNET_PER_TRADE_USD,
  emaTrendPeriod: EMA_TREND_PERIOD,
};

function loadStoredSettings(): AISettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const merged = { ...DEFAULT_SETTINGS, ...parsed } as AISettings;
    merged.riskMode = migrateRiskMode((parsed as any)?.riskMode);
    if (merged.trendGateMode !== "follow" && merged.trendGateMode !== "adaptive") {
      merged.trendGateMode = DEFAULT_SETTINGS.trendGateMode;
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
    merged.perTradeTestnetUsd = clampPerTradeUsd(
      merged.perTradeTestnetUsd,
      DEFAULT_SETTINGS.perTradeTestnetUsd
    );
    merged.perTradeMainnetUsd = clampPerTradeUsd(
      merged.perTradeMainnetUsd,
      DEFAULT_SETTINGS.perTradeMainnetUsd
    );
    merged.emaTrendPeriod = clampEmaTrendPeriod(
      merged.emaTrendPeriod,
      DEFAULT_SETTINGS.emaTrendPeriod ?? EMA_TREND_PERIOD
    );
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

function signalPriceBucket(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "na";
  const step = Math.max(value * SIGNAL_LOG_PRICE_BUCKET_RATIO, SIGNAL_LOG_MIN_PRICE_BUCKET);
  const bucket = Math.round(value / step) * step;
  const digits = bucket >= 1_000 ? 2 : bucket >= 100 ? 3 : bucket >= 1 ? 4 : 6;
  return bucket.toFixed(digits);
}

function clampPerTradeUsd(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(
    MAX_POSITION_NOTIONAL_USD,
    Math.max(MIN_POSITION_NOTIONAL_USD, n)
  );
}

function clampEmaTrendPeriod(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_EMA_TREND_PERIOD, Math.max(MIN_EMA_TREND_PERIOD, Math.round(n)));
}

type Ema200BreakoutState = {
  direction: "BULL" | "BEAR" | "NONE";
  ema: number;
  close: number;
  breakoutBull: boolean;
  breakoutBear: boolean;
  confirmedBull: boolean;
  confirmedBear: boolean;
};

function resolveEma200BreakoutState(
  candles: Candle[],
  opts?: { emaPeriod?: number; breakoutLookback?: number; confirmBars?: number }
): Ema200BreakoutState {
  const emaPeriod = Math.max(10, Math.round(opts?.emaPeriod ?? EMA_TREND_PERIOD));
  const breakoutLookback = Math.max(
    2,
    Math.round(opts?.breakoutLookback ?? EMA_TREND_TOUCH_LOOKBACK)
  );
  const confirmBars = Math.max(1, Math.round(opts?.confirmBars ?? EMA_TREND_CONFIRM_BARS));
  const closes = candles.map((c) => c.close);
  if (closes.length < Math.max(emaPeriod + 2, confirmBars + 2)) {
    return {
      direction: "NONE",
      ema: Number.NaN,
      close: Number.NaN,
      breakoutBull: false,
      breakoutBear: false,
      confirmedBull: false,
      confirmedBear: false,
    };
  }
  const emaArr = computeEma(closes, emaPeriod);
  const lastIdx = closes.length - 1;
  const close = closes[lastIdx];
  const ema = emaArr[lastIdx];
  const start = Math.max(1, closes.length - breakoutLookback);
  let bullBreakoutIdx = -1;
  let bearBreakoutIdx = -1;
  for (let i = start; i <= lastIdx; i++) {
    const prevClose = closes[i - 1];
    const prevEma = emaArr[i - 1];
    const currClose = closes[i];
    const currEma = emaArr[i];
    if (!Number.isFinite(prevClose) || !Number.isFinite(prevEma)) continue;
    if (!Number.isFinite(currClose) || !Number.isFinite(currEma)) continue;
    if (prevClose <= prevEma && currClose > currEma) bullBreakoutIdx = i;
    if (prevClose >= prevEma && currClose < currEma) bearBreakoutIdx = i;
  }
  const confirmedBull =
    bullBreakoutIdx >= 0 &&
    lastIdx - bullBreakoutIdx + 1 >= confirmBars &&
    (() => {
      for (let i = Math.max(bullBreakoutIdx, lastIdx - confirmBars + 1); i <= lastIdx; i++) {
        if (closes[i] <= emaArr[i]) return false;
      }
      return true;
    })();
  const confirmedBear =
    bearBreakoutIdx >= 0 &&
    lastIdx - bearBreakoutIdx + 1 >= confirmBars &&
    (() => {
      for (let i = Math.max(bearBreakoutIdx, lastIdx - confirmBars + 1); i <= lastIdx; i++) {
        if (closes[i] >= emaArr[i]) return false;
      }
      return true;
    })();
  let direction: Ema200BreakoutState["direction"] = "NONE";
  if (confirmedBull && !confirmedBear) direction = "BULL";
  else if (confirmedBear && !confirmedBull) direction = "BEAR";
  else if (confirmedBull && confirmedBear) {
    direction = bullBreakoutIdx >= bearBreakoutIdx ? "BULL" : "BEAR";
  }
  return {
    direction,
    ema,
    close,
    breakoutBull: bullBreakoutIdx >= 0,
    breakoutBear: bearBreakoutIdx >= 0,
    confirmedBull,
    confirmedBear,
  };
}

type EmaTrendFrame = {
  timeframeMin: number;
  direction: "bull" | "bear" | "none";
  ema: number;
  close: number;
  touched: boolean;
  confirmed: boolean;
  breakout: boolean;
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
  const touchLookback = Math.max(2, opts?.touchLookback ?? EMA_TREND_TOUCH_LOOKBACK);
  const confirmBars = Math.max(1, opts?.confirmBars ?? EMA_TREND_CONFIRM_BARS);
  const byTimeframe: EmaTrendFrame[] = timeframes.map((tf) => {
    const sampled = resampleCandles(candles, tf);
    if (!sampled.length) {
      return {
        timeframeMin: tf,
        direction: "none",
        ema: Number.NaN,
        close: Number.NaN,
        touched: false,
        confirmed: false,
        breakout: false,
      };
    }
    const breakout = resolveEma200BreakoutState(sampled, {
      emaPeriod,
      breakoutLookback: touchLookback,
      confirmBars,
    });
    const direction =
      breakout.direction === "BULL"
        ? "bull"
        : breakout.direction === "BEAR"
          ? "bear"
          : "none";
    const touched = breakout.breakoutBull || breakout.breakoutBear;
    const confirmed = breakout.confirmedBull || breakout.confirmedBear;
    return {
      timeframeMin: tf,
      direction,
      ema: breakout.ema,
      close: breakout.close,
      touched,
      confirmed,
      breakout: touched,
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
  breakoutRecent: boolean;
  confirmed: boolean;
  ema200: number;
  close: number;
};

type LiquiditySweepState = {
  sweepHigh: boolean;
  sweepLow: boolean;
  sweepHighWick: number;
  sweepLowWick: number;
  swingHigh: number;
  swingLow: number;
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

type AiMaticSwingSideSetup = {
  enabled: boolean;
  entryType: "LIMIT_MAKER_FIRST" | "CONDITIONAL";
  entry: number;
  trigger?: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp1Fraction: number;
};

type AiMaticSwingTfPlan = {
  timeframeMin: 5 | 15;
  k: number;
  atr: number;
  rangeEligible: boolean;
  rangeReason: string;
  swingHigh: number;
  swingLow: number;
  rangeWidth: number;
  buy?: AiMaticSwingSideSetup;
  sell?: AiMaticSwingSideSetup;
};

type AiMaticSwingModule = {
  active: boolean;
  activeTfMin?: 5 | 15;
  reason: string;
  plans: AiMaticSwingTfPlan[];
  buy?: AiMaticSwingSideSetup;
  sell?: AiMaticSwingSideSetup;
};

type AiMaticEma200ScalpSideSetup = {
  enabled: boolean;
  mode: "BREAKOUT_PULLBACK_LIMIT" | "AOI_REVERSAL_MARKET";
  entryType: "LIMIT_MAKER_FIRST" | "MARKET";
  entry: number;
  sl: number;
  tp: number;
  sourceTfMin: 1 | 3 | 5;
};

type AiMaticEma200ScalpModule = {
  active: boolean;
  reason: string;
  baseTfMin: 5;
  htfTfMin: 60;
  microTfMin: 1 | 3;
  ema200: number;
  atr14: number;
  nearestSupport: number;
  nearestResistance: number;
  buy?: AiMaticEma200ScalpSideSetup;
  sell?: AiMaticEma200ScalpSideSetup;
};

type AiMaticContext = {
  htf: {
    direction: "bull" | "bear" | "none";
    adx: number;
    phase: "ACCUMULATION" | "DISTRIBUTION" | "MANIPULATION" | "TREND";
    ema: AiMaticEmaFlags;
    structureTrend: "BULL" | "BEAR" | "RANGE";
    lastHighType: "HH" | "LH" | "NONE";
    lastLowType: "HL" | "LL" | "NONE";
    bosUp: boolean;
    bosDown: boolean;
    chochUp: boolean;
    chochDown: boolean;
    sweepHigh: boolean;
    sweepLow: boolean;
    sweepHighWick: number;
    sweepLowWick: number;
    swingHigh: number;
    swingLow: number;
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
    ema: AiMaticEmaFlags;
    patterns: AiMaticPatterns;
    gapPresent: boolean;
    obRetest: boolean;
    structureTrend: "BULL" | "BEAR" | "RANGE";
    lastHighType: "HH" | "LH" | "NONE";
    lastLowType: "HL" | "LL" | "NONE";
    bosUp: boolean;
    bosDown: boolean;
    chochUp: boolean;
    chochDown: boolean;
    pivotHigh?: number;
    pivotLow?: number;
    sweepHighWick: number;
    sweepLowWick: number;
    swingHigh: number;
    swingLow: number;
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
    rsi: number;
    rsiOversold: number;
    rsiOverbought: number;
    rsiMode: "BASE" | "BULL_TREND" | "BULL_TREND_RANGE_LOCK";
    rsiBbLower: number;
    rsiBbUpper: number;
    rsiBbOversold: boolean;
    rsiBbOverbought: boolean;
    rsiExtremeLong: boolean;
    rsiExtremeShort: boolean;
    macdHist: number;
    macdSignal: number;
    macdCrossUp: boolean;
    macdCrossDown: boolean;
    momentumLongOk: boolean;
    momentumShortOk: boolean;
    sweepHigh: boolean;
    sweepLow: boolean;
    sweepHighWick: number;
    sweepLowWick: number;
    swingHigh: number;
    swingLow: number;
    ema: AiMaticEmaFlags;
    volumeReaction: boolean;
    structureTrend: "BULL" | "BEAR" | "RANGE";
    lastHighType: "HH" | "LH" | "NONE";
    lastLowType: "HL" | "LL" | "NONE";
  };
  swing?: AiMaticSwingModule;
  ema200Scalp?: AiMaticEma200ScalpModule;
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

const resolveAiMaticEmaFlags = (
  candles: Candle[],
  emaPeriod = EMA_TREND_PERIOD
): AiMaticEmaFlags => {
  const breakout = resolveEma200BreakoutState(candles, {
    emaPeriod,
    breakoutLookback: EMA_TREND_TOUCH_LOOKBACK,
    confirmBars: EMA_TREND_CONFIRM_BARS,
  });
  return {
    bullOk: breakout.direction === "BULL",
    bearOk: breakout.direction === "BEAR",
    breakoutRecent: breakout.breakoutBull || breakout.breakoutBear,
    confirmed: breakout.confirmedBull || breakout.confirmedBear,
    ema200: breakout.ema,
    close: breakout.close,
  };
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

const resolveGapPresent = (pois: AiMaticPoi[]) => {
  return pois.some((poi) => {
    const type = String(poi.type ?? "").toLowerCase();
    return type.includes("fvg") || type.includes("gap");
  });
};

const resolvePoiTouch = (pois: AiMaticPoi[], price: number) => {
  if (!Number.isFinite(price) || !pois.length) return false;
  return pois.some(
    (poi) =>
      Number.isFinite(poi.low) &&
      Number.isFinite(poi.high) &&
      price >= poi.low &&
      price <= poi.high
  );
};

const resolveMacdState = (closes: number[]) => {
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

const resolveLiquiditySweep = (candles: Candle[]): LiquiditySweepState => {
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

const resolveFractalPivots = (candles: Candle[], k: number) => {
  const highs: { idx: number; price: number }[] = [];
  const lows: { idx: number; price: number }[] = [];
  if (!candles.length || k < 1 || candles.length < k * 2 + 1) {
    return { highs, lows };
  }
  for (let i = k; i < candles.length - k; i++) {
    const center = candles[i];
    if (!center) continue;
    let isHigh = true;
    let isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      const other = candles[j];
      if (!other) continue;
      if (!(center.high > other.high)) isHigh = false;
      if (!(center.low < other.low)) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ idx: i, price: center.high });
    if (isLow) lows.push({ idx: i, price: center.low });
  }
  return { highs, lows };
};

const resolveSwingAtr = (candles: Candle[]) => {
  if (!candles.length) return Number.NaN;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const closes = candles.map((c) => c.close);
  const atrArr = computeATR(highs, lows, closes, 14);
  return atrArr[atrArr.length - 1] ?? Number.NaN;
};

const buildAiMaticSwingSideSetup = (args: {
  side: "Buy" | "Sell";
  candles: Candle[];
  atr: number;
  swingHigh: number;
  swingLow: number;
}): AiMaticSwingSideSetup | undefined => {
  const { side, candles, atr, swingHigh, swingLow } = args;
  if (!Number.isFinite(atr) || atr <= 0 || !candles.length) return undefined;
  const last = candles[candles.length - 1];
  if (!last) return undefined;
  const zoneHalf = AI_MATIC_SWING_ZONE_ATR * atr;
  const limitOffset = AI_MATIC_SWING_LIMIT_OFFSET_ATR * atr;
  const confirmOffset = AI_MATIC_SWING_CONFIRM_OFFSET_ATR * atr;
  const confirmLimitOffset = AI_MATIC_SWING_CONFIRM_LIMIT_OFFSET_ATR * atr;
  const slOffset = AI_MATIC_SWING_SL_OFFSET_ATR * atr;
  const tpFrontRun = AI_MATIC_SWING_TP2_FRONTRUN_ATR * atr;
  const runawayOffset = AI_MATIC_SWING_CANCEL_RUNAWAY_ATR * atr;
  const recent = candles.slice(-3);
  const midRange = (swingHigh + swingLow) / 2;

  if (side === "Buy") {
    if (!Number.isFinite(swingLow) || !Number.isFinite(swingHigh)) return undefined;
    const zoneLow = swingLow - zoneHalf;
    const zoneHigh = swingLow + zoneHalf;
    const touched = recent.some(
      (c) =>
        Number.isFinite(c.low) &&
        Number.isFinite(c.high) &&
        c.low <= zoneHigh &&
        c.high >= zoneLow
    );
    const trigger = swingLow + confirmOffset;
    const confirmed = touched && Number.isFinite(last.close) && last.close >= trigger;
    const runaway =
      Number.isFinite(last.close) && last.close > swingLow + runawayOffset;
    const entryType = confirmed ? "CONDITIONAL" : "LIMIT_MAKER_FIRST";
    const entry = confirmed ? trigger + confirmLimitOffset : swingLow + limitOffset;
    if (runaway && !confirmed) return undefined;
    const sl = swingLow - slOffset;
    const tp1 = midRange;
    const tp2 = swingHigh - tpFrontRun;
    if (
      !Number.isFinite(entry) ||
      !Number.isFinite(sl) ||
      !Number.isFinite(tp1) ||
      !Number.isFinite(tp2) ||
      sl >= entry ||
      tp1 <= entry ||
      tp2 <= tp1
    ) {
      return undefined;
    }
    return {
      enabled: true,
      entryType,
      entry,
      trigger: confirmed ? trigger : undefined,
      sl,
      tp1,
      tp2,
      tp1Fraction: AI_MATIC_SWING_TP1_PARTIAL_FRACTION,
    };
  }

  const zoneLow = swingHigh - zoneHalf;
  const zoneHigh = swingHigh + zoneHalf;
  const touched = recent.some(
    (c) =>
      Number.isFinite(c.low) &&
      Number.isFinite(c.high) &&
      c.low <= zoneHigh &&
      c.high >= zoneLow
  );
  const trigger = swingHigh - confirmOffset;
  const confirmed = touched && Number.isFinite(last.close) && last.close <= trigger;
  const runaway =
    Number.isFinite(last.close) && last.close < swingHigh - runawayOffset;
  const entryType = confirmed ? "CONDITIONAL" : "LIMIT_MAKER_FIRST";
  const entry = confirmed ? trigger - confirmLimitOffset : swingHigh - limitOffset;
  if (runaway && !confirmed) return undefined;
  const sl = swingHigh + slOffset;
  const tp1 = midRange;
  const tp2 = swingLow + tpFrontRun;
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(sl) ||
    !Number.isFinite(tp1) ||
    !Number.isFinite(tp2) ||
    sl <= entry ||
    tp1 >= entry ||
    tp2 >= tp1
  ) {
    return undefined;
  }
  return {
    enabled: true,
    entryType,
    entry,
    trigger: confirmed ? trigger : undefined,
    sl,
    tp1,
    tp2,
    tp1Fraction: AI_MATIC_SWING_TP1_PARTIAL_FRACTION,
  };
};

const buildAiMaticSwingTfPlan = (args: {
  candles: Candle[];
  timeframeMin: 5 | 15;
}): AiMaticSwingTfPlan => {
  const { candles, timeframeMin } = args;
  const k = timeframeMin === 5 ? AI_MATIC_SWING_K_5M : AI_MATIC_SWING_K_15M;
  const atrMinMult =
    timeframeMin === 5
      ? AI_MATIC_SWING_RANGE_ATR_MIN_5M
      : AI_MATIC_SWING_RANGE_ATR_MIN_15M;
  const atr = resolveSwingAtr(candles);
  const pivots = resolveFractalPivots(candles, k);
  const lastHigh = pivots.highs[pivots.highs.length - 1]?.price;
  const lastLow = pivots.lows[pivots.lows.length - 1]?.price;
  const prevHigh = pivots.highs[pivots.highs.length - 2]?.price;
  const prevLow = pivots.lows[pivots.lows.length - 2]?.price;
  const base: AiMaticSwingTfPlan = {
    timeframeMin,
    k,
    atr,
    rangeEligible: false,
    rangeReason: "insufficient_swings",
    swingHigh: Number.isFinite(lastHigh) ? (lastHigh as number) : Number.NaN,
    swingLow: Number.isFinite(lastLow) ? (lastLow as number) : Number.NaN,
    rangeWidth:
      Number.isFinite(lastHigh) && Number.isFinite(lastLow)
        ? (lastHigh as number) - (lastLow as number)
        : Number.NaN,
  };
  if (
    !Number.isFinite(lastHigh) ||
    !Number.isFinite(lastLow) ||
    !Number.isFinite(prevHigh) ||
    !Number.isFinite(prevLow) ||
    !Number.isFinite(atr) ||
    atr <= 0
  ) {
    return base;
  }
  const hhhl =
    (lastHigh as number) > (prevHigh as number) &&
    (lastLow as number) > (prevLow as number);
  const lllh =
    (lastHigh as number) < (prevHigh as number) &&
    (lastLow as number) < (prevLow as number);
  const structureRange = !hhhl && !lllh;
  const width = (lastHigh as number) - (lastLow as number);
  const widthOk = width >= atrMinMult * (atr as number);
  const rangeEligible = structureRange && widthOk;
  const buy = rangeEligible
    ? buildAiMaticSwingSideSetup({
        side: "Buy",
        candles,
        atr,
        swingHigh: lastHigh as number,
        swingLow: lastLow as number,
      })
    : undefined;
  const sell = rangeEligible
    ? buildAiMaticSwingSideSetup({
        side: "Sell",
        candles,
        atr,
        swingHigh: lastHigh as number,
        swingLow: lastLow as number,
      })
    : undefined;
  return {
    ...base,
    rangeEligible,
    rangeReason: !structureRange
      ? "trend_sequence"
      : !widthOk
        ? "range_too_tight"
        : "ok",
    buy,
    sell,
  };
};

const resolveAiMaticSwingModule = (candles: Candle[]): AiMaticSwingModule => {
  const m15 = resampleCandles(candles, 15);
  const m5 = resampleCandles(candles, 5);
  const plan15 = buildAiMaticSwingTfPlan({ candles: m15, timeframeMin: 15 });
  const plan5 = buildAiMaticSwingTfPlan({ candles: m5, timeframeMin: 5 });
  const plans = [plan15, plan5];
  const pickSide = (side: "buy" | "sell") => {
    for (const plan of plans) {
      if (!plan.rangeEligible) continue;
      const setup = side === "buy" ? plan.buy : plan.sell;
      if (setup?.enabled) {
        return { setup, tf: plan.timeframeMin };
      }
    }
    return null;
  };
  const buyPick = pickSide("buy");
  const sellPick = pickSide("sell");
  const activeTfCandidate = buyPick?.tf ?? sellPick?.tf;
  const activeTfMin =
    activeTfCandidate === 5 || activeTfCandidate === 15
      ? activeTfCandidate
      : undefined;
  const active = activeTfMin != null;
  const reason = active
    ? `tf_${activeTfMin}`
    : `${plan15.rangeReason}|${plan5.rangeReason}`;
  return {
    active,
    activeTfMin: active ? activeTfMin : undefined,
    reason,
    plans,
    buy: buyPick?.setup,
    sell: sellPick?.setup,
  };
};

const resolveSmaValue = (values: number[], period: number, index: number) => {
  if (!values.length) return Number.NaN;
  const window = Math.max(1, Math.round(period));
  if (index < window - 1) return Number.NaN;
  const start = index - window + 1;
  const slice = values.slice(start, index + 1);
  if (!slice.length) return Number.NaN;
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / slice.length;
};

const resolveNearestH1AoiLevels = (h1: Candle[], reference: number) => {
  const highs = findPivotsHigh(h1, 2, 2).map((p) => p.price);
  const lows = findPivotsLow(h1, 2, 2).map((p) => p.price);
  const sourceHighs = highs.length ? highs : h1.slice(-72).map((c) => c.high);
  const sourceLows = lows.length ? lows : h1.slice(-72).map((c) => c.low);
  const supportCandidates = sourceLows.filter(
    (value) => Number.isFinite(value) && value < reference
  );
  const resistanceCandidates = sourceHighs.filter(
    (value) => Number.isFinite(value) && value > reference
  );
  const nearestSupport = supportCandidates.length
    ? Math.max(...supportCandidates)
    : Number.NaN;
  const nearestResistance = resistanceCandidates.length
    ? Math.min(...resistanceCandidates)
    : Number.NaN;
  return { nearestSupport, nearestResistance };
};

const resolveAiMaticEma200ScalpModule = (
  candles: Candle[],
  opts?: { resample?: ResampleFn }
): AiMaticEma200ScalpModule => {
  const resample = opts?.resample ?? ((tf: number) => resampleCandles(candles, tf));
  const m5 = resample(5);
  const h1 = resample(60);
  const micro1 = resample(1);
  const micro3 = resample(3);
  const microTfMin: 1 | 3 = micro1.length >= 120 ? 1 : 3;
  const micro = microTfMin === 1 ? micro1 : micro3;
  const inactive: AiMaticEma200ScalpModule = {
    active: false,
    reason: "insufficient_data",
    baseTfMin: 5,
    htfTfMin: 60,
    microTfMin,
    ema200: Number.NaN,
    atr14: Number.NaN,
    nearestSupport: Number.NaN,
    nearestResistance: Number.NaN,
  };
  if (m5.length < 220 || h1.length < 20) {
    return inactive;
  }

  const closes5 = m5.map((c) => c.close);
  const highs5 = m5.map((c) => c.high);
  const lows5 = m5.map((c) => c.low);
  const volumes5 = m5.map((c) => c.volume ?? 0);
  const ema200Arr = computeEma(closes5, 200);
  const atrArr = computeATR(highs5, lows5, closes5, 14);
  const ema200 = ema200Arr[ema200Arr.length - 1] ?? Number.NaN;
  const atr14 = atrArr[atrArr.length - 1] ?? Number.NaN;
  if (!Number.isFinite(ema200) || !Number.isFinite(atr14) || atr14 <= 0) {
    return inactive;
  }

  const { nearestSupport, nearestResistance } = resolveNearestH1AoiLevels(h1, ema200);
  const last5 = m5[m5.length - 1];
  if (!last5) {
    return inactive;
  }
  const macd5 = resolveMacdState(closes5);
  const startIdx = Math.max(
    1,
    m5.length - AI_MATIC_EMA200_MODULE_BREAKOUT_LOOKBACK
  );
  let breakoutLong = false;
  let breakoutShort = false;
  for (let i = startIdx; i < m5.length; i++) {
    const prev = m5[i - 1];
    const curr = m5[i];
    const emaPrev = ema200Arr[i - 1];
    const emaNow = ema200Arr[i];
    if (!prev || !curr || !Number.isFinite(emaPrev) || !Number.isFinite(emaNow)) {
      continue;
    }
    const volSma = resolveSmaValue(
      volumes5,
      AI_MATIC_EMA200_MODULE_VOL_SMA_PERIOD,
      i
    );
    const volOk =
      Number.isFinite(volSma) &&
      Number(curr.volume) > (volSma as number);
    if (!volOk) continue;
    if (prev.close <= emaPrev && curr.close > emaNow) {
      breakoutLong = true;
    }
    if (prev.close >= emaPrev && curr.close < emaNow) {
      breakoutShort = true;
    }
  }

  const buyBreakoutSetup: AiMaticEma200ScalpSideSetup | undefined =
    breakoutLong &&
    Number.isFinite(nearestResistance) &&
    nearestResistance > ema200 &&
    last5.close >= ema200 &&
    macd5.macdHist > 0
      ? {
          enabled: true,
          mode: "BREAKOUT_PULLBACK_LIMIT",
          entryType: "LIMIT_MAKER_FIRST",
          entry: ema200,
          sl: ema200 - AI_MATIC_EMA200_MODULE_SL_ATR_MULT * atr14,
          tp: nearestResistance,
          sourceTfMin: 5,
        }
      : undefined;
  const sellBreakoutSetup: AiMaticEma200ScalpSideSetup | undefined =
    breakoutShort &&
    Number.isFinite(nearestSupport) &&
    nearestSupport < ema200 &&
    last5.close <= ema200 &&
    macd5.macdHist < 0
      ? {
          enabled: true,
          mode: "BREAKOUT_PULLBACK_LIMIT",
          entryType: "LIMIT_MAKER_FIRST",
          entry: ema200,
          sl: ema200 + AI_MATIC_EMA200_MODULE_SL_ATR_MULT * atr14,
          tp: nearestSupport,
          sourceTfMin: 5,
        }
      : undefined;

  let buy = buyBreakoutSetup;
  let sell = sellBreakoutSetup;
  if (micro.length >= 40) {
    const microCloses = micro.map((c) => c.close);
    const microVolumes = micro.map((c) => c.volume ?? 0);
    const microMacd = resolveMacdState(microCloses);
    const microLast = micro[micro.length - 1];
    if (microLast) {
      const microVolSma = resolveSmaValue(
        microVolumes,
        AI_MATIC_EMA200_MODULE_MICRO_VOL_SMA_PERIOD,
        microVolumes.length - 1
      );
      const microVolumeUp =
        Number.isFinite(microVolSma) &&
        microLast.volume > (microVolSma as number);
      const supportTouched =
        Number.isFinite(nearestSupport) &&
        ((last5.low <= nearestSupport && last5.high >= nearestSupport) ||
          Math.abs(last5.close - nearestSupport) <=
            AI_MATIC_EMA200_MODULE_AOI_TOUCH_ATR * atr14);
      const resistanceTouched =
        Number.isFinite(nearestResistance) &&
        ((last5.low <= nearestResistance && last5.high >= nearestResistance) ||
          Math.abs(last5.close - nearestResistance) <=
            AI_MATIC_EMA200_MODULE_AOI_TOUCH_ATR * atr14);
      const bullishMicroClose = microLast.close > microLast.open;
      const bearishMicroClose = microLast.close < microLast.open;
      const reversalLong =
        supportTouched &&
        microMacd.macdCrossUp &&
        bullishMicroClose &&
        microVolumeUp &&
        ema200 > microLast.close;
      const reversalShort =
        resistanceTouched &&
        microMacd.macdCrossDown &&
        bearishMicroClose &&
        microVolumeUp &&
        ema200 < microLast.close;
      if (reversalLong) {
        buy = {
          enabled: true,
          mode: "AOI_REVERSAL_MARKET",
          entryType: "MARKET",
          entry: microLast.close,
          sl:
            (nearestSupport as number) -
            AI_MATIC_EMA200_MODULE_SL_ATR_MULT * atr14,
          tp: ema200,
          sourceTfMin: microTfMin,
        };
      }
      if (reversalShort) {
        sell = {
          enabled: true,
          mode: "AOI_REVERSAL_MARKET",
          entryType: "MARKET",
          entry: microLast.close,
          sl:
            (nearestResistance as number) +
            AI_MATIC_EMA200_MODULE_SL_ATR_MULT * atr14,
          tp: ema200,
          sourceTfMin: microTfMin,
        };
      }
    }
  }

  const buyEnabled =
    Boolean(buy?.enabled) &&
    Number.isFinite(buy?.entry) &&
    Number.isFinite(buy?.sl) &&
    Number.isFinite(buy?.tp) &&
    (buy?.sl as number) < (buy?.entry as number) &&
    (buy?.tp as number) > (buy?.entry as number);
  const sellEnabled =
    Boolean(sell?.enabled) &&
    Number.isFinite(sell?.entry) &&
    Number.isFinite(sell?.sl) &&
    Number.isFinite(sell?.tp) &&
    (sell?.sl as number) > (sell?.entry as number) &&
    (sell?.tp as number) < (sell?.entry as number);
  const active = buyEnabled || sellEnabled;
  const reason =
    buy?.mode === "AOI_REVERSAL_MARKET" || sell?.mode === "AOI_REVERSAL_MARKET"
      ? "aoi_reversal"
      : active
        ? "ema200_pullback"
        : "no_valid_signal";

  return {
    active,
    reason,
    baseTfMin: 5,
    htfTfMin: 60,
    microTfMin,
    ema200,
    atr14,
    nearestSupport,
    nearestResistance,
    buy: buyEnabled ? buy : undefined,
    sell: sellEnabled ? sell : undefined,
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
  core?: CoreV2Metrics,
  opts?: { resample?: ResampleFn; emaTrendPeriod?: number }
): AiMaticContext | null => {
  const resample = opts?.resample ?? ((tf) => resampleCandles(candles, tf));
  const emaTrendPeriod = clampEmaTrendPeriod(
    opts?.emaTrendPeriod,
    EMA_TREND_PERIOD
  );
  const htf = resample(60);
  const mtf = resample(15);
  const ltf = resample(5);
  if (!htf.length || !mtf.length || !ltf.length) return null;
  const htfPois = new CandlestickAnalyzer(toAnalyzerCandles(htf)).getPointsOfInterest() as AiMaticPoi[];
  const mtfPois = new CandlestickAnalyzer(toAnalyzerCandles(mtf)).getPointsOfInterest() as AiMaticPoi[];
  const profile = computeMarketProfile({ candles: mtf });
  const ltfLast = ltf[ltf.length - 1];
  const htfStructure = resolveStructureState(htf);
  const mtfStructure = resolveStructureState(mtf);
  const ltfStructure = resolveStructureState(ltf);
  const htfEma = resolveAiMaticEmaFlags(htf, emaTrendPeriod);
  const mtfEma = resolveAiMaticEmaFlags(mtf, emaTrendPeriod);
  const emaFlags = resolveAiMaticEmaFlags(ltf, emaTrendPeriod);
  const patterns = resolveAiMaticPatterns(ltf);
  const mtfPatterns = resolveAiMaticPatterns(mtf);
  const htfSweep = resolveLiquiditySweep(htf);
  const mtfSweep = resolveLiquiditySweep(mtf);
  const ltfSweep = resolveLiquiditySweep(ltf);
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
  const ltfVolumeThreshold = Number.isFinite(core?.volumeTodThreshold)
    ? core!.volumeTodThreshold
    : core?.volumeP60;
  const ltfVolumeReaction =
    Boolean(core?.volumeSpike) ||
    (Number.isFinite(core?.volumeCurrent) &&
      Number.isFinite(ltfVolumeThreshold) &&
      core!.volumeCurrent >= ltfVolumeThreshold);
  const htfAdx = toNumber((decision as any)?.trendAdx);
  const htfVolumeRising = resolveVolumeRising(htf);
  const price = Number.isFinite(ltfLast?.close) ? ltfLast.close : Number.NaN;
  const ltfCloses = ltf.map((c) => c.close);
  const ltfRsiArr = computeRsi(ltfCloses, 14);
  const ltfRsi = ltfRsiArr[ltfRsiArr.length - 1] ?? Number.NaN;
  const regimeAwareRsi = resolveRegimeAwareRsiBounds({
    baseOversold: AI_MATIC_RSI_OVERSOLD,
    baseOverbought: AI_MATIC_RSI_OVERBOUGHT,
    htfBias: htfDir,
    regime: (decision as any)?.proRegime,
  });
  const rsiEnvelope = computeRsiBollingerEnvelope(ltfRsiArr, {
    period: 20,
    stdDev: 2,
  });
  const rsiExtremeLong =
    Number.isFinite(ltfRsi) &&
    (ltfRsi <= regimeAwareRsi.oversold ||
      (rsiEnvelope.valid && rsiEnvelope.oversold));
  const rsiExtremeShort =
    Number.isFinite(ltfRsi) &&
    (ltfRsi >= regimeAwareRsi.overbought ||
      (rsiEnvelope.valid && rsiEnvelope.overbought));
  const macdState = resolveMacdState(ltfCloses);
  const momentumLongOk =
    rsiExtremeLong && (macdState.macdCrossUp || macdState.macdAlignedUp);
  const momentumShortOk =
    rsiExtremeShort && (macdState.macdCrossDown || macdState.macdAlignedDown);
  const gapPresent = resolveGapPresent([...htfPois, ...mtfPois]);
  const obRetest = resolvePoiTouch([...htfPois, ...mtfPois], price);
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
  const swingModule = resolveAiMaticSwingModule(candles);
  const ema200ScalpModule = resolveAiMaticEma200ScalpModule(candles, { resample });

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
      rsiOversold: regimeAwareRsi.oversold,
      rsiOverbought: regimeAwareRsi.overbought,
      rsiMode: regimeAwareRsi.mode,
      rsiBbLower: rsiEnvelope.lower,
      rsiBbUpper: rsiEnvelope.upper,
      rsiBbOversold: rsiEnvelope.oversold,
      rsiBbOverbought: rsiEnvelope.overbought,
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
    swing: swingModule,
    ema200Scalp: ema200ScalpModule,
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

const isAiMaticLondonNySession = (date: Date) => {
  const hourUtc = date.getUTCHours();
  const londonHours = hourUtc >= 7 && hourUtc < 16;
  const nyHours = hourUtc >= 13 && hourUtc < 22;
  return londonHours || nyHours;
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
  riskParams?: AiMaticAdaptiveRiskParams;
}) => {
  const { side, entry, currentSl, atr, aiMatic, core, riskParams } = args;
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
  const sweepBase =
    side === "Buy"
      ? minFinite(
          aiMatic?.ltf.sweepLowWick,
          aiMatic?.mtf.sweepLowWick,
          aiMatic?.htf.sweepLowWick
        )
      : maxFinite(
          aiMatic?.ltf.sweepHighWick,
          aiMatic?.mtf.sweepHighWick,
          aiMatic?.htf.sweepHighWick
        );
  const buffer = Number.isFinite(atr) ? atr * AI_MATIC_SL_ATR_BUFFER : 0;
  let candidate = Number.NaN;
  if (side === "Buy") {
    const base = minFinite(pivotLow, poiBoundary, sweepBase);
    if (Number.isFinite(base)) {
      candidate = base - buffer;
    }
  } else {
    const base = maxFinite(pivotHigh, poiBoundary, sweepBase);
    if (Number.isFinite(base)) {
      candidate = base + buffer;
    }
  }
  if (!Number.isFinite(candidate) || candidate <= 0) return Number.NaN;
  const hardCapByPct = entry * (riskParams?.hardCapPct ?? AI_MATIC_SL_HARD_CAP_PCT);
  const hardCapByAtr =
    Number.isFinite(atr) && (atr as number) > 0
      ? (atr as number) *
        (riskParams?.hardCapAtrMult ?? AI_MATIC_SL_HARD_CAP_ATR_MULT)
      : Number.POSITIVE_INFINITY;
  const hardCapDistance = Math.min(hardCapByPct, hardCapByAtr);
  if (Number.isFinite(hardCapDistance) && hardCapDistance > 0) {
    if (side === "Buy") {
      const capped = entry - hardCapDistance;
      if (candidate < capped) candidate = capped;
    } else {
      const capped = entry + hardCapDistance;
      if (candidate > capped) candidate = capped;
    }
  }
  if (
    Number.isFinite(currentSl) &&
    Number.isFinite(hardCapDistance) &&
    hardCapDistance > 0
  ) {
    if (side === "Buy") {
      const cappedCurrent = entry - hardCapDistance;
      if ((currentSl as number) < cappedCurrent) {
        return cappedCurrent;
      }
    } else {
      const cappedCurrent = entry + hardCapDistance;
      if ((currentSl as number) > cappedCurrent) {
        return cappedCurrent;
      }
    }
  }
  if (!Number.isFinite(currentSl)) return candidate;
  if (side === "Buy") {
    return candidate < (currentSl as number) ? candidate : Number.NaN;
  }
  return candidate > (currentSl as number) ? candidate : Number.NaN;
};

type AiMaticTargetPlan = {
  tp1: number;
  tp2: number;
};

const resolveAiMaticTargetPlan = (args: {
  side: "Buy" | "Sell";
  entry: number;
  sl: number;
  atr?: number;
  aiMatic?: AiMaticContext | null;
}): AiMaticTargetPlan => {
  const { side, entry, sl, atr, aiMatic } = args;
  if (!Number.isFinite(entry) || !Number.isFinite(sl)) {
    return { tp1: Number.NaN, tp2: Number.NaN };
  }
  const risk = Math.abs(entry - sl);
  if (!Number.isFinite(risk) || risk <= 0) {
    return { tp1: Number.NaN, tp2: Number.NaN };
  }
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

  const direction = side === "Buy" ? 1 : -1;
  const pctMove = (price: number) => Math.abs(price - entry) / entry;
  const isBeyond = (a: number, b: number) =>
    side === "Buy" ? a > b : a < b;
  const pctTarget = (pct: number) => entry * (1 + direction * pct);
  const pickInPctRange = (
    minPct: number,
    maxPct: number,
    minLevel?: number
  ) =>
    list.find((candidate) => {
      if (Number.isFinite(minLevel) && !isBeyond(candidate, minLevel as number)) {
        return false;
      }
      const pct = pctMove(candidate);
      return pct >= minPct && pct <= maxPct;
    });
  const pickNextBeyond = (level: number) =>
    list.find((candidate) => isBeyond(candidate, level));

  const atrTarget =
    Number.isFinite(atr) && (atr as number) > 0
      ? side === "Buy"
        ? entry + AI_MATIC_TP1_ATR_MULT * (atr as number)
        : entry - AI_MATIC_TP1_ATR_MULT * (atr as number)
      : Number.NaN;

  let tp1 = pickInPctRange(AI_MATIC_TP1_PCT_MIN, AI_MATIC_TP1_PCT_MAX);
  if (!Number.isFinite(tp1) && Number.isFinite(atrTarget) && atrTarget > 0) {
    for (const candidate of list) {
      if (side === "Buy" ? candidate >= atrTarget : candidate <= atrTarget) {
        tp1 = candidate;
        break;
      }
    }
    if (!Number.isFinite(tp1)) {
      tp1 = atrTarget;
    }
  }

  if (!Number.isFinite(tp1)) {
    const minTarget =
      side === "Buy" ? entry + risk * AI_MATIC_MIN_RR : entry - risk * AI_MATIC_MIN_RR;
    for (const candidate of list) {
      if (side === "Buy" ? candidate >= minTarget : candidate <= minTarget) {
        tp1 = candidate;
        break;
      }
    }
  }

  if (!Number.isFinite(tp1)) {
    tp1 = pctTarget((AI_MATIC_TP1_PCT_MIN + AI_MATIC_TP1_PCT_MAX) / 2);
  }

  let tp2 = pickInPctRange(AI_MATIC_TP2_PCT_MIN, AI_MATIC_TP2_PCT_MAX, tp1);
  if (!Number.isFinite(tp2)) {
    tp2 = pickNextBeyond(tp1 as number);
  }
  if (!Number.isFinite(tp2)) {
    tp2 = pctTarget((AI_MATIC_TP2_PCT_MIN + AI_MATIC_TP2_PCT_MAX) / 2);
  }
  if (!Number.isFinite(tp2) || !isBeyond(tp2, tp1 as number)) {
    const minDistance = entry * AI_MATIC_TP2_PCT_MIN;
    tp2 = side === "Buy" ? (tp1 as number) + minDistance : (tp1 as number) - minDistance;
  }

  return {
    tp1: Number.isFinite(tp1) ? (tp1 as number) : Number.NaN,
    tp2: Number.isFinite(tp2) ? (tp2 as number) : Number.NaN,
  };
};

const resolveAiMaticTargets = (args: {
  side: "Buy" | "Sell";
  entry: number;
  sl: number;
  atr?: number;
  aiMatic?: AiMaticContext | null;
}) => {
  return resolveAiMaticTargetPlan(args).tp1;
};

type EnabledEntryType = Exclude<EntryType, "MARKET_DISABLED">;

const resolveAiMaticEntryType = (args: {
  aiMatic: AiMaticContext;
  side: "Buy" | "Sell";
  entry: number;
}): { entryType: EnabledEntryType; triggerPrice?: number; allowMarket: boolean } => {
  const { aiMatic, side, entry } = args;
  const dir = side === "Buy" ? "bull" : "bear";
  const patterns = aiMatic.ltf.patterns;
  const insideBreakout =
    patterns.insideBar &&
    (dir === "bull"
      ? aiMatic.ltf.bosUp || aiMatic.ltf.breakRetestUp
      : aiMatic.ltf.bosDown || aiMatic.ltf.breakRetestDown);
  const strongPattern =
    dir === "bull"
      ? patterns.pinbarBull || patterns.engulfBull || patterns.trapBull || insideBreakout
      : patterns.pinbarBear || patterns.engulfBear || patterns.trapBear || insideBreakout;
  const momentumOk =
    dir === "bull" ? aiMatic.ltf.momentumLongOk : aiMatic.ltf.momentumShortOk;
  const strongReaction = strongPattern && aiMatic.ltf.volumeReaction && momentumOk;
  if (strongReaction) {
    return { entryType: "LIMIT_MAKER_FIRST", allowMarket: false };
  }
  const breakoutOk =
    dir === "bull"
      ? aiMatic.ltf.bosUp || aiMatic.ltf.breakRetestUp
      : aiMatic.ltf.bosDown || aiMatic.ltf.breakRetestDown;
  if (breakoutOk) {
    const triggerBase =
      dir === "bull"
        ? maxFinite(
            entry,
            aiMatic.ltf.swingHigh,
            aiMatic.mtf.pivotHigh,
            aiMatic.htf.pivotHigh
          )
        : minFinite(
            entry,
            aiMatic.ltf.swingLow,
            aiMatic.mtf.pivotLow,
            aiMatic.htf.pivotLow
          );
    const triggerPrice =
      Number.isFinite(triggerBase) && triggerBase > 0 ? triggerBase : undefined;
    return { entryType: "CONDITIONAL", triggerPrice, allowMarket: false };
  }
  return { entryType: "LIMIT_MAKER_FIRST", allowMarket: false };
};

type AiMaticGate = { name: string; ok: boolean; detail?: string; pending?: boolean };
type AiMaticGateEval = {
  hardGates: AiMaticGate[];
  entryFactors: AiMaticGate[];
  checklist: AiMaticGate[];
  hardPass: boolean;
  entryFactorsPass: boolean;
  checklistPass: boolean;
  pass: boolean;
};

type AmdGateEval = {
  gates: AiMaticGate[];
  pass: boolean;
};

type GateResult = { ok: boolean; code: string; reason: string; ttlMs?: number };
type DecisionTraceEntry = {
  gate: string;
  result: GateResult;
};
type CapacityReason = "OK" | "MAX_POS" | "MAX_ORDERS" | "MAX_POS+MAX_ORDERS";
type CapacityStatus = {
  posFull: boolean;
  ordFull: boolean;
  reason: CapacityReason;
};
type AtomicExposureSnapshot = {
  openPositionsTotal: number;
  openOrdersTotal: number;
  pendingIntentsTotal: number;
  reservedPositionsTotal: number;
  reservedOrdersTotal: number;
  maxPos: number;
  maxOrders: number;
  status: CapacityStatus;
  reservedStatus: CapacityStatus;
  fingerprint: string;
};
type CapacityPauseTrigger =
  | "POSITION_CLOSED"
  | "ORDER_CANCELED"
  | "ORDER_FILLED"
  | "RECONCILED"
  | "TTL_RECHECK";
type RelayPauseState = {
  paused: boolean;
  pausedReason: CapacityReason | null;
  pausedAt: number;
  lastCapacityFingerprint: string;
  forceScanSymbols: Set<string>;
  forceScanReason: CapacityPauseTrigger | null;
  lastTtlRecheckAt: number;
};

function resolveDataHealthLagMs(riskMode: AISettings["riskMode"]): number {
  const timeframeMs = FEED_TIMEFRAME_MS_BY_RISK_MODE[riskMode] ?? 60_000;
  return Math.max(1_000, timeframeMs * DATA_HEALTH_LAG_FACTOR);
}

function normalizeCapacityLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function getCapacityStatus(args: {
  openPositionsTotal: number;
  maxPos: number;
  openOrdersTotal: number;
  maxOrders: number;
}): CapacityStatus {
  const maxPos = normalizeCapacityLimit(args.maxPos);
  const maxOrders = normalizeCapacityLimit(args.maxOrders);
  const posFull = maxPos <= 0 || args.openPositionsTotal >= maxPos;
  const ordFull = maxOrders <= 0 || args.openOrdersTotal >= maxOrders;
  const reason: CapacityReason = posFull && ordFull
    ? "MAX_POS+MAX_ORDERS"
    : posFull
      ? "MAX_POS"
      : ordFull
        ? "MAX_ORDERS"
        : "OK";
  return { posFull, ordFull, reason };
}

function buildCapacityFingerprint(args: {
  openPositionsTotal: number;
  maxPos: number;
  openOrdersTotal: number;
  maxOrders: number;
}): string {
  const maxPos = normalizeCapacityLimit(args.maxPos);
  const maxOrders = normalizeCapacityLimit(args.maxOrders);
  return `${args.openPositionsTotal}/${maxPos}|${args.openOrdersTotal}/${maxOrders}`;
}

function positionCapacityGate(args: {
  hasSymbolPosition: boolean;
  openPositionsTotal: number;
  maxPos: number;
  positionReason?: string;
  maxPosReasonPrefix?: string;
}): GateResult {
  const positionReason = args.positionReason ?? "open position";
  const maxPosReasonPrefix = args.maxPosReasonPrefix ?? "max positions";
  if (args.hasSymbolPosition) {
    return {
      ok: false,
      code: "OPEN_POSITION",
      reason: positionReason,
      ttlMs: POSITION_GATE_TTL_MS,
    };
  }
  const maxPos = Number.isFinite(args.maxPos) ? Math.max(0, Math.round(args.maxPos)) : 0;
  if (maxPos <= 0 || args.openPositionsTotal >= maxPos) {
    return {
      ok: false,
      code: "MAX_POS",
      reason: `${maxPosReasonPrefix} ${args.openPositionsTotal}/${maxPos}`,
      ttlMs: MAX_POS_GATE_TTL_MS,
    };
  }
  return { ok: true, code: "OK", reason: "capacity" };
}

const evaluateAiMaticGatesCore = (args: {
  decision: PriceFeedDecision | null | undefined;
  signal: PriceFeedDecision["signal"] | null | undefined;
  correlationOk: boolean;
  dominanceOk: boolean;
  symbol?: string;
  nowTs?: number;
  lossStreak?: number;
  takerFeePct?: number;
}): AiMaticGateEval => {
  const aiMatic = (args.decision as any)?.aiMatic as AiMaticContext | null;
  const core = (args.decision as any)?.coreV2 as CoreV2Metrics | undefined;
  const orderflow = (args.decision as any)?.orderflow as
    | { bestBid?: number; bestAsk?: number }
    | undefined;
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

  const symbolUpper = String(args.symbol ?? "").toUpperCase();
  const nowTs = Number.isFinite(args.nowTs) ? (args.nowTs as number) : Date.now();
  const lossStreak = Number.isFinite(args.lossStreak)
    ? (args.lossStreak as number)
    : 0;
  const takerFeePct = Number.isFinite(args.takerFeePct)
    ? Math.max(0, args.takerFeePct as number)
    : 0.06;
  const takerFeeRate = takerFeePct / 100;
  const entry = toNumber(signal.intent?.entry);
  const stopLoss = toNumber(signal.intent?.sl);
  const takeProfit = toNumber(signal.intent?.tp);
  const riskDistance =
    Number.isFinite(entry) && Number.isFinite(stopLoss)
      ? Math.abs(entry - stopLoss)
      : Number.NaN;
  const rewardDistance =
    Number.isFinite(entry) && Number.isFinite(takeProfit)
      ? Math.abs(takeProfit - entry)
      : Number.NaN;
  const feeDistance =
    Number.isFinite(entry) && entry > 0 ? entry * takerFeeRate * 2 : Number.NaN;
  const netRisk =
    Number.isFinite(riskDistance) && Number.isFinite(feeDistance)
      ? riskDistance + feeDistance
      : Number.NaN;
  const netReward =
    Number.isFinite(rewardDistance) && Number.isFinite(feeDistance)
      ? rewardDistance - feeDistance
      : Number.NaN;
  const rrAfterFees =
    Number.isFinite(netReward) && Number.isFinite(netRisk) && netRisk > 0
      ? netReward / netRisk
      : Number.NaN;

  const structureAligned =
    dir === "bull"
      ? aiMatic.htf.structureTrend === "BULL"
      : aiMatic.htf.structureTrend === "BEAR";
  const htfEmaOk =
    dir === "bull" ? aiMatic.htf.ema?.bullOk : aiMatic.htf.ema?.bearOk;
  const htfEmaValid = Number.isFinite(aiMatic.htf.ema?.ema200);
  const htfAligned =
    htfEmaValid &&
    aiMatic.htf.ema.breakoutRecent &&
    aiMatic.htf.ema.confirmed
      ? Boolean(htfEmaOk)
      : structureAligned;
  const mtfStructureOk =
    dir === "bull"
      ? aiMatic.mtf.bosUp || aiMatic.mtf.chochUp
      : aiMatic.mtf.bosDown || aiMatic.mtf.chochDown;
  const sweepOk =
    dir === "bull"
      ? aiMatic.htf.sweepLow ||
        aiMatic.mtf.sweepLow ||
        aiMatic.ltf.sweepLow ||
        aiMatic.ltf.fakeoutLow
      : aiMatic.htf.sweepHigh ||
        aiMatic.mtf.sweepHigh ||
        aiMatic.ltf.sweepHigh ||
        aiMatic.ltf.fakeoutHigh;
  const htfPoiReaction =
    dir === "bull" ? aiMatic.htf.poiReactionBull : aiMatic.htf.poiReactionBear;
  const mtfPoiReaction =
    dir === "bull" ? aiMatic.mtf.poiReactionBull : aiMatic.mtf.poiReactionBear;
  const obReactionOk = htfPoiReaction || mtfPoiReaction;
  const gapPresent = Boolean(aiMatic.mtf.gapPresent);
  const obRetestOk = Boolean(aiMatic.mtf.obRetest);
  const inPoiZoneOk = obReactionOk || gapPresent || obRetestOk;
  const rrAfterFeesOk =
    Number.isFinite(rrAfterFees) && rrAfterFees >= AI_MATIC_MIN_RR;

  const ltfClose = toNumber(core?.ltfClose);
  const ltfEma200 = toNumber(aiMatic.ltf.ema?.ema200);
  const pullbackPct =
    Number.isFinite(ltfClose) && Number.isFinite(ltfEma200) && ltfClose > 0
      ? Math.abs(ltfClose - ltfEma200) / ltfClose
      : Number.NaN;
  const pullbackOk =
    Number.isFinite(pullbackPct) &&
    pullbackPct <= AI_MATIC_ENTRY_PULLBACK_MAX_PCT;
  const rvolThreshold =
    symbolUpper === "ETHUSDT"
      ? AI_MATIC_ENTRY_RVOL_MIN_ETH
      : AI_MATIC_ENTRY_RVOL_MIN;
  const rvol = toNumber(core?.volumeTodRatio);
  const rvolOk = Number.isFinite(rvol)
    ? rvol >= rvolThreshold
    : Boolean(aiMatic.ltf.volumeReaction);
  const ltfOpen = toNumber(core?.ltfOpen);
  const ltfHigh = toNumber(core?.ltfHigh);
  const ltfLow = toNumber(core?.ltfLow);
  const ltfBody =
    Number.isFinite(ltfOpen) && Number.isFinite(ltfClose)
      ? Math.max(Math.abs(ltfClose - ltfOpen), 1e-8)
      : Number.NaN;
  const rejectionWick =
    Number.isFinite(ltfOpen) &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ltfHigh) &&
    Number.isFinite(ltfLow)
      ? dir === "bull"
        ? Math.min(ltfOpen, ltfClose) - ltfLow
        : ltfHigh - Math.max(ltfOpen, ltfClose)
      : Number.NaN;
  const rejectionRatio =
    Number.isFinite(rejectionWick) && Number.isFinite(ltfBody)
      ? rejectionWick / ltfBody
      : Number.NaN;
  const rejectionOk =
    Number.isFinite(rejectionRatio) &&
    rejectionRatio >= AI_MATIC_ENTRY_WICK_BODY_MIN;

  const adx = toNumber((args.decision as any)?.trendAdx);
  const adxOk = Number.isFinite(adx) && adx >= AI_MATIC_CHECKLIST_ADX_MIN;
  const bid = toNumber(orderflow?.bestBid);
  const ask = toNumber(orderflow?.bestAsk);
  const spreadPct =
    Number.isFinite(bid) &&
    Number.isFinite(ask) &&
    bid > 0 &&
    ask > 0 &&
    ask >= bid
      ? (ask - bid) / ((ask + bid) / 2)
      : Number.NaN;
  const spreadOk = !Number.isFinite(spreadPct)
    ? true
    : spreadPct <= AI_MATIC_CHECKLIST_SPREAD_MAX_PCT;
  const fundingRate = toNumber(
    (args.decision as any)?.fundingRate ?? (args.decision as any)?.funding
  );
  const fundingNeutralOk = !Number.isFinite(fundingRate)
    ? true
    : Math.abs(fundingRate) <= AI_MATIC_CHECKLIST_FUNDING_ABS_MAX;
  const isMajor = MAJOR_SYMBOLS.has(symbolUpper as Symbol);
  const atrFloor = isMajor ? CORE_V2_ATR_MIN_PCT_MAJOR : CORE_V2_ATR_MIN_PCT_ALT;
  const atrPct = toNumber(core?.atrPct);
  const atrOk = Number.isFinite(atrPct) && atrPct >= atrFloor;
  const noOpposingHtfSupplyOk =
    dir === "bull"
      ? aiMatic.htf.structureTrend !== "BEAR" && !aiMatic.htf.chochDown
      : aiMatic.htf.structureTrend !== "BULL" && !aiMatic.htf.chochUp;
  const riskBudgetOk =
    args.correlationOk &&
    args.dominanceOk &&
    Number.isFinite(riskDistance) &&
    riskDistance > 0;
  const lossStreakOk = lossStreak <= 3;
  const sessionOk = isAiMaticLondonNySession(new Date(nowTs));

  const hardGates: AiMaticGate[] = [
    { name: "HTF trend alignment", ok: htfAligned },
    { name: "15m BOS/CHOCH", ok: mtfStructureOk },
    { name: "OB/FVG zone", ok: inPoiZoneOk },
    { name: `RRR >= ${AI_MATIC_MIN_RR} (fees)`, ok: rrAfterFeesOk },
  ];
  const entryFactors: AiMaticGate[] = [
    { name: "5m EMA pullback <= 0.8%", ok: pullbackOk },
    { name: `RVOL >= ${rvolThreshold}`, ok: rvolOk },
    { name: "Liquidity sweep", ok: sweepOk },
    { name: "Rejection wick/body >= 0.5", ok: rejectionOk },
  ];
  const checklist: AiMaticGate[] = [
    { name: "Session London/NY", ok: sessionOk },
    { name: "ADX >= 22", ok: adxOk },
    { name: "Spread <= 0.02%", ok: spreadOk },
    { name: "Funding neutral", ok: fundingNeutralOk },
    { name: "ATR volatility floor", ok: atrOk },
    { name: "No HTF supply against", ok: noOpposingHtfSupplyOk },
    { name: "Risk budget available", ok: riskBudgetOk },
    { name: "Loss streak <= 3", ok: lossStreakOk },
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

const evaluateAmdGatesCore = (args: {
  decision: PriceFeedDecision | null | undefined;
  signal: PriceFeedDecision["signal"] | null | undefined;
}): AmdGateEval => {
  const amd = (args.decision as any)?.amdContext as AmdContext | null;
  const signal = args.signal ?? null;
  const empty: AmdGateEval = { gates: [], pass: false };
  if (!amd) return empty;
  const target = amd.targets ?? null;
  const signalTp = toNumber(signal?.intent?.tp);
  const hasSignal = Boolean(signal);
  const waitingMode = !hasSignal;
  const phase = String(amd.phase ?? "NONE");
  const kz = String(amd.killzoneName ?? "NONE");
  const midnight = toNumber(amd.midnightOpen);
  const asiaHigh = toNumber(amd.accumulationRange?.high);
  const asiaLow = toNumber(amd.accumulationRange?.low);
  const sweepLow = toNumber(amd.manipulation?.low);
  const sweepHigh = toNumber(amd.manipulation?.high);
  const tp1 = toNumber(target?.tp1);
  const tp2 = toNumber(target?.tp2);
  const baseTargetValid =
    amd.gates?.targetModelValid === true &&
    Number.isFinite(tp1) &&
    Number.isFinite(tp2);
  const targetValid =
    baseTargetValid &&
    Number.isFinite(signalTp) &&
    signalTp > 0;
  const resolveDetail = (
    ok: boolean,
    pending: string,
    blocked: string,
    passed = "OK"
  ) => {
    if (ok) return passed;
    return waitingMode ? pending : blocked;
  };
  const gates: AiMaticGate[] = [
    {
      name: "AMD: Phase sequence",
      ok: amd.gates?.phaseSequence === true,
      pending: waitingMode && amd.gates?.phaseSequence !== true,
      detail: resolveDetail(
        amd.gates?.phaseSequence === true,
        `phase ${phase} -> čeká DISTRIBUTION`,
        `phase ${phase} není DISTRIBUTION`
      ),
    },
    {
      name: "AMD: Killzone active",
      ok: amd.gates?.killzoneActive === true,
      pending: waitingMode && amd.gates?.killzoneActive !== true,
      detail: resolveDetail(
        amd.gates?.killzoneActive === true,
        `killzone ${kz} -> čeká LONDON/NY_AM`,
        `killzone ${kz} mimo LONDON/NY_AM`
      ),
    },
    {
      name: "AMD: Midnight open set",
      ok: amd.gates?.midnightOpenSet === true,
      pending: waitingMode && amd.gates?.midnightOpenSet !== true,
      detail: resolveDetail(
        amd.gates?.midnightOpenSet === true,
        "čeká midnight open",
        "midnight open není validní",
        Number.isFinite(midnight) ? `midnight ${formatNumber(midnight, 4)}` : "OK"
      ),
    },
    {
      name: "AMD: Asia range valid",
      ok: amd.gates?.asiaRangeValid === true,
      pending: waitingMode && amd.gates?.asiaRangeValid !== true,
      detail: resolveDetail(
        amd.gates?.asiaRangeValid === true,
        "čeká validní Asia range",
        "Asia range není validní",
        Number.isFinite(asiaLow) && Number.isFinite(asiaHigh)
          ? `Asia ${formatNumber(asiaLow, 4)}-${formatNumber(asiaHigh, 4)}`
          : "OK"
      ),
    },
    {
      name: "AMD: Liquidity sweep",
      ok: amd.gates?.liquiditySweep === true,
      pending: waitingMode && amd.gates?.liquiditySweep !== true,
      detail: resolveDetail(
        amd.gates?.liquiditySweep === true,
        "čeká liquidity sweep",
        "liquidity sweep nepotvrzen",
        Number.isFinite(sweepLow) && Number.isFinite(sweepHigh)
          ? `sweep ${formatNumber(sweepLow, 4)}-${formatNumber(sweepHigh, 4)}`
          : "OK"
      ),
    },
    {
      name: "AMD: Inversion FVG confirm",
      ok: amd.gates?.inversionFvgConfirm === true,
      pending: waitingMode && amd.gates?.inversionFvgConfirm !== true,
      detail: resolveDetail(
        amd.gates?.inversionFvgConfirm === true,
        "čeká inversion FVG potvrzení",
        "inversion FVG nepotvrzen"
      ),
    },
    {
      name: "AMD: Target model valid",
      ok: targetValid,
      pending: waitingMode && !targetValid,
      detail: targetValid
        ? `TP1 ${formatNumber(tp1, 4)} · TP2 ${formatNumber(tp2, 4)}`
        : waitingMode
          ? baseTargetValid
            ? "čeká finální signal TP"
            : "čeká validní target model"
          : "target model není validní",
    },
  ];
  return {
    gates,
    pass: gates.length > 0 && gates.every((gate) => gate.ok),
  };
};

export const __aiMaticTest = {
  resolveAiMaticPatterns,
  resolveAiMaticEmaFlags,
  resolveAiMaticBreakRetest,
  resolveLiquiditySweep,
  resolveStructureState,
  resolveAiMaticSwingModule,
  resolveAiMaticEma200ScalpModule,
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

type ScalpFibLevel = "38.2" | "50" | "61.8";
type ScalpFibExtLevel = "61.8" | "100" | "161.8";
type ScalpFibData = {
  direction: "BULL" | "BEAR";
  swingHigh: number;
  swingLow: number;
  range: number;
  retrace: Record<ScalpFibLevel, number>;
  ext: Record<ScalpFibExtLevel, number>;
  m5InZone: boolean;
  ltfInZone: boolean;
  hitLevel?: ScalpFibLevel;
  m5Level?: ScalpFibLevel;
  ltfLevel?: ScalpFibLevel;
};

type ScalpConfirm = {
  obTouch: boolean;
  gapTouch: boolean;
  vpConfirm: boolean;
  tlPullback: boolean;
  any: boolean;
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
  ltfOpenTime: number;
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
  ema200: number;
  ema200BreakoutBull: boolean;
  ema200BreakoutBear: boolean;
  ema200ConfirmBull: boolean;
  ema200ConfirmBear: boolean;
  atr14: number;
  atrPct: number;
  sep1: number;
  sep2: number;
  volumeCurrent: number;
  volumeP50: number;
  volumeP60: number;
  volumeP65: number;
  volumeP70: number;
  volumeTodBaseline: number;
  volumeTodThreshold: number;
  volumeTodRatio: number;
  volumeTodSampleCount: number;
  volumeTodSlotMinute: number;
  volumeTodFallback: boolean;
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
  ltfMacdHist: number;
  ltfMacdSignal: number;
  ltfRsiNeutral: boolean;
  ltfNoNewHigh: boolean;
  ltfNoNewLow: boolean;
  htfClose: number;
  htfEma200: number;
  htfBias: "BULL" | "BEAR" | "NONE";
  htfBreakoutBull: boolean;
  htfBreakoutBear: boolean;
  htfConfirmBull: boolean;
  htfConfirmBear: boolean;
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
  scalpFib?: ScalpFibData;
  scalpConfirm?: ScalpConfirm;
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
  riskMode === "ai-matic-olikella" ? 15 : 5;

const resolveBboAgeLimit = (symbol: Symbol) =>
  CORE_V2_BBO_AGE_BY_SYMBOL[symbol] ?? CORE_V2_BBO_AGE_DEFAULT_MS;

type ResampleFn = (timeframeMin: number) => Candle[];

const createResampleCache = (candles: Candle[]): ResampleFn => {
  const cache = new Map<number, Candle[]>();
  return (timeframeMin: number) => {
    const cached = cache.get(timeframeMin);
    if (cached) return cached;
    const next = resampleCandles(candles, timeframeMin);
    cache.set(timeframeMin, next);
    return next;
  };
};

const resolveScalpSwing = (
  pivotsHigh: { idx: number; price: number }[],
  pivotsLow: { idx: number; price: number }[],
  direction: "BULL" | "BEAR"
) => {
  if (!pivotsHigh.length || !pivotsLow.length) return null;
  if (direction === "BULL") {
    const lastHigh = pivotsHigh[pivotsHigh.length - 1];
    const lastLow = [...pivotsLow].reverse().find((p) => p.idx < lastHigh.idx);
    if (!lastHigh || !lastLow) return null;
    const range = lastHigh.price - lastLow.price;
    if (!Number.isFinite(range) || range <= 0) return null;
    return { high: lastHigh.price, low: lastLow.price, range };
  }
  const lastLow = pivotsLow[pivotsLow.length - 1];
  const lastHigh = [...pivotsHigh].reverse().find((p) => p.idx < lastLow.idx);
  if (!lastHigh || !lastLow) return null;
  const range = lastHigh.price - lastLow.price;
  if (!Number.isFinite(range) || range <= 0) return null;
  return { high: lastHigh.price, low: lastLow.price, range };
};

const resolveScalpFibLevels = (
  swing: { high: number; low: number; range: number },
  direction: "BULL" | "BEAR"
) => {
  const retrace: Record<ScalpFibLevel, number> = {
    "38.2": Number.NaN,
    "50": Number.NaN,
    "61.8": Number.NaN,
  };
  const ext: Record<ScalpFibExtLevel, number> = {
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
  } else {
    retrace["38.2"] = swing.low + swing.range * SCALP_FIB_LEVELS[0];
    retrace["50"] = swing.low + swing.range * SCALP_FIB_LEVELS[1];
    retrace["61.8"] = swing.low + swing.range * SCALP_FIB_LEVELS[2];
    ext["61.8"] = swing.low - swing.range * SCALP_FIB_EXT[0];
    ext["100"] = swing.low - swing.range * SCALP_FIB_EXT[1];
    ext["161.8"] = swing.low - swing.range * SCALP_FIB_EXT[2];
  }
  return { retrace, ext };
};

const resolveFibHitLevel = (
  price: number,
  retrace: Record<ScalpFibLevel, number>,
  tolerance: number
): ScalpFibLevel | undefined => {
  if (!Number.isFinite(price) || !Number.isFinite(tolerance) || tolerance <= 0) {
    return undefined;
  }
  const levels: [ScalpFibLevel, number][] = [
    ["38.2", retrace["38.2"]],
    ["50", retrace["50"]],
    ["61.8", retrace["61.8"]],
  ];
  let best: ScalpFibLevel | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [level, value] of levels) {
    if (!Number.isFinite(value)) continue;
    const dist = Math.abs(price - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = level;
    }
  }
  if (best && bestDist <= tolerance) return best;
  return undefined;
};

const buildScalpFibData = (args: {
  m15Highs: { idx: number; price: number }[];
  m15Lows: { idx: number; price: number }[];
  direction: "BULL" | "BEAR";
  m5Close: number;
  ltfClose: number;
  atr: number;
}): ScalpFibData | null => {
  const swing = resolveScalpSwing(args.m15Highs, args.m15Lows, args.direction);
  if (!swing) return null;
  const levels = resolveScalpFibLevels(swing, args.direction);
  const price = Number.isFinite(args.ltfClose) ? args.ltfClose : args.m5Close;
  const tolAtr =
    Number.isFinite(args.atr) && args.atr > 0 ? args.atr * SCALP_FIB_TOL_ATR : 0;
  const tolPct =
    Number.isFinite(price) && price > 0 ? price * SCALP_FIB_TOL_PCT : 0;
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

const resolveScalpConfirmation = (args: {
  pois: AiMaticPoi[];
  price: number;
  direction: "BULL" | "BEAR";
  vpConfirm: boolean;
  tlPullback: boolean;
}): ScalpConfirm => {
  const priceOk = Number.isFinite(args.price);
  const dirOk = (poi: AiMaticPoi) => {
    const poiDir = String(poi.direction ?? "").toLowerCase();
    return args.direction === "BULL"
      ? poiDir === "bullish" || poiDir === "bull"
      : poiDir === "bearish" || poiDir === "bear";
  };
  const inZone = (poi: AiMaticPoi) =>
    priceOk && Number.isFinite(poi.low) && Number.isFinite(poi.high)
      ? args.price >= poi.low && args.price <= poi.high
      : false;
  const obTouch = args.pois.some(
    (poi) => String(poi.type).toLowerCase() === "ob" && dirOk(poi) && inZone(poi)
  );
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

const computeCoreV2Metrics = (
  candles: Candle[],
  riskMode: AISettings["riskMode"],
  opts?: { resample?: ResampleFn; emaTrendPeriod?: number }
): CoreV2Metrics => {
  const ltfTimeframeMin = resolveEntryTfMin(riskMode);
  const resample = opts?.resample ?? ((tf) => resampleCandles(candles, tf));
  const emaTrendPeriod = clampEmaTrendPeriod(
    opts?.emaTrendPeriod,
    EMA_TREND_PERIOD
  );
  const ltf = resample(ltfTimeframeMin);
  const ltfLast = ltf.length ? ltf[ltf.length - 1] : undefined;
  const ltfPrev = ltf.length > 1 ? ltf[ltf.length - 2] : undefined;
  const ltfOpenTime = ltfLast ? toNumber(ltfLast.openTime) : Number.NaN;
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
  const ema200Arr = computeEma(ltfCloses, emaTrendPeriod);
  const ema8 = ema8Arr[ema8Arr.length - 1] ?? Number.NaN;
  const ema12 = ema12Arr[ema12Arr.length - 1] ?? Number.NaN;
  const ema21 = ema21Arr[ema21Arr.length - 1] ?? Number.NaN;
  const ema26 = ema26Arr[ema26Arr.length - 1] ?? Number.NaN;
  const ema50 = ema50Arr[ema50Arr.length - 1] ?? Number.NaN;
  const ema200 = ema200Arr[ema200Arr.length - 1] ?? Number.NaN;
  const ema200BreakoutState = resolveEma200BreakoutState(ltf, {
    emaPeriod: emaTrendPeriod,
    breakoutLookback: EMA_TREND_TOUCH_LOOKBACK,
    confirmBars: EMA_TREND_CONFIRM_BARS,
  });
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
  const volumeTod = computeTimeOfDayVolumeGate(
    ltf,
    CORE_V2_VOLUME_PCTL[riskMode] / 100,
    {
      lookbackDays: CORE_V2_VOLUME_TOD_LOOKBACK_DAYS,
      minSamples: CORE_V2_VOLUME_TOD_MIN_SAMPLES,
      slotMinutes: ltfTimeframeMin,
    }
  );
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

  const htf = resample(5);
  const htfCloses = htf.map((c) => c.close);
  const htfHighs = htf.map((c) => c.high);
  const htfLows = htf.map((c) => c.low);
  const htfClose = htf.length ? htf[htf.length - 1].close : Number.NaN;
  const htfEma200State = resolveEma200BreakoutState(htf, {
    emaPeriod: emaTrendPeriod,
    breakoutLookback: EMA_TREND_TOUCH_LOOKBACK,
    confirmBars: EMA_TREND_CONFIRM_BARS,
  });
  const htfEma200 = htfEma200State.ema;
  const htfBias =
    htfEma200State.direction === "BULL"
      ? "BULL"
      : htfEma200State.direction === "BEAR"
        ? "BEAR"
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

  const m15 = resample(15);
  const m15Last = m15.length ? m15[m15.length - 1] : undefined;
  const m15Closes = m15.map((c) => c.close);
  const m15Highs = m15.map((c) => c.high);
  const m15Lows = m15.map((c) => c.low);
  const m15PivotsHigh = findPivotsHigh(m15, 2, 2);
  const m15PivotsLow = findPivotsLow(m15, 2, 2);
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
    htfEma200State.direction === "BULL" &&
    htfEma200State.breakoutBull &&
    htfEma200State.confirmedBull;
  const m15TrendShortOk =
    htfEma200State.direction === "BEAR" &&
    htfEma200State.breakoutBear &&
    htfEma200State.confirmedBear;
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
  const ltfMacdState = resolveMacdState(ltfCloses);
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

  let scalpFib: ScalpFibData | undefined;
  let scalpConfirm: ScalpConfirm | undefined;
  if (riskMode === "ai-matic-olikella") {
    const direction =
      m15TrendLongOk ? "BULL" : m15TrendShortOk ? "BEAR" : "NONE";
    if (direction !== "NONE") {
      const m5 = resample(5);
      const m5Last = m5.length ? m5[m5.length - 1] : undefined;
      const m5Close = m5Last ? m5Last.close : Number.NaN;
      scalpFib =
        buildScalpFibData({
          m15Highs: m15PivotsHigh,
          m15Lows: m15PivotsLow,
          direction,
          m5Close,
          ltfClose,
          atr: atr14,
        }) ?? undefined;
      const m15Pois = m15.length
        ? (new CandlestickAnalyzer(
            toAnalyzerCandles(m15)
          ).getPointsOfInterest() as AiMaticPoi[])
        : [];
      const m5Pois = m5.length
        ? (new CandlestickAnalyzer(
            toAnalyzerCandles(m5)
          ).getPointsOfInterest() as AiMaticPoi[])
        : [];
      const profile = m15.length ? computeMarketProfile({ candles: m15 }) : null;
      const price = ltfClose;
      const pocNear =
        profile &&
        Number.isFinite(price) &&
        Number.isFinite(profile.poc) &&
        Math.abs(price - profile.poc) <= price * AI_MATIC_POI_DISTANCE_PCT;
      const lvnRejection = resolveLvnRejection(profile, ltfLast);
      const lvnOk =
        direction === "BULL" ? lvnRejection.bull : lvnRejection.bear;
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
    ltfOpenTime,
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
    ema200,
    ema200BreakoutBull: ema200BreakoutState.breakoutBull,
    ema200BreakoutBear: ema200BreakoutState.breakoutBear,
    ema200ConfirmBull: ema200BreakoutState.confirmedBull,
    ema200ConfirmBear: ema200BreakoutState.confirmedBear,
    atr14,
    atrPct,
    sep1,
    sep2,
    volumeCurrent,
    volumeP50,
    volumeP60,
    volumeP65,
    volumeP70,
    volumeTodBaseline: volumeTod.baselineVolume,
    volumeTodThreshold: volumeTod.thresholdVolume,
    volumeTodRatio: volumeTod.currentToBaselineRatio,
    volumeTodSampleCount: volumeTod.sampleCount,
    volumeTodSlotMinute: volumeTod.slotMinuteOfDay,
    volumeTodFallback: volumeTod.fallbackUsed,
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
    ltfMacdHist: ltfMacdState.macdHist,
    ltfMacdSignal: ltfMacdState.macdSignal,
    ltfRsiNeutral,
    ltfNoNewHigh,
    ltfNoNewLow,
    htfClose,
    htfEma200,
    htfBias,
    htfBreakoutBull: htfEma200State.breakoutBull,
    htfBreakoutBear: htfEma200State.breakoutBear,
    htfConfirmBull: htfEma200State.confirmedBull,
    htfConfirmBear: htfEma200State.confirmedBear,
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
    scalpFib,
    scalpConfirm,
  };
};

const computeScalpPrimaryChecklist = (core: CoreV2Metrics | undefined) => {
  const ltfOk = core?.ltfTimeframeMin === 1;
  const trendLongOk = Boolean(core?.m15TrendLongOk);
  const trendShortOk = Boolean(core?.m15TrendShortOk);
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

const resolveScalpFibStop = (
  entry: number,
  side: "Buy" | "Sell",
  fib: ScalpFibData | undefined,
  atr: number,
  structure?: number
) => {
  if (!fib || !Number.isFinite(entry) || entry <= 0) return Number.NaN;
  const hit = fib.hitLevel;
  if (!hit) return Number.NaN;
  const buffer =
    Number.isFinite(atr) && atr > 0 ? atr * SCALP_SL_ATR_BUFFER : 0;
  let stop = Number.NaN;
  if (hit === "38.2") {
    stop = fib.retrace["50"];
  } else if (hit === "50") {
    stop = fib.retrace["61.8"];
  } else if (hit === "61.8") {
    stop = side === "Buy" ? fib.swingLow : fib.swingHigh;
  }
  if (!Number.isFinite(stop) || stop <= 0) {
    stop = Number.isFinite(structure) ? structure : Number.NaN;
  }
  if (!Number.isFinite(stop) || stop <= 0) return Number.NaN;
  const buffered = side === "Buy" ? stop - buffer : stop + buffer;
  if (!Number.isFinite(buffered) || buffered <= 0) return Number.NaN;
  if (side === "Buy" && buffered >= entry) return Number.NaN;
  if (side === "Sell" && buffered <= entry) return Number.NaN;
  return buffered;
};

const resolveScalpFibTarget = (
  entry: number,
  side: "Buy" | "Sell",
  fib: ScalpFibData | undefined,
  core: CoreV2Metrics | undefined
) => {
  if (!fib || !Number.isFinite(entry) || entry <= 0) return Number.NaN;
  const trendOk = Boolean(core?.m15TrendLongOk || core?.m15TrendShortOk);
  const trendWeak =
    Boolean(core?.m15MacdWeak2) ||
    Boolean(core?.m15MacdWeak3) ||
    Boolean(core?.m15EmaCompression) ||
    Boolean(core?.m15WickIndecisionSoft) ||
    Boolean(core?.m15ImpulseWeak);
  const extLevel: ScalpFibExtLevel = trendWeak
    ? "61.8"
    : trendOk
      ? "161.8"
      : "100";
  const target = fib.ext[extLevel];
  if (!Number.isFinite(target) || target <= 0) return Number.NaN;
  if (side === "Buy" && target <= entry) return Number.NaN;
  if (side === "Sell" && target >= entry) return Number.NaN;
  return target;
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
type ProtectionOrderSnapshot = {
  hasActiveSL: boolean;
  hasActiveTP: boolean;
  sl: number;
  tp: number;
};

const TERMINAL_ORDER_STATUS_TOKENS = [
  "filled",
  "cancel",
  "reject",
  "deactivat",
  "expire",
];
const ACTIVE_EXCHANGE_ORDER_STATUS_KEYS = new Set([
  "new",
  "untriggered",
  "partiallyfilled",
]);
const PROTECTION_ORDER_FILTERS = new Set(["tpsl", "tpslorder"]);
const PROTECTION_STOP_TYPES = new Set([
  "takeprofit",
  "stoploss",
  "trailingstop",
]);

function normalizePositionSide(value: unknown): "Buy" | "Sell" {
  return String(value ?? "").toLowerCase() === "sell" ? "Sell" : "Buy";
}

function normalizeOrderStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeOrderStatusKey(value: unknown) {
  return normalizeOrderStatus(value).replace(/[^a-z]/g, "");
}

function isExchangeActiveOrderStatus(value: unknown) {
  const key = normalizeOrderStatusKey(value);
  if (!key) return false;
  return ACTIVE_EXCHANGE_ORDER_STATUS_KEYS.has(key);
}

function isOrderStatusActive(value: unknown) {
  const status = normalizeOrderStatus(value);
  if (!status) return true;
  return !TERMINAL_ORDER_STATUS_TOKENS.some((token) => status.includes(token));
}

function isActiveEntryOrderStatus(value: unknown) {
  return isExchangeActiveOrderStatus(value);
}

function isProtectionOrderLike(order: any): boolean {
  if (!order) return false;
  const reduceOnly = Boolean(order?.reduceOnly ?? order?.reduce_only ?? order?.reduce);
  const filter = String(order?.orderFilter ?? order?.order_filter ?? "")
    .trim()
    .toLowerCase();
  const stopType = String(order?.stopOrderType ?? order?.stop_order_type ?? "")
    .trim()
    .toLowerCase();
  if (PROTECTION_STOP_TYPES.has(stopType)) return true;
  if (PROTECTION_ORDER_FILTERS.has(filter)) return true;
  return reduceOnly;
}

function pickDirectionalProtectionPrice(
  prices: number[],
  entryPrice: number,
  direction: "below" | "above"
) {
  const finite = prices.filter((px) => Number.isFinite(px) && px > 0);
  if (finite.length === 0) return Number.NaN;
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return finite[finite.length - 1];
  }
  const directional = finite.filter((px) =>
    direction === "below" ? px < entryPrice : px > entryPrice
  );
  if (directional.length > 0) {
    let best = directional[0];
    for (const px of directional) {
      if (direction === "below" && px > best) best = px;
      if (direction === "above" && px < best) best = px;
    }
    return best;
  }
  let closest = finite[0];
  let closestDist = Math.abs(finite[0] - entryPrice);
  for (const px of finite.slice(1)) {
    const dist = Math.abs(px - entryPrice);
    if (dist < closestDist) {
      closest = px;
      closestDist = dist;
    }
  }
  return closest;
}

function resolveProtectionFromOrders(args: {
  orders: any[];
  symbol: string;
  positionSide: "Buy" | "Sell";
  entryPrice: number;
  positionIdx?: number;
}): ProtectionOrderSnapshot {
  const targetSymbol = String(args.symbol ?? "").toUpperCase();
  if (!targetSymbol || !Array.isArray(args.orders) || args.orders.length === 0) {
    return {
      hasActiveSL: false,
      hasActiveTP: false,
      sl: Number.NaN,
      tp: Number.NaN,
    };
  }
  const closeSide = args.positionSide === "Buy" ? "sell" : "buy";
  const expectedPositionIdx = toNumber(args.positionIdx);
  const hasExpectedPositionIdx = Number.isFinite(expectedPositionIdx);
  let hasActiveSL = false;
  let hasActiveTP = false;
  const slCandidates: number[] = [];
  const tpCandidates: number[] = [];

  for (const order of args.orders) {
    const symbol = String(order?.symbol ?? "").toUpperCase();
    if (!symbol || symbol !== targetSymbol) continue;
    if (!isProtectionOrderLike(order)) continue;
    const status =
      order?.orderStatus ?? order?.order_status ?? order?.status ?? "";
    if (!isExchangeActiveOrderStatus(status)) continue;
    const side = String(order?.side ?? "").toLowerCase();
    if (side === "buy" || side === "sell") {
      if (side !== closeSide) continue;
    }
    const orderPositionIdx = toNumber(order?.positionIdx ?? order?.position_idx);
    if (
      hasExpectedPositionIdx &&
      Number.isFinite(orderPositionIdx) &&
      orderPositionIdx !== expectedPositionIdx
    ) {
      continue;
    }
    const filter = String(order?.orderFilter ?? order?.order_filter ?? "")
      .trim()
      .toLowerCase();
    const stopType = String(order?.stopOrderType ?? order?.stop_order_type ?? "")
      .trim()
      .toLowerCase();
    const orderType = String(order?.orderType ?? order?.order_type ?? "")
      .trim()
      .toLowerCase();
    const triggerPrice = toNumber(order?.triggerPrice ?? order?.trigger_price);
    const orderPrice = toNumber(order?.price);
    const px =
      Number.isFinite(triggerPrice) && triggerPrice > 0
        ? triggerPrice
        : Number.isFinite(orderPrice) && orderPrice > 0
          ? orderPrice
          : Number.NaN;

    if (stopType === "stoploss" || stopType === "trailingstop") {
      hasActiveSL = true;
      if (Number.isFinite(px) && px > 0) slCandidates.push(px);
      continue;
    }
    if (stopType === "takeprofit") {
      hasActiveTP = true;
      if (Number.isFinite(px) && px > 0) tpCandidates.push(px);
      continue;
    }

    if (!Number.isFinite(px) || px <= 0) continue;
    const isLong = args.positionSide === "Buy";
    const canInferByEntry = Number.isFinite(args.entryPrice) && args.entryPrice > 0;
    if (canInferByEntry) {
      if (isLong) {
        if (px < args.entryPrice) {
          hasActiveSL = true;
          slCandidates.push(px);
        } else if (px > args.entryPrice) {
          hasActiveTP = true;
          tpCandidates.push(px);
        }
      } else if (px > args.entryPrice) {
        hasActiveSL = true;
        slCandidates.push(px);
      } else if (px < args.entryPrice) {
        hasActiveTP = true;
        tpCandidates.push(px);
      }
      continue;
    }

    if (orderType === "limit") {
      hasActiveTP = true;
      tpCandidates.push(px);
      continue;
    }
    if (
      filter === "stoporder" ||
      PROTECTION_ORDER_FILTERS.has(filter) ||
      orderType === "market"
    ) {
      hasActiveSL = true;
      slCandidates.push(px);
    }
  }

  const slDirection = args.positionSide === "Buy" ? "below" : "above";
  const tpDirection = args.positionSide === "Buy" ? "above" : "below";
  const sl = pickDirectionalProtectionPrice(slCandidates, args.entryPrice, slDirection);
  const tp = pickDirectionalProtectionPrice(tpCandidates, args.entryPrice, tpDirection);
  return {
    hasActiveSL: hasActiveSL || (Number.isFinite(sl) && sl > 0),
    hasActiveTP: hasActiveTP || (Number.isFinite(tp) && tp > 0),
    sl,
    tp,
  };
}

type AiMaticRetestFallbackState = {
  symbol: string;
  side: "Buy" | "Sell";
  signalId: string;
  createdAt: number;
  ltfTimeframeMin: number;
  lastLtfOpenTime: number;
  missedBars: number;
  fallbackBars: number;
  retestIntentId: string;
  fallbackQty: number;
  slPrice: number;
  tpPrices: number[];
  triggerPrice?: number;
  executing: boolean;
};

type AiMaticProgressState = {
  openedAtMs: number;
  entryRisk: number;
  bestFavorablePrice: number;
  beMoved: boolean;
  lastNoProgressExitAttempt: number;
};

type PortfolioRegimeState = {
  dominanceHistory: number[];
  lastSampleAt: number;
  snapshot: AltseasonRegimeSnapshot | null;
};

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

function resolveAiMaticAdaptiveRiskParams(args: {
  symbol: string;
  records: ClosedPnlRecord[] | null | undefined;
}): AiMaticAdaptiveRiskParams {
  const isMajor = MAJOR_SYMBOLS.has(args.symbol as Symbol);
  const base: AiMaticAdaptiveRiskParams = isMajor
    ? {
        hardCapPct: 0.017,
        hardCapAtrMult: 3.0,
        beMinR: AI_MATIC_BE_MIN_R,
        noProgressBars: AI_MATIC_NO_PROGRESS_BARS + 1,
        noProgressMfeAtr: AI_MATIC_NO_PROGRESS_MFE_ATR,
      }
    : {
        hardCapPct: 0.016,
        hardCapAtrMult: 2.8,
        beMinR: AI_MATIC_BE_MIN_R - 0.1,
        noProgressBars: Math.max(3, AI_MATIC_NO_PROGRESS_BARS - 1),
        noProgressMfeAtr: Math.max(0.55, AI_MATIC_NO_PROGRESS_MFE_ATR - 0.05),
      };
  if (!Array.isArray(args.records) || args.records.length === 0) {
    return base;
  }
  const recent = args.records
    .filter((r) => String(r.symbol ?? "") === args.symbol)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);
  if (!recent.length) return base;
  const wins = recent.filter((r) => r.pnl > 0).length;
  const winRate = wins / recent.length;
  const lossStreak = computeLossStreak(recent, 3);

  if (lossStreak >= 2 || (recent.length >= 8 && winRate < 0.45)) {
    return {
      hardCapPct: Math.max(0.012, base.hardCapPct * 0.85),
      hardCapAtrMult: Math.max(2.0, base.hardCapAtrMult - 0.4),
      beMinR: 0.8,
      noProgressBars: Math.max(3, base.noProgressBars - 1),
      noProgressMfeAtr: Math.max(0.55, base.noProgressMfeAtr - 0.1),
    };
  }
  if (recent.length >= 10 && winRate >= 0.6 && lossStreak === 0) {
    return {
      hardCapPct: Math.min(0.022, base.hardCapPct * 1.1),
      hardCapAtrMult: Math.min(3.6, base.hardCapAtrMult + 0.3),
      beMinR: 1.1,
      noProgressBars: Math.min(10, base.noProgressBars + 1),
      noProgressMfeAtr: Math.min(1.0, base.noProgressMfeAtr + 0.05),
    };
  }
  return base;
}

const MIN_PROTECTION_DISTANCE_PCT = 0.0005;
const MIN_PROTECTION_ATR_FACTOR = 0.05;
const TRAIL_ACTIVATION_R_MULTIPLIER = 0.5;
const TREE_TRAIL_PCT_MIN = 0.006;
const TREE_TRAIL_K_ATR = 1.2;
const TREE_TRAIL_MIN_TICKS = 5;
const FALLBACK_TICK_SIZE_BY_SYMBOL: Partial<Record<Symbol, number>> = {
  BTCUSDT: 0.1,
  ETHUSDT: 0.01,
  SOLUSDT: 0.001,
  ADAUSDT: 0.0001,
  XRPUSDT: 0.0001,
  SUIUSDT: 0.0001,
  DOGEUSDT: 0.00001,
  LINKUSDT: 0.001,
  ZILUSDT: 0.000001,
  AVAXUSDT: 0.001,
  HYPEUSDT: 0.0001,
  OPUSDT: 0.0001,
};

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

function resolveFallbackTickSize(symbol: Symbol) {
  const tick = FALLBACK_TICK_SIZE_BY_SYMBOL[symbol];
  return Number.isFinite(tick) && (tick as number) > 0 ? (tick as number) : 0;
}

function buildPositionWatermarkKey(
  symbol: string,
  side: string,
  positionIdx?: number
) {
  const idx = Number.isFinite(positionIdx) ? Math.round(positionIdx as number) : 0;
  return `${String(symbol ?? "").toUpperCase()}:${String(side ?? "").toUpperCase()}:${idx}`;
}

const TRAIL_PROFILE_BY_RISK_MODE: Record<
  AISettings["riskMode"],
  {
    activateR: number;
    lockR: number;
    retracementRate?: number;
    activateAtrMult?: number;
    lockAtrMult?: number;
  }
> = {
  "ai-matic": {
    activateR: 1.0,
    lockR: 0.6,
    retracementRate: AI_MATIC_TRAIL_RETRACE_PCT,
  },
  "ai-matic-x": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
  "ai-matic-amd": {
    activateR: 1.0,
    lockR: 0.6,
    retracementRate: AI_MATIC_TRAIL_RETRACE_PCT,
  },
  "ai-matic-olikella": { activateR: 0.6, lockR: 0.3 },
  "ai-matic-tree": {
    activateR: AI_MATIC_TRAIL_ACTIVATE_ATR_MULT,
    lockR: AI_MATIC_TRAIL_RETRACE_ATR_MULT,
    retracementRate: TREE_TRAIL_PCT_MIN,
    activateAtrMult: TREE_TRAIL_K_ATR,
    lockAtrMult: TREE_TRAIL_K_ATR,
  },
  "ai-matic-pro": { activateR: 0.6, lockR: 0.3, retracementRate: 0.004 },
};
const TRAIL_SYMBOL_MODE: Partial<Record<Symbol, "on" | "off">> = {
  SOLUSDT: "on",
  ADAUSDT: "on",
  BTCUSDT: "on",
  ETHUSDT: "on",
};
const PROFILE_BY_RISK_MODE: Record<AISettings["riskMode"], Profile> = {
  "ai-matic": "AI-MATIC",
  "ai-matic-x": "AI-MATIC-X",
  "ai-matic-amd": "AI-MATIC-AMD",
  "ai-matic-olikella": OLIKELLA_PROFILE_LABEL,
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
    const emaTrendPeriod = clampEmaTrendPeriod(
      settings.emaTrendPeriod,
      EMA_TREND_PERIOD
    );
    const baseConfig: Partial<BotConfig> = { emaTrendPeriod };
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
    if (settings.riskMode === "ai-matic-amd") {
      return {
        ...baseConfig,
        strategyProfile: "ai-matic-amd",
        baseTimeframe: "1h",
        signalTimeframe: "5m",
        aiMaticMultiTf: true,
        aiMaticHtfTimeframe: "1h",
        aiMaticMidTimeframe: "15m",
        aiMaticEntryTimeframe: "5m",
        aiMaticExecTimeframe: "1m",
        entryStrictness: strictness,
        cooldownBars: 0,
      };
    }
    if (settings.riskMode === "ai-matic-olikella") {
      const strictness =
        settings.entryStrictness === "base"
          ? "ultra"
          : settings.entryStrictness;
      return {
        ...baseConfig,
        strategyProfile: "ai-matic-olikella",
        baseTimeframe: "4h",
        signalTimeframe: "15m",
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
  }, [settings.emaTrendPeriod, settings.entryStrictness, settings.riskMode]);

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
  const leverageBySymbolRef = useRef<Map<string, number>>(new Map());
  const execSeenRef = useRef<Set<string>>(new Set());
  const pnlSeenRef = useRef<Set<string>>(new Set());
  const lastLossBySymbolRef = useRef<Map<string, number>>(new Map());
  const lastCloseBySymbolRef = useRef<Map<string, number>>(new Map());
  const lastIntentBySymbolRef = useRef<Map<string, number>>(new Map());
  const entryOrderLockRef = useRef<Map<string, number>>(new Map());
  const signalLogThrottleRef = useRef<Map<string, number>>(new Map());
  const skipLogThrottleRef = useRef<Map<string, number>>(new Map());
  const blockDecisionCooldownRef = useRef<
    Map<string, { fingerprint: string; expiresAt: number }>
  >(new Map());
  const entryBlockFingerprintRef = useRef<Map<string, string>>(new Map());
  const fastOkRef = useRef(false);
  const slowOkRef = useRef(false);
  const modeRef = useRef<TradingMode | undefined>(mode);
  const positionsRef = useRef<ActivePosition[]>([]);
  const positionSnapshotIdRef = useRef(0);
  const positionStateSignatureRef = useRef("");
  const limitSnapshotIdRef = useRef(0);
  const positionSyncRef = useRef({ lastEventAt: 0, lastReconcileAt: 0 });
  const lastAtomicSyncAtRef = useRef(0);
  const trailWatermarkRef = useRef<
    Map<string, { high: number; low: number; updatedAt: number }>
  >(new Map());
  const ordersRef = useRef<TestnetOrder[]>([]);
  const cancelingOrdersRef = useRef<Set<string>>(new Set());
  const autoCloseCooldownRef = useRef<Map<string, number>>(new Map());
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
  const portfolioRegimeRef = useRef<PortfolioRegimeState>({
    dominanceHistory: [],
    lastSampleAt: 0,
    snapshot: null,
  });
  const signalSeenRef = useRef<Set<string>>(new Set());
  const intentPendingRef = useRef<Set<string>>(new Set());
  const feedPauseRef = useRef<Set<string>>(new Set());
  const symbolOpenPositionPauseRef = useRef<Set<string>>(new Set());
  const relayPauseRef = useRef<RelayPauseState>({
    paused: false,
    pausedReason: null,
    pausedAt: 0,
    lastCapacityFingerprint: "",
    forceScanSymbols: new Set<string>(),
    forceScanReason: null,
    lastTtlRecheckAt: 0,
  });
  const trailingSyncRef = useRef<Map<string, number>>(new Map());
  const trailOffsetRef = useRef<Map<string, number>>(new Map());
  const aiMaticTp1Ref = useRef<
    Map<
      string,
      {
        entry: number;
        tp1: number;
        tp2: number;
        side: "Buy" | "Sell";
        setAt: number;
        partialFraction?: number;
      }
    >
  >(new Map());
  const aiMaticSwingStateRef = useRef<
    Map<string, { tfMin: 5 | 15; beMinR: number; cooldownUntil: number; setAt: number }>
  >(new Map());
  const aiMaticTrailCooldownRef = useRef<Map<string, number>>(new Map());
  const aiMaticRetestFallbackRef = useRef<Map<string, AiMaticRetestFallbackState>>(
    new Map()
  );
  const aiMaticProgressRef = useRef<Map<string, AiMaticProgressState>>(new Map());
  const aiMaticStructureLogRef = useRef<Map<string, number>>(new Map());
  const scalpExitStateRef = useRef<
    Map<string, { mode: "TRAIL" | "TP"; switched: boolean; decidedAt: number }>
  >(new Map());
  const scalpActionCooldownRef = useRef<Map<string, number>>(new Map());
  const scalpPartialCooldownRef = useRef<Map<string, number>>(new Map());
  const scalpTrailCooldownRef = useRef<Map<string, number>>(new Map());
  const oliExtensionCountRef = useRef<Map<string, number>>(new Map());
  const oliTrendLegRef = useRef<Map<string, string>>(new Map());
  const oliScaleInUsedRef = useRef<Map<string, boolean>>(new Map());
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
  const plannedProtectionRef = useRef<
    Map<string, { sl: number; setAt: number }>
  >(new Map());
  const protectionRetryAtRef = useRef<Map<string, number>>(new Map());
  const protectionRetryLogRef = useRef<Map<string, number>>(new Map());
  const [feedEpoch, setFeedEpoch] = useState(0);
  const symbolTickRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    limitSnapshotIdRef.current += 1;
    entryBlockFingerprintRef.current.clear();
  }, [settings.maxOpenOrders, settings.maxOpenPositions]);

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
    if (isProtectionOrderLike(order)) return false;
    const status =
      order?.status ?? order?.orderStatus ?? order?.order_status ?? "";
    return isOrderStatusActive(status);
  }, []);

  const isActiveEntryOrder = useCallback(
    (order: TestnetOrder | any): boolean => {
      if (!isEntryOrder(order)) return false;
      const status =
        order?.status ?? order?.orderStatus ?? order?.order_status ?? "";
      return isActiveEntryOrderStatus(status);
    },
    [isEntryOrder]
  );

  const getAtomicExposureSnapshot = useCallback((): AtomicExposureSnapshot => {
    const openPositionsTotal = positionsRef.current.reduce((sum, position) => {
      const size = toNumber(position?.size ?? position?.qty);
      return Number.isFinite(size) && size > 0 ? sum + 1 : sum;
    }, 0);
    const openOrdersTotal = Array.isArray(ordersRef.current)
      ? ordersRef.current.reduce(
          (sum, order) => sum + (isActiveEntryOrder(order) ? 1 : 0),
          0
        )
      : 0;
    const pendingIntentsTotal = intentPendingRef.current.size;
    const reservedPositionsTotal =
      openPositionsTotal + (useTestnet ? 0 : pendingIntentsTotal);
    const reservedOrdersTotal =
      openOrdersTotal + (useTestnet ? 0 : pendingIntentsTotal);
    const maxPos = normalizeCapacityLimit(
      toNumber(settingsRef.current.maxOpenPositions)
    );
    const maxOrders = normalizeCapacityLimit(
      toNumber(settingsRef.current.maxOpenOrders)
    );
    const status = getCapacityStatus({
      openPositionsTotal,
      maxPos,
      openOrdersTotal,
      maxOrders,
    });
    const reservedStatus = getCapacityStatus({
      openPositionsTotal: reservedPositionsTotal,
      maxPos,
      openOrdersTotal: reservedOrdersTotal,
      maxOrders,
    });
    return {
      openPositionsTotal,
      openOrdersTotal,
      pendingIntentsTotal,
      reservedPositionsTotal,
      reservedOrdersTotal,
      maxPos,
      maxOrders,
      status,
      reservedStatus,
      fingerprint: buildCapacityFingerprint({
        openPositionsTotal: reservedPositionsTotal,
        maxPos,
        openOrdersTotal: reservedOrdersTotal,
        maxOrders,
      }),
    };
  }, [isActiveEntryOrder, useTestnet]);

  const resolveDataHealthSnapshot = useCallback(
    (
      symbol: string,
      now = Date.now(),
      riskMode?: AISettings["riskMode"]
    ) => {
      const mode = riskMode ?? settingsRef.current.riskMode;
      const maxLagMs = resolveDataHealthLagMs(mode);
      const lastTick = symbolTickRef.current.get(symbol) ?? 0;
      const feedAgeMs = lastTick > 0 ? Math.max(0, now - lastTick) : null;
      const safe = feedAgeMs != null && feedAgeMs <= maxLagMs;
      return { feedAgeMs, maxLagMs, safe };
    },
    []
  );

  const dataHealthGate = useCallback(
    (
      symbol: string,
      now = Date.now(),
      riskMode?: AISettings["riskMode"]
    ): GateResult => {
      const health = resolveDataHealthSnapshot(symbol, now, riskMode);
      if (health.safe) {
        return { ok: true, code: "OK", reason: "data health" };
      }
      const diff = health.feedAgeMs == null ? "NO_TICK" : `${Math.round(health.feedAgeMs)}ms`;
      return {
        ok: false,
        code: "DATA_HEALTH",
        reason: `SKIP::DATA_HEALTH lastMarketTick ${diff} (max ${Math.round(health.maxLagMs)}ms)`,
        ttlMs: SKIP_LOG_THROTTLE_MS,
      };
    },
    [resolveDataHealthSnapshot]
  );

  const positionsWithoutActiveSl = useCallback(() => {
    const now = Date.now();
    const lastAtomicSyncAt = lastAtomicSyncAtRef.current;
    if (
      !Number.isFinite(lastAtomicSyncAt) ||
      lastAtomicSyncAt <= 0 ||
      now - lastAtomicSyncAt > PROTECTION_SYNC_STALE_MS
    ) {
      return [];
    }
    return positionsRef.current.filter((position) => {
      const size = toNumber(position?.size ?? position?.qty);
      if (!Number.isFinite(size) || size <= 0) return false;
      const sl = toNumber(position?.sl);
      if (Number.isFinite(sl) && sl > 0) return false;
      const symbol = String(position?.symbol ?? "").toUpperCase();
      if (!symbol) return false;
      const side = normalizePositionSide(position?.side);
      const entryPrice = toNumber(position?.entryPrice ?? position?.triggerPrice);
      const positionIdx = toNumber(position?.positionIdx);
      const exchangeProtection = resolveProtectionFromOrders({
        orders: ordersRef.current,
        symbol,
        positionSide: side,
        entryPrice,
        positionIdx: Number.isFinite(positionIdx) ? positionIdx : undefined,
      });
      if (exchangeProtection.hasActiveSL) return false;
      const planned = plannedProtectionRef.current.get(symbol);
      const plannedSl = toNumber(planned?.sl);
      const plannedAt = toNumber(planned?.setAt);
      if (
        Number.isFinite(plannedSl) &&
        plannedSl > 0 &&
        Number.isFinite(plannedAt) &&
        now - plannedAt <= PROTECTION_ATTACH_GRACE_MS
      ) {
        return false;
      }
      const openedAt = toEpoch(position?.openedAt ?? position?.timestamp);
      if (Number.isFinite(openedAt) && now - openedAt <= PROTECTION_ATTACH_GRACE_MS) {
        return false;
      }
      return true;
    });
  }, []);

  const protectionGate = useCallback((): GateResult => {
    const missing = positionsWithoutActiveSl();
    if (missing.length === 0) {
      return { ok: true, code: "OK", reason: "protection" };
    }
    const sample = missing
      .slice(0, 3)
      .map((position) => String(position.symbol ?? "").toUpperCase())
      .filter(Boolean)
      .join(",");
    const suffix = sample ? ` (${sample})` : "";
    return {
      ok: false,
      code: "PROTECTION_INACTIVE",
      reason: `SKIP::PROTECTION_INACTIVE missing SL ${missing.length}${suffix}`,
      ttlMs: SKIP_LOG_THROTTLE_MS,
    };
  }, [positionsWithoutActiveSl]);

  const resolveProtectionRetryStop = useCallback((position: ActivePosition) => {
    const symbol = String(position.symbol ?? "").toUpperCase();
    const planned = plannedProtectionRef.current.get(symbol);
    const plannedSl = toNumber(planned?.sl);
    if (Number.isFinite(plannedSl) && plannedSl > 0) {
      return plannedSl;
    }
    const entry = toNumber(position.entryPrice);
    if (!Number.isFinite(entry) || entry <= 0) {
      return Number.NaN;
    }
    const side = String(position.side ?? "").toLowerCase() === "sell" ? "Sell" : "Buy";
    const atr = toNumber(
      (decisionRef.current[symbol]?.decision as any)?.coreV2?.atr14
    );
    const minDistance = resolveMinProtectionDistance(entry, atr);
    const fallbackSl = side === "Buy" ? entry - minDistance : entry + minDistance;
    return Number.isFinite(fallbackSl) && fallbackSl > 0
      ? fallbackSl
      : Number.NaN;
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

  const resolvePortfolioRegime = useCallback(
    (now = Date.now()): AltseasonRegimeSnapshot => {
      const state = portfolioRegimeRef.current;
      const btcDecision = decisionRef.current["BTCUSDT"]?.decision;
      const btcCore = (btcDecision as any)?.coreV2 as CoreV2Metrics | undefined;
      const btcAtrPct = toNumber(btcCore?.atrPct);
      const btcAdx = toNumber((btcDecision as any)?.trendAdx);
      const btcTrendRaw = String(
        (btcDecision as any)?.trend ?? btcCore?.htfBias ?? "none"
      ).toLowerCase();
      const altAtrPcts = activeSymbols
        .filter((s) => s !== "BTCUSDT")
        .map((s) =>
          toNumber(
            ((decisionRef.current[s]?.decision as any)?.coreV2 as
              | CoreV2Metrics
              | undefined)?.atrPct
          )
        )
        .filter((value): value is number => Number.isFinite(value) && value > 0);
      const altAtrMean =
        altAtrPcts.length > 0
          ? altAtrPcts.reduce((sum, value) => sum + value, 0) / altAtrPcts.length
          : Number.NaN;

      if (
        now - state.lastSampleAt >= ALTSEASON_SAMPLE_MS &&
        Number.isFinite(btcAtrPct) &&
        btcAtrPct > 0 &&
        Number.isFinite(altAtrMean) &&
        altAtrMean > 0
      ) {
        const dominanceProxy = btcAtrPct / altAtrMean;
        if (Number.isFinite(dominanceProxy) && dominanceProxy > 0) {
          state.dominanceHistory.push(dominanceProxy);
          if (state.dominanceHistory.length > ALTSEASON_HISTORY_POINTS) {
            state.dominanceHistory = state.dominanceHistory.slice(
              -ALTSEASON_HISTORY_POINTS
            );
          }
        }
        state.lastSampleAt = now;
      }

      const snapshot = evaluateAltseasonRegime({
        btcTrend: btcTrendRaw,
        btcAdx,
        btcAtrPct,
        altAtrPcts,
        dominanceHistory: state.dominanceHistory,
        dominanceDropThreshold: ALTSEASON_DOMINANCE_DROP_THRESHOLD,
        altAtrExpansionRatio: ALTSEASON_ALT_ATR_EXPANSION_RATIO,
      });
      state.snapshot = snapshot;
      return snapshot;
    },
    [activeSymbols]
  );

  const resolvePortfolioRiskScale = useCallback(
    (symbol: Symbol, side: "Buy" | "Sell", now = Date.now()) => {
      const targetSide = side === "Buy" ? "bull" : "bear";
      const exposures: PortfolioExposure[] = [];
      const selected = new Set(activeSymbols);
      positionsRef.current.forEach((position) => {
        const symbolUpper = String(position.symbol ?? "").toUpperCase();
        if (!selected.has(symbolUpper as Symbol)) return;
        const size = toNumber(position.size ?? position.qty);
        if (!Number.isFinite(size) || size <= 0) return;
        const bias = normalizeBias(position.side);
        if (!bias) return;
        exposures.push({ symbol: symbolUpper, side: bias });
      });
      ordersRef.current.forEach((order) => {
        const symbolUpper = String(order?.symbol ?? "").toUpperCase();
        if (!selected.has(symbolUpper as Symbol)) return;
        if (!isEntryOrder(order)) return;
        const bias = normalizeBias(order.side);
        if (!bias) return;
        exposures.push({ symbol: symbolUpper, side: bias });
      });
      Object.entries(decisionRef.current).forEach(([otherSymbol, payload]) => {
        const symbolUpper = String(otherSymbol ?? "").toUpperCase();
        if (!selected.has(symbolUpper as Symbol)) return;
        const signal = payload?.decision?.signal;
        const sideRaw = String(signal?.intent?.side ?? "").toLowerCase();
        const bias =
          sideRaw === "buy" ? "bull" : sideRaw === "sell" ? "bear" : null;
        if (!bias) return;
        exposures.push({ symbol: symbolUpper, side: bias });
      });

      const regime = resolvePortfolioRegime(now);
      const skipSymbols =
        regime.active && symbol !== "BTCUSDT" ? ["BTCUSDT"] : undefined;
      const scaled = computeCorrelatedExposureScale({
        targetSymbol: symbol,
        targetSide,
        exposures,
        minCorrelation: CORRELATION_RISK_THRESHOLD,
        minScale: CORRELATION_RISK_MIN_SCALE,
        skipSymbols,
      });
      return { ...scaled, altseasonActive: regime.active };
    },
    [activeSymbols, isEntryOrder, normalizeBias, resolvePortfolioRegime]
  );

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

  const resolveSymbolLeverage = useCallback((symbol: Symbol) => {
    const cached = leverageBySymbolRef.current.get(symbol);
    if (Number.isFinite(cached) && (cached as number) > 0) {
      return cached as number;
    }
    return MAINNET_FALLBACK_LEVERAGE;
  }, []);

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

      if (!useTestnet) {
        const perTradeMainnetUsd = clampPerTradeUsd(
          settings.perTradeMainnetUsd,
          DEFAULT_MAINNET_PER_TRADE_USD
        );
        const leverage = resolveSymbolLeverage(symbol);
        const minNotionalByIm = perTradeMainnetUsd * leverage;
        if (
          Number.isFinite(minNotionalByIm) &&
          minNotionalByIm > 0 &&
          Number.isFinite(notional) &&
          notional < minNotionalByIm
        ) {
          notional = minNotionalByIm;
          qty = notional / entry;
        }
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
    [getEquityValue, resolveSymbolLeverage, useTestnet]
  );

  const computeFixedSizing = useCallback(
    (symbol: Symbol, entry: number, sl: number) => {
      if (!useTestnet) return null;
      if (!Number.isFinite(entry) || entry <= 0) {
        return { ok: false as const, reason: "invalid_entry" as const };
      }
      const settings = settingsRef.current;
      const perTradeTestnetUsd = clampPerTradeUsd(
        settings.perTradeTestnetUsd,
        DEFAULT_TESTNET_PER_TRADE_USD
      );
      const leverage = resolveSymbolLeverage(symbol);
      const targetNotional = Math.min(
        Math.max(
          perTradeTestnetUsd *
            (Number.isFinite(leverage) && leverage > 0 ? leverage : 1),
          MIN_POSITION_NOTIONAL_USD
        ),
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
    [getEquityValue, resolveSymbolLeverage, useTestnet]
  );

  const computeTrailingPlan = useCallback(
    (
      entry: number,
      sl: number,
      side: "Buy" | "Sell",
      symbol: Symbol,
      atr?: number,
      marketPrice?: number
    ) => {
      const settings = settingsRef.current;
      const isScalpProfile = settings.riskMode === "ai-matic-olikella";
      if (isScalpProfile) {
        return null;
      }
      const symbolMode = TRAIL_SYMBOL_MODE[symbol];
      const forceTrail =
        settings.riskMode === "ai-matic" ||
        settings.riskMode === "ai-matic-amd" ||
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
      const profile =
        TRAIL_PROFILE_BY_RISK_MODE[settings.riskMode] ??
        TRAIL_PROFILE_BY_RISK_MODE["ai-matic"];
      const activateR = profile.activateR;
      const lockR = profile.lockR;
      const overrideRate = trailOffsetRef.current.get(symbol);
      const isAiMaticCoreProfile = settings.riskMode === "ai-matic";
      const isAmdProfile = settings.riskMode === "ai-matic-amd";
      const isTreeProfile = settings.riskMode === "ai-matic-tree";
      const usePercentActivation =
        isScalpProfile ||
        isAiMaticCoreProfile ||
        isAmdProfile ||
        (isTreeProfile &&
          Number.isFinite(overrideRate) &&
          (overrideRate as number) > 0);
      const effectiveRate =
        Number.isFinite(overrideRate) && overrideRate > 0
          ? overrideRate
          : profile.retracementRate;
      const minDistance = resolveMinProtectionDistance(entry, atr);
      const atrValue =
        Number.isFinite(atr) && (atr as number) > 0 ? (atr as number) : Number.NaN;
      const treeTickSize = resolveFallbackTickSize(symbol);
      const treeTickDistance =
        treeTickSize > 0 ? treeTickSize * TREE_TRAIL_MIN_TICKS : Number.NaN;
      const distanceBasePrice =
        Number.isFinite(marketPrice) && (marketPrice as number) > 0
          ? (marketPrice as number)
          : entry;
      const treePctDistance = distanceBasePrice * TREE_TRAIL_PCT_MIN;
      const treeAtrDistance =
        Number.isFinite(atrValue) && atrValue > 0 ? atrValue * TREE_TRAIL_K_ATR : Number.NaN;
      const rawDistance = isTreeProfile
        ? maxFinite(treePctDistance, treeAtrDistance, treeTickDistance)
        : Number.isFinite(effectiveRate)
          ? entry * (effectiveRate as number)
          : Math.abs(activateR - lockR) * r;
      const distance = Math.max(rawDistance, minDistance);
      if (!Number.isFinite(distance) || distance <= 0) return null;
      const dir = side === "Buy" ? 1 : -1;
      const aiMaticActivationMove = Math.max(
        entry * AI_MATIC_TRAIL_ACTIVATE_PCT,
        minDistance
      );
      const treeActivationMove = Math.max(treePctDistance, minDistance);
      const activePrice = isAiMaticCoreProfile
        ? entry + dir * aiMaticActivationMove
        : isTreeProfile
          ? entry + dir * treeActivationMove
          : usePercentActivation
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
      for (const [symbol, state] of aiMaticSwingStateRef.current.entries()) {
        const hasPosition = seenSymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasOrder = ordersRef.current.some(
          (order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol
        );
        const cooldownUntil = toNumber(state?.cooldownUntil);
        const cooldownExpired =
          !Number.isFinite(cooldownUntil) || cooldownUntil <= now;
        if (!hasPosition && !hasOrder && !hasPending && cooldownExpired) {
          aiMaticSwingStateRef.current.delete(symbol);
        }
      }
      for (const [symbol, state] of aiMaticRetestFallbackRef.current.entries()) {
        const hasPosition = seenSymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasRetestOrder = ordersRef.current.some(
          (order) =>
            isEntryOrder(order) &&
            String(order?.symbol ?? "") === symbol &&
            String(order?.orderLinkId ?? "") === state.retestIntentId
        );
        if (!hasPosition && !hasRetestOrder && !hasPending) {
          aiMaticRetestFallbackRef.current.delete(symbol);
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
      for (const symbol of plannedProtectionRef.current.keys()) {
        const hasPosition = seenSymbols.has(symbol);
        const hasPending = intentPendingRef.current.has(symbol);
        const hasOrder = ordersRef.current.some(
          (order) => isEntryOrder(order) && String(order?.symbol ?? "") === symbol
        );
        if (!hasPosition && !hasOrder && !hasPending) {
          plannedProtectionRef.current.delete(symbol);
          protectionRetryAtRef.current.delete(symbol);
          protectionRetryLogRef.current.delete(symbol);
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
          oliExtensionCountRef.current.delete(symbol);
          oliTrendLegRef.current.delete(symbol);
          oliScaleInUsedRef.current.delete(symbol);
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
      for (const key of aiMaticProgressRef.current.keys()) {
        if (!activePositionKeys.has(key)) {
          aiMaticProgressRef.current.delete(key);
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
        const isScalpProfile = settings.riskMode === "ai-matic-olikella";
        const isProProfile = settings.riskMode === "ai-matic-pro";
        const isAiMaticProfile = settings.riskMode === "ai-matic";
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
        const price = toNumber(pos.markPrice);
        let aiMaticProgress: AiMaticProgressState | null = null;
        let aiMaticMfe = Number.NaN;
        if (
          isAiMaticProfile &&
          positionKey &&
          Number.isFinite(price) &&
          price > 0
        ) {
          const openedAtMsRaw = toEpoch(pos.openedAt);
          const openedAtMs = Number.isFinite(openedAtMsRaw) ? openedAtMsRaw : now;
          const entryRiskSeed = Math.abs(entry - sl);
          aiMaticProgress = aiMaticProgressRef.current.get(positionKey) ?? {
            openedAtMs,
            entryRisk: Number.isFinite(entryRiskSeed) ? entryRiskSeed : Number.NaN,
            bestFavorablePrice: price,
            beMoved: false,
            lastNoProgressExitAttempt: 0,
          };
          if (
            (!Number.isFinite(aiMaticProgress.entryRisk) || aiMaticProgress.entryRisk <= 0) &&
            Number.isFinite(entryRiskSeed) &&
            entryRiskSeed > 0
          ) {
            aiMaticProgress.entryRisk = entryRiskSeed;
          }
          if (
            !Number.isFinite(aiMaticProgress.bestFavorablePrice) ||
            aiMaticProgress.bestFavorablePrice <= 0
          ) {
            aiMaticProgress.bestFavorablePrice = price;
          }
          aiMaticProgress.bestFavorablePrice =
            side === "Buy"
              ? Math.max(aiMaticProgress.bestFavorablePrice, price)
              : Math.min(aiMaticProgress.bestFavorablePrice, price);
          aiMaticMfe =
            side === "Buy"
              ? aiMaticProgress.bestFavorablePrice - entry
              : entry - aiMaticProgress.bestFavorablePrice;
          if (!aiMaticProgress.beMoved) {
            const minDistance = resolveMinProtectionDistance(entry);
            const beSl =
              side === "Buy" ? entry - minDistance : entry + minDistance;
            const alreadyAtBeOrBetter =
              side === "Buy" ? sl >= beSl : sl <= beSl;
            if (alreadyAtBeOrBetter) {
              aiMaticProgress.beMoved = true;
            }
          }
          aiMaticProgressRef.current.set(positionKey, aiMaticProgress);
        }
        if (
          isAiMaticProfile &&
          aiMaticProgress &&
          Number.isFinite(price) &&
          price > 0
        ) {
          const adaptiveRisk = resolveAiMaticAdaptiveRiskParams({
            symbol,
            records: closedPnlRecords,
          });
          const swingState = aiMaticSwingStateRef.current.get(symbol);
          const beMinR = Number.isFinite(swingState?.beMinR)
            ? Math.min(adaptiveRisk.beMinR, swingState!.beMinR)
            : adaptiveRisk.beMinR;
          const core = (decisionRef.current[symbol]?.decision as any)?.coreV2 as
            | CoreV2Metrics
            | undefined;
          const atr = toNumber(core?.atr14);
          const ltfMinRaw = toNumber(core?.ltfTimeframeMin);
          const ltfMin =
            Number.isFinite(ltfMinRaw) && ltfMinRaw > 0
              ? Math.max(1, Math.round(ltfMinRaw))
              : 5;
          const noProgressWindowMs =
            adaptiveRisk.noProgressBars * ltfMin * 60_000;
          const elapsedMs = Math.max(0, now - aiMaticProgress.openedAtMs);
          const noProgress =
            elapsedMs >= noProgressWindowMs &&
            Number.isFinite(atr) &&
            atr > 0 &&
            Number.isFinite(aiMaticMfe) &&
            aiMaticMfe < adaptiveRisk.noProgressMfeAtr * atr;
          const sizeRaw = Math.abs(toNumber(pos.size ?? pos.qty));
          if (
            noProgress &&
            Number.isFinite(sizeRaw) &&
            sizeRaw > 0 &&
            now - aiMaticProgress.lastNoProgressExitAttempt >=
              AI_MATIC_NO_PROGRESS_EXIT_COOLDOWN_MS
          ) {
            aiMaticProgress.lastNoProgressExitAttempt = now;
            aiMaticProgressRef.current.set(positionKey, aiMaticProgress);
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
                  id: `ai-matic:no-progress:${symbol}:${now}`,
                  timestamp: new Date(now).toISOString(),
                  action: "STATUS",
                  message: `${symbol} AI-MATIC no-progress exit (${adaptiveRisk.noProgressBars} bars, MFE < ${formatNumber(
                    adaptiveRisk.noProgressMfeAtr,
                    2
                  )} ATR)`,
                },
              ]);
            } catch (err) {
              addLogEntries([
                {
                  id: `ai-matic:no-progress:error:${symbol}:${now}`,
                  timestamp: new Date(now).toISOString(),
                  action: "ERROR",
                  message: `${symbol} AI-MATIC no-progress exit failed: ${asErrorMessage(err)}`,
                },
              ]);
            }
            continue;
          }
          const mfeR =
            Number.isFinite(aiMaticProgress.entryRisk) &&
            aiMaticProgress.entryRisk > 0 &&
            Number.isFinite(aiMaticMfe)
              ? aiMaticMfe / aiMaticProgress.entryRisk
              : Number.NaN;
          if (
            !aiMaticProgress.beMoved &&
            Number.isFinite(mfeR) &&
            mfeR >= beMinR
          ) {
            const minDistance = resolveMinProtectionDistance(entry, atr);
            const beSl =
              side === "Buy" ? entry - minDistance : entry + minDistance;
            const shouldMove =
              side === "Buy" ? sl < beSl : sl > beSl;
            if (shouldMove) {
              try {
                await postJson("/protection", {
                  symbol,
                  sl: beSl,
                  positionIdx: Number.isFinite(pos.positionIdx)
                    ? pos.positionIdx
                    : undefined,
                });
                aiMaticProgress.beMoved = true;
                aiMaticProgressRef.current.set(positionKey, aiMaticProgress);
                addLogEntries([
                  {
                    id: `ai-matic:be:${symbol}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                    message: `${symbol} AI-MATIC BE move @ ${formatNumber(mfeR, 2)}R`,
                  },
                ]);
              } catch (err) {
                addLogEntries([
                  {
                    id: `ai-matic:be:error:${symbol}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "ERROR",
                    message: `${symbol} AI-MATIC BE move failed: ${asErrorMessage(err)}`,
                  },
                ]);
              }
            } else {
              aiMaticProgress.beMoved = true;
              aiMaticProgressRef.current.set(positionKey, aiMaticProgress);
            }
          }
        }
        if (isProProfile && positionKey) {
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
        if (isAiMaticProfile && positionKey) {
          const partialState = partialExitRef.current.get(positionKey);
          const lastAttempt = partialState?.lastAttempt ?? 0;
          const tpState = aiMaticTp1Ref.current.get(symbol);
          const price = toNumber(pos.markPrice);
          const tp1 = tpState?.tp1;
          const tp1FractionRaw = toNumber(tpState?.partialFraction);
          const tp1Fraction =
            Number.isFinite(tp1FractionRaw) &&
            tp1FractionRaw >= 0.2 &&
            tp1FractionRaw <= 0.8
              ? tp1FractionRaw
              : AI_MATIC_TP1_PARTIAL_FRACTION;
          const sizeRaw = Math.abs(toNumber(pos.size ?? pos.qty));
          const tp1Hit =
            Number.isFinite(tp1) &&
            Number.isFinite(price) &&
            (side === "Buy" ? price >= (tp1 as number) : price <= (tp1 as number));
          if (
            tp1Hit &&
            (!partialState || !partialState.taken) &&
            now - lastAttempt >= NONSCALP_PARTIAL_COOLDOWN_MS &&
            Number.isFinite(sizeRaw) &&
            sizeRaw > 0
          ) {
            partialExitRef.current.set(positionKey, {
              taken: false,
              lastAttempt: now,
            });
            const reduceQty = Math.min(sizeRaw, sizeRaw * tp1Fraction);
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
                  id: `partial:ai-matic:${symbol}:${now}`,
                  timestamp: new Date(now).toISOString(),
                  action: "STATUS",
                  message: `${symbol} AI-MATIC TP1 partial ${Math.round(
                    tp1Fraction * 100
                  )}% + BE`,
                },
              ]);
            } catch (err) {
              addLogEntries([
                {
                  id: `partial:ai-matic:error:${symbol}:${now}`,
                  timestamp: new Date(now).toISOString(),
                  action: "ERROR",
                  message: `${symbol} AI-MATIC TP1 partial failed: ${asErrorMessage(err)}`,
                },
              ]);
            }
          }
        }
        if (!isScalpProfile && !isProProfile && !isAiMaticProfile && positionKey) {
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
          const isTreeProfile = settingsRef.current.riskMode === "ai-matic-tree";
          const price = toNumber(pos.markPrice);
          if (isTreeProfile && Number.isFinite(price) && price > 0) {
            const decisionAtr = toNumber(
              (decisionRef.current[symbol]?.decision as any)?.coreV2?.atr14
            );
            const adaptivePlan = computeTrailingPlan(
              entry,
              sl,
              side,
              symbol as Symbol,
              decisionAtr,
              price
            );
            const canWidenTrail =
              adaptivePlan &&
              Number.isFinite(adaptivePlan.trailingStop) &&
              adaptivePlan.trailingStop > (currentTrail as number) * 1.02;
            const lastAttempt = trailingSyncRef.current.get(symbol);
            if (
              canWidenTrail &&
              (!lastAttempt || now - lastAttempt >= TS_VERIFY_INTERVAL_MS)
            ) {
              trailingSyncRef.current.set(symbol, now);
              try {
                await postJson("/protection", {
                  symbol,
                  trailingStop: adaptivePlan.trailingStop,
                  trailingActivePrice: adaptivePlan.trailingActivePrice,
                  positionIdx: Number.isFinite(pos.positionIdx)
                    ? pos.positionIdx
                    : 0,
                });
                addLogEntries([
                  {
                    id: `trail:widen:${symbol}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "STATUS",
                    message: `${symbol} TREE trailing widen ${formatNumber(
                      currentTrail,
                      6
                    )} -> ${formatNumber(adaptivePlan.trailingStop, 6)}`,
                  },
                ]);
              } catch (err) {
                addLogEntries([
                  {
                    id: `trail:widen:error:${symbol}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: "ERROR",
                    message: `${symbol} TREE trail widen failed: ${asErrorMessage(err)}`,
                  },
                ]);
              }
            }
          }
          continue;
        }
        const decisionAtr = toNumber(
          (decisionRef.current[symbol]?.decision as any)?.coreV2?.atr14
        );
        const plan = computeTrailingPlan(
          entry,
          sl,
          side,
          symbol as Symbol,
          decisionAtr,
          toNumber(pos.markPrice)
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
      const exposure = getAtomicExposureSnapshot();
      const openPositionsCount = exposure.reservedPositionsTotal;
      const maxPositionsOk = exposure.maxPos > 0
        ? openPositionsCount < exposure.maxPos
        : false;
      const hasPosition = positionsRef.current.some((p) => {
        if (p.symbol !== symbol) return false;
        const size = toNumber(p.size ?? p.qty);
        return Number.isFinite(size) && size > 0;
      });
      const openOrdersCount = exposure.reservedOrdersTotal;
      const ordersClearOk = exposure.maxOrders > 0
        ? openOrdersCount < exposure.maxOrders
        : false;
      const engineOk = !(decision?.halted ?? false);
      return {
        settings,
        now,
        sessionOk,
        maxPositionsOk,
        maxPositions: exposure.maxPos,
        maxOrders: exposure.maxOrders,
        openPositionsCount,
        hasPosition,
        openOrdersCount,
        ordersClearOk,
        engineOk,
        capacityStateFingerprint: exposure.fingerprint,
      };
    },
    [getAtomicExposureSnapshot, isSessionAllowed]
  );

  const shouldEmitBlockLog = useCallback(
    (
      symbol: string,
      code: string,
      fingerprint: string,
      ttlMs: number,
      now: number
    ) => {
      const key = `${symbol}:${code}`;
      const cache = blockDecisionCooldownRef.current;
      const prev = cache.get(key);
      if (
        prev &&
        prev.fingerprint === fingerprint &&
        prev.expiresAt > now
      ) {
        return false;
      }
      cache.set(key, { fingerprint, expiresAt: now + ttlMs });
      return true;
    },
    []
  );

  const queueCapacityRecheck = useCallback(
    (trigger: CapacityPauseTrigger) => {
      const relay = relayPauseRef.current;
      if (!relay.paused) return false;
      const exposure = getAtomicExposureSnapshot();
      const currentStatus = exposure.reservedStatus;
      const currentFingerprint = exposure.fingerprint;
      if (trigger !== "TTL_RECHECK") {
        if (currentFingerprint === relay.lastCapacityFingerprint) return false;
        if (currentStatus.reason !== "OK") return false;
      }
      const symbols = activeSymbols.filter((symbol) => Boolean(symbol));
      if (!symbols.length) return false;
      let added = false;
      for (const symbol of symbols) {
        if (relay.forceScanSymbols.has(symbol)) continue;
        relay.forceScanSymbols.add(symbol);
        added = true;
      }
      if (!added && relay.forceScanReason === trigger) {
        return false;
      }
      relay.forceScanReason = trigger;
      if (trigger === "TTL_RECHECK") {
        relay.lastTtlRecheckAt = Date.now();
      }
      const now = Date.now();
      addLogEntries([
        {
          id: `signal-relay:recheck:${trigger}:${now}`,
          timestamp: new Date(now).toISOString(),
          action: "STATUS",
          message: `SIGNAL_RELAY_RECHECK ${trigger} | reason ${relay.pausedReason ?? "UNKNOWN"} | fp ${currentFingerprint}`,
        },
      ]);
      return true;
    },
    [activeSymbols, addLogEntries, getAtomicExposureSnapshot]
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
        const emaTrend = (decision as any)?.emaTrend as
          | EmaTrendResult
          | undefined;
        const frame = Array.isArray(emaTrend?.byTimeframe)
          ? emaTrend?.byTimeframe.find((entry) => Number(entry?.timeframeMin) === 5)
          : undefined;
        const dir = String(frame?.direction ?? "none").toUpperCase();
        const detail = `EMA200 5m ${dir} | breakout ${frame?.breakout ? "yes" : "no"} | confirm ${frame?.confirmed ? "yes" : "no"}`;
        if (!signal) return { ok: true, detail };
        const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
        const signalDir =
          sideRaw === "buy" ? "BULL" : sideRaw === "sell" ? "BEAR" : "";
        const ok =
          Boolean(signalDir) &&
          dir === signalDir &&
          Boolean(frame?.breakout) &&
          Boolean(frame?.confirmed);
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
      const mode: "FOLLOW" | "REVERSE" = "FOLLOW";
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
          breakout: Boolean(entry?.breakout),
        };
      });
      const emaDetailParts = emaByTf.map((entry) => {
        const label = trendLabel(entry.direction);
        const touchFlag = entry.touched ? (entry.confirmed ? "B" : "!") : "";
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
        detailParts.push(`EMA200 ${emaDetailParts.join(" · ")}`);
      }
      if (emaByTf.some((entry) => entry.touched && !entry.confirmed)) {
        detailParts.push("EMA200 breakout unconfirmed");
      }
      if (!isAiMaticProfile) {
        detailParts.push(`mode ${mode}`);
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
      const emaBreakoutOk =
        emaByTf.length > 0 && emaByTf.every((entry) => entry.breakout);
      const emaConfirmOk =
        emaByTf.length > 0 && emaByTf.every((entry) => entry.confirmed);
      if (!htfIsTrend) {
        return { ok: false, detail };
      }
      if (hasLtf && !ltfIsTrend) {
        return { ok: false, detail };
      }
      if (!emaAligned || !emaBreakoutOk || !emaConfirmOk) {
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
      const percentileVolumeThreshold =
        core == null
          ? Number.NaN
          : volumePct === 50
            ? core.volumeP50
            : volumePct === 60
              ? core.volumeP60
              : volumePct === 65
                ? core.volumeP65
                : core.volumeP70;
      const todVolumeThreshold = Number.isFinite(core?.volumeTodThreshold)
        ? core!.volumeTodThreshold
        : Number.NaN;
      const useTodVolumeGate = Number.isFinite(todVolumeThreshold);
      const volumeThreshold = useTodVolumeGate
        ? todVolumeThreshold
        : percentileVolumeThreshold;
      const htfBreakoutOk =
        direction === "BULL"
          ? Boolean(core?.htfBreakoutBull)
          : direction === "BEAR"
            ? Boolean(core?.htfBreakoutBear)
            : false;
      const htfConfirmOk =
        direction === "BULL"
          ? Boolean(core?.htfConfirmBull)
          : direction === "BEAR"
            ? Boolean(core?.htfConfirmBear)
            : false;
      const htfBiasOk =
        direction !== "NONE" &&
        htfDir === direction &&
        htfBreakoutOk &&
        htfConfirmOk;
      const emaBreakoutOk =
        direction === "BULL"
          ? Boolean(core?.ema200BreakoutBull)
          : direction === "BEAR"
            ? Boolean(core?.ema200BreakoutBear)
            : false;
      const emaConfirmOk =
        direction === "BULL"
          ? Boolean(core?.ema200ConfirmBull)
          : direction === "BEAR"
            ? Boolean(core?.ema200ConfirmBear)
            : false;
      const emaOrderOk =
        direction === "BULL"
          ? Number.isFinite(core?.ltfClose) &&
            Number.isFinite(core?.ema200) &&
            core!.ltfClose > core!.ema200 &&
            emaBreakoutOk &&
            emaConfirmOk
          : direction === "BEAR"
            ? Number.isFinite(core?.ltfClose) &&
              Number.isFinite(core?.ema200) &&
              core!.ltfClose < core!.ema200 &&
              emaBreakoutOk &&
              emaConfirmOk
            : false;
      const atrOk =
        Number.isFinite(core?.atrPct) && core!.atrPct >= atrMin;
      const volumeOk =
        Number.isFinite(core?.volumeCurrent) &&
        Number.isFinite(volumeThreshold) &&
        core!.volumeCurrent >= volumeThreshold;
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
              ? Number.isFinite(core?.htfEma200)
                ? `EMA200 ${formatNumber(core!.htfEma200, 3)} | breakout ${htfBreakoutOk ? "yes" : "no"} | confirm ${htfConfirmOk ? "yes" : "no"}`
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
          name: "EMA200 trend",
          ok: emaOrderOk,
          detail: Number.isFinite(core?.ltfClose)
            ? `close ${formatNumber(core!.ltfClose, 4)} | EMA200 ${formatNumber(
                core!.ema200,
                4
              )} | breakout ${emaBreakoutOk ? "yes" : "no"} | confirm ${emaConfirmOk ? "yes" : "no"}`
            : "missing",
          hard: true,
        },
        {
          name: "EMA200 breakout",
          ok: emaBreakoutOk,
          detail: emaBreakoutOk ? "breakout detected" : "missing breakout",
          hard: true,
        },
        {
          name: "EMA200 confirm",
          ok: emaConfirmOk,
          detail: emaConfirmOk ? "confirmation ok" : "confirmation missing",
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
              ? useTodVolumeGate
                ? `vol ${formatNumber(core!.volumeCurrent, 0)} ≥ ${formatNumber(
                    volumePct,
                    0
                  )}% ToD ${formatNumber(core?.volumeTodBaseline ?? Number.NaN, 0)} (need ${formatNumber(
                    volumeThreshold,
                    0
                  )} | ratio ${formatNumber((core?.volumeTodRatio ?? Number.NaN) * 100, 0)}% | n ${Math.round(
                    core?.volumeTodSampleCount ?? 0
                  )}${core?.volumeTodFallback ? " fallback" : ""})`
                : `vol ${formatNumber(core!.volumeCurrent, 0)} ≥ P${volumePct} ${formatNumber(
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
      const portfolioRegime = resolvePortfolioRegime(Date.now());
      const altseasonGateActive =
        settings.riskMode === "ai-matic" && portfolioRegime.active;
      const rotatedMajorThreshold = Math.max(scoreCfg.major, scoreCfg.alt);
      const rotatedAltThreshold = Math.min(scoreCfg.major, scoreCfg.alt);
      const baseThreshold = altseasonGateActive
        ? symbol === "BTCUSDT"
          ? rotatedMajorThreshold
          : rotatedAltThreshold
        : isMajor
          ? scoreCfg.major
          : scoreCfg.alt;
      const strongTrend =
        (Number.isFinite(adx) && adx >= 25) ||
        (Number.isFinite(core?.htfAtrPct) && core!.htfAtrPct >= atrMin) ||
        (decision as any)?.htfTrend?.alignedCount >= 2;
      const threshold =
        altseasonGateActive
          ? baseThreshold
          : settings.riskMode === "ai-matic-tree"
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
        altseasonGateActive,
        dominanceProxy: portfolioRegime.dominanceProxy,
      };
    },
    [resolvePortfolioRegime]
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
            trendProb?: number;
            manipProb?: number;
          }
        | undefined;
      const profile = (decision as any)?.marketProfile as
        | { vah?: number; val?: number; poc?: number; vwap?: number }
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
      const proState = String((decision as any)?.proState ?? "").toUpperCase();
      const rangeRegimeRequired =
        proState === "RANGE_TRADING" || proState === "MANIPULATION_WATCH";
      const vaEdgeRequired = rangeRegimeRequired;
      const sideRaw = String((signal as any)?.intent?.side ?? "").toLowerCase();
      const side =
        sideRaw === "buy"
          ? "Buy"
          : sideRaw === "sell"
            ? "Sell"
            : null;
      const refPrice = toNumber(
        (signal as any)?.intent?.entry ?? (decision as any)?.coreV2?.ltfClose
      );
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
      const ofiUp = Number.isFinite(ofi) && ofi > 0;
      const ofiDown = Number.isFinite(ofi) && ofi < 0;
      const deltaUp = Number.isFinite(delta) && delta > 0;
      const deltaDown = Number.isFinite(delta) && delta < 0;
      const sideDeltaOk =
        side === "Buy"
          ? deltaUp
          : side === "Sell"
            ? deltaDown
            : false;
      const sideOfiOk =
        side === "Buy"
          ? ofiUp
          : side === "Sell"
            ? ofiDown
            : false;
      const directionalFlowOk = sideDeltaOk || sideOfiOk;
      const flowTriggerOk = side
        ? sideDeltaOk || absorptionOk
        : directionalFlowOk || absorptionOk;
      const vaBoundsOk =
        Number.isFinite(profile?.vah) &&
        Number.isFinite(profile?.val) &&
        (profile?.vah ?? 0) > 0 &&
        (profile?.val ?? 0) > 0;
      const vaEdgeBySide =
        !side || !Number.isFinite(refPrice)
          ? vaBoundsOk
          : side === "Buy"
            ? refPrice <= (profile?.val ?? 0) * 1.001
            : refPrice >= (profile?.vah ?? 0) * 0.999;
      const vaOk = vaEdgeRequired ? vaBoundsOk && vaEdgeBySide : true;
      const gates = [
        {
          name: "Hurst < 0.45",
          ok: rangeRegimeRequired ? hurstOk : true,
          detail: rangeRegimeRequired
            ? Number.isFinite(regime?.hurst)
              ? `H ${formatNumber(regime!.hurst, 3)}`
              : "missing"
            : "not required",
          hard: false,
        },
        {
          name: "CHOP > 60",
          ok: rangeRegimeRequired ? chopOk : true,
          detail: rangeRegimeRequired
            ? Number.isFinite(regime?.chop)
              ? `CHOP ${formatNumber(regime!.chop, 1)}`
              : "missing"
            : "not required",
          hard: false,
        },
        {
          name: "HMM state0 p>=0.7",
          ok: rangeRegimeRequired ? hmmOk : true,
          detail: rangeRegimeRequired
            ? Number.isFinite(regime?.hmmProb)
              ? `p ${formatNumber(regime!.hmmProb, 2)}`
              : "missing"
            : "not required",
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
          name: "OFI/Delta trigger",
          ok: flowTriggerOk,
          detail:
            Number.isFinite(orderflow?.ofi) || Number.isFinite(orderflow?.delta)
              ? `OFI ${formatNumber(orderflow?.ofi ?? 0, 2)} | Δ ${formatNumber(orderflow?.delta ?? 0, 2)} | Abs ${formatNumber(absorptionScore, 2)}`
              : "missing",
          hard: false,
        },
        {
          name: "VA edge",
          ok: vaOk,
          detail: vaEdgeRequired
            ? Number.isFinite(profile?.vah) && Number.isFinite(profile?.val)
              ? `VAL ${formatNumber(profile!.val, 2)} | VAH ${formatNumber(profile!.vah, 2)}${Number.isFinite(refPrice) ? ` | Px ${formatNumber(refPrice, 2)}` : ""}`
              : "missing"
            : "not required",
          hard: false,
        },
      ];
      const required = gates.filter((g) => g.detail !== "not required");
      const score = required.filter((g) => g.ok).length;
      const scoreTotal = required.length;
      const scorePass = scoreTotal > 0 ? score >= scoreTotal : true;
      return {
        gates,
        score,
        scoreTotal,
        threshold: scoreTotal,
        scorePass,
        hardFailures: required.filter((g) => !g.ok).map((g) => g.name),
        atrMin: Number.NaN,
        volumePct: 0,
        isMajor: false,
      };
    },
    []
  );

  const isBtcDecoupling = useCallback(() => {
    const regime = resolvePortfolioRegime(Date.now());
    if (regime.active) return true;
    const btcDecision = decisionRef.current["BTCUSDT"]?.decision;
    if (!btcDecision) return false;
    const trend = (btcDecision as any)?.trend;
    const adx = toNumber((btcDecision as any)?.trendAdx);
    // Fallback: BTC Range + low ADX.
    return String(trend).toLowerCase() === "range" && Number.isFinite(adx) && adx < 25;
  }, [resolvePortfolioRegime]);

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
      const nowTs = Date.now();
      const correlation = resolveCorrelationGate(symbol, nowTs, signal);
      const dominanceOk = isBtcDecoupling() || correlation.ok;
      const symbolClosed = Array.isArray(closedPnlRecords)
        ? closedPnlRecords.filter((r) => String(r.symbol ?? "") === symbol)
        : [];
      const lossStreak = computeLossStreak(symbolClosed, 4);
      const takerFeePct = toNumber(settingsRef.current.takerFeePct);
      const result = evaluateAiMaticGatesCore({
        decision,
        signal,
        correlationOk: correlation.ok,
        dominanceOk,
        symbol,
        nowTs,
        lossStreak,
        takerFeePct,
      });
      return {
        ...result,
        correlationDetail: correlation.detail,
        dominanceOk,
      };
    },
    [closedPnlRecords, resolveCorrelationGate, isBtcDecoupling]
  );

  const evaluateAmdGates = useCallback(
    (
      _symbol: string,
      decision: PriceFeedDecision | null | undefined,
      signal: PriceFeedDecision["signal"] | null
    ) => {
      return evaluateAmdGatesCore({ decision, signal });
    },
    []
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
    if (symbolOpenPositionPauseRef.current.has(symbol)) return "HOLD";
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
      const dataHealth = resolveDataHealthSnapshot(
        symbol,
        Date.now(),
        context.settings.riskMode
      );
      const feedAgeMs = dataHealth.feedAgeMs;
      const feedAgeOk = dataHealth.feedAgeMs == null ? null : dataHealth.safe;
      const capacityStatus = getCapacityStatus({
        openPositionsTotal: context.openPositionsCount,
        maxPos: context.maxPositions,
        openOrdersTotal: context.openOrdersCount,
        maxOrders: context.maxOrders,
      });
      const relayPaused = capacityStatus.reason !== "OK";
      if (relayPaused) {
        return {
          symbolState,
          manageReason: capacityStatus.reason,
          entryBlockReasons: [capacityStatus.reason],
          skipCode: capacityStatus.reason,
          skipReason: capacityStatus.reason,
          decisionTrace: [],
          signalActive: false,
          executionAllowed: false,
          executionReason: `Relay paused (${capacityStatus.reason})`,
          relayState: "PAUSED",
          relayReason: capacityStatus.reason,
          gates: [],
          qualityScore: null,
          qualityThreshold: null,
          qualityPass: false,
          lastScanTs,
          feedAgeMs,
          feedAgeOk,
        };
      }
      const openPositionPaused = symbolOpenPositionPauseRef.current.has(symbol);
      if (openPositionPaused) {
        return {
          symbolState: "HOLD",
          manageReason: "OPEN_POSITION",
          entryBlockReasons: ["OPEN_POSITION"],
          skipCode: "OPEN_POSITION",
          skipReason: "OPEN_POSITION",
          decisionTrace: [],
          signalActive: false,
          executionAllowed: false,
          executionReason: "Relay paused (OPEN_POSITION)",
          relayState: "PAUSED",
          relayReason: "OPEN_POSITION",
          gates: [],
          qualityScore: null,
          qualityThreshold: null,
          qualityPass: false,
          lastScanTs,
          feedAgeMs,
          feedAgeOk,
        };
      }
      const signal = decision?.signal ?? null;
      const isAiMaticProfile = context.settings.riskMode === "ai-matic";
      const isAmdProfile = context.settings.riskMode === "ai-matic-amd";
      const aiMaticContext = (decision as any)?.aiMatic as
        | AiMaticContext
        | null;
      const inferredSide =
        aiMaticContext?.htf.ema?.bullOk
          ? "buy"
          : aiMaticContext?.htf.ema?.bearOk
            ? "sell"
            : aiMaticContext?.htf.structureTrend === "BULL"
              ? "buy"
              : aiMaticContext?.htf.structureTrend === "BEAR"
                ? "sell"
                : null;
      const signalForEval =
        signal ??
        (inferredSide
          ? ({ intent: { side: inferredSide } } as PriceFeedDecision["signal"])
          : null);
      const aiMaticEval =
        isAiMaticProfile && signalForEval
          ? evaluateAiMaticGates(symbol, decision, signalForEval)
          : null;
      const amdEval =
        isAmdProfile ? evaluateAmdGates(symbol, decision, signal) : null;
      const quality = resolveQualityScore(symbol as Symbol, decision, signal, feedAgeMs);
      const now = Number.isFinite(lastScanTs) ? lastScanTs : Date.now();

      const gates: { name: string; ok: boolean; detail?: string; pending?: boolean }[] = [];
      const addGate = (
        name: string,
        ok: boolean,
        detail?: string,
        pending?: boolean
      ) => {
        gates.push({ name, ok, detail, pending });
      };

      const correlation = resolveCorrelationGate(symbol, now, signal);
      if (
        symbol !== "BTCUSDT" &&
        !isAiMaticProfile &&
        !isAmdProfile &&
        context.settings.riskMode !== "ai-matic-olikella"
      ) {
        addGate("BTC Correlation", correlation.ok, correlation.detail);
      }

      const isProProfile = context.settings.riskMode === "ai-matic-pro";
      const coreEval = isProProfile
        ? evaluateProGates(decision, signal)
        : evaluateCoreV2(symbol as Symbol, decision, signal, feedAgeMs);
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const isScalpProfile = context.settings.riskMode === "ai-matic-olikella";
      const oliContext = (decision as any)?.oliKella as
        | AiMaticOliKellaContext
        | undefined;
      const hasEntryOrder = ordersRef.current.some(
        (order) =>
          isEntryOrder(order) && String(order?.symbol ?? "") === symbol
      );
      const hasPendingIntent = intentPendingRef.current.has(symbol);
      const decisionTrace: DecisionTraceEntry[] = [];
      const entryBlockReasons: string[] = [];
      const addBlockReason = (label: string) => {
        entryBlockReasons.push(label);
      };
      const appendTrace = (gate: string, result: GateResult) => {
        decisionTrace.push({ gate, result });
      };
      const entryLockTs = entryOrderLockRef.current.get(symbol) ?? 0;
      const lastIntentTs = lastIntentBySymbolRef.current.get(symbol) ?? 0;
      const lastCloseTs = lastCloseBySymbolRef.current.get(symbol) ?? 0;
      const lastLossTs = lastLossBySymbolRef.current.get(symbol) ?? 0;
      const cooldownMs = CORE_V2_COOLDOWN_MS[context.settings.riskMode];
      const closeCooldownMs = isScalpProfile
        ? SCALP_COOLDOWN_MS
        : REENTRY_COOLDOWN_MS;
      const capacityGate = positionCapacityGate({
        hasSymbolPosition: context.hasPosition,
        openPositionsTotal: context.openPositionsCount,
        maxPos: context.maxPositions,
        positionReason: "pozice",
        maxPosReasonPrefix: "max pozic",
      });
      appendTrace("PositionCapacity", capacityGate);
      if (!capacityGate.ok) addBlockReason(capacityGate.reason);
      if (hasEntryOrder) {
        addBlockReason("order");
        appendTrace("OpenOrder", {
          ok: false,
          code: "OPEN_ORDER",
          reason: "order",
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (hasPendingIntent) {
        addBlockReason("intent");
        appendTrace("IntentPending", {
          ok: false,
          code: "PENDING_INTENT",
          reason: "intent",
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (entryLockTs && now - entryLockTs < ENTRY_ORDER_LOCK_MS) {
        const remainingMs = Math.max(0, ENTRY_ORDER_LOCK_MS - (now - entryLockTs));
        const reason = `lock ${Math.ceil(remainingMs / 1000)}s`;
        addBlockReason(reason);
        appendTrace("EntryLock", {
          ok: false,
          code: "ENTRY_LOCK",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (lastIntentTs && now - lastIntentTs < INTENT_COOLDOWN_MS) {
        const remainingMs = Math.max(0, INTENT_COOLDOWN_MS - (now - lastIntentTs));
        const reason = `intent ${Math.ceil(remainingMs / 1000)}s`;
        addBlockReason(reason);
        appendTrace("IntentCooldown", {
          ok: false,
          code: "RECENT_INTENT",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (lastCloseTs && now - lastCloseTs < closeCooldownMs) {
        const remainingMs = Math.max(0, closeCooldownMs - (now - lastCloseTs));
        const reason = `re-entry ${Math.ceil(remainingMs / 1000)}s`;
        addBlockReason(reason);
        appendTrace("ReentryCooldown", {
          ok: false,
          code: "RECENT_CLOSE",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (lastLossTs && now - lastLossTs < cooldownMs) {
        const remainingMs = Math.max(0, cooldownMs - (now - lastLossTs));
        const reason = `cooldown ${Math.ceil(remainingMs / 60_000)}m`;
        addBlockReason(reason);
        appendTrace("LossCooldown", {
          ok: false,
          code: "LOSS_COOLDOWN",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (isAiMaticProfile) {
        const swingState = aiMaticSwingStateRef.current.get(symbol);
        const cooldownUntil = toNumber(swingState?.cooldownUntil);
        if (Number.isFinite(cooldownUntil) && cooldownUntil > now) {
          const remainingMs = Math.max(0, cooldownUntil - now);
          const reason = `swing ${Math.ceil(remainingMs / 60_000)}m`;
          addBlockReason(reason);
          appendTrace("SwingCooldown", {
            ok: false,
            code: "SWING_COOLDOWN",
            reason,
            ttlMs: POSITION_GATE_TTL_MS,
          });
        }
      }
      if (!context.ordersClearOk) {
        addBlockReason("max orderů");
        appendTrace("OrderCapacity", {
          ok: false,
          code: "MAX_ORDERS",
          reason: "max orderů",
          ttlMs: MAX_ORDERS_GATE_TTL_MS,
        });
      }
      const dataGate = dataHealthGate(symbol, now, context.settings.riskMode);
      appendTrace("DataHealth", dataGate);
      if (!dataGate.ok) addBlockReason(dataGate.reason);
      const protectionState = protectionGate();
      appendTrace("ProtectionSL", protectionState);
      if (!protectionState.ok) addBlockReason(protectionState.reason);
      if (
        context.settings.riskMode === "ai-matic-x" &&
        (decision as any)?.xContext?.riskOff
      ) {
        addBlockReason("risk off");
        appendTrace("RiskOff", {
          ok: false,
          code: "RISK_OFF",
          reason: "risk off",
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (
        !capacityGate.ok &&
        capacityStatus.reason === "OK" &&
        capacityGate.code !== "OPEN_POSITION"
      ) {
        const ttlMs = capacityGate.ttlMs ?? SKIP_LOG_THROTTLE_MS;
        const fingerprint = `${context.capacityStateFingerprint}:${capacityGate.code}`;
        if (shouldEmitBlockLog(symbol, capacityGate.code, fingerprint, ttlMs, now)) {
          const logId = `entry-block:${symbol}:${now}`;
          addLogEntries([
            {
              id: logId,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} ENTRY BLOCKED [${capacityGate.code}] ${capacityGate.reason}`,
            },
          ]);
        }
      }
      const manageReason =
        entryBlockReasons.length > 0 ? entryBlockReasons.join(" • ") : null;

      if (isAiMaticProfile) {
        if (aiMaticEval) {
          const hardOkCount = aiMaticEval.hardGates.filter((g) => g.ok).length;
          addGate(
            "Hard: ALL 4",
            hardOkCount >= AI_MATIC_HARD_MIN,
            `${hardOkCount}/${AI_MATIC_HARD_TOTAL}`
          );
          const entryOkCount = aiMaticEval.entryFactors.filter((g) => g.ok).length;
          addGate(
            "Entry: 3 of 4",
            entryOkCount >= AI_MATIC_ENTRY_FACTOR_MIN,
            `${entryOkCount}/${AI_MATIC_ENTRY_FACTOR_TOTAL}`
          );
          const checklistOkCount = aiMaticEval.checklist.filter((g) => g.ok).length;
          addGate(
            "Checklist: 5 of 8",
            checklistOkCount >= AI_MATIC_CHECKLIST_MIN,
            `${checklistOkCount}/${AI_MATIC_CHECKLIST_TOTAL}`
          );
        }
      } else if (isAmdProfile) {
        if (amdEval) {
          amdEval.gates.forEach((gate) =>
            addGate(gate.name, gate.ok, gate.detail, gate.pending)
          );
        }
      } else if (isScalpProfile) {
        addGate(
          OLIKELLA_GATE_SIGNAL_CHECKLIST,
          Boolean(oliContext?.gates.signalChecklistOk),
          oliContext?.gates.signalChecklistDetail ?? "no valid OLIkella setup"
        );
        addGate(
          OLIKELLA_GATE_ENTRY_CONDITIONS,
          Boolean(oliContext?.gates.entryConditionsOk),
          oliContext?.gates.entryConditionsDetail ?? "entry conditions missing"
        );
        addGate(
          OLIKELLA_GATE_EXIT_CONDITIONS,
          Boolean(oliContext?.gates.exitConditionsOk),
          oliContext?.gates.exitConditionsDetail ?? "exit lifecycle unavailable"
        );
        addGate(
          OLIKELLA_GATE_RISK_RULES,
          Boolean(oliContext?.gates.riskRulesOk),
          oliContext?.gates.riskRulesDetail ?? "risk 1.5% | max positions 5 | max orders 20"
        );
      } else {
        coreEval.gates.forEach((gate) => addGate(gate.name, gate.ok, gate.detail));
      }

      const hardEnabled = isAiMaticProfile || isAmdProfile ? true : false;
      const softEnabled = isAiMaticProfile
        ? false
        : isAmdProfile
          ? false
        : isScalpProfile
          ? false
        : context.settings.enableSoftGates !== false;
      const hardReasons: string[] = [];
      const hardBlocked =
        isAiMaticProfile && aiMaticEval ? !aiMaticEval.hardPass : false;
      const execEnabled = isGateEnabled("Exec allowed");
      const softBlocked = softEnabled && quality.pass === false;
      const oliChecklist = isScalpProfile
        ? (() => {
            const eligible = gates.filter((gate) => isGateEnabled(gate.name));
            const passed = eligible.filter((gate) => gate.ok).length;
            return {
              eligibleCount: eligible.length,
              passedCount: passed,
              pass: eligible.length > 0 ? passed === eligible.length : false,
            };
          })()
        : null;
      const checklist = isAiMaticProfile && aiMaticEval
        ? {
            eligibleCount: aiMaticEval.checklist.length,
            passedCount: aiMaticEval.checklist.filter((g) => g.ok).length,
            pass: aiMaticEval.checklistPass,
          }
        : isAmdProfile && amdEval
          ? {
              eligibleCount: amdEval.gates.length,
              passedCount: amdEval.gates.filter((g) => g.ok).length,
              pass: amdEval.pass,
            }
        : isProProfile
          ? {
              eligibleCount: coreEval.scoreTotal,
              passedCount: coreEval.score,
              pass: coreEval.scorePass !== false,
            }
          : isScalpProfile && oliChecklist
            ? oliChecklist
            : evaluateChecklistPass(gates);
      const signalActive = isScalpProfile
        ? Boolean(signal)
        : isAmdProfile
          ? Boolean(signal)
        : Boolean(signal) || checklist.pass;
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
      } else if (isAiMaticProfile && aiMaticEval && !aiMaticEval.pass) {
        const hardCount = aiMaticEval.hardGates.filter((g) => g.ok).length;
        const entryCount = aiMaticEval.entryFactors.filter((g) => g.ok).length;
        const checklistCount = aiMaticEval.checklist.filter((g) => g.ok).length;
        executionAllowed = false;
        executionReason = `AI-MATIC gates hard ${hardCount}/${AI_MATIC_HARD_TOTAL} · entry ${entryCount}/${AI_MATIC_ENTRY_FACTOR_TOTAL} (need ${AI_MATIC_ENTRY_FACTOR_MIN}) · checklist ${checklistCount}/${AI_MATIC_CHECKLIST_TOTAL} (need ${AI_MATIC_CHECKLIST_MIN})`;
      } else if (isAmdProfile && amdEval && !amdEval.pass) {
        const passCount = amdEval.gates.filter((g) => g.ok).length;
        executionAllowed = false;
        executionReason = `AI-MATIC-AMD gates ${passCount}/${amdEval.gates.length}`;
      } else if (!checklist.pass) {
        executionAllowed = false;
        executionReason = isScalpProfile
          ? `OLIkella gates ${checklist.passedCount}/${checklist.eligibleCount}`
          : isProProfile
          ? `Checklist ${checklist.passedCount}/${checklist.eligibleCount}`
          : `Checklist ${checklist.passedCount}/${MIN_CHECKLIST_PASS}`;
      } else if (softBlocked) {
        executionAllowed = false;
        executionReason = `Score ${quality.score ?? "—"} / ${quality.threshold ?? "—"}`;
      } else {
        executionAllowed = true;
      }
      const relayState =
        executionAllowed === true
          ? "READY"
          : executionAllowed === false
            ? "BLOCKED"
            : "WAITING";

      const profileKey = String(context.settings.riskMode ?? "ai-matic");
      let entryGateRules: { name: string; passed: boolean; pending?: boolean }[] = [];
      let entryGateProgress:
        | ReturnType<typeof buildEntryGateProgress>
        | undefined;

      if (isAiMaticProfile) {
        entryGateRules = aiMaticEval
          ? [
              {
                name: "Hard: ALL 4",
                passed: aiMaticEval.hardPass,
              },
              {
                name: "Entry: 3 of 4",
                passed: aiMaticEval.entryFactorsPass,
              },
              {
                name: "Checklist: 5 of 8",
                passed: aiMaticEval.checklistPass,
              },
            ]
          : [
              { name: "Hard: ALL 4", passed: false, pending: true },
              { name: "Entry: 3 of 4", passed: false, pending: true },
              { name: "Checklist: 5 of 8", passed: false, pending: true },
            ];
        const passed = entryGateRules.filter((rule) => rule.passed).length;
        entryGateProgress = buildEntryGateProgress({
          profile: profileKey,
          passed,
          required: 3,
          total: 3,
          label: "AI-MATIC checkpoints",
          reason: executionReason,
          signalActive,
          rules: entryGateRules,
        });
      } else if (isAmdProfile) {
        entryGateRules =
          amdEval?.gates.length
            ? amdEval.gates.map((gate) => ({
                name: gate.name,
                passed: gate.ok,
                pending: gate.pending,
              }))
            : AMD_ENTRY_RULE_NAMES.map((name) => ({
                name,
                passed: false,
                pending: true,
              }));
        const passed = entryGateRules.filter((rule) => rule.passed).length;
        entryGateProgress = buildEntryGateProgress({
          profile: profileKey,
          passed,
          required: AMD_ENTRY_RULE_NAMES.length,
          total: AMD_ENTRY_RULE_NAMES.length,
          label: "AMD gates",
          reason: executionReason,
          signalActive,
          rules: entryGateRules,
        });
      } else if (isScalpProfile) {
        const scalpRulesRaw = [
          {
            name: OLIKELLA_GATE_SIGNAL_CHECKLIST,
            value: oliContext?.gates.signalChecklistOk,
          },
          {
            name: OLIKELLA_GATE_ENTRY_CONDITIONS,
            value: oliContext?.gates.entryConditionsOk,
          },
          {
            name: OLIKELLA_GATE_EXIT_CONDITIONS,
            value: oliContext?.gates.exitConditionsOk,
          },
          {
            name: OLIKELLA_GATE_RISK_RULES,
            value: oliContext?.gates.riskRulesOk,
          },
        ] as const;
        entryGateRules = scalpRulesRaw.map((rule) => {
          const known = typeof rule.value === "boolean";
          return {
            name: rule.name,
            passed: rule.value === true,
            pending: !known && !signalActive,
          };
        });
        const passed = entryGateRules.filter((rule) => rule.passed).length;
        entryGateProgress = buildEntryGateProgress({
          profile: profileKey,
          passed,
          required: 4,
          total: 4,
          label: "OLIkella gates",
          reason: executionReason,
          signalActive,
          rules: entryGateRules,
        });
      } else if (isProProfile) {
        const score = Number.isFinite(coreEval.score) ? coreEval.score : 0;
        const threshold = Number.isFinite(coreEval.threshold)
          ? coreEval.threshold
          : 0;
        const scoreTotal = Number.isFinite(coreEval.scoreTotal)
          ? coreEval.scoreTotal
          : 0;
        const scorePassed = threshold > 0 ? score >= threshold : false;
        entryGateRules = [
          {
            name: `Score >= ${threshold}`,
            passed: scorePassed,
            pending:
              (!Number.isFinite(coreEval.score) ||
                !Number.isFinite(coreEval.threshold)) &&
              !signalActive,
          },
        ];
        entryGateProgress = buildEntryGateProgress({
          profile: profileKey,
          passed: score,
          required: threshold,
          total: scoreTotal,
          label: "PRO score",
          reason: executionReason,
          signalActive,
          rules: entryGateRules,
        });
      } else {
        entryGateRules = [
          {
            name: `Checklist >= ${MIN_CHECKLIST_PASS}`,
            passed: checklist.pass,
            pending: !signalActive && !checklist.pass,
          },
        ];
        entryGateProgress = buildEntryGateProgress({
          profile: profileKey,
          passed: checklist.passedCount,
          required: MIN_CHECKLIST_PASS,
          total: checklist.eligibleCount,
          label: "Checklist threshold",
          reason: executionReason,
          signalActive,
          rules: entryGateRules,
        });
      }

      return {
        symbolState,
        manageReason,
        entryBlockReasons,
        skipCode: decisionTrace.find((entry) => !entry.result.ok)?.result.code,
        skipReason: decisionTrace.find((entry) => !entry.result.ok)?.result.reason,
        decisionTrace,
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
        relayState,
        relayReason: undefined,
        gates,
        entryGateProgress,
        entryGateRules,
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
      evaluateAiMaticGates,
      evaluateAmdGates,
      evaluateCoreV2,
      evaluateProGates,
      evaluateChecklistPass,
      getSymbolContext,
      resolveCorrelationGate,
      isGateEnabled,
      resolveQualityScore,
      resolveSymbolState,
      resolveDataHealthSnapshot,
      dataHealthGate,
      protectionGate,
      shouldEmitBlockLog,
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
    let sawPositionClosed = false;
    let sawOrderCanceled = false;
    let sawOrderFilled = false;
    const [positionsRes, ordersRes, executionsRes] = results;
    const ordersSnapshot =
      ordersRes.status === "fulfilled"
        ? extractList(ordersRes.value)
        : [];
    if (positionsRes.status === "fulfilled" && ordersRes.status === "fulfilled") {
      lastAtomicSyncAtRef.current = now;
    }
    const entryFallbackByKey =
      ordersSnapshot.length > 0
        ? buildEntryFallback(ordersSnapshot)
        : new Map<string, EntryFallback>();

    if (positionsRes.status === "fulfilled") {
      const list = extractList(positionsRes.value);
      const leverageMap = leverageBySymbolRef.current;
      list.forEach((p: any) => {
        const symbol = String(p?.symbol ?? "").toUpperCase();
        if (!symbol) return;
        const leverage = toNumber(
          p?.leverage ??
            p?.buyLeverage ??
            p?.sellLeverage ??
            p?.effectiveLeverage
        );
        if (Number.isFinite(leverage) && leverage > 0) {
          leverageMap.set(symbol, leverage);
        }
      });
      const prevPositions = positionSnapshotRef.current;
      const nextPositions = new Map<string, { size: number; side: string }>();
      const nextWatermarkKeys = new Set<string>();
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
          let sl = toNumber(p?.stopLoss ?? p?.sl);
          let tp = toNumber(p?.takeProfit ?? p?.tp);
          const trailingActiveRaw = toNumber(
            p?.trailingActivePrice ?? p?.activePrice ?? p?.activationPrice
          );
          const markPrice = toNumber(
            p?.markPrice ?? p?.lastPrice ?? p?.indexPrice
          );
          const trailingStop = toNumber(p?.trailingStop);
          const trailingStopDistance = toNumber(p?.trailingStopDistance);
          const trailingStopPrice = toNumber(p?.trailingStopPrice);
          const trailPrice = toNumber(p?.trailPrice);
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
          const protectionFallback = resolveProtectionFromOrders({
            orders: ordersSnapshot,
            symbol,
            positionSide: side,
            entryPrice: resolvedEntry,
            positionIdx,
          });
          if (
            (!Number.isFinite(sl) || sl <= 0) &&
            Number.isFinite(protectionFallback.sl) &&
            protectionFallback.sl > 0
          ) {
            sl = protectionFallback.sl;
          }
          if (
            (!Number.isFinite(tp) || tp <= 0) &&
            Number.isFinite(protectionFallback.tp) &&
            protectionFallback.tp > 0
          ) {
            tp = protectionFallback.tp;
          }
          if (Number.isFinite(sl) && sl > 0) {
            plannedProtectionRef.current.set(symbol.toUpperCase(), {
              sl,
              setAt: now,
            });
            protectionRetryAtRef.current.delete(symbol.toUpperCase());
          }
          const trailPlan =
            Number.isFinite(resolvedEntry) &&
            Number.isFinite(sl) &&
            sl > 0
              ? computeTrailingPlan(
                  resolvedEntry,
                  sl,
                  side === "Sell" ? "Sell" : "Buy",
                  symbol as Symbol,
                  toNumber((decisionRef.current[symbol]?.decision as any)?.coreV2?.atr14),
                  markPrice
                )
              : null;
          const trailingActivePrice = Number.isFinite(trailingActiveRaw)
            ? trailingActiveRaw
            : trailPlan?.trailingActivePrice;
          const watermarkKey = buildPositionWatermarkKey(
            symbol,
            side,
            positionIdx
          );
          const prevWatermark = trailWatermarkRef.current.get(watermarkKey);
          const seedPriceRaw = Number.isFinite(markPrice) && markPrice > 0
            ? markPrice
            : resolvedEntry;
          const seedPrice = Number.isFinite(seedPriceRaw) && seedPriceRaw > 0
            ? seedPriceRaw
            : Number.NaN;
          const highWatermark = Number.isFinite(seedPrice)
            ? Math.max(
                Number.isFinite(prevWatermark?.high)
                  ? (prevWatermark?.high as number)
                  : seedPrice,
                seedPrice
              )
            : Number.NaN;
          const lowWatermark = Number.isFinite(seedPrice)
            ? Math.min(
                Number.isFinite(prevWatermark?.low)
                  ? (prevWatermark?.low as number)
                  : seedPrice,
                seedPrice
              )
            : Number.NaN;
          if (Number.isFinite(highWatermark) && Number.isFinite(lowWatermark)) {
            trailWatermarkRef.current.set(watermarkKey, {
              high: highWatermark,
              low: lowWatermark,
              updatedAt: now,
            });
            nextWatermarkKeys.add(watermarkKey);
          }
          const trailingFields = resolveTrailingFields({
            side,
            trailingStop,
            trailingStopDistance,
            trailingStopPrice,
            trailPrice,
            highWatermark,
            lowWatermark,
          });
          const trailingDistance = trailingFields.trailingDistance;
          const trailStopPrice = trailingFields.trailStopPrice;
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
            trailingDistance,
            trailStopPrice:
              Number.isFinite(trailStopPrice) && (trailStopPrice as number) > 0
                ? (trailStopPrice as number)
                : undefined,
            trailingIsActive:
              Number.isFinite(trailingActivePrice) &&
              trailingActivePrice > 0 &&
              Number.isFinite(markPrice) &&
              (side === "Buy"
                ? markPrice >= trailingActivePrice
                : markPrice <= trailingActivePrice),
            highWatermark:
              Number.isFinite(highWatermark) && highWatermark > 0
                ? highWatermark
                : undefined,
            lowWatermark:
              Number.isFinite(lowWatermark) && lowWatermark > 0
                ? lowWatermark
                : undefined,
            currentTrailingStop:
              Number.isFinite(trailingDistance) && trailingDistance > 0
                ? trailingDistance
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
      for (const key of Array.from(trailWatermarkRef.current.keys())) {
        if (!nextWatermarkKeys.has(key)) {
          trailWatermarkRef.current.delete(key);
        }
      }
      const nextPositionSignature = Array.from(nextPositions.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([symbol, state]) => `${symbol}:${state.side}:${formatNumber(state.size, 8)}`)
        .join("|");
      if (nextPositionSignature !== positionStateSignatureRef.current) {
        positionStateSignatureRef.current = nextPositionSignature;
        positionSnapshotIdRef.current += 1;
        entryBlockFingerprintRef.current.clear();
      }
      setPositions(next);
      positionsRef.current = next;
      setLastSuccessAt(now);
      void syncTrailingProtection(next);
      const pausedByOpenPosition = symbolOpenPositionPauseRef.current;
      for (const symbol of nextPositions.keys()) {
        pausedByOpenPosition.add(symbol);
      }
      for (const symbol of Array.from(pausedByOpenPosition)) {
        if (nextPositions.has(symbol)) continue;
        pausedByOpenPosition.delete(symbol);
        newLogs.push({
          id: `position-flat:${symbol}:${now}`,
          timestamp: new Date(now).toISOString(),
          action: "STATUS",
          message: `${symbol} POSITION_FLAT -> relay resume`,
        });
      }

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
          sawPositionClosed = true;
          lastCloseBySymbolRef.current.set(symbol, now);
          scalpExitStateRef.current.delete(symbol);
          scalpActionCooldownRef.current.delete(symbol);
          scalpPartialCooldownRef.current.delete(symbol);
          scalpTrailCooldownRef.current.delete(symbol);
          oliExtensionCountRef.current.delete(symbol);
          oliTrendLegRef.current.delete(symbol);
          oliScaleInUsedRef.current.delete(symbol);
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
          const priceRaw = toNumber(o?.price);
          const triggerPriceRaw = toNumber(o?.triggerPrice ?? o?.trigger_price);
          const priceFields = resolveOrderPriceFields(priceRaw, triggerPriceRaw);
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
            price: priceFields.price,
            triggerPrice: priceFields.triggerPrice,
            shownPrice: priceFields.shownPrice,
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
              price: priceFields.shownPrice,
              side,
              symbol,
              orderLinkId: orderLinkId || undefined,
            });
          }
          return entry;
        })
        .filter((o: TestnetOrder) => Boolean(o.orderId || o.orderLinkId));
      const isProtectionOrder = (order: TestnetOrder) => {
        return isProtectionOrderLike(order);
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
          const nextStatus = String(nextOrder.status ?? "").toLowerCase();
          if (nextStatus.includes("cancel")) {
            sawOrderCanceled = true;
          }
          if (nextStatus.includes("filled")) {
            sawOrderFilled = true;
          }
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
          const prevStatus = String(prevOrder.status ?? "").toLowerCase();
          if (prevStatus.includes("cancel")) {
            sawOrderCanceled = true;
          }
          if (prevStatus.includes("filled")) {
            sawOrderFilled = true;
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
      if (tradeLogs.length > 0) {
        positionSyncRef.current.lastEventAt = now;
        sawOrderFilled = true;
      }
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

    const syncState = positionSyncRef.current;
    if (
      syncState.lastEventAt > 0 &&
      syncState.lastEventAt >= syncState.lastReconcileAt &&
      now - syncState.lastReconcileAt >= POSITION_RECONCILE_INTERVAL_MS
    ) {
      syncState.lastReconcileAt = now;
      void fetchJson("/reconcile").catch(() => null);
    }

    refreshDiagnosticsFromDecisions();

    if (sawPositionClosed) {
      queueCapacityRecheck("POSITION_CLOSED");
    }
    if (sawOrderCanceled) {
      queueCapacityRecheck("ORDER_CANCELED");
    }
    if (sawOrderFilled) {
      queueCapacityRecheck("ORDER_FILLED");
    }

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
    queueCapacityRecheck,
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

  const handleOliKellaInTrade = useCallback(
    async (symbol: string, decision: PriceFeedDecision, now: number) => {
      const pos = positionsRef.current.find((item) => item.symbol === symbol);
      if (!pos) return;
      const context = (decision as any)?.oliKella as AiMaticOliKellaContext | undefined;
      if (!context) return;
      const sizeRaw = Math.abs(toNumber(pos.size ?? pos.qty));
      if (!Number.isFinite(sizeRaw) || sizeRaw <= 0) return;
      const side = pos.side === "Sell" ? "Sell" : "Buy";
      const entry = toNumber(pos.entryPrice);
      const sl = toNumber(pos.sl);
      const price = toNumber(pos.markPrice);
      if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(price)) {
        return;
      }
      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const atr = Number.isFinite(context.atr14)
        ? context.atr14
        : toNumber(core?.atr14);
      const ema10 =
        Number.isFinite(context.ema10) && context.ema10 > 0
          ? context.ema10
          : Number.NaN;
      const rMultiple = computeRMultiple(entry, sl, price, side);
      const legId = String(context.trendLegId ?? "NONE");
      const prevLegId = oliTrendLegRef.current.get(symbol);
      if (legId !== "NONE" && prevLegId !== legId) {
        oliTrendLegRef.current.set(symbol, legId);
        oliExtensionCountRef.current.set(symbol, 0);
        oliScaleInUsedRef.current.set(symbol, false);
      } else if (!prevLegId && legId !== "NONE") {
        oliTrendLegRef.current.set(symbol, legId);
      }

      const allowAction = (key: string, cooldownMs: number) => {
        const storageKey = `${symbol}:${key}`;
        const last = scalpActionCooldownRef.current.get(storageKey) ?? 0;
        if (now - last < cooldownMs) return false;
        scalpActionCooldownRef.current.set(storageKey, now);
        return true;
      };

      const oppositeCross =
        side === "Buy" ? context.oppositeCrossbackLong : context.oppositeCrossbackShort;
      const wedgeDrop =
        side === "Buy" ? context.wedgeDrop.againstLong : context.wedgeDrop.againstShort;
      if ((oppositeCross || wedgeDrop) && allowAction("olikella-hard-exit", 15_000)) {
        try {
          await submitReduceOnlyOrder(pos, sizeRaw);
          addLogEntries([
            {
              id: `olikella:hard-exit:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} OLIkella hard exit: ${
                wedgeDrop ? "Wedge Drop" : "Opposite EMA Crossback"
              }`,
            },
          ]);
        } catch (err) {
          addLogEntries([
            {
              id: `olikella:hard-exit:error:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
              message: `${symbol} OLIkella hard exit failed: ${asErrorMessage(err)}`,
            },
          ]);
        }
        return;
      }

      const exhaustionDirection = context.exhaustion.direction;
      const exhaustionMatches =
        context.exhaustion.active &&
        ((side === "Buy" && exhaustionDirection === "BUY") ||
          (side === "Sell" && exhaustionDirection === "SELL"));
      if (exhaustionMatches && allowAction("olikella-exhaustion", 20_000)) {
        const extensionCount = oliExtensionCountRef.current.get(symbol) ?? 0;
        try {
          if (extensionCount <= 0) {
            await submitReduceOnlyOrder(pos, sizeRaw * 0.6);
            oliExtensionCountRef.current.set(symbol, 1);
            addLogEntries([
              {
                id: `olikella:exhaustion:partial:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} OLIkella exhaustion #1 -> partial 60%`,
              },
            ]);
          } else {
            await submitReduceOnlyOrder(pos, sizeRaw);
            oliExtensionCountRef.current.set(symbol, extensionCount + 1);
            addLogEntries([
              {
                id: `olikella:exhaustion:full:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} OLIkella exhaustion #2 -> full exit`,
              },
            ]);
          }
        } catch (err) {
          addLogEntries([
            {
              id: `olikella:exhaustion:error:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
              message: `${symbol} OLIkella exhaustion handling failed: ${asErrorMessage(err)}`,
            },
          ]);
        }
      }

      if (Number.isFinite(rMultiple) && rMultiple >= 1 && allowAction("olikella-be", 20_000)) {
        const minDistance = resolveMinProtectionDistance(entry, atr);
        const beSl = side === "Buy" ? entry - minDistance : entry + minDistance;
        const shouldMove = side === "Buy" ? sl < beSl : sl > beSl;
        if (shouldMove && Number.isFinite(beSl) && beSl > 0) {
          try {
            await updateProtection({
              symbol,
              sl: beSl,
              positionIdx: Number.isFinite(pos.positionIdx)
                ? pos.positionIdx
                : undefined,
            });
            addLogEntries([
              {
                id: `olikella:be:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} OLIkella BE move @ >=1R`,
              },
            ]);
          } catch (err) {
            addLogEntries([
              {
                id: `olikella:be:error:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "ERROR",
                message: `${symbol} OLIkella BE move failed: ${asErrorMessage(err)}`,
              },
            ]);
          }
        }
      }

      if (
        Number.isFinite(ema10) &&
        Number.isFinite(atr) &&
        atr > 0 &&
        allowAction("olikella-ema10-trail", 20_000)
      ) {
        const targetSl = side === "Buy" ? ema10 - atr * 0.2 : ema10 + atr * 0.2;
        const tighten = side === "Buy" ? targetSl > sl : targetSl < sl;
        const valid = side === "Buy" ? targetSl < price : targetSl > price;
        if (tighten && valid && Number.isFinite(targetSl) && targetSl > 0) {
          try {
            await updateProtection({
              symbol,
              sl: targetSl,
              positionIdx: Number.isFinite(pos.positionIdx)
                ? pos.positionIdx
                : undefined,
            });
            addLogEntries([
              {
                id: `olikella:trail:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} OLIkella EMA10 trail with ATR0.2`,
              },
            ]);
          } catch (err) {
            addLogEntries([
              {
                id: `olikella:trail:error:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "ERROR",
                message: `${symbol} OLIkella trail update failed: ${asErrorMessage(err)}`,
              },
            ]);
          }
        }
      }

      const scaleInUsed = oliScaleInUsedRef.current.get(symbol) ?? false;
      const sameSideSignal =
        (decision as any)?.signal?.intent?.side === (side === "Buy" ? "buy" : "sell");
      if (
        context.canScaleIn &&
        sameSideSignal &&
        !scaleInUsed &&
        Number.isFinite(rMultiple) &&
        rMultiple >= 1 &&
        allowAction("olikella-scale-in", 30_000)
      ) {
        try {
          await postJson("/order", {
            symbol,
            side,
            qty: sizeRaw * 0.25,
            orderType: "Market",
            reduceOnly: false,
            timeInForce: "IOC",
            positionIdx: Number.isFinite(pos.positionIdx)
              ? pos.positionIdx
              : undefined,
          });
          oliScaleInUsedRef.current.set(symbol, true);
          addLogEntries([
            {
              id: `olikella:scale-in:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} OLIkella scale-in executed (+25%)`,
            },
          ]);
        } catch (err) {
          addLogEntries([
            {
              id: `olikella:scale-in:error:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
              message: `${symbol} OLIkella scale-in failed: ${asErrorMessage(err)}`,
            },
          ]);
        }
      }
    },
    [addLogEntries, postJson, submitReduceOnlyOrder, updateProtection]
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
      positionSyncRef.current.lastReconcileAt = now;
      const payload = reconcileRes.value ?? {};
      const reconDiffs = payload?.diffs ?? [];
      if (Array.isArray(reconDiffs) && reconDiffs.length > 0) {
        queueCapacityRecheck("RECONCILED");
      }
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
  }, [addLogEntries, fetchJson, queueCapacityRecheck]);

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

  useEffect(() => {
    if (!authToken) return;
    let alive = true;
    const retryMissingSlProtection = async () => {
      if (!alive) return;
      const missing = positionsWithoutActiveSl();
      if (missing.length === 0) return;
      const now = Date.now();
      for (const position of missing) {
        const symbol = String(position.symbol ?? "").toUpperCase();
        if (!symbol) continue;
        const lastAttempt = protectionRetryAtRef.current.get(symbol) ?? 0;
        if (now - lastAttempt < PROTECTION_RETRY_INTERVAL_MS) continue;
        protectionRetryAtRef.current.set(symbol, now);
        const sl = resolveProtectionRetryStop(position);
        if (!Number.isFinite(sl) || sl <= 0) continue;
        try {
          await postJson("/protection", {
            symbol,
            sl,
            positionIdx: Number.isFinite(position.positionIdx)
              ? position.positionIdx
              : undefined,
          });
          plannedProtectionRef.current.set(symbol, { sl, setAt: now });
          const lastLog = protectionRetryLogRef.current.get(symbol) ?? 0;
          if (now - lastLog >= PROTECTION_RETRY_LOG_TTL_MS) {
            protectionRetryLogRef.current.set(symbol, now);
            addLogEntries([
              {
                id: `protection:retry:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} PROTECTION_RETRY_SL ${formatNumber(sl, 6)}`,
              },
            ]);
          }
        } catch (err) {
          const lastLog = protectionRetryLogRef.current.get(symbol) ?? 0;
          if (now - lastLog >= PROTECTION_RETRY_LOG_TTL_MS) {
            protectionRetryLogRef.current.set(symbol, now);
            addLogEntries([
              {
                id: `protection:retry:error:${symbol}:${now}`,
                timestamp: new Date(now).toISOString(),
                action: "ERROR",
                message: `${symbol} PROTECTION_RETRY_SL failed: ${asErrorMessage(err)}`,
              },
            ]);
          }
        }
      }
    };
    const id = setInterval(() => {
      void retryMissingSlProtection();
    }, PROTECTION_RETRY_INTERVAL_MS);
    void retryMissingSlProtection();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [
    addLogEntries,
    authToken,
    positionsWithoutActiveSl,
    postJson,
    resolveProtectionRetryStop,
  ]);

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
    expireAfterMs?: number;
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
      expireAfterMs: Number.isFinite(signal.expireAfterMs)
        ? Math.max(1_000, signal.expireAfterMs as number)
        : 30_000,
      tags: { env: useTestnet ? "testnet" : "mainnet", mode: "intent" },
    } as const;

    await sendIntent(intent, { authToken, useTestnet });
  }

  const resolveAiMaticFlowPressure = useCallback(
    (
      decision: PriceFeedDecision,
      side: "Buy" | "Sell"
    ): {
      strong: boolean;
      absorptionScore: number;
      delta: number;
      deltaPrev: number;
      ofi: number;
      dominanceRatio: number;
    } => {
      const orderflow = (decision as any)?.orderflow as
        | {
            absorptionScore?: number;
            delta?: number;
            deltaPrev?: number;
            ofi?: number;
          }
        | undefined;
      const absorptionScore = toNumber(orderflow?.absorptionScore);
      const delta = toNumber(orderflow?.delta);
      const deltaPrev = toNumber(orderflow?.deltaPrev);
      const ofi = toNumber(orderflow?.ofi);
      const sideAligned =
        side === "Buy"
          ? Number.isFinite(delta) && delta > 0
          : Number.isFinite(delta) && delta < 0;
      const ofiAligned =
        side === "Buy"
          ? Number.isFinite(ofi) && ofi > 0
          : Number.isFinite(ofi) && ofi < 0;
      const dominanceRatio =
        Number.isFinite(delta) && Number.isFinite(deltaPrev)
          ? Math.abs(delta) / Math.max(1, Math.abs(deltaPrev))
          : Number.NaN;
      const absorptionStrong =
        Number.isFinite(absorptionScore) &&
        absorptionScore >= AI_MATIC_RETEST_ABSORPTION_MIN;
      const takerDominance =
        sideAligned &&
        ofiAligned &&
        Number.isFinite(dominanceRatio) &&
        dominanceRatio >= AI_MATIC_RETEST_DELTA_DOMINANCE_RATIO;
      return {
        strong: Boolean(absorptionStrong || takerDominance),
        absorptionScore,
        delta,
        deltaPrev,
        ofi,
        dominanceRatio,
      };
    },
    []
  );

  const maybeRunAiMaticRetestFallback = useCallback(
    async (symbol: string, decision: PriceFeedDecision, now: number) => {
      const state = aiMaticRetestFallbackRef.current.get(symbol);
      if (!state) return;
      if (settingsRef.current.riskMode !== "ai-matic") {
        aiMaticRetestFallbackRef.current.delete(symbol);
        return;
      }

      const activeRetestOrder = ordersRef.current.find(
        (order) =>
          isActiveEntryOrder(order) &&
          String(order?.symbol ?? "") === symbol &&
          String(order?.orderLinkId ?? "") === state.retestIntentId
      );
      if (!activeRetestOrder) {
        aiMaticRetestFallbackRef.current.delete(symbol);
        return;
      }

      const core = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
      const ltfOpenTime = toNumber(core?.ltfOpenTime);
      if (Number.isFinite(ltfOpenTime) && ltfOpenTime > state.lastLtfOpenTime) {
        state.lastLtfOpenTime = ltfOpenTime;
        state.missedBars += 1;
        aiMaticRetestFallbackRef.current.set(symbol, state);
      }

      if (state.executing || state.missedBars < state.fallbackBars) return;

      const hasPrimaryPosition = positionsRef.current.some((p) => {
        if (String(p.symbol ?? "") !== symbol) return false;
        const size = toNumber(p.size ?? p.qty);
        if (!Number.isFinite(size) || size <= 0) return false;
        const posSide = String(p.side ?? "").toLowerCase();
        return state.side === "Buy" ? posSide === "buy" : posSide === "sell";
      });
      if (!hasPrimaryPosition) return;

      const pressure = resolveAiMaticFlowPressure(decision, state.side);
      if (!pressure.strong) return;

      state.executing = true;
      aiMaticRetestFallbackRef.current.set(symbol, state);

      try {
        await postJson("/cancel", {
          symbol,
          orderId: activeRetestOrder.orderId || undefined,
          orderLinkId: activeRetestOrder.orderLinkId || undefined,
        });
        addLogEntries([
          {
            id: `ai-matic-retest-cancel:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `${symbol} retest 40% cancel | bars ${state.missedBars} | Abs ${formatNumber(
              pressure.absorptionScore,
              2
            )} | Δ ${formatNumber(pressure.delta, 2)}`,
          },
        ]);

        const slices = Math.max(1, AI_MATIC_RETEST_TWAP_SLICES);
        const sliceQty = state.fallbackQty / slices;
        if (!Number.isFinite(sliceQty) || sliceQty <= 0) {
          throw new Error("invalid_retest_fallback_qty");
        }
        for (let i = 0; i < slices; i++) {
          await autoTrade({
            symbol: state.symbol as Symbol,
            side: state.side,
            entryPrice: state.triggerPrice ?? activeRetestOrder.price ?? 0,
            entryType: "MARKET",
            slPrice: state.slPrice,
            tpPrices: state.tpPrices,
            qtyMode: "BASE_QTY",
            qtyValue: sliceQty,
            intentId: crypto.randomUUID(),
          });
          if (i < slices - 1) {
            await new Promise((resolve) =>
              setTimeout(resolve, AI_MATIC_RETEST_TWAP_DELAY_MS)
            );
          }
        }
        aiMaticRetestFallbackRef.current.delete(symbol);
        addLogEntries([
          {
            id: `ai-matic-retest-exec:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `${symbol} retest fallback TWAP ${Math.round(
              AI_MATIC_RETEST_SECONDARY_RATIO * 100
            )}% executed`,
          },
        ]);
      } catch (err) {
        state.executing = false;
        aiMaticRetestFallbackRef.current.set(symbol, state);
        addLogEntries([
          {
            id: `ai-matic-retest-error:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "ERROR",
            message: `${symbol} retest fallback failed: ${asErrorMessage(err)}`,
          },
        ]);
      }
    },
    [addLogEntries, autoTrade, isActiveEntryOrder, postJson, resolveAiMaticFlowPressure]
  );

  const handleDecision = useCallback(
    (symbol: string, decision: PriceFeedDecision) => {
      const now = Date.now();
      const isSelected = activeSymbols.includes(symbol as Symbol);
      const scalpActive = settingsRef.current.riskMode === "ai-matic-olikella";
      const isProProfile = settingsRef.current.riskMode === "ai-matic-pro";
      const isAiMaticProfile = settingsRef.current.riskMode === "ai-matic";
      const isAmdProfile = settingsRef.current.riskMode === "ai-matic-amd";
      const relayPaused = relayPauseRef.current.paused;
      const relayForceScan = relayPauseRef.current.forceScanSymbols.has(symbol);
      const skipDiagWhilePaused = relayPaused && !relayForceScan;
      feedLastTickRef.current = now;
      symbolTickRef.current.set(symbol, now);
      if (!skipDiagWhilePaused) {
        decisionRef.current[symbol] = { decision, ts: now };
      }
      const portfolioRegime = resolvePortfolioRegime(now);
      if (isSelected && !skipDiagWhilePaused) {
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
        void maybeRunAiMaticRetestFallback(symbol, decision, now);
        if (hasPosition && scalpActive) {
          void handleOliKellaInTrade(symbol, decision, now);
        }
        if (hasPosition || hasEntryOrder || hasPendingIntent) {
          return;
        }
        feedPauseRef.current.delete(symbol);
      }
      const symbolPausedByPosition = symbolOpenPositionPauseRef.current.has(symbol);
      if (symbolPausedByPosition && !hasPosition) {
        const pauseKey = `symbol-open-position-pause:${symbol}`;
        const lastPauseLog = skipLogThrottleRef.current.get(pauseKey) ?? 0;
        if (now - lastPauseLog >= POSITION_GATE_TTL_MS) {
          skipLogThrottleRef.current.set(pauseKey, now);
          addLogEntries([
            {
              id: `symbol-open-position-pause:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} OPEN_POSITION pause active -> skip decision`,
            },
          ]);
        }
        return;
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
      void maybeRunAiMaticRetestFallback(symbol, decision, now);
      if (hasPosition || hasEntryOrder) {
        if (hasPosition && scalpActive) {
          void handleOliKellaInTrade(symbol, decision, now);
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
      const relayPauseState = relayPauseRef.current;
      if (relayPauseState.paused && !relayPauseState.forceScanSymbols.has(symbol)) {
        if (
          relayPauseState.forceScanSymbols.size === 0 &&
          now - relayPauseState.lastTtlRecheckAt >= CAPACITY_RECHECK_MS
        ) {
          queueCapacityRecheck("TTL_RECHECK");
        }
        return;
      }
      const capacityContext = getSymbolContext(symbol, decision);
      const capacityStatus = getCapacityStatus({
        openPositionsTotal: capacityContext.openPositionsCount,
        maxPos: capacityContext.maxPositions,
        openOrdersTotal: capacityContext.openOrdersCount,
        maxOrders: capacityContext.maxOrders,
      });
      const capacityFingerprint = buildCapacityFingerprint({
        openPositionsTotal: capacityContext.openPositionsCount,
        maxPos: capacityContext.maxPositions,
        openOrdersTotal: capacityContext.openOrdersCount,
        maxOrders: capacityContext.maxOrders,
      });
      const relayPause = relayPauseRef.current;
      const canSkipForCapacityPause =
        !hasPosition && !hasEntryOrder;
      if (capacityStatus.reason !== "OK") {
        const shouldLogPause =
          !relayPause.paused ||
          relayPause.pausedReason !== capacityStatus.reason ||
          relayPause.lastCapacityFingerprint !== capacityFingerprint;
        if (shouldLogPause) {
          relayPause.paused = true;
          relayPause.pausedReason = capacityStatus.reason;
          relayPause.pausedAt = now;
          relayPause.lastCapacityFingerprint = capacityFingerprint;
          relayPause.lastTtlRecheckAt = now;
          relayPause.forceScanSymbols.clear();
          relayPause.forceScanReason = null;
          addLogEntries([
            {
              id: `signal-relay:paused:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `SIGNAL_RELAY_PAUSED [${capacityStatus.reason}] pos ${capacityContext.openPositionsCount}/${capacityContext.maxPositions} | orders ${capacityContext.openOrdersCount}/${capacityContext.maxOrders}`,
            },
          ]);
          if (isSelected) {
            setScanDiagnostics((prev) => ({
              ...(prev ?? {}),
              [symbol]: buildScanDiagnostics(symbol, decision, now),
            }));
          }
        }
        if (
          canSkipForCapacityPause &&
          relayPause.forceScanSymbols.size === 0 &&
          now - relayPause.lastTtlRecheckAt >= CAPACITY_RECHECK_MS
        ) {
          queueCapacityRecheck("TTL_RECHECK");
        }
        if (!canSkipForCapacityPause) {
          relayPause.forceScanSymbols.delete(symbol);
        } else {
          const forceScan = relayPause.forceScanSymbols.has(symbol);
          if (!forceScan) return;
          relayPause.forceScanSymbols.delete(symbol);
          if (relayPause.forceScanSymbols.size === 0) {
            relayPause.forceScanReason = null;
          }
        }
      } else if (relayPause.paused) {
        const pausedReason = relayPause.pausedReason ?? "UNKNOWN";
        const afterMs =
          relayPause.pausedAt > 0 ? Math.max(0, now - relayPause.pausedAt) : 0;
        const resumeTrigger = relayPause.forceScanReason ?? "CAPACITY_CHANGED";
        relayPause.paused = false;
        relayPause.pausedReason = null;
        relayPause.pausedAt = 0;
        relayPause.lastCapacityFingerprint = capacityFingerprint;
        relayPause.forceScanSymbols.clear();
        relayPause.forceScanReason = null;
        relayPause.lastTtlRecheckAt = 0;
        addLogEntries([
          {
            id: `signal-relay:resumed:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `SIGNAL_RELAY_RESUMED [${pausedReason}] after ${afterMs}ms | trigger ${resumeTrigger}`,
          },
        ]);
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
      const dataHealthSnapshot = resolveDataHealthSnapshot(
        symbol,
        now,
        settingsRef.current.riskMode
      );
      const feedAgeMs = dataHealthSnapshot.feedAgeMs;
      const coreEval = isProProfile
        ? evaluateProGates(decision, rawSignal)
        : evaluateCoreV2(symbol as Symbol, decision, rawSignal, feedAgeMs);
      const checklistBase = evaluateChecklistPass(coreEval.gates);
      let signal = rawSignal;
      if (
        !signal &&
        checklistBase.pass &&
        !isProProfile &&
        !scalpActive &&
        !isAmdProfile
      ) {
        signal = buildChecklistSignal(symbol as Symbol, decision, now);
      }
      if (!signal) return;

      const signalId = String(signal.id ?? `${symbol}-${now}`);
      if (signalSeenRef.current.has(signalId)) return;
      signalSeenRef.current.add(signalId);

      let aiMaticEval: ReturnType<typeof evaluateAiMaticGates> | null = null;
      let amdEval: ReturnType<typeof evaluateAmdGates> | null = null;
      if (isAiMaticProfile) {
        aiMaticEval = evaluateAiMaticGates(symbol, decision, signal);
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
          const hardCount = aiMaticEval.hardGates.filter((g) => g.ok).length;
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
              message: `${symbol} AI-MATIC gate hard ${hardCount}/${AI_MATIC_HARD_TOTAL} | entry ${entryCount}/${AI_MATIC_ENTRY_FACTOR_TOTAL} (need ${AI_MATIC_ENTRY_FACTOR_MIN}) | checklist ${checklistCount}/${AI_MATIC_CHECKLIST_TOTAL} (need ${AI_MATIC_CHECKLIST_MIN}) -> NO TRADE${reasons.length ? ` (${reasons.join(" | ")})` : ""}`,
            },
          ]);
          return;
        }
      }
      if (isAmdProfile) {
        amdEval = evaluateAmdGates(symbol, decision, signal);
        if (!amdEval.pass) {
          const fails = amdEval.gates.filter((g) => !g.ok).map((g) => g.name);
          const passCount = amdEval.gates.filter((g) => g.ok).length;
          addLogEntries([
            {
              id: `ai-matic-amd-gate:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} AI-MATIC-AMD gate ${passCount}/${amdEval.gates.length} -> NO TRADE${fails.length ? ` (fail: ${fails.join(", ")})` : ""}`,
            },
          ]);
          return;
        }
      }

      const isTreeProfile = settingsRef.current.riskMode === "ai-matic-tree";

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
      let entry = toNumber(intent?.entry);
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
      const signalKey = [
        symbol,
        side,
        String(signal.kind ?? "OTHER"),
        signalPriceBucket(entry),
        signalPriceBucket(sl),
        signalPriceBucket(tp),
      ].join("|");
      const signalThrottleMs = isChecklistSignal
        ? SIGNAL_LOG_THROTTLE_MS
        : SIGNAL_LOG_SIMILAR_THROTTLE_MS;
      const lastSignalLog = signalLogThrottleRef.current.get(signalKey) ?? 0;
      const shouldLogSignal = now - lastSignalLog >= signalThrottleMs;
      if (shouldLogSignal) {
        if (signalLogThrottleRef.current.size > 500) {
          for (const [key, ts] of signalLogThrottleRef.current.entries()) {
            if (now - ts > 60_000) signalLogThrottleRef.current.delete(key);
          }
        }
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
      const isScalpProfile = context.settings.riskMode === "ai-matic-olikella";
      const xContext = (decision as any)?.xContext as AiMaticXContext | undefined;
      const oliContext = (decision as any)?.oliKella as
        | AiMaticOliKellaContext
        | undefined;
      const hasSymbolPosition = context.hasPosition;
      const hasSymbolEntryOrder = ordersRef.current.some(
        (order) =>
          isEntryOrder(order) && String(order?.symbol ?? "") === symbol
      );
      const decisionTrace: DecisionTraceEntry[] = [];
      const appendTrace = (gate: string, result: GateResult) => {
        decisionTrace.push({ gate, result });
      };
      const cooldownMs = CORE_V2_COOLDOWN_MS[context.settings.riskMode];
      const lastLossTs = lastLossBySymbolRef.current.get(symbol) ?? 0;
      const lastCloseTs = lastCloseBySymbolRef.current.get(symbol) ?? 0;
      const lastIntentTs = lastIntentBySymbolRef.current.get(symbol) ?? 0;
      const entryLockTs = entryOrderLockRef.current.get(symbol) ?? 0;
      const entryBlockReasons: string[] = [];
      const capacityGate = positionCapacityGate({
        hasSymbolPosition,
        openPositionsTotal: context.openPositionsCount,
        maxPos: context.maxPositions,
      });
      appendTrace("PositionCapacity", capacityGate);
      if (!capacityGate.ok) entryBlockReasons.push(capacityGate.reason);
      if (hasSymbolEntryOrder) {
        entryBlockReasons.push("open order");
        appendTrace("OpenOrder", {
          ok: false,
          code: "OPEN_ORDER",
          reason: "open order",
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (hasPendingIntent) {
        entryBlockReasons.push("pending intent");
        appendTrace("IntentPending", {
          ok: false,
          code: "PENDING_INTENT",
          reason: "pending intent",
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (entryLockTs && now - entryLockTs < ENTRY_ORDER_LOCK_MS) {
        const remainingMs = Math.max(0, ENTRY_ORDER_LOCK_MS - (now - entryLockTs));
        const remainingSec = Math.ceil(remainingMs / 1000);
        const reason = `entry lock ${remainingSec}s`;
        entryBlockReasons.push(reason);
        appendTrace("EntryLock", {
          ok: false,
          code: "ENTRY_LOCK",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (lastIntentTs && now - lastIntentTs < INTENT_COOLDOWN_MS) {
        const remainingMs = Math.max(0, INTENT_COOLDOWN_MS - (now - lastIntentTs));
        const remainingSec = Math.ceil(remainingMs / 1000);
        const reason = `recent intent ${remainingSec}s`;
        entryBlockReasons.push(reason);
        appendTrace("IntentCooldown", {
          ok: false,
          code: "RECENT_INTENT",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      const closeCooldownMs = isScalpProfile
        ? SCALP_COOLDOWN_MS
        : REENTRY_COOLDOWN_MS;
      if (lastCloseTs && now - lastCloseTs < closeCooldownMs) {
        const remainingMs = Math.max(0, closeCooldownMs - (now - lastCloseTs));
        const remainingSec = Math.ceil(remainingMs / 1000);
        const reason = `recent close ${remainingSec}s`;
        entryBlockReasons.push(reason);
        appendTrace("ReentryCooldown", {
          ok: false,
          code: "RECENT_CLOSE",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (lastLossTs && now - lastLossTs < cooldownMs) {
        const remainingMs = Math.max(0, cooldownMs - (now - lastLossTs));
        const remainingMin = Math.ceil(remainingMs / 60_000);
        const reason = `cooldown ${remainingMin}m`;
        entryBlockReasons.push(reason);
        appendTrace("LossCooldown", {
          ok: false,
          code: "LOSS_COOLDOWN",
          reason,
          ttlMs: POSITION_GATE_TTL_MS,
        });
      }
      if (isAiMaticProfile) {
        const swingState = aiMaticSwingStateRef.current.get(symbol);
        const cooldownUntil = toNumber(swingState?.cooldownUntil);
        if (Number.isFinite(cooldownUntil) && cooldownUntil > now) {
          const remainingMin = Math.ceil((cooldownUntil - now) / 60_000);
          const reason = `swing cooldown ${remainingMin}m`;
          entryBlockReasons.push(reason);
          appendTrace("SwingCooldown", {
            ok: false,
            code: "SWING_COOLDOWN",
            reason,
            ttlMs: POSITION_GATE_TTL_MS,
          });
        }
      }
      if (!context.ordersClearOk) {
        entryBlockReasons.push("max orders");
        appendTrace("OrderCapacity", {
          ok: false,
          code: "MAX_ORDERS",
          reason: "max orders",
          ttlMs: MAX_ORDERS_GATE_TTL_MS,
        });
      }
      const dataGate = dataHealthGate(symbol, now, context.settings.riskMode);
      appendTrace("DataHealth", dataGate);
      if (!dataGate.ok) {
        entryBlockReasons.push(dataGate.reason);
      }
      const slProtectionGate = protectionGate();
      appendTrace("ProtectionSL", slProtectionGate);
      if (!slProtectionGate.ok) {
        entryBlockReasons.push(slProtectionGate.reason);
      }
      if (entryBlockReasons.length > 0) {
        const profileLabel =
          PROFILE_BY_RISK_MODE[context.settings.riskMode] ?? "AI-MATIC";
        const skipCode = decisionTrace.find((entry) => !entry.result.ok)?.result.code ?? "ENTRY_BLOCKED";
        const skipReason =
          decisionTrace.find((entry) => !entry.result.ok)?.result.reason ??
          entryBlockReasons[0] ??
          "entry blocked";
        const stateFingerprint = [
          context.capacityStateFingerprint,
          entryBlockReasons.join("|"),
          String(signal?.intent?.side ?? ""),
          String(signal?.kind ?? ""),
        ].join("::");
        const prevFingerprint = entryBlockFingerprintRef.current.get(symbol);
        if (prevFingerprint === stateFingerprint) {
          return;
        }
        entryBlockFingerprintRef.current.set(symbol, stateFingerprint);
        const ttlMs =
          decisionTrace.find((entry) => !entry.result.ok)?.result.ttlMs ??
          SKIP_LOG_THROTTLE_MS;
        const normalizedSkipCode = String(skipCode ?? "").toUpperCase();
        const relayPausedReason = relayPauseRef.current.pausedReason;
        const relayCapacityPaused =
          relayPauseRef.current.paused &&
          (relayPausedReason === "MAX_POS" ||
            relayPausedReason === "MAX_ORDERS" ||
            relayPausedReason === "MAX_POS+MAX_ORDERS");
        const shouldEmitSkipStatus =
          !relayCapacityPaused &&
          !SKIP_STATUS_SUPPRESSED_CODES.has(normalizedSkipCode);
        if (shouldEmitSkipStatus && shouldEmitBlockLog(symbol, skipCode, stateFingerprint, ttlMs, now)) {
          addLogEntries([
            {
              id: `signal:max-pos:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} ${profileLabel} gate [${skipCode}]: ${skipReason} -> skip entry`,
            },
          ]);
        }
        return;
      }
      entryBlockFingerprintRef.current.delete(symbol);
      if (!isScalpProfile && !isAmdProfile) {
        const trendCore = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
        const trendGate = resolveH1M15TrendGate(trendCore, signal);
        appendTrace("Trend1h15m", {
          ok: trendGate.ok,
          code: trendGate.ok ? "OK" : "TREND_GATE",
          reason: trendGate.detail,
        });
        if (!trendGate.ok) {
          addLogEntries([
            {
              id: `signal:trend-gate:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} trend gate 1h/15m [TREND_GATE]: ${trendGate.detail}`,
            },
          ]);
          return;
        }
      }
      if (isTreeProfile) {
        const trendCore = (decision as any)?.coreV2 as CoreV2Metrics | undefined;
        const treeGate = treeTrendGate5m({
          side,
          price: toNumber(trendCore?.ltfClose),
          ema200_5m: toNumber(trendCore?.ema200),
          macdHist_5m: toNumber(trendCore?.ltfMacdHist),
          rsi14_5m: toNumber(trendCore?.ltfRsi),
        });
        appendTrace("TreeTrend5m", treeGate);
        if (!treeGate.ok) {
          addLogEntries([
            {
              id: `signal:tree-trend-gate:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} TREE 5m gate [${treeGate.code}]: ${treeGate.reason}`,
            },
          ]);
          return;
        }
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
            ? equity * (CORE_V2_RISK_PCT["ai-matic-olikella"] ?? 0)
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
      const protectedEntry = false;
      if (isScalpProfile) {
        const gateFails: string[] = [];
        if (
          isGateEnabled(OLIKELLA_GATE_SIGNAL_CHECKLIST) &&
          !oliContext?.gates.signalChecklistOk
        ) {
          gateFails.push(OLIKELLA_GATE_SIGNAL_CHECKLIST);
        }
        if (
          isGateEnabled(OLIKELLA_GATE_ENTRY_CONDITIONS) &&
          !oliContext?.gates.entryConditionsOk
        ) {
          gateFails.push(OLIKELLA_GATE_ENTRY_CONDITIONS);
        }
        if (
          isGateEnabled(OLIKELLA_GATE_EXIT_CONDITIONS) &&
          !oliContext?.gates.exitConditionsOk
        ) {
          gateFails.push(OLIKELLA_GATE_EXIT_CONDITIONS);
        }
        if (
          isGateEnabled(OLIKELLA_GATE_RISK_RULES) &&
          !oliContext?.gates.riskRulesOk
        ) {
          gateFails.push(OLIKELLA_GATE_RISK_RULES);
        }
        if (gateFails.length > 0) {
          addLogEntries([
            {
              id: `signal:olikella-gate:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} OLIkella gate failed: ${gateFails.join(", ")} -> NO TRADE`,
            },
          ]);
          return;
        }
      }
      const hardEnabled = false;
      const softEnabled =
        !isScalpProfile && context.settings.enableSoftGates !== false;
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
          if (
            isGateEnabled(OLIKELLA_GATE_SIGNAL_CHECKLIST) &&
            !oliContext?.gates.signalChecklistOk
          ) {
            hardBlockReasons.push(OLIKELLA_GATE_SIGNAL_CHECKLIST);
          }
          if (
            isGateEnabled(OLIKELLA_GATE_ENTRY_CONDITIONS) &&
            !oliContext?.gates.entryConditionsOk
          ) {
            hardBlockReasons.push(OLIKELLA_GATE_ENTRY_CONDITIONS);
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
      if (
        softEnabled &&
        coreEval.scorePass === false &&
        !isAiMaticProfile &&
        !isAmdProfile &&
        !isScalpProfile
      ) {
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
      let aiMaticMarketAllowed = false;
      let aiMaticTriggerOverride: number | undefined;
      let aiMaticContextForEntry: AiMaticContext | null = null;
      let aiMaticSwingSetup: AiMaticSwingSideSetup | null = null;
      let aiMaticEma200Setup: AiMaticEma200ScalpSideSetup | null = null;
      let aiMaticSwingTfMin: 5 | 15 | undefined;
      if (isAiMaticProfile && aiMaticEval?.pass) {
        const aiMatic = (decision as any)?.aiMatic as AiMaticContext | null;
        if (aiMatic) {
          aiMaticContextForEntry = aiMatic;
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
          const applyEma200Setup = (
            setup: AiMaticEma200ScalpSideSetup
          ) => {
            aiMaticEma200Setup = setup;
            entry = setup.entry;
            entryType = setup.entryType;
            aiMaticMarketAllowed = setup.entryType === "MARKET";
            aiMaticTriggerOverride = undefined;
            addLogEntries([
              {
                id: `ai-matic:ema200:${symbol}:${signalId}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} ema200 ${aiMatic.ema200Scalp?.reason ?? "module"} ${setup.mode} ${side} ${entryType} @ ${formatNumber(entry, 6)}`,
              },
            ]);
          };
          const ema200Setup =
            side === "Buy" ? aiMatic.ema200Scalp?.buy : aiMatic.ema200Scalp?.sell;
          const swingSetup =
            side === "Buy" ? aiMatic.swing?.buy : aiMatic.swing?.sell;
          const preferEma200Reversal =
            ema200Setup?.mode === "AOI_REVERSAL_MARKET";
          if (preferEma200Reversal && ema200Setup?.enabled) {
            applyEma200Setup(ema200Setup);
          } else if (aiMatic.swing?.active && swingSetup?.enabled) {
            aiMaticSwingSetup = swingSetup;
            aiMaticSwingTfMin = aiMatic.swing.activeTfMin;
            if (Number.isFinite(swingSetup.entry) && swingSetup.entry > 0) {
              entry = swingSetup.entry;
            }
            entryType = swingSetup.entryType;
            aiMaticMarketAllowed = false;
            if (
              swingSetup.entryType === "CONDITIONAL" &&
              Number.isFinite(swingSetup.trigger)
            ) {
              aiMaticTriggerOverride = swingSetup.trigger;
            }
            addLogEntries([
              {
                id: `ai-matic:swing:${symbol}:${signalId}`,
                timestamp: new Date(now).toISOString(),
                action: "STATUS",
                message: `${symbol} swing ${aiMatic.swing.reason} ${side} ${entryType} @ ${formatNumber(entry, 6)}`,
              },
            ]);
          } else if (ema200Setup?.enabled) {
            applyEma200Setup(ema200Setup);
          }
        }
      }
      if (isAiMaticProfile && symbol === "ETHUSDT" && side === "Buy") {
        entryType = "LIMIT_MAKER_FIRST";
        aiMaticMarketAllowed = false;
        aiMaticTriggerOverride = undefined;
      }
      const checklistGates = isScalpProfile ? [] : [...coreEval.gates];
      if (isScalpProfile) {
        checklistGates.push({
          name: OLIKELLA_GATE_SIGNAL_CHECKLIST,
          ok: Boolean(oliContext?.gates.signalChecklistOk),
          detail: oliContext?.gates.signalChecklistDetail ?? "no valid OLIkella setup",
        });
        checklistGates.push({
          name: OLIKELLA_GATE_ENTRY_CONDITIONS,
          ok: Boolean(oliContext?.gates.entryConditionsOk),
          detail: oliContext?.gates.entryConditionsDetail ?? "entry conditions missing",
        });
        checklistGates.push({
          name: OLIKELLA_GATE_EXIT_CONDITIONS,
          ok: Boolean(oliContext?.gates.exitConditionsOk),
          detail: oliContext?.gates.exitConditionsDetail ?? "exit lifecycle unavailable",
        });
        checklistGates.push({
          name: OLIKELLA_GATE_RISK_RULES,
          ok: Boolean(oliContext?.gates.riskRulesOk),
          detail:
            oliContext?.gates.riskRulesDetail ??
            "risk 1.5% | max positions 5 | max orders 20",
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
          : isAmdProfile
            ? {
                eligibleCount: amdEval?.gates.length ?? 0,
                passedCount: amdEval?.gates.filter((g) => g.ok).length ?? 0,
                pass: amdEval?.pass === true,
              }
          : isScalpProfile
            ? (() => {
                const eligible = checklistGates.filter((gate) =>
                  isGateEnabled(gate.name)
                );
                const passed = eligible.filter((gate) => gate.ok).length;
                return {
                  eligibleCount: eligible.length,
                  passedCount: passed,
                  pass: eligible.length > 0 ? passed === eligible.length : false,
                };
              })()
          : evaluateChecklistPass(checklistGates);
      if (!checklistExec.pass) {
        const checklistThreshold = isProProfile
          ? checklistExec.eligibleCount
          : isScalpProfile
            ? checklistExec.eligibleCount
          : MIN_CHECKLIST_PASS;
        addLogEntries([
          {
            id: `signal:checklist:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "RISK_BLOCK",
            message: `${symbol} checklist ${checklistExec.passedCount}/${checklistThreshold}`,
          },
        ]);
        return;
      }

      if (entryType === "MARKET") {
        let allowMarket =
          (isAiMaticX && riskOn && xContext?.strongTrendExpanse) ||
          (isAiMaticProfile && aiMaticMarketAllowed);
        if (isAiMaticProfile && symbol === "BTCUSDT") {
          const btcSweepOk =
            side === "Buy"
              ? Boolean(
                  aiMaticContextForEntry?.ltf.sweepLow ||
                    aiMaticContextForEntry?.ltf.fakeoutLow
                )
              : Boolean(
                  aiMaticContextForEntry?.ltf.sweepHigh ||
                    aiMaticContextForEntry?.ltf.fakeoutHigh
                );
          if (!btcSweepOk) {
            allowMarket = false;
          }
        }
        if (isAiMaticProfile && symbol === "ETHUSDT" && side === "Buy") {
          allowMarket = false;
        }
        if (!allowMarket) {
          entryType = isAiMaticProfile ? "LIMIT_MAKER_FIRST" : "LIMIT";
        }
      }
      const triggerPrice =
        entryType === "CONDITIONAL"
          ? Number.isFinite(aiMaticTriggerOverride)
            ? aiMaticTriggerOverride
            : Number.isFinite(signal.triggerPrice)
              ? signal.triggerPrice
              : entry
          : undefined;

      const proTargets = isProProfile ? (signal as any)?.proTargets : null;
      let resolvedSl = sl;
      let resolvedTp = tp;
      let aiMaticTargets: AiMaticTargetPlan | null = null;
      if (isScalpProfile && Number.isFinite(entry) && entry > 0) {
        if (
          (!Number.isFinite(resolvedSl) || resolvedSl <= 0) &&
          Number.isFinite(signal?.intent?.sl)
        ) {
          resolvedSl = toNumber(signal.intent.sl);
        }
        if (
          (!Number.isFinite(resolvedTp) || resolvedTp <= 0) &&
          Number.isFinite(signal?.intent?.tp)
        ) {
          resolvedTp = toNumber(signal.intent.tp);
        }
        if (
          (!Number.isFinite(resolvedSl) || resolvedSl <= 0) &&
          Number.isFinite(core?.atr14) &&
          core!.atr14 > 0
        ) {
          resolvedSl =
            side === "Buy"
              ? entry - core!.atr14 * 1.5
              : entry + core!.atr14 * 1.5;
        }
        if (
          (!Number.isFinite(resolvedTp) || resolvedTp <= 0) &&
          Number.isFinite(resolvedSl) &&
          resolvedSl > 0
        ) {
          const risk = Math.abs(entry - resolvedSl);
          if (Number.isFinite(risk) && risk > 0) {
            resolvedTp = side === "Buy" ? entry + 2 * risk : entry - 2 * risk;
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
          if (aiMaticSwingSetup) {
            if (Number.isFinite(aiMaticSwingSetup.sl) && aiMaticSwingSetup.sl > 0) {
              resolvedSl = aiMaticSwingSetup.sl;
            }
            aiMaticTargets = {
              tp1: aiMaticSwingSetup.tp1,
              tp2: aiMaticSwingSetup.tp2,
            };
            if (Number.isFinite(aiMaticSwingSetup.tp2) && aiMaticSwingSetup.tp2 > 0) {
              resolvedTp = aiMaticSwingSetup.tp2;
            } else if (
              Number.isFinite(aiMaticSwingSetup.tp1) &&
              aiMaticSwingSetup.tp1 > 0
            ) {
              resolvedTp = aiMaticSwingSetup.tp1;
            }
          } else if (aiMaticEma200Setup) {
            if (Number.isFinite(aiMaticEma200Setup.sl) && aiMaticEma200Setup.sl > 0) {
              resolvedSl = aiMaticEma200Setup.sl;
            }
            aiMaticTargets = {
              tp1: aiMaticEma200Setup.tp,
              tp2: aiMaticEma200Setup.tp,
            };
            if (Number.isFinite(aiMaticEma200Setup.tp) && aiMaticEma200Setup.tp > 0) {
              resolvedTp = aiMaticEma200Setup.tp;
            }
          } else {
            const riskParams = resolveAiMaticAdaptiveRiskParams({
              symbol,
              records: closedPnlRecords,
            });
            const nextSl = resolveAiMaticStopLoss({
              side,
              entry,
              currentSl: resolvedSl,
              atr: core?.atr14,
              aiMatic,
              core,
              riskParams,
            });
            if (Number.isFinite(nextSl) && nextSl > 0) {
              resolvedSl = nextSl;
            }
            aiMaticTargets = resolveAiMaticTargetPlan({
              side,
              entry,
              sl: resolvedSl,
              atr: core?.atr14,
              aiMatic,
            });
            if (Number.isFinite(aiMaticTargets.tp2) && aiMaticTargets.tp2 > 0) {
              resolvedTp = aiMaticTargets.tp2;
            } else if (Number.isFinite(aiMaticTargets.tp1) && aiMaticTargets.tp1 > 0) {
              resolvedTp = aiMaticTargets.tp1;
            }
          }
      }

      if (isTreeProfile) {
        const minStopDistance = resolveMinProtectionDistance(entry, core?.atr14);
        const slGate = stopValidityGate(entry, resolvedSl, side, minStopDistance);
        appendTrace("TreeStopValidity", slGate);
        if (!slGate.ok) {
          addLogEntries([
            {
              id: `signal:tree-stop-gate:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "RISK_BLOCK",
              message: `${symbol} TREE stop gate [${slGate.code}]: ${slGate.reason}`,
            },
          ]);
          return;
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
      if (
        isAiMaticProfile &&
        Number.isFinite(resolvedSl) &&
        Number.isFinite(resolvedTp)
      ) {
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

      plannedProtectionRef.current.set(String(symbol).toUpperCase(), {
        sl: resolvedSl,
        setAt: now,
      });

      if (
        isAiMaticProfile &&
        aiMaticTargets &&
        Number.isFinite(aiMaticTargets.tp1) &&
        aiMaticTargets.tp1 > 0
      ) {
        aiMaticTp1Ref.current.set(symbol, {
          entry,
          tp1: aiMaticTargets.tp1,
          tp2:
            Number.isFinite(aiMaticTargets.tp2) && aiMaticTargets.tp2 > 0
              ? aiMaticTargets.tp2
              : aiMaticTargets.tp1,
          side,
          setAt: now,
          partialFraction: aiMaticSwingSetup?.tp1Fraction,
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

      const fixedSizing = computeFixedSizing(symbol as Symbol, entry, resolvedSl);
      const treeUseDynamicSizing =
        !isTreeProfile || settingsRef.current.useDynamicPositionSizing !== false;
      const sizing = isTreeProfile
        ? treeUseDynamicSizing
          ? computeNotionalForSignal(symbol as Symbol, entry, resolvedSl)
          : fixedSizing ??
            computeNotionalForSignal(symbol as Symbol, entry, resolvedSl)
        : fixedSizing ?? computeNotionalForSignal(symbol as Symbol, entry, resolvedSl);
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
      const portfolioScale = resolvePortfolioRiskScale(
        symbol as Symbol,
        side,
        now
      );
      const riskMultiplier = Math.min(
        protectedEntry ? SCALP_PROTECTED_RISK_MULT : 1,
        riskOffMultiplier,
        portfolioScale.scale
      );
      const useFixedQty = isTreeProfile
        ? !treeUseDynamicSizing && fixedSizing?.ok === true
        : fixedSizing?.ok === true;
      const qtyMode = useFixedQty ? "BASE_QTY" : "USDT_NOTIONAL";
      const baseQty = sizing.qty;
      const baseNotional = sizing.notional;
      let adjustedQty =
        Number.isFinite(baseQty) && baseQty > 0 ? baseQty * riskMultiplier : baseQty;
      let adjustedNotional =
        Number.isFinite(baseNotional) && baseNotional > 0
          ? baseNotional * riskMultiplier
          : baseNotional;
      if (
        isAiMaticProfile &&
        aiMaticSwingSetup &&
        Number.isFinite(entry) &&
        entry > 0 &&
        Number.isFinite(adjustedNotional)
      ) {
        adjustedNotional = Math.max(adjustedNotional, AI_MATIC_SWING_MIN_NOTIONAL);
        adjustedQty = adjustedNotional / entry;
      }
      if (!useTestnet && Number.isFinite(entry) && entry > 0) {
        const perTradeMainnetUsd = clampPerTradeUsd(
          settingsRef.current.perTradeMainnetUsd,
          DEFAULT_MAINNET_PER_TRADE_USD
        );
        const leverage = resolveSymbolLeverage(symbol as Symbol);
        const minNotionalByIm = perTradeMainnetUsd * leverage;
        if (
          Number.isFinite(minNotionalByIm) &&
          minNotionalByIm > 0 &&
          Number.isFinite(adjustedNotional) &&
          adjustedNotional < minNotionalByIm
        ) {
          adjustedNotional = minNotionalByIm;
          adjustedQty = adjustedNotional / entry;
        }
      }
      const qtyValue = useFixedQty ? adjustedQty : adjustedNotional;
      const stagedRetestConfig = (signal as any)?.execution?.stagedRetest as
        | {
            enabled?: boolean;
            primaryRatio?: number;
            retestRatio?: number;
            fallbackBars?: number;
            retestLtfMinutes?: number;
          }
        | undefined;
      const stagedRetestEnabled =
        settingsRef.current.riskMode === "ai-matic" &&
        !aiMaticSwingSetup &&
        stagedRetestConfig?.enabled !== false &&
        Number.isFinite(adjustedQty) &&
        adjustedQty > 0;
      const stagedPrimaryRatio = Number.isFinite(stagedRetestConfig?.primaryRatio)
        ? Math.min(0.95, Math.max(0.05, stagedRetestConfig!.primaryRatio as number))
        : AI_MATIC_RETEST_PRIMARY_RATIO;
      const stagedSecondaryRatioRaw = Number.isFinite(stagedRetestConfig?.retestRatio)
        ? (stagedRetestConfig!.retestRatio as number)
        : AI_MATIC_RETEST_SECONDARY_RATIO;
      const stagedSecondaryRatio = Math.max(
        0.01,
        Math.min(0.95, stagedSecondaryRatioRaw)
      );
      const stagedNormalizedTotal = stagedPrimaryRatio + stagedSecondaryRatio;
      const stagedPrimaryWeight =
        stagedRetestEnabled && stagedNormalizedTotal > 0
          ? stagedPrimaryRatio / stagedNormalizedTotal
          : 1;
      const stagedSecondaryWeight =
        stagedRetestEnabled && stagedNormalizedTotal > 0
          ? stagedSecondaryRatio / stagedNormalizedTotal
          : 0;
      const stagedPrimaryQty =
        stagedRetestEnabled && Number.isFinite(adjustedQty)
          ? adjustedQty * stagedPrimaryWeight
          : Number.NaN;
      const stagedSecondaryQty =
        stagedRetestEnabled && Number.isFinite(adjustedQty)
          ? adjustedQty * stagedSecondaryWeight
          : Number.NaN;
      const stagedFallbackBars = Number.isFinite(stagedRetestConfig?.fallbackBars)
        ? Math.max(1, Math.round(stagedRetestConfig!.fallbackBars as number))
        : AI_MATIC_RETEST_FALLBACK_BARS;
      const stagedLtfMin = Number.isFinite(stagedRetestConfig?.retestLtfMinutes)
        ? Math.max(1, Math.round(stagedRetestConfig!.retestLtfMinutes as number))
        : core?.ltfTimeframeMin ?? 5;
      const shouldUseStagedRetest =
        stagedRetestEnabled &&
        Number.isFinite(stagedPrimaryQty) &&
        stagedPrimaryQty > 0 &&
        Number.isFinite(stagedSecondaryQty) &&
        stagedSecondaryQty > 0;
      const primaryEntryType: EntryType = shouldUseStagedRetest
        ? entryType === "CONDITIONAL"
          ? "CONDITIONAL"
          : "LIMIT_MAKER_FIRST"
        : entryType;
      const secondaryEntryType: EntryType = shouldUseStagedRetest
        ? entryType === "CONDITIONAL"
          ? "CONDITIONAL"
          : "LIMIT"
        : entryType;
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
      if (portfolioScale.scale < 0.999) {
        const clusterKey = `cluster:${symbol}:${side}:${portfolioScale.correlatedSymbols.join("|")}:${Math.round(
          portfolioScale.scale * 100
        )}`;
        const last = skipLogThrottleRef.current.get(clusterKey) ?? 0;
        if (now - last >= SKIP_LOG_THROTTLE_MS) {
          skipLogThrottleRef.current.set(clusterKey, now);
          const clusterDetail =
            portfolioScale.correlatedSymbols.length > 0
              ? portfolioScale.correlatedSymbols.join(", ")
              : "none";
          addLogEntries([
            {
              id: `signal:portfolio:${signalId}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} portfolio scale ${Math.round(
                portfolioScale.scale * 100
              )}% | cluster ${portfolioScale.clusterSize} | corr ${formatNumber(
                portfolioScale.strongestCorrelation,
                2
              )} | ${clusterDetail}${
                portfolioScale.altseasonActive || portfolioRegime.active
                  ? " | altseason"
                  : ""
              }`,
            },
          ]);
        }
      }

      const trailOffset = toNumber((decision as any)?.trailOffsetPct);
      const allowScalpTrail = !isScalpProfile;
      if (allowScalpTrail && Number.isFinite(trailOffset) && trailOffset > 0) {
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

      const primaryIntentId = crypto.randomUUID();
      const secondaryIntentId = shouldUseStagedRetest
        ? crypto.randomUUID()
        : undefined;
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
      if (isAiMaticProfile && aiMaticSwingSetup && Number.isFinite(aiMaticSwingTfMin)) {
        const tfMin = aiMaticSwingTfMin as 5 | 15;
        const cooldownBars =
          tfMin === 15
            ? AI_MATIC_SWING_COOLDOWN_BARS_15M
            : AI_MATIC_SWING_COOLDOWN_BARS_5M;
        const cooldownUntil = now + cooldownBars * tfMin * 60_000;
        aiMaticSwingStateRef.current.set(symbol, {
          tfMin,
          beMinR: AI_MATIC_SWING_BE_MIN_R,
          cooldownUntil,
          setAt: now,
        });
      }
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
      const aiMaticLtfMin = Math.max(1, Math.round(core?.ltfTimeframeMin ?? 5));
      const signalExpireAfterMs = isAiMaticProfile
        ? aiMaticLtfMin * AI_MATIC_SIGNAL_EXPIRE_BARS * 60_000
        : 30_000;
      void (async () => {
        try {
          if (shouldUseStagedRetest && secondaryIntentId) {
            await autoTrade({
              symbol: symbol as Symbol,
              side,
              entryPrice: entry,
              entryType: primaryEntryType,
              triggerPrice:
                primaryEntryType === "CONDITIONAL" ? triggerPrice : undefined,
              slPrice: resolvedSl,
              tpPrices,
              qtyMode: "BASE_QTY",
              qtyValue: stagedPrimaryQty,
              intentId: primaryIntentId,
              expireAfterMs: signalExpireAfterMs,
            });
            await autoTrade({
              symbol: symbol as Symbol,
              side,
              entryPrice: entry,
              entryType: secondaryEntryType,
              triggerPrice:
                secondaryEntryType === "CONDITIONAL"
                  ? triggerPrice ?? entry
                  : undefined,
              slPrice: resolvedSl,
              tpPrices,
              qtyMode: "BASE_QTY",
              qtyValue: stagedSecondaryQty,
              intentId: secondaryIntentId,
              expireAfterMs: signalExpireAfterMs,
            });
            const ltfOpenTime = toNumber(core?.ltfOpenTime);
            aiMaticRetestFallbackRef.current.set(symbol, {
              symbol,
              side,
              signalId,
              createdAt: now,
              ltfTimeframeMin: stagedLtfMin,
              lastLtfOpenTime: Number.isFinite(ltfOpenTime)
                ? ltfOpenTime
                : now,
              missedBars: 0,
              fallbackBars: stagedFallbackBars,
              retestIntentId: secondaryIntentId,
              fallbackQty: stagedSecondaryQty,
              slPrice: resolvedSl,
              tpPrices,
              triggerPrice: triggerPrice ?? entry,
              executing: false,
            });
            addLogEntries([
              {
                id: `signal:staged:${signalId}`,
                timestamp: new Date().toISOString(),
                action: "STATUS",
                message: `${symbol} staged entry 60/40 | primary ${primaryEntryType} | retest ${secondaryEntryType}`,
              },
            ]);
          } else {
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
              intentId: primaryIntentId,
              expireAfterMs: signalExpireAfterMs,
            });
          }
          addLogEntries([
            {
              id: `signal:sent:${signalId}`,
              timestamp: new Date().toISOString(),
              action: "STATUS",
              message: `${symbol} intent sent | qty ${formatNumber(
                shouldUseStagedRetest ? adjustedQty : sizing.qty,
                6
              )} | notional ${formatNumber(sizing.notional, 2)}`,
            },
          ]);
        } catch (err) {
          if (isAiMaticProfile && aiMaticSwingSetup) {
            aiMaticSwingStateRef.current.delete(symbol);
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
      dataHealthGate,
      evaluateAiMaticGates,
      evaluateAmdGates,
      evaluateChecklistPass,
      evaluateCoreV2,
      evaluateProGates,
      getEquityValue,
      getSymbolContext,
      handleOliKellaInTrade,
      isActiveEntryOrder,
      isGateEnabled,
      isEntryOrder,
      maybeRunAiMaticRetestFallback,
      postJson,
      queueCapacityRecheck,
      protectionGate,
      resolveDataHealthSnapshot,
      resolvePortfolioRegime,
      resolvePortfolioRiskScale,
      resolveH1M15TrendGate,
      resolveSymbolLeverage,
      shouldEmitBlockLog,
      submitReduceOnlyOrder,
      useTestnet,
    ]
  );

  useEffect(() => {
    handleDecisionRef.current = handleDecision;
  }, [handleDecision]);

  useEffect(() => {
    if (!authToken) return;

    signalSeenRef.current.clear();
    intentPendingRef.current.clear();
    symbolOpenPositionPauseRef.current.clear();
    relayPauseRef.current.paused = false;
    relayPauseRef.current.pausedReason = null;
    relayPauseRef.current.pausedAt = 0;
    relayPauseRef.current.lastCapacityFingerprint = "";
    relayPauseRef.current.forceScanSymbols.clear();
    relayPauseRef.current.forceScanReason = null;
    relayPauseRef.current.lastTtlRecheckAt = 0;
    scalpExitStateRef.current.clear();
    scalpActionCooldownRef.current.clear();
    scalpPartialCooldownRef.current.clear();
    scalpTrailCooldownRef.current.clear();
    oliExtensionCountRef.current.clear();
    oliTrendLegRef.current.clear();
    oliScaleInUsedRef.current.clear();
    aiMaticTp1Ref.current.clear();
    aiMaticSwingStateRef.current.clear();
    aiMaticTrailCooldownRef.current.clear();
    aiMaticRetestFallbackRef.current.clear();
    aiMaticProgressRef.current.clear();
    aiMaticStructureLogRef.current.clear();
    partialExitRef.current.clear();
    proTargetsRef.current.clear();
    proPartialRef.current.clear();
    plannedProtectionRef.current.clear();
    protectionRetryAtRef.current.clear();
    protectionRetryLogRef.current.clear();
    leverageBySymbolRef.current.clear();
    blockDecisionCooldownRef.current.clear();
    entryBlockFingerprintRef.current.clear();
    positionStateSignatureRef.current = "";
    positionSnapshotIdRef.current = 0;
    positionSyncRef.current = { lastEventAt: 0, lastReconcileAt: 0 };
    lastAtomicSyncAtRef.current = 0;
    trailWatermarkRef.current.clear();
    decisionRef.current = {};
    portfolioRegimeRef.current = {
      dominanceHistory: [],
      lastSampleAt: 0,
      snapshot: null,
    };
    setScanDiagnostics(null);

    const riskMode = settingsRef.current.riskMode;
    const isAiMaticX = riskMode === "ai-matic-x";
    const isAiMatic = riskMode === "ai-matic" || riskMode === "ai-matic-tree";
    const isAmd = riskMode === "ai-matic-amd";
    const isAiMaticCore = riskMode === "ai-matic";
    const isScalp = riskMode === "ai-matic-olikella";
    const isPro = riskMode === "ai-matic-pro";
    const decisionFn = (
      symbol: string,
      candles: Parameters<typeof evaluateStrategyForSymbol>[1],
      config?: Partial<BotConfig>
    ) => {
      const baseDecision = isPro
        ? evaluateAiMaticProStrategyForSymbol(symbol, candles, { entryTfMin: 5 })
        : isAmd
          ? evaluateAiMaticAmdStrategyForSymbol(symbol, candles)
        : isAiMaticX
          ? evaluateAiMaticXStrategyForSymbol(symbol, candles)
          : isScalp
            ? evaluateAiMaticOliKellaStrategyForSymbol(symbol, candles)
            : evaluateStrategyForSymbol(symbol, candles, config);
      const resample = createResampleCache(candles);
      const emaTrendPeriod = clampEmaTrendPeriod(
        settingsRef.current.emaTrendPeriod,
        EMA_TREND_PERIOD
      );
      const coreV2 = computeCoreV2Metrics(candles, riskMode, {
        resample,
        emaTrendPeriod,
      });
      if (isPro) {
        return { ...baseDecision, coreV2 };
      }
      const htfTimeframes = isAiMatic || isAmd
        ? AI_MATIC_HTF_TIMEFRAMES_MIN
        : HTF_TIMEFRAMES_MIN;
      const ltfTimeframes = isAiMatic || isAmd
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
        emaPeriod: emaTrendPeriod,
      });
      const scalpContext = isScalp ? undefined : buildScalpContext(candles);
      const aiMaticContext = isAiMaticCore
        ? buildAiMaticContext(candles, baseDecision, coreV2, {
            resample,
            emaTrendPeriod,
          })
        : null;
      const aiMaticOrderflow = isAiMaticCore
        ? getOrderFlowSnapshot(symbol)
        : undefined;
      return {
        ...baseDecision,
        htfTrend,
        ltfTrend,
        emaTrend,
        scalpContext,
        coreV2,
        ...(aiMaticContext ? { aiMatic: aiMaticContext } : {}),
        ...(aiMaticOrderflow ? { orderflow: aiMaticOrderflow } : {}),
      };
    };
    const maxCandles =
      isScalp ? 7000 : isAiMaticX || isAiMatic || isAmd || isPro ? 5000 : undefined;
    const backfill = isAiMaticX
      ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
      : isAiMatic
        ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
        : isAmd
          ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
        : isScalp
          ? {
              enabled: true,
              interval: "15",
              lookbackMinutes: 60 * 24 * 60,
              limit: 1000,
            }
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
        timeframe: isScalp ? "15" : "1",
        configOverrides: engineConfig,
        decisionFn,
        maxCandles,
        backfill,
        orderflow:
          isPro || isAiMaticCore
            ? { enabled: true, depth: 50 }
            : undefined,
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
