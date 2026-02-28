import { describe, it } from "node:test";
import assert from "node:assert";
import { __aiMaticOliKellaTest } from "../src/engine/aiMaticOliKellaStrategy";
import type { Candle } from "../src/engine/botEngine";

const { detectEmaCrossback } = __aiMaticOliKellaTest;

describe("AiMaticOliKellaStrategy - EMA Crossback (Loose Tolerance)", () => {
  it("should detect pullback that narrowly misses the strict EMA band (0.5% gap)", () => {
    // SETUP
    const count = 20;
    // EMA10 at 100, EMA20 at 99.
    // Strict Zone High (max * 1.003) = 100 * 1.003 = 100.3
    // Relaxed Zone High (max * 1.006) = 100 * 1.006 = 100.6
    
    const ema10 = new Array(count).fill(100);
    const ema20 = new Array(count).fill(99);
    
    const bars: Candle[] = [];
    for (let i = 0; i < count; i++) {
      // Default bar well above EMA
      let open = 102;
      let close = 103;
      let high = 104;
      let low = 102;

      // Lookback period is last-8 to last (indices 11 to 18 for count=20, last=19)
      // We need at least 2 touches.
      if (i === 15 || i === 16) {
        // Pullback bars
        // Low = 100.5. 
        // 100.5 > 100.3 (Strict fail - missed by 0.2)
        // 100.5 <= 100.6 (Relaxed pass - caught by 0.1 margin)
        low = 100.5; 
        high = 102;
        open = 102;
        close = 101;
      }
      
      // Signal bar (last one)
      if (i === count - 1) {
        // Rejection: Close > Open && Close > EMA10
        open = 101;
        close = 103; 
        high = 104;
        low = 101;
      }

      bars.push({
        openTime: i * 60000,
        open, high, low, close, volume: 1000
      } as Candle);
    }

    const result = detectEmaCrossback({ bars, ema10, ema20, side: "buy" });

    assert.ok(result, "Crossback should be detected with relaxed tolerance (0.6%)");
    assert.strictEqual(result?.pattern, "EMA_CROSSBACK");
  });
});