import test from "node:test";
import assert from "node:assert/strict";
import { __scalpTest } from "../src/hooks/useTradingBot.js";

const {
  resolveScalpFibLevels,
  buildScalpFibData,
  resolveScalpConfirmation,
} = __scalpTest;

const closeTo = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("Scalp fib levels: retrace + extension (bull)", () => {
  const swing = { high: 120, low: 100, range: 20 };
  const { retrace, ext } = resolveScalpFibLevels(swing, "BULL");
  assert.equal(closeTo(retrace["38.2"], 112.36, 1e-2), true);
  assert.equal(closeTo(retrace["50"], 110, 1e-6), true);
  assert.equal(closeTo(retrace["61.8"], 107.64, 1e-2), true);
  assert.equal(closeTo(ext["61.8"], 132.36, 1e-2), true);
  assert.equal(closeTo(ext["100"], 140, 1e-6), true);
  assert.equal(closeTo(ext["161.8"], 152.36, 1e-2), true);
});

test("Scalp fib zone detection: hybrid 5m + 1m", () => {
  const fib = buildScalpFibData({
    m15Highs: [{ idx: 10, price: 120 }],
    m15Lows: [{ idx: 5, price: 100 }],
    direction: "BULL",
    m5Close: 110.1,
    ltfClose: 110.15,
    atr: 1,
  });
  assert.ok(fib);
  assert.equal(fib.m5InZone, true);
  assert.equal(fib.ltfInZone, true);
  assert.equal(fib.hitLevel, "50");
});

test("Scalp confirmation aggregation", () => {
  const confirm = resolveScalpConfirmation({
    pois: [
      { type: "OB", direction: "bullish", low: 109, high: 111 },
      { type: "FVG", direction: "bearish", low: 120, high: 122 },
    ],
    price: 110,
    direction: "BULL",
    vpConfirm: false,
    tlPullback: true,
  });
  assert.equal(confirm.obTouch, true);
  assert.equal(confirm.gapTouch, false);
  assert.equal(confirm.vpConfirm, false);
  assert.equal(confirm.tlPullback, true);
  assert.equal(confirm.any, true);
});
