import { WebsocketClient } from "bybit-api";
import {
  getDemoPositions,
  getWalletBalance,
  listClosedPnl,
  listDemoOrders,
  listExecutions,
} from "./bybitClient.js";
import {
  DEFAULT_SELECTED_SYMBOLS,
  resolveSelectedSymbols,
} from "../src/constants/symbols.js";
import { evaluateStrategyForSymbol } from "../src/engine/botEngine.js";
import { evaluateAiMaticXStrategyForSymbol } from "../src/engine/aiMaticXStrategy.js";
import { evaluateAiMaticAmdStrategyForSymbol } from "../src/engine/aiMaticAmdStrategy.js";
import { evaluateAiMaticProStrategyForSymbol } from "../src/engine/aiMaticProStrategy.js";
import { evaluateAiMaticOliKellaStrategyForSymbol } from "../src/engine/aiMaticOliKellaStrategy.js";
import { evaluateAiMaticBboStrategyForSymbol } from "../src/engine/aiMaticBboStrategy.js";
import { computeCoreV2 } from "../src/engine/coreV2.js";
import { getSymbolCatalog } from "./symbolCatalog.js";

const FAST_POLL_MS = 30_000;
const SLOW_POLL_MS = 15_000;
const WS_ACCOUNT_STALE_MS = 20_000;
const PRIVATE_EXECUTIONS_MAX = 500;
const STALE_SESSION_TTL_MS = 15 * 60_000;
const INITIAL_BOOTSTRAP_WAIT_MS = 2_500;
const REST_URL_MAINNET = "https://api.bybit.com";
const REST_URL_TESTNET = "https://api-demo.bybit.com";
const BACKFILL_PAGE_LIMIT = 1000;
const BACKFILL_MAX_PAGES = 10;
const ENGINE_MAX_CANDLES_DEFAULT = 5000;
const ENGINE_MAX_CANDLES_OLIKELLA = 2500;

const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function extractList(data) {
  return data?.result?.list ?? data?.list ?? [];
}

function makeResultList(list) {
  return { retCode: 0, result: { list: Array.isArray(list) ? list : [] } };
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
    "ai-matic-bbo",
    "ai-matic-tree",
    "ai-matic-pro",
  ]);
  return allowed.has(raw) ? raw : "ai-matic";
}

function normalizeSymbols(value, allowedSymbols, fallbackSymbols = DEFAULT_SELECTED_SYMBOLS) {
  return resolveSelectedSymbols(value, {
    allowedSymbols,
    fallbackSymbols,
  });
}

function extractWsRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.list)) return payload.list;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.result?.list)) return payload.result.list;
  if (Array.isArray(payload.result)) return payload.result;
  return [payload];
}

function orderStatusKey(order) {
  return String(order?.orderStatus ?? order?.order_status ?? order?.status ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function isActiveOrder(order) {
  const key = orderStatusKey(order);
  return key === "new" || key === "created" || key === "untriggered" || key === "partiallyfilled";
}

function positionKey(position) {
  const symbol = String(position?.symbol ?? "").toUpperCase();
  const side = String(position?.side ?? "").toLowerCase();
  const idxRaw = Number(position?.positionIdx ?? position?.position_id ?? NaN);
  const idx = Number.isFinite(idxRaw) ? idxRaw : 0;
  return `${symbol}:${side}:${idx}`;
}

function orderKey(order) {
  const orderId = String(order?.orderId ?? order?.orderID ?? "");
  if (orderId) return orderId;
  const orderLinkId = String(order?.orderLinkId ?? order?.order_link_id ?? "");
  if (orderLinkId) return `link:${orderLinkId}`;
  const symbol = String(order?.symbol ?? "").toUpperCase();
  const side = String(order?.side ?? "").toUpperCase();
  const created = String(order?.createdTime ?? order?.updatedTime ?? "");
  return `${symbol}:${side}:${created}`;
}

function executionKey(execution) {
  const execId = String(execution?.execId ?? execution?.tradeId ?? "");
  if (execId) return execId;
  const orderId = String(execution?.orderId ?? execution?.orderID ?? "");
  const ts = String(execution?.execTime ?? execution?.transactTime ?? execution?.createdTime ?? "");
  const symbol = String(execution?.symbol ?? "").toUpperCase();
  return `${symbol}:${orderId}:${ts}`;
}

function executionTs(execution) {
  const value = Number(execution?.execTime ?? execution?.transactTime ?? execution?.createdTime ?? NaN);
  return Number.isFinite(value) ? value : 0;
}

function syncSnapshotFromPrivateState(session) {
  const positions = Array.from(session.privateState.positions.values());
  const orders = Array.from(session.privateState.orders.values());
  const executions = Array.from(session.privateState.executions.values())
    .sort((a, b) => executionTs(b) - executionTs(a))
    .slice(0, session.limits.executions);

  session.snapshot.positions = makeResultList(positions);
  session.snapshot.orders = makeResultList(orders);
  session.snapshot.executions = makeResultList(executions);
  session.snapshot.protection = buildProtectionSnapshot(
    session.snapshot.positions,
    session.snapshot.orders
  );

  delete session.snapshot.errors.positions;
  delete session.snapshot.errors.orders;
  delete session.snapshot.errors.executions;
  session.updatedAt = Date.now();
}

function hydratePrivateFastStateFromSnapshot(session) {
  const positions = extractList(session.snapshot.positions);
  const orders = extractList(session.snapshot.orders);
  const executions = extractList(session.snapshot.executions);

  session.privateState.positions.clear();
  session.privateState.orders.clear();
  session.privateState.executions.clear();

  for (const position of positions) {
    const key = positionKey(position);
    if (!key || key.startsWith("::")) continue;
    session.privateState.positions.set(key, position);
  }
  for (const order of orders) {
    const key = orderKey(order);
    if (!key) continue;
    session.privateState.orders.set(key, order);
  }
  for (const execution of executions) {
    const key = executionKey(execution);
    if (!key) continue;
    session.privateState.executions.set(key, execution);
  }
}

function shouldRefreshFastFromRest(session) {
  const now = Date.now();
  if (!session.ws.connected) return true;
  if (session.ws.lastUpdateAt <= 0) return true;
  if (now - session.ws.lastUpdateAt > WS_ACCOUNT_STALE_MS) return true;

  const requiredTopics = ["position", "order", "execution"];
  for (const topic of requiredTopics) {
    const ts = Number(session.ws.topics[topic] ?? 0);
    if (!Number.isFinite(ts) || ts <= 0) return true;
    if (now - ts > WS_ACCOUNT_STALE_MS) return true;
  }
  return false;
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

function computeCoreV2FromCandles(candles, riskMode) {
  if (!Array.isArray(candles)) return null;
  return computeCoreV2(candles, { riskMode });
}

function enrichDecisionWithCore(decision, candles, riskMode) {
  if (!decision || typeof decision !== "object") return decision;
  const existingCore =
    decision.coreV2 && typeof decision.coreV2 === "object"
      ? decision.coreV2
      : null;
  const derivedCore = computeCoreV2FromCandles(candles, riskMode);
  if (!existingCore && !derivedCore) return decision;
  return {
    ...decision,
    coreV2: {
      ...(derivedCore ?? {}),
      ...(existingCore ?? {}),
    },
  };
}

function selectDecisionFn(riskMode) {
  if (riskMode === "ai-matic-x") return evaluateAiMaticXStrategyForSymbol;
  if (riskMode === "ai-matic-amd") return evaluateAiMaticAmdStrategyForSymbol;
  if (riskMode === "ai-matic-pro") return evaluateAiMaticProStrategyForSymbol;
  if (riskMode === "ai-matic-olikella") return evaluateAiMaticOliKellaStrategyForSymbol;
  if (riskMode === "ai-matic-bbo") return evaluateAiMaticBboStrategyForSymbol;
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
  const wanted = Math.max(1, Math.floor(Number(limit) || 500));
  let end = Date.now();
  const merged = new Map();

  for (let page = 0; page < BACKFILL_MAX_PAGES && merged.size < wanted; page += 1) {
    const remaining = wanted - merged.size;
    const pageLimit = Math.max(1, Math.min(BACKFILL_PAGE_LIMIT, remaining));
    const url = `${base}/v5/market/kline?category=linear&symbol=${symbol}&interval=${timeframe}&limit=${pageLimit}&end=${end}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`backfill_failed:${res.status}`);
    const json = await res.json();
    const list = json?.result?.list ?? [];
    if (!Array.isArray(list) || list.length === 0) break;

    const parsed = list
      .map((row) => normalizeWsKline(row))
      .filter(Boolean)
      .sort((a, b) => a.openTime - b.openTime);
    if (!parsed.length) break;

    for (const candle of parsed) {
      if (!Number.isFinite(candle?.openTime)) continue;
      merged.set(candle.openTime, candle);
    }

    const oldestOpenTime = parsed[0]?.openTime;
    if (!Number.isFinite(oldestOpenTime) || oldestOpenTime <= 0) break;
    const nextEnd = oldestOpenTime - 1;
    if (!Number.isFinite(nextEnd) || nextEnd >= end) break;
    end = nextEnd;

    if (parsed.length < pageLimit) break;
  }

  const sorted = Array.from(merged.values()).sort((a, b) => a.openTime - b.openTime);
  if (sorted.length <= wanted) return sorted;
  return sorted.slice(-wanted);
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
      bootstrapPending: Boolean(session.initPromise),
      backfillPending: Boolean(session.backfillPromise),
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
  if (
    positionsRes.status === "fulfilled" &&
    ordersRes.status === "fulfilled" &&
    executionsRes.status === "fulfilled"
  ) {
    hydratePrivateFastStateFromSnapshot(session);
  }
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
      let candles = [];
      let fetchError = null;
      try {
        candles = await fetchBackfillCandles({
          symbol,
          timeframe: session.engine.timeframe,
          useTestnet: session.useTestnet,
          limit: session.engine.maxCandles,
        });
      } catch (err) {
        fetchError = err;
      }
      const ts = Date.now();
      if (candles.length > 0) {
        session.engine.candlesBySymbol.set(
          symbol,
          candles.slice(-session.engine.maxCandles)
        );
      }
      try {
        const rawDecision = session.engine.decisionFn(symbol, candles);
        const decision = enrichDecisionWithCore(rawDecision, candles, session.engine.riskMode);
        session.engine.decisions.set(symbol, { decision, ts });
        session.engine.lastDecisionAt = ts;
        if (fetchError) {
          session.engine.lastError = `${symbol} backfill degraded: ${toErrorMessage(
            fetchError
          )}`;
        }
      } catch (err) {
        try {
          const fallbackDecision = enrichDecisionWithCore(
            session.engine.decisionFn(symbol, []),
            [],
            session.engine.riskMode
          );
          session.engine.decisions.set(symbol, {
            decision: fallbackDecision,
            ts,
          });
          session.engine.lastDecisionAt = ts;
        } catch {
          // ignore fallback decision errors
        }
        const reason = fetchError ? toErrorMessage(fetchError) : toErrorMessage(err);
        session.engine.lastError = `${symbol} backfill failed: ${reason}`;
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
    const rootTopic = topic.split(".")[0];
    if (rootTopic && !session.ws.topics[rootTopic]) {
      session.ws.topics[rootTopic] = ts;
    } else if (rootTopic) {
      session.ws.topics[rootTopic] = ts;
    }
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
      const rawDecision = session.engine.decisionFn(symbol, merged);
      const decision = enrichDecisionWithCore(rawDecision, merged, session.engine.riskMode);
      session.engine.decisions.set(symbol, { decision, ts });
      session.engine.lastDecisionAt = ts;
      session.engine.lastError = null;
    } catch (err) {
      session.engine.lastError = toErrorMessage(err);
    }
    return;
  }

  const rootTopic = topic.split(".")[0];

  if (rootTopic === "wallet") {
    session.ws.latest.wallet = data;
    const rows = extractWsRows(data);
    if (rows.length) {
      session.snapshot.wallet = makeResultList(rows);
      delete session.snapshot.errors.wallet;
      session.updatedAt = ts;
    }
    return;
  }
  if (rootTopic === "position") {
    session.ws.latest.position = data;
    const rows = extractWsRows(data);
    for (const row of rows) {
      const key = positionKey(row);
      if (!key || key.startsWith("::")) continue;
      const size = Number(row?.size ?? row?.qty ?? 0);
      if (!Number.isFinite(size) || Math.abs(size) <= 0) {
        session.privateState.positions.delete(key);
        continue;
      }
      session.privateState.positions.set(key, row);
    }
    syncSnapshotFromPrivateState(session);
    return;
  }
  if (rootTopic === "order") {
    session.ws.latest.order = data;
    const rows = extractWsRows(data);
    for (const row of rows) {
      const key = orderKey(row);
      if (!key) continue;
      if (isActiveOrder(row)) {
        session.privateState.orders.set(key, row);
      } else {
        session.privateState.orders.delete(key);
      }
    }
    syncSnapshotFromPrivateState(session);
    return;
  }
  if (rootTopic === "execution") {
    session.ws.latest.execution = data;
    const rows = extractWsRows(data);
    for (const row of rows) {
      const key = executionKey(row);
      if (!key) continue;
      session.privateState.executions.set(key, row);
    }
    if (session.privateState.executions.size > PRIVATE_EXECUTIONS_MAX) {
      const trimmed = Array.from(session.privateState.executions.values())
        .sort((a, b) => executionTs(b) - executionTs(a))
        .slice(0, PRIVATE_EXECUTIONS_MAX);
      session.privateState.executions.clear();
      for (const row of trimmed) {
        const key = executionKey(row);
        if (!key) continue;
        session.privateState.executions.set(key, row);
      }
    }
    syncSnapshotFromPrivateState(session);
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

  const timeframe = "5";
  const decisionFn = selectDecisionFn(riskMode);
  const engineSymbols = symbols.length ? symbols : [...DEFAULT_SELECTED_SYMBOLS];
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
      maxCandles:
        riskMode === "ai-matic-olikella"
          ? ENGINE_MAX_CANDLES_OLIKELLA
          : ENGINE_MAX_CANDLES_DEFAULT,
      decisionFn,
      candlesBySymbol: new Map(),
      decisions: new Map(),
      lastDecisionAt: 0,
      lastError: null,
    },
    wsClient: ws,
    privateState: {
      positions: new Map(),
      orders: new Map(),
      executions: new Map(),
    },
    timers: {
      fast: null,
      slow: null,
    },
    createdAt: Date.now(),
    lastAccessAt: Date.now(),
    updatedAt: 0,
    initPromise: null,
    backfillPromise: null,
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

  const bootstrapTs = Date.now();
  for (const symbol of engineSymbols) {
    try {
      const fallbackDecision = enrichDecisionWithCore(decisionFn(symbol, []), [], riskMode);
      session.engine.decisions.set(symbol, {
        decision: fallbackDecision,
        ts: bootstrapTs,
      });
    } catch {
      // ignore bootstrap placeholder failures
    }
  }
  if (session.engine.decisions.size > 0) {
    session.engine.lastDecisionAt = bootstrapTs;
  }

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
  try {
    ws.subscribeV5(["position", "order", "execution", "wallet"], "linear", true);
  } catch (err) {
    const msg = toErrorMessage(err);
    session.ws.lastError = msg;
    session.engine.lastError = msg;
  }
  try {
    ws.subscribeV5(publicTopics, "linear");
  } catch (err) {
    const msg = toErrorMessage(err);
    session.ws.lastError = msg;
    session.engine.lastError = msg;
  }

  const bootstrapPromise = Promise.allSettled([
    runFastPoll(session),
    runSlowPoll(session),
  ]).finally(() => {
    session.timers.fast = setInterval(() => {
      if (!shouldRefreshFastFromRest(session)) return;
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
  session.initPromise = bootstrapPromise;
  session.initPromise.finally(() => {
    if (session.initPromise === bootstrapPromise) {
      session.initPromise = null;
    }
  });

  const backfillPromise = initEngineBackfill(session).catch((err) => {
    session.engine.lastError = toErrorMessage(err);
  });
  session.backfillPromise = backfillPromise;
  session.backfillPromise.finally(() => {
    if (session.backfillPromise === backfillPromise) {
      session.backfillPromise = null;
    }
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
  const symbolCatalog = await getSymbolCatalog(useTestnet);
  const symbols = normalizeSymbols(
    args.symbols,
    symbolCatalog.availableSymbols,
    symbolCatalog.defaultSelectedSymbols
  );
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
    await Promise.race([
      session.initPromise,
      new Promise((resolve) => setTimeout(resolve, INITIAL_BOOTSTRAP_WAIT_MS)),
    ]);
  }

  session.lastAccessAt = Date.now();
  return buildSessionSnapshot(session, scope);
}

export function getPersistentAggregatorHealth() {
  cleanupStaleSessions();
  const activeSessions = Array.from(sessions.values());
  const now = Date.now();
  return {
    status: "ok",
    sessionCount: activeSessions.length,
    sessions: activeSessions.map((session) => ({
      userId: session.userId,
      env: session.env,
      useTestnet: session.useTestnet,
      updatedAt: session.updatedAt || null,
      updatedAtIso: session.updatedAt
        ? new Date(session.updatedAt).toISOString()
        : null,
      lastAccessAt: session.lastAccessAt,
      lastAccessAtIso: new Date(session.lastAccessAt).toISOString(),
      isStale:
        session.lastAccessAt > 0 &&
        now - session.lastAccessAt >= STALE_SESSION_TTL_MS,
      wsConnected: session.ws.connected,
      wsLastError: session.ws.lastError,
      engineConnected: session.engine.connected,
      engineLastError: session.engine.lastError,
    })),
  };
}
