// tests/htfTrendFilter.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHTFTrend, normalizeDirection } from "../src/engine/htfTrendFilter.js";

const makeCandle = (o, h, l, c) => ({ open: o, high: h, low: l, close: c });

test("evaluateHTFTrend detects bull HH+HL", () => {
  const base = Array.from({ length: 240 }, () => 90);
  const leg = [106, 102, 108, 104, 110, 106, 112, 108, 114, 110];
  const series = [...base, ...leg].map((v) => makeCandle(v, v + 1, v - 1, v));
  const highs = series;
  const res = evaluateHTFTrend(highs, 1);
  assert.equal(res.direction, "bull");
  assert.ok(res.tags.includes("HH"));
  assert.ok(res.tags.includes("HL"));
  assert.equal(normalizeDirection(res.direction), "long");
});

test("evaluateHTFTrend detects bear LL+LH", () => {
  const base = Array.from({ length: 238 }, () => 120);
  const pre = [90, 92];
  const leg = [90, 94, 88, 92, 86, 90, 84, 88, 82, 86];
  const series = [...base, ...pre, ...leg].map((v) => makeCandle(v, v + 1, v - 1, v));
  const lows = series;
  const res = evaluateHTFTrend(lows, 1);
  assert.equal(res.direction, "bear");
  assert.ok(res.tags.includes("LL"));
  assert.ok(res.tags.includes("LH"));
  assert.equal(normalizeDirection(res.direction), "short");
});

test("evaluateHTFTrend returns none when structure missing", () => {
  const flat = Array.from({ length: 260 }, () => 100).map((v) =>
    makeCandle(v, v + 1, v - 1, v)
  );
  const res = evaluateHTFTrend(flat, 2);
  assert.equal(res.direction, "none");
  assert.ok(res.tags.includes("STRUCTURE_NONE"));
});
