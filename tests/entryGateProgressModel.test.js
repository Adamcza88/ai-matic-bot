import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEntryGateProgress,
  buildEntryState,
  buildRingSegmentsFromRows,
} from "../src/lib/entryGateProgressModel.js";

const makeRule = (name, passed, pending = false) => ({ name, passed, pending });

test("ai-matic: 3/3 -> READY", () => {
  const rules = [
    makeRule("Hard: ALL 4", true),
    makeRule("Entry: 3 of 4", true),
    makeRule("Checklist: 5 of 8", true),
  ];
  const progress = buildEntryGateProgress({
    profile: "ai-matic",
    passed: 3,
    required: 3,
    total: 3,
    label: "AI-MATIC checkpoints",
    signalActive: true,
    rules,
  });

  assert.equal(progress.valid, true);
  assert.equal(progress.state, "READY");
  assert.equal(progress.pct, 100);
});

test("ai-matic: 2/3 + no signal -> WAITING", () => {
  const rules = [
    makeRule("Hard: ALL 4", true),
    makeRule("Entry: 3 of 4", true),
    makeRule("Checklist: 5 of 8", false, true),
  ];
  const progress = buildEntryGateProgress({
    profile: "ai-matic",
    passed: 2,
    required: 3,
    total: 3,
    label: "AI-MATIC checkpoints",
    signalActive: false,
    rules,
  });

  assert.equal(progress.valid, false);
  assert.equal(progress.state, "WAITING");
  assert.equal(progress.pct, 67);
});

test("ai-matic: 2/3 + signal active -> BLOCKED", () => {
  const rules = [
    makeRule("Hard: ALL 4", true),
    makeRule("Entry: 3 of 4", true),
    makeRule("Checklist: 5 of 8", false),
  ];
  const progress = buildEntryGateProgress({
    profile: "ai-matic",
    passed: 2,
    required: 3,
    total: 3,
    label: "AI-MATIC checkpoints",
    signalActive: true,
    rules,
  });

  assert.equal(progress.valid, false);
  assert.equal(progress.state, "BLOCKED");
});

test("amd: pending gate -> WAITING", () => {
  const rules = [
    makeRule("AMD: Phase sequence", true),
    makeRule("AMD: Killzone active", false, true),
    makeRule("AMD: Midnight open set", false),
    makeRule("AMD: Asia range valid", false),
    makeRule("AMD: Liquidity sweep", false),
    makeRule("AMD: Inversion FVG confirm", false),
    makeRule("AMD: Target model valid", false),
  ];

  const state = buildEntryState({
    valid: false,
    signalActive: true,
    rules,
  });

  assert.equal(state, "WAITING");
});

test("amd: 7/7 -> READY", () => {
  const rules = [
    makeRule("AMD: Phase sequence", true),
    makeRule("AMD: Killzone active", true),
    makeRule("AMD: Midnight open set", true),
    makeRule("AMD: Asia range valid", true),
    makeRule("AMD: Liquidity sweep", true),
    makeRule("AMD: Inversion FVG confirm", true),
    makeRule("AMD: Target model valid", true),
  ];
  const progress = buildEntryGateProgress({
    profile: "ai-matic-amd",
    passed: 7,
    required: 7,
    total: 7,
    label: "AMD gates",
    signalActive: true,
    rules,
  });

  assert.equal(progress.state, "READY");
  assert.equal(progress.valid, true);
  assert.equal(progress.pct, 100);
});

test("olikella: 4/4 -> READY", () => {
  const progress = buildEntryGateProgress({
    profile: "ai-matic-olikella",
    passed: 4,
    required: 4,
    total: 4,
    label: "OLIkella gates",
    signalActive: true,
    rules: [
      makeRule("A", true),
      makeRule("B", true),
      makeRule("C", true),
      makeRule("D", true),
    ],
  });

  assert.equal(progress.state, "READY");
});

test("olikella: 3/4 + signal active -> BLOCKED", () => {
  const progress = buildEntryGateProgress({
    profile: "ai-matic-olikella",
    passed: 3,
    required: 4,
    total: 4,
    label: "OLIkella gates",
    signalActive: true,
    rules: [
      makeRule("A", true),
      makeRule("B", true),
      makeRule("C", true),
      makeRule("D", false),
    ],
  });

  assert.equal(progress.state, "BLOCKED");
});

test("pro: score >= threshold -> READY", () => {
  const progress = buildEntryGateProgress({
    profile: "ai-matic-pro",
    passed: 11,
    required: 10,
    total: 14,
    label: "PRO score",
    signalActive: true,
    rules: [makeRule("Score >= 10", true)],
  });

  assert.equal(progress.state, "READY");
  assert.equal(progress.valid, true);
  assert.equal(progress.pct, 100);
});

test("pro: score < threshold + no signal -> WAITING", () => {
  const progress = buildEntryGateProgress({
    profile: "ai-matic-pro",
    passed: 8,
    required: 10,
    total: 14,
    label: "PRO score",
    signalActive: false,
    rules: [makeRule("Score >= 10", false)],
  });

  assert.equal(progress.state, "WAITING");
  assert.equal(progress.valid, false);
});

test("x/tree/core: passed < threshold + signal active -> BLOCKED", () => {
  const progress = buildEntryGateProgress({
    profile: "ai-matic-x",
    passed: 7,
    required: 8,
    total: 14,
    label: "Checklist threshold",
    signalActive: true,
    rules: [makeRule("Checklist >= 8", false)],
  });

  assert.equal(progress.state, "BLOCKED");
  assert.equal(progress.valid, false);
});

test("buildRingSegmentsFromRows returns ordered segment distribution", () => {
  const segments = buildRingSegmentsFromRows([
    { name: "A", status: "ALLOWED", detail: "", enabled: true },
    { name: "B", status: "WAITING", detail: "", enabled: true },
    { name: "C", status: "BLOCKED", detail: "", enabled: true },
    { name: "D", status: "BLOCKED", detail: "", enabled: true },
    { name: "E", status: "DISABLED", detail: "", enabled: false },
  ]);

  assert.deepEqual(
    segments.map((segment) => segment.status),
    ["ALLOWED", "WAITING", "BLOCKED", "DISABLED"]
  );
  assert.deepEqual(
    segments.map((segment) => segment.count),
    [1, 1, 2, 1]
  );
  assert.equal(segments[2].pct, 40);
});
