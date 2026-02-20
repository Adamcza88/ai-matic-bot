// src/engine/htfTrendFilter.ts
import { TrendDirection } from "./v2Contracts";
import { Ohlcv, Pivot, computeEma, findPivotsHigh, findPivotsLow } from "./ta";

export type Candle = Ohlcv;

export type HTFTrendResult = {
  direction: TrendDirection;
  ema200: number;
  close: number;
  lastHigh?: Pivot;
  prevHigh?: Pivot;
  lastLow?: Pivot;
  prevLow?: Pivot;
  tags: string[];
  score: number;
};

export type HTFTrendOptions = {
  lookback?: number;
  emaPeriod?: number;
  minBars?: number;
  slopeLookback?: number;
  breakoutLookback?: number;
  confirmBars?: number;
};

export function evaluateHTFTrend(
  candles: Candle[],
  lookbackOrOpts: number | HTFTrendOptions = 2
): HTFTrendResult {
  const tags: string[] = [];
  const opts = typeof lookbackOrOpts === "number" ? undefined : lookbackOrOpts;
  const lookback =
    typeof lookbackOrOpts === "number" ? lookbackOrOpts : lookbackOrOpts?.lookback ?? 2;
  const emaPeriod = opts?.emaPeriod ?? 200;
  const minBars = opts?.minBars ?? Math.max(lookback * 2 + 2, emaPeriod);
  const slopeLookback = Math.max(1, opts?.slopeLookback ?? 6);
  const breakoutLookback = Math.max(2, opts?.breakoutLookback ?? 8);
  const confirmBars = Math.max(1, opts?.confirmBars ?? 2);

  if (!candles || candles.length < minBars) {
    return {
      direction: "none",
      ema200: 0,
      close: 0,
      tags: ["INSUFFICIENT_DATA"],
      score: 0,
    };
  }

  const closes = candles.map((c) => c.close);
  const ema200Arr = computeEma(closes, emaPeriod);
  const ema200 = ema200Arr[ema200Arr.length - 1];
  const lastClose = closes[closes.length - 1];

  const highs = findPivotsHigh(candles, lookback, lookback);
  const lows = findPivotsLow(candles, lookback, lookback);

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  let bullBreakoutIdx = -1;
  let bearBreakoutIdx = -1;
  const start = Math.max(1, closes.length - breakoutLookback);
  for (let i = start; i < closes.length; i++) {
    const prevClose = closes[i - 1];
    const prevEma = ema200Arr[i - 1];
    const close = closes[i];
    const ema = ema200Arr[i];
    if (!Number.isFinite(prevClose) || !Number.isFinite(prevEma)) continue;
    if (!Number.isFinite(close) || !Number.isFinite(ema)) continue;
    if (prevClose <= prevEma && close > ema) bullBreakoutIdx = i;
    if (prevClose >= prevEma && close < ema) bearBreakoutIdx = i;
  }
  const lastIdx = closes.length - 1;
  const confirmedBull =
    bullBreakoutIdx >= 0 &&
    lastIdx - bullBreakoutIdx + 1 >= confirmBars &&
    (() => {
      for (let i = Math.max(bullBreakoutIdx, closes.length - confirmBars); i < closes.length; i++) {
        if (closes[i] <= ema200Arr[i]) return false;
      }
      return true;
    })();
  const confirmedBear =
    bearBreakoutIdx >= 0 &&
    lastIdx - bearBreakoutIdx + 1 >= confirmBars &&
    (() => {
      for (let i = Math.max(bearBreakoutIdx, closes.length - confirmBars); i < closes.length; i++) {
        if (closes[i] >= ema200Arr[i]) return false;
      }
      return true;
    })();

  let direction: TrendDirection = "none";
  if (confirmedBull && !confirmedBear) direction = "bull";
  else if (confirmedBear && !confirmedBull) direction = "bear";
  else if (confirmedBull && confirmedBear) {
    direction = bullBreakoutIdx >= bearBreakoutIdx ? "bull" : "bear";
  }
  const score = direction === "none" ? 0 : 3;
  if (bullBreakoutIdx >= 0) tags.push("BREAKOUT_UP");
  if (bearBreakoutIdx >= 0) tags.push("BREAKOUT_DOWN");
  if (confirmedBull || confirmedBear) tags.push("CONFIRMED");
  if (lastClose > ema200) tags.push("ABOVE_EMA200");
  if (lastClose < ema200) tags.push("BELOW_EMA200");

  const slopeBaseIdx = Math.max(0, ema200Arr.length - 1 - slopeLookback);
  const emaSlope = ema200Arr[ema200Arr.length - 1] - ema200Arr[slopeBaseIdx];
  if (direction === "bull" && emaSlope > 0) tags.push("EMA_SLOPE_UP");
  if (direction === "bear" && emaSlope < 0) tags.push("EMA_SLOPE_DOWN");

  return {
    direction,
    ema200,
    close: lastClose,
    lastHigh,
    prevHigh,
    lastLow,
    prevLow,
    tags,
    score,
  };
}

export function normalizeDirection(dir: TrendDirection): "long" | "short" | "none" {
  if (dir === "bull") return "long";
  if (dir === "bear") return "short";
  return "none";
}

type TimeframeTrend = {
  timeframeMin: number;
  result: HTFTrendResult;
};

export type HTFMultiTrendResult = {
  consensus: TrendDirection;
  alignedCount: number;
  score: number;
  byTimeframe: TimeframeTrend[];
  tags: string[];
};

function resampleCandles(candles: Candle[], timeframeMin: number): Candle[] {
  if (!candles.length) return [];
  const bucketMs = timeframeMin * 60_000;
  const buckets = new Map<number, Candle[]>();
  candles.forEach((c, idx) => {
    const ts = Number.isFinite(c.openTime) ? (c.openTime as number) : idx * 60_000;
    const key = Math.floor(ts / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)?.push({ ...c, openTime: ts });
  });
  const out: Candle[] = [];
  Array.from(buckets.keys())
    .sort((a, b) => a - b)
    .forEach((key) => {
      const chunk = buckets.get(key) ?? [];
      if (!chunk.length) return;
      const first = chunk[0];
      const open = first.open;
      const high = Math.max(...chunk.map((c) => c.high));
      const low = Math.min(...chunk.map((c) => c.low));
      const close = chunk[chunk.length - 1].close;
      const volume = chunk.reduce((sum, c) => sum + (c.volume ?? 0), 0);
      out.push({ openTime: key, open, high, low, close, volume });
    });
  return out;
}

export function evaluateHTFMultiTrend(
  candles: Candle[],
  opts?: {
    timeframesMin?: number[];
    lookback?: number;
    emaByTimeframe?: Record<number, number>;
    resample?: (timeframeMin: number) => Candle[];
  }
): HTFMultiTrendResult {
  const timeframes = opts?.timeframesMin ?? [5];
  const emaByTf = opts?.emaByTimeframe ?? { 5: 200 };
  const resample = opts?.resample ?? ((tf: number) => resampleCandles(candles, tf));
  const byTimeframe: TimeframeTrend[] = [];
  for (const tf of timeframes) {
    const sampled = resample(tf);
    const baseEma = emaByTf[tf] ?? 200;
    const emaPeriod = Math.min(baseEma, Math.max(10, sampled.length));
    const minBars = Math.max((opts?.lookback ?? 2) * 2 + 2, Math.min(emaPeriod, sampled.length));
    const result = evaluateHTFTrend(sampled, {
      lookback: opts?.lookback ?? 2,
      emaPeriod,
      minBars,
    });
    byTimeframe.push({ timeframeMin: tf, result });
  }
  const tags: string[] = [];
  const bull = byTimeframe.filter((t) => t.result.direction === "bull").length;
  const bear = byTimeframe.filter((t) => t.result.direction === "bear").length;
  const alignedCount = Math.max(bull, bear);
  let consensus: TrendDirection = "none";
  const required = Math.max(1, Math.ceil(timeframes.length / 2));
  if (bull >= required) consensus = "bull";
  else if (bear >= required) consensus = "bear";
  if (consensus !== "none") tags.push(`ALIGN_${consensus.toUpperCase()}`);
  const score = byTimeframe.reduce((sum, t) => sum + (t.result.score || 0), 0);
  return {
    consensus,
    alignedCount,
    score,
    byTimeframe,
    tags,
  };
}
