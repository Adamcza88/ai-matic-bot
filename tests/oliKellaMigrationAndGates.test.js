import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OLIKELLA_CHECKLIST_DEFAULTS,
  OLIKELLA_GATE_NAMES,
  OLIKELLA_LEGACY_RISK_MODE,
  OLIKELLA_RISK_MODE,
  migrateRiskMode,
} from "../src/lib/oliKellaProfile.js";

test("OLIkella migration maps legacy risk mode to new key", () => {
  assert.equal(migrateRiskMode(OLIKELLA_LEGACY_RISK_MODE), OLIKELLA_RISK_MODE);
  assert.equal(migrateRiskMode("ai-matic"), "ai-matic");
  assert.equal(migrateRiskMode("ai-matic-amd"), "ai-matic-amd");
  assert.equal(migrateRiskMode("unknown-mode"), "ai-matic");
});

test("OLIkella checklist defaults contain exact gate names", () => {
  for (const gateName of OLIKELLA_GATE_NAMES) {
    assert.equal(OLIKELLA_CHECKLIST_DEFAULTS[gateName], true);
  }
  assert.equal(OLIKELLA_CHECKLIST_DEFAULTS["Exec allowed"], true);
});

test("OLIkella gate constants are wired in hook + settings + dashboard", () => {
  const hook = readFileSync("src/hooks/useTradingBot.ts", "utf8");
  const settings = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const dashboard = readFileSync("src/components/Dashboard.tsx", "utf8");

  assert.ok(hook.includes("OLIKELLA_GATE_SIGNAL_CHECKLIST"));
  assert.ok(hook.includes("OLIKELLA_GATE_ENTRY_CONDITIONS"));
  assert.ok(hook.includes("OLIKELLA_GATE_EXIT_CONDITIONS"));
  assert.ok(hook.includes("OLIKELLA_GATE_RISK_RULES"));

  assert.ok(settings.includes("OLIKELLA_GATE_NAMES"));
  assert.ok(dashboard.includes("OLIKELLA_CHECKLIST_DEFAULTS"));
});

test("AMD profile is wired in settings and dashboard", () => {
  const settings = readFileSync("src/components/SettingsPanel.tsx", "utf8");
  const dashboard = readFileSync("src/components/Dashboard.tsx", "utf8");
  const hook = readFileSync("src/hooks/useTradingBot.ts", "utf8");

  assert.ok(settings.includes("ai-matic-amd"));
  assert.ok(settings.includes("AI-Matic-AMD"));
  assert.ok(dashboard.includes("ai-matic-amd"));
  assert.ok(dashboard.includes("AI-MATIC-AMD"));
  assert.ok(hook.includes("evaluateAmdGates"));
});
