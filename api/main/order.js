import { createDemoOrder } from "../../server/bybitClient.js";
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
    const useTestnet = req.query.net === "testnet";
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }

    const user = await getUserFromToken(token);
    const keys = await getUserApiKeys(user.id);
    const key = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
    const secret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

    console.log(`[Order API] ${useTestnet ? "TESTNET" : "MAINNET"} Request for user ${user.id}`);
    console.log(`[Order API] Keys resolved: Key=${key ? "***" + key.slice(-4) : "NULL"}, Secret=${secret ? "PRESENT" : "NULL"}`);

    if (!key || !secret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
        details: "Check 'user_api_keys' table. Fallback to generic 'bybit api key' service is active.",
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

    const safeQty = qty && Number(qty) > 0 ? Number(qty) : 1;

    const payload = {
      symbol,
      side: sideFormatted,
      qty: safeQty,
      price: price != null ? Number(price) : undefined,
      sl: sl != null ? Number(sl) : undefined,
      tp: tp != null ? Number(tp) : undefined,
      trailingStop: trailingStop != null ? Number(trailingStop) : undefined,
      orderType,
      timeInForce,
      reduceOnly,
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

    return res.status(200).json({
      ok: true,
      message: "Order created",
      payload,
      bybitResponse: result,
    });
  } catch (err) {
    console.error("MAIN ORDER ERROR:", err);
    console.error("Stack trace:", err?.stack);

    return res.status(500).json({
      ok: false,
      error: "Server error during order",
      details: err?.response?.data || err?.message || String(err),
    });
  }
}
