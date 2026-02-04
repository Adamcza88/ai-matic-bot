import test from "node:test";
import assert from "node:assert/strict";
import { __aiMaticTest } from "../src/hooks/useTradingBot.js";

const {
  resolveAiMaticPatterns,
  resolveAiMaticEmaFlags,
  resolveAiMaticBreakRetest,
  resolveStructureState,
  resolveAiMaticStopLoss,
  resolveAiMaticTargets,
  evaluateAiMaticGatesCore,
} = __aiMaticTest;

const candle = (open, high, low, close) => ({ open, high, low, close, volume: 100, openTime: Date.now() });

test("AI-MATIC patterns: pinbar/engulf/inside/trap", () => {
  const prev = candle(10, 11, 9.5, 9.6);
  const pinbar = candle(10.2, 10.4, 9.0, 10.1); // bull pinbar
  let patterns = resolveAiMaticPatterns([prev, pinbar]);
  assert.equal(patterns.pinbarBull, true);

  const prevRed = candle(10, 10.2, 9.6, 9.7);
  const engulfBull = candle(9.6, 10.6, 9.4, 10.4);
  patterns = resolveAiMaticPatterns([prevRed, engulfBull]);
  assert.equal(patterns.engulfBull, true);

  const prevWide = candle(10, 11.5, 9.0, 10.2);
  const inside = candle(10.4, 11.0, 9.4, 10.6);
  patterns = resolveAiMaticPatterns([prevWide, inside]);
  assert.equal(patterns.insideBar, true);

  const trapPrev = candle(10, 10.5, 9.8, 10.1);
  const trap = candle(10.0, 10.3, 9.5, 9.9);
  patterns = resolveAiMaticPatterns([trapPrev, trap]);
  assert.equal(patterns.trapBull, true);
});

test("AI-MATIC EMA flags: stack + cross recent", () => {
  const uptrend = Array.from({ length: 60 }, (_, i) => candle(100 + i * 0.1, 100 + i * 0.2, 100 + i * 0.05, 100 + i * 0.15));
  const flagsUp = resolveAiMaticEmaFlags(uptrend);
  assert.equal(flagsUp.bullOk, true);

  const series = [];
  for (let i = 0; i < 30; i++) series.push(candle(100 + i * 0.5, 100 + i * 0.6, 100 + i * 0.4, 100 + i * 0.5));
  for (let i = 0; i < 6; i++) series.push(candle(115 - i * 5, 115 - i * 4, 115 - i * 6, 115 - i * 5));
  const flagsFlip = resolveAiMaticEmaFlags(series);
  assert.equal(flagsFlip.crossRecent, true);
});

test("AI-MATIC gate eval: pass + fail on EMA cross", () => {
  const decision = {
    aiMatic: {
      htf: { direction: "bull", structureTrend: "BULL", chochDown: false, chochUp: false, sweepLow: true, sweepHigh: false, poiReactionBull: true, poiReactionBear: false },
      mtf: { sweepLow: true, sweepHigh: false, pocNear: true, lvnRejectionBull: true, lvnRejectionBear: false, poiReactionBull: true, poiReactionBear: false },
      ltf: {
        patterns: { pinbarBull: true, pinbarBear: false, engulfBull: false, engulfBear: false, insideBar: false, trapBull: false, trapBear: false },
        bosUp: true,
        bosDown: false,
        breakRetestUp: false,
        breakRetestDown: false,
        fakeoutLow: false,
        fakeoutHigh: false,
        ema: { bullOk: true, bearOk: false, crossRecent: false },
        volumeReaction: true,
        chochDown: false,
        chochUp: false,
      },
    },
    emaTrend: { consensus: "bull" },
  };
  const signal = { intent: { side: "buy" } };
  const ok = evaluateAiMaticGatesCore({ decision, signal, correlationOk: true, dominanceOk: true });
  assert.equal(ok.pass, true);

  const badDecision = JSON.parse(JSON.stringify(decision));
  badDecision.aiMatic.ltf.ema.crossRecent = true;
  const bad = evaluateAiMaticGatesCore({ decision: badDecision, signal, correlationOk: true, dominanceOk: true });
  assert.equal(bad.pass, false);
});

test("AI-MATIC SL/TP selection", () => {
  const aiMatic = {
    htf: { pivotLow: 95, pivotHigh: 112, pois: [], structureTrend: "BULL" },
    mtf: {
      pivotLow: 96,
      pivotHigh: 110,
      profile: { poc: 105, vah: 110, val: 98, hvn: [110], lvn: [103] },
      pois: [],
    },
  };
  const sl = resolveAiMaticStopLoss({
    side: "Buy",
    entry: 100,
    currentSl: 98,
    atr: 1,
    aiMatic,
    core: {},
  });
  assert.ok(sl < 98);

  const tp = resolveAiMaticTargets({
    side: "Buy",
    entry: 100,
    sl: 95,
    aiMatic,
  });
  assert.equal(tp, 110);
});

test("AI-MATIC structure: HH/HL -> BOS/CHOCH", () => {
  const candles = [
    candle(100, 100, 95, 98),
    candle(98, 110, 97, 109),
    candle(109, 103, 92, 95),
    candle(95, 115, 99, 112),
    candle(112, 104, 94, 96),
    candle(96, 120, 101, 118),
    candle(118, 110, 96, 100),
    candle(100, 125, 105, 123),
  ];
  const state = resolveStructureState(candles, 1);
  assert.equal(state.structureTrend, "BULL");
  assert.equal(state.bosUp, true);
  const reversal = [
    ...candles,
    candle(123, 110, 85, 90),
  ];
  const state2 = resolveStructureState(reversal, 1);
  assert.equal(state2.chochDown, true);
});
