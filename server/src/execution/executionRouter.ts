import { AuditLog } from "../infra/audit";
import { IdempotencyStore } from "../infra/idempotency";
import { ExecutionState, TradeIntent, Symbol } from "../domain/types";
import { BybitV5AdapterImpl } from "../bybit/bybitV5AdapterImpl";

type Ctx = {
  bybit: BybitV5AdapterImpl;
  audit: AuditLog;
  idem: IdempotencyStore;
  state: ExecutionState;
  setState: (s: ExecutionState) => void;
  isMarketStale: () => boolean;
  isPrivateStale: () => boolean;
};

function setStatus(
  ctx: Ctx,
  status: ExecutionState["status"],
  extra?: Partial<ExecutionState>
) {
  ctx.setState({ ...ctx.state, ...extra, ts: Date.now(), status });
}

export async function handleIntent(ctx: Ctx, intent: TradeIntent) {
  if (ctx.isMarketStale() || ctx.isPrivateStale()) {
    setStatus(ctx, "STALE_DATA", { lastIntentId: intent.intentId });
    return;
  }

  ctx.audit.write("intent", intent);
  setStatus(ctx, "INTENT_ACCEPTED", {
    lastIntentId: intent.intentId,
    reason: undefined,
  });

  if (intent.entryType === "MARKET_DISABLED") {
    setStatus(ctx, "REJECTED", { reason: "MARKET_DISABLED" });
    return;
  }
  if (!intent.entryPrice) {
    setStatus(ctx, "REJECTED", { reason: "MISSING_ENTRY_PRICE" });
    return;
  }

  const baseQty =
    intent.qtyMode === "BASE_QTY"
      ? intent.qtyValue
      : await ctx.bybit.notionalToQty(intent.symbol, intent.qtyValue);

  const idemKey = `place:${intent.intentId}:entry`;
  const cached = ctx.idem.get(idemKey) as any;
  if (cached?.orderId) {
    setStatus(ctx, "ENTRY_PLACED");
    return;
  }

  const postOnly = intent.entryType === "LIMIT_MAKER_FIRST";

  const res = await ctx.bybit.placeOrder({
    symbol: intent.symbol,
    side: intent.side,
    orderType: "Limit",
    qty: baseQty,
    price: intent.entryPrice,
    timeInForce: "GTC",
    postOnly,
    reduceOnly: false,
    positionIdx: 0,
    clientOrderId: intent.intentId,
  });

  ctx.idem.set(idemKey, res);
  ctx.audit.write("order_place", { intentId: intent.intentId, res });

  setStatus(ctx, "ENTRY_PLACED", {
    orders: [
      {
        orderId: res.orderId,
        symbol: intent.symbol,
        side: intent.side,
        price: intent.entryPrice,
        qty: baseQty,
        status: "NEW",
        reduceOnly: false,
      },
    ],
  });

  const tp1 = intent.tpPrices?.[0];
  await ctx.bybit.setTradingStop({
    symbol: intent.symbol,
    stopLoss: intent.slPrice,
    takeProfit: tp1,
    trailingStop: intent.trailingStop,
    trailingActivePrice: intent.trailingActivePrice,
  });

  setTimeout(async () => {
    const s = ctx.state;
    if (s.lastIntentId !== intent.intentId) return;
    if (s.status !== "ENTRY_PLACED") return;

    try {
      await ctx.bybit.cancelAll(intent.symbol);
      ctx.audit.write("entry_timeout_cancel", {
        intentId: intent.intentId,
        symbol: intent.symbol,
      });
      setStatus(ctx, "FLAT", { reason: "ENTRY_TIMEOUT", orders: [] });
    } catch (e) {
      ctx.audit.write("entry_timeout_cancel_error", { e: String(e) });
    }
  }, intent.expireAfterMs);
}

export async function killSwitch(ctx: Ctx, symbol: Symbol) {
  ctx.audit.write("kill_switch", { symbol });
  await ctx.bybit.cancelAll(symbol);
  setStatus(ctx, "FLAT", { reason: "KILL_SWITCH", orders: [] });
}
