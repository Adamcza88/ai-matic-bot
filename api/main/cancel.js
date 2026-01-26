import { cancelOrder } from "../../server/bybitClient.js";
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

  return res
    .status(403)
    .json({ ok: false, error: "cancel_disabled" });

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

    const { symbol, orderId, orderLinkId } = req.body || {};
    if (!symbol || (!orderId && !orderLinkId)) {
      return res.status(400).json({ ok: false, error: "Missing symbol and (orderId or orderLinkId)" });
    }

    const data = await cancelOrder(
      { symbol, orderId, orderLinkId },
      { apiKey, apiSecret },
      useTestnet
    );

    return res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/main/cancel error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err?.message || "Unknown error",
    });
  }
}
