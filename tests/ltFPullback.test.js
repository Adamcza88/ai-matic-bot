// tests/ltFPullback.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { detectLtfPullback } from "../src/engine/ltFPullback.js";

const c = (o, h, l, cls) => ({ open: o, high: h, low: l, close: cls });

function makeDownSeries(vals) {
  // close < open to count as barsAgainst for bull
  return vals.map((v) => c(v + 0.5, v + 0.5, v - 0.5, v));
}

function makeUpSeries(vals) {
  // close > open to count as barsAgainst for bear
  return vals.map((v) => c(v - 0.5, v + 0.5, v - 0.5, v));
}

test("detectLtfPullback bull with swing low", () => {
  const candles = makeDownSeries([105, 104, 103, 102, 101, 100, 99, 95, 99, 102]);
  const res = detectLtfPullback(candles, "bull", 2);
  assert.equal(res.direction, "long");
  assert.ok(res.valid);
  assert.ok(res.swingLow != null);
  assert.ok(res.barsAgainst >= 3);
});

test("detectLtfPullback bear with swing high", () => {
  const candles = makeUpSeries([95, 96, 97, 98, 99, 100, 101, 105, 101, 99]);
  const res = detectLtfPullback(candles, "bear", 2);
  assert.equal(res.direction, "short");
  assert.ok(res.valid);
  assert.ok(res.swingHigh != null);
});

test("detectLtfPullback fails when pullback too short", () => {
  const candles = makeDownSeries([100, 101, 102]);
  const res = detectLtfPullback(candles, "bull", 2);
  assert.equal(res.valid, false);
  assert.equal(res.direction, "none");
});
