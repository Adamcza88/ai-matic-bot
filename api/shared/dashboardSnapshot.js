import { getPersistentDashboardSnapshot } from "../../server/persistentAggregator.js";
import {
  getDemoPositions,
  getWalletBalance,
  listClosedPnl,
  listDemoOrders,
  listExecutions,
} from "../../server/bybitClient.js";

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

function extractList(data) {
  return Array.isArray(data?.result?.list) ? data.result.list : [];
}

function normalizeSymbols(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).toUpperCase()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function buildDegradedSnapshot({ env, useTestnet, riskMode, symbols, reason }) {
  return {
    wallet: null,
    positions: null,
    orders: null,
    executions: null,
    pnl: null,
    protection: { positions: [], orders: [] },
    errors: {
      dashboard: toErrorMessage(reason),
    },
    ws: {
      connected: false,
      lastUpdateAt: 0,
      updatedAtIso: null,
      lastError: "dashboard_unavailable",
      topics: {},
    },
    engine: {
      connected: false,
      timeframe: "1",
      riskMode: riskMode || "ai-matic",
      symbols: normalizeSymbols(symbols),
      lastDecisionAt: 0,
      updatedAtIso: null,
      decisions: [],
      lastError: "dashboard_unavailable",
    },
    meta: {
      source: "degraded_fallback",
      env,
      useTestnet,
      updatedAt: Date.now(),
      updatedAtIso: new Date().toISOString(),
    },
  };
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

async function fetchDashboardSnapshotFallback({
  creds,
  useTestnet,
  ordersLimit,
  executionsLimit,
  pnlLimit,
  scope,
  env,
  riskMode,
  symbols,
}) {
  const includeFast = scope !== "slow";
  const includeSlow = scope !== "fast";
  const limits = {
    orders: normalizeLimit(ordersLimit, 50),
    executions: normalizeLimit(executionsLimit, 50),
    pnl: normalizeLimit(pnlLimit, 200),
  };
  const errors = {};

  const [walletRes, positionsRes, ordersRes, executionsRes, pnlRes] = await Promise.allSettled([
    includeSlow ? getWalletBalance(creds, useTestnet) : Promise.resolve(null),
    includeFast ? getDemoPositions(creds, useTestnet) : Promise.resolve(null),
    includeFast
      ? listDemoOrders(creds, { limit: limits.orders, settleCoin: "USDT" }, useTestnet)
      : Promise.resolve(null),
    includeFast
      ? listExecutions(creds, { limit: limits.executions, settleCoin: "USDT" }, useTestnet)
      : Promise.resolve(null),
    includeSlow ? listClosedPnl(creds, { limit: limits.pnl }, useTestnet) : Promise.resolve(null),
  ]);

  const wallet = walletRes.status === "fulfilled" ? walletRes.value : null;
  const positions = positionsRes.status === "fulfilled" ? positionsRes.value : null;
  const orders = ordersRes.status === "fulfilled" ? ordersRes.value : null;
  const executions = executionsRes.status === "fulfilled" ? executionsRes.value : null;
  const pnl = pnlRes.status === "fulfilled" ? pnlRes.value : null;

  if (walletRes.status === "rejected") errors.wallet = toErrorMessage(walletRes.reason);
  if (positionsRes.status === "rejected") errors.positions = toErrorMessage(positionsRes.reason);
  if (ordersRes.status === "rejected") errors.orders = toErrorMessage(ordersRes.reason);
  if (executionsRes.status === "rejected") errors.executions = toErrorMessage(executionsRes.reason);
  if (pnlRes.status === "rejected") errors.pnl = toErrorMessage(pnlRes.reason);

  return {
    wallet,
    positions,
    orders,
    executions,
    pnl,
    protection: buildProtectionSnapshot(positions, orders),
    errors,
    ws: {
      connected: false,
      lastUpdateAt: 0,
      updatedAtIso: null,
      lastError: "persistent_aggregator_unavailable",
      topics: {},
    },
    engine: {
      connected: false,
      timeframe: "1",
      riskMode: riskMode || "ai-matic",
      symbols: normalizeSymbols(symbols),
      lastDecisionAt: 0,
      updatedAtIso: null,
      decisions: [],
      lastError: "persistent_aggregator_unavailable",
    },
    meta: {
      source: "rest_fallback",
      env,
      useTestnet,
      updatedAt: Date.now(),
      updatedAtIso: new Date().toISOString(),
    },
  };
}

export async function fetchDashboardSnapshot({
  userId,
  env,
  apiKey,
  apiSecret,
  useTestnet,
  scope,
  riskMode,
  symbols,
  ordersLimit,
  executionsLimit,
  pnlLimit,
}) {
  try {
    return await getPersistentDashboardSnapshot({
      userId,
      env,
      apiKey,
      apiSecret,
      useTestnet,
      scope,
      riskMode,
      symbols,
      ordersLimit,
      executionsLimit,
      pnlLimit,
    });
  } catch (error) {
    console.error("persistent dashboard snapshot failed, switching to REST fallback:", error);
    try {
      return await fetchDashboardSnapshotFallback({
        creds: { apiKey, apiSecret },
        useTestnet,
        ordersLimit,
        executionsLimit,
        pnlLimit,
        scope,
        env,
        riskMode,
        symbols,
      });
    } catch (fallbackError) {
      console.error("dashboard REST fallback failed, returning degraded snapshot:", fallbackError);
      return buildDegradedSnapshot({
        env,
        useTestnet,
        riskMode,
        symbols,
        reason: fallbackError,
      });
    }
  }
}
