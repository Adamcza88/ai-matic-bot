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
 * CREATE ORDER HANDLER GENERATOR
 * Returns a handler strictly bound to a specific network (Mainnet or Testnet).
 */
const createOrderHandler = (isTestnet) => async (req, res) => {
  const env = isTestnet ? "testnet" : "mainnet"; // derived from handler factory
  const endpoint = `/api/${env}/order`;

  try {
    // HARD SEPARATION: Ignore query params, use the bound network
    const useTestnet = isTestnet;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);

    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({
        ok: false,
        error: keyErr.message,
        details: `Failed to load keys for ${env}. Please check API Key Settings.`,
        env,
        endpoint
      });
    }

    const { apiKey, apiSecret } = keys;

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
        env,
        endpoint
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

    // CRITICAL: Explicit check for Bybit logic error
    if (orderResult.retCode !== 0) {
      console.error(`[Order API] Bybit Error: ${orderResult.retMsg} (Code: ${orderResult.retCode})`);
      return res.status(400).json({
        ok: false,
        error: `Bybit Rejected: ${orderResult.retMsg}`,
        code: orderResult.retCode,
        details: orderResult,
        env,
        endpoint
      });
    }

    // A2: Backend Structure Alignment -> ApiResponse
    return res.json({
      ok: true,
      data: orderResult,
      meta: { ts: new Date().toISOString() },
      env,
      endpoint
    });
  } catch (err) {
    console.error(`POST ${req.path} error:`, err);
    return res.status(400).json({ // FIX 8: Denial of Silent Errors
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
};

// Mount strictly separated routes
app.post("/api/demo/order", createOrderHandler(true));  // FORCE TESTNET
app.post("/api/main/order", createOrderHandler(false)); // FORCE MAINNET

/**
 * Přehled DEMO pozic z Bybit testnetu
 */
/**
 * Přehled DEMO pozic z Bybit testnetu
 */
app.get("/api/demo/positions", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/positions";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const data = await getDemoPositions({
      apiKey,
      apiSecret,
    }, isTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error(`GET ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

/**
 * Přehled DEMO orders z Bybit testnetu
 */
app.get("/api/demo/orders", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/orders";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const settleCoin = req.query.settleCoin || "USDT";
    const symbol = req.query.symbol;
    const limit = Number(req.query.limit ?? 50);
    const isHistory = req.query.history === "1" || req.query.history === "true";

    const clientParams = { limit, symbol, settleCoin };
    const data = isHistory
      ? await listOrderHistory({ apiKey, apiSecret }, clientParams, isTestnet)
      : await listDemoOrders({ apiKey, apiSecret }, clientParams, isTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error(`GET ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

app.get("/api/demo/open-orders", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/open-orders";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const data = await listDemoOpenOrders({
      apiKey,
      apiSecret,
    }, {}, isTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error(`GET ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

app.get("/api/demo/trades", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/trades";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const data = await listDemoTrades({
      apiKey,
      apiSecret,
    }, {}, isTestnet);
    res.json({ ok: true, data });
  } catch (err) {
    console.error(`GET ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

app.get("/api/demo/executions", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/executions";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const data = await listExecutions({
      apiKey,
      apiSecret,
    }, { limit: Number(req.query.limit || 50), cursor: req.query.cursor }, isTestnet);

    res.json({ ok: true, data });
  } catch (err) {
    console.error(`GET ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

app.get("/api/demo/closed-pnl", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/closed-pnl";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const data = await listClosedPnl({
      apiKey,
      apiSecret,
    }, { limit: Number(req.query.limit || 50), cursor: req.query.cursor }, isTestnet);

    res.json({ ok: true, data });
  } catch (err) {
    console.error(`GET ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

app.post("/api/demo/protection", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/protection";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const { symbol, sl, tp, trailingStop, positionIdx, slTriggerBy, tpTriggerBy } = req.body || {};
    if (!symbol) {
      return res.status(400).json({ ok: false, error: "Missing symbol for protection", env, endpoint });
    }

    const data = await setTradingStop(
      { symbol, sl, tp, trailingStop, positionIdx, slTriggerBy, tpTriggerBy },
      { apiKey, apiSecret },
      isTestnet
    );

    res.json({ ok: true, data });
  } catch (err) {
    console.error(`POST ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

app.get("/api/demo/wallet", async (req, res) => {
  const isTestnet = req.query.net !== "mainnet";
  const env = isTestnet ? "testnet" : "mainnet";
  const endpoint = "/api/demo/wallet";

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token", env, endpoint });
    }

    const user = await getUserFromToken(token);
    // FIX 3: Strict Key Selection
    let keys;
    try {
      keys = await getUserApiKeys(user.id, env);
    } catch (keyErr) {
      return res.status(400).json({ ok: false, error: keyErr.message, env, endpoint });
    }
    const { apiKey, apiSecret } = keys;

    const data = await getWalletBalance({
      apiKey,
      apiSecret,
    }, isTestnet);

    res.json({ ok: true, data });
  } catch (err) {
    console.error(`GET ${endpoint} error:`, err);
    res.status(400).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
      env,
      endpoint
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
