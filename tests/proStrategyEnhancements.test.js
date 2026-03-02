import test from "node:test";
import assert from "node:assert/strict";
import { resampleCandles } from "../src/engine/botEngine.js";
import { findPivotsHigh, findPivotsLow } from "../src/engine/ta.js";
import {
  evaluateAiMaticProStrategyForSymbol,
  __aiMaticProTest,
} from "../src/engine/aiMaticProStrategy.js";

const {
  resolveTrendState,
  findLatestImpulse,
  computeFibLevels,
  evaluateLtfTriggers,
  nearestKeyFibDistance,
} = __aiMaticProTest;

const TF_15M = 15 * 60_000;

function candle(open, high, low, close, idx, volume = 120) {
  return {
    openTime: idx * TF_15M,
    open,
    high,
    low,
    close,
    volume,
  };
}

function buildBaseSeries(count = 2080) {
  return Array.from({ length: count }, (_, i) => {
    const trend = 100 + i * 0.03;
    const wave = Math.sin(i / 16) * 1.8;
    const mid = trend + wave;
    const open = mid - 0.2;
    const close = mid + 0.2;
    const high = close + 0.35;
    const low = open - 0.35;
    return candle(open, high, low, close, i, 140 + (i % 11) * 3);
  });
}

function tuneForLongSignal(series) {
  const candles = series.map((c) => ({ ...c }));
  const h4 = resampleCandles(candles, 240);
  const trend = resolveTrendState({
    h4,
    swingHighs: findPivotsHigh(h4, 2, 2),
    swingLows: findPivotsLow(h4, 2, 2),
  });
  const impulse = findLatestImpulse(
    trend,
    findPivotsHigh(h4, 2, 2),
    findPivotsLow(h4, 2, 2)
  );
  assert.ok(impulse, "missing impulse in synthetic data");
  const fib = computeFibLevels({
    trend,
    low: impulse.low.price,
    high: impulse.high.price,
  });
  assert.ok(fib, "missing fib in synthetic data");
  const level = fib.retracement.r618;
  const n = candles.length;

  candles[n - 5] = candle(level + 0.62, level + 0.9, level + 0.48, level + 0.7, n - 5, 160);
  candles[n - 4] = candle(level + 0.58, level + 0.82, level + 0.42, level + 0.56, n - 4, 155);
  candles[n - 3] = candle(level + 0.52, level + 0.66, level + 0.02, level + 0.44, n - 3, 170);
  candles[n - 2] = candle(level + 0.46, level + 0.52, level + 0.14, level + 0.2, n - 2, 180);
  candles[n - 1] = candle(level + 0.16, level + 0.78, level + 0.15, level + 0.66, n - 1, 280);

  return candles;
}

function gateByName(decision, name) {
  const gates = decision?.proMtfFibo?.gates ?? [];
  return gates.find((g) => g.name === name);
}

test("Trend classifier resolves UP/DOWN/CONSOLIDATION", () => {
  const up = resolveTrendState({
    h4: [
      candle(100, 102, 99, 101, 0),
      candle(101, 103, 100, 102, 1),
      candle(102, 104, 101, 103, 2),
      candle(103, 105, 102, 104, 3),
      candle(104, 106, 103, 105, 4),
      candle(105, 107, 104, 106, 5),
      candle(106, 108, 105, 107, 6),
      candle(107, 109, 106, 108, 7),
      candle(108, 110, 107, 109, 8),
      candle(109, 111, 108, 110, 9),
      candle(110, 112, 109, 111, 10),
      candle(111, 113, 110, 112, 11),
      candle(112, 114, 111, 113, 12),
      candle(113, 115, 112, 114, 13),
      candle(114, 116, 113, 115, 14),
      candle(115, 117, 114, 116, 15),
      candle(116, 118, 115, 117, 16),
      candle(117, 119, 116, 118, 17),
      candle(118, 120, 117, 119, 18),
      candle(119, 121, 118, 120, 19),
      candle(120, 122, 119, 121, 20),
      candle(121, 123, 120, 122, 21),
      candle(122, 124, 121, 123, 22),
      candle(123, 125, 122, 124, 23),
      candle(124, 126, 123, 125, 24),
      candle(125, 127, 124, 126, 25),
      candle(126, 128, 125, 127, 26),
      candle(127, 129, 126, 128, 27),
      candle(128, 130, 127, 129, 28),
      candle(129, 131, 128, 130, 29),
      candle(130, 132, 129, 131, 30),
      candle(131, 133, 130, 132, 31),
      candle(132, 134, 131, 133, 32),
      candle(133, 135, 132, 134, 33),
      candle(134, 136, 133, 135, 34),
      candle(135, 137, 134, 136, 35),
      candle(136, 138, 135, 137, 36),
      candle(137, 139, 136, 138, 37),
      candle(138, 140, 137, 139, 38),
      candle(139, 141, 138, 140, 39),
      candle(140, 142, 139, 141, 40),
      candle(141, 143, 140, 142, 41),
      candle(142, 144, 141, 143, 42),
      candle(143, 145, 142, 144, 43),
      candle(144, 146, 143, 145, 44),
      candle(145, 147, 144, 146, 45),
      candle(146, 148, 145, 147, 46),
      candle(147, 149, 146, 148, 47),
      candle(148, 150, 147, 149, 48),
      candle(149, 151, 148, 150, 49),
      candle(150, 152, 149, 151, 50),
    ],
    swingHighs: [
      { idx: 8, price: 120 },
      { idx: 16, price: 128 },
    ],
    swingLows: [
      { idx: 10, price: 112 },
      { idx: 18, price: 118 },
    ],
  });
  assert.equal(up, "UP");

  const down = resolveTrendState({
    h4: Array.from({ length: 60 }, (_, i) =>
      candle(200 - i, 202 - i, 198 - i, 199 - i, i)
    ),
    swingHighs: [
      { idx: 10, price: 210 },
      { idx: 20, price: 204 },
    ],
    swingLows: [
      { idx: 12, price: 196 },
      { idx: 22, price: 190 },
    ],
  });
  assert.equal(down, "DOWN");

  const range = resolveTrendState({
    h4: Array.from({ length: 60 }, (_, i) => candle(100, 101, 99, 100, i)),
    swingHighs: [{ idx: 20, price: 101 }],
    swingLows: [{ idx: 20, price: 99 }],
  });
  assert.equal(range, "CONSOLIDATION");
});

test("Fib retracement and extension values are computed correctly", () => {
  const fib = computeFibLevels({ trend: "UP", low: 100, high: 120 });
  assert.ok(fib);
  assert.equal(fib.retracement.r382, 112.36);
  assert.equal(fib.retracement.r618, 107.64);
  assert.equal(fib.extension.t1, 125.44);
  assert.equal(fib.extension.t2, 132.36);
});

test("15m triggers detect bullish and bearish patterns", () => {
  const longSeries = [
    candle(100, 100.4, 99.8, 100.1, 0, 100),
    candle(100.2, 100.3, 99.7, 99.8, 1, 110),
    candle(99.75, 100.7, 99.72, 100.6, 2, 220),
  ];
  const longTriggers = evaluateLtfTriggers(longSeries);
  assert.equal(longTriggers.longTrigger, true);
  assert.equal(longTriggers.bullishEngulfing, true);

  const shortSeries = [
    candle(100, 100.4, 99.8, 100.2, 0, 100),
    candle(100.1, 100.8, 100.0, 100.7, 1, 110),
    candle(100.75, 100.76, 99.7, 99.8, 2, 230),
  ];
  const shortTriggers = evaluateLtfTriggers(shortSeries);
  assert.equal(shortTriggers.shortTrigger, true);
  assert.equal(shortTriggers.bearishEngulfing, true);
});

test("Fib proximity helper detects >1% distance", () => {
  const fib = computeFibLevels({ trend: "UP", low: 100, high: 120 });
  assert.ok(fib);
  const near = nearestKeyFibDistance(108.0, fib);
  const far = nearestKeyFibDistance(130.0, fib);
  assert.ok(near.distance <= 0.01);
  assert.ok(far.distance > 0.01);
});

test("Strategy exposes volatility gate failure", () => {
  const series = buildBaseSeries();
  const n = series.length;
  for (let i = n - 80; i < n; i++) {
    const c = series[i];
    const mid = c.close;
    series[i] = candle(mid, mid + 0.02, mid - 0.02, mid + 0.005, i, c.volume);
  }
  const decision = evaluateAiMaticProStrategyForSymbol("BTCUSDT", series);
  const gate = gateByName(decision, "Volatility gate ATR >= 0.8x 20d avg");
  assert.ok(gate);
  assert.equal(gate.ok, false);
});

test("Strategy exposes RR gate failure on high ATR risk", () => {
  const series = tuneForLongSignal(buildBaseSeries());
  const n = series.length;
  for (let i = n - 30; i < n - 5; i++) {
    const c = series[i];
    series[i] = candle(c.open, c.close + 8, c.close - 8, c.close, i, c.volume);
  }
  const decision = evaluateAiMaticProStrategyForSymbol("BTCUSDT", series);
  const gate = gateByName(decision, "RR gate >= 1.5");
  assert.ok(gate);
  assert.equal(gate.ok, false);
});

test("Strategy emits proTargets t1/t2 on valid long setup", () => {
  const series = tuneForLongSignal(buildBaseSeries());
  const decision = evaluateAiMaticProStrategyForSymbol("BTCUSDT", series);
  assert.ok(decision.signal, "expected signal for tuned long setup");
  const proTargets = decision.signal?.proTargets;
  assert.ok(proTargets);
  assert.ok(Number.isFinite(proTargets.t1));
  assert.ok(Number.isFinite(proTargets.t2));
  assert.ok(proTargets.t2 > proTargets.t1);
  assert.equal(decision.signal.intent.tp, proTargets.t2);
});
