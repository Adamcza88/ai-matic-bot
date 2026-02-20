import test from "node:test";
import assert from "node:assert/strict";
import { computeEma } from "../src/engine/ta.js";
import { __aiMaticOliKellaTest } from "../src/engine/aiMaticOliKellaStrategy.js";

const {
  detectBaseNBreak,
  detectWedgePop,
  detectEmaCrossback,
  detectExhaustion,
  detectWedgeDrop,
} = __aiMaticOliKellaTest;

function candle(open, high, low, close, volume = 100, openTime = Date.now()) {
  return { open, high, low, close, volume, openTime };
}

function buildVolumeSma(values, period = 20) {
  return values.map((_, index) => {
    const start = Math.max(0, index - period + 1);
    const slice = values.slice(start, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

test("OLIkella Base 'n Break detector works long + short", () => {
  const longBars = [];
  for (let i = 0; i < 18; i++) {
    const base = 100 + i * 0.25;
    longBars.push(candle(base - 0.3, base + 0.5, base - 0.5, base + 0.1, 100, i));
  }
  longBars.push(candle(104.4, 104.8, 104.0, 104.5, 100, 19));
  longBars.push(candle(104.5, 104.9, 104.1, 104.6, 100, 20));
  longBars.push(candle(104.6, 105.0, 104.2, 104.7, 100, 21));
  longBars.push(candle(104.7, 105.1, 104.3, 104.8, 100, 22));
  longBars.push(candle(104.8, 105.2, 104.4, 104.9, 100, 23));
  longBars.push(candle(104.9, 105.3, 104.5, 105.0, 100, 24));
  longBars.push(candle(105.2, 106.4, 105.0, 106.1, 180, 25));

  const longCloses = longBars.map((bar) => bar.close);
  const longEma10 = computeEma(longCloses, 10);
  const longEma20 = computeEma(longCloses, 20);
  const longVolSma20 = buildVolumeSma(longBars.map((bar) => bar.volume));

  const longHit = detectBaseNBreak({
    bars: longBars,
    ema10: longEma10,
    ema20: longEma20,
    volumeSma20: longVolSma20,
    side: "buy",
  });
  assert.equal(Boolean(longHit?.ok), true);

  const shortBars = [];
  for (let i = 0; i < 18; i++) {
    const base = 120 - i * 0.25;
    shortBars.push(candle(base + 0.3, base + 0.5, base - 0.5, base - 0.1, 100, i));
  }
  shortBars.push(candle(115.6, 116.0, 115.2, 115.5, 100, 19));
  shortBars.push(candle(115.5, 115.9, 115.1, 115.4, 100, 20));
  shortBars.push(candle(115.4, 115.8, 115.0, 115.3, 100, 21));
  shortBars.push(candle(115.3, 115.7, 114.9, 115.2, 100, 22));
  shortBars.push(candle(115.2, 115.6, 114.8, 115.1, 100, 23));
  shortBars.push(candle(115.1, 115.5, 114.7, 115.0, 100, 24));
  shortBars.push(candle(114.9, 115.0, 113.6, 113.8, 180, 25));

  const shortCloses = shortBars.map((bar) => bar.close);
  const shortEma10 = computeEma(shortCloses, 10);
  const shortEma20 = computeEma(shortCloses, 20);
  const shortVolSma20 = buildVolumeSma(shortBars.map((bar) => bar.volume));

  const shortHit = detectBaseNBreak({
    bars: shortBars,
    ema10: shortEma10,
    ema20: shortEma20,
    volumeSma20: shortVolSma20,
    side: "sell",
  });
  assert.equal(Boolean(shortHit?.ok), true);
});

test("OLIkella Wedge Pop + EMA Crossback detectors support long + short", () => {
  const wedgeLong = [
    candle(99.6, 101.4, 98.9, 100.9, 100, -1),
    candle(100.9, 101.3, 99.4, 100.7, 100, 0),
    candle(100.0, 101.2, 99.2, 100.6, 100, 1),
    candle(100.6, 101.1, 99.5, 100.5, 100, 2),
    candle(100.5, 100.9, 99.7, 100.4, 100, 3),
    candle(100.4, 100.8, 99.9, 100.3, 100, 4),
    candle(100.3, 100.7, 100.0, 100.2, 100, 5),
    candle(100.2, 100.6, 100.1, 100.2, 100, 6),
    candle(100.6, 102.3, 100.5, 101.9, 180, 7),
  ];
  const wedgeLongCloses = wedgeLong.map((bar) => bar.close);
  const wedgeLongEma10 = computeEma(wedgeLongCloses, 10);
  const wedgeLongEma20 = computeEma(wedgeLongCloses, 20);
  const wedgeLongVolSma = buildVolumeSma(wedgeLong.map((bar) => bar.volume));
  const wedgeLongHit = detectWedgePop({
    bars: wedgeLong,
    ema10: wedgeLongEma10,
    ema20: wedgeLongEma20,
    volumeSma20: wedgeLongVolSma,
    side: "buy",
  });
  assert.equal(Boolean(wedgeLongHit?.ok), true);

  const wedgeShort = [
    candle(110.8, 111.4, 109.0, 109.6, 100, -1),
    candle(109.6, 111.2, 109.1, 109.5, 100, 0),
    candle(110.0, 111.0, 108.8, 109.4, 100, 1),
    candle(109.4, 110.8, 109.0, 109.3, 100, 2),
    candle(109.3, 110.6, 109.1, 109.2, 100, 3),
    candle(109.2, 110.4, 109.2, 109.1, 100, 4),
    candle(109.1, 110.2, 109.2, 109.0, 100, 5),
    candle(109.0, 110.0, 109.3, 108.9, 100, 6),
    candle(108.8, 108.9, 107.3, 107.9, 180, 7),
  ];
  const wedgeShortCloses = wedgeShort.map((bar) => bar.close);
  const wedgeShortEma10 = computeEma(wedgeShortCloses, 10);
  const wedgeShortEma20 = computeEma(wedgeShortCloses, 20);
  const wedgeShortVolSma = buildVolumeSma(wedgeShort.map((bar) => bar.volume));
  const wedgeShortHit = detectWedgePop({
    bars: wedgeShort,
    ema10: wedgeShortEma10,
    ema20: wedgeShortEma20,
    volumeSma20: wedgeShortVolSma,
    side: "sell",
  });
  assert.equal(Boolean(wedgeShortHit?.ok), true);

  const crossLong = [];
  for (let i = 0; i < 16; i++) {
    const base = 100 + i * 0.25;
    crossLong.push(candle(base - 0.2, base + 0.4, base - 0.5, base + 0.1, 100, i));
  }
  crossLong.push(candle(103.8, 104.0, 103.1, 103.2, 90, 16));
  crossLong.push(candle(103.2, 103.5, 102.8, 103.0, 90, 17));
  crossLong.push(candle(103.0, 103.2, 102.7, 102.9, 90, 18));
  crossLong.push(candle(102.9, 104.1, 102.8, 103.9, 120, 19));
  const crossLongEma10 = computeEma(crossLong.map((bar) => bar.close), 10);
  const crossLongEma20 = computeEma(crossLong.map((bar) => bar.close), 20);
  const crossLongHit = detectEmaCrossback({
    bars: crossLong,
    ema10: crossLongEma10,
    ema20: crossLongEma20,
    side: "buy",
  });
  assert.equal(Boolean(crossLongHit?.ok), true);

  const crossShort = [];
  for (let i = 0; i < 16; i++) {
    const base = 130 - i * 0.25;
    crossShort.push(candle(base + 0.2, base + 0.5, base - 0.4, base - 0.1, 100, i));
  }
  crossShort.push(candle(126.2, 126.6, 125.9, 126.4, 90, 16));
  crossShort.push(candle(126.4, 126.7, 126.0, 126.5, 90, 17));
  crossShort.push(candle(126.5, 126.8, 126.1, 126.6, 90, 18));
  crossShort.push(candle(126.6, 126.7, 125.2, 125.4, 120, 19));
  const crossShortEma10 = computeEma(crossShort.map((bar) => bar.close), 10);
  const crossShortEma20 = computeEma(crossShort.map((bar) => bar.close), 20);
  const crossShortHit = detectEmaCrossback({
    bars: crossShort,
    ema10: crossShortEma10,
    ema20: crossShortEma20,
    side: "sell",
  });
  assert.equal(Boolean(crossShortHit?.ok), true);
});

test("OLIkella Exhaustion Extension + Wedge Drop detectors support both directions", () => {
  const exhaustionLong = detectExhaustion({
    close: 112,
    ema10: 100,
    volume: 190,
    volumeSma20: 100,
  });
  assert.equal(exhaustionLong.active, true);
  assert.equal(exhaustionLong.direction, "BUY");

  const exhaustionShort = detectExhaustion({
    close: 88,
    ema10: 100,
    volume: 190,
    volumeSma20: 100,
  });
  assert.equal(exhaustionShort.active, true);
  assert.equal(exhaustionShort.direction, "SELL");

  const wedgeDropLongBars = [
    candle(111.0, 112.0, 109.6, 111.0, 100, -1),
    candle(111.0, 111.8, 109.4, 110.9, 100, 0),
    candle(110, 111.5, 109.0, 110.8, 100, 1),
    candle(110.8, 111.3, 109.4, 110.7, 100, 2),
    candle(110.7, 111.1, 109.8, 110.6, 100, 3),
    candle(110.6, 110.9, 110.0, 110.5, 100, 4),
    candle(110.5, 110.8, 110.1, 110.4, 100, 5),
    candle(110.4, 110.7, 110.2, 110.3, 100, 6),
    candle(109.8, 110.0, 108.4, 108.6, 180, 7),
  ];
  const wedgeDropLong = detectWedgeDrop({
    bars: wedgeDropLongBars,
    ema20: computeEma(wedgeDropLongBars.map((bar) => bar.close), 20),
    volumeSma20: buildVolumeSma(wedgeDropLongBars.map((bar) => bar.volume)),
  });
  assert.equal(wedgeDropLong.againstLong, true);

  const wedgeDropShortBars = [
    candle(89.0, 90.6, 88.0, 89.2, 100, -1),
    candle(89.2, 90.5, 88.2, 89.3, 100, 0),
    candle(90, 91.0, 88.8, 89.3, 100, 1),
    candle(89.3, 90.7, 89.0, 89.4, 100, 2),
    candle(89.4, 90.5, 89.1, 89.5, 100, 3),
    candle(89.5, 90.3, 89.2, 89.6, 100, 4),
    candle(89.6, 90.1, 89.3, 89.7, 100, 5),
    candle(89.7, 89.9, 89.4, 89.8, 100, 6),
    candle(90.1, 91.7, 90.0, 91.4, 180, 7),
  ];
  const wedgeDropShort = detectWedgeDrop({
    bars: wedgeDropShortBars,
    ema20: computeEma(wedgeDropShortBars.map((bar) => bar.close), 20),
    volumeSma20: buildVolumeSma(wedgeDropShortBars.map((bar) => bar.volume)),
  });
  assert.equal(wedgeDropShort.againstShort, true);
});
