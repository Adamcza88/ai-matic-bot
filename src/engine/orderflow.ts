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
  };
}

