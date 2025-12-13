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

// Statická definice limitů pro hlavní páry (fallback pro Mainnet)
const SYMBOL_CONSTRAINTS = {
  BTCUSDT: { minQty: 0.001, stepSize: 0.001, minNotional: 5 },
  ETHUSDT: { minQty: 0.01, stepSize: 0.01, minNotional: 5 },
  SOLUSDT: { minQty: 0.1, stepSize: 0.1, minNotional: 5 },
  ADAUSDT: { minQty: 10, stepSize: 1, minNotional: 5 },
  MATICUSDT: { minQty: 10, stepSize: 1, minNotional: 5 },
  XRPUSDT: { minQty: 10, stepSize: 1, minNotional: 5 },
  LTCUSDT: { minQty: 0.1, stepSize: 0.1, minNotional: 5 },
  DOGEUSDT: { minQty: 100, stepSize: 10, minNotional: 5 }, // Conservative
};

function normalizeQty(symbol, qtyInput, priceInput = 0) {
  let q = Number(qtyInput);

  if (!Number.isFinite(q) || q <= 0) {
    throw new Error(`Invalid qty value: ${qtyInput}`);
  }

  // Fallback defaults if symbol unknown (conservative 2 decimals)
  const defaults = { minQty: 0.01, stepSize: 0.01, minNotional: 5 };
  const limits = SYMBOL_CONSTRAINTS[symbol] || defaults;

  // 1. Min Qty check
  if (q < limits.minQty) {
    // If input is less than min, we must either clamp up or fail.
    // Clamping up is safer for "ensure entry", but might exceed risk.
    // Here we clamp to minQty to prevent API rejection.
    q = limits.minQty;
  }

  // 2. Step Size rounding (floor to avoid exceeding risk/balance)
  // inverse of stepSize usually 1/step. e.g. 1/0.001 = 1000
  const precision = Math.round(1 / limits.stepSize);
  q = Math.floor(q * precision) / precision;

  // 3. Min Notional check
  // We only check this if we have a price > 0.
  // If price is 0 (e.g. unknown market price), we rely on MinQty being sufficient for typical prices.
  if (priceInput > 0) {
    const notional = q * priceInput;
    if (notional < limits.minNotional) {
      // Try to bump Qty to meet minNotional
      const reqQty = limits.minNotional / priceInput;
      // Re-normalize this new required qty
      const bumpedQty = Math.ceil(reqQty * precision) / precision;
      q = Math.max(q, bumpedQty);
    }
  }

  // Ensure strict safety cap from legacy code just in case
  if (q > 100000) q = 100000;

  // Formatting: remove scientific notation, use fixed precision based on step
  // count decimals in stepSize: 0.001 -> 3
  const decimals = (limits.stepSize.toString().split(".")[1] || "").length;
  return q.toFixed(decimals);
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
// Pomocná funkce pro odstranění prázdných hodnot (undefined, null, "")
// Mainnet je striktní a nesnáší prázdné stringy u numerických polí (např. price u Market orderu)
function cleanObject(obj) {
  return Object.entries(obj).reduce((acc, [key, val]) => {
    if (val !== undefined && val !== null && val !== "") {
      acc[key] = val;
    }
    return acc;
  }, {});
}

export async function createDemoOrder(order, creds, useTestnet = true) {
  ensureConfigured(creds);

  const timestamp = Date.now().toString();
  const recvWindow = "5000";

  // Attempt to estimate price for Min Notional check
  const estimatedPrice = order.price ? Number(order.price) : 0;
  const safeQty = normalizeQty(order.symbol, order.qty, estimatedPrice);

  // === 1) CREATE ORDER ===
  const rawBody = {
    category: "linear",
    symbol: order.symbol,
    side: order.side, // "Buy" | "Sell"
    orderType: order.orderType || "Market",
    qty: safeQty,
    price: order.price ? String(order.price) : undefined, // undefined will be cleaned
    timeInForce: order.timeInForce || "IOC",
    reduceOnly: order.reduceOnly ?? false,
    orderLinkId: order.orderLinkId || undefined,
  };

  // CLEAN THE BODY strictly before signing
  const orderBody = cleanObject(rawBody);

  const orderPayload =
    timestamp + creds.apiKey + recvWindow + JSON.stringify(orderBody);
  const orderSign = sign(orderPayload, creds.apiSecret);

  console.log(`[createDemoOrder] Sending to ${useTestnet ? "Testnet" : "Mainnet"}:`, JSON.stringify(orderBody));

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
    const rawTsBody = {
      category: "linear",
      symbol: order.symbol,
      positionIdx: 0, // fix: žádné 1/2, jen 0 pro one-way
    };

    if (order.tp != null) {
      rawTsBody.takeProfit = String(order.tp);
      rawTsBody.tpTriggerBy = "LastPrice";
    }

    if (order.sl != null) {
      rawTsBody.stopLoss = String(order.sl);
      rawTsBody.slTriggerBy = "LastPrice";
    }

    if (order.trailingStop != null) {
      rawTsBody.trailingStop = String(order.trailingStop);
    }

    const tsBody = cleanObject(rawTsBody);

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

  const rawTsBody = {
    category: "linear",
    symbol: protection.symbol,
    positionIdx: protection.positionIdx ?? 0,
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

  const tsBody = cleanObject(rawTsBody);

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
