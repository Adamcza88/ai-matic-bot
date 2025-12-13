import test from "node:test";
import assert from "node:assert/strict";
import { detectCoachBreakout, coachDefaults } from "../src/engine/coachStrategy.js";
import type { Candle } from "../src/engine/botEngine";

// Helper to craft candles with incremental price/volume
function buildSeries(prices: number[], volumes: number[]): Candle[] {
    return prices.map((p, i) => ({
        openTime: i,
        open: p,
        high: p * 1.002,
        low: p * 0.998,
        close: p,
        volume: volumes[i] ?? volumes[volumes.length - 1] ?? 0,
    }));
}

test("detectCoachBreakout returns null without breakout", () => {
    const prices = Array.from({ length: 40 }, (_, i) => 100 + i * 0.1);
    const volumes = Array(40).fill(100);
    const res = detectCoachBreakout(buildSeries(prices, volumes), coachDefaults);
    assert.equal(res, null);
});

test("detectCoachBreakout flags breakout above base high with strong volume", () => {
    const basePrices = Array.from({ length: 30 }, (_, i) => 100 + i * 0.05);
    const baseVolumes = Array(30).fill(100);
    const breakoutPrices = [...basePrices, ...[101.5, 101.8, 102.2, 102.6, 103.0]];
    const breakoutVolumes = [...baseVolumes, 120, 130, 180, 200, 220]; // last volume 220 > 1.5x avg
    const candles = buildSeries(breakoutPrices, breakoutVolumes);
    const res = detectCoachBreakout(candles, coachDefaults);
    assert.ok(res, "Expected breakout signal");
    assert.ok(res!.intent.entry > res!.intent.sl, "Entry should exceed SL");
    assert.ok(res!.intent.tp > res!.intent.entry, "TP should exceed entry");
});
