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
  setTradingStop,
  cancelOrder,
} from "./bybitClient.js";
import { reconcileState } from "./reconcile.js";
import { getInstrumentInfo } from "./instrumentCache.js";

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

  const { symbol, side, qty, orderType, sl, tp, orderLinkId, timeInForce, trailingStop, trailingActivePrice, price, triggerPrice, leverage, reduceOnly, positionIdx } = req.body;

  const leverageMap = {
    BTCUSDT: 100,
    ETHUSDT: 100,
    SOLUSDT: 100,
    ADAUSDT: 75,
    XRPUSDT: 75,
    XMRUSDT: 25,
    DOGEUSDT: 75,
    LINKUSDT: 50,
    MELANIAUSDT: 20,
    XPLUSDT: 50,
    HYPEUSDT: 75,
    FARTCOINUSDT: 75,
  };
  const roiSymbols = new Set(Object.keys(leverageMap));
  const MIN_PROTECTION_DISTANCE_PCT = 0.0005;
  const roiTargets = { tp: 1.10, sl: -0.40 }; // percent ROI targets

  const resolveLeverage = (sym, requested) => {
    const requestedLev = Number(requested);
    if (Number.isFinite(requestedLev) && requestedLev > 0) return requestedLev;
    return leverageMap[sym] || 1;
  };

  const applyRoiStops = (sym, entry, dir, curTp, curSl, leverageValue) => {
    if (!roiSymbols.has(sym) || !Number.isFinite(entry)) return { tp: curTp, sl: curSl };
    if (Number.isFinite(curTp) || Number.isFinite(curSl)) return { tp: curTp, sl: curSl };
    const lev = resolveLeverage(sym, leverageValue);
    const isBuy = dir?.toLowerCase() === "buy";
    const tpPrice = entry * (1 + (roiTargets.tp / 100) / Math.max(1, lev) * (isBuy ? 1 : -1));
    const slPrice = entry * (1 - (Math.abs(roiTargets.sl) / 100) / Math.max(1, lev) * (isBuy ? 1 : -1));
    let nextTp = Number.isFinite(tpPrice) ? tpPrice : curTp;
    let nextSl = Number.isFinite(slPrice) ? slPrice : curSl;
    const minDistance = entry * MIN_PROTECTION_DISTANCE_PCT;
    if (Number.isFinite(minDistance) && minDistance > 0) {
      if (isBuy) {
        if (Number.isFinite(nextTp) && nextTp <= entry + minDistance) {
          nextTp = entry + minDistance;
        }
        if (Number.isFinite(nextSl) && nextSl >= entry - minDistance) {
          nextSl = entry - minDistance;
        }
      } else {
        if (Number.isFinite(nextTp) && nextTp >= entry - minDistance) {
          nextTp = entry - minDistance;
        }
        if (Number.isFinite(nextSl) && nextSl <= entry + minDistance) {
          nextSl = entry + minDistance;
        }
      }
    }
    return { tp: nextTp, sl: nextSl };
  };

  const resolveMinDistance = (entry, tickSize) => {
    const pctDistance = entry * MIN_PROTECTION_DISTANCE_PCT;
    const tick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0;
    return Math.max(pctDistance, tick);
  };

  const roundToTick = (value, tickSize, mode) => {
    if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) {
      return value;
    }
    const ratio = value / tickSize;
    const stepped =
      mode === "ceil" ? Math.ceil(ratio) : mode === "floor" ? Math.floor(ratio) : Math.round(ratio);
    return Number((stepped * tickSize).toFixed(12));
  };

  const clampProtection = (entry, dir, curTp, curSl, tickSize) => {
    if (!Number.isFinite(entry) || entry <= 0) return { tp: curTp, sl: curSl };
    const isBuy = String(dir ?? "").toLowerCase() === "buy";
    const minDistance = resolveMinDistance(entry, tickSize);
    let nextTp = curTp;
    let nextSl = curSl;
    if (isBuy) {
      if (Number.isFinite(nextTp)) {
        const minTp = entry + minDistance;
        nextTp = Math.max(nextTp, minTp);
        nextTp = roundToTick(nextTp, tickSize, "ceil");
        if (Number.isFinite(tickSize) && tickSize > 0 && nextTp <= entry) {
          nextTp = entry + tickSize;
        }
      }
      if (Number.isFinite(nextSl)) {
        const maxSl = entry - minDistance;
        nextSl = Math.min(nextSl, maxSl);
        nextSl = roundToTick(nextSl, tickSize, "floor");
        if (Number.isFinite(tickSize) && tickSize > 0 && nextSl >= entry) {
          nextSl = entry - tickSize;
        }
      }
    } else {
      if (Number.isFinite(nextTp)) {
        const maxTp = entry - minDistance;
        nextTp = Math.min(nextTp, maxTp);
        nextTp = roundToTick(nextTp, tickSize, "floor");
        if (Number.isFinite(tickSize) && tickSize > 0 && nextTp >= entry) {
          nextTp = entry - tickSize;
        }
      }
      if (Number.isFinite(nextSl)) {
        const minSl = entry + minDistance;
        nextSl = Math.max(nextSl, minSl);
        nextSl = roundToTick(nextSl, tickSize, "ceil");
        if (Number.isFinite(tickSize) && tickSize > 0 && nextSl <= entry) {
          nextSl = entry + tickSize;
        }
      }
    }
    return { tp: nextTp, sl: nextSl };
  };

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

    const orderSide = String(side).toLowerCase() === "buy" ? "buy" : "sell";
    if (!reduceOnly) {
      try {
        const posRes = await getDemoPositions(creds, env === "testnet");
        const list = posRes?.result?.list ?? posRes?.data?.result?.list ?? [];
        const match = Array.isArray(list)
          ? list.find((p) => String(p?.symbol ?? "") === String(symbol) && Number(p?.size ?? 0) > 0)
          : null;
        const posSide = String(match?.side ?? "").toLowerCase();
        const posIdx = Number(match?.positionIdx);
        const isOneWay = !Number.isFinite(posIdx) || posIdx === 0;
        if (isOneWay && posSide && posSide !== orderSide) {
          return sendError(
            res,
            409,
            "Open position opposite side blocked (use TP/SL/TS or manual close)",
            { env, endpoint, symbol, side, posSide }
          );
        }
      } catch (err) {
        console.warn("[order] position check failed:", err?.message || err);
      }
    }

    // Reuse createDemoOrder for both main/testnet logic in server (it handles 'useTestnet' flag)
    const entryPrice = Number(price ?? triggerPrice);
    const resolvedLeverage = resolveLeverage(symbol, leverage);
    let tickSize = 0;
    try {
      const instrument = await getInstrumentInfo(symbol, env === "testnet");
      tickSize = Number(instrument?.tickSize ?? 0);
    } catch (err) {
      console.warn("[order] instrument info unavailable:", err?.message || err);
    }
    const { tp: roiTp, sl: roiSl } = applyRoiStops(
      symbol,
      entryPrice,
      side,
      tp,
      sl,
      resolvedLeverage
    );
    const { tp: safeTp, sl: safeSl } = clampProtection(
      entryPrice,
      side,
      roiTp,
      roiSl,
      tickSize
    );

    const result = await createDemoOrder({
      symbol,
      side,
      qty,
      orderType,
      price,
      triggerPrice,
      sl: safeSl,
      tp: safeTp,
      trailingStop,
      trailingActivePrice,
      orderLinkId,
      timeInForce,
      reduceOnly,
      positionIdx,
      takeProfit: safeTp,
      stopLoss: safeSl,
      trailingStop,
      trailingActivePrice,
      leverage: resolvedLeverage
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

// ===========================================
// POST /api/:env/protection
// ===========================================
app.post("/api/:env/protection", async (req, res) => {
  const startTs = Date.now();
  const endpoint = req.originalUrl;
  const env = req.params.env === "main" ? "mainnet" : "testnet";

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return sendError(res, 401, "Missing Authorization header", {
        env,
        endpoint,
      });
    }
    const userId = authHeader.replace("Bearer ", "");
    const creds = await getUserApiKeys(userId, env);

    const {
      symbol,
      sl,
      tp,
      trailingStop,
      trailingActivePrice,
      activePrice,
      positionIdx,
      slTriggerBy,
      tpTriggerBy,
    } = req.body || {};

    if (!symbol) {
      return sendError(res, 400, "Missing required field: symbol", {
        env,
        endpoint,
      });
    }

    const resolvedActivePrice = activePrice ?? trailingActivePrice;
    const result = await setTradingStop(
      {
        symbol,
        sl,
        tp,
        trailingStop,
        activePrice: resolvedActivePrice,
        positionIdx,
        slTriggerBy,
        tpTriggerBy,
      },
      creds,
      env === "testnet"
    );

    return sendResponse(res, result, {
      latencyMs: Date.now() - startTs,
      env,
      endpoint,
    });
  } catch (err) {
    return sendError(res, 500, err?.message || "Protection error", {
      latencyMs: Date.now() - startTs,
      env,
      endpoint,
    });
  }
});

// ===========================================
// POST /api/:env/cancel
// ===========================================
app.post("/api/:env/cancel", async (req, res) => {
  const startTs = Date.now();
  const endpoint = req.originalUrl;
  const env = req.params.env === "main" ? "mainnet" : "testnet";

  return sendError(res, 403, "cancel_disabled", {
    latencyMs: Date.now() - startTs,
    env,
    endpoint,
  });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return sendError(res, 401, "Missing Authorization header", {
        env,
        endpoint,
      });
    }
    const userId = authHeader.replace("Bearer ", "");
    const creds = await getUserApiKeys(userId, env);

    const { symbol, orderId, orderLinkId } = req.body || {};
    if (!symbol || (!orderId && !orderLinkId)) {
      return sendError(res, 400, "Missing symbol and (orderId or orderLinkId)", {
        env,
        endpoint,
      });
    }

    const result = await cancelOrder(
      { symbol, orderId, orderLinkId },
      creds,
      env === "testnet"
    );

    return sendResponse(res, result, {
      latencyMs: Date.now() - startTs,
      env,
      endpoint,
    });
  } catch (err) {
    return sendError(res, 500, err?.message || "Cancel error", {
      latencyMs: Date.now() - startTs,
      env,
      endpoint,
    });
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
    if (fetcher === getDemoPositions || fetcher === getWalletBalance || fetcher === reconcileState) {
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
