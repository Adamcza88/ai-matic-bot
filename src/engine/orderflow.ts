type OrderBookLevel = [number, number];
type TradeTick = {
  ts: number;
  price: number;
  size: number;
  side: "Buy" | "Sell";
};

type OrderFlowState = {
  bids: Map<number, number>;
  asks: Map<number, number>;
  bestBid?: number;
  bestAsk?: number;
  bestBidSize?: number;
  bestAskSize?: number;
  prevBestBidSize?: number;
  prevBestAskSize?: number;
  ofiHistory: number[];
  trades: TradeTick[];
  vpinBuckets: number[];
  bucketBuy: number;
  bucketSell: number;
  bucketSize: number;
  // Iceberg detection state
  tradeVolAtBestBid: number;
  tradeVolAtBestAsk: number;
  lastBestBid?: number;
  lastBestAsk?: number;
  lastBestBidSize?: number;
  lastBestAskSize?: number;
  icebergDetected: boolean;
  absorptionScore: number;
  cvdSeries: { ts: number; value: number }[];
  cumulativeDelta: number;
  openInterestTrend?: "rising" | "falling" | "flat";
  liqProximityPct?: number;
  oiHistory: { ts: number; value: number }[];
  liquidationLevels: { price: number; size: number }[];
};

const stateBySymbol = new Map<string, OrderFlowState>();
const MAX_TRADES = 1500;
const MAX_OFI = 50;
const MAX_VPIN = 100;

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
      tradeVolAtBestBid: 0,
      tradeVolAtBestAsk: 0,
      icebergDetected: false,
      absorptionScore: 0,
      cvdSeries: [],
      cumulativeDelta: 0,
      oiHistory: [],
      liquidationLevels: [],
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

  // --- Iceberg Detection Logic (Chapter 6.3) ---
  const currentBestBid = Math.max(...state.bids.keys());
  const currentBestAsk = Math.min(...state.asks.keys());
  const currentBestBidSize = state.bids.get(currentBestBid) ?? 0;
  const currentBestAskSize = state.asks.get(currentBestAsk) ?? 0;

  let iceberg = false;
  let maxAbsorption = 0;

  // Check Bid Side (Absorption of Sells)
  if (Number.isFinite(currentBestBid) && currentBestBid === state.lastBestBid) {
    const visible = state.lastBestBidSize ?? currentBestBidSize;
    const ratio = visible > 0 ? state.tradeVolAtBestBid / visible : 0;
    if (ratio > 1.0) iceberg = true; // More volume traded than was visible
    maxAbsorption = Math.max(maxAbsorption, ratio);
  } else {
    state.tradeVolAtBestBid = 0; // Price moved, reset counter
  }

  // Check Ask Side (Absorption of Buys)
  if (Number.isFinite(currentBestAsk) && currentBestAsk === state.lastBestAsk) {
    const visible = state.lastBestAskSize ?? currentBestAskSize;
    const ratio = visible > 0 ? state.tradeVolAtBestAsk / visible : 0;
    if (ratio > 1.0) iceberg = true;
    maxAbsorption = Math.max(maxAbsorption, ratio);
  } else {
    state.tradeVolAtBestAsk = 0; // Price moved, reset counter
  }

  state.icebergDetected = iceberg;
  state.absorptionScore = maxAbsorption;

  state.lastBestBid = currentBestBid;
  state.lastBestAsk = currentBestAsk;
  state.lastBestBidSize = currentBestBidSize;
  state.lastBestAskSize = currentBestAskSize;
  // ---------------------------------------------

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
  const ofi = (bid - prevBid) - (ask - prevAsk);
  if (Number.isFinite(ofi)) {
    state.ofiHistory.push(ofi);
    if (state.ofiHistory.length > MAX_OFI) {
      state.ofiHistory.shift();
    }
  }
  recalcLiqProximity(state);
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

    // Accumulate volume for Iceberg detection
    if (side === "Sell" && state.lastBestBid && Math.abs(price - state.lastBestBid) < 0.000001) {
      state.tradeVolAtBestBid += size;
    }
    if (side === "Buy" && state.lastBestAsk && Math.abs(price - state.lastBestAsk) < 0.000001) {
      state.tradeVolAtBestAsk += size;
    }

    // CVD Update
    const deltaChange = side === "Buy" ? size : -size;
    state.cumulativeDelta += deltaChange;
    state.cvdSeries.push({ ts, value: state.cumulativeDelta });
    if (state.cvdSeries.length > MAX_TRADES) {
      state.cvdSeries.shift();
    }

    state.trades.push({ ts, price, size, side });
    if (state.trades.length > MAX_TRADES) {
      state.trades.shift();
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
  recalcLiqProximity(state);
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
      bestBid: undefined,
      bestAsk: undefined,
      lastTradeTs: 0,
      trades: [],
      icebergDetected: false,
      absorptionScore: 0,
      cvdSeries: [],
      openInterestTrend: undefined,
      liqProximityPct: undefined,
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
  return {
    ofi,
    ofiPrev,
    vpin,
    delta,
    deltaPrev,
    bestBid: state.bestBid,
    bestAsk: state.bestAsk,
    lastTradeTs,
    trades: recentTrades,
    icebergDetected: state.icebergDetected,
    absorptionScore: state.absorptionScore,
    cvdSeries: state.cvdSeries,
    openInterestTrend: state.openInterestTrend,
    liqProximityPct: state.liqProximityPct,
  };
}

function recalcLiqProximity(state: OrderFlowState) {
  if (!state.liquidationLevels.length) {
    state.liqProximityPct = undefined;
    return;
  }
  let price = 0;
  if (state.trades.length > 0) {
    price = state.trades[state.trades.length - 1].price;
  } else if (state.bestBid && state.bestAsk) {
    price = (state.bestBid + state.bestAsk) / 2;
  } else {
    return;
  }

  let minDist = Infinity;
  for (const level of state.liquidationLevels) {
    const dist = Math.abs(price - level.price);
    if (dist < minDist) minDist = dist;
  }
  state.liqProximityPct = (minDist / price) * 100;
}

export function updateOpenInterest(symbol: string, openInterest: number, ts: number = Date.now()) {
  const state = getState(symbol);
  state.oiHistory.push({ ts, value: openInterest });
  if (state.oiHistory.length > 60) state.oiHistory.shift();

  if (state.oiHistory.length < 5) {
    state.openInterestTrend = "flat";
    return;
  }

  const windowSize = Math.min(state.oiHistory.length, 20);
  const window = state.oiHistory.slice(-windowSize);
  const startAvg = window.slice(0, 3).reduce((s, x) => s + x.value, 0) / 3;
  const endAvg = window.slice(-3).reduce((s, x) => s + x.value, 0) / 3;
  const changePct = (endAvg - startAvg) / startAvg;

  if (changePct > 0.0005) state.openInterestTrend = "rising";
  else if (changePct < -0.0005) state.openInterestTrend = "falling";
  else state.openInterestTrend = "flat";
}

export function updateLiquidations(symbol: string, levels: { price: number; size: number }[]) {
  const state = getState(symbol);
  state.liquidationLevels = levels;
  recalcLiqProximity(state);
}
