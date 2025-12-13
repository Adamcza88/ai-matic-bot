import { setTradingStop } from "../../server/bybitClient.js";
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
    const apiKey = keys.apiKey;
    const apiSecret = keys.apiSecret;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
      });
    }

    const { symbol, sl, tp, trailingStop, positionIdx, slTriggerBy, tpTriggerBy } = req.body || {};
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Missing symbol for protection" });
    }

    const data = await setTradingStop(
      { symbol, sl, tp, trailingStop, positionIdx, slTriggerBy, tpTriggerBy },
      { apiKey, apiSecret },
      useTestnet
    );

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/demo/protection error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err?.message || "Unknown error",
    });
  }
}
