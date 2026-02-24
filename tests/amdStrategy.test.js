import test from "node:test";
import assert from "node:assert/strict";
import {
  AMDPhase,
  __aiMaticAmdTest,
  evaluateAiMaticAmdStrategyForSymbol,
} from "../src/engine/aiMaticAmdStrategy.js";

const HOUR_MS = 60 * 60 * 1000;
const NY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

const toNum = (value) => Number.parseInt(value, 10);
const toDateKey = (year, month, day) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const nyParts = (ts) => {
  const parts = NY_FORMATTER.formatToParts(new Date(ts));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const year = toNum(map.get("year") ?? "0");
  const month = toNum(map.get("month") ?? "0");
  const day = toNum(map.get("day") ?? "0");
  const hour = toNum(map.get("hour") ?? "0");
  return { dateKey: toDateKey(year, month, day), hour };
};

const prevDateKey = (dateKey) => {
  const [yearRaw, monthRaw, dayRaw] = dateKey
    .split("-")
    .map((v) => Number.parseInt(v, 10));
  const utc = new Date(Date.UTC(yearRaw, monthRaw - 1, dayRaw));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return toDateKey(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
};

const makeBaseCandles = (endUtcTs, trend = "up") => {
  const start = endUtcTs - 219 * HOUR_MS;
  const candles = [];
  for (let i = 0; i < 220; i++) {
    const ts = start + i * HOUR_MS;
    const base = trend === "up" ? 80 + i * 0.35 : 260 - i * 0.35;
    const open = base - 0.1;
    const close = trend === "up" ? base + 0.1 : base - 0.1;
    candles.push({
      openTime: ts,
      open,
      high: base + 0.5,
      low: base - 0.5,
      close,
      volume: 1000,
    });
  }
  return candles;
};

const setSessionCandle = (candles, dateKey, hour, patch) => {
  const target = candles.find((c) => {
    const parts = nyParts(c.openTime);
    return parts.dateKey === dateKey && parts.hour === hour;
  });
  assert.ok(target, `Missing candle for ${dateKey} ${hour}:00 NY`);
  Object.assign(target, patch);
};

const buildBullishDataset = ({
  endUtcTs = Date.UTC(2026, 0, 15, 15, 0, 0), // 10:00 NY (EST)
  inversionConfirmed = true,
  withAsiaAndMidnight = true,
} = {}) => {
  const candles = makeBaseCandles(endUtcTs, "up");
  const sessionDate = nyParts(endUtcTs).dateKey;
  const asiaDate = prevDateKey(sessionDate);

  if (withAsiaAndMidnight) {
    setSessionCandle(candles, asiaDate, 20, { open: 141, high: 143, low: 140, close: 142 });
    setSessionCandle(candles, asiaDate, 21, { open: 142, high: 144, low: 141, close: 143 });
    setSessionCandle(candles, asiaDate, 22, { open: 143, high: 145, low: 142, close: 144 });
    setSessionCandle(candles, asiaDate, 23, { open: 144, high: 145, low: 142, close: 143 });
    setSessionCandle(candles, sessionDate, 0, { open: 143, high: 144, low: 142, close: 143 });
  } else {
    setSessionCandle(candles, asiaDate, 20, { open: 140, high: 140, low: 140, close: 140 });
    setSessionCandle(candles, asiaDate, 21, { open: 140, high: 140, low: 140, close: 140 });
    setSessionCandle(candles, asiaDate, 22, { open: 140, high: 140, low: 140, close: 140 });
    setSessionCandle(candles, asiaDate, 23, { open: 140, high: 140, low: 140, close: 140 });
    setSessionCandle(candles, sessionDate, 0, {
      open: Number.NaN,
      high: 144,
      low: 142,
      close: 143,
    });
  }

  // Manipulation (bullish): sweep below midnight open and below asia low.
  setSessionCandle(candles, sessionDate, 2, { open: 143, high: 146, low: 138, close: 144 });

  // Bearish FVG after manipulation: candle[3h].low > candle[5h].high -> bearish FVG [150..160].
  setSessionCandle(candles, sessionDate, 3, { open: 160, high: 162, low: 160, close: 161 });
  setSessionCandle(candles, sessionDate, 4, { open: 161, high: 162, low: 160.5, close: 161 });
  setSessionCandle(candles, sessionDate, 5, { open: 151, high: 150, low: 148, close: 149 });
  setSessionCandle(candles, sessionDate, 6, { open: 161, high: 163, low: 161, close: 162 });
  setSessionCandle(candles, sessionDate, 7, { open: 162, high: 164, low: 161.5, close: 163 });

  setSessionCandle(candles, sessionDate, 8, { open: 162, high: 165, low: 161, close: 164 });
  setSessionCandle(candles, sessionDate, 9, { open: 164, high: 166, low: 162, close: 165 });

  if (inversionConfirmed) {
    setSessionCandle(candles, sessionDate, 10, { open: 165, high: 167, low: 163, close: 166 });
  } else {
    // Keep latest bearish FVG unconfirmed: close below top.
    setSessionCandle(candles, sessionDate, 10, { open: 149, high: 149, low: 147, close: 148 });
  }

  return candles;
};

const buildBearishDataset = ({
  endUtcTs = Date.UTC(2026, 0, 15, 15, 0, 0), // 10:00 NY (EST)
} = {}) => {
  const candles = makeBaseCandles(endUtcTs, "down");
  const sessionDate = nyParts(endUtcTs).dateKey;
  const asiaDate = prevDateKey(sessionDate);

  setSessionCandle(candles, asiaDate, 20, { open: 204, high: 205, low: 200, close: 202 });
  setSessionCandle(candles, asiaDate, 21, { open: 203, high: 206, low: 201, close: 203 });
  setSessionCandle(candles, asiaDate, 22, { open: 202, high: 205, low: 200, close: 202 });
  setSessionCandle(candles, asiaDate, 23, { open: 202, high: 204, low: 201, close: 202 });
  setSessionCandle(candles, sessionDate, 0, { open: 202, high: 203, low: 201, close: 202 });

  // Manipulation (bearish): sweep above midnight open and above asia high.
  setSessionCandle(candles, sessionDate, 2, { open: 202, high: 208, low: 170, close: 198 });

  // Bullish FVG after manipulation: candle[3h].high < candle[5h].low -> bullish FVG [180..190].
  setSessionCandle(candles, sessionDate, 3, { open: 179, high: 180, low: 178, close: 179 });
  setSessionCandle(candles, sessionDate, 4, { open: 181, high: 182, low: 180, close: 181 });
  setSessionCandle(candles, sessionDate, 5, { open: 191, high: 192, low: 190, close: 191 });
  setSessionCandle(candles, sessionDate, 6, { open: 177, high: 178, low: 175, close: 176 });
  setSessionCandle(candles, sessionDate, 7, { open: 176, high: 177, low: 174, close: 175 });

  // Distribution continuation under bullish FVG bottom (inversion confirm for short).
  setSessionCandle(candles, sessionDate, 8, { open: 176, high: 178, low: 174, close: 175 });
  setSessionCandle(candles, sessionDate, 9, { open: 175, high: 177, low: 173, close: 174 });
  setSessionCandle(candles, sessionDate, 10, { open: 174, high: 176, low: 172, close: 174 });

  return candles;
};

test("AMD bullish PO3 complete -> buy signal", () => {
  const candles = buildBullishDataset();
  const decision = evaluateAiMaticAmdStrategyForSymbol("BTCUSDT", candles);
  assert.ok(decision.signal, "Expected AMD buy signal");
  assert.equal(decision.signal.intent.side, "buy");
  assert.equal(decision.amdContext.phase, AMDPhase.DISTRIBUTION);
  assert.equal(decision.amdContext.gates.phaseSequence, true);
  assert.equal(decision.amdContext.gates.inversionFvgConfirm, true);
  assert.ok(
    Number.isFinite(decision.amdContext.targets?.tp1),
    "Expected valid TP1"
  );
  assert.ok(
    Number.isFinite(decision.amdContext.targets?.tp2),
    "Expected valid TP2"
  );
});

test("AMD bearish PO3 complete -> sell signal", () => {
  const candles = buildBearishDataset();
  const decision = evaluateAiMaticAmdStrategyForSymbol("ETHUSDT", candles);
  assert.ok(decision.signal, "Expected AMD sell signal");
  assert.equal(decision.signal.intent.side, "sell");
  assert.equal(decision.amdContext.phase, AMDPhase.DISTRIBUTION);
  assert.equal(decision.amdContext.gates.phaseSequence, true);
  assert.equal(decision.amdContext.gates.inversionFvgConfirm, true);
});

test("AMD outside killzone -> no signal", () => {
  const endUtcTs = Date.UTC(2026, 0, 15, 17, 0, 0); // 12:00 NY
  const candles = buildBullishDataset({ endUtcTs });
  const decision = evaluateAiMaticAmdStrategyForSymbol("BTCUSDT", candles);
  assert.equal(decision.signal, null);
  assert.equal(decision.amdContext.killzoneActive, false);
  assert.notEqual(decision.amdContext.phase, AMDPhase.DISTRIBUTION);
});

test("AMD without midnight/asia range -> no signal", () => {
  const candles = buildBullishDataset({ withAsiaAndMidnight: false });
  const decision = evaluateAiMaticAmdStrategyForSymbol("BTCUSDT", candles);
  assert.equal(decision.signal, null);
  assert.equal(decision.amdContext.gates.midnightOpenSet, false);
  assert.equal(decision.amdContext.gates.asiaRangeValid, false);
  assert.equal(decision.amdContext.gates.phaseSequence, false);
});

test("AMD FVG without inversion confirm -> no distribution signal", () => {
  const candles = buildBullishDataset({ inversionConfirmed: false });
  const decision = evaluateAiMaticAmdStrategyForSymbol("BTCUSDT", candles);
  assert.equal(decision.signal, null);
  assert.equal(decision.amdContext.gates.inversionFvgConfirm, false);
  assert.notEqual(decision.amdContext.phase, AMDPhase.DISTRIBUTION);
});

test("AMD target formula returns expected tp1/tp2", () => {
  assert.equal(__aiMaticAmdTest.calculateTarget(1, 100, 110, "bullish"), 110);
  assert.equal(__aiMaticAmdTest.calculateTarget(2, 100, 110, "bullish"), 120);
  assert.equal(__aiMaticAmdTest.calculateTarget(1, 100, 110, "bearish"), 100);
  assert.equal(__aiMaticAmdTest.calculateTarget(2, 100, 110, "bearish"), 90);
});
