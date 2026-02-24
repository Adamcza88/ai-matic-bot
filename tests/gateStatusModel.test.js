import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGateDisplayRows,
  resolveGateDisplayStatus,
} from "../src/lib/gateStatusModel.js";

test("gate status: ON + ok:true -> ALLOWED", () => {
  const status = resolveGateDisplayStatus({
    gate: { name: "HTF bias", ok: true },
    enabled: true,
    diag: { relayState: "READY", executionAllowed: true },
  });
  assert.equal(status, "ALLOWED");
});

test("gate status: ON + ok:false -> BLOCKED", () => {
  const status = resolveGateDisplayStatus({
    gate: { name: "HTF bias", ok: false },
    enabled: true,
    diag: { relayState: "BLOCKED", executionAllowed: false },
  });
  assert.equal(status, "BLOCKED");
});

test("gate status: OFF -> DISABLED", () => {
  const status = resolveGateDisplayStatus({
    gate: { name: "HTF bias", ok: false },
    enabled: false,
    diag: { relayState: "BLOCKED", executionAllowed: false },
  });
  assert.equal(status, "DISABLED");
});

test("missing gate + WAITING context -> WAITING", () => {
  const status = resolveGateDisplayStatus({
    gate: null,
    enabled: true,
    diag: { relayState: "WAITING", executionAllowed: null, signalActive: false },
  });
  assert.equal(status, "WAITING");
});

test("AMD-like empty gates -> all enabled profile gates WAITING", () => {
  const rows = buildGateDisplayRows({
    diag: { relayState: "WAITING", executionAllowed: null, signalActive: false, gates: [] },
    profileGateNames: [
      "AMD: Phase sequence",
      "AMD: Killzone active",
      "AMD: Midnight open set",
    ],
    checklistEnabled: {
      "AMD: Phase sequence": true,
      "AMD: Killzone active": true,
      "AMD: Midnight open set": true,
    },
  });
  assert.equal(rows.length, 3);
  rows.forEach((row) => {
    assert.equal(row.status, "WAITING");
  });
});

test("buildGateDisplayRows keeps profileGateNames order", () => {
  const rows = buildGateDisplayRows({
    diag: {
      relayState: "READY",
      executionAllowed: true,
      gates: [
        { name: "Gate B", ok: true, detail: "b" },
        { name: "Gate A", ok: true, detail: "a" },
      ],
    },
    profileGateNames: ["Gate A", "Gate C", "Gate B"],
    checklistEnabled: {
      "Gate A": true,
      "Gate B": true,
      "Gate C": false,
    },
  });
  assert.deepEqual(rows.map((row) => row.name), ["Gate A", "Gate C", "Gate B"]);
  assert.deepEqual(rows.map((row) => row.status), ["ALLOWED", "DISABLED", "ALLOWED"]);
});
