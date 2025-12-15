// tests/liquidityEntry.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { buildLiquidityPlan, computeOffset } from "../src/engine/liquidityEntry.js";

test("computeOffset uses atr when larger than 2*tick", () => {
  const off = computeOffset(0.5, 20);
  assert.equal(off, Math.max(1, 0.05 * 20));
});

test("computeOffset falls back to tick when atr missing", () => {
  const off = computeOffset(0.5, undefined);
  assert.equal(off, 1);
});

test("buildLiquidityPlan long with swing low", () => {
  const pullback = { direction: "long", swingLow: 100, swingHigh: undefined, valid: true, barsAgainst: 4, tags: [] };
  const plan = buildLiquidityPlan(pullback, 0.5, 10);
  assert.equal(plan.valid, true);
  assert.equal(plan.direction, "long");
  assert.ok(plan.entry < 100);
  assert.equal(plan.stop, plan.entry);
});

test("buildLiquidityPlan short with swing high", () => {
  const pullback = { direction: "short", swingHigh: 200, swingLow: undefined, valid: true, barsAgainst: 4, tags: [] };
  const plan = buildLiquidityPlan(pullback, 0.5, 10);
  assert.equal(plan.valid, true);
  assert.equal(plan.direction, "short");
  assert.ok(plan.entry > 200);
  assert.equal(plan.stop, plan.entry);
});

test("buildLiquidityPlan invalid when swing missing", () => {
  const pullback = { direction: "long", swingLow: undefined, swingHigh: undefined, valid: true, barsAgainst: 4, tags: [] };
  const plan = buildLiquidityPlan(pullback, 0.5, 10);
  assert.equal(plan.valid, false);
  assert.equal(plan.reason, "MISSING_SWING_LOW");
});
