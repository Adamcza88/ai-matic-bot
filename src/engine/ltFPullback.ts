// src/engine/ltFPullback.ts
// LTF pullback + swing detekce pro V2 (David Paul – 3 pravidla)

import { TrendDirection, TradeDirection } from "./v2Contracts";
import { Ohlcv, findLastPivotHigh, findLastPivotLow } from "./ta";

export type Candle = Ohlcv;

export type PullbackResult = {
  direction: TradeDirection;
  swingHigh?: number;
  swingLow?: number;
  barsAgainst: number;
  valid: boolean;
  tags: string[];
};

function countBarsAgainst(candles: Candle[], dir: TrendDirection): number {
  let count = 0;
  for (let i = candles.length - 1; i >= 0; i--) {
    const c = candles[i];
    const isAgainst = dir === "bull" ? c.close < c.open : dir === "bear" ? c.close > c.open : false;
    if (isAgainst) count += 1; else break;
  }
  return count;
}

export function detectLtfPullback(
  candles: Candle[],
  htfDirection: TrendDirection,
  lookback: number = 2
): PullbackResult {
  const tags: string[] = [];
  if (!candles || candles.length < lookback * 2 + 3) {
    return { direction: "none", barsAgainst: 0, valid: false, tags: ["INSUFFICIENT_DATA"] };
  }

  if (htfDirection === "none") {
    return { direction: "none", barsAgainst: 0, valid: false, tags: ["HTF_NONE"] };
  }

  const barsAgainst = countBarsAgainst(candles, htfDirection);
  if (barsAgainst < 3) {
    return { direction: "none", barsAgainst, valid: false, tags: ["PULLBACK_TOO_SHORT"] };
  }

  const swingHigh = findLastPivotHigh(candles, lookback, lookback)?.price;
  const swingLow = findLastPivotLow(candles, lookback, lookback)?.price;

  const hasSwing = htfDirection === "bull" ? swingLow != null : htfDirection === "bear" ? swingHigh != null : false;
  if (!hasSwing) {
    tags.push("SWING_MISSING");
    return { direction: "none", barsAgainst, swingHigh, swingLow, valid: false, tags };
  }

  tags.push("PULLBACK_OK", "SWING_OK");
  return {
    direction: htfDirection === "bull" ? "long" : "short",
    swingHigh,
    swingLow,
    barsAgainst,
    valid: true,
    tags,
  };
}
