// src/engine/ta.ts
/**
 * Computes Exponential Moving Average (EMA) for a series of values.
 */
export function computeEma(values, period) {
    if (!values.length)
        return [];
    const k = 2 / (period + 1);
    const out = [];
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (i === 0)
            out.push(v);
        else
            out.push(v * k + (out[i - 1] * (1 - k)));
    }
    return out;
}
/**
 * Computes Average True Range (ATR) for a series of candles.
 */
export function computeAtr(candles, period) {
    if (!candles.length)
        return [];
    const out = new Array(candles.length).fill(0);
    for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        const prev = candles[i - 1];
        const tr = prev
            ? Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
            : c.high - c.low;
        if (i === 0) {
            out[i] = tr;
        }
        else {
            // Wilder smoothing
            out[i] = (out[i - 1] * (period - 1) + tr) / period;
        }
    }
    return out;
}
/**
 * Computes Relative Strength Index (RSI) for a series of values.
 */
export function computeRsi(values, period) {
    if (!values.length)
        return [];
    const out = new Array(values.length).fill(Number.NaN);
    if (values.length <= period)
        return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = values[i] - values[i - 1];
        if (diff >= 0)
            gain += diff;
        else
            loss -= diff;
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
export function findPivotsHigh(candles, left, right) {
    const pivots = [];
    if (candles.length < left + right + 1)
        return pivots;
    for (let i = left; i < candles.length - right; i++) {
        const h = candles[i].high;
        let isHigh = true;
        for (let j = 1; j <= left; j++) {
            if (candles[i - j].high >= h) {
                isHigh = false;
                break;
            }
        }
        if (!isHigh)
            continue;
        for (let j = 1; j <= right; j++) {
            if (candles[i + j].high >= h) {
                isHigh = false;
                break;
            }
        }
        if (isHigh)
            pivots.push({ idx: i, price: h });
    }
    return pivots;
}
/**
 * Finds all pivot low points in a series of candles.
 * A pivot low is a candle whose low is less than the lows of `left` candles to the left and `right` candles to the right.
 */
export function findPivotsLow(candles, left, right) {
    const pivots = [];
    if (candles.length < left + right + 1)
        return pivots;
    for (let i = left; i < candles.length - right; i++) {
        const l = candles[i].low;
        let isLow = true;
        for (let j = 1; j <= left; j++) {
            if (candles[i - j].low <= l) {
                isLow = false;
                break;
            }
        }
        if (!isLow)
            continue;
        for (let j = 1; j <= right; j++) {
            if (candles[i + j].low <= l) {
                isLow = false;
                break;
            }
        }
        if (isLow)
            pivots.push({ idx: i, price: l });
    }
    return pivots;
}
/**
 * Finds the last pivot high.
 */
export function findLastPivotHigh(candles, left, right) {
    const pivots = findPivotsHigh(candles, left, right);
    return pivots.length > 0 ? pivots[pivots.length - 1] : null;
}
/**
 * Finds the last pivot low.
 */
export function findLastPivotLow(candles, left, right) {
    const pivots = findPivotsLow(candles, left, right);
    return pivots.length > 0 ? pivots[pivots.length - 1] : null;
}
