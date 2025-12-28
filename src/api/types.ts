export type Symbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT" | "ADAUSDT";
export type Side = "Buy" | "Sell";
export type EntryType = "LIMIT_MAKER_FIRST" | "LIMIT" | "MARKET_DISABLED";

export type TradeIntent = {
  intentId: string;
  createdAt: number;
  profile: "AI-MATIC";
  symbol: Symbol;
  side: Side;
  entryType: EntryType;
  entryPrice?: number;
  qtyMode: "USDT_NOTIONAL" | "BASE_QTY";
  qtyValue: number;
  slPrice: number;
  tpPrices: number[];
  expireAfterMs: number;
  tags?: Record<string, string>;
};

export type ExecutionState = {
  ts: number;
  status: string;
  reason?: string;
  lastIntentId?: string;
  orders: any[];
  position: any;
  ws: any;
};
