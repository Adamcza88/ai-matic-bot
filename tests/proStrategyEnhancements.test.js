import test from "node:test";
import assert from "node:assert/strict";
import { computeAtr } from "../src/engine/ta.js";
import { computeMarketProfile } from "../src/engine/marketProfile.js";
import { __aiMaticProTest } from "../src/engine/aiMaticProStrategy.js";

const { detectFvgMid, isSfpBodyConfirmed } = __aiMaticProTest;

function candle(open, high, low, close, idx) {
  return {
    openTime: idx * 60_000,
    open,
    high,
    low,
    close,
    volume: 100,
  };
}

test("Market Profile uses ATR-driven bucket size (ATR/20)", () => {
  const candles = Array.from({ length: 30 }, (_, i) =>
    candle(100 + i * 0.2, 102 + i * 0.2, 98 + i * 0.2, 100 + i * 0.2, i)
  );
  const profile = computeMarketProfile({ candles, atrDivisor: 20 });
  assert.ok(profile);
  const atr = computeAtr(candles, 14).slice(-1)[0];
  const expected = atr / 20;
  assert.ok(Math.abs(profile.bucketSize - expected) < 1e-8);
});

test("Market Profile KDE smooths discrete bucket spikes", () => {
  const candles = Array.from({ length: 30 }, (_, i) =>
    candle(100 + i * 0.2, 102 + i * 0.2, 98 + i * 0.2, 100 + i * 0.2, i)
  );
  const trades = [
    { ts: 0, price: 99.8, size: 10 },
    { ts: 1, price: 100.0, size: 1000 },
    { ts: 2, price: 100.2, size: 10 },
  ];
  const profile = computeMarketProfile({
    candles,
    trades,
    atrDivisor: 20,
    kdeSigma: 1.2,
  });
  assert.ok(profile);
  const byPrice = new Map(profile.buckets.map((b) => [Number(b.price.toFixed(4)), b.volume]));
  const left = byPrice.get(99.8);
  const center = byPrice.get(100.0);
  const right = byPrice.get(100.2);
  assert.ok(Number.isFinite(left));
  assert.ok(Number.isFinite(center));
  assert.ok(Number.isFinite(right));
  assert.ok(center < 1000);
  assert.ok(left > 10);
  assert.ok(right > 10);
});

test("FVG detector returns first unmitigated gap from backward scan", () => {
  const candles = [
    candle(99.5, 100, 99, 99.5, 0),
    candle(100, 101, 99.5, 100.5, 1),
    candle(103, 104, 103, 103.5, 2),
    candle(101.5, 102, 101, 101.2, 3),
    candle(102, 103, 102, 102.5, 4),
    candle(105, 106, 105, 105.5, 5),
  ];
  const mid = detectFvgMid(candles, "Buy");
  assert.equal(mid, 103.5);
});

test("FVG detector skips mitigated gaps", () => {
  const candles = [
    candle(99.5, 100, 99, 99.5, 0),
    candle(100, 101, 99.5, 100.5, 1),
    candle(103, 104, 103, 103.5, 2),
    candle(101.5, 102, 101, 101.2, 3),
    candle(102, 103, 102, 102.5, 4),
    candle(105, 106, 105, 105.5, 5),
    candle(102.8, 103, 102.5, 102.7, 6),
  ];
  const mid = detectFvgMid(candles, "Buy");
  assert.equal(mid, null);
});

test("SFP confirmation requires next candle body outside trigger extremes", () => {
  const trigger = candle(103, 110, 95, 98, 0);
  const confirmedBear = candle(94, 94.5, 90, 93, 1);
  const rejectedBear = candle(96, 97, 91, 94, 2);
  assert.equal(isSfpBodyConfirmed(trigger, confirmedBear, "Sell"), true);
  assert.equal(isSfpBodyConfirmed(trigger, rejectedBear, "Sell"), false);

  const triggerBull = candle(97, 105, 90, 102, 3);
  const confirmedBull = candle(106, 112, 105.5, 110, 4);
  const rejectedBull = candle(104, 109, 101, 108, 5);
  assert.equal(isSfpBodyConfirmed(triggerBull, confirmedBull, "Buy"), true);
  assert.equal(isSfpBodyConfirmed(triggerBull, rejectedBull, "Buy"), false);
});
