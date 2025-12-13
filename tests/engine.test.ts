import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeQty, computeRisk, computeQty, TradingBot, State, Trend } from '../src/engine/botEngine.ts';

test("C1: Engine - normalizeQty", () => {
    assert.strictEqual(normalizeQty(1.23456, 0.001), 1.234);
    assert.strictEqual(normalizeQty(100.5, 1), 100);
    assert.strictEqual(normalizeQty(0.0001, 0.001), 0); // Round down to 0 if < step? logic says floor. 0.0001 * 1000 = 0.1 -> floor -> 0. Correct.
    assert.strictEqual(normalizeQty(0.0019, 0.001), 0.001);
});

test("C1: Engine - computeRisk", () => {
    assert.strictEqual(computeRisk(50000, 49000), 1000);
    assert.strictEqual(computeRisk(50000, 51000), 1000); // Abs diff
});

test("C1: Engine - computeQty", () => {
    // Balance 1000, Risk 1% (10), StopDist 100
    // Size = 10 / 100 = 0.1
    assert.strictEqual(computeQty(1000, 0.01, 50000, 49900, 0.001), 0.1);

    // Balance 1000, Risk 1% (10), StopDist 1
    // Size = 10 / 1 = 10
    assert.strictEqual(computeQty(1000, 0.01, 100, 99, 1), 10);
});

test("C1: Engine - State Transition & Single Position Rule", () => {
    const bot = new TradingBot({ symbol: "BTCUSDT" });

    // Initially SCAN
    // We can't easily access private state 'state' directly without reflection or inspecting behavior 
    // BUT we added canEnter() public method.
    assert.strictEqual(bot.canEnter(), true);

    // Enter
    bot.safeEnterPosition("long", 50000, 49000);

    // Now MANAGE
    assert.strictEqual(bot.canEnter(), false);

    // Try double entry
    const secondEntry = bot.safeEnterPosition("long", 50000, 49000);
    assert.strictEqual(secondEntry, false);

    // Exit
    bot.exitPosition(51000);
    assert.strictEqual(bot.canEnter(), true);
});
