// Basic smoke tests for engine utilities (run with `ts-node src/engine/botEngine.test.ts` or build+node)
import { computePositionSize, resampleCandles, computeATR } from "./botEngine";

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Position sizing
{
  const size = computePositionSize(100000, 0.01, 100, 95);
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
  const res = resampleCandles(candles as any, 5);
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

console.log("botEngine basic tests passed");
