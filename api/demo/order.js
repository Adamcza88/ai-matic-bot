// /api/demo/order.ts

import { createDemoOrder } from "../../../server/bybitClient";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { symbol, side, price, sl, tp, qty } = req.body;

    // ===== VALIDACE =====
    if (!symbol || !side || !price) {
      return res.status(400).json({
        error: "Missing required fields: symbol, side, price",
      });
    }

    // ===== DEFAULT QTY PRO TEST MODE =====
    const safeQty = qty && qty > 0 ? qty : 1;

    // ===== BYBIT PAYLOAD =====
    const payload = {
      symbol: symbol,
      side: side.toUpperCase(), // BUY / SELL
      qty: safeQty,
      price: Number(price),
      sl: sl ? Number(sl) : undefined,
      tp: tp ? Number(tp) : undefined,
      timeInForce: "GoodTillCancel",
      reduceOnly: false,
    };

    // ===== CALL BYBIT =====
    const result = await createDemoOrder(payload);

    return res.status(200).json({
      ok: true,
      message: "Demo order created",
      payload: payload,
      bybitResponse: result,
    });

  } catch (err) {
    console.error("DEMO ORDER ERROR:", err);

    return res.status(500).json({
      error: "Server error during demoOrder",
      details: err?.message || String(err),
    });
  }
}
