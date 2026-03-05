import { WebsocketClient } from "bybit-api";
import {
  getDemoPositions,
  getWalletBalance,
  listClosedPnl,
  listDemoOrders,
  listExecutions,
} from "./bybitClient.js";
import { SUPPORTED_SYMBOLS, filterSupportedSymbols } from "../src/constants/symbols.js";
import { evaluateStrategyForSymbol } from "../src/engine/botEngine.js";
import { evaluateAiMaticXStrategyForSymbol } from "../src/engine/aiMaticXStrategy.js";
import { evaluateAiMaticAmdStrategyForSymbol } from "../src/engine/aiMaticAmdStrategy.js";
import { evaluateAiMaticOliKellaStrategyForSymbol } from "../src/engine/aiMaticOliKellaStrategy.js";

const FAST_POLL_MS = 5_000;
const SLOW_POLL_MS = 15_000;
const STALE_SESSION_TTL_MS = 15 * 60_000;
const REST_URL_MAINNET = "https://api.bybit.com";
const REST_URL_TESTNET = "https://api-demo.bybit.com";

const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function extractList(data) {
  return data?.result?.list ?? data?.list ?? [];
}

function toErrorMessage(reason) {
  if (reason?.response?.data?.retMsg) return String(reason.response.data.retMsg);
  if (reason?.response?.data?.message) return String(reason.response.data.message);
  if (reason?.message) return String(reason.message);
  return String(reason ?? "unknown_error");
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 200);
}

function normalizeScope(value) {
  const raw = String(value ?? "full").toLowerCase();
  if (raw === "fast" || raw === "slow" || raw === "full") return raw;
  return "full";
}

function normalizeRiskMode(value) {
  const raw = String(value ?? "ai-matic").toLowerCase();
  const allowed = new Set([
    "ai-matic",
    "ai-matic-x",
    "ai-matic-amd",
    "ai-matic-olikella",
    "ai-matic-tree",
    "ai-matic-pro",
  ]);
  return allowed.has(raw) ? raw : "ai-matic";
}

function normalizeSymbols(value) {
  if (Array.isArray(value)) return filterSupportedSymbols(value);
  if (typeof value === "string" && value.trim()) {
    return filterSupportedSymbols(
      value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    );
  }
  return [...SUPPORTED_SYMBOLS];
}

function normalizeWsKline(row) {
  if (!row || typeof row !== "object") return null;
  if (Array.isArray(row)) {
    if (row.length < 6) return null;
    const openTime = Number(row[0]);
    const open = Number(row[1]);
    const high = Number(row[2]);
    const low = Number(row[3]);
    const close = Number(row[4]);
    const volume = Number(row[5]);
    if (![openTime, open, high, low, close].every(Number.isFinite)) return null;
    return { openTime, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
  }
  const openTime = Number(row.start ?? row.startTime ?? row.ts);
  const open = Number(row.open);
  const high = Number(row.high);
  const low = Number(row.low);
  const close = Number(row.close);
  const volume = Number(row.volume);
  if (![openTime, open, high, low, close].every(Number.isFinite)) return null;
  return { openTime, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 };
}

function mergeCandles(existing, incoming, maxCandles) {
  const merged = new Map();
  for (const candle of existing) {
    if (!Number.isFinite(candle?.openTime)) continue;
    merged.set(candle.openTime, candle);
  }
  for (const candle of incoming) {
    if (!Number.isFinite(candle?.openTime)) continue;
    merged.set(candle.openTime, candle);
  }
  const sorted = Array.from(merged.values()).sort((a, b) => a.openTime - b.openTime);
  if (sorted.length <= maxCandles) return sorted;
  return sorted.slice(-maxCandles);
}

function selectDecisionFn(riskMode) {
  if (riskMode === "ai-matic-x") return evaluateAiMaticXStrategyForSymbol;
  if (riskMode === "ai-matic-amd") return evaluateAiMaticAmdStrategyForSymbol;
  if (riskMode === "ai-matic-olikella") return evaluateAiMaticOliKellaStrategyForSymbol;
  return evaluateStrategyForSymbol;
}

function buildProtectionSnapshot(positionsData, ordersData) {
  const positions = extractList(positionsData)
    .map((p) => {
      const size = Number(p?.size ?? p?.qty ?? 0);
      if (!Number.isFinite(size) || size <= 0) return null;
      const symbol = String(p?.symbol ?? "").toUpperCase();
      if (!symbol) return null;
      const side = String(p?.side ?? "");
      const positionIdxRaw = Number(p?.positionIdx);
      return {
        symbol,
        side,
        positionIdx: Number.isFinite(positionIdxRaw) ? positionIdxRaw : undefined,
        sl: Number(p?.stopLoss ?? p?.sl ?? NaN),
        tp: Number(p?.takeProfit ?? p?.tp ?? NaN),
        trailingStop: Number(p?.trailingStop ?? NaN),
        trailingActivePrice: Number(
          p?.trailingActivePrice ?? p?.activePrice ?? p?.activationPrice ?? NaN
        ),
      };
    })
    .filter(Boolean);

  const orders = extractList(ordersData)
    .filter((o) => {
      const orderFilter = String(o?.orderFilter ?? "").toLowerCase();
      const stopType = String(o?.stopOrderType ?? "").toLowerCase();
      const hasProtectionPrice =
        Number.isFinite(Number(o?.triggerPrice ?? NaN)) ||
        Number.isFinite(Number(o?.stopLoss ?? NaN)) ||
        Number.isFinite(Number(o?.takeProfit ?? NaN));
      return (
        orderFilter.includes("tpsl") ||
        stopType === "takeprofit" ||
        stopType === "stoploss" ||
        stopType === "trailingstop" ||
        hasProtectionPrice
      );
    })
    .map((o) => ({
      symbol: String(o?.symbol ?? "").toUpperCase(),
      side: String(o?.side ?? ""),
      orderId: String(o?.orderId ?? o?.orderID ?? ""),
      orderLinkId: String(o?.orderLinkId ?? ""),
      orderType: String(o?.orderType ?? ""),
      stopOrderType: String(o?.stopOrderType ?? ""),
      orderFilter: String(o?.orderFilter ?? ""),
      triggerPrice: Number(o?.triggerPrice ?? NaN),
      stopLoss: Number(o?.stopLoss ?? NaN),
      takeProfit: Number(o?.takeProfit ?? NaN),
      qty: Number(o?.qty ?? o?.orderQty ?? NaN),
      price: Number(o?.price ?? NaN),
    }));

  return { positions, orders };
}

async function fetchBackfillCandles({ symbol, timeframe, useTestnet, limit = 500 }) {
  const base = useTestnet ? REST_URL_TESTNET : REST_URL_MAINNET;
  const url = `${base}/v5/market/kline?category=linear&symbol=${symbol}&interval=${timeframe}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`backfill_failed:${res.status}`);
  const json = await res.json();
  const list = json?.result?.list ?? [];
  if (!Array.isArray(list)) return [];
  const parsed = list
    .map((row) => normalizeWsKline(row))
    .filter(Boolean)
    .sort((a, b) => a.openTime - b.openTime);
  return parsed;
}

function buildSessionSnapshot(session, scope = "full") {
  const includeFast = scope === "full" || scope === "fast";
  const includeSlow = scope === "full" || scope === "slow";
  const data = {
    wallet: includeSlow ? session.snapshot.wallet : null,
    positions: includeFast ? session.snapshot.positions : null,
    orders: includeFast ? session.snapshot.orders : null,
    executions: includeFast ? session.snapshot.executions : null,
    pnl: includeSlow ? session.snapshot.pnl : null,
    protection: includeFast
      ? session.snapshot.protection
      : { positions: [], orders: [] },
    errors: { ...session.snapshot.errors },
    ws: {
      connected: session.ws.connected,
      lastUpdateAt: session.ws.lastUpdateAt,
      updatedAtIso: session.ws.lastUpdateAt ? new Date(session.ws.lastUpdateAt).toISOString() : null,
      lastError: session.ws.lastError,
      topics: { ...session.ws.topics },
    },
    engine: {
      connected: session.engine.connected,
      timeframe: session.engine.timeframe,
      riskMode: session.engine.riskMode,
      symbols: [...session.engine.symbols],
      lastDecisionAt: session.engine.lastDecisionAt,
      updatedAtIso: session.engine.lastDecisionAt
        ? new Date(session.engine.lastDecisionAt).toISOString()
        : null,
      decisions: includeFast
        ? Array.from(session.engine.decisions.entries()).map(([symbol, payload]) => ({
            symbol,
            ts: payload.ts,
            decision: payload.decision,
          }))
        : [],
      lastError: session.engine.lastError,
    },
    meta: {
      source: "persistent_aggregator",
      env: session.env,
      useTestnet: session.useTestnet,
      updatedAt: session.updatedAt,
      updatedAtIso: session.updatedAt ? new Date(session.updatedAt).toISOString() : nowIso(),
    },
  };
  return data;
}

async function runFastPoll(session) {
  const settled = await Promise.allSettled([
    getDemoPositions(session.creds, session.useTestnet),
    listDemoOrders(
      session.creds,
      { limit: session.limits.orders, settleCoin: "USDT" },
      session.useTestnet
    ),
    listExecutions(
      session.creds,
      { limit: session.limits.executions, settleCoin: "USDT" },
      session.useTestnet
    ),
  ]);
  const [positionsRes, ordersRes, executionsRes] = settled;
  if (positionsRes.status === "fulfilled") {
    session.snapshot.positions = positionsRes.value;
    delete session.snapshot.errors.positions;
  } else {
    session.snapshot.errors.positions = toErrorMessage(positionsRes.reason);
  }
  if (ordersRes.status === "fulfilled") {
    session.snapshot.orders = ordersRes.value;
    delete session.snapshot.errors.orders;
  } else {
    session.snapshot.errors.orders = toErrorMessage(ordersRes.reason);
  }
  if (executionsRes.status === "fulfilled") {
    session.snapshot.executions = executionsRes.value;
    delete session.snapshot.errors.executions;
  } else {
    session.snapshot.errors.executions = toErrorMessage(executionsRes.reason);
  }
  session.snapshot.protection = buildProtectionSnapshot(
    session.snapshot.positions,
    session.snapshot.orders
  );
  session.updatedAt = Date.now();
}

async function runSlowPoll(session) {
  const settled = await Promise.allSettled([
    getWalletBalance(session.creds, session.useTestnet),
    listClosedPnl(
      session.creds,
      { limit: session.limits.pnl },
      session.useTestnet
    ),
  ]);
  const [walletRes, pnlRes] = settled;
  if (walletRes.status === "fulfilled") {
    session.snapshot.wallet = walletRes.value;
    delete session.snapshot.errors.wallet;
  } else {
    session.snapshot.errors.wallet = toErrorMessage(walletRes.reason);
  }
  if (pnlRes.status === "fulfilled") {
    session.snapshot.pnl = pnlRes.value;
    delete session.snapshot.errors.pnl;
  } else {
    session.snapshot.errors.pnl = toErrorMessage(pnlRes.reason);
  }
  session.updatedAt = Date.now();
}

async function initEngineBackfill(session) {
  await Promise.allSettled(
    session.engine.symbols.map(async (symbol) => {
      const candles = await fetchBackfillCandles({
        symbol,
        timeframe: session.engine.timeframe,
        useTestnet: session.useTestnet,
        limit: session.engine.maxCandles,
      });
      if (!candles.length) return;
      session.engine.candlesBySymbol.set(symbol, candles.slice(-session.engine.maxCandles));
      try {
        const decision = session.engine.decisionFn(symbol, candles);
        const ts = Date.now();
        session.engine.decisions.set(symbol, { decision, ts });
        session.engine.lastDecisionAt = ts;
      } catch (err) {
        session.engine.lastError = toErrorMessage(err);
      }
    })
  );
}

function onWsUpdate(session, event) {
  const topic = String(event?.topic ?? "");
  const data = event?.data;
  const ts = Date.now();
  session.ws.lastUpdateAt = ts;
  if (topic) {
    session.ws.topics[topic] = ts;
  }

  if (topic.startsWith("kline.")) {
    const symbol = topic.split(".").pop() ?? "";
    if (!symbol) return;
    const rows = Array.isArray(data) ? data : [data];
    const incoming = rows.map((row) => normalizeWsKline(row)).filter(Boolean);
    if (!incoming.length) return;
    const existing = session.engine.candlesBySymbol.get(symbol) ?? [];
    const merged = mergeCandles(existing, incoming, session.engine.maxCandles);
    session.engine.candlesBySymbol.set(symbol, merged);
    try {
      const decision = session.engine.decisionFn(symbol, merged);
      session.engine.decisions.set(symbol, { decision, ts });
      session.engine.lastDecisionAt = ts;
      session.engine.lastError = null;
    } catch (err) {
      session.engine.lastError = toErrorMessage(err);
    }
    return;
  }

  if (topic === "wallet") {
    session.ws.latest.wallet = data;
    return;
  }
  if (topic === "position") {
    session.ws.latest.position = data;
    return;
  }
  if (topic === "order") {
    session.ws.latest.order = data;
    return;
  }
  if (topic === "execution") {
    session.ws.latest.execution = data;
  }
}

function createSession(args) {
  const {
    sessionKey,
    userId,
    env,
    useTestnet,
    creds,
    riskMode,
    symbols,
    limits,
  } = args;

  const timeframe = riskMode === "ai-matic-olikella" ? "5" : "1";
  const decisionFn = selectDecisionFn(riskMode);
  const engineSymbols = symbols.length ? symbols : [...SUPPORTED_SYMBOLS];
  const ws = new WebsocketClient({
    key: creds.apiKey,
    secret: creds.apiSecret,
    testnet: useTestnet,
  });

  const session = {
    key: sessionKey,
    userId,
    env,
    useTestnet,
    creds: { ...creds },
    limits: { ...limits },
    snapshot: {
      wallet: null,
      positions: null,
      orders: null,
      executions: null,
      pnl: null,
      protection: { positions: [], orders: [] },
      errors: {},
    },
    ws: {
      connected: false,
      lastUpdateAt: 0,
      lastError: null,
      topics: {},
      latest: {
        wallet: null,
        position: null,
        order: null,
        execution: null,
      },
    },
    engine: {
      connected: false,
      riskMode,
      timeframe,
      symbols: engineSymbols,
      maxCandles: riskMode === "ai-matic-olikella" ? 1500 : 1000,
      decisionFn,
      candlesBySymbol: new Map(),
      decisions: new Map(),
      lastDecisionAt: 0,
      lastError: null,
    },
    wsClient: ws,
    timers: {
      fast: null,
      slow: null,
    },
    createdAt: Date.now(),
    lastAccessAt: Date.now(),
    updatedAt: 0,
    initPromise: null,
    stop() {
      if (session.timers.fast) clearInterval(session.timers.fast);
      if (session.timers.slow) clearInterval(session.timers.slow);
      session.timers.fast = null;
      session.timers.slow = null;
      session.engine.connected = false;
      session.ws.connected = false;
      try {
        session.wsClient?.closeAll(true);
      } catch (_) {
        // noop
      }
    },
  };

  ws.on("open", () => {
    session.engine.connected = true;
    session.ws.connected = true;
  });
  ws.on("reconnected", () => {
    session.engine.connected = true;
    session.ws.connected = true;
  });
  ws.on("close", () => {
    session.ws.connected = false;
  });
  ws.on("exception", (err) => {
    const msg = toErrorMessage(err);
    session.ws.lastError = msg;
    session.engine.lastError = msg;
  });
  ws.on("update", (event) => onWsUpdate(session, event));

  const publicTopics = engineSymbols.map(
    (symbol) => `kline.${timeframe}.${symbol}`
  );
  ws.subscribeV5(["position", "order", "execution", "wallet"], "linear", true);
  ws.subscribeV5(publicTopics, "linear");

  session.initPromise = Promise.allSettled([
    runFastPoll(session),
    runSlowPoll(session),
    initEngineBackfill(session),
  ]).finally(() => {
    session.timers.fast = setInterval(() => {
      void runFastPoll(session).catch((err) => {
        session.snapshot.errors.fast = toErrorMessage(err);
      });
    }, FAST_POLL_MS);
    session.timers.slow = setInterval(() => {
      void runSlowPoll(session).catch((err) => {
        session.snapshot.errors.slow = toErrorMessage(err);
      });
    }, SLOW_POLL_MS);
  });

  return session;
}

function cleanupStaleSessions() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastAccessAt < STALE_SESSION_TTL_MS) continue;
    session.stop();
    sessions.delete(key);
  }
}

function buildSessionKey(userId, env) {
  return `${env}:${userId}`;
}

function buildConfigSignature(args) {
  const { apiKey, useTestnet, riskMode, symbols, limits } = args;
  return JSON.stringify({
    apiKey: String(apiKey ?? ""),
    useTestnet: Boolean(useTestnet),
    riskMode,
    symbols: [...symbols].sort(),
    limits,
  });
}

export async function getPersistentDashboardSnapshot(args) {
  cleanupStaleSessions();
  const userId = String(args.userId ?? "");
  const env = String(args.env ?? (args.useTestnet ? "testnet" : "mainnet"));
  const useTestnet = Boolean(args.useTestnet);
  const scope = normalizeScope(args.scope);
  const riskMode = normalizeRiskMode(args.riskMode);
  const symbols = normalizeSymbols(args.symbols);
  const limits = {
    orders: normalizeLimit(args.ordersLimit, 50),
    executions: normalizeLimit(args.executionsLimit, 50),
    pnl: normalizeLimit(args.pnlLimit, 200),
  };

  const key = buildSessionKey(userId, env);
  const nextSignature = buildConfigSignature({
    apiKey: args.apiKey,
    useTestnet,
    riskMode,
    symbols,
    limits,
  });

  let session = sessions.get(key);
  if (!session || session.configSignature !== nextSignature) {
    if (session) {
      session.stop();
      sessions.delete(key);
    }
    session = createSession({
      sessionKey: key,
      userId,
      env,
      useTestnet,
      creds: { apiKey: args.apiKey, apiSecret: args.apiSecret },
      riskMode,
      symbols,
      limits,
    });
    session.configSignature = nextSignature;
    sessions.set(key, session);
  } else {
    session.lastAccessAt = Date.now();
  }

  if (session.initPromise) {
    await session.initPromise;
    session.initPromise = null;
  }

  session.lastAccessAt = Date.now();
  return buildSessionSnapshot(session, scope);
}
