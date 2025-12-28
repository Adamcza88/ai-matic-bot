import {
  BybitAdapter,
  PlaceOrderReq,
  PlaceOrderRes,
  Snapshot,
} from "./bybitAdapter";
import { BybitV5Client } from "./bybitV5Client";
import { Symbol } from "../domain/types";

function roundDownToStep(x: number, step: number) {
  const k = Math.floor(x / step);
  return Number((k * step).toFixed(12));
}

export class BybitV5AdapterImpl implements BybitAdapter {
  constructor(private v5: BybitV5Client) {}

  async placeOrder(req: PlaceOrderReq): Promise<PlaceOrderRes> {
    const res: any = await this.v5.rest.placeOrder({
      category: "linear",
      symbol: req.symbol,
      side: req.side,
      orderType: req.orderType,
      qty: String(req.qty),
      price: req.price != null ? String(req.price) : undefined,
      timeInForce: req.timeInForce,
      reduceOnly: req.reduceOnly ? true : false,
      positionIdx: req.positionIdx ?? 0,
      postOnly: req.postOnly ? true : false,
      orderLinkId: req.clientOrderId,
    });

    const orderId = String(res?.result?.orderId ?? "");
    if (!orderId) throw new Error("PLACE_ORDER_FAILED");

    return { orderId };
  }

  async cancelOrder(symbol: Symbol, orderId: string): Promise<{ ok: true }> {
    await this.v5.rest.cancelOrder({
      category: "linear",
      symbol,
      orderId,
    });
    return { ok: true };
  }

  async cancelAll(symbol: Symbol): Promise<void> {
    await this.v5.rest.cancelAllOrders({
      category: "linear",
      symbol,
    });
  }

  async getSnapshot(symbol: Symbol): Promise<Snapshot> {
    const [orders, pos] = await Promise.all([
      this.v5.rest.getOpenOrders({ category: "linear", symbol }),
      this.v5.rest.getPositionInfo({ category: "linear", symbol }),
    ]);

    return {
      orders: orders?.result?.list ?? [],
      position: (pos?.result?.list ?? [])[0] ?? {},
    };
  }

  async notionalToQty(symbol: Symbol, notionalUSDT: number): Promise<number> {
    const [spec, lastPrice] = await Promise.all([
      this.v5.getInstrument(symbol),
      this.v5.getLastPrice(symbol),
    ]);

    const rawQty = notionalUSDT / lastPrice;
    const stepped = roundDownToStep(rawQty, spec.qtyStep);
    return Math.max(stepped, spec.minOrderQty);
  }

  async setTradingStop(args: {
    symbol: Symbol;
    stopLoss: number;
    takeProfit?: number;
  }) {
    await this.v5.rest.setTradingStop({
      category: "linear",
      symbol: args.symbol,
      positionIdx: 0,
      stopLoss: String(args.stopLoss),
      takeProfit: args.takeProfit != null ? String(args.takeProfit) : undefined,
      tpslMode: "Full",
    });
  }
}
