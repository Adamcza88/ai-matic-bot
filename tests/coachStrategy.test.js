import test from "node:test";
import assert from "node:assert/strict";
import { detectCoachBreakout, coachDefaults, detectSituationalEdges } from "../src/engine/coachStrategy.js";

function buildSeries(prices, volumes) {
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
    const breakoutVolumes = [...baseVolumes, 120, 130, 180, 200, 220];
    const candles = buildSeries(breakoutPrices, breakoutVolumes);
    const res = detectCoachBreakout(candles, coachDefaults);
    assert.ok(res, "Expected breakout signal");
    assert.ok(res.intent.entry > res.intent.sl, "Entry should exceed SL");
    assert.ok(res.intent.tp > res.intent.entry, "TP should exceed entry");
});

test("detectSituationalEdges triggers Friday<Thursday edge", () => {
    const baseTs = Date.UTC(2024, 0, 1); // Monday
    const day = 24 * 60 * 60 * 1000;
    const daily = [
        { openTime: baseTs, high: 105, low: 99 },
        { openTime: baseTs + day, high: 104.5, low: 102 },
        { openTime: baseTs + 2 * day, high: 104, low: 101 },
        { openTime: baseTs + 3 * day, high: 103, low: 100 },
        { openTime: baseTs + 4 * day, high: 102.5, low: 99.5 }, // Fri lower high
    ];
    const res = detectSituationalEdges(daily, 101);
    assert.ok(res, "Expected situational edge for Friday lower high");
    assert.equal(res.intent.side, "sell");
    assert.equal(res.intent.tp, 99.5);
});

test("detectSituationalEdges triggers Wednesday<Monday edge", () => {
    const baseTs = Date.UTC(2024, 0, 1); // Monday
    const day = 24 * 60 * 60 * 1000;
    const daily = [
        { openTime: baseTs, high: 105, low: 99 },
        { openTime: baseTs + day, high: 104.5, low: 102 },
        { openTime: baseTs + 2 * day, high: 103.5, low: 101 }, // Wed lower high vs Mon
    ];
    const res = detectSituationalEdges(daily, 103);
    assert.ok(res, "Expected situational edge for Wednesday lower high vs Monday");
    assert.equal(res.intent.tp, 101);
});
