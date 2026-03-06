import test from "node:test";
import assert from "node:assert/strict";
import { __aiMaticTest } from "../src/hooks/useTradingBot";

const { buildAiMaticCoreGroupedGates } = __aiMaticTest;

test("AI-MATIC Core grouped gates pass when all groups pass", () => {
  const grouped = buildAiMaticCoreGroupedGates({
    coreGates: [
      { name: "HTF bias", ok: true },
      { name: "EMA200 trend", ok: true },
      { name: "EMA200 breakout", ok: true },
      { name: "EMA200 confirm", ok: true },
      { name: "Trend strength", ok: true },
      { name: "ATR% window", ok: true },
      { name: "Volume Pxx", ok: true },
      { name: "LTF pullback", ok: true },
      { name: "Micro pivot", ok: true },
      { name: "Micro break close", ok: true },
      { name: "BBO fresh", ok: true },
      { name: "BBO age", ok: true },
      { name: "Maker entry", ok: true },
      { name: "SL structural", ok: true },
    ],
    trace: [
      { gate: "PositionCapacity", result: { ok: true, code: "OK", reason: "capacity" } },
      { gate: "OrderCapacity", result: { ok: true, code: "OK", reason: "orders" } },
      { gate: "DataHealth", result: { ok: true, code: "OK", reason: "data" } },
      { gate: "ProtectionSL", result: { ok: true, code: "OK", reason: "protection" } },
    ],
  });

  assert.equal(grouped.pass, true);
  assert.equal(grouped.gates.length, 4);
  assert.ok(grouped.gates.every((gate) => gate.ok));
});

test("AI-MATIC Core grouped gates fail when one grouped bucket fails", () => {
  const grouped = buildAiMaticCoreGroupedGates({
    coreGates: [
      { name: "HTF bias", ok: true },
      { name: "EMA200 trend", ok: true },
      { name: "EMA200 breakout", ok: true },
      { name: "EMA200 confirm", ok: true },
      { name: "Trend strength", ok: true },
      { name: "ATR% window", ok: true },
      { name: "Volume Pxx", ok: true },
      { name: "LTF pullback", ok: true },
      { name: "Micro pivot", ok: true },
      { name: "Micro break close", ok: true },
      { name: "BBO fresh", ok: true },
      { name: "BBO age", ok: false },
      { name: "Maker entry", ok: true },
      { name: "SL structural", ok: true },
    ],
    trace: [
      { gate: "PositionCapacity", result: { ok: true, code: "OK", reason: "capacity" } },
      { gate: "OrderCapacity", result: { ok: false, code: "MAX_ORDERS", reason: "orders" } },
    ],
  });

  assert.equal(grouped.pass, false);
  assert.equal(grouped.gates[2]?.ok, false);
  assert.equal(grouped.gates[3]?.ok, false);
});
