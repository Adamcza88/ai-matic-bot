import { computeEma, findPivotsHigh, findPivotsLow } from "./ta";
export function evaluateHTFTrend(candles, lookbackOrOpts = 2) {
    const tags = [];
    const opts = typeof lookbackOrOpts === "number" ? undefined : lookbackOrOpts;
    const lookback = typeof lookbackOrOpts === "number" ? lookbackOrOpts : lookbackOrOpts?.lookback ?? 2;
    const emaPeriod = opts?.emaPeriod ?? 200;
    const minBars = opts?.minBars ?? Math.max(lookback * 2 + 2, emaPeriod);
    const slopeLookback = Math.max(1, opts?.slopeLookback ?? 6);
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
    let direction = "none";
    let score = 0;
    if (lastClose > ema200 && lastHigh && prevHigh && lastLow && prevLow) {
        const hh = lastHigh.price > prevHigh.price;
        const hl = lastLow.price > prevLow.price;
        if (hh && hl) {
            direction = "bull";
            tags.push("HH", "HL");
            score += 2;
        }
        if (lastClose > ema200)
            score += 1;
    }
    if (lastClose < ema200 && lastHigh && prevHigh && lastLow && prevLow) {
        const ll = lastLow.price < prevLow.price;
        const lh = lastHigh.price < prevHigh.price;
        if (ll && lh) {
            direction = "bear";
            tags.push("LL", "LH");
            score += 2;
        }
        if (lastClose < ema200)
            score += 1;
    }
    if (direction === "none")
        tags.push("STRUCTURE_NONE");
    const slopeBaseIdx = Math.max(0, ema200Arr.length - 1 - slopeLookback);
    const emaSlope = ema200Arr[ema200Arr.length - 1] - ema200Arr[slopeBaseIdx];
    if (direction === "bull" && emaSlope > 0)
        tags.push("EMA_SLOPE_UP");
    if (direction === "bear" && emaSlope < 0)
        tags.push("EMA_SLOPE_DOWN");
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
export function normalizeDirection(dir) {
    if (dir === "bull")
        return "long";
    if (dir === "bear")
        return "short";
    return "none";
}
function resampleCandles(candles, timeframeMin) {
    if (!candles.length)
        return [];
    const bucketMs = timeframeMin * 60_000;
    const buckets = new Map();
    candles.forEach((c, idx) => {
        const ts = Number.isFinite(c.openTime) ? c.openTime : idx * 60_000;
        const key = Math.floor(ts / bucketMs) * bucketMs;
        if (!buckets.has(key))
            buckets.set(key, []);
        buckets.get(key)?.push({ ...c, openTime: ts });
    });
    const out = [];
    Array.from(buckets.keys())
        .sort((a, b) => a - b)
        .forEach((key) => {
        const chunk = buckets.get(key) ?? [];
        if (!chunk.length)
            return;
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
export function evaluateHTFMultiTrend(candles, opts) {
    const timeframes = opts?.timeframesMin ?? [60, 240, 1440];
    const emaByTf = opts?.emaByTimeframe ?? { 60: 200, 240: 120, 1440: 60 };
    const byTimeframe = [];
    for (const tf of timeframes) {
        const sampled = resampleCandles(candles, tf);
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
    const tags = [];
    const bull = byTimeframe.filter((t) => t.result.direction === "bull").length;
    const bear = byTimeframe.filter((t) => t.result.direction === "bear").length;
    const alignedCount = Math.max(bull, bear);
    let consensus = "none";
    if (bull >= 2)
        consensus = "bull";
    else if (bear >= 2)
        consensus = "bear";
    if (consensus !== "none")
        tags.push(`ALIGN_${consensus.toUpperCase()}`);
    const score = byTimeframe.reduce((sum, t) => sum + (t.result.score || 0), 0);
    return {
        consensus,
        alignedCount,
        score,
        byTimeframe,
        tags,
    };
}
