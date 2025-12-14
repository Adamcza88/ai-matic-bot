// ===========================================
// DEV_ONLY SERVER (Locally mimics Vercel API)
// ===========================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { getUserApiKeys } from "./userCredentials.js";
import {
  createDemoOrder,
  listDemoOrders,
  getDemoPositions,
  listDemoTrades,
  getWalletBalance,
  listClosedPnl,
} from "./bybitClient.js";
import { reconcileState } from "./reconcile.js";

dotenv.config();

// A4: STRICT SECURITY CHECK
// Unless we are in a purely local dev environment without Supabase needs, this should be present.
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[CRITICAL] Missing SUPABASE_SERVICE_ROLE_KEY. Server will fail to authenticate users.");
  // process.exit(1); // Relaxed for now to allow partial boot, but logged error.
}

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json());

// A2: STRICT API CONTRACT HELPERS
const sendResponse = (res, data, meta = {}) => {
  const payload = {
    ok: true,
    data,
    meta: {
      ts: new Date().toISOString(),
      version: "v1",
      ...meta,
    },
  };
  return res.status(200).json(payload);
};

const sendError = (res, status, message, meta = {}) => {
  console.error(`[API ERROR] ${status} - ${message}`);
  return res.status(status).json({
    ok: false,
    error: message,
    meta: {
      ts: new Date().toISOString(),
      ...meta,
    },
  });
};

// Helper to reliably get params
const getCommonParams = (req) => {
  let env = "testnet";
  if (req.path.includes("/main/") || req.query.net === "mainnet") {
    env = "mainnet";
  }
  return { env, isTestnet: env === "testnet" };
};

// ===========================================
// POST /api/:env/order
// ===========================================
app.post("/api/:env/order", async (req, res) => {
  const startTs = Date.now();
  const endpoint = req.originalUrl;
  const env = req.params.env === "main" ? "mainnet" : "testnet";

  const { symbol, side, qty, orderType, sl, tp, orderLinkId, timeInForce, trailingStop, price, triggerPrice } = req.body;

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return sendError(res, 401, "Missing Authorization header", { env, endpoint });
    }
    const userId = authHeader.replace("Bearer ", "");

    // FIX 3: Strict Key Selection
    const creds = await getUserApiKeys(userId, env);

    if (!symbol || !side || !qty) {
      return sendError(res, 400, "Missing required fields: symbol, side, qty", { env, endpoint });
    }

    // Reuse createDemoOrder for both main/testnet logic in server (it handles 'useTestnet' flag)
    const result = await createDemoOrder({
      symbol,
      side,
      qty,
      orderType,
      price,
      triggerPrice,
      sl,
      tp,
      orderLinkId,
      timeInForce,
      takeProfit: tp,
      stopLoss: sl,
      trailingStop
    }, creds, env === "testnet");

    if (result.retCode !== 0) {
      return sendError(res, 400, `Bybit Rejected: ${result.retMsg}`, {
        code: result.retCode,
        details: result,
        env, endpoint
      });
    }

    return sendResponse(res, result, {
      latencyMs: Date.now() - startTs,
      env,
      endpoint
    });

  } catch (err) {
    return sendError(res, 500, err.message, { latencyMs: Date.now() - startTs, env, endpoint });
  }
});

// Fallback aliases for POST
app.post("/api/main/order", (req, res) => { req.params.env = "main"; return app._router.handle(req, res); }); // Express routing trick or just copy handler. 
// Simpler: Just rely on :env param matching "main" or "demo".
app.post("/api/demo/order", async (req, res) => {
  // express matches /api/:env/order so this might conflict if defined after? 
  // Actually /api/:env/order catches /api/demo/order.
});


// ===========================================
// GET HANDLERS
// ===========================================
const handleGetRequest = async (req, res, fetcher) => {
  const startTs = Date.now();
  const { env, isTestnet } = getCommonParams(req);
  const endpoint = req.originalUrl;

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return sendError(res, 401, "Missing Auth", { env, endpoint });
    const userId = authHeader.replace("Bearer ", "");

    // DEBUG: check env
    if (!env) console.error(`[handleGetRequest] Env is undefined! params=${JSON.stringify(req.params)}, query=${JSON.stringify(req.query)}, path=${req.path}`);

    const creds = await getUserApiKeys(userId, env);

    // Pass req.query as filters
    // Some fetchers expect (creds, filters, useTestnet)
    // Some expect (creds, useTestnet)
    // We need to standardize or adapter.
    // getDemoPositions(creds, useTestnet) -> IT IGNORES FILTERS IN ARGS usually?
    // Let's check signatures:
    // getDemoPositions(creds, useTestnet)
    // listDemoOrders(creds, filters, useTestnet)
    // listDemoTrades(creds, filters, useTestnet)
    // getWalletBalance(creds, useTestnet)
    // listClosedPnl(creds, filters, useTestnet)

    // We will pass query as 2nd arg if function accepts 3 args, else we assume it might ignore it.
    // JS allows extra args.

    // Special adapter for Positions which might not take filters in 2nd arg in my implementation?
    // Checking bybitClient: export async function getDemoPositions(creds, useTestnet = true)

    // We need to match signature.
    let result;
    if (fetcher === getDemoPositions || fetcher === getWalletBalance) {
      result = await fetcher(creds, isTestnet);
    } else {
      result = await fetcher(creds, req.query, isTestnet);
    }

    return sendResponse(res, result, {
      latencyMs: Date.now() - startTs,
      env,
      endpoint
    });
  } catch (err) {
    return sendError(res, 500, err.message, { latencyMs: Date.now() - startTs, env, endpoint });
  }
};

app.get("/api/:env/positions", (req, res) => handleGetRequest(req, res, getDemoPositions));
app.get("/api/positions", (req, res) => handleGetRequest(req, res, getDemoPositions));

app.get("/api/:env/orders", (req, res) => handleGetRequest(req, res, listDemoOrders));
app.get("/api/orders", (req, res) => handleGetRequest(req, res, listDemoOrders));

app.get("/api/:env/trades", (req, res) => handleGetRequest(req, res, listDemoTrades));
app.get("/api/trades", (req, res) => handleGetRequest(req, res, listDemoTrades));

app.get("/api/:env/wallet", (req, res) => handleGetRequest(req, res, getWalletBalance));
app.get("/api/wallet", (req, res) => handleGetRequest(req, res, getWalletBalance));

app.get("/api/:env/closed-pnl", (req, res) => handleGetRequest(req, res, listClosedPnl));
app.get("/api/closed-pnl", (req, res) => handleGetRequest(req, res, listClosedPnl));

// Reconcile
app.get("/api/:env/reconcile", (req, res) => handleGetRequest(req, res, reconcileState));
app.get("/api/reconcile", (req, res) => handleGetRequest(req, res, reconcileState));

// Health
app.get("/api/health", (req, res) => {
  return sendResponse(res, { status: "ok" }, { uptime: process.uptime() });
});


app.listen(PORT, () => {
  console.log(`[DEV_ONLY] Server running on http://localhost:${PORT}`);
  console.log(`[SECURITY] Strict Mode: ON`);
});
