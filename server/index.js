// server/index.js
import express from "express";
import cors from "cors";
import { createDemoOrder, getDemoPositions, listDemoOrders, listDemoOpenOrders, listDemoTrades, listExecutions, listClosedPnl, getWalletBalance, setTradingStop } from "./bybitClient.js";
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
/**
 * CREATE ORDER (Unified Handler for Demo & Main via different routes or query param)
 * Supports: POST /api/demo/order AND POST /api/main/order
 */
const handleOrder = async (req, res) => {
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
    // Explicit Fallback logic consistent with userCredentials.js usage
    const apiKey = useTestnet ? keys.bybitTestnetKey : (keys.bybitMainnetKey || keys.bybitKey);
    const apiSecret = useTestnet ? keys.bybitTestnetSecret : (keys.bybitMainnetSecret || keys.bybitSecret);

    if (!apiKey || !apiSecret) {
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
      qty,
      price,
      sl,
      tp,
      trailingStop,
      reduceOnly,
      orderType,
      timeInForce
    } = req.body || {};

    if (!symbol || !side || !qty) {
      return res.status(400).json({
        ok: false,
        error: "Missing symbol/side/qty in request body",
      });
    }

    // Pass to bybitClient
    const orderResult = await createDemoOrder({
      symbol,
      side,
      qty,
      price,
      sl,
      tp,
      trailingStop,
      reduceOnly,
      orderType,
      timeInForce
    }, { apiKey, apiSecret }, useTestnet);

    // CRITICAL: Explicit check for Bybit logic error (Silent Error Fix)
    if (orderResult.retCode !== 0) {
      console.error(`[Order API] Bybit Error: ${orderResult.retMsg} (Code: ${orderResult.retCode})`);
      return res.status(400).json({
        ok: false,
        error: `Bybit Rejected: ${orderResult.retMsg}`,
        code: orderResult.retCode,
        details: orderResult
      });
    }

    return res.json({
      ok: true,
      order: orderResult,
      bybitResponse: orderResult // consistent with Vercel response
    });
  } catch (err) {
    console.error(`POST ${req.path} error:`, err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
};

// Mount both routes
app.post("/api/demo/order", handleOrder);
app.post("/api/main/order", handleOrder);

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

    const settleCoin = req.query.settleCoin || "USDT";
    const symbol = req.query.symbol;
    const limit = Number(req.query.limit ?? 50);
    const isHistory = req.query.history === "1" || req.query.history === "true";

    const clientParams = { limit, symbol, settleCoin };
    const data = isHistory
      ? await listOrderHistory({ apiKey, apiSecret }, clientParams, useTestnet)
      : await listDemoOrders({ apiKey, apiSecret }, clientParams, useTestnet);
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

app.get("/api/demo/executions", async (req, res) => {
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

    const data = await listExecutions({
      apiKey,
      apiSecret,
    }, { limit: Number(req.query.limit || 50), cursor: req.query.cursor }, useTestnet);

    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/executions error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.get("/api/demo/closed-pnl", async (req, res) => {
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

    const data = await listClosedPnl({
      apiKey,
      apiSecret,
    }, { limit: Number(req.query.limit || 50), cursor: req.query.cursor }, useTestnet);

    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/closed-pnl error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.post("/api/demo/protection", async (req, res) => {
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

    const { symbol, sl, tp, trailingStop, positionIdx, slTriggerBy, tpTriggerBy } = req.body || {};
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Missing symbol for protection" });
    }

    const data = await setTradingStop(
      { symbol, sl, tp, trailingStop, positionIdx, slTriggerBy, tpTriggerBy },
      { apiKey, apiSecret },
      useTestnet
    );

    res.json({ ok: true, data });
  } catch (err) {
    console.error("POST /api/demo/protection error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.get("/api/demo/wallet", async (req, res) => {
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

    const data = await getWalletBalance({
      apiKey,
      apiSecret,
    }, useTestnet);

    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/wallet error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
