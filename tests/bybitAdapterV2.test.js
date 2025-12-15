// tests/bybitAdapterV2.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { placeLimitWithProtection } from "../src/engine/bybitAdapterV2.js";

const makeClient = (opts = {}) => {
  const state = { created: 0, cancelled: 0, protected: 0 };
  return {
    state,
    async createOrder() {
      state.created += 1;
      if (opts.failCreate && state.created < 2) return { ok: false, error: "temporary" };
      return { ok: true, orderId: "oid-1" };
    },
    async cancelOrder() {
      state.cancelled += 1;
      return { ok: true };
    },
    async waitForFill(orderId, timeoutMs) {
      assert.equal(orderId, "oid-1");
      assert.ok(timeoutMs > 0);
      if (opts.timeoutFill) return { filled: false };
      return { filled: true, avgPrice: 100 };
    },
    async setProtection(orderId, payload) {
      state.protected += 1;
      assert.equal(orderId, "oid-1");
      assert.ok(payload.stopLoss);
      if (opts.failProtection) return { ok: false, error: "sl failed" };
      return { ok: true };
    },
  };
};

test("placeLimitWithProtection happy path", async () => {
  const client = makeClient();
  const res = await placeLimitWithProtection({
    client,
    symbol: "BTCUSDT",
    side: "Buy",
    price: 100,
    qty: 0.01,
    stopLoss: 99,
  });
  assert.equal(res.orderId, "oid-1");
  assert.equal(res.filled, true);
  assert.equal(client.state.created, 1);
  assert.equal(client.state.protected, 1);
});

test("retry on temporary create failure", async () => {
  const client = makeClient({ failCreate: true });
  const res = await placeLimitWithProtection({
    client,
    symbol: "BTCUSDT",
    side: "Buy",
    price: 100,
    qty: 0.01,
    stopLoss: 99,
  });
  assert.equal(client.state.created, 2);
  assert.equal(res.filled, true);
});

test("cancel on fill timeout", async () => {
  const client = makeClient({ timeoutFill: true });
  await assert.rejects(
    () =>
      placeLimitWithProtection({
        client,
        symbol: "BTCUSDT",
        side: "Buy",
        price: 100,
        qty: 0.01,
        stopLoss: 99,
        timeoutMs: 10,
      }),
    /Fill timeout/
  );
  assert.equal(client.state.cancelled, 1);
});

test("fail when protection cannot be set", async () => {
  const client = makeClient({ failProtection: true });
  await assert.rejects(
    () =>
      placeLimitWithProtection({
        client,
        symbol: "BTCUSDT",
        side: "Buy",
        price: 100,
        qty: 0.01,
        stopLoss: 99,
      }),
    /Protection failed/
  );
});
