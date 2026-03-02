import {
  State,
  Trend,
  resampleCandles,
  type Candle,
  type EngineDecision,
  type EngineSignal,
} from "./botEngine";
import { computeAtr, findPivotsHigh, findPivotsLow, type Pivot } from "./ta";

type ProTargets = {
  t1: number;
  t2: number;
};

type ProMtfFiboGate = {
  name: string;
  ok: boolean;
  detail: string;
  pending?: boolean;
};

type TrendState = "UP" | "DOWN" | "CONSOLIDATION";

type FibLevels = {
  retracement: {
    r236: number;
    r382: number;
    r500: number;
    r618: number;
    r786: number;
  };
  extension: {
    t1: number;
    t2: number;
  };
};

type LtfTriggerState = {
  bullishEngulfing: boolean;
  bearishEngulfing: boolean;
  bullishPinBar: boolean;
  bearishPinBar: boolean;
  breakoutLong: boolean;
  breakoutShort: boolean;
  longTrigger: boolean;
  shortTrigger: boolean;
};

const RETRACE_236 = 0.236;
const RETRACE_382 = 0.382;
const RETRACE_500 = 0.5;
const RETRACE_618 = 0.618;
const RETRACE_786 = 0.786;
const EXT_1272 = 0.272;
const EXT_1618 = 0.618;
const SWING_LOOKBACK_LEFT = 2;
const SWING_LOOKBACK_RIGHT = 2;
const M15_SWING_NEAR_FIB_TOLERANCE = 0.005;
const KEY_FIB_PROXIMITY_LIMIT = 0.01;
const RR_MIN = 1.5;
const ATR_BUFFER_MULT = 1.2;
const ATR_FALLBACK_PCT = 0.003;
const BREAKOUT_LOOKBACK = 10;
const BREAKOUT_VOLUME_LOOKBACK = 20;
const ATR_20D_BARS_4H = 20 * 6;

function last<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

function mean(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return Number.NaN;
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
}

function sma(values: number[], period: number): number {
  if (!values.length || period <= 0 || values.length < period) return Number.NaN;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function pctDistance(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const denom = Math.abs(b) > 0 ? Math.abs(b) : 1;
  return Math.abs(a - b) / denom;
}

function resolveTrendState(args: {
  h4: Candle[];
  swingHighs: Pivot[];
  swingLows: Pivot[];
}): TrendState {
  const { h4, swingHighs, swingLows } = args;
  if (!h4.length) return "CONSOLIDATION";
  const closes = h4.map((c) => c.close);
  const lastClose = h4[h4.length - 1].close;
  const ma50 = sma(closes, 50);
  const lastTwoLows = swingLows.slice(-2);
  const lastTwoHighs = swingHighs.slice(-2);
  const higherLows =
    lastTwoLows.length === 2 && lastTwoLows[1].price > lastTwoLows[0].price;
  const lowerHighs =
    lastTwoHighs.length === 2 && lastTwoHighs[1].price < lastTwoHighs[0].price;

  if (Number.isFinite(ma50) && lastClose > ma50 && higherLows) return "UP";
  if (Number.isFinite(ma50) && lastClose < ma50 && lowerHighs) return "DOWN";
  return "CONSOLIDATION";
}

function findLatestImpulse(
  trend: TrendState,
  swingHighs: Pivot[],
  swingLows: Pivot[]
): { low: Pivot; high: Pivot } | null {
  if (trend === "UP") {
    for (let hi = swingHighs.length - 1; hi >= 0; hi--) {
      const high = swingHighs[hi];
      const low = [...swingLows]
        .reverse()
        .find((candidate) => candidate.idx < high.idx);
      if (low) return { low, high };
    }
    return null;
  }
  if (trend === "DOWN") {
    for (let lo = swingLows.length - 1; lo >= 0; lo--) {
      const low = swingLows[lo];
      const high = [...swingHighs]
        .reverse()
        .find((candidate) => candidate.idx < low.idx);
      if (high) return { low, high };
    }
  }
  return null;
}

function computeFibLevels(args: {
  trend: TrendState;
  low: number;
  high: number;
}): FibLevels | null {
  const { trend, low, high } = args;
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return null;

  if (trend === "UP") {
    return {
      retracement: {
        r236: high - range * RETRACE_236,
        r382: high - range * RETRACE_382,
        r500: high - range * RETRACE_500,
        r618: high - range * RETRACE_618,
        r786: high - range * RETRACE_786,
      },
      extension: {
        t1: high + range * EXT_1272,
        t2: high + range * EXT_1618,
      },
    };
  }

  if (trend === "DOWN") {
    return {
      retracement: {
        r236: low + range * RETRACE_236,
        r382: low + range * RETRACE_382,
        r500: low + range * RETRACE_500,
        r618: low + range * RETRACE_618,
        r786: low + range * RETRACE_786,
      },
      extension: {
        t1: low - range * EXT_1272,
        t2: low - range * EXT_1618,
      },
    };
  }

  return null;
}

function nearestKeyFibDistance(price: number, fib: FibLevels | null) {
  if (!fib || !Number.isFinite(price)) {
    return { nearest: Number.NaN, distance: Number.POSITIVE_INFINITY };
  }
  const key = [fib.retracement.r382, fib.retracement.r618];
  const sorted = key
    .map((level) => ({ level, distance: pctDistance(price, level) }))
    .sort((a, b) => a.distance - b.distance);
  return {
    nearest: sorted[0]?.level ?? Number.NaN,
    distance: sorted[0]?.distance ?? Number.POSITIVE_INFINITY,
  };
}

function isBullishEngulfing(prev: Candle, curr: Candle): boolean {
  return (
    prev.close < prev.open &&
    curr.close > curr.open &&
    curr.open <= prev.close &&
    curr.close >= prev.open
  );
}

function isBearishEngulfing(prev: Candle, curr: Candle): boolean {
  return (
    prev.close > prev.open &&
    curr.close < curr.open &&
    curr.open >= prev.close &&
    curr.close <= prev.open
  );
}

function isBullishPinBar(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open);
  const bodySafe =
    body > 0 ? body : Math.max((candle.high - candle.low) * 0.05, 1e-9);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  return lowerWick >= 2 * bodySafe && upperWick <= bodySafe;
}

function isBearishPinBar(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open);
  const bodySafe =
    body > 0 ? body : Math.max((candle.high - candle.low) * 0.05, 1e-9);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  return upperWick >= 2 * bodySafe && lowerWick <= bodySafe;
}

function resolveBreakoutSignals(m15: Candle[]) {
  if (m15.length < BREAKOUT_VOLUME_LOOKBACK + 2) {
    return { breakoutLong: false, breakoutShort: false, detail: "missing" };
  }
  const curr = m15[m15.length - 1];
  const history = m15.slice(-BREAKOUT_VOLUME_LOOKBACK - 1, -1);
  const resistance = Math.max(
    ...history.slice(-BREAKOUT_LOOKBACK).map((c) => c.high)
  );
  const support = Math.min(...history.slice(-BREAKOUT_LOOKBACK).map((c) => c.low));
  const volumeAvg = mean(history.map((c) => c.volume ?? 0));
  const volumeOk =
    Number.isFinite(volumeAvg) && (curr.volume ?? 0) > volumeAvg * 1.0;
  return {
    breakoutLong: curr.close > resistance && volumeOk,
    breakoutShort: curr.close < support && volumeOk,
    detail: `res ${resistance.toFixed(4)} | sup ${support.toFixed(4)} | volAvg ${Number.isFinite(volumeAvg) ? volumeAvg.toFixed(2) : "NaN"}`,
  };
}

function evaluateLtfTriggers(m15: Candle[]): LtfTriggerState {
  if (m15.length < 3) {
    return {
      bullishEngulfing: false,
      bearishEngulfing: false,
      bullishPinBar: false,
      bearishPinBar: false,
      breakoutLong: false,
      breakoutShort: false,
      longTrigger: false,
      shortTrigger: false,
    };
  }
  const curr = m15[m15.length - 1];
  const prev = m15[m15.length - 2];
  const breakout = resolveBreakoutSignals(m15);
  const bullishEngulfing = isBullishEngulfing(prev, curr);
  const bearishEngulfing = isBearishEngulfing(prev, curr);
  const bullishPinBar = isBullishPinBar(curr);
  const bearishPinBar = isBearishPinBar(curr);
  const longTrigger = bullishEngulfing || bullishPinBar || breakout.breakoutLong;
  const shortTrigger = bearishEngulfing || bearishPinBar || breakout.breakoutShort;

  return {
    bullishEngulfing,
    bearishEngulfing,
    bullishPinBar,
    bearishPinBar,
    breakoutLong: breakout.breakoutLong,
    breakoutShort: breakout.breakoutShort,
    longTrigger,
    shortTrigger,
  };
}

function toEngineTrend(trend: TrendState): Trend {
  if (trend === "UP") return Trend.Bull;
  if (trend === "DOWN") return Trend.Bear;
  return Trend.Range;
}

export function evaluateAiMaticProStrategyForSymbol(
  symbol: string,
  candles: Candle[],
  _config?: { entryTfMin?: number }
): EngineDecision {
  if (!candles.length) {
    return {
      state: State.Scan,
      trend: Trend.Range,
      signal: null,
      halted: true,
      proMtfFibo: {
        trend: "CONSOLIDATION" as TrendState,
        gates: [],
      },
    } as EngineDecision;
  }

  const h4 = resampleCandles(candles, 240);
  const m15 = resampleCandles(candles, 15);

  const h4Highs = findPivotsHigh(h4, SWING_LOOKBACK_LEFT, SWING_LOOKBACK_RIGHT);
  const h4Lows = findPivotsLow(h4, SWING_LOOKBACK_LEFT, SWING_LOOKBACK_RIGHT);
  const trendState = resolveTrendState({ h4, swingHighs: h4Highs, swingLows: h4Lows });
  const impulse = findLatestImpulse(trendState, h4Highs, h4Lows);
  const fib = impulse
    ? computeFibLevels({
        trend: trendState,
        low: impulse.low.price,
        high: impulse.high.price,
      })
    : null;

  const ltfHighs = findPivotsHigh(m15, SWING_LOOKBACK_LEFT, SWING_LOOKBACK_RIGHT);
  const ltfLows = findPivotsLow(m15, SWING_LOOKBACK_LEFT, SWING_LOOKBACK_RIGHT);
  const lastLtfLow = last(ltfLows);
  const lastLtfHigh = last(ltfHighs);
  const ltfTriggers = evaluateLtfTriggers(m15);

  const price = last(m15)?.close ?? last(candles)?.close ?? Number.NaN;
  const keyFibDistance = nearestKeyFibDistance(price, fib);
  const fibProximityOk = keyFibDistance.distance <= KEY_FIB_PROXIMITY_LIMIT;

  const swingDistanceLong =
    fib && lastLtfLow
      ? nearestKeyFibDistance(lastLtfLow.price, fib).distance
      : Number.POSITIVE_INFINITY;
  const swingDistanceShort =
    fib && lastLtfHigh
      ? nearestKeyFibDistance(lastLtfHigh.price, fib).distance
      : Number.POSITIVE_INFINITY;

  const swingNearFibOk =
    trendState === "UP"
      ? swingDistanceLong <= M15_SWING_NEAR_FIB_TOLERANCE
      : trendState === "DOWN"
        ? swingDistanceShort <= M15_SWING_NEAR_FIB_TOLERANCE
        : false;

  const atr4h = computeAtr(h4, 14);
  const atr4hCurrent = last(atr4h) ?? Number.NaN;
  const atr4hAvg20d = mean(atr4h.slice(-ATR_20D_BARS_4H));
  const volatilityGateOk =
    Number.isFinite(atr4hCurrent) &&
    Number.isFinite(atr4hAvg20d) &&
    atr4hCurrent >= atr4hAvg20d * 0.8;

  const trendConfirmed = trendState !== "CONSOLIDATION" && Boolean(impulse) && Boolean(fib);
  const triggerValid =
    trendState === "UP"
      ? ltfTriggers.longTrigger
      : trendState === "DOWN"
        ? ltfTriggers.shortTrigger
        : false;

  const entry = Number.isFinite(price) ? price : Number.NaN;
  const atr15 = last(computeAtr(m15, 14)) ?? Number.NaN;
  const atrBuffer =
    Number.isFinite(atr15) && atr15 > 0 ? atr15 * ATR_BUFFER_MULT : entry * ATR_FALLBACK_PCT;

  let sl = Number.NaN;
  let tp1 = Number.NaN;
  let tp2 = Number.NaN;

  if (trendState === "UP" && fib && Number.isFinite(entry) && entry > 0) {
    const structure =
      lastLtfLow?.price ?? Math.min(...m15.slice(-10).map((c) => c.low));
    sl = Math.min(structure, entry - atrBuffer);
    if (!(sl < entry)) sl = entry - Math.max(atrBuffer, entry * ATR_FALLBACK_PCT);
    tp1 = fib.extension.t1;
    tp2 = fib.extension.t2;
  } else if (trendState === "DOWN" && fib && Number.isFinite(entry) && entry > 0) {
    const structure =
      lastLtfHigh?.price ?? Math.max(...m15.slice(-10).map((c) => c.high));
    sl = Math.max(structure, entry + atrBuffer);
    if (!(sl > entry)) sl = entry + Math.max(atrBuffer, entry * ATR_FALLBACK_PCT);
    tp1 = fib.extension.t1;
    tp2 = fib.extension.t2;
  }

  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp2 - entry);
  const rr = Number.isFinite(risk) && risk > 0 ? reward / risk : Number.NaN;
  const rrGateOk =
    Number.isFinite(rr) && rr >= RR_MIN && Number.isFinite(tp2) && Number.isFinite(sl);

  const gates: ProMtfFiboGate[] = [
    {
      name: "4H trend confirmed (SMA50 + swing sequence)",
      ok: trendConfirmed,
      detail: `trend ${trendState}`,
    },
    {
      name: "Fib proximity <= 1% (38.2/61.8)",
      ok: fibProximityOk,
      detail: `dist ${(keyFibDistance.distance * 100).toFixed(2)}%`,
    },
    {
      name: "15m swing near Fib <= 0.50%",
      ok: swingNearFibOk,
      detail:
        trendState === "UP"
          ? `dist ${(swingDistanceLong * 100).toFixed(2)}%`
          : trendState === "DOWN"
            ? `dist ${(swingDistanceShort * 100).toFixed(2)}%`
            : "n/a",
    },
    {
      name: "15m trigger valid (engulfing/pin/breakout+vol)",
      ok: triggerValid,
      detail: `long ${ltfTriggers.longTrigger ? "Y" : "N"} | short ${ltfTriggers.shortTrigger ? "Y" : "N"}`,
    },
    {
      name: "Volatility gate ATR >= 0.8x 20d avg",
      ok: volatilityGateOk,
      detail: `ATR ${Number.isFinite(atr4hCurrent) ? atr4hCurrent.toFixed(4) : "NaN"} / avg ${Number.isFinite(atr4hAvg20d) ? atr4hAvg20d.toFixed(4) : "NaN"}`,
    },
    {
      name: "RR gate >= 1.5",
      ok: rrGateOk,
      detail: Number.isFinite(rr) ? `RR ${rr.toFixed(2)}` : "RR NaN",
    },
  ];

  const allGatesPass = gates.every((gate) => gate.ok);
  const side = trendState === "UP" ? "buy" : trendState === "DOWN" ? "sell" : null;

  if (
    !allGatesPass ||
    !side ||
    !Number.isFinite(entry) ||
    !Number.isFinite(sl) ||
    !Number.isFinite(tp2)
  ) {
    return {
      state: State.Scan,
      trend: toEngineTrend(trendState),
      signal: null,
      proMtfFibo: {
        trend: trendState,
        impulse: impulse
          ? {
              low: impulse.low.price,
              high: impulse.high.price,
              lowIdx: impulse.low.idx,
              highIdx: impulse.high.idx,
            }
          : null,
        fib,
        gates,
        ltfTriggers,
      },
    } as EngineDecision;
  }

  const signal: EngineSignal = {
    id: `${symbol}-${Date.now()}`,
    symbol,
    intent: {
      side,
      entry,
      sl,
      tp: tp2,
    },
    entryType: "LIMIT_MAKER_FIRST",
    kind: "PULLBACK",
    risk: 1,
    message: `PRO MTF Fibo ${side.toUpperCase()} | TP1 ${tp1.toFixed(4)} | TP2 ${tp2.toFixed(4)} | RR ${rr.toFixed(2)}`,
    createdAt: new Date().toISOString(),
  };

  (signal as any).proTargets = {
    t1: tp1,
    t2: tp2,
  } satisfies ProTargets;

  return {
    state: State.Manage,
    trend: toEngineTrend(trendState),
    signal,
    proMtfFibo: {
      trend: trendState,
      impulse: {
        low: impulse!.low.price,
        high: impulse!.high.price,
        lowIdx: impulse!.low.idx,
        highIdx: impulse!.high.idx,
      },
      fib,
      gates,
      ltfTriggers,
    },
  } as EngineDecision;
}

export const __aiMaticProTest = {
  resolveTrendState,
  findLatestImpulse,
  computeFibLevels,
  evaluateLtfTriggers,
  nearestKeyFibDistance,
};
