export type Symbol =
  | "BTCUSDT"
  | "ETHUSDT"
  | "SOLUSDT"
  | "ADAUSDT"
  | "XRPUSDT"
  | "SUIUSDT"
  | "DOGEUSDT"
  | "LINKUSDT"
  | "ZILUSDT"
  | "AVAXUSDT"
  | "HYPEUSDT"
  | "OPUSDT";
export type Side = "Buy" | "Sell";
export type EntryType =
  | "LIMIT_MAKER_FIRST"
  | "LIMIT"
  | "CONDITIONAL"
  | "MARKET"
  | "MARKET_DISABLED";

export type Profile =
  | "AI-MATIC"
  | "AI-MATIC-X"
  | "AI-MATIC-SCALP"
  | "AI-MATIC-TREE"
  | "AI-MATIC-PRO";

export type TradeIntent = {
  intentId: string;
  createdAt: number;
  profile: Profile;
  symbol: Symbol;
  side: Side;
  entryType: EntryType;
  entryPrice?: number;
  triggerPrice?: number;
  trailingStop?: number;
  trailingActivePrice?: number;
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
