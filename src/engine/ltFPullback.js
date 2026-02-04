// src/engine/ltFPullback.ts
// LTF pullback + swing detekce pro V2 (David Paul – 3 pravidla)
import { computeEma, computeRsi, findLastPivotHigh, findLastPivotLow } from "./ta.js";
function countBarsAgainst(candles, dir) {
    let count = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
        const c = candles[i];
        const isAgainst = dir === "bull" ? c.close < c.open : dir === "bear" ? c.close > c.open : false;
        if (isAgainst)
            count += 1;
        else
            break;
    }
    return count;
}
export function detectLtfPullback(candles, htfDirection, lookbackOrOpts = 2, maybeOpts) {
    const tags = [];
    const opts = typeof lookbackOrOpts === "number" ? maybeOpts : lookbackOrOpts;
    const lookback = typeof lookbackOrOpts === "number"
        ? lookbackOrOpts
        : lookbackOrOpts?.lookback ?? 2;
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
    const closes = candles.map((c) => c.close);
    const useEmaFilter = opts?.emaPeriod != null || opts?.emaLookback != null;
    if (useEmaFilter) {
        const emaPeriod = opts?.emaPeriod ?? 50;
        const emaArr = computeEma(closes, emaPeriod);
        const emaNow = emaArr[emaArr.length - 1];
        const lookbackBars = Math.max(1, opts?.emaLookback ?? 3);
        const recent = candles.slice(-lookbackBars);
        const emaTouched = htfDirection === "bull"
            ? recent.some((c) => c.low <= emaNow && c.close >= emaNow)
            : htfDirection === "bear"
                ? recent.some((c) => c.high >= emaNow && c.close <= emaNow)
                : false;
        if (!Number.isFinite(emaNow) || !emaTouched) {
            tags.push("EMA_PULLBACK_MISSING");
            return { direction: "none", barsAgainst, swingHigh, swingLow, valid: false, tags };
        }
        tags.push("EMA_PULLBACK_OK");
    }
    const useRsiFilter = opts?.rsiPeriod != null || opts?.rsiMin != null || opts?.rsiMax != null;
    if (useRsiFilter) {
        const rsiPeriod = opts?.rsiPeriod ?? 14;
        const rsiArr = computeRsi(closes, rsiPeriod);
        const rsiNow = rsiArr[rsiArr.length - 1];
        const rsiMin = opts?.rsiMin ?? 40;
        const rsiMax = opts?.rsiMax ?? 60;
        const rsiOk = htfDirection === "bull"
            ? Number.isFinite(rsiNow) && rsiNow >= rsiMin
            : htfDirection === "bear"
                ? Number.isFinite(rsiNow) && rsiNow <= rsiMax
                : false;
        if (!rsiOk) {
            tags.push("RSI_FILTER_BLOCK");
            return { direction: "none", barsAgainst, swingHigh, swingLow, valid: false, tags };
        }
        tags.push("RSI_OK");
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
