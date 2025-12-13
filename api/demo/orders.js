import { listDemoOrders, listOrderHistory } from "../../server/bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
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
    const keys = await getUserApiKeys(user.id, "testnet");
    const key = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
    const secret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

    if (!key || !secret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
      });
    }

    const settleCoin = req.query.settleCoin || "USDT";
    const symbol = req.query.symbol;
    const limit = Number(req.query.limit ?? 50);
    const isHistory = req.query.history === "1" || req.query.history === "true";

    const clientParams = { limit, symbol, settleCoin };
    const data = isHistory
      ? await listOrderHistory({ apiKey: key, apiSecret: secret }, clientParams, useTestnet)
      : await listDemoOrders({ apiKey: key, apiSecret: secret }, clientParams, useTestnet);

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/orders error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err?.message || "Unknown error",
    });
  }
}
