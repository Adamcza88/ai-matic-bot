// /api/demo/order.ts

import { createDemoOrder } from "../../server/bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }

    const user = await getUserFromToken(token);
    const keys = await getUserApiKeys(user.id);

    if (!keys.bybitKey || !keys.bybitSecret) {
      return res.status(400).json({
        ok: false,
        error: "Bybit API key/secret not configured for this user",
      });
    }

    const {
      symbol,
      side,
      price,
      sl,
      tp,
      qty,
      trailingStop,
      orderType,
      timeInForce,
      reduceOnly,
    } = req.body || {};

    // ===== VALIDACE =====
    const normalizedSide =
      typeof side === "string" ? side.trim().toLowerCase() : "";
    const sideFormatted =
      normalizedSide === "buy"
        ? "Buy"
        : normalizedSide === "sell"
          ? "Sell"
          : null;

    if (!symbol || !sideFormatted) {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid required fields: symbol, side",
      });
    }

    // ===== DEFAULT QTY PRO TEST MODE =====
    const safeQty = qty && Number(qty) > 0 ? Number(qty) : 1;

    // ===== BYBIT PAYLOAD =====
    const payload = {
      symbol,
      side: sideFormatted, // Buy / Sell
      qty: safeQty,
      price: price != null ? Number(price) : undefined,
      sl: sl != null ? Number(sl) : undefined,
      tp: tp != null ? Number(tp) : undefined,
      trailingStop: trailingStop != null ? Number(trailingStop) : undefined,
      orderType,
      timeInForce,
      reduceOnly,
    };

    // ===== CALL BYBIT =====
    const result = await createDemoOrder(payload, {
      apiKey: keys.bybitKey,
      apiSecret: keys.bybitSecret,
    });

    return res.status(200).json({
      ok: true,
      message: "Demo order created",
      payload,
      bybitResponse: result,
    });
  } catch (err) {
    console.error("DEMO ORDER ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: "Server error during demoOrder",
      details: err?.response?.data || err?.message || String(err),
    });
  }
}
