import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveOrderPriceFields,
  resolveTrailingFields,
  stopValidityGate,
  treeTrendGate5m,
} from "../src/hooks/tradingGuards.ts";

test("TREE trend gate blocks SHORT above EMA200", () => {
  const result = treeTrendGate5m({
    side: "Sell",
    price: 101,
    ema200_5m: 100,
    macdHist_5m: -0.1,
    rsi14_5m: 48,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TREND_FILTER");
});

test("TREE trend gate blocks SHORT when MACD histogram is bullish", () => {
  const result = treeTrendGate5m({
    side: "Sell",
    price: 99,
    ema200_5m: 100,
    macdHist_5m: 0.01,
    rsi14_5m: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TREND_FILTER");
});

test("TREE trend gate blocks SHORT when RSI >= 55", () => {
  const result = treeTrendGate5m({
    side: "Sell",
    price: 99,
    ema200_5m: 100,
    macdHist_5m: -0.1,
    rsi14_5m: 55,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TREND_FILTER");
});

test("TREE trend gate allows SHORT when 5m downtrend conditions pass", () => {
  const result = treeTrendGate5m({
    side: "Sell",
    price: 99,
    ema200_5m: 100,
    macdHist_5m: -0.3,
    rsi14_5m: 45,
  });
  assert.equal(result.ok, true);
});

test("stopValidityGate validates LONG/SHORT side and minimum distance", () => {
  const longOk = stopValidityGate(100, 98, "Buy", 1);
  const longWrongSide = stopValidityGate(100, 101, "Buy", 1);
  const shortWrongSide = stopValidityGate(100, 99, "Sell", 1);
  const shortTooClose = stopValidityGate(100, 100.2, "Sell", 1);

  assert.equal(longOk.ok, true);
  assert.equal(longWrongSide.ok, false);
  assert.equal(shortWrongSide.ok, false);
  assert.equal(shortTooClose.ok, false);
  assert.equal(shortTooClose.code, "INVALID_SL");
});

test("resolveOrderPriceFields uses trigger as shownPrice when price is zero", () => {
  const fields = resolveOrderPriceFields(0, 101.25);
  assert.equal(fields.price, null);
  assert.equal(fields.triggerPrice, 101.25);
  assert.equal(fields.shownPrice, 101.25);
});

test("resolveOrderPriceFields prefers limit price when present", () => {
  const fields = resolveOrderPriceFields(100.5, 101.25);
  assert.equal(fields.price, 100.5);
  assert.equal(fields.triggerPrice, 101.25);
  assert.equal(fields.shownPrice, 100.5);
});

test("resolveTrailingFields keeps distance separate from stop price", () => {
  const withExplicitPrice = resolveTrailingFields({
    side: "Buy",
    trailingStopPrice: 95,
    trailingStopDistance: undefined,
    highWatermark: 110,
    lowWatermark: 90,
  });
  assert.equal(withExplicitPrice.trailingDistance, undefined);
  assert.equal(withExplicitPrice.trailStopPrice, 95);

  const computedFromDistance = resolveTrailingFields({
    side: "Sell",
    trailingStopDistance: 5,
    lowWatermark: 80,
    highWatermark: 120,
  });
  assert.equal(computedFromDistance.trailingDistance, 5);
  assert.equal(computedFromDistance.trailStopPrice, 85);
});
