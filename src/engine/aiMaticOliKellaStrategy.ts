import {
  EngineDecision,
  EngineSignal,
  State,
  Trend,
  resampleCandles,
  type Candle,
} from "./botEngine";
import { computeATR, computeEma } from "./ta";
import { getOrderFlowSnapshot } from "./orderflow";

export type OliKellaPattern =
  | "WEDGE_POP"
  | "BASE_N_BREAK"
  | "EMA_CROSSBACK"
  | "EMA8_16_CROSS"
  | "H4_STRUCTURE";

type PatternDetection = {
  ok: boolean;
  pattern: OliKellaPattern;
  side: "buy" | "sell";
  stop: number;
  pivot: number;
  detail: string;
};

export type AiMaticOliKellaContext = {
  timeframe: "4h";
  direction: "BUY" | "SELL" | "NONE";
  htfTrendState?: "HTF_STRONG_TREND" | "HTF_WEAK_TREND" | "HTF_NO_TRADE";
  trendOk: boolean;
  htfStructureOk: boolean;
  htfStructureDetail: string;
  trendLegId: string;
  ema10: number;
  atr14: number;
  selectedPattern: OliKellaPattern | null;
  baseBreak: PatternDetection | null;
  wedgePop: PatternDetection | null;
  emaCrossback: PatternDetection | null;
  oppositeCrossbackLong: boolean;
  oppositeCrossbackShort: boolean;
  exhaustion: {
    active: boolean;
    direction: "BUY" | "SELL" | "NONE";
    distancePct: number;
    volumeRatio: number;
  };
  wedgeDrop: {
    againstLong: boolean;
    againstShort: boolean;
  };
  gates: {
    signalChecklistOk: boolean;
    signalChecklistDetail: string;
    entryConditionsOk: boolean;
    entryConditionsDetail: string;
    exitConditionsOk: boolean;
    exitConditionsDetail: string;
    riskRulesOk: boolean;
    riskRulesDetail: string;
  };
  qualityScore?: number;
  qualityThreshold?: number;
  qualityPass?: boolean;
  qualityDetail?: string;
  missingPatternReasons: string[];
  gateFailureReasons: string[];
  dataHealth: {
    ltfOpenTime: number;
    h1OpenTime: number;
    h4OpenTime: number;
    h4SyncOk: boolean;
    detail: string;
  };
  canScaleIn: boolean;
};

const H1_MINUTES = 15;
const H4_MINUTES = 240;
const FIVE_MINUTES_MS = 5 * 60_000;
const H4_MS = H4_MINUTES * 60_000;
const BREAKOUT_PCT = 0.004;
const BREAKOUT_VOLUME_MULT = 1.3;
const EXHAUSTION_DISTANCE_PCT = 0.09;
const EXHAUSTION_VOLUME_MULT = 1.5;
const BASE_MIN = 4;
const BASE_MAX = 12;
const OLIKELLA_SCORE_THRESHOLD = 5;
const OLIKELLA_RRR_TARGET = 1.8;

export type AiMaticOliKellaEvaluationOptions = {
  h1Candles?: Candle[];
  h4Candles?: Candle[];
};

function toTrend(direction: "BUY" | "SELL" | "NONE"): Trend {
  if (direction === "BUY") return Trend.Bull;
  if (direction === "SELL") return Trend.Bear;
  return Trend.Range;
}

function mean(values: number[]) {
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function safeRatio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return Number.NaN;
  }
  return numerator / denominator;
}

function buildSma(values: number[], period: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - period + 1);
    const slice = values.slice(start, index + 1);
    return mean(slice);
  });
}

function mergeTimeframeCandles(primary: Candle[], supplemental?: Candle[]): Candle[] {
  if (!Array.isArray(supplemental) || supplemental.length === 0) return primary;
  const merged = new Map<number, Candle>();
  for (const candle of supplemental) {
    if (!Number.isFinite(candle.openTime)) continue;
    merged.set(candle.openTime, candle);
  }
  for (const candle of primary) {
    if (!Number.isFinite(candle.openTime)) continue;
    merged.set(candle.openTime, candle);
  }
  return Array.from(merged.values()).sort((a, b) => a.openTime - b.openTime);
}

function detectCrossDirection(ema8: number[], ema16: number[]) {
  const last = ema8.length - 1;
  if (last < 0 || !Number.isFinite(ema8[last]) || !Number.isFinite(ema16[last])) {
    return "NONE" as const;
  }
  if (ema8[last] > ema16[last]) return "BUY" as const;
  if (ema8[last] < ema16[last]) return "SELL" as const;
  return "NONE" as const;
}

function resolveH4TimeframeSync(args: {
  ltfBars: Candle[];
  h1Bars: Candle[];
  h4Bars: Candle[];
}) {
  const { ltfBars, h1Bars, h4Bars } = args;
  const ltfOpenTime = Number(ltfBars[ltfBars.length - 1]?.openTime ?? Number.NaN);
  const h1OpenTime = Number(h1Bars[h1Bars.length - 1]?.openTime ?? Number.NaN);
  const h4OpenTime = Number(h4Bars[h4Bars.length - 1]?.openTime ?? Number.NaN);
  if (!Number.isFinite(ltfOpenTime) || !Number.isFinite(h4OpenTime)) {
    return {
      ltfOpenTime,
      h1OpenTime,
      h4OpenTime,
      h4SyncOk: false,
      detail: "missing timeframe timestamps (H4 vs 5m)",
    };
  }
  const expectedH4Open = Math.floor(ltfOpenTime / H4_MS) * H4_MS;
  const driftMs = Math.abs(h4OpenTime - expectedH4Open);
  const h4SyncOk = driftMs <= FIVE_MINUTES_MS;
  return {
    ltfOpenTime,
    h1OpenTime,
    h4OpenTime,
    h4SyncOk,
    detail: h4SyncOk
      ? `H4 synced to 5m (${Math.round(driftMs / 60_000)}m drift)`
      : `H4/5m desync ${Math.round(driftMs / 60_000)}m`,
  };
}

function detectEma8Ema16Entry(args: {
  bars: Candle[];
  ema8: number[];
  ema16: number[];
  side: "buy" | "sell";
}): PatternDetection | null {
  const { bars, ema8, ema16, side } = args;
  const last = bars.length - 1;
  if (last < 1) return null;
  const prev8 = ema8[last - 1];
  const prev16 = ema16[last - 1];
  const curr8 = ema8[last];
  const curr16 = ema16[last];
  if (
    !Number.isFinite(prev8) ||
    !Number.isFinite(prev16) ||
    !Number.isFinite(curr8) ||
    !Number.isFinite(curr16)
  ) {
    return null;
  }
  const longCross = prev8 <= prev16 && curr8 > curr16;
  const shortCross = prev8 >= prev16 && curr8 < curr16;
  const triggered = side === "buy" ? longCross : shortCross;
  if (!triggered) return null;
  const lookback = bars.slice(Math.max(0, last - 8), last + 1);
  const stop =
    side === "buy"
      ? Math.min(...lookback.map((bar) => bar.low))
      : Math.max(...lookback.map((bar) => bar.high));
  return {
    ok: true,
    pattern: "EMA8_16_CROSS",
    side,
    stop,
    pivot: bars[last].close,
    detail:
      side === "buy"
        ? "15m EMA8 crossed above EMA16"
        : "15m EMA8 crossed below EMA16",
  };
}

function detectEma8Ema16Continuation(args: {
  bars: Candle[];
  ema8: number[];
  ema16: number[];
  side: "buy" | "sell";
}): PatternDetection | null {
  const { bars, ema8, ema16, side } = args;
  const last = bars.length - 1;
  if (last < 1) return null;
  const prev8 = ema8[last - 1];
  const prev16 = ema16[last - 1];
  const curr8 = ema8[last];
  const curr16 = ema16[last];
  if (
    !Number.isFinite(prev8) ||
    !Number.isFinite(prev16) ||
    !Number.isFinite(curr8) ||
    !Number.isFinite(curr16)
  ) {
    return null;
  }
  const alignedNow = side === "buy" ? curr8 > curr16 : curr8 < curr16;
  const alignedPrev = side === "buy" ? prev8 > prev16 : prev8 < prev16;
  if (!alignedNow || !alignedPrev) return null;
  const lookback = bars.slice(Math.max(0, last - 8), last + 1);
  const stop =
    side === "buy"
      ? Math.min(...lookback.map((bar) => bar.low))
      : Math.max(...lookback.map((bar) => bar.high));
  return {
    ok: true,
    pattern: "EMA8_16_CROSS",
    side,
    stop,
    pivot: bars[last].close,
    detail:
      side === "buy"
        ? "15m EMA8 stays above EMA16"
        : "15m EMA8 stays below EMA16",
  };
}

function detectBaseNBreak(args: {
  bars: Candle[];
  ema10: number[];
  ema20: number[];
  volumeSma20: number[];
  side: "buy" | "sell";
}): PatternDetection | null {
  const { bars, ema10, ema20, volumeSma20, side } = args;
  const last = bars.length - 1;
  if (last < BASE_MAX + 1) return null;
  const signal = bars[last];
  for (let baseSize = BASE_MAX; baseSize >= BASE_MIN; baseSize -= 1) {
    const baseStart = last - baseSize;
    const baseEnd = last - 1;
    if (baseStart < 1) continue;
    const base = bars.slice(baseStart, baseEnd + 1);
    const baseEma10 = ema10.slice(baseStart, baseEnd + 1);
    const baseEma20 = ema20.slice(baseStart, baseEnd + 1);
    const highs = base.map((bar) => bar.high);
    const lows = base.map((bar) => bar.low);
    const closes = base.map((bar) => bar.close);
    const pivot = side === "buy" ? Math.max(...highs) : Math.min(...lows);
    const baseLow = Math.min(...lows);
    const baseHigh = Math.max(...highs);
    const rangePct = safeRatio(baseHigh - baseLow, mean(closes));
    if (!Number.isFinite(rangePct) || rangePct > 0.08) continue;
    const nearEma = base.every((bar, idx) => {
      const zoneLow = Math.min(baseEma10[idx], baseEma20[idx]) * 0.98;
      const zoneHigh = Math.max(baseEma10[idx], baseEma20[idx]) * 1.02;
      return bar.close >= zoneLow && bar.close <= zoneHigh;
    });
    if (!nearEma) continue;
    const breakoutOk =
      side === "buy"
        ? signal.close >= pivot * (1 + BREAKOUT_PCT)
        : signal.close <= pivot * (1 - BREAKOUT_PCT);
    if (!breakoutOk) continue;
    const volSma = volumeSma20[last];
    const volOk =
      Number.isFinite(volSma) &&
      volSma > 0 &&
      signal.volume >= volSma * BREAKOUT_VOLUME_MULT;
    if (!volOk) continue;
    const stop = side === "buy" ? baseLow : baseHigh;
    return {
      ok: true,
      pattern: "BASE_N_BREAK",
      side,
      stop,
      pivot,
      detail: `size ${baseSize} | breakout 0.4% | vol>=1.3x`,
    };
  }
  return null;
}

function detectWedgePop(args: {
  bars: Candle[];
  ema10: number[];
  ema20: number[];
  volumeSma20: number[];
  side: "buy" | "sell";
}): PatternDetection | null {
  const { bars, ema10, ema20, volumeSma20, side } = args;
  const lastIdx = bars.length - 1;
  const SETUP_LEN = 6;

  // 1. Validation: Need enough history
  if (lastIdx < SETUP_LEN + 2) return null;

  // 2. Define Setup Phase (consolidation before pop)
  const setupBars = bars.slice(lastIdx - SETUP_LEN, lastIdx);

  // 3. Check Volatility Contraction (Ranges getting smaller)
  const ranges = setupBars.map((bar) => bar.high - bar.low);
  const firstHalfAvg = mean(ranges.slice(0, SETUP_LEN / 2));
  const secondHalfAvg = mean(ranges.slice(SETUP_LEN / 2));

  if (!Number.isFinite(firstHalfAvg) || !Number.isFinite(secondHalfAvg)) {
    return null;
  }
  // Expect second half range to be at most 85% of first half
  if (secondHalfAvg > firstHalfAvg * 0.85) return null;

  // 4. Check Price Narrowing (Triangle formation)
  const highs = setupBars.map((bar) => bar.high);
  const lows = setupBars.map((bar) => bar.low);

  const firstHigh = Math.max(...highs.slice(0, SETUP_LEN / 2));
  const secondHigh = Math.max(...highs.slice(SETUP_LEN / 2));
  const firstLow = Math.min(...lows.slice(0, SETUP_LEN / 2));
  const secondLow = Math.min(...lows.slice(SETUP_LEN / 2));

  // Logic: Lower Highs AND Higher Lows (Symmetrical Wedge)
  const isNarrowing = secondHigh <= firstHigh && secondLow >= firstLow;
  if (!isNarrowing) return null;

  // 5. Check EMA Adherence (Price hugging EMA10/20)
  const isNearEma = setupBars.every((bar, i) => {
    const idx = lastIdx - SETUP_LEN + i;
    const e10 = ema10[idx];
    const e20 = ema20[idx];
    // Tolerance +/- 1.2% around the EMA band
    const bandLow = Math.min(e10, e20) * 0.988;
    const bandHigh = Math.max(e10, e20) * 1.012;
    return bar.close >= bandLow && bar.close <= bandHigh;
  });
  if (!isNearEma) return null;

  // 6. Check Breakout Signal
  const signalBar = bars[lastIdx];
  const pivotHigh = Math.max(...highs);
  const pivotLow = Math.min(...lows);
  const pivot = side === "buy" ? pivotHigh : pivotLow;

  const isBreakout =
    side === "buy"
      ? signalBar.close >= pivot * (1 + BREAKOUT_PCT)
      : signalBar.close <= pivot * (1 - BREAKOUT_PCT);
  if (!isBreakout) return null;

  // 7. Check Volume Confirmation
  const volSma = volumeSma20[lastIdx];
  const isVolumeOk =
    Number.isFinite(volSma) &&
    volSma > 0 &&
    signalBar.volume >= volSma * BREAKOUT_VOLUME_MULT;
  if (!isVolumeOk) return null;

  return {
    ok: true,
    pattern: "WEDGE_POP",
    side,
    stop: side === "buy" ? pivotLow : pivotHigh,
    pivot,
    detail: `narrowing wedge | breakout 0.4% | vol>=1.3x`,
  };
}

function detectH4StructurePattern(args: {
  bars: Candle[];
  side: "buy" | "sell";
}): PatternDetection | null {
  const { bars, side } = args;
  const last = bars.length - 1;
  const SETUP_LEN = 8;
  if (last < SETUP_LEN + 1) return null;
  const setup = bars.slice(last - SETUP_LEN, last + 1);
  const half = Math.floor(setup.length / 2);
  if (half < 2) return null;

  const first = setup.slice(0, half);
  const second = setup.slice(half);
  const firstHigh = Math.max(...first.map((bar) => bar.high));
  const secondHigh = Math.max(...second.map((bar) => bar.high));
  const firstLow = Math.min(...first.map((bar) => bar.low));
  const secondLow = Math.min(...second.map((bar) => bar.low));
  const narrowing = secondHigh <= firstHigh && secondLow >= firstLow;
  if (!narrowing) return null;

  const stop =
    side === "buy"
      ? Math.min(...setup.map((bar) => bar.low))
      : Math.max(...setup.map((bar) => bar.high));
  return {
    ok: true,
    pattern: "H4_STRUCTURE",
    side,
    stop,
    pivot: bars[last].close,
    detail: "H4 structure compression (higher lows + lower highs)",
  };
}

function detectEmaCrossback(args: {
  bars: Candle[];
  ema10: number[];
  ema20: number[];
  side: "buy" | "sell";
}): PatternDetection | null {
  const { bars, ema10, ema20, side } = args;
  const last = bars.length - 1;
  if (last < 12) return null;
  const signal = bars[last];
  const lookback = bars.slice(last - 8, last);
  const zoneTouches = lookback
    .map((bar, idx) => {
      const sourceIdx = last - 8 + idx;
      // Relaxed from 0.3% to 0.6% to catch near-miss pullbacks
      const zoneLow = Math.min(ema10[sourceIdx], ema20[sourceIdx]) * 0.994;
      const zoneHigh = Math.max(ema10[sourceIdx], ema20[sourceIdx]) * 1.006;
      const touched = bar.low <= zoneHigh && bar.high >= zoneLow;
      return { touched, bar };
    })
    .filter((item) => item.touched);
  if (zoneTouches.length < 2 || zoneTouches.length > 8) return null;
  const rejectionOk =
    side === "buy"
      ? signal.close > signal.open && signal.close > ema10[last]
      : signal.close < signal.open && signal.close < ema10[last];
  if (!rejectionOk) return null;
  const stop =
    side === "buy"
      ? Math.min(...zoneTouches.map((item) => item.bar.low))
      : Math.max(...zoneTouches.map((item) => item.bar.high));
  return {
    ok: true,
    pattern: "EMA_CROSSBACK",
    side,
    stop,
    pivot: signal.close,
    detail: `pullback 2-8 bars into EMA10/20`,
  };
}

function detectExhaustion(args: {
  close: number;
  ema10: number;
  volume: number;
  volumeSma20: number;
}) {
  const { close, ema10, volume, volumeSma20 } = args;
  const distancePct = safeRatio(Math.abs(close - ema10), ema10);
  const volumeRatio = safeRatio(volume, volumeSma20);
  const active =
    Number.isFinite(distancePct) &&
    distancePct >= EXHAUSTION_DISTANCE_PCT &&
    Number.isFinite(volumeRatio) &&
    volumeRatio >= EXHAUSTION_VOLUME_MULT;
  const direction =
    close > ema10 ? "BUY" : close < ema10 ? "SELL" : "NONE";
  return { active, direction: active ? direction : "NONE", distancePct, volumeRatio } as const;
}

function detectWedgeDrop(args: {
  bars: Candle[];
  ema20: number[];
  volumeSma20: number[];
}) {
  const { bars, ema20, volumeSma20 } = args;
  const last = bars.length - 1;
  if (last < 8) return { againstLong: false, againstShort: false };
  const setup = bars.slice(last - 6, last);
  const ranges = setup.map((bar) => bar.high - bar.low);
  const narrowing = mean(ranges.slice(-3)) <= mean(ranges.slice(0, 3)) * 0.8;
  if (!narrowing) return { againstLong: false, againstShort: false };
  const signal = bars[last];
  const volSma = volumeSma20[last];
  const volOk =
    Number.isFinite(volSma) &&
    volSma > 0 &&
    signal.volume >= volSma * BREAKOUT_VOLUME_MULT;
  if (!volOk) return { againstLong: false, againstShort: false };
  const setupLow = Math.min(...setup.map((bar) => bar.low));
  const setupHigh = Math.max(...setup.map((bar) => bar.high));
  const ema = ema20[last];
  return {
    againstLong:
      signal.close < setupLow &&
      Number.isFinite(ema) &&
      signal.close < ema,
    againstShort:
      signal.close > setupHigh &&
      Number.isFinite(ema) &&
      signal.close > ema,
  };
}

function resolveSwingTrend(bars: Candle[]) {
  if (bars.length < 10) return "NONE" as const;
  const highs: { index: number; value: number }[] = [];
  const lows: { index: number; value: number }[] = [];
  for (let i = 2; i < bars.length - 2; i += 1) {
    const high = bars[i].high;
    const low = bars[i].low;
    const isPivotHigh =
      high >= bars[i - 1].high &&
      high >= bars[i - 2].high &&
      high >= bars[i + 1].high &&
      high >= bars[i + 2].high;
    const isPivotLow =
      low <= bars[i - 1].low &&
      low <= bars[i - 2].low &&
      low <= bars[i + 1].low &&
      low <= bars[i + 2].low;
    if (isPivotHigh) highs.push({ index: i, value: high });
    if (isPivotLow) lows.push({ index: i, value: low });
  }
  if (highs.length < 2 || lows.length < 2) return "NONE" as const;
  const lastHigh = highs[highs.length - 1].value;
  const prevHigh = highs[highs.length - 2].value;
  const lastLow = lows[lows.length - 1].value;
  const prevLow = lows[lows.length - 2].value;
  if (lastHigh > prevHigh && lastLow > prevLow) return "BULL" as const;
  if (lastHigh < prevHigh && lastLow < prevLow) return "BEAR" as const;
  return "NONE" as const;
}

function resolveHtfTrendState(args: {
  h4: Candle[];
  ema50: number[];
  ema200: number[];
}) {
  const { h4, ema50, ema200 } = args;
  const last = h4.length - 1;
  const close = h4[last]?.close ?? Number.NaN;
  const e50 = ema50[last];
  const e200 = ema200[last];
  const swing = resolveSwingTrend(h4.slice(-40));
  const longStrong =
    Number.isFinite(e50) &&
    Number.isFinite(e200) &&
    Number.isFinite(close) &&
    e50 > e200 &&
    close > e50 &&
    swing === "BULL";
  const shortStrong =
    Number.isFinite(e50) &&
    Number.isFinite(e200) &&
    Number.isFinite(close) &&
    e50 < e200 &&
    close < e50 &&
    swing === "BEAR";
  const longWeak = Number.isFinite(e50) && Number.isFinite(e200) && e50 > e200;
  const shortWeak = Number.isFinite(e50) && Number.isFinite(e200) && e50 < e200;
  if (longStrong) {
    return {
      state: "HTF_STRONG_TREND" as const,
      direction: "BUY" as const,
      detail: "EMA50>EMA200 | close>EMA50 | HH+HL",
    };
  }
  if (shortStrong) {
    return {
      state: "HTF_STRONG_TREND" as const,
      direction: "SELL" as const,
      detail: "EMA50<EMA200 | close<EMA50 | LL+LH",
    };
  }
  if (longWeak) {
    return {
      state: "HTF_WEAK_TREND" as const,
      direction: "BUY" as const,
      detail: "EMA50>EMA200 without full structure confirmation",
    };
  }
  if (shortWeak) {
    return {
      state: "HTF_WEAK_TREND" as const,
      direction: "SELL" as const,
      detail: "EMA50<EMA200 without full structure confirmation",
    };
  }
  return {
    state: "HTF_NO_TRADE" as const,
    direction: "NONE" as const,
    detail: "EMA trend invalid",
  };
}

function resolveConfirmationCandle(args: {
  bars: Candle[];
  direction: "BUY" | "SELL" | "NONE";
}) {
  const { bars, direction } = args;
  const last = bars.length - 1;
  if (last < 1 || direction === "NONE") return false;
  const curr = bars[last];
  if (direction === "BUY") {
    return curr.close > curr.open;
  }
  return curr.close < curr.open;
}

function toSignal(args: {
  symbol: string;
  side: "buy" | "sell";
  pattern: PatternDetection;
  entry: number;
  atr: number;
}): EngineSignal | null {
  const { symbol, side, pattern, entry, atr } = args;
  const atrBuffer = Number.isFinite(atr) && atr > 0 ? atr * 0.2 : 0;
  let stopRaw = side === "buy" ? pattern.stop - atrBuffer : pattern.stop + atrBuffer;
  if (!Number.isFinite(stopRaw) || stopRaw <= 0) {
    const fallbackDistance = Number.isFinite(atr) && atr > 0 ? atr * 1.2 : entry * 0.006;
    if (!Number.isFinite(fallbackDistance) || fallbackDistance <= 0) return null;
    stopRaw = side === "buy" ? Math.max(entry - fallbackDistance, entry * 0.1) : entry + fallbackDistance;
  }
  const rawRisk = Math.abs(entry - stopRaw);
  const maxRisk = entry * 0.45;
  const risk = Math.min(rawRisk, maxRisk);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  if (side === "buy" && stopRaw >= entry) {
    stopRaw = entry - risk;
  }
  if (side === "sell" && stopRaw <= entry) {
    stopRaw = entry + risk;
  }
  const rawTp =
    side === "buy" ? entry + risk * OLIKELLA_RRR_TARGET : entry - risk * OLIKELLA_RRR_TARGET;
  const tp = rawTp > 0 ? rawTp : entry * 0.1;
  if (!Number.isFinite(stopRaw) || stopRaw <= 0) return null;
  if (!Number.isFinite(tp) || tp <= 0) return null;
  const kind = pattern.pattern === "EMA_CROSSBACK" ? "PULLBACK" : "BREAKOUT";
  return {
    id: `${symbol}:olikella:${Date.now()}`,
    symbol,
    intent: { side, entry, sl: stopRaw, tp },
    kind,
    entryType: pattern.pattern === "EMA_CROSSBACK" ? "LIMIT_MAKER_FIRST" : "CONDITIONAL",
    risk: 1.5,
    message: `OLIkella ${pattern.pattern} ${side.toUpperCase()} | ${pattern.detail}`,
    createdAt: new Date().toISOString(),
  };
}

export function evaluateAiMaticOliKellaStrategyForSymbol(
  symbol: string,
  candles: Candle[],
  options?: AiMaticOliKellaEvaluationOptions
): EngineDecision {
  const h4 = mergeTimeframeCandles(
    resampleCandles(candles, H4_MINUTES),
    options?.h4Candles
  );
  const h1 = mergeTimeframeCandles(
    resampleCandles(candles, H1_MINUTES),
    options?.h1Candles
  );
  if (h4.length < 40) {
    return {
      state: State.Scan,
      trend: Trend.Range,
      trendH1: Trend.Range,
      trendScore: 0,
      trendAdx: Number.NaN,
      signal: null,
      halted: true,
      oliKella: {
        timeframe: "4h",
        direction: "NONE",
        trendOk: false,
        htfStructureOk: false,
        htfStructureDetail: "missing H4 structure",
        trendLegId: "NONE",
        ema10: Number.NaN,
        atr14: Number.NaN,
        selectedPattern: null,
        baseBreak: null,
        wedgePop: null,
        emaCrossback: null,
        oppositeCrossbackLong: false,
        oppositeCrossbackShort: false,
        exhaustion: {
          active: false,
          direction: "NONE",
          distancePct: Number.NaN,
          volumeRatio: Number.NaN,
        },
        wedgeDrop: {
          againstLong: false,
          againstShort: false,
        },
        gates: {
          signalChecklistOk: false,
          signalChecklistDetail: "need >=40 H4 bars",
          entryConditionsOk: false,
          entryConditionsDetail: "insufficient 4h history",
          exitConditionsOk: false,
          exitConditionsDetail: "insufficient 4h history",
          riskRulesOk: true,
          riskRulesDetail: "1.5% risk | RRR 1.8 | max positions 5 | max orders 20",
        },
        missingPatternReasons: ["need >=40 H4 bars"],
        gateFailureReasons: ["H4_HISTORY_INSUFFICIENT"],
        dataHealth: {
          ltfOpenTime: Number(candles[candles.length - 1]?.openTime ?? Number.NaN),
          h1OpenTime: Number.NaN,
          h4OpenTime: Number.NaN,
          h4SyncOk: false,
          detail: "missing timeframe timestamps (H4 vs 5m)",
        },
        canScaleIn: false,
      } satisfies AiMaticOliKellaContext,
    };
  }

  const h1Closes = h1.map((bar) => bar.close);
  const h1Highs = h1.map((bar) => bar.high);
  const h1Lows = h1.map((bar) => bar.low);
  const h1Volumes = h1.map((bar) => bar.volume);
  const h1Ema8 = computeEma(h1Closes, 8);
  const h1Ema16 = computeEma(h1Closes, 16);
  const h1Atr = computeATR(h1Highs, h1Lows, h1Closes, 14);
  const h1VolumeSma20 = buildSma(h1Volumes, 20);
  const lastH1 = h1.length - 1;

  const h4Closes = h4.map((bar) => bar.close);
  const h4Highs = h4.map((bar) => bar.high);
  const h4Lows = h4.map((bar) => bar.low);
  const h4Volumes = h4.map((bar) => bar.volume);
  const h4Ema10 = computeEma(h4Closes, 10);
  const h4Ema20 = computeEma(h4Closes, 20);
  const h4Ema50 = computeEma(h4Closes, 50);
  const h4Ema200 = computeEma(h4Closes, 200);
  const h4VolumeSma20 = buildSma(h4Volumes, 20);
  const lastH4 = h4.length - 1;
  const direction = detectCrossDirection(h1Ema8, h1Ema16);
  const trendOk = direction !== "NONE";
  const htfTrend = resolveHtfTrendState({
    h4,
    ema50: h4Ema50,
    ema200: h4Ema200,
  });
  const orderflow = getOrderFlowSnapshot(symbol) as {
    bidAskImbalance?: number;
    askBidImbalance?: number;
    topWallRatio?: number;
    spreadPct?: number;
    buyVolume?: number;
    sellVolume?: number;
    buySellRatio?: number;
    sellBuyRatio?: number;
    bestBid?: number;
    bestAsk?: number;
    openInterestChangePct?: number;
  };

  const crossEntryLong = detectEma8Ema16Entry({
    bars: h1,
    ema8: h1Ema8,
    ema16: h1Ema16,
    side: "buy",
  });
  const crossEntryShort = detectEma8Ema16Entry({
    bars: h1,
    ema8: h1Ema8,
    ema16: h1Ema16,
    side: "sell",
  });
  const continuationLong = detectEma8Ema16Continuation({
    bars: h1,
    ema8: h1Ema8,
    ema16: h1Ema16,
    side: "buy",
  });
  const continuationShort = detectEma8Ema16Continuation({
    bars: h1,
    ema8: h1Ema8,
    ema16: h1Ema16,
    side: "sell",
  });
  const baseBreakLong = detectBaseNBreak({
    bars: h4,
    ema10: h4Ema10,
    ema20: h4Ema20,
    volumeSma20: h4VolumeSma20,
    side: "buy",
  });
  const baseBreakShort = detectBaseNBreak({
    bars: h4,
    ema10: h4Ema10,
    ema20: h4Ema20,
    volumeSma20: h4VolumeSma20,
    side: "sell",
  });
  const wedgePopLong = detectWedgePop({
    bars: h4,
    ema10: h4Ema10,
    ema20: h4Ema20,
    volumeSma20: h4VolumeSma20,
    side: "buy",
  });
  const wedgePopShort = detectWedgePop({
    bars: h4,
    ema10: h4Ema10,
    ema20: h4Ema20,
    volumeSma20: h4VolumeSma20,
    side: "sell",
  });
  const crossbackLong = detectEmaCrossback({
    bars: h4,
    ema10: h4Ema10,
    ema20: h4Ema20,
    side: "buy",
  });
  const crossbackShort = detectEmaCrossback({
    bars: h4,
    ema10: h4Ema10,
    ema20: h4Ema20,
    side: "sell",
  });
  const structureLong = detectH4StructurePattern({
    bars: h4,
    side: "buy",
  });
  const structureShort = detectH4StructurePattern({
    bars: h4,
    side: "sell",
  });
  const h4PriorityLong = [wedgePopLong, baseBreakLong, crossbackLong].filter(
    (item): item is PatternDetection => Boolean(item?.ok)
  );
  const h4PriorityShort = [wedgePopShort, baseBreakShort, crossbackShort].filter(
    (item): item is PatternDetection => Boolean(item?.ok)
  );
  const selectedH4Pattern =
    direction === "BUY"
      ? h4PriorityLong[0] ?? null
      : direction === "SELL"
        ? h4PriorityShort[0] ?? null
        : null;
  const structurePattern =
    direction === "BUY"
      ? structureLong
      : direction === "SELL"
        ? structureShort
        : null;
  const htfStructureOk = Boolean(structurePattern?.ok);
  const selectedCross =
    direction === "BUY"
      ? crossEntryLong ?? continuationLong
      : direction === "SELL"
        ? crossEntryShort ?? continuationShort
        : null;
  const exhaustion = detectExhaustion({
    close: h4Closes[lastH4],
    ema10: h4Ema10[lastH4],
    volume: h4Volumes[lastH4],
    volumeSma20: h4VolumeSma20[lastH4],
  });
  const wedgeDrop = detectWedgeDrop({
    bars: h4,
    ema20: h4Ema20,
    volumeSma20: h4VolumeSma20,
  });
  const timeframeSync = resolveH4TimeframeSync({
    ltfBars: candles,
    h1Bars: h1,
    h4Bars: h4,
  });

  const signalIdx = lastH1 - 1;
  const signalBar = signalIdx >= 0 ? h1[signalIdx] : undefined;
  const prevSignalBar = signalIdx - 1 >= 0 ? h1[signalIdx - 1] : undefined;
  const twoBackSignalBar = signalIdx - 2 >= 0 ? h1[signalIdx - 2] : undefined;
  const confirmBar = lastH1 >= 0 ? h1[lastH1] : undefined;
  const signalAtr = signalIdx >= 0 ? h1Atr[signalIdx] : Number.NaN;
  const signalVolumeSma = signalIdx >= 0 ? h1VolumeSma20[signalIdx] : Number.NaN;
  const atrReady = Number.isFinite(signalAtr) && signalAtr > 0;
  const lookbackStart = Math.max(0, signalIdx - 12);
  const priorHigh = signalIdx > 0 ? Math.max(...h1Highs.slice(lookbackStart, signalIdx)) : Number.NaN;
  const priorLow = signalIdx > 0 ? Math.min(...h1Lows.slice(lookbackStart, signalIdx)) : Number.NaN;
  const sweepWickLong =
    signalBar ? Math.max(0, Math.min(signalBar.open, signalBar.close) - signalBar.low) : Number.NaN;
  const sweepWickShort =
    signalBar ? Math.max(0, signalBar.high - Math.max(signalBar.open, signalBar.close)) : Number.NaN;
  const bidAskRatio = Number(orderflow.bidAskImbalance ?? Number.NaN);
  const askBidRatio = Number(orderflow.askBidImbalance ?? Number.NaN);
  const orderbookDataAvailable = Boolean(
    Number.isFinite(Number(orderflow.bestBid ?? Number.NaN)) &&
      Number.isFinite(Number(orderflow.bestAsk ?? Number.NaN)) &&
      Number.isFinite(Number(orderflow.spreadPct ?? Number.NaN))
  );
  const microFlowDataAvailable = Boolean(
    Number(orderflow.buyVolume ?? 0) + Number(orderflow.sellVolume ?? 0) > 0
  );
  const oiDataAvailable = Number.isFinite(
    Number(orderflow.openInterestChangePct ?? Number.NaN)
  );
  const bidDominance = Number.isFinite(bidAskRatio) && bidAskRatio > 0 ? bidAskRatio / (1 + bidAskRatio) : 0;
  const askDominance = Number.isFinite(askBidRatio) && askBidRatio > 0 ? askBidRatio / (1 + askBidRatio) : 0;
  const sweepLongOk = Boolean(
    signalBar &&
      atrReady &&
      Number.isFinite(priorLow) &&
      signalBar.low < priorLow &&
      signalBar.close > priorLow &&
      sweepWickLong > signalAtr * 1.2 &&
      Number.isFinite(signalVolumeSma) &&
      signalVolumeSma > 0 &&
      signalBar.volume > signalVolumeSma &&
      bidDominance >= 0.6
  );
  const sweepShortOk = Boolean(
    signalBar &&
      atrReady &&
      Number.isFinite(priorHigh) &&
      signalBar.high > priorHigh &&
      signalBar.close < priorHigh &&
      sweepWickShort > signalAtr * 1.2 &&
      Number.isFinite(signalVolumeSma) &&
      signalVolumeSma > 0 &&
      signalBar.volume > signalVolumeSma &&
      askDominance >= 0.6
  );
  const bodySize =
    signalBar ? Math.abs(signalBar.close - signalBar.open) : Number.NaN;
  const candleRange =
    signalBar ? Math.max(signalBar.high - signalBar.low, 1e-12) : Number.NaN;
  const bodyPct =
    Number.isFinite(bodySize) && Number.isFinite(candleRange)
      ? bodySize / candleRange
      : Number.NaN;
  const displacement =
    signalBar && prevSignalBar
      ? Math.abs(signalBar.close - prevSignalBar.close)
      : Number.NaN;
  const bosLongOk = Boolean(
    signalBar &&
      prevSignalBar &&
      atrReady &&
      signalBar.close > prevSignalBar.high &&
      bodyPct >= 0.55 &&
      Number.isFinite(displacement) &&
      displacement > signalAtr
  );
  const bosShortOk = Boolean(
    signalBar &&
      prevSignalBar &&
      atrReady &&
      signalBar.close < prevSignalBar.low &&
      bodyPct >= 0.55 &&
      Number.isFinite(displacement) &&
      displacement > signalAtr
  );
  const longFvgSize =
    signalBar && twoBackSignalBar ? signalBar.low - twoBackSignalBar.high : Number.NaN;
  const shortFvgSize =
    signalBar && twoBackSignalBar ? twoBackSignalBar.low - signalBar.high : Number.NaN;
  const longFvgMid =
    Number.isFinite(longFvgSize) && signalBar && twoBackSignalBar
      ? twoBackSignalBar.high + longFvgSize * 0.5
      : Number.NaN;
  const shortFvgMid =
    Number.isFinite(shortFvgSize) && signalBar && twoBackSignalBar
      ? signalBar.high + shortFvgSize * 0.5
      : Number.NaN;
  const fvgLongCore = Boolean(
    atrReady &&
      bosLongOk &&
      Number.isFinite(longFvgSize) &&
      longFvgSize >= signalAtr * 0.2
  );
  const fvgShortCore = Boolean(
    atrReady &&
      bosShortOk &&
      Number.isFinite(shortFvgSize) &&
      shortFvgSize >= signalAtr * 0.2
  );
  const pullbackOverlap = Boolean(
    signalBar &&
      confirmBar &&
      Math.max(signalBar.low, confirmBar.low) <= Math.min(signalBar.high, confirmBar.high)
  );
  const pullbackVolumeDown = Boolean(
    signalBar && confirmBar && confirmBar.volume <= signalBar.volume
  );
  const pullbackImpulse = Boolean(
    signalBar &&
      confirmBar &&
      Math.abs(confirmBar.close - confirmBar.open) >= Math.abs(signalBar.close - signalBar.open) * 0.9
  );
  const pullbackCorrective = pullbackOverlap && pullbackVolumeDown && !pullbackImpulse;
  const fvgLongOk = Boolean(
    fvgLongCore &&
      confirmBar &&
      Number.isFinite(longFvgMid) &&
      confirmBar.low >= longFvgMid
  );
  const fvgShortOk = Boolean(
    fvgShortCore &&
      confirmBar &&
      Number.isFinite(shortFvgMid) &&
      confirmBar.high <= shortFvgMid
  );
  const pullbackLongOk = Boolean(fvgLongOk && pullbackCorrective);
  const pullbackShortOk = Boolean(fvgShortOk && pullbackCorrective);
  const orderbookLongOk = Boolean(
    Number.isFinite(bidAskRatio) &&
      bidAskRatio >= 1.35 &&
      Number(orderflow.topWallRatio ?? 0) >= 2.2 &&
      Number.isFinite(Number(orderflow.spreadPct ?? Number.NaN)) &&
      Number(orderflow.spreadPct) < 0.05
  );
  const orderbookShortOk = Boolean(
    Number.isFinite(askBidRatio) &&
      askBidRatio >= 1.35 &&
      Number(orderflow.topWallRatio ?? 0) >= 2.2 &&
      Number.isFinite(Number(orderflow.spreadPct ?? Number.NaN)) &&
      Number(orderflow.spreadPct) < 0.05
  );
  const microLongOk = Number(orderflow.buySellRatio ?? 0) >= 1.5;
  const microShortOk = Number(orderflow.sellBuyRatio ?? 0) >= 1.5;
  const oiChangePct = Number(orderflow.openInterestChangePct ?? Number.NaN);
  const priceAnchorIdx = Math.max(0, lastH1 - 4);
  const priceDelta = h1Closes[lastH1] - h1Closes[priceAnchorIdx];
  const oiLongOk = Number.isFinite(oiChangePct) && oiChangePct >= 0.01 && priceDelta > 0;
  const oiShortOk = Number.isFinite(oiChangePct) && oiChangePct <= -0.01 && priceDelta < 0;
  const confirmationOk = resolveConfirmationCandle({
    bars: h1,
    direction,
  });
  const htfAligned =
    htfTrend.state !== "HTF_NO_TRADE" &&
    htfTrend.direction === direction;
  const htfScore =
    htfTrend.state === "HTF_STRONG_TREND" && htfTrend.direction === direction
      ? 2
      : htfTrend.state === "HTF_WEAK_TREND" && htfTrend.direction === direction
        ? 1
        : 0;
  const directionSweepOk = direction === "BUY" ? sweepLongOk : direction === "SELL" ? sweepShortOk : false;
  const directionBosOk = direction === "BUY" ? bosLongOk : direction === "SELL" ? bosShortOk : false;
  const directionFvgOk = direction === "BUY" ? fvgLongOk : direction === "SELL" ? fvgShortOk : false;
  const directionPullbackOk =
    direction === "BUY" ? pullbackLongOk : direction === "SELL" ? pullbackShortOk : false;
  const directionOrderbookOk =
    direction === "BUY" ? orderbookLongOk : direction === "SELL" ? orderbookShortOk : false;
  const directionMicroOk = direction === "BUY" ? microLongOk : direction === "SELL" ? microShortOk : false;
  const directionOiOk = direction === "BUY" ? oiLongOk : direction === "SELL" ? oiShortOk : false;
  const directionOrderbookPass = !orderbookDataAvailable || directionOrderbookOk;
  const directionMicroPass = !microFlowDataAvailable || directionMicroOk;
  const directionOiPass = !oiDataAvailable || directionOiOk;
  const structureImpulseOk = directionBosOk || directionFvgOk;
  const pullbackOrConfirmOk = directionPullbackOk || confirmationOk;
  const qualityScore =
    htfScore +
    (directionSweepOk ? 2 : 0) +
    (directionBosOk ? 2 : 0) +
    (directionFvgOk ? 1 : 0) +
    (directionOrderbookOk ? 1 : 0) +
    (directionMicroOk ? 1 : 0) +
    (directionOiOk ? 1 : 0);
  const scorePass = qualityScore >= OLIKELLA_SCORE_THRESHOLD;
  const strictPipelinePass =
    htfAligned &&
    atrReady &&
    structureImpulseOk &&
    pullbackOrConfirmOk &&
    directionOrderbookPass &&
    directionMicroPass &&
    directionOiPass &&
    scorePass;
  const selectedBase = selectedCross ?? selectedH4Pattern;
  const selected = selectedBase && strictPipelinePass ? selectedBase : null;
  const entry = h1Closes[lastH1];
  const signal =
    selected && Number.isFinite(entry)
      ? toSignal({
          symbol,
          side: selected.side,
          pattern: {
            ...selected,
            detail: `${selected.detail} | H4 ${selectedH4Pattern?.pattern ?? "NO_PATTERN"} | score ${qualityScore}/${OLIKELLA_SCORE_THRESHOLD}`,
          },
          entry,
          atr: h1Atr[lastH1],
        })
      : null;

  const strongSupport = Math.min(...h4Lows.slice(-20));
  const strongResistance = Math.max(...h4Highs.slice(-20));
  const trendAnchor =
    direction === "BUY"
      ? strongSupport
      : direction === "SELL"
        ? strongResistance
        : Number.NaN;
  const trendLegId = Number.isFinite(trendAnchor)
    ? `${direction}:${trendAnchor.toFixed(2)}`
    : "NONE";

  const directionalPatternOk =
    direction === "BUY"
      ? Boolean(wedgePopLong?.ok || baseBreakLong?.ok || crossbackLong?.ok)
      : direction === "SELL"
        ? Boolean(wedgePopShort?.ok || baseBreakShort?.ok || crossbackShort?.ok)
        : false;
  const missingPatternReasons: string[] = [];
  if (!trendOk) {
    missingPatternReasons.push("EMA trend missing");
  }
  if (!htfAligned) {
    missingPatternReasons.push(`HTF filter: ${htfTrend.state} (${htfTrend.detail})`);
  }
  if (!directionSweepOk) {
    missingPatternReasons.push("sweep weak: optional confluence not met");
  }
  if (!structureImpulseOk) {
    missingPatternReasons.push("BOS/FVG impulse missing");
  }
  if (!pullbackOrConfirmOk) {
    missingPatternReasons.push("pullback or confirmation missing");
  }
  if (orderbookDataAvailable && !directionOrderbookOk) {
    missingPatternReasons.push("orderbook invalid: imbalance/top-wall/spread");
  }
  if (microFlowDataAvailable && !directionMicroOk) {
    missingPatternReasons.push("micro-flow invalid: buy/sell ratio below 1.5");
  }
  if (oiDataAvailable && !directionOiOk) {
    missingPatternReasons.push("OI invalid: >=1.0% aligned move missing");
  }
  if (!scorePass) {
    missingPatternReasons.push(`score ${qualityScore}/${OLIKELLA_SCORE_THRESHOLD}`);
  }
  if (trendOk && !directionalPatternOk) {
    missingPatternReasons.push("EMA trend + breakout 0.4% + volume >=1.3x not met");
  }
  if (trendOk && htfStructureOk && !selectedCross) {
    missingPatternReasons.push("15m EMA8/EMA16 cross or continuation missing");
  }
  const flowDataState = `flow data: OB ${orderbookDataAvailable ? "live" : "N/A"}, Micro ${microFlowDataAvailable ? "live" : "N/A"}, OI ${oiDataAvailable ? "live" : "N/A"}`;
  const checklistPass = Boolean(selectedBase && strictPipelinePass);
  const checklistDetail =
    checklistPass
      ? `${selectedBase?.pattern ?? "NO_PATTERN"} selected | score ${qualityScore}/${OLIKELLA_SCORE_THRESHOLD} | ${flowDataState}`
      : missingPatternReasons.length > 0
        ? `${missingPatternReasons.join(" | ")} | ${flowDataState}`
        : !selectedH4Pattern
          ? `no valid H4 pattern on latest candle | ${flowDataState}`
          : "no valid 15m EMA8/EMA16 state (cross or continuation)";
  const entryDetail =
    trendOk && checklistPass
      ? `${direction} relaxed pipeline pass | score ${qualityScore}/${OLIKELLA_SCORE_THRESHOLD} | H4 S ${strongSupport.toFixed(2)} / R ${strongResistance.toFixed(2)} | ${flowDataState}`
      : `relaxed pipeline blocked | score ${qualityScore}/${OLIKELLA_SCORE_THRESHOLD} | ${flowDataState}`;
  const exitReady = Number.isFinite(h1Ema8[lastH1]) && Number.isFinite(h1Atr[lastH1]);
  const exitDetail = exhaustion.active
    ? `H4 exhaustion ${Math.round(exhaustion.distancePct * 100)}% from EMA10 | vol ${exhaustion.volumeRatio.toFixed(2)}x`
    : "watch H4 exhaustion >=9% + vol>=1.5x, opposite EMA8/EMA16 cross, H4 wedge drop";
  const gateFailureReasons: string[] = [];
  if (!trendOk) gateFailureReasons.push("EMA_TREND_MISSING");
  if (!htfAligned) gateFailureReasons.push("HTF_ALIGNMENT_REQUIRED");
  if (!directionSweepOk) gateFailureReasons.push("SWEEP_WEAK_OPTIONAL");
  if (!structureImpulseOk) gateFailureReasons.push("IMPULSE_STRUCTURE_MISSING");
  if (!pullbackOrConfirmOk) gateFailureReasons.push("ENTRY_PULLBACK_OR_CONFIRM_MISSING");
  if (orderbookDataAvailable && !directionOrderbookOk) gateFailureReasons.push("ORDERBOOK_VALIDATION_FAILED");
  if (microFlowDataAvailable && !directionMicroOk) gateFailureReasons.push("MICRO_FLOW_FAILED");
  if (oiDataAvailable && !directionOiOk) gateFailureReasons.push("OI_FILTER_FAILED");
  if (!scorePass) gateFailureReasons.push("SCORE_GATE_FAILED");
  if (trendOk && !directionalPatternOk) gateFailureReasons.push("H4_PATTERN_MISSING");
  if (trendOk && htfStructureOk && !selectedCross) {
    gateFailureReasons.push("LTF_EMA8_16_MISSING");
  }

  const context: AiMaticOliKellaContext = {
    timeframe: "4h",
    direction,
    htfTrendState: htfTrend.state,
    trendOk,
    htfStructureOk,
    htfStructureDetail: htfStructureOk
      ? structurePattern?.detail ?? "HTF structure filter ok"
      : "HTF structure filter failed",
    trendLegId,
    ema10: h1Ema8[lastH1],
    atr14: h1Atr[lastH1],
    selectedPattern: selectedH4Pattern?.pattern ?? null,
    baseBreak:
      direction === "BUY"
        ? baseBreakLong
        : direction === "SELL"
          ? baseBreakShort
          : null,
    wedgePop:
      direction === "BUY"
        ? wedgePopLong
        : direction === "SELL"
          ? wedgePopShort
          : null,
    emaCrossback:
      direction === "BUY"
        ? crossbackLong
        : direction === "SELL"
          ? crossbackShort
          : null,
    oppositeCrossbackLong: Boolean(crossEntryShort?.ok),
    oppositeCrossbackShort: Boolean(crossEntryLong?.ok),
    exhaustion: {
      active: exhaustion.active,
      direction: exhaustion.direction,
      distancePct: exhaustion.distancePct,
      volumeRatio: exhaustion.volumeRatio,
    },
    wedgeDrop,
    gates: {
      signalChecklistOk: checklistPass,
      signalChecklistDetail: checklistDetail,
      entryConditionsOk:
        trendOk && checklistPass,
      entryConditionsDetail: entryDetail,
      exitConditionsOk: exitReady,
      exitConditionsDetail: exitDetail,
      riskRulesOk: true,
      riskRulesDetail: "risk 1.5% | RRR 1.8 | max positions 5 | max orders 20",
    },
    qualityScore,
    qualityThreshold: OLIKELLA_SCORE_THRESHOLD,
    qualityPass: strictPipelinePass,
    qualityDetail: `htf ${htfScore}, sweep ${directionSweepOk ? 2 : 0}, bos ${directionBosOk ? 2 : 0}, fvg ${directionFvgOk ? 1 : 0}, ob ${orderbookDataAvailable ? (directionOrderbookOk ? 1 : 0) : "N/A"}, flow ${microFlowDataAvailable ? (directionMicroOk ? 1 : 0) : "N/A"}, oi ${oiDataAvailable ? (directionOiOk ? 1 : 0) : "N/A"}`,
    missingPatternReasons,
    gateFailureReasons,
    dataHealth: {
      ltfOpenTime: timeframeSync.ltfOpenTime,
      h1OpenTime: timeframeSync.h1OpenTime,
      h4OpenTime: timeframeSync.h4OpenTime,
      h4SyncOk: timeframeSync.h4SyncOk,
      detail: timeframeSync.detail,
    },
    canScaleIn: trendOk && checklistPass,
  };

  return {
    state: signal ? State.Manage : State.Scan,
    trend: toTrend(direction),
    trendH1: toTrend(direction),
    trendScore: signal ? 1 : 0,
    trendAdx: Number.NaN,
    signal,
    halted: false,
    oliKella: context,
  };
}

export const __aiMaticOliKellaTest = {
  detectEma8Ema16Entry,
  detectH4StructurePattern,
  detectBaseNBreak,
  detectWedgePop,
  detectEmaCrossback,
  detectExhaustion,
  detectWedgeDrop,
};
