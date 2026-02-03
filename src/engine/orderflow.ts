type OrderBookLevel = [number, number];
type TradeTick = {
  ts: number;
  price: number;
  size: number;
  side: "Buy" | "Sell";
};
type LiquidationTick = {
  ts: number;
  price: number;
  size: number;
  side: "Buy" | "Sell";
};
type CvdPoint = { ts: number; value: number };
type OiPoint = { ts: number; value: number };

type OrderFlowState = {
  bids: Map<number, number>;
  asks: Map<number, number>;
  bestBid?: number;
  bestAsk?: number;
  bestBidSize?: number;
  bestAskSize?: number;
  prevBestBidSize?: number;
  prevBestAskSize?: number;
  lastBookDelta?: number;
  ofiHistory: number[];
  trades: TradeTick[];
  vpinBuckets: number[];
  bucketBuy: number;
  bucketSell: number;
  bucketSize: number;
  cvd: number;
  cvdSeries: CvdPoint[];
  icebergUntil?: number;
  absorptionScore?: number;
  liqClusters: Map<number, { size: number; ts: number }>;
  oiHistory: OiPoint[];
  openInterest?: number;
  openInterestTrend?: "rising" | "falling" | "flat";
};

const stateBySymbol = new Map<string, OrderFlowState>();
const MAX_TRADES = 1500;
const MAX_OFI = 50;
const MAX_VPIN = 100;
const MAX_CVD_POINTS = 300;
const LIQ_CLUSTER_TTL_MS = 6 * 60 * 60_000;
const LIQ_BUCKET_PCT = 0.005;
const MAX_OI_POINTS = 50;

function getState(symbol: string): OrderFlowState {
  let state = stateBySymbol.get(symbol);
  if (!state) {
    state = {
      bids: new Map(),
      asks: new Map(),
      ofiHistory: [],
      trades: [],
      vpinBuckets: [],
      bucketBuy: 0,
      bucketSell: 0,
      bucketSize: 0,
      cvd: 0,
      cvdSeries: [],
      liqClusters: new Map(),
      oiHistory: [],
    };
    stateBySymbol.set(symbol, state);
  }
  return state;
}

function parseLevel(level: any): OrderBookLevel | null {
  if (!Array.isArray(level) || level.length < 2) return null;
  const price = Number(level[0]);
  const size = Number(level[1]);
  if (!Number.isFinite(price) || !Number.isFinite(size)) return null;
  return [price, size];
}

export function updateOrderbook(
  symbol: string,
  bids: any[],
  asks: any[],
  isSnapshot: boolean
) {
  const state = getState(symbol);
  if (isSnapshot) {
    state.bids.clear();
    state.asks.clear();
  }
  for (const raw of bids ?? []) {
    const level = parseLevel(raw);
    if (!level) continue;
    const [price, size] = level;
    if (size <= 0) state.bids.delete(price);
    else state.bids.set(price, size);
  }
  for (const raw of asks ?? []) {
    const level = parseLevel(raw);
    if (!level) continue;
    const [price, size] = level;
    if (size <= 0) state.asks.delete(price);
    else state.asks.set(price, size);
  }
  const bestBid = Math.max(...state.bids.keys());
  const bestAsk = Math.min(...state.asks.keys());
  if (Number.isFinite(bestBid)) {
    state.bestBid = bestBid;
    state.prevBestBidSize = state.bestBidSize;
    state.bestBidSize = state.bids.get(bestBid) ?? 0;
  }
  if (Number.isFinite(bestAsk)) {
    state.bestAsk = bestAsk;
    state.prevBestAskSize = state.bestAskSize;
    state.bestAskSize = state.asks.get(bestAsk) ?? 0;
  }
  const prevBid = state.prevBestBidSize ?? 0;
  const prevAsk = state.prevBestAskSize ?? 0;
  const bid = state.bestBidSize ?? 0;
  const ask = state.bestAskSize ?? 0;
  state.lastBookDelta = Math.abs(bid - prevBid) + Math.abs(ask - prevAsk);
  const ofi = (bid - prevBid) - (ask - prevAsk);
  if (Number.isFinite(ofi)) {
    state.ofiHistory.push(ofi);
    if (state.ofiHistory.length > MAX_OFI) {
      state.ofiHistory.shift();
    }
  }
}

function resolveTradeSide(raw: any): "Buy" | "Sell" | null {
  const side = String(raw?.S ?? raw?.side ?? raw?.T ?? "").toLowerCase();
  if (side === "buy") return "Buy";
  if (side === "sell") return "Sell";
  return null;
}

export function updateTrades(symbol: string, trades: any[]) {
  const state = getState(symbol);
  for (const raw of trades ?? []) {
    const side = resolveTradeSide(raw);
    const price = Number(raw?.p ?? raw?.price);
    const size = Number(raw?.v ?? raw?.size ?? raw?.qty);
    const ts = Number(raw?.T ?? raw?.timestamp ?? raw?.time ?? Date.now());
    if (!side || !Number.isFinite(price) || !Number.isFinite(size)) continue;
    state.trades.push({ ts, price, size, side });
    if (state.trades.length > MAX_TRADES) {
      state.trades.shift();
    }
    state.cvd += side === "Buy" ? size : -size;
    state.cvdSeries.push({ ts, value: state.cvd });
    if (state.cvdSeries.length > MAX_CVD_POINTS) {
      state.cvdSeries.shift();
    }
    const bestAsk = state.bestAsk ?? Number.NaN;
    const bestBid = state.bestBid ?? Number.NaN;
    const bestAskSize = state.bestAskSize ?? 0;
    const bestBidSize = state.bestBidSize ?? 0;
    if (
      side === "Buy" &&
      Number.isFinite(bestAsk) &&
      Math.abs(price - bestAsk) <= bestAsk * 0.0005 &&
      size > bestAskSize &&
      (state.lastBookDelta ?? 0) <= Math.max(bestAskSize, 1)
    ) {
      state.icebergUntil = ts + 60_000;
    }
    if (
      side === "Sell" &&
      Number.isFinite(bestBid) &&
      Math.abs(price - bestBid) <= bestBid * 0.0005 &&
      size > bestBidSize &&
      (state.lastBookDelta ?? 0) <= Math.max(bestBidSize, 1)
    ) {
      state.icebergUntil = ts + 60_000;
    }
    const avgSize =
      state.trades.reduce((sum, t) => sum + t.size, 0) /
      Math.max(1, state.trades.length);
    state.bucketSize = Math.max(avgSize * 50, avgSize * 10, 1);
    if (side === "Buy") state.bucketBuy += size;
    else state.bucketSell += size;
    const bucketTotal = state.bucketBuy + state.bucketSell;
    if (bucketTotal >= state.bucketSize) {
      const vpin = Math.abs(state.bucketBuy - state.bucketSell) / bucketTotal;
      state.vpinBuckets.push(vpin);
      if (state.vpinBuckets.length > MAX_VPIN) {
        state.vpinBuckets.shift();
      }
      state.bucketBuy = 0;
      state.bucketSell = 0;
    }
  }
  const recent = state.trades.slice(-50);
  const recentVol = recent.reduce((s, t) => s + t.size, 0);
  const bookDelta = state.lastBookDelta ?? 0;
  state.absorptionScore = recentVol / Math.max(1, bookDelta);
}

export function updateLiquidations(symbol: string, events: any[]) {
  const state = getState(symbol);
  const now = Date.now();
  for (const raw of events ?? []) {
    const price = Number(raw?.p ?? raw?.price);
    const size = Number(raw?.v ?? raw?.size ?? raw?.qty);
    const ts = Number(raw?.T ?? raw?.timestamp ?? raw?.time ?? now);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    const bucketSize = Math.max(price * LIQ_BUCKET_PCT, 0.01);
    const bucket = Math.round(price / bucketSize) * bucketSize;
    const entry = state.liqClusters.get(bucket) ?? { size: 0, ts };
    entry.size += size;
    entry.ts = ts;
    state.liqClusters.set(bucket, entry);
  }
  for (const [price, entry] of state.liqClusters.entries()) {
    if (now - entry.ts > LIQ_CLUSTER_TTL_MS) {
      state.liqClusters.delete(price);
    }
  }
}

export function updateOpenInterest(symbol: string, oiValue: number) {
  const state = getState(symbol);
  if (!Number.isFinite(oiValue) || oiValue <= 0) return;
  const ts = Date.now();
  state.openInterest = oiValue;
  state.oiHistory.push({ ts, value: oiValue });
  if (state.oiHistory.length > MAX_OI_POINTS) {
    state.oiHistory.shift();
  }
  const first = state.oiHistory[0]?.value ?? oiValue;
  const last = state.oiHistory[state.oiHistory.length - 1]?.value ?? oiValue;
  const delta = last - first;
  if (Math.abs(delta) / Math.max(1, first) < 0.002) {
    state.openInterestTrend = "flat";
  } else {
    state.openInterestTrend = delta > 0 ? "rising" : "falling";
  }
}

export function getOrderFlowSnapshot(symbol: string) {
  const state = stateBySymbol.get(symbol);
  if (!state) {
    return {
      ofi: 0,
      ofiPrev: 0,
      vpin: 0,
      delta: 0,
      deltaPrev: 0,
      cvd: 0,
      cvdPrev: 0,
      cvdSeries: [],
      icebergDetected: false,
      absorptionScore: 0,
      liqClusters: [],
      liqProximityPct: null,
      openInterest: 0,
      openInterestTrend: "flat",
      bestBid: undefined,
      bestAsk: undefined,
      lastTradeTs: 0,
      trades: [],
    };
  }
  const ofiHistory = state.ofiHistory;
  const ofi = ofiHistory.length ? ofiHistory[ofiHistory.length - 1] : 0;
  const ofiPrev =
    ofiHistory.length > 1 ? ofiHistory[ofiHistory.length - 2] : 0;
  const vpinList = state.vpinBuckets;
  const vpin =
    vpinList.length > 0
      ? vpinList.reduce((s, v) => s + v, 0) / vpinList.length
      : 0;
  const recentTrades = state.trades.slice(-200);
  let delta = 0;
  for (const t of recentTrades) {
    delta += t.side === "Buy" ? t.size : -t.size;
  }
  const prevTrades = state.trades.slice(-400, -200);
  let deltaPrev = 0;
  for (const t of prevTrades) {
    deltaPrev += t.side === "Buy" ? t.size : -t.size;
  }
  const lastTradeTs = recentTrades.length
    ? recentTrades[recentTrades.length - 1].ts
    : 0;
  const cvdSeries = state.cvdSeries;
  const cvd = state.cvd;
  const cvdPrev =
    cvdSeries.length > 1 ? cvdSeries[cvdSeries.length - 2].value : cvd;
  const icebergDetected =
    Number.isFinite(state.icebergUntil) && (state.icebergUntil as number) > Date.now();
  const liqClusters = Array.from(state.liqClusters.entries())
    .map(([price, entry]) => ({ price, size: entry.size, ts: entry.ts }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);
  const refPrice =
    recentTrades.length > 0
      ? recentTrades[recentTrades.length - 1].price
      : Number.isFinite(state.bestBid) && Number.isFinite(state.bestAsk)
        ? ((state.bestBid as number) + (state.bestAsk as number)) / 2
        : Number.NaN;
  const liqProximityPct =
    Number.isFinite(refPrice) && liqClusters.length
      ? Math.min(
          ...liqClusters.map((c) => Math.abs(c.price - refPrice) / refPrice)
        ) * 100
      : null;
  return {
    ofi,
    ofiPrev,
    vpin,
    delta,
    deltaPrev,
    cvd,
    cvdPrev,
    cvdSeries,
    icebergDetected,
    absorptionScore: state.absorptionScore ?? 0,
    liqClusters,
    liqProximityPct,
    openInterest: state.openInterest ?? 0,
    openInterestTrend: state.openInterestTrend ?? "flat",
    bestBid: state.bestBid,
    bestAsk: state.bestAsk,
    lastTradeTs,
    trades: recentTrades,
  };
}
