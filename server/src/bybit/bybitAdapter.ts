import { Symbol, Side } from "../domain/types";

export type PlaceOrderReq = {
  symbol: Symbol;
  side: Side;
  orderType: "Limit" | "Market";
  qty: number; // base qty
  price?: number; // for Limit
  timeInForce: "GTC" | "IOC";
  postOnly?: boolean;
  reduceOnly?: boolean;
  positionIdx?: number; // one-way => 0
  clientOrderId?: string;
};

export type PlaceOrderRes = { orderId: string };

export type CancelOrderRes = { ok: true };

export type Snapshot = {
  orders: any[];
  position: any;
};

export interface BybitAdapter {
  placeOrder(req: PlaceOrderReq): Promise<PlaceOrderRes>;
  cancelOrder(symbol: Symbol, orderId: string): Promise<CancelOrderRes>;
  cancelAll(symbol: Symbol): Promise<void>;
  getSnapshot(symbol: Symbol): Promise<Snapshot>;
}
