// server/bybitClient.js
import axios from "axios";
import crypto from "crypto";

const BASE_URL_TESTNET = "https://api-testnet.bybit.com";
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

// Ořezání qty na rozumné limity pro testnet
function normalizeQty(symbol, qtyInput) {
  let q = Number(qtyInput);

  if (!Number.isFinite(q) || q <= 0) {
    throw new Error(`Invalid qty value: ${qtyInput}`);
  }

  let min = 0.001;
  let max = 1000;

  if (symbol === "BTCUSDT") {
    min = 0.001;
    max = 0.1;
  } else if (symbol === "ETHUSDT") {
    min = 0.01;
    max = 5;
  } else if (symbol === "ADAUSDT") {
    min = 1;
    max = 900;
  } else if (symbol === "SOLUSDT") {
    min = 0.1;
    max = 500;
  }

  if (q < min) q = min;
  if (q > max) q = max;

  q = Number(q.toFixed(3));
  return q.toString();
}

export async function getServerTime(useTestnet = true) {
  const url = `${resolveBase(useTestnet)}/v5/market/time`;
  const res = await axios.get(url);
  return res.data;
}

function buildSignedGet(pathWithQuery, creds, useTestnet) {
  ensureConfigured(creds);
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const payload = timestamp + creds.apiKey + recvWindow + pathWithQuery.split("?")[1];
  const signature = sign(payload, creds.apiSecret);
  return axios.get(`${resolveBase(useTestnet)}${pathWithQuery}`, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
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
export async function createDemoOrder(order, creds, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";

  const safeQty = normalizeQty(order.symbol, order.qty);

  // === 1) CREATE ORDER ===
  const orderBody = {
    category: order.category || "linear",
    symbol: order.symbol,
    side: order.side, // "Buy" | "Sell"
    orderType: order.orderType || "Market", 
    qty: safeQty,
    price: order.price ? String(order.price) : "",
    timeInForce: order.timeInForce || "IOC",
    reduceOnly: order.reduceOnly ?? false,
    orderLinkId: order.orderLinkId || undefined,
  };

  const orderPayload =
    timestamp + creds.apiKey + recvWindow + JSON.stringify(orderBody);
  const orderSign = sign(orderPayload, creds.apiSecret);

  const orderRes = await axios.post(`${resolveBase(useTestnet)}/v5/order/create`, orderBody, {
    headers: {
      "X-BAPI-API-KEY": creds.apiKey,
      "X-BAPI-SIGN": orderSign,
      "X-BAPI-SIGN-TYPE": "2",
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "Content-Type": "application/json",
    },
  });

  console.log("Bybit create order response:", orderRes.data);

  const result = orderRes.data;

  // Pokud order selhal, nepokračujeme do trading-stop
  if (result.retCode !== 0) {
    return result;
  }

  // Pokud TP/SL/TS nejsou zadány → končíme
  const hasStops =
    order.sl != null || order.tp != null || order.trailingStop != null;
  if (!hasStops) {
    return result;
  }

  // === 2) SET TRADING STOP (TP/SL/TS) ===
  try {
    const tsTimestamp = Date.now().toString();

    // Bybit v5 /position/trading-stop:
    // one-way režim → positionIdx MUSÍ být 0
    const tsBody = {
      category: "linear",
      symbol: order.symbol,
      positionIdx: 0, // fix: žádné 1/2, jen 0 pro one-way
    };

    if (order.tp != null) {
      tsBody.takeProfit = String(order.tp);
      tsBody.tpTriggerBy = "LastPrice";
    }

    if (order.sl != null) {
      tsBody.stopLoss = String(order.sl);
      tsBody.slTriggerBy = "LastPrice";
    }

    if (order.trailingStop != null) {
      tsBody.trailingStop = String(order.trailingStop);
    }

    const tsPayload =
      tsTimestamp + creds.apiKey + recvWindow + JSON.stringify(tsBody);
    const tsSign = sign(tsPayload, creds.apiSecret);

    const tsRes = await axios.post(
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
    );

    console.log("Bybit SL/TP/TS response:", tsRes.data);
    result.tradingStop = tsRes.data;
  } catch (err) {
    console.error(
      "Bybit SL/TP/TS error:",
      err.response?.data || err.message || err
    );
  }

  return result;
}

export async function setTradingStop(protection, creds, useTestnet = true) {
  ensureConfigured(creds);

  const tsTimestamp = Date.now().toString();
  const recvWindow = "5000";

  const tsBody = {
    category: "linear",
    symbol: protection.symbol,
    positionIdx: protection.positionIdx ?? 0,
  };

  if (protection.tp != null) {
    tsBody.takeProfit = String(protection.tp);
    tsBody.tpTriggerBy = protection.tpTriggerBy || "LastPrice";
  }

  if (protection.sl != null) {
    tsBody.stopLoss = String(protection.sl);
    tsBody.slTriggerBy = protection.slTriggerBy || "LastPrice";
  }

  if (protection.trailingStop != null) {
    tsBody.trailingStop = String(protection.trailingStop);
  }

  const tsPayload =
    tsTimestamp + creds.apiKey + recvWindow + JSON.stringify(tsBody);
  const tsSign = sign(tsPayload, creds.apiSecret);

  const tsRes = await axios.post(
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
  );

  return tsRes.data;
}

export async function getDemoPositions(creds, useTestnet = true) {
  ensureConfigured(creds);

  const query = "category=linear&accountType=UNIFIED&settleCoin=USDT";
  const res = await buildSignedGet(`/v5/position/list?${query}`, creds, useTestnet);

  return res.data;
}

export async function listDemoOrders(creds, { limit = 50 } = {}, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=linear&limit=${limit}`;

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

export async function listExecutions(creds, { limit = 50, cursor } = {}, useTestnet = true) {
  ensureConfigured(creds);
  const q = new URLSearchParams({
    category: "linear",
    limit: String(limit),
  });
  if (cursor) q.set("cursor", cursor);
  const res = await buildSignedGet(`/v5/execution/list?${q.toString()}`, creds, useTestnet);
  return res.data;
}

export async function listClosedPnl(creds, { limit = 50, cursor } = {}, useTestnet = true) {
  ensureConfigured(creds);
  const q = new URLSearchParams({
    category: "linear",
    settleCoin: "USDT",
    limit: String(limit),
  });
  if (cursor) q.set("cursor", cursor);
  const res = await buildSignedGet(`/v5/position/closed-pnl?${q.toString()}`, creds, useTestnet);
  return res.data;
}

export async function getWalletBalance(creds, useTestnet = true) {
  ensureConfigured(creds);
  const q = "accountType=UNIFIED&coin=USDT";
  const res = await buildSignedGet(`/v5/account/wallet-balance?${q}`, creds, useTestnet);
  return res.data;
}

export async function listDemoOpenOrders(creds, { limit = 50 } = {}, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=linear&openOnly=1&limit=${limit}`;

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
