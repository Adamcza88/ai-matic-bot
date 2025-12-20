// src/engine/ta.ts

export type Ohlcv = {
  openTime?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type Pivot = {
  idx: number;
  price: number;
};

/**
 * Computes Exponential Moving Average (EMA) for a series of values.
 */
export function computeEma(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (i === 0) out.push(v);
    else out.push(v * k + (out[i - 1] * (1 - k)));
  }
  return out;
}

/**
 * Computes Average True Range (ATR) for a series of candles.
 */
export function computeAtr(candles: Ohlcv[], period: number): number[] {
  if (!candles.length) return [];
  const out: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = prev
      ? Math.max(
          c.high - c.low,
          Math.abs(c.high - prev.close),
          Math.abs(c.low - prev.close)
        )
      : c.high - c.low;
    if (i === 0) {
      out[i] = tr;
    } else {
      // Wilder smoothing
      out[i] = (out[i - 1] * (period - 1) + tr) / period;
    }
  }
  return out;
}

/**
 * Finds all pivot high points in a series of candles.
 * A pivot high is a candle whose high is greater than the highs of `left` candles to the left and `right` candles to the right.
 */
export function findPivotsHigh(candles: Ohlcv[], left: number, right: number): Pivot[] {
  const pivots: Pivot[] = [];
  if (candles.length < left + right + 1) return pivots;

  for (let i = left; i < candles.length - right; i++) {
    const h = candles[i].high;
    let isHigh = true;
    for (let j = 1; j <= left; j++) {
      if (candles[i - j].high >= h) {
        isHigh = false;
        break;
      }
    }
    if (!isHigh) continue;
    for (let j = 1; j <= right; j++) {
      if (candles[i + j].high >= h) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) pivots.push({ idx: i, price: h });
  }
  return pivots;
}

/**
 * Finds all pivot low points in a series of candles.
 * A pivot low is a candle whose low is less than the lows of `left` candles to the left and `right` candles to the right.
 */
export function findPivotsLow(candles: Ohlcv[], left: number, right: number): Pivot[] {
  const pivots: Pivot[] = [];
  if (candles.length < left + right + 1) return pivots;

  for (let i = left; i < candles.length - right; i++) {
    const l = candles[i].low;
    let isLow = true;
    for (let j = 1; j <= left; j++) {
      if (candles[i - j].low <= l) {
        isLow = false;
        break;
      }
    }
    if (!isLow) continue;
    for (let j = 1; j <= right; j++) {
      if (candles[i + j].low <= l) {
        isLow = false;
        break;
      }
    }
    if (isLow) pivots.push({ idx: i, price: l });
  }
  return pivots;
}

/**
 * Finds the last pivot high.
 */
export function findLastPivotHigh(candles: Ohlcv[], left: number, right: number): Pivot | null {
    const pivots = findPivotsHigh(candles, left, right);
    return pivots.length > 0 ? pivots[pivots.length - 1] : null;
}

/**
 * Finds the last pivot low.
 */
export function findLastPivotLow(candles: Ohlcv[], left: number, right: number): Pivot | null {
    const pivots = findPivotsLow(candles, left, right);
    return pivots.length > 0 ? pivots[pivots.length - 1] : null;
}
