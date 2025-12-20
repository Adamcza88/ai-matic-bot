import { computeEma, findPivotsHigh, findPivotsLow } from "./ta";
export function evaluateHTFTrend(candles, lookback = 2) {
    const tags = [];
    if (!candles || candles.length < Math.max(lookback * 2 + 2, 200)) {
        return { direction: "none", ema200: 0, close: 0, tags: ["INSUFFICIENT_DATA"] };
    }
    const closes = candles.map((c) => c.close);
    const ema200Arr = computeEma(closes, 200);
    const ema200 = ema200Arr[ema200Arr.length - 1];
    const lastClose = closes[closes.length - 1];
    const highs = findPivotsHigh(candles, lookback, lookback);
    const lows = findPivotsLow(candles, lookback, lookback);
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    let direction = "none";
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
    if (direction === "none")
        tags.push("STRUCTURE_NONE");
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
export function normalizeDirection(dir) {
    if (dir === "bull")
        return "long";
    if (dir === "bear")
        return "short";
    return "none";
}
