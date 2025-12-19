import test from "node:test";
import assert from "node:assert/strict";

// --- Copied from src/hooks/useTradingBot.ts for testing ---

const STOP_MIN_PCT = 0.0015; // 0.15 %
const TAKER_FEE = 0.0006; // orientační taker fee (0.06%)

function computeEma(candles, period) {
    if (!candles || candles.length === 0) return 0;
    const k = 2 / (period + 1);
    let ema = candles[0].close;
    for (let i = 1; i < candles.length; i++) {
        ema = candles[i].close * k + ema * (1 - k);
    }
    return ema;
}

function computeAtrFromHistory(candles, period = 20) {
    if (!candles || candles.length < 2) return 0;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const trs = [];
    for (let i = 1; i < closes.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        trs.push(Math.max(hl, hc, lc));
    }
    if (!trs.length) return 0;
    const slice = trs.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / slice.length;
}

function calculateChandelierStop(
    candles,
    direction,
    period = 22,
    multiplier = 3
) {
    if (candles.length < period) {
        return 0;
    }

    const recentCandles = candles.slice(-period);
    const atr = computeAtrFromHistory(recentCandles, period);

    if (direction === 'buy') {
        const highestHigh = Math.max(...recentCandles.map(c => c.high));
        return highestHigh - atr * multiplier;
    } else { // 'sell'
        const lowestLow = Math.min(...recentCandles.map(c => c.low));
        return lowestLow + atr * multiplier;
    }
}

function scoreVol(atrPct) {
    // Prefer 0.2 % – 0.8 % intraday volatility, decay outside.
    const idealMin = 0.002;
    const idealMax = 0.008;
    if (atrPct <= 0) return 0;
    if (atrPct < idealMin) return atrPct / idealMin; // up to 1
    if (atrPct > idealMax) return Math.max(0, 1 - (atrPct - idealMax) / idealMax);
    return 1.2; // slight bonus inside sweet spot
}

const netRrrWithFees = (entry, sl, tp, feePct) => {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) return 0;
    const risk = Math.abs(entry - sl) + entry * feePct * 2;
    const reward = Math.abs(tp - entry) - entry * feePct * 2;
    if (risk <= 0) return 0;
    return reward / risk;
};

function computeAtrPair(candles) {
    const atrShort = computeAtrFromHistory(candles, 14);
    const atrLong = computeAtrFromHistory(candles, 50) || atrShort || 1;
    return { atrShort, atrLong };
}

function buildDirectionalCandidate(symbol, candles) {
    if (!candles || candles.length < 50) return null; // Need enough for 50 EMA and Chandelier
    const price = candles[candles.length - 1]?.close;
    if (!Number.isFinite(price) || price <= 0) return null;

    const emaSlow = computeEma(candles, 50);

    let side = null;
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    // Long condition: price above 50 EMA, with two consecutive red candles for a pullback
    if (price > emaSlow &&
        lastCandle.close < lastCandle.open &&
        prevCandle.close < prevCandle.open) {
        side = "buy";
    }

    // Short condition: price below 50 EMA, with two consecutive green candles for a pullback
    if (price < emaSlow &&
        lastCandle.close > lastCandle.open &&
        prevCandle.close > prevCandle.open) {
        side = "sell";
    }

    if (!side) return null;

    // Invalidation: breakout candle size is significantly larger than the average.
    // I will check the candle before the two pullback candles.
    const breakoutCandle = candles[candles.length - 3];
    if (breakoutCandle) {
        const avgCandleSize = computeAtrFromHistory(candles.slice(-20, -3), 17); // ATR of 17 candles before the pullback
        if (avgCandleSize > 0) {
            const breakoutCandleSize = Math.abs(breakoutCandle.high - breakoutCandle.low);
            if (breakoutCandleSize > avgCandleSize * 3) { // 3x larger is "significant"
                return null; // Invalidate trade
            }
        }
    }


    const sl = calculateChandelierStop(candles, side, 22, 3);
    if (sl === 0) return null; // Not enough data

    // Invalidation: pullback breaks below the EMA
    if (side === 'buy' && Math.min(lastCandle.low, prevCandle.low) < emaSlow) {
        return null;
    }
    // Invalidation: pullback breaks above the EMA
    if (side === 'sell' && Math.max(lastCandle.high, prevCandle.high) > emaSlow) {
        return null;
    }


    const slDistance = Math.abs(price - sl);
    if (slDistance < price * STOP_MIN_PCT) return null; // Stop too tight

    const tpDistance = slDistance * 1.5; // Targeting 1.5R profit
    const tp = side === "buy" ? price + tpDistance : price - tpDistance;

    const { atrShort } = computeAtrPair(candles);
    const atrPct = atrShort > 0 ? atrShort / price : 0;
    const volScore = scoreVol(atrPct);
    const score = volScore; // Simplified score for now
    const risk = Math.min(0.95, Math.max(0.5, netRrrWithFees(price, sl, tp, TAKER_FEE) / 2));

    const reason = `${symbol} ${side.toUpperCase()} | 50 EMA + 2-bar pullback | Chandelier SL`;

    const signal = {
        id: `${symbol}-ema50-pullback-${Date.now()}`,
        symbol,
        profile: "intraday-ema50",
        kind: "PULLBACK",
        risk,
        createdAt: new Date().toISOString(),
        intent: {
            side,
            entry: price,
            sl,
            tp,
            symbol,
            qty: 0,
        },
        message: reason,
    };

    return { signal, score, reason };
}

// --- Test Cases ---

function buildCandles(data) {
    return data.map((d, i) => ({
        openTime: Date.now() + i * 60000,
        open: d.o,
        high: d.h,
        low: d.l,
        close: d.c,
        volume: d.v || 100
    }));
}

test("EMA 50 Pullback Strategy: Should generate a long signal", () => {
    const basePrice = 100;
    // Generate 50 candles to establish an EMA
    let candlesData = Array.from({ length: 50 }, (_, i) => ({
        o: basePrice + i * 0.1,
        h: basePrice + i * 0.1 + 0.1,
        l: basePrice + i * 0.1 - 0.1,
        c: basePrice + i * 0.1,
    }));

    // Price is above EMA
    const priceAboveEma = basePrice + 50 * 0.1 + 1; // 106

    // Add a breakout candle
    candlesData.push({ o: priceAboveEma - 0.2, h: priceAboveEma + 0.1, l: priceAboveEma - 0.3, c: priceAboveEma });

    // Add two red candles for pullback
    candlesData.push({ o: priceAboveEma, h: priceAboveEma, l: priceAboveEma - 0.2, c: priceAboveEma - 0.1 }); // Red candle
    candlesData.push({ o: priceAboveEma - 0.1, h: priceAboveEma - 0.1, l: priceAboveEma - 0.3, c: priceAboveEma - 0.2 }); // Red candle, final price

    const candles = buildCandles(candlesData);
    const result = buildDirectionalCandidate("BTCUSDT", candles);

    assert.ok(result, "Should generate a signal");
    assert.strictEqual(result.signal.intent.side, "buy", "Signal should be a buy");
    assert.ok(result.signal.intent.sl < result.signal.intent.entry, "Stop loss should be below entry for a buy");
    assert.ok(result.signal.intent.tp > result.signal.intent.entry, "Take profit should be above entry for a buy");
});


test("EMA 50 Pullback Strategy: Should generate a short signal", () => {
    const basePrice = 100;
    // Generate 50 candles to establish an EMA
    let candlesData = Array.from({ length: 50 }, (_, i) => ({
        o: basePrice - i * 0.1,
        h: basePrice - i * 0.1 + 0.1,
        l: basePrice - i * 0.1 - 0.1,
        c: basePrice - i * 0.1,
    }));

    // Price is below EMA
    const priceBelowEma = basePrice - 50 * 0.1 - 1; // 94

    // Add a breakdown candle
    candlesData.push({ o: priceBelowEma + 0.2, h: priceBelowEma + 0.3, l: priceBelowEma - 0.1, c: priceBelowEma });

    // Add two green candles for pullback
    candlesData.push({ o: priceBelowEma, h: priceBelowEma + 0.2, l: priceBelowEma, c: priceBelowEma + 0.1 }); // Green candle
    candlesData.push({ o: priceBelowEma + 0.1, h: priceBelowEma + 0.3, l: priceBelowEma + 0.1, c: priceBelowEma + 0.2 }); // Green candle, final price

    const candles = buildCandles(candlesData);
    const result = buildDirectionalCandidate("BTCUSDT", candles);

    assert.ok(result, "Should generate a signal");
    assert.strictEqual(result.signal.intent.side, "sell", "Signal should be a sell");
    assert.ok(result.signal.intent.sl > result.signal.intent.entry, "Stop loss should be above entry for a sell");
    assert.ok(result.signal.intent.tp < result.signal.intent.entry, "Take profit should be below entry for a sell");
});

test("EMA 50 Pullback Strategy: Should not generate signal if pullback crosses EMA (long)", () => {
    const basePrice = 100;
    let candlesData = Array.from({ length: 50 }, (_, i) => ({
        o: basePrice + i * 0.1,
        h: basePrice + i * 0.1 + 0.1,
        l: basePrice + i * 0.1 - 0.1,
        c: basePrice + i * 0.1,
    }));
    const ema50 = computeEma(buildCandles(candlesData), 50);

    // Price is above EMA
    const priceAboveEma = ema50 + 0.5;

    // Add a breakout candle
    candlesData.push({ o: priceAboveEma - 0.2, h: priceAboveEma + 0.1, l: priceAboveEma - 0.3, c: priceAboveEma });
    // Add two red candles for pullback, with one crossing below EMA
    candlesData.push({ o: priceAboveEma, h: priceAboveEma, l: priceAboveEma - 0.2, c: priceAboveEma - 0.1 }); // Red candle
    candlesData.push({ o: priceAboveEma - 0.1, h: priceAboveEma - 0.1, l: ema50 - 0.1, c: ema50 - 0.05 }); // Red candle that crosses EMA

    const candles = buildCandles(candlesData);
    const result = buildDirectionalCandidate("BTCUSDT", candles);

    assert.strictEqual(result, null, "Should not generate a signal if pullback crosses EMA");
});

test("EMA 50 Pullback Strategy: Should not generate signal for large breakout candle", () => {
    const basePrice = 100;
    let candlesData = Array.from({ length: 50 }, (_, i) => ({
        o: basePrice + i * 0.01,
        h: basePrice + i * 0.01 + 0.02,
        l: basePrice + i * 0.01 - 0.02,
        c: basePrice + i * 0.01,
    }));

    // Large breakout candle
    const breakoutPrice = basePrice + 50 * 0.01 + 5; // Large jump
    candlesData.push({ o: basePrice + 50 * 0.01, h: breakoutPrice + 0.1, l: basePrice + 50 * 0.01, c: breakoutPrice });

    // Two red candles
    candlesData.push({ o: breakoutPrice, h: breakoutPrice, l: breakoutPrice - 0.2, c: breakoutPrice - 0.1 });
    candlesData.push({ o: breakoutPrice - 0.1, h: breakoutPrice - 0.1, l: breakoutPrice - 0.3, c: breakoutPrice - 0.2 });

    const candles = buildCandles(candlesData);
    const result = buildDirectionalCandidate("BTCUSDT", candles);

    assert.strictEqual(result, null, "Should not generate a signal if breakout candle is too large");
});

test("EMA 50 Pullback Strategy: Should not generate signal if not a pullback", () => {
    const basePrice = 100;
    let candlesData = Array.from({ length: 50 }, (_, i) => ({
        o: basePrice + i * 0.1,
        h: basePrice + i * 0.1 + 0.1,
        l: basePrice + i * 0.1 - 0.1,
        c: basePrice + i * 0.1,
    }));
    const priceAboveEma = basePrice + 50 * 0.1 + 1;

    // All green candles
    candlesData.push({ o: priceAboveEma - 0.2, h: priceAboveEma + 0.1, l: priceAboveEma - 0.3, c: priceAboveEma });
    candlesData.push({ o: priceAboveEma, h: priceAboveEma + 0.2, l: priceAboveEma, c: priceAboveEma + 0.1 });
    candlesData.push({ o: priceAboveEma + 0.1, h: priceAboveEma + 0.3, l: priceAboveEma + 0.1, c: priceAboveEma + 0.2 });

    const candles = buildCandles(candlesData);
    const result = buildDirectionalCandidate("BTCUSDT", candles);

    assert.strictEqual(result, null, "Should not generate a signal if there is no 2-red-candle pullback");
});
