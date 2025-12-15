// src/engine/htfTrendFilter.ts
import { TrendDirection } from "./v2Contracts";

export type Candle = { open: number; high: number; low: number; close: number };

type Pivot = { idx: number; price: number };

export type HTFTrendResult = {
  direction: TrendDirection;
  ema200: number;
  close: number;
  lastHigh?: Pivot;
  prevHigh?: Pivot;
  lastLow?: Pivot;
  prevLow?: Pivot;
  tags: string[];
};

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
  }
  return e;
}

function findPivotsHigh(candles: Candle[], lookback: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = candles[i].high;
    let isHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].high >= h || candles[i + j].high >= h) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) pivots.push({ idx: i, price: h });
  }
  return pivots;
}

function findPivotsLow(candles: Candle[], lookback: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const l = candles[i].low;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i - j].low <= l || candles[i + j].low <= l) {
        isLow = false;
        break;
      }
    }
    if (isLow) pivots.push({ idx: i, price: l });
  }
  return pivots;
}

export function evaluateHTFTrend(
  candles: Candle[],
  lookback: number = 2
): HTFTrendResult {
  const tags: string[] = [];
  if (!candles || candles.length < Math.max(lookback * 2 + 2, 50)) {
    return { direction: "none", ema200: 0, close: 0, tags: ["INSUFFICIENT_DATA"] };
  }

  const closes = candles.map((c) => c.close);
  const ema200 = ema(closes, 200);
  const lastClose = closes[closes.length - 1];

  const highs = findPivotsHigh(candles, lookback);
  const lows = findPivotsLow(candles, lookback);

  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 2];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 2];

  let direction: TrendDirection = "none";

  if (lastClose > ema200 && lastHigh && prevHigh && lastLow && prevLow) {
    const hh = lastHigh.price > prevHigh.price;
    const hl = lastLow.price > prevLow.price;
    if (hh && hl) {
      direction = "bull";
      tags.push("HH", "HL");
    }
  }

  if (lastClose < ema200 && lastHigh && prevHigh && lastLow && prevLow) {
    const ll = lastLow.price < prevLow.price;
    const lh = lastHigh.price < prevHigh.price;
    if (ll && lh) {
      direction = "bear";
      tags.push("LL", "LH");
    }
  }

  if (direction === "none") tags.push("STRUCTURE_NONE");

  return {
    direction,
    ema200,
    close: lastClose,
    lastHigh,
    prevHigh,
    lastLow,
    prevLow,
    tags,
  };
}

export function normalizeDirection(dir: TrendDirection): "long" | "short" | "none" {
  if (dir === "bull") return "long";
  if (dir === "bear") return "short";
  return "none";
}
