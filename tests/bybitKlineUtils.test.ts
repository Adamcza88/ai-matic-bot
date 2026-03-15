import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTodBaseline,
  highest,
  keepClosedKlines,
  lowest,
  median,
  parseBybitKlines,
  sign,
  slotMinuteUtc,
  tfMinToBybitInterval,
  tfMinToMs,
} from "../src/engine/bybitKline";

test("helper functions follow strict behavior", () => {
  assert.equal(highest([1, 4, 2]), 4);
  assert.equal(lowest([1, 4, 2]), 1);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 4, 9]), 3);
  assert.equal(sign(10), 1);
  assert.equal(sign(-1), -1);
  assert.equal(sign(0), 0);
  assert.throws(() => highest([]), /highest: empty input/);
  assert.throws(() => lowest([]), /lowest: empty input/);
  assert.throws(() => median([]), /median: empty input/);
});

test("parse and timeframe helpers map values exactly", () => {
  const parsed = parseBybitKlines([
    ["1000", "1", "2", "0.5", "1.5", "10", "20"],
  ]);
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0], {
    startTime: 1000,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    turnover: 20,
  });
  assert.equal(tfMinToBybitInterval(15), "15");
  assert.equal(tfMinToMs(5), 300000);
  assert.throws(() => tfMinToBybitInterval(7), /Unsupported tfMin: 7/);
});

test("keepClosedKlines filters open bar and ToD baseline fallback works", () => {
  const tfMin = 5;
  const nowMs = Date.UTC(2026, 0, 15, 12, 5, 0);
  const base = Date.UTC(2026, 0, 15, 11, 50, 0);
  const klines = [
    { startTime: base, open: 1, high: 2, low: 1, close: 2, volume: 100, turnover: 0 },
    { startTime: base + tfMinToMs(tfMin), open: 2, high: 3, low: 2, close: 3, volume: 110, turnover: 0 },
    { startTime: base + tfMinToMs(tfMin) * 2, open: 3, high: 4, low: 3, close: 4, volume: 120, turnover: 0 },
    { startTime: base + tfMinToMs(tfMin) * 3, open: 4, high: 5, low: 4, close: 5, volume: 130, turnover: 0 },
  ];
  const closed = keepClosedKlines(klines, tfMin, nowMs);
  assert.equal(closed.length, 3);
  const slot = slotMinuteUtc(closed[2].startTime);
  const baseline = buildTodBaseline({
    currentBar: closed[2],
    history: closed.slice(0, 2),
    volumeCurrent: 120,
    volumeP50: 90,
    volumeP60: 95,
    minSamples: 10,
  });
  assert.equal(baseline.volumeTodFallback, true);
  assert.equal(baseline.volumeTodBaseline, 90);
  assert.ok(Math.abs(baseline.volumeTodThreshold - 99) < 1e-9);
  assert.equal(baseline.volumeTodSlotMinute, slot);
});
