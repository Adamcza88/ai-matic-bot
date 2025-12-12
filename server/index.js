// server/index.js
import express from "express";
import cors from "cors";
import { createDemoOrder, getDemoPositions, listDemoOrders, listDemoOpenOrders, listDemoTrades } from "./bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "./userCredentials.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * CREATE DEMO ORDER (+ případné SL/TP/TS pokud je bybitClient umí)
 *
 * očekávané body z frontendu:
 * {
 *   symbol: "ADAUSDT",
 *   side: "Buy" | "Sell",
 *   qty: number,
 *   price?: number,
 *   sl?: number,          // target SL price
 *   tp?: number,          // target TP price
 *   trailingStop?: number // trailing distance (ne procenta)
 * }
 */
app.post("/api/demo/order", async (req, res) => {
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
    const keys = await getUserApiKeys(user.id);
    const apiKey = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
    const apiSecret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

    if (!apiKey || !apiSecret) {
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
      qty,
      price,
      sl,
      tp,
      trailingStop, // může být undefined
    } = req.body || {};

    if (!symbol || !side || !qty) {
      return res.status(400).json({
        ok: false,
        error: "Missing symbol/side/qty in request body",
      });
    }

    // předáme všechna pole do bybitClient.createDemoOrder,
    // ten si s nimi naloží podle své implementace
    const orderResult = await createDemoOrder({
      symbol,
      side,
      qty,
      price,
      sl,
      tp,
      trailingStop,
    }, { apiKey, apiSecret }, useTestnet);

    return res.json({
      ok: true,
      order: orderResult,
    });
  } catch (err) {
    console.error("POST /api/demo/order error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

/**
 * Přehled DEMO pozic z Bybit testnetu
 */
app.get("/api/demo/positions", async (req, res) => {
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
    const keys = await getUserApiKeys(user.id);
    const apiKey = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
    const apiSecret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
      });
    }

    const data = await getDemoPositions({
      apiKey,
      apiSecret,
    }, useTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/positions error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

/**
 * Přehled DEMO orders z Bybit testnetu
 */
app.get("/api/demo/orders", async (req, res) => {
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
    const keys = await getUserApiKeys(user.id);
    const apiKey = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
    const apiSecret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
      });
    }

    const data = await listDemoOrders({
      apiKey,
      apiSecret,
    }, {}, useTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/orders error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.get("/api/demo/open-orders", async (req, res) => {
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
    const keys = await getUserApiKeys(user.id);
    const apiKey = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
    const apiSecret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
      });
    }

    const data = await listDemoOpenOrders({
      apiKey,
      apiSecret,
    }, {}, useTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/open-orders error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.get("/api/demo/trades", async (req, res) => {
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
    const keys = await getUserApiKeys(user.id);
    const apiKey = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
    const apiSecret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
      });
    }

    const data = await listDemoTrades({
      apiKey,
      apiSecret,
    }, {}, useTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/trades error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
