import { BybitAdapter } from "../bybit/bybitAdapter";
import { AuditLog } from "../infra/audit";
import { ExecutionState, Symbol } from "../domain/types";

export async function reconcile(
  bybit: BybitAdapter,
  audit: AuditLog,
  state: ExecutionState,
  setState: (s: ExecutionState) => void,
  symbol: Symbol
) {
  const snap = await bybit.getSnapshot(symbol);
  audit.write("snapshot", snap);

  // Normalize snapshot from the Bybit client to our state shape.
  const next: ExecutionState = {
    ...state,
    ts: Date.now(),
    status: state.status,
    orders: (snap.orders ?? []).map((o: any) => ({
      orderId: String(o.orderId ?? o.id),
      symbol,
      side: o.side ?? "Buy",
      price: Number(o.price ?? 0) || undefined,
      qty: Number(o.qty ?? 0) || undefined,
      status: String(o.orderStatus ?? o.status ?? "UNK"),
      reduceOnly: Boolean(o.reduceOnly),
    })),
    position: {
      symbol,
      side:
        (snap.position?.size ?? 0) === 0
          ? "FLAT"
          : snap.position?.side === "Buy"
            ? "LONG"
            : "SHORT",
      size: Number(snap.position?.size ?? 0),
      entryPrice: Number(snap.position?.entryPrice ?? 0) || undefined,
      unrealizedPnl:
        Number(
          snap.position?.unrealisedPnl ??
            snap.position?.unrealizedPnl ??
            0
        ) || undefined,
    },
  };

  // Desync marker
  const isDesync = false; // placeholder
  if (isDesync) {
    setState({ ...next, status: "DESYNC", reason: "STATE_MISMATCH" });
    return;
  }

  setState(next);
}
