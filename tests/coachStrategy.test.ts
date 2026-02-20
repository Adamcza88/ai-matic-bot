import test from "node:test";
import assert from "node:assert/strict";
import {
  detectCoachBreakout,
  detectSituationalEdges,
  type Candle,
  type DailyBar,
} from "../src/engine/coachStrategy.ts";

function utcTs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

function makeCandle(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100
): Candle {
  return { openTime, open, high, low, close, volume };
}

function buildBreakoutBuyCandles(volumeLast = 220): Candle[] {
  const candles: Candle[] = [];
  let time = utcTs(2025, 1, 1);
  for (let i = 0; i < 25; i += 1) {
    const base = 100 + i * 0.6;
    candles.push(makeCandle(time, base - 0.2, base + 0.7, base - 0.7, base, 100));
    time += 60_000;
  }
  const baseCloses = [114.6, 114.9, 114.7, 115.0, 114.8, 114.9, 115.1, 114.95, 115.05, 115.0];
  for (let i = 0; i < baseCloses.length; i += 1) {
    const close = baseCloses[i];
    candles.push(makeCandle(time, close - 0.1, close + 0.35, close - 0.45, close, 100));
    time += 60_000;
  }
  candles.push(makeCandle(time, 115.3, 116.4, 115.1, 116.05, volumeLast));
  return candles;
}

function buildBreakoutSellCandles(volumeLast = 220): Candle[] {
  const candles: Candle[] = [];
  let time = utcTs(2025, 1, 10);
  for (let i = 0; i < 25; i += 1) {
    const base = 130 - i * 0.6;
    candles.push(makeCandle(time, base + 0.2, base + 0.7, base - 0.7, base, 100));
    time += 60_000;
  }
  const baseCloses = [115.2, 114.9, 115.1, 114.8, 115.0, 114.7, 114.9, 114.8, 114.7, 114.8];
  for (let i = 0; i < baseCloses.length; i += 1) {
    const close = baseCloses[i];
    candles.push(makeCandle(time, close + 0.1, close + 0.45, close - 0.35, close, 100));
    time += 60_000;
  }
  candles.push(makeCandle(time, 114.5, 114.6, 113.3, 113.6, volumeLast));
  return candles;
}

test("Coach breakout returns null when candles are insufficient", () => {
  const candles = buildBreakoutBuyCandles().slice(0, 20);
  const signal = detectCoachBreakout(candles);
  assert.equal(signal, null);
});

test("Coach breakout generates BUY signal with defaults", () => {
  const candles = buildBreakoutBuyCandles();
  const signal = detectCoachBreakout(candles);
  assert.ok(signal);
  assert.equal(signal.side, "BUY");
  assert.equal(signal.message, "Breakout above base high + EMA alignment + volume confirmation");
  assert.ok(signal.sl < signal.entry);
  assert.ok(signal.tp > signal.entry);
});

test("Coach breakout generates SELL signal with defaults", () => {
  const candles = buildBreakoutSellCandles();
  const signal = detectCoachBreakout(candles);
  assert.ok(signal);
  assert.equal(signal.side, "SELL");
  assert.equal(signal.message, "Breakdown below base low + EMA alignment + volume confirmation");
  assert.ok(signal.sl > signal.entry);
  assert.ok(signal.tp < signal.entry);
});

test("Coach breakout returns null on weak volume confirmation", () => {
  const candles = buildBreakoutBuyCandles(120);
  const signal = detectCoachBreakout(candles);
  assert.equal(signal, null);
});

test("Coach breakout returns null on degenerate risk from custom buffer", () => {
  const candles = buildBreakoutSellCandles(220);
  const signal = detectCoachBreakout(candles, { breakoutBufferPct: -0.5 });
  assert.equal(signal, null);
});

test("Coach breakout supports custom params compared to defaults", () => {
  const candles = buildBreakoutBuyCandles(130);
  const byDefault = detectCoachBreakout(candles);
  const byCustom = detectCoachBreakout(candles, { volumeMultiplier: 1.2 });
  assert.equal(byDefault, null);
  assert.ok(byCustom);
  assert.equal(byCustom.side, "BUY");
});

test("Situational edge returns SELL for Thursday/Friday pattern", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 3, 5), high: 106, low: 96 }, // Wed
    { openTime: utcTs(2025, 3, 6), high: 110, low: 94 }, // Thu
    { openTime: utcTs(2025, 3, 7), high: 108, low: 93 }, // Fri
  ];
  const signal = detectSituationalEdges(daily, 103);
  assert.ok(signal);
  assert.equal(signal.side, "SELL");
  assert.equal(signal.tp, 93);
  assert.equal(signal.sl, 110);
  assert.equal(signal.message, "Friday High < Thursday High -> target Friday Low on Monday");
});

test("Situational edge returns BUY for Thursday/Friday pattern", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 4, 16), high: 106, low: 96 }, // Wed
    { openTime: utcTs(2025, 4, 17), high: 108, low: 95 }, // Thu
    { openTime: utcTs(2025, 4, 18), high: 109, low: 97 }, // Fri
  ];
  const signal = detectSituationalEdges(daily, 104);
  assert.ok(signal);
  assert.equal(signal.side, "BUY");
  assert.equal(signal.tp, 109);
  assert.equal(signal.sl, 95);
  assert.equal(signal.message, "Friday Low > Thursday Low -> target Friday High on Monday");
});

test("Situational edge returns SELL for Monday/Wednesday pattern", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 5, 12), high: 112, low: 97 }, // Mon
    { openTime: utcTs(2025, 5, 13), high: 110, low: 98 }, // Tue
    { openTime: utcTs(2025, 5, 14), high: 108, low: 95 }, // Wed
  ];
  const signal = detectSituationalEdges(daily, 104);
  assert.ok(signal);
  assert.equal(signal.side, "SELL");
  assert.equal(signal.tp, 95);
  assert.equal(signal.sl, 112);
  assert.equal(signal.message, "Wednesday High < Monday High -> target Wednesday Low on Thursday");
});

test("Situational edge returns BUY for Monday/Wednesday pattern", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 5, 19), high: 104, low: 94 }, // Mon
    { openTime: utcTs(2025, 5, 20), high: 106, low: 95 }, // Tue
    { openTime: utcTs(2025, 5, 21), high: 105, low: 96 }, // Wed
  ];
  const signal = detectSituationalEdges(daily, 101);
  assert.ok(signal);
  assert.equal(signal.side, "BUY");
  assert.equal(signal.tp, 105);
  assert.equal(signal.sl, 94);
  assert.equal(signal.message, "Wednesday Low > Monday Low -> target Wednesday High on Thursday");
});

test("Situational edge returns null when weekday pairs are missing", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 6, 10), high: 104, low: 94 }, // Tue
    { openTime: utcTs(2025, 6, 11), high: 103, low: 95 }, // Wed
    { openTime: utcTs(2025, 6, 12), high: 102, low: 96 }, // Thu
  ];
  const signal = detectSituationalEdges(daily, 100);
  assert.equal(signal, null);
});

test("Situational edge returns null on unsorted or invalid daily data", () => {
  const unsorted: DailyBar[] = [
    { openTime: utcTs(2025, 7, 11), high: 109, low: 98 }, // Fri
    { openTime: utcTs(2025, 7, 10), high: 110, low: 95 }, // Thu
  ];
  const invalid: DailyBar[] = [
    { openTime: utcTs(2025, 7, 10), high: 100, low: 105 },
    { openTime: utcTs(2025, 7, 11), high: 102, low: 101 },
  ];
  assert.equal(detectSituationalEdges(unsorted, 100), null);
  assert.equal(detectSituationalEdges(invalid, 100), null);
});

test("Situational edge returns null when Thu/Fri and Mon/Wed conflict on side", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 8, 4), high: 120, low: 90 }, // Mon
    { openTime: utcTs(2025, 8, 5), high: 116, low: 93 }, // Tue
    { openTime: utcTs(2025, 8, 6), high: 110, low: 100 }, // Wed => SELL vs Mon
    { openTime: utcTs(2025, 8, 7), high: 115, low: 95 }, // Thu
    { openTime: utcTs(2025, 8, 8), high: 118, low: 96 }, // Fri => BUY vs Thu
  ];
  const signal = detectSituationalEdges(daily, 105);
  assert.equal(signal, null);
});

test("Situational edge prioritizes higher-R candidate when both sets align", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 9, 1), high: 104, low: 95 }, // Mon
    { openTime: utcTs(2025, 9, 2), high: 103, low: 96 }, // Tue
    { openTime: utcTs(2025, 9, 3), high: 120, low: 99 }, // Wed => BUY with higher R
    { openTime: utcTs(2025, 9, 4), high: 115, low: 90 }, // Thu
    { openTime: utcTs(2025, 9, 5), high: 116, low: 92 }, // Fri => BUY with lower R
  ];
  const signal = detectSituationalEdges(daily, 100);
  assert.ok(signal);
  assert.equal(signal.side, "BUY");
  assert.equal(signal.message, "Wednesday Low > Monday Low -> target Wednesday High on Thursday");
});

test("Situational edge uses newer anchor time tie-breaker on near-equal R", () => {
  const daily: DailyBar[] = [
    { openTime: utcTs(2025, 10, 6), high: 104, low: 95 }, // Mon
    { openTime: utcTs(2025, 10, 7), high: 103, low: 96 }, // Tue
    { openTime: utcTs(2025, 10, 8), high: 105, low: 97 }, // Wed => BUY (R=1)
    { openTime: utcTs(2025, 10, 9), high: 109, low: 90 }, // Thu
    { openTime: utcTs(2025, 10, 10), high: 110, low: 92 }, // Fri => BUY (R=1), newer
  ];
  const signal = detectSituationalEdges(daily, 100);
  assert.ok(signal);
  assert.equal(signal.side, "BUY");
  assert.equal(signal.message, "Friday Low > Thursday Low -> target Friday High on Monday");
});

test("Situational edge keeps strict currentPrice boundary checks", () => {
  const sellDaily: DailyBar[] = [
    { openTime: utcTs(2025, 11, 12), high: 107, low: 96 }, // Wed
    { openTime: utcTs(2025, 11, 13), high: 109, low: 95 }, // Thu
    { openTime: utcTs(2025, 11, 14), high: 108, low: 95 }, // Fri
  ];
  const buyDaily: DailyBar[] = [
    { openTime: utcTs(2025, 11, 19), high: 107, low: 96 }, // Wed
    { openTime: utcTs(2025, 11, 20), high: 108, low: 95 }, // Thu
    { openTime: utcTs(2025, 11, 21), high: 109, low: 97 }, // Fri
  ];
  assert.equal(detectSituationalEdges(sellDaily, 95), null); // SELL needs > friday.low
  assert.equal(detectSituationalEdges(buyDaily, 109), null); // BUY needs < friday.high
});
