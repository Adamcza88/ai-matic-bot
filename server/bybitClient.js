// server/bybitClient.js
import axios from "axios";
import crypto from "crypto";

const BASE_URL_TESTNET = "https://api-demo.bybit.com";
const BASE_URL_MAINNET = "https://api.bybit.com";

function resolveBase(useTestnet = true) {
  return useTestnet ? BASE_URL_TESTNET : BASE_URL_MAINNET;
}

function ensureConfigured(creds) {
  if (!creds?.apiKey || !creds?.apiSecret) {
    throw new Error("Missing Bybit API credentials for user");
  }
}

function sign(payload, apiSecret) {
  return crypto.createHmac("sha256", apiSecret).update(payload).digest("hex");
}

// Statická definice limitů pro hlavní páry (fallback pro Mainnet)
import { metric } from "./metrics.js";

import { getInstrumentInfo } from "./instrumentCache.js";
import { withRetry } from "./httpRetry.js";

async function normalizeQty(symbol, qtyInput, priceInput = 0, useTestnet = true) {
  let q = Number(qtyInput);

  if (!Number.isFinite(q) || q <= 0) {
    throw new Error(`Invalid qty value: ${qtyInput}`);
  }

  // Fetch real constraints from cache/API
  const limits = await getInstrumentInfo(symbol, useTestnet);

  // 1. Min Qty check
  if (q < limits.minQty) {
    q = limits.minQty;
  }

  // 2. Step Size rounding
  // Precision derived from stepSize (e.g. 0.001 -> 1000)
  const precision = Math.round(1 / limits.stepSize);
  q = Math.floor(q * precision) / precision;

  // 2b. Max Qty cap
  if (Number.isFinite(limits.maxQty) && limits.maxQty > 0 && q > limits.maxQty) {
    q = limits.maxQty;
    q = Math.floor(q * precision) / precision;
  }

  // 3. Min Notional check
  if (priceInput > 0) {
    const notional = q * priceInput;
    if (notional < limits.minNotional) {
      const reqQty = limits.minNotional / priceInput;
      const bumpedQty = Math.ceil(reqQty * precision) / precision;
      q = Math.max(q, bumpedQty);
    }
  }

  // Ensure strict safety cap from legacy code
  if (q > 100000) q = 100000;

  // Formatting
  const decimals = (limits.stepSize.toString().split(".")[1] || "").length;
  return q.toFixed(decimals);
}

const lastLeverageBySymbol = new Map();
const LEVERAGE_BY_SYMBOL = {
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
const leverageSyncCooldownMs = 60_000;

export async function getServerTime(useTestnet = true) {
  const url = `${resolveBase(useTestnet)}/v5/market/time`;
  const res = await axios.get(url);
  return res.data;
}

function buildSignedGet(pathWithQuery, creds, useTestnet) {
  ensureConfigured(creds);
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  // GET requests payload is query string (without '?')
  const query = pathWithQuery.split("?")[1] || "";
  const payload = timestamp + creds.apiKey + recvWindow + query;

  const signature = sign(payload, creds.apiSecret);

  return axios.get(`${resolveBase(useTestnet)}${pathWithQuery}`, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "Content-Type": "application/json"
    },
  });
}

/**
 * Vytvoří market order na testnetu + volitelně nastaví TP/SL/TS
 *
 * params:
 * {
 *   symbol: "ADAUSDT",
 *   side: "Buy" | "Sell",
 *   qty: number | string,
 *   price?: number,
 *   sl?: number,
 *   tp?: number,
 *   trailingStop?: number   // v USDT, ne v %
 * }
 */
// Pomocná funkce pro odstranění prázdných hodnot (undefined, null, "")
// Mainnet je striktní a nesnáší prázdné stringy u numerických polí (např. price u Market orderu)
export function cleanObject(obj) {
  return Object.entries(obj).reduce((acc, [key, val]) => {
    if (val !== undefined && val !== null && val !== "") {
      acc[key] = val;
    }
    return acc;
  }, {});
}

export function validatePayload(payload) {
  const REQUIRED = ["category", "symbol", "side", "orderType", "qty"];
  const missing = REQUIRED.filter((k) => !payload[k]);
  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }
  if (payload.category !== "linear") {
    throw new Error(`Invalid category: ${payload.category}. Must be 'linear'.`);
  }
}

export function signOnly(payload, creds) {
  ensureConfigured(creds);
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const bodyStr = JSON.stringify(cleanObject(payload));
  const signPayload = timestamp + creds.apiKey + recvWindow + bodyStr;
  const signature = sign(signPayload, creds.apiSecret);

  return {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
    },
    body: bodyStr
  };
}

export async function setLeverage({ symbol, leverage, buyLeverage, sellLeverage }, creds, useTestnet = true) {
  ensureConfigured(creds);
  if (!symbol) {
    throw new Error("Missing symbol for leverage");
  }
  const lev = Number(leverage);
  const buyLev = Number.isFinite(Number(buyLeverage)) ? Number(buyLeverage) : lev;
  const sellLev = Number.isFinite(Number(sellLeverage)) ? Number(sellLeverage) : lev;
  if (!Number.isFinite(buyLev) || !Number.isFinite(sellLev)) {
    throw new Error("Invalid leverage value");
  }
  const rawBody = {
    category: "linear",
    symbol,
    buyLeverage: String(buyLev),
    sellLeverage: String(sellLev),
  };
  const body = cleanObject(rawBody);
  const ts = Date.now().toString();
  const recvWindow = "5000";
  const bodyStr = JSON.stringify(body);
  const payload = ts + creds.apiKey + recvWindow + bodyStr;
  const signature = sign(payload, creds.apiSecret);
  const res = await withRetry(() => axios.post(`${resolveBase(useTestnet)}/v5/position/set-leverage`, body, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "Content-Type": "application/json",
    },
  }));
  return res.data;
}

async function fetchPositionList(creds, useTestnet, symbol) {
  const params = new URLSearchParams({
    category: "linear",
    accountType: "UNIFIED",
    settleCoin: "USDT",
  });
  if (symbol) params.set("symbol", symbol);
  const res = await buildSignedGet(`/v5/position/list?${params.toString()}`, creds, useTestnet);
  return res?.data?.result?.list ?? [];
}

async function resolvePositionIdxForOrder(order, creds, useTestnet) {
  const symbol = String(order?.symbol ?? "");
  if (!symbol) return undefined;
  const side = String(order?.side ?? "").toLowerCase();
  const reduceOnly = Boolean(order?.reduceOnly);

  let list = await fetchPositionList(creds, useTestnet, symbol);
  if (!Array.isArray(list) || list.length === 0) {
    const fallback = await fetchPositionList(creds, useTestnet);
    list = Array.isArray(fallback) ? fallback : [];
  }

  const toIdx = (value) => {
    const idx = Number(value);
    return Number.isFinite(idx) ? idx : undefined;
  };

  const match = list.find((p) => {
    if (String(p?.symbol ?? "") !== symbol) return false;
    const pSide = String(p?.side ?? "").toLowerCase();
    if (reduceOnly) {
      if (Number(p?.size ?? 0) <= 0) return false;
      return pSide && pSide !== side;
    }
    return pSide === side;
  });
  const matchIdx = toIdx(match?.positionIdx);
  if (Number.isFinite(matchIdx)) return matchIdx;

  const hasHedge = list.some((p) => {
    const idx = Number(p?.positionIdx);
    return idx === 1 || idx === 2;
  });
  if (hasHedge) {
    if (reduceOnly) {
      if (side === "sell") return 1;
      if (side === "buy") return 2;
    } else {
      if (side === "buy") return 1;
      if (side === "sell") return 2;
    }
  }

  return list.length > 0 ? 0 : undefined;
}

async function resolvePositionIdxForSymbol(symbol, creds, useTestnet) {
  const sym = String(symbol ?? "");
  if (!sym) return undefined;
  let list = await fetchPositionList(creds, useTestnet, sym);
  if (!Array.isArray(list) || list.length === 0) {
    const fallback = await fetchPositionList(creds, useTestnet);
    list = Array.isArray(fallback) ? fallback : [];
  }

  const match = list.find((p) => {
    if (String(p?.symbol ?? "") !== sym) return false;
    return Number(p?.size ?? 0) > 0;
  });
  const idx = Number(match?.positionIdx);
  if (Number.isFinite(idx)) return idx;

  const hasHedge = list.some((p) => {
    const value = Number(p?.positionIdx);
    return value === 1 || value === 2;
  });
  return hasHedge ? undefined : list.length > 0 ? 0 : undefined;
}

export async function createDemoOrder(order, creds, useTestnet = true) {
  ensureConfigured(creds);

  // Attempt to estimate price for Min Notional check (timestamp decl removed)

  // Attempt to estimate price for Min Notional check
  const estimatedPrice = order.price ? Number(order.price) : 0;
  const safeQty = await normalizeQty(order.symbol, order.qty, estimatedPrice, useTestnet);

  const leverageKey = `${useTestnet ? "demo" : "mainnet"}:${order.symbol}`;
  const leverageRaw = Number(order.leverage);
  const requestedLeverage =
    Number.isFinite(leverageRaw) && leverageRaw > 0 ? leverageRaw : undefined;
  const desiredLeverage =
    requestedLeverage != null
      ? Math.max(1, Math.min(100, requestedLeverage))
      : undefined;
  if (Number.isFinite(desiredLeverage)) {
    try {
      const last = lastLeverageBySymbol.get(leverageKey);
      if (last !== desiredLeverage) {
        const res = await setLeverage(
          { symbol: order.symbol, leverage: desiredLeverage },
          creds,
          useTestnet
        );
        if (res?.retCode && res.retCode !== 0) {
          throw new Error(res?.retMsg || "set_leverage_failed");
        }
        lastLeverageBySymbol.set(leverageKey, desiredLeverage);
      }
    } catch (err) {
      const msg = err?.response?.data || err?.message || "Unknown leverage error";
      console.error("[Bybit] setLeverage failed:", msg);
      throw new Error(`set_leverage_failed:${msg}`);
    }
  }

  const resolvedPositionIdx = Number.isFinite(Number(order.positionIdx))
    ? Number(order.positionIdx)
    : await resolvePositionIdxForOrder(order, creds, useTestnet);

  // === 1) CREATE ORDER ===
  const rawBody = {
    category: "linear",
    symbol: order.symbol,
    side: order.side, // "Buy" | "Sell"
    orderType: order.orderType || "Market",
    qty: safeQty,
    price: order.price ? String(order.price) : undefined, // undefined will be cleaned
    triggerPrice: order.triggerPrice ? String(order.triggerPrice) : undefined,
    orderFilter: order.triggerPrice ? "StopOrder" : undefined,
    timeInForce: order.timeInForce || (order.orderType === "Limit" ? "GTC" : "IOC"),
    reduceOnly: order.reduceOnly ?? false,
    positionIdx: Number.isFinite(resolvedPositionIdx)
      ? resolvedPositionIdx
      : undefined,
    orderLinkId: order.orderLinkId || undefined,
  };

  // Add Atomic Protection (SL/TP) directly to order
  if (order.tp != null) {
    rawBody.takeProfit = String(order.tp);
    rawBody.tpTriggerBy = "LastPrice";
  }
  if (order.sl != null) {
    rawBody.stopLoss = String(order.sl);
    rawBody.slTriggerBy = "LastPrice";
  }

  // CLEAN THE BODY strictly before signing
  const orderBody = cleanObject(rawBody);

  // FIX 4: Bybit v5 Signature Strictness
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const bodyStr = JSON.stringify(orderBody);

  const orderPayload = timestamp + creds.apiKey + recvWindow + bodyStr;
  const orderSign = sign(orderPayload, creds.apiSecret);

  // === MANDATORY LOG: PRE-FLIGHT ===
  const logContext = {
    env: useTestnet ? "testnet" : "mainnet",
    endpoint: "/v5/order/create",
    payload: orderBody,
    response: null,
    error: null
  };

  // FIX 9: Mandatory Audit Log
  if (!useTestnet) {
    console.error(`[BYBIT MAINNET] Request:`, JSON.stringify({ endpoint: logContext.endpoint, payload: logContext.payload }, null, 2));
  }

  let result;

  try {
    const orderRes = await withRetry(() => axios.post(`${resolveBase(useTestnet)}/v5/order/create`, orderBody, {
      headers: {
        "X-BAPI-API-KEY": creds.apiKey,
        "X-BAPI-SIGN": orderSign,
        "X-BAPI-SIGN-TYPE": "2",
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json", // FIX 4: Mandatory Header
      },
    }));

    logContext.response = orderRes.data;

    // FIX 9: Mandatory Audit Log (Response)
    if (!useTestnet) {
      console.error(`[BYBIT MAINNET] Response:`, JSON.stringify({ endpoint: logContext.endpoint, response: logContext.response }, null, 2));
    } else {
      console.log(JSON.stringify(logContext, null, 2));
    }

    result = orderRes.data;

    metric("order_success", { env: logContext.env, symbol: order.symbol });
  } catch (error) {
    metric("order_failure", { env: logContext.env, symbol: order.symbol, error: error.message });
    logContext.error = error.message || String(error);
    if (error.response) {
      logContext.response = error.response.data;
    }

    // FIX 9: Mandatory Audit Log (Error)
    const logTag = useTestnet ? "[BYBIT DEMO]" : "[BYBIT MAINNET]";
    console.error(`${logTag} ERROR:`, JSON.stringify(logContext, null, 2));

    throw error;
  }

  // === 2) SET TRAILING STOP ONLY (Post-Order) ===
  // Trailing stop is a position-level setting: apply only after the position exists.
  if (order.trailingStop != null) {
    try {
      const posRes = await getDemoPositions(creds, useTestnet);
      const list = posRes?.result?.list || [];
      const hasPosition = list.some(
        (p) => String(p?.symbol ?? "") === String(order.symbol) && Number(p?.size ?? 0) > 0
      );

      if (!hasPosition) {
        console.log(
          `[createDemoOrder] Trailing stop deferred (no active position yet) for ${order.symbol}.`
        );
      } else {
        let trailingPositionIdx = Number.isFinite(resolvedPositionIdx)
          ? resolvedPositionIdx
          : undefined;
        if (!Number.isFinite(trailingPositionIdx)) {
          const sideMatch = String(order.side ?? "").toLowerCase();
          const match = list.find((p) => {
            if (String(p?.symbol ?? "") !== String(order.symbol)) return false;
            const size = Number(p?.size ?? 0);
            if (!Number.isFinite(size) || size <= 0) return false;
            const posSide = String(p?.side ?? "").toLowerCase();
            return sideMatch ? posSide === sideMatch : true;
          });
          const idx = Number(match?.positionIdx);
          if (Number.isFinite(idx)) trailingPositionIdx = idx;
        }
        const tsResult = await setTradingStop(
          {
            symbol: order.symbol,
            trailingStop: order.trailingStop,
            activePrice: order.trailingActivePrice,
            positionIdx: trailingPositionIdx,
          },
          creds,
          useTestnet
        );

        console.log("Bybit TS response:", tsResult);
        result.trailingStop = tsResult;
      }
    } catch (err) {
      console.error("Bybit TrailingStop error:", err.response?.data || err.message);
      // Don't fail the whole order if TS fails, but log strictly
      result.trailingStopError = err.message;
    }
  }

  return result;
}

export async function setTradingStop(protection, creds, useTestnet = true) {
  ensureConfigured(creds);

  const resolvedPositionIdx = Number.isFinite(Number(protection.positionIdx))
    ? Number(protection.positionIdx)
    : await resolvePositionIdxForSymbol(protection.symbol, creds, useTestnet);
  if (!Number.isFinite(resolvedPositionIdx)) {
    throw new Error("position_idx_unresolved");
  }

  const rawTsBody = {
    category: "linear",
    symbol: protection.symbol,
    positionIdx: resolvedPositionIdx,
    tpslMode: protection.tpslMode ?? "Full",
  };

  if (protection.tp != null) {
    rawTsBody.takeProfit = String(protection.tp);
    rawTsBody.tpTriggerBy = protection.tpTriggerBy || "LastPrice";
  }

  if (protection.sl != null) {
    rawTsBody.stopLoss = String(protection.sl);
    rawTsBody.slTriggerBy = protection.slTriggerBy || "LastPrice";
  }

  if (protection.trailingStop != null) {
    rawTsBody.trailingStop = String(protection.trailingStop);
  }

  if (protection.activePrice != null) {
    rawTsBody.activePrice = String(protection.activePrice);
  }

  const tsBody = cleanObject(rawTsBody);

  // FIX 4: Bybit v5 Signature Strictness
  const tsTimestamp = Date.now().toString(); // must be fresh
  const recvWindow = "5000";
  const bodyStr = JSON.stringify(tsBody);

  const tsPayload = tsTimestamp + creds.apiKey + recvWindow + bodyStr;
  const tsSign = sign(tsPayload, creds.apiSecret);

  const tsRes = await withRetry(() => axios.post(
    `${resolveBase(useTestnet)}/v5/position/trading-stop`,
    tsBody,
    {
      headers: {
        "X-BAPI-API-KEY": creds.apiKey,
        "X-BAPI-SIGN": tsSign,
        "X-BAPI-SIGN-TYPE": "2",
        "X-BAPI-TIMESTAMP": tsTimestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json",
      },
    }
  ));

  // FIX 9: Mandatory Audit Log
  const tsLogContext = {
    endpoint: "/v5/position/trading-stop",
    payload: tsBody,
    response: tsRes.data
  };

  if (!useTestnet) {
    console.error(`[BYBIT MAINNET] TS Update:`, JSON.stringify(tsLogContext, null, 2));
  } else {
    console.log(`[BYBIT DEMO] TS Update:`, JSON.stringify(tsLogContext, null, 2));
  }

  return tsRes.data;
}

export async function getDemoPositions(creds, useTestnet = true) {
  ensureConfigured(creds);

  const query = "category=linear&accountType=UNIFIED&settleCoin=USDT";
  const res = await buildSignedGet(`/v5/position/list?${query}`, creds, useTestnet);
  const data = res.data;
  const list = data?.result?.list || [];
  const now = Date.now();

  for (const pos of list) {
    const symbol = String(pos?.symbol ?? "");
    if (!symbol || !Object.prototype.hasOwnProperty.call(LEVERAGE_BY_SYMBOL, symbol)) {
      continue;
    }
    const size = Number(pos?.size ?? 0);
    if (!Number.isFinite(size) || Math.abs(size) <= 0) continue;
    const currentLev = Number(
      pos?.leverage ?? pos?.buyLeverage ?? pos?.sellLeverage ?? NaN
    );
    const targetLev = LEVERAGE_BY_SYMBOL[symbol] ?? 1;
    const lastSync = lastLeverageBySymbol.get(`${useTestnet ? "demo" : "mainnet"}:${symbol}:sync`) ?? 0;
    if (now - lastSync < leverageSyncCooldownMs) continue;
    if (Number.isFinite(currentLev) && Number.isFinite(targetLev) && currentLev === targetLev) {
      continue;
    }
    try {
      const resLev = await setLeverage(
        { symbol, leverage: targetLev },
        creds,
        useTestnet
      );
      if (resLev?.retCode && resLev.retCode !== 0) {
        throw new Error(resLev?.retMsg || "set_leverage_failed");
      }
      lastLeverageBySymbol.set(
        `${useTestnet ? "demo" : "mainnet"}:${symbol}:sync`,
        now
      );
      lastLeverageBySymbol.set(
        `${useTestnet ? "demo" : "mainnet"}:${symbol}`,
        targetLev
      );
    } catch (err) {
      const msg = err?.response?.data || err?.message || "Unknown leverage error";
      console.error("[Bybit] leverage sync failed:", symbol, msg);
    }
  }

  return data;
}

/**
 * FIX 7: Wait for Position (Latency Guard)
 * Polls for position existence before allowing Trailing Stop set.
 */
export async function waitForPosition(creds, symbol, useTestnet = true, timeoutMs = 3000) {
  const start = Date.now();
  console.log(`[waitForPosition] Polling for ${symbol} position...`);

  while (Date.now() - start < timeoutMs) {
    try {
      const data = await getDemoPositions(creds, useTestnet);
      // Bybit returns { retCode: 0, result: { list: [...] } }
      // We check if any position for this symbol exists and has size > 0
      const list = data?.result?.list || [];
      const pos = list.find(p => p.symbol === symbol && Number(p.size) > 0);

      if (pos) {
        console.log(`[waitForPosition] Position found: ${pos.symbol} size=${pos.size}`);
        return true;
      }
    } catch (err) {
      console.warn(`[waitForPosition] Poll error: ${err.message}`);
    }
    // Wait 500ms before next poll
    await new Promise(r => setTimeout(r, 500));
  }

  throw new Error(`Timeout waiting for position ${symbol} after ${timeoutMs}ms`);
}

export async function listDemoOrders(creds, { limit = 50, symbol, settleCoin = "USDT" } = {}, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const params = new URLSearchParams({
    category: "linear",
    limit: String(limit),
  });
  if (symbol) {
    params.set("symbol", symbol);
  } else if (settleCoin) {
    params.set("settleCoin", settleCoin);
  }
  const query = params.toString();

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${resolveBase(useTestnet)}/v5/order/realtime?${query}`, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
    },
  });

  return res.data;
}

export async function listOrderHistory(creds, { limit = 50, symbol, settleCoin = "USDT" } = {}, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const params = new URLSearchParams({
    category: "linear",
    limit: String(limit),
  });
  if (symbol) {
    params.set("symbol", symbol);
  } else if (settleCoin) {
    params.set("settleCoin", settleCoin);
  }
  const query = params.toString();

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${resolveBase(useTestnet)}/v5/order/history?${query}`, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
    },
  });

  return res.data;
}

export async function listExecutions(
  creds,
  { limit = 50, cursor, symbol, settleCoin = "USDT" } = {},
  useTestnet = true
) {
  ensureConfigured(creds);
  const q = new URLSearchParams({
    category: "linear",
    limit: String(limit),
  });
  if (symbol) {
    q.set("symbol", symbol);
  } else if (settleCoin) {
    q.set("settleCoin", settleCoin);
  }
  if (cursor) q.set("cursor", cursor);
  const res = await buildSignedGet(`/v5/execution/list?${q.toString()}`, creds, useTestnet);
  return res.data;
}

export async function listClosedPnl(creds, { limit = 50, cursor, startTime, endTime } = {}, useTestnet = true) {
  ensureConfigured(creds);
  const q = new URLSearchParams({
    category: "linear",
    settleCoin: "USDT",
    limit: String(limit),
  });
  if (cursor) q.set("cursor", cursor);
  if (startTime != null && String(startTime).length > 0) q.set("startTime", String(startTime));
  if (endTime != null && String(endTime).length > 0) q.set("endTime", String(endTime));
  const res = await buildSignedGet(`/v5/position/closed-pnl?${q.toString()}`, creds, useTestnet);
  return res.data;
}

export async function getWalletBalance(creds, useTestnet = true) {
  ensureConfigured(creds);
  const q = new URLSearchParams({ accountType: "UNIFIED" });
  const res = await buildSignedGet(`/v5/account/wallet-balance?${q.toString()}`, creds, useTestnet);
  return res.data;
}

export async function listDemoOpenOrders(creds, { limit = 50 } = {}, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=linear&openOnly=1&limit=${limit}&settleCoin=USDT`;

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${resolveBase(useTestnet)}/v5/order/realtime?${query}`, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
    },
  });

  return res.data;
}

export async function listDemoTrades(creds, { limit = 50 } = {}, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=linear&limit=${limit}`;

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${resolveBase(useTestnet)}/v5/execution/list?${query}`, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
    },
  });

  return res.data;
}

export async function cancelOrder(
  { symbol, orderId, orderLinkId },
  creds,
  useTestnet = true
) {
  ensureConfigured(creds);

  if (!symbol) throw new Error("cancelOrder: missing symbol");
  if (!orderId && !orderLinkId) throw new Error("cancelOrder: missing orderId/orderLinkId");

  const rawBody = {
    category: "linear",
    symbol,
    orderId: orderId || undefined,
    orderLinkId: orderLinkId || undefined,
  };
  const body = cleanObject(rawBody);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const bodyStr = JSON.stringify(body);
  const payload = timestamp + creds.apiKey + recvWindow + bodyStr;
  const signature = sign(payload, creds.apiSecret);

  const res = await withRetry(() =>
    axios.post(`${resolveBase(useTestnet)}/v5/order/cancel`, body, {
      headers: {
        "X-BAPI-API-KEY": creds.apiKey,
        "X-BAPI-SIGN": signature,
        "X-BAPI-SIGN-TYPE": "2",
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": recvWindow,
        "Content-Type": "application/json",
      },
    })
  );

  const logTag = useTestnet ? "[BYBIT DEMO]" : "[BYBIT MAINNET]";
  console.error(`${logTag} Cancel:`, JSON.stringify({ payload: body, response: res.data }, null, 2));

  return res.data;
}
