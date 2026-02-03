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
 * Computes Relative Strength Index (RSI) for a series of values.
 */
export function computeRsi(values: number[], period: number): number[] {
  if (!values.length) return [];
  const out: number[] = new Array(values.length).fill(Number.NaN);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const up = diff > 0 ? diff : 0;
    const down = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
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

/**
 * Utility function: Compute Average True Range (ATR) from arrays.
 * Returns an array of ATR values of the same length as input arrays.
 */
export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = i > 0 ? Math.abs(highs[i] - closes[i - 1]) : hl;
    const lc = i > 0 ? Math.abs(lows[i] - closes[i - 1]) : hl;
    const tr = Math.max(hl, hc, lc);
    if (i === 0) {
      result.push(tr);
    } else {
      // Wilder's smoothing: simple moving average for clarity
      const prev = result[i - 1] * (period - 1);
      result.push((prev + tr) / period);
    }
  }
  return result;
}

/**
 * Utility function: Compute Average Directional Index (ADX).
 * Returns an array of ADX values aligned to the input length.
 */
export function computeADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const tr = computeATR(highs, lows, closes, 1);
  // Smoothed TR over period
  const smoothedTR: number[] = [];
  for (let i = 0; i < tr.length; i++) {
    if (i === 0) smoothedTR.push(tr[0]);
    else smoothedTR.push((smoothedTR[i - 1] * (period - 1) + tr[i]) / period);
  }
  // Smoothed plus and minus DM
  const smoothedPlus: number[] = [];
  const smoothedMinus: number[] = [];
  for (let i = 0; i < plusDM.length; i++) {
    if (i === 0) {
      smoothedPlus.push(plusDM[0]);
      smoothedMinus.push(minusDM[0]);
    } else {
      smoothedPlus.push(
        (smoothedPlus[i - 1] * (period - 1) + plusDM[i]) / period,
      );
      smoothedMinus.push(
        (smoothedMinus[i - 1] * (period - 1) + minusDM[i]) / period,
      );
    }
  }
  // Calculate DI and DX
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];
  for (let i = 0; i < smoothedPlus.length; i++) {
    const trVal = smoothedTR[i + 1] || smoothedTR[i];
    const pdi = (smoothedPlus[i] / trVal) * 100;
    const mdi = (smoothedMinus[i] / trVal) * 100;
    plusDI.push(pdi);
    minusDI.push(mdi);
    dx.push(((Math.abs(pdi - mdi) / (pdi + mdi || 1)) || 0) * 100);
  }
  // Smooth DX to get ADX
  const adx: number[] = [];
  for (let i = 0; i < dx.length; i++) {
    if (i < period) {
      adx.push(0);
    } else if (i === period) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += dx[j];
      adx.push(sum / period);
    } else {
      adx.push(((adx[i - 1] * (period - 1)) + dx[i]) / period);
    }
  }
  // Align the length: pad initial zeros for first period elements
  const padding = new Array(period).fill(0);
  return padding.concat(adx).slice(0, highs.length);
}
