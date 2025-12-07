// Basic smoke tests for engine utilities (run with `ts-node src/engine/botEngine.test.ts` or build+node)
import { computePositionSize, resampleCandles, computeATR } from "./botEngine";
import { TradingBot } from "./botEngine";
function expect(cond, msg) {
    if (!cond)
        throw new Error(msg);
}
// Position sizing
{
    const size = computePositionSize(200000, 0.01, 100, 95);
    expect(Math.abs(size - 200) < 1e-6, "Position size mismatch");
}
// Resampling 1m -> 5m
{
    const candles = [];
    for (let i = 0; i < 5; i++) {
        candles.push({
            openTime: 1000 + i * 60000,
            open: 100 + i,
            high: 101 + i,
            low: 99 + i,
            close: 100.5 + i,
            volume: 10,
        });
    }
    const res = resampleCandles(candles, 5);
    expect(res.length === 1, "Resample should compress to single candle");
    expect(res[0].volume === 50, "Volume aggregation failed");
}
// ATR monotonicity sanity
{
    const highs = [10, 11, 12, 13];
    const lows = [9, 10, 11, 12];
    const closes = [9.5, 10.5, 11.5, 12.5];
    const atr = computeATR(highs, lows, closes, 3);
    expect(atr.length === highs.length, "ATR length mismatch");
    expect(atr[atr.length - 1] > 0, "ATR should be positive");
}
// Liquidity sweep + volatility expansion detection
{
    const config = {
        liquiditySweepLookback: 2,
        liquiditySweepAtrMult: 0.5,
        liquiditySweepVolumeMult: 1.1,
        volExpansionAtrMult: 1.2,
        volExpansionVolMult: 1.1,
    };
    const bot = new TradingBot(config);
    // Build HTF candles where last candle sweeps prior high and returns
    const df = [
        { openTime: 0, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
        { openTime: 1, open: 100.5, high: 102, low: 99.5, close: 100.4, volume: 20 },
        { openTime: 2, open: 100.4, high: 103, low: 99.7, close: 100.2, volume: 30 }, // sweep high then close back below
    ];
    const sweep = bot["isLiquiditySweep"](df);
    expect(sweep === true, "Liquidity sweep should be detected");
    const volDf = [
        { openTime: 0, open: 100, high: 101, low: 99, close: 100, volume: 10 },
        { openTime: 1, open: 100, high: 102, low: 99, close: 101.5, volume: 20 },
        { openTime: 2, open: 101.5, high: 104, low: 101, close: 103, volume: 30 },
        { openTime: 3, open: 103, high: 106, low: 102.5, close: 105, volume: 40 },
    ];
    const volExp = bot["isVolatilityExpansion"](volDf);
    expect(volExp === true, "Volatility expansion should be detected");
}
console.log("botEngine basic tests passed");
