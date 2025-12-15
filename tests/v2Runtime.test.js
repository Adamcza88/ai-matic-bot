// tests/v2Runtime.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { V2Runtime } from "../src/engine/v2Runtime.js";
import { createSignalV2, createRiskSnapshotV2 } from "../src/engine/v2Contracts.js";

const cfg = {
  maxOrdersPerMin: 5,
  slippageBuffer: 0.1,
  feeRate: 0.0012,
  lotStep: 0.001,
  minQty: 0.001,
};

test("smoke: SCAN -> PLACE -> MANAGE -> EXIT", () => {
  const rt = new V2Runtime(cfg);
  const sig = createSignalV2({
    symbol: "BTCUSDT",
    direction: "long",
    htfTrend: "bull",
    entryZone: { high: 101, low: 100 },
    invalidate: 99,
  });
  const snap = createRiskSnapshotV2({ balance: 100, totalOpenRiskUsd: 0 });
  const plan = rt.requestPlace(sig, snap, "taker", 99);
  assert.equal(rt.state, "PLACE");
  rt.handleOrderAck("oid-1");
  rt.handleFill("oid-1", plan.symbol, "long", plan.entryPrice, plan.size, plan.stopLoss);
  assert.equal(rt.state, "MANAGE");
  rt.adjustStop(plan.symbol, plan.stopLoss + 0.5);
  rt.exitPosition(plan.symbol);
  assert.equal(rt.state, "EXIT");
});

test("risk budget enforces 4/8 and max positions", () => {
  const rt = new V2Runtime(cfg);
  rt.openPositions = [{ symbol: "BTCUSDT", side: "long", entry: 100, stop: 99, qty: 4, slActive: true }];
  const sig = createSignalV2({ symbol: "ETHUSDT", direction: "long", htfTrend: "bull", entryZone: { high: 51, low: 50 }, invalidate: 49 });
  const snap = createRiskSnapshotV2({ balance: 100, totalOpenRiskUsd: 8, maxAllowedRiskUsd: 8, maxPositions: 1 });
  assert.throws(() => rt.requestPlace(sig, snap, "taker", 49), /(Risk budget|Max positions)/);
});

test("kill switch blocks place", () => {
  const rt = new V2Runtime(cfg);
  rt.setKillSwitch(true);
  const sig = createSignalV2({ symbol: "BTCUSDT", direction: "long", htfTrend: "bull", entryZone: { high: 101, low: 100 }, invalidate: 99 });
  const snap = createRiskSnapshotV2({ balance: 100 });
  assert.throws(() => rt.requestPlace(sig, snap, "taker", 99), /SAFE\/KILL/);
});
