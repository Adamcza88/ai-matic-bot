import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStrategyForSymbol,
  type Candle,
} from "../src/engine/botEngine";
import { evaluateAiMaticBboStrategyForSymbol } from "../src/engine/aiMaticBboStrategy";

const TF_5M = 5 * 60_000;

function candle(
  open: number,
  high: number,
  low: number,
  close: number,
  idx: number,
  volume = 100,
): Candle {
  return {
    openTime: idx * TF_5M,
    open,
    high,
    low,
    close,
    volume,
  };
}

function buildBboSeries(count = 1000) {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < count; i++) {
    let drift = 0.12;
    let range = 0.22;
    let volume = 120 + (i % 7) * 4;
    if (i >= count - 40 && i < count - 18) {
      drift = -0.18;
      range = 0.28;
      volume = 115;
    } else if (i >= count - 18) {
      drift = 0.42;
      range = 0.65;
      volume = 230 + (i - (count - 18)) * 12;
    } else if (i % 24 === 0) {
      drift = -0.05;
      range = 0.3;
    }
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + range;
    const low = Math.min(open, close) - range;
    out.push(candle(open, high, low, close, i, volume));
    price = close;
  }
  return out;
}

test("standalone BBO engine emits signal on aligned pullback continuation", () => {
  const series = buildBboSeries();
  const decision = evaluateAiMaticBboStrategyForSymbol("BTCUSDT", series);
  assert.ok(decision.signal, "expected BBO signal");
  assert.equal(decision.signal?.kind, "PULLBACK");
  assert.equal(decision.signal?.entryType, "LIMIT_MAKER_FIRST");
  assert.equal(decision.bboContext?.family, "TREND_PULLBACK");
  assert.equal(decision.bboContext?.direction, "BULL");
  assert.ok((decision.bboContext?.baseScore ?? 0) >= 45);
  assert.ok(decision.coreV2);
  assert.equal(decision.coreV2.pullbackLong, true);
  assert.equal(decision.coreV2.microBreakLong, true);
});

test("evaluateStrategyForSymbol dispatches ai-matic-bbo to standalone engine", () => {
  const series = buildBboSeries();
  const decision = evaluateStrategyForSymbol("BTCUSDT", series, {
    strategyProfile: "ai-matic-bbo",
  });
  assert.ok(decision.bboContext, "expected standalone BBO context");
  assert.equal(decision.bboContext?.family, "TREND_PULLBACK");
  assert.equal(decision.signal?.entryType, "LIMIT_MAKER_FIRST");
});
