import { createDemoOrder, getWalletBalance } from "../../server/bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";

const QTY_BOUNDS = {
  SOLUSDT: { min: 3.5, max: 3.5 },
  BTCUSDT: { min: 0.005, max: 0.005 },
  ETHUSDT: { min: 0.15, max: 0.15 },
  ADAUSDT: { min: 858, max: 858 },
};

function clampQty(symbol, qty) {
  const bounds = QTY_BOUNDS[symbol];
  const safe = Math.max(0, Number(qty) || 0);
  if (!bounds) return safe;
  return Math.min(bounds.max, Math.max(bounds.min, safe));
}

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
    const useTestnet = req.query.net === "testnet";
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

    const envLabel = useTestnet ? "TESTNET" : "MAINNET";
    const keyFingerprint = key ? `***${key.slice(-4)}` : "NULL";
    console.log(`[Order API] ${envLabel} Request for user ${user.id}`);
    console.log(`[Order API] Env=${envLabel} Key=${keyFingerprint} category=linear`);

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

    const bounds = QTY_BOUNDS[symbol];
    const defaultQty = bounds?.min ?? 1;
    const safeQty = qty && Number(qty) > 0 ? Number(qty) : defaultQty;
    const cappedQty = clampQty(symbol, safeQty);

    const payload = {
      symbol,
      side: sideFormatted,
      qty: cappedQty,
      price: price != null ? Number(price) : undefined,
      triggerPrice: triggerPrice != null ? Number(triggerPrice) : undefined,
      sl: sl != null ? Number(sl) : undefined,
      tp: tp != null ? Number(tp) : undefined,
      trailingStop: trailingStop != null ? Number(trailingStop) : undefined,
      trailingActivePrice: trailingActivePrice != null ? Number(trailingActivePrice) : undefined,
      orderType,
      timeInForce,
      reduceOnly,
      category: "linear",
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
