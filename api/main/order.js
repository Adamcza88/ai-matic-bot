import {
  cancelOrder,
  createDemoOrder,
  getDemoPositions,
  getWalletBalance,
  listDemoOpenOrders,
} from "../../server/bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";
import { extractRequestToken } from "../../server/requestAuth.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token");
}

function normalizeOrderType(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "market" ? "Market" : "Limit";
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
    const useTestnet = req.query.net === "testnet";
    const token = extractRequestToken(req);

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }

    const user = await getUserFromToken(token);
    const keys = await getUserApiKeys(user.id, useTestnet ? "testnet" : "mainnet");
    const key = keys.apiKey;
    const secret = keys.apiSecret;

    const envLabel = useTestnet ? "TESTNET" : "MAINNET";
    if (!key || !secret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
        details: "Check 'user_api_keys' table. Fallback to generic 'bybit api key' service is active.",
      });
    }

    // Fail-fast permission check (wallet balance) to surface retCode 10005/10003 early
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
    } catch (e) {
      console.error(`[Order API] Wallet check failed (${envLabel}):`, e?.message || e);
      // continue to order attempt; Bybit will respond with retCode
    }

    const {
      symbol,
      side,
      price,
      triggerPrice,
      sl,
      tp,
      qty,
      trailingStop,
      trailingActivePrice,
      orderType,
      timeInForce,
      reduceOnly,
      leverage,
      orderLinkId,
      positionIdx,
    } = req.body || {};

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

    const allowAutoCancel = false;
    if (allowAutoCancel) {
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
        console.error("[Order API] Cancel stale orders failed:", err?.message || err);
      }
    }

    const qtyValue = Number(qty);
    if (!Number.isFinite(qtyValue) || qtyValue <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid required field: qty",
      });
    }

    const normalizedOrderType = normalizeOrderType(orderType);
    const triggerPriceNum = Number(triggerPrice);
    const hasTriggerPrice =
      Number.isFinite(triggerPriceNum) && triggerPriceNum > 0;
    const priceNum = Number(price);
    const normalizedPrice =
      normalizedOrderType === "Market"
        ? undefined
        : Number.isFinite(priceNum) && priceNum > 0
          ? priceNum
          : hasTriggerPrice
            ? triggerPriceNum
            : undefined;
    const normalizedTimeInForce =
      normalizedOrderType === "Market"
        ? "IOC"
        : typeof timeInForce === "string" && timeInForce.trim()
          ? timeInForce.trim()
          : "GTC";

    if (reduceOnly === true) {
      try {
        const posRes = await getDemoPositions({ apiKey: key, apiSecret: secret }, useTestnet);
        const posList = posRes?.result?.list ?? [];
        const hasReduciblePosition = posList.some((p) => {
          if (String(p?.symbol ?? "").toUpperCase() !== String(symbol).toUpperCase()) return false;
          const size = Number(p?.size ?? p?.qty ?? 0);
          if (!Number.isFinite(size) || size <= 0) return false;
          const posSide = String(p?.side ?? "").toLowerCase();
          if (!posSide) return true;
          return sideFormatted === "Buy" ? posSide === "sell" : posSide === "buy";
        });
        if (!hasReduciblePosition) {
          return res.status(200).json({
            ok: true,
            data: {
              retCode: 0,
              retMsg: "reduce_only_skipped_no_open_position",
              result: {},
            },
            meta: {
              ts: new Date().toISOString(),
              version: "v1",
              env: useTestnet ? "testnet" : "mainnet",
              endpoint: req.url,
            },
          });
        }
      } catch (_) {
        // continue, creation call will return upstream detail if needed
      }
    }

    const payload = {
      symbol,
      side: sideFormatted,
      qty: qtyValue,
      price: normalizedPrice,
      triggerPrice: hasTriggerPrice ? triggerPriceNum : undefined,
      sl: sl != null ? Number(sl) : undefined,
      tp: tp != null ? Number(tp) : undefined,
      trailingStop: trailingStop != null ? Number(trailingStop) : undefined,
      trailingActivePrice: trailingActivePrice != null ? Number(trailingActivePrice) : undefined,
      orderType: normalizedOrderType,
      timeInForce: normalizedTimeInForce,
      reduceOnly,
      category: "linear",
      leverage: leverage != null ? Number(leverage) : undefined,
      orderLinkId: orderLinkId != null ? String(orderLinkId) : undefined,
      positionIdx:
        Number.isFinite(Number(positionIdx)) ? Number(positionIdx) : undefined,
    };

    const result = await createDemoOrder(
      payload,
      {
        apiKey: key,
        apiSecret: secret,
      },
      useTestnet
    );

    // Explicitly check Bybit logic error
    // retCode 0 = OK. Anything else is an error (e.g. 10001 params error)
    if (result.retCode !== 0) {
      console.error(`[Order API] Bybit Error: ${result.retMsg} (Code: ${result.retCode})`);
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
    console.error("MAIN ORDER ERROR:", err);
    console.error("Stack trace:", err?.stack);

    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error during order",
      meta: {
        ts: new Date().toISOString(),
        env: req.query.net === "testnet" ? "testnet" : "mainnet",
        endpoint: req.url
      },
      details: err?.response?.data || String(err),
    });
  }
}
