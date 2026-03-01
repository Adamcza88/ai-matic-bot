import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGateBlockers,
  buildGateDisplayRows,
  resolvePrimaryBlockerTarget,
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

test("pending gate + ok:false -> WAITING", () => {
  const status = resolveGateDisplayStatus({
    gate: { name: "AMD: Phase sequence", ok: false, pending: true },
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

test("blockers: system reason is first when execution is blocked", () => {
  const rows = buildGateDisplayRows({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      gates: [{ name: "HTF bias", ok: false, detail: "trend mismatch" }],
      entryBlockReasons: ["max positions reached"],
    },
    profileGateNames: ["HTF bias"],
    checklistEnabled: { "HTF bias": true },
  });
  const blockers = buildGateBlockers({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      gates: [{ name: "HTF bias", ok: false, detail: "trend mismatch" }],
      entryBlockReasons: ["max positions reached"],
    },
    rows,
  });
  assert.equal(blockers.length > 0, true);
  assert.equal(blockers[0].kind, "SYSTEM");
  assert.equal(blockers[0].reason, "max positions reached");
  assert.equal(blockers[0].targetStatus, "BLOCKED");
});

test("blockers: blocked gate is used when system reason is missing", () => {
  const rows = buildGateDisplayRows({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      gates: [{ name: "HTF bias", ok: false, detail: "trend mismatch" }],
    },
    profileGateNames: ["HTF bias"],
    checklistEnabled: { "HTF bias": true },
  });
  const blockers = buildGateBlockers({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      gates: [{ name: "HTF bias", ok: false, detail: "trend mismatch" }],
    },
    rows,
  });
  assert.equal(blockers.length > 0, true);
  assert.equal(blockers[0].kind, "GATE_BLOCKED");
  assert.equal(blockers[0].reason, "trend mismatch");
  assert.equal(blockers[0].targetStatus, "BLOCKED");
});

test("blockers: waiting state exposes waiting reasons", () => {
  const rows = buildGateDisplayRows({
    diag: {
      relayState: "WAITING",
      executionAllowed: null,
      signalActive: false,
      gates: [{ name: "AMD: Phase sequence", ok: false, pending: true, detail: "čeká DISTRIBUTION" }],
    },
    profileGateNames: ["AMD: Phase sequence"],
    checklistEnabled: { "AMD: Phase sequence": true },
  });
  const blockers = buildGateBlockers({
    diag: {
      relayState: "WAITING",
      executionAllowed: null,
      signalActive: false,
      gates: [{ name: "AMD: Phase sequence", ok: false, pending: true, detail: "čeká DISTRIBUTION" }],
    },
    rows,
  });
  assert.equal(blockers.length > 0, true);
  assert.equal(blockers[0].kind, "WAITING");
  assert.equal(blockers[0].targetStatus, "WAITING");
});

test("blockers: duplicate reasons are deduplicated", () => {
  const rows = buildGateDisplayRows({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      gates: [{ name: "HTF bias", ok: false, detail: "max positions reached" }],
      entryBlockReasons: ["max positions reached"],
      executionReason: "max positions reached",
      relayReason: "max positions reached",
    },
    profileGateNames: ["HTF bias"],
    checklistEnabled: { "HTF bias": true },
  });
  const blockers = buildGateBlockers({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      gates: [{ name: "HTF bias", ok: false, detail: "max positions reached" }],
      entryBlockReasons: ["max positions reached"],
      executionReason: "max positions reached",
      relayReason: "max positions reached",
    },
    rows,
  });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].reason, "max positions reached");
});

test("resolvePrimaryBlockerTarget: blocked when system block reason exists", () => {
  const target = resolvePrimaryBlockerTarget({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      entryBlockReasons: ["max positions reached"],
      gates: [{ name: "HTF bias", ok: false, detail: "trend mismatch" }],
    },
    profileGateNames: ["HTF bias"],
    checklistEnabled: { "HTF bias": true },
  });
  assert.equal(target, "BLOCKED");
});

test("resolvePrimaryBlockerTarget: waiting when pending gate is primary", () => {
  const target = resolvePrimaryBlockerTarget({
    diag: {
      relayState: "WAITING",
      executionAllowed: null,
      signalActive: false,
      gates: [{ name: "AMD: Phase sequence", ok: false, pending: true, detail: "čeká DISTRIBUTION" }],
    },
    profileGateNames: ["AMD: Phase sequence"],
    checklistEnabled: { "AMD: Phase sequence": true },
  });
  assert.equal(target, "WAITING");
});

test("resolvePrimaryBlockerTarget: null when no blockers found", () => {
  const target = resolvePrimaryBlockerTarget({
    diag: {
      relayState: "READY",
      executionAllowed: true,
      gates: [{ name: "Gate A", ok: true, detail: "ok" }],
    },
    profileGateNames: ["Gate A"],
    checklistEnabled: { "Gate A": true },
  });
  assert.equal(target, null);
});

test("resolvePrimaryBlockerTarget: duplicate reasons keep same target", () => {
  const target = resolvePrimaryBlockerTarget({
    diag: {
      relayState: "BLOCKED",
      executionAllowed: false,
      entryBlockReasons: ["max positions reached"],
      executionReason: "max positions reached",
      relayReason: "max positions reached",
      gates: [{ name: "HTF bias", ok: false, detail: "max positions reached" }],
    },
    profileGateNames: ["HTF bias"],
    checklistEnabled: { "HTF bias": true },
  });
  assert.equal(target, "BLOCKED");
});
