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
            out.push(v * k + out[i - 1] * (1 - k));
    }
    return out;
}
export function computeSma(values, period) {
    if (!values.length)
        return [];
    const out = new Array(values.length).fill(0);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period)
            sum -= values[i - period];
        const denom = Math.min(period, i + 1);
        out[i] = sum / Math.max(1, denom);
    }
    return out;
}
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
export function computeSuperTrend(candles, atrPeriod, multiplier) {
    const n = candles.length;
    const dir = new Array(n).fill("DOWN");
    const line = new Array(n).fill(0);
    const upper = new Array(n).fill(0);
    const lower = new Array(n).fill(0);
    const atr = computeAtr(candles, atrPeriod);
    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const hl2 = (c.high + c.low) / 2;
        const basicUpper = hl2 + multiplier * (atr[i] || 0);
        const basicLower = hl2 - multiplier * (atr[i] || 0);
        if (i === 0) {
            upper[i] = basicUpper;
            lower[i] = basicLower;
            line[i] = basicUpper;
            dir[i] = "DOWN";
            continue;
        }
        const prevClose = candles[i - 1].close;
        upper[i] =
            basicUpper < upper[i - 1] || prevClose > upper[i - 1]
                ? basicUpper
                : upper[i - 1];
        lower[i] =
            basicLower > lower[i - 1] || prevClose < lower[i - 1]
                ? basicLower
                : lower[i - 1];
        const prevLine = line[i - 1];
        if (prevLine === upper[i - 1]) {
            line[i] = c.close <= upper[i] ? upper[i] : lower[i];
        }
        else {
            line[i] = c.close >= lower[i] ? lower[i] : upper[i];
        }
        dir[i] = line[i] === lower[i] ? "UP" : "DOWN";
    }
    return { dir, line, upper, lower, atr };
}
export function findLastPivotLow(candles, left = 3, right = 3) {
    if (candles.length < left + right + 1)
        return null;
    for (let i = candles.length - right - 1; i >= left; i--) {
        const pivot = candles[i].low;
        let ok = true;
        for (let j = 1; j <= left; j++) {
            if (candles[i - j].low <= pivot) {
                ok = false;
                break;
            }
        }
        if (!ok)
            continue;
        for (let j = 1; j <= right; j++) {
            if (candles[i + j].low <= pivot) {
                ok = false;
                break;
            }
        }
        if (ok)
            return pivot;
    }
    return null;
}
export function findLastPivotHigh(candles, left = 3, right = 3) {
    if (candles.length < left + right + 1)
        return null;
    for (let i = candles.length - right - 1; i >= left; i--) {
        const pivot = candles[i].high;
        let ok = true;
        for (let j = 1; j <= left; j++) {
            if (candles[i - j].high >= pivot) {
                ok = false;
                break;
            }
        }
        if (!ok)
            continue;
        for (let j = 1; j <= right; j++) {
            if (candles[i + j].high >= pivot) {
                ok = false;
                break;
            }
        }
        if (ok)
            return pivot;
    }
    return null;
}
export function roundDownToStep(value, step) {
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0)
        return 0;
    const precision = Math.round(1 / step);
    return Math.floor(value * precision) / precision;
}
export function roundToTick(value, tick) {
    if (!Number.isFinite(value) || !Number.isFinite(tick) || tick <= 0)
        return value;
    const precision = Math.round(1 / tick);
    return Math.round(value * precision) / precision;
}
