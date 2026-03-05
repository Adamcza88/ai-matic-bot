import {
  getDemoPositions,
  getWalletBalance,
  listClosedPnl,
  listDemoOrders,
  listExecutions,
} from "../../server/bybitClient.js";

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

export async function fetchDashboardSnapshot({
  apiKey,
  apiSecret,
  useTestnet,
  scope,
  ordersLimit,
  executionsLimit,
  pnlLimit,
}) {
  const creds = { apiKey, apiSecret };
  const limits = {
    orders: normalizeLimit(ordersLimit, 50),
    executions: normalizeLimit(executionsLimit, 50),
    pnl: normalizeLimit(pnlLimit, 200),
  };

  const mode = String(scope ?? "full").toLowerCase();
  const includeFast = mode === "full" || mode === "fast";
  const includeSlow = mode === "full" || mode === "slow";
  const tasks = {};
  if (includeSlow) {
    tasks.wallet = () => getWalletBalance(creds, useTestnet);
    tasks.pnl = () => listClosedPnl(creds, { limit: limits.pnl }, useTestnet);
  }
  if (includeFast) {
    tasks.positions = () => getDemoPositions(creds, useTestnet);
    tasks.orders = () =>
      listDemoOrders(
        creds,
        { limit: limits.orders, settleCoin: "USDT" },
        useTestnet
      );
    tasks.executions = () =>
      listExecutions(
        creds,
        { limit: limits.executions, settleCoin: "USDT" },
        useTestnet
      );
  }

  const entries = Object.entries(tasks);
  const settled = await Promise.allSettled(entries.map(([, run]) => run()));
  const snapshot = {
    wallet: null,
    positions: null,
    orders: null,
    executions: null,
    pnl: null,
    protection: { positions: [], orders: [] },
    errors: {},
  };

  settled.forEach((result, index) => {
    const [key] = entries[index];
    if (result.status === "fulfilled") {
      snapshot[key] = result.value;
      return;
    }
    snapshot.errors[key] = toErrorMessage(result.reason);
  });

  snapshot.protection = buildProtectionSnapshot(
    snapshot.positions,
    snapshot.orders
  );

  return snapshot;
}
