import {
  EngineDecision,
  EngineSignal,
  State,
  Trend,
  resampleCandles,
  type Candle,
} from "./botEngine";
import { computeATR, computeEma } from "./ta";

export type OliKellaPattern = "WEDGE_POP" | "BASE_N_BREAK" | "EMA_CROSSBACK";

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
  trendOk: boolean;
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
  canScaleIn: boolean;
};

const H4_MINUTES = 240;
const BREAKOUT_PCT = 0.004;
const BREAKOUT_VOLUME_MULT = 1.3;
const EXHAUSTION_DISTANCE_PCT = 0.09;
const EXHAUSTION_VOLUME_MULT = 1.5;
const BASE_MIN = 4;
const BASE_MAX = 12;

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

function detectDirection(closes: number[], ema10: number[], ema20: number[]) {
  const last = closes.length - 1;
  if (last < 3) return "NONE" as const;
  const slope10 = safeRatio(ema10[last] - ema10[last - 3], ema10[last - 3]);
  const slope20 = safeRatio(ema20[last] - ema20[last - 3], ema20[last - 3]);
  const close = closes[last];
  const longOk =
    close > ema10[last] &&
    ema10[last] > ema20[last] &&
    Number.isFinite(slope10) &&
    Number.isFinite(slope20) &&
    slope10 > 0 &&
    slope20 > 0;
  const shortOk =
    close < ema10[last] &&
    ema10[last] < ema20[last] &&
    Number.isFinite(slope10) &&
    Number.isFinite(slope20) &&
    slope10 < 0 &&
    slope20 < 0;
  if (longOk) return "BUY" as const;
  if (shortOk) return "SELL" as const;
  return "NONE" as const;
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
      return bar.close >= zoneLow && bar.close <= zoneHigh * 1.015;
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
      const zoneLow = Math.min(ema10[sourceIdx], ema20[sourceIdx]) * 0.997;
      const zoneHigh = Math.max(ema10[sourceIdx], ema20[sourceIdx]) * 1.003;
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

function toSignal(args: {
  symbol: string;
  side: "buy" | "sell";
  pattern: PatternDetection;
  entry: number;
  atr: number;
}): EngineSignal | null {
  const { symbol, side, pattern, entry, atr } = args;
  const atrBuffer = Number.isFinite(atr) && atr > 0 ? atr * 0.2 : 0;
  const stopRaw = side === "buy" ? pattern.stop - atrBuffer : pattern.stop + atrBuffer;
  const risk = Math.abs(entry - stopRaw);
  if (!Number.isFinite(risk) || risk <= 0) return null;
  const tp = side === "buy" ? entry + risk * 2 : entry - risk * 2;
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
  candles: Candle[]
): EngineDecision {
  const h4 = resampleCandles(candles, H4_MINUTES);
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
          signalChecklistDetail: "need >=40 bars",
          entryConditionsOk: false,
          entryConditionsDetail: "insufficient 4h history",
          exitConditionsOk: false,
          exitConditionsDetail: "insufficient 4h history",
          riskRulesOk: true,
          riskRulesDetail: "1.5% risk | max positions 5 | max orders 20",
        },
        canScaleIn: false,
      } satisfies AiMaticOliKellaContext,
    };
  }

  const closes = h4.map((bar) => bar.close);
  const highs = h4.map((bar) => bar.high);
  const lows = h4.map((bar) => bar.low);
  const volumes = h4.map((bar) => bar.volume);
  const ema10 = computeEma(closes, 10);
  const ema20 = computeEma(closes, 20);
  const atr = computeATR(highs, lows, closes, 14);
  const volumeSma20 = buildSma(volumes, 20);
  const last = h4.length - 1;
  const direction = detectDirection(closes, ema10, ema20);
  const trendOk = direction !== "NONE";

  const baseBreakLong = detectBaseNBreak({
    bars: h4,
    ema10,
    ema20,
    volumeSma20,
    side: "buy",
  });
  const baseBreakShort = detectBaseNBreak({
    bars: h4,
    ema10,
    ema20,
    volumeSma20,
    side: "sell",
  });
  const wedgePopLong = detectWedgePop({
    bars: h4,
    ema10,
    ema20,
    volumeSma20,
    side: "buy",
  });
  const wedgePopShort = detectWedgePop({
    bars: h4,
    ema10,
    ema20,
    volumeSma20,
    side: "sell",
  });
  const crossbackLong = detectEmaCrossback({
    bars: h4,
    ema10,
    ema20,
    side: "buy",
  });
  const crossbackShort = detectEmaCrossback({
    bars: h4,
    ema10,
    ema20,
    side: "sell",
  });
  const exhaustion = detectExhaustion({
    close: closes[last],
    ema10: ema10[last],
    volume: volumes[last],
    volumeSma20: volumeSma20[last],
  });
  const wedgeDrop = detectWedgeDrop({
    bars: h4,
    ema20,
    volumeSma20,
  });

  const priorityLong = [wedgePopLong, baseBreakLong, crossbackLong].filter(
    (item): item is PatternDetection => Boolean(item?.ok)
  );
  const priorityShort = [wedgePopShort, baseBreakShort, crossbackShort].filter(
    (item): item is PatternDetection => Boolean(item?.ok)
  );
  const selected =
    direction === "BUY"
      ? priorityLong[0] ?? null
      : direction === "SELL"
        ? priorityShort[0] ?? null
        : null;
  const entry = closes[last];
  const signal =
    selected && Number.isFinite(entry)
      ? toSignal({
          symbol,
          side: selected.side,
          pattern: selected,
          entry,
          atr: atr[last],
        })
      : null;

  const trendAnchor =
    direction === "BUY"
      ? Math.min(...lows.slice(-20))
      : direction === "SELL"
        ? Math.max(...highs.slice(-20))
        : Number.NaN;
  const trendLegId = Number.isFinite(trendAnchor)
    ? `${direction}:${trendAnchor.toFixed(2)}`
    : "NONE";

  const checklistDetail = selected
    ? `${selected.pattern} selected (priority Wedge Pop > Base 'n Break > EMA Crossback)`
    : "no valid pattern on latest 4h candle";
  const entryDetail = trendOk
    ? `${direction} trend aligned EMA10/20 | breakout 0.4% | volume >=1.3x`
    : "EMA10/20 trend alignment missing";
  const exitReady = Number.isFinite(ema10[last]) && Number.isFinite(atr[last]);
  const exitDetail = exhaustion.active
    ? `exhaustion ${Math.round(exhaustion.distancePct * 100)}% from EMA10 | vol ${exhaustion.volumeRatio.toFixed(2)}x`
    : "watch exhaustion >=9% + vol>=1.5x, opposite crossback, wedge drop";

  const context: AiMaticOliKellaContext = {
    timeframe: "4h",
    direction,
    trendOk,
    trendLegId,
    ema10: ema10[last],
    atr14: atr[last],
    selectedPattern: selected?.pattern ?? null,
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
    oppositeCrossbackLong: Boolean(crossbackShort?.ok),
    oppositeCrossbackShort: Boolean(crossbackLong?.ok),
    exhaustion: {
      active: exhaustion.active,
      direction: exhaustion.direction,
      distancePct: exhaustion.distancePct,
      volumeRatio: exhaustion.volumeRatio,
    },
    wedgeDrop,
    gates: {
      signalChecklistOk: Boolean(selected),
      signalChecklistDetail: checklistDetail,
      entryConditionsOk: trendOk && Boolean(selected),
      entryConditionsDetail: entryDetail,
      exitConditionsOk: exitReady,
      exitConditionsDetail: exitDetail,
      riskRulesOk: true,
      riskRulesDetail: "risk 1.5% | max positions 5 | max orders 20",
    },
    canScaleIn: trendOk && Boolean(selected),
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
  detectBaseNBreak,
  detectWedgePop,
  detectEmaCrossback,
  detectExhaustion,
  detectWedgeDrop,
};
