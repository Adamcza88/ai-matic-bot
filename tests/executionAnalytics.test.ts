import test from "node:test";
import assert from "node:assert/strict";
import { computeExecutionAnalytics } from "../src/lib/executionAnalytics.ts";
import type { TestnetTrade } from "../src/types.ts";

function fill(overrides: Partial<TestnetTrade>): TestnetTrade {
  return {
    id: "x",
    symbol: "BTCUSDT",
    side: "Buy",
    price: 100,
    qty: 1,
    value: 100,
    fee: 0,
    time: "2026-03-09T09:24:00.000Z",
    ...overrides,
  };
}

test("reconstructs lifecycle and realized PnL including fees", () => {
  const trades: TestnetTrade[] = [
    fill({
      id: "1",
      side: "Buy",
      qty: 10,
      price: 100,
      fee: 1,
      time: "2026-03-09T09:24:00.000Z",
    }),
    fill({
      id: "2",
      side: "Sell",
      qty: 4,
      price: 110,
      fee: 0.4,
      time: "2026-03-09T09:24:01.000Z",
    }),
    fill({
      id: "3",
      side: "Sell",
      qty: 6,
      price: 90,
      fee: 0.6,
      time: "2026-03-09T09:24:02.000Z",
    }),
  ];

  const analytics = computeExecutionAnalytics(trades);
  const [a, b, c] = analytics.fills;

  assert.equal(a.lifecycle, "ENTRY");
  assert.equal(b.lifecycle, "PARTIAL");
  assert.equal(c.lifecycle, "EXIT");
  assert.equal(Number(a.realizedPnlDelta.toFixed(2)), -1.0);
  assert.equal(Number(b.realizedPnlDelta.toFixed(2)), 39.6);
  assert.equal(Number(c.realizedPnlDelta.toFixed(2)), -60.6);
  assert.equal(Number(analytics.totals.netResult.toFixed(2)), -22.0);
});

test("detects churn clusters and slicing bursts in 1s window", () => {
  const trades: TestnetTrade[] = Array.from({ length: 5 }).map((_, index) =>
    fill({
      id: `doge-${index}`,
      symbol: "DOGEUSDT",
      side: "Sell",
      qty: 14310 + index,
      price: 0.0904,
      fee: 0.71,
      time: `2026-03-09T09:24:00.${String(index).padStart(3, "0")}Z`,
    })
  );

  const analytics = computeExecutionAnalytics(trades);
  assert.equal(analytics.sliceSequences.length, 1);
  assert.equal(analytics.sliceSequences[0].fillCount, 5);
  assert.equal(analytics.churnClusters.length, 1);
  assert.equal(analytics.churnClusters[0].fillCount, 5);
  assert.equal(analytics.churnClusters[0].symbol, "DOGEUSDT");
});

test("builds heatmap and diagnostics rows by symbol", () => {
  const trades: TestnetTrade[] = [
    fill({
      id: "a",
      symbol: "ADAUSDT",
      side: "Buy",
      qty: 100,
      price: 0.5,
      time: "2026-03-09T09:24:00.000Z",
    }),
    fill({
      id: "b",
      symbol: "ADAUSDT",
      side: "Buy",
      qty: 50,
      price: 0.5,
      time: "2026-03-09T09:24:00.200Z",
    }),
    fill({
      id: "c",
      symbol: "ADAUSDT",
      side: "Sell",
      qty: 150,
      price: 0.52,
      time: "2026-03-09T09:26:00.000Z",
    }),
  ];

  const analytics = computeExecutionAnalytics(trades);
  assert.equal(analytics.heatmap.length, 2);
  assert.equal(analytics.diagnosticsRows.length, 1);
  assert.equal(analytics.diagnosticsRows[0].symbol, "ADAUSDT");
  assert.equal(analytics.diagnosticsRows[0].fillCount, 3);
  assert.equal(analytics.diagnosticsRows[0].burstCount, 1);
});

