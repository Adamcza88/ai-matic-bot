// /api/demo/order.ts

import {
  cancelOrder,
  createDemoOrder,
  getDemoPositions,
  getWalletBalance,
  listDemoOpenOrders,
} from "../../server/bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const useTestnet = req.query.net !== "mainnet";
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }

    const user = await getUserFromToken(token);
    const keys = await getUserApiKeys(user.id, useTestnet ? "testnet" : "mainnet");
    const key = keys.apiKey;
    const secret = keys.apiSecret;

    if (!key || !secret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
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
      leverage,
      orderLinkId,
    } = req.body || {};

    // ===== QUICK PERMISSION CHECK =====
    try {
      const wb = await getWalletBalance({ apiKey: key, apiSecret: secret }, useTestnet);
      const rc = wb?.retCode ?? wb?.data?.retCode;
      if (rc && rc !== 0) {
        const rm = wb?.retMsg ?? wb?.data?.retMsg ?? "Unknown";
        return res.status(400).json({
          ok: false,
          error: `Bybit permission check failed: retCode=${rc} ${rm}`,
        });
      }
    } catch {
      // ignore
    }

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

    // Cancel stale open orders for this symbol when no position is open.
    try {
      const posRes = await getDemoPositions({ apiKey: key, apiSecret: secret }, useTestnet);
      const posList = posRes?.result?.list ?? [];
      const hasOpenPosition = posList.some(
        (p) => String(p?.symbol ?? "") === symbol && Number(p?.size ?? 0) > 0
      );
      if (!hasOpenPosition) {
        const openRes = await listDemoOpenOrders({ apiKey: key, apiSecret: secret }, { limit: 50 }, useTestnet);
        const openList = openRes?.result?.list ?? [];
        for (const o of openList) {
          if (String(o?.symbol ?? "") !== symbol) continue;
          const existingLinkId = String(o?.orderLinkId ?? "");
          if (orderLinkId && existingLinkId === String(orderLinkId)) continue;
          const orderId = o?.orderId ?? o?.orderID ?? o?.id;
          if (!orderId) continue;
          await cancelOrder(
            { symbol, orderId: String(orderId) },
            { apiKey: key, apiSecret: secret },
            useTestnet
          );
        }
      }
    } catch (err) {
      console.error("[DemoOrder] Cancel stale orders failed:", err?.message || err);
    }

    const qtyValue = Number(qty);
    if (!Number.isFinite(qtyValue) || qtyValue <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid required field: qty",
      });
    }

    // ===== BYBIT PAYLOAD =====
    const payload = {
      symbol,
      side: sideFormatted, // Buy / Sell
      qty: qtyValue,
      price: price != null ? Number(price) : undefined,
      sl: sl != null ? Number(sl) : undefined,
      tp: tp != null ? Number(tp) : undefined,
      trailingStop: trailingStop != null ? Number(trailingStop) : undefined,
      orderType,
      timeInForce,
      reduceOnly,
      category: "linear",
      leverage: leverage != null ? Number(leverage) : undefined,
      orderLinkId: orderLinkId != null ? String(orderLinkId) : undefined,
    };

    // ===== CALL BYBIT =====
    // ===== CALL BYBIT =====
    const result = await createDemoOrder(payload, {
      apiKey: key,
      apiSecret: secret,
    }, useTestnet);

    // Explicit check
    if (result.retCode !== 0) {
      console.error(`[DemoOrder] Bybit Error: ${result.retMsg} (Code: ${result.retCode})`);
      return res.status(400).json({
        ok: false,
        error: `Bybit Rejected: ${result.retMsg}`,
        code: result.retCode,
        details: result
      });
    }

    // A2: Backend Structure Alignment -> ApiResponse
    return res.status(200).json({
      ok: true,
      data: result,
      meta: {
        ts: new Date().toISOString(),
        version: "v1",
        env: useTestnet ? "testnet" : "mainnet",
        endpoint: req.url
      }
    });
  } catch (err) {
    console.error("DEMO ORDER ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error during demoOrder",
      meta: {
        ts: new Date().toISOString(),
        env: req.query.net === "mainnet" ? "mainnet" : "testnet",
        endpoint: req.url
      },
      details: err?.response?.data || String(err),
    });
  }
}
