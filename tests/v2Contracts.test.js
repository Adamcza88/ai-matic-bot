// tests/v2Contracts.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  createSignalV2,
  createOrderPlanV2,
  createPositionStateV2,
  createRiskSnapshotV2,
} from "../src/engine/v2Contracts.js";

test("createSignalV2 builds minimal signal", () => {
  const s = createSignalV2({
    symbol: "BTCUSDT",
    entryZone: { high: 100, low: 99 },
  });
  assert.equal(s.symbol, "BTCUSDT");
  assert.equal(s.direction, "none");
  assert.equal(s.entryZone.low, 99);
  assert.ok(s.generatedAt);
});

test("createOrderPlanV2 requires mandatory fields", () => {
  assert.throws(() => createOrderPlanV2({}), /symbol required/);
  assert.throws(() => createOrderPlanV2({ symbol: "BTCUSDT" }), /direction required/);
  const plan = createOrderPlanV2({
    symbol: "BTCUSDT",
    direction: "buy",
    entryPrice: 100,
    stopLoss: 99,
    takeProfits: [{ price: 102, sizePct: 0.5 }],
  });
  assert.equal(plan.entryType, "limit");
  assert.equal(plan.stopLoss, 99);
  assert.equal(plan.takeProfits.length, 1);
});

test("createPositionStateV2 enforces required numbers", () => {
  assert.throws(() => createPositionStateV2({ symbol: "BTCUSDT" }), /side required/);
  assert.throws(() => createPositionStateV2({ symbol: "BTCUSDT", side: "long" }), /entryPrice required/);
  const pos = createPositionStateV2({
    symbol: "BTCUSDT",
    side: "long",
    entryPrice: 100,
    size: 0.01,
    stopLoss: 99,
  });
  assert.equal(pos.status, "open");
  assert.ok(pos.lastUpdate);
});

test("createRiskSnapshotV2 defaults limits", () => {
  assert.throws(() => createRiskSnapshotV2({}), /balance required/);
  const r = createRiskSnapshotV2({ balance: 100 });
  assert.equal(r.riskPerTradeUsd, 4);
  assert.equal(r.maxAllowedRiskUsd, 8);
  assert.equal(r.maxPositions, 2);
});
