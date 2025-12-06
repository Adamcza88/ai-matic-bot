// server/bybitClient.js
import axios from "axios";
import crypto from "crypto";

// Testnet base URL (pro reálný účet by se měnil jen baseUrl)
const BASE_URL = "https://api-testnet.bybit.com";

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

export async function getServerTime() {
  const url = `${BASE_URL}/v5/market/time`;
  const res = await axios.get(url);
  return res.data;
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
export async function createDemoOrder(order, creds) {
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
  };

  const orderPayload =
    timestamp + creds.apiKey + recvWindow + JSON.stringify(orderBody);
  const orderSign = sign(orderPayload, creds.apiSecret);

  const orderRes = await axios.post(`${BASE_URL}/v5/order/create`, orderBody, {
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
      `${BASE_URL}/v5/position/trading-stop`,
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

export async function getDemoPositions(creds) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = "category=linear";

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${BASE_URL}/v5/position/list?${query}`, {
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

export async function listDemoOrders(creds, { limit = 50 } = {}) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=linear&limit=${limit}`;

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${BASE_URL}/v5/order/realtime?${query}`, {
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

export async function listDemoOpenOrders(creds, { limit = 50 } = {}) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=linear&openOnly=1&limit=${limit}`;

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${BASE_URL}/v5/order/realtime?${query}`, {
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

export async function listDemoTrades(creds, { limit = 50 } = {}) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const query = `category=linear&limit=${limit}`;

  const payload = timestamp + creds.apiKey + recvWindow + query;
  const signature = sign(payload, creds.apiSecret);

  const res = await axios.get(`${BASE_URL}/v5/execution/list?${query}`, {
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
