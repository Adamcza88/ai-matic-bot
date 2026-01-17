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

const LEVERAGE_BY_SYMBOL: Record<Symbol, number> = {
  BTCUSDT: 100,
  ETHUSDT: 100,
  SOLUSDT: 100,
  ADAUSDT: 75,
  XRPUSDT: 75,
  XMRUSDT: 25,
  DOGEUSDT: 75,
  LINKUSDT: 50,
  MELANIAUSDT: 20,
  XPLUSDT: 75,
  HYPEUSDT: 75,
  FARTCOINUSDT: 75,
};

const lastLeverageBySymbol = new Map<Symbol, number>();

async function ensureLeverage(ctx: Ctx, symbol: Symbol) {
  const target = LEVERAGE_BY_SYMBOL[symbol] ?? 1;
  const last = lastLeverageBySymbol.get(symbol);
  if (last === target) return;
  await ctx.bybit.setLeverage(symbol, target);
  lastLeverageBySymbol.set(symbol, target);
}

function setStatus(
  ctx: Ctx,
  status: ExecutionState["status"],
  extra?: Partial<ExecutionState>
) {
  ctx.setState({ ...ctx.state, ...extra, ts: Date.now(), status });
}

async function waitForPositionOpen(
  ctx: Ctx,
  symbol: Symbol,
  timeoutMs: number,
  intervalMs = 1000
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() < deadline) {
    try {
      const snap = await ctx.bybit.getSnapshot(symbol);
      const size = Number(
        snap?.position?.size ?? snap?.position?.qty ?? 0
      );
      if (Number.isFinite(size) && Math.abs(size) > 0) return true;
    } catch {
      // ignore transient polling errors
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
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

  try {
    await ensureLeverage(ctx, intent.symbol);
  } catch (e) {
    ctx.audit.write("leverage_set_error", {
      intentId: intent.intentId,
      symbol: intent.symbol,
      error: String(e),
    });
    setStatus(ctx, "REJECTED", { reason: "LEVERAGE_SET_FAILED" });
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

  const tp1 = intent.tpPrices?.[0];
  void (async () => {
    const waitMs = Math.max(0, Math.min(intent.expireAfterMs, 30_000));
    const ready = await waitForPositionOpen(ctx, intent.symbol, waitMs);
    if (!ready) {
      ctx.audit.write("trading_stop_skipped", {
        intentId: intent.intentId,
        symbol: intent.symbol,
        reason: "POSITION_NOT_OPEN",
      });
      return;
    }
    try {
      await ctx.bybit.setTradingStop({
        symbol: intent.symbol,
        stopLoss: intent.slPrice,
        takeProfit: tp1,
        trailingStop: intent.trailingStop,
        trailingActivePrice: intent.trailingActivePrice,
      });
      ctx.audit.write("trading_stop_set", {
        intentId: intent.intentId,
        symbol: intent.symbol,
      });
    } catch (e) {
      ctx.audit.write("trading_stop_error", {
        intentId: intent.intentId,
        symbol: intent.symbol,
        error: String(e),
      });
    }
  })();
}

export async function killSwitch(ctx: Ctx, symbol: Symbol) {
  ctx.audit.write("kill_switch", { symbol });
  await ctx.bybit.cancelAll(symbol);
  setStatus(ctx, "FLAT", { reason: "KILL_SWITCH", orders: [] });
}
