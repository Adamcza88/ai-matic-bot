export type Symbol = "BTCUSDT" | "ETHUSDT" | "SOLUSDT" | "ADAUSDT";
export type Side = "Buy" | "Sell";

export type EntryType = "LIMIT_MAKER_FIRST" | "LIMIT" | "MARKET_DISABLED";

export type TradeIntent = {
  intentId: string; // UUID
  createdAt: number; // ms
  profile: "AI-MATIC";
  symbol: Symbol;
  side: Side;

  entryType: EntryType;
  entryPrice?: number; // required for LIMIT*
  qtyMode: "USDT_NOTIONAL" | "BASE_QTY";
  qtyValue: number; // notional or base qty

  slPrice: number; // protective stop
  tpPrices: number[]; // take-profit ladder (optional empty)
  trailingStop?: number; // distance from price
  trailingActivePrice?: number; // activation price

  expireAfterMs: number; // entry timeout
  tags?: Record<string, string>; // reason, bias snapshot, etc.
};

export type ExecStatus =
  | "IDLE"
  | "INTENT_ACCEPTED"
  | "ENTRY_PLACED"
  | "ENTRY_FILLED"
  | "MANAGING"
  | "EXITING"
  | "FLAT"
  | "REJECTED"
  | "STALE_DATA"
  | "DESYNC";

export type OrderBrief = {
  orderId: string;
  symbol: Symbol;
  side: Side;
  price?: number;
  qty?: number;
  status: string;
  reduceOnly?: boolean;
};

export type PositionBrief = {
  symbol: Symbol;
  side: "LONG" | "SHORT" | "FLAT";
  size: number; // base qty
  entryPrice?: number;
  unrealizedPnl?: number;
};

export type ExecutionState = {
  ts: number;
  status: ExecStatus;
  reason?: string;

  lastIntentId?: string;

  orders: OrderBrief[];
  position: PositionBrief;

  ws: {
    market: "UP" | "DOWN" | "STALE";
    private: "UP" | "DOWN" | "STALE";
    lastMarketTs?: number;
    lastPrivateTs?: number;
  };
};
