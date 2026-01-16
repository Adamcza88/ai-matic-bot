import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TestnetOrder, TestnetTrade } from "@/types";
import Panel from "@/components/dashboard/Panel";

type OrdersPanelProps = {
  orders: TestnetOrder[];
  ordersLoaded: boolean;
  ordersError: string | null;
  refreshOrders: () => void;
  trades: TestnetTrade[];
  tradesLoaded: boolean;
  useTestnet: boolean;
  onCancelOrder: (order: TestnetOrder) => Promise<boolean> | void;
};

type FilterMode = "all" | "symbol" | "last1h";

function parseTimestamp(value?: string) {
  if (!value) return NaN;
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function asErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "unknown_error");
}

function getOrderTypeBadge(order: TestnetOrder) {
  const stopType = String(order.stopOrderType ?? "").trim().toLowerCase();
  const orderType = String(order.orderType ?? "").trim().toLowerCase();
  const typeHint = `${stopType} ${orderType}`.trim();
  if (!typeHint) return null;
  if (
    stopType === "tp" ||
    stopType === "takeprofit" ||
    typeHint.includes("takeprofit")
  ) {
    return {
      label: "TP",
      className: "border-emerald-500/50 text-emerald-400",
    };
  }
  if (
    stopType === "sl" ||
    stopType === "stoploss" ||
    typeHint.includes("stoploss")
  ) {
    return {
      label: "SL",
      className: "border-red-500/50 text-red-400",
    };
  }
  return null;
}

export default function OrdersPanel({
  orders,
  ordersLoaded,
  ordersError,
  refreshOrders,
  trades,
  tradesLoaded,
  useTestnet,
  onCancelOrder,
}: OrdersPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [closingOrderId, setClosingOrderId] = useState<string | null>(null);

  const symbolOptions = useMemo(() => {
    const symbols = new Set<string>();
    orders.forEach((o) => o.symbol && symbols.add(o.symbol));
    trades.forEach((t) => t.symbol && symbols.add(t.symbol));
    return Array.from(symbols).sort();
  }, [orders, trades]);

  useEffect(() => {
    if (!symbolOptions.length) {
      setSelectedSymbol("");
      return;
    }
    if (!symbolOptions.includes(selectedSymbol)) {
      setSelectedSymbol(symbolOptions[0]);
    }
  }, [symbolOptions, selectedSymbol]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (filterMode === "symbol" && selectedSymbol) {
        return order.symbol === selectedSymbol;
      }
      if (filterMode === "last1h") {
        const ts = parseTimestamp(order.createdTime);
        return Number.isFinite(ts) ? Date.now() - ts <= 60 * 60 * 1000 : true;
      }
      return true;
    });
  }, [orders, filterMode, selectedSymbol]);

  const filteredTrades = useMemo(() => {
    return trades.filter((trade) => {
      if (filterMode === "symbol" && selectedSymbol) {
        return trade.symbol === selectedSymbol;
      }
      if (filterMode === "last1h") {
        const ts = parseTimestamp(trade.time);
        return Number.isFinite(ts) ? Date.now() - ts <= 60 * 60 * 1000 : true;
      }
      return true;
    });
  }, [trades, filterMode, selectedSymbol]);

  const handleCancel = async (order: TestnetOrder) => {
    setActionError(null);
    setClosingOrderId(order.orderId);
    try {
      await onCancelOrder(order);
    } catch (err) {
      setActionError(asErrorMessage(err));
    } finally {
      setClosingOrderId((prev) => (prev === order.orderId ? null : prev));
    }
  };

  return (
    <div className="space-y-6">
      <Panel
        title={useTestnet ? "Demo orders" : "Mainnet orders"}
        action={
          <div className="flex items-center gap-2">
            {ordersError && (
              <span
                className="max-w-[220px] truncate text-xs text-red-400"
                title={ordersError}
              >
                {ordersError}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={refreshOrders}
              className="h-8 text-xs"
            >
              Refresh
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Filter</span>
          <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
            <Button
              variant={filterMode === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterMode("all")}
              className={
                filterMode === "all"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              All
            </Button>
            <Button
              variant={filterMode === "symbol" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterMode("symbol")}
              className={
                filterMode === "symbol"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Selected symbol
            </Button>
            <Button
              variant={filterMode === "last1h" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterMode("last1h")}
              className={
                filterMode === "last1h"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Last 1h
            </Button>
          </div>
          {filterMode === "symbol" && (
            <div className="min-w-[180px]">
              <Select
                value={selectedSymbol}
                onValueChange={(value) => setSelectedSymbol(value)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select symbol" />
                </SelectTrigger>
                <SelectContent>
                  {symbolOptions.map((symbol) => (
                    <SelectItem key={symbol} value={symbol}>
                      {symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {actionError && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
            Order action failed: {actionError}
          </div>
        )}

        {ordersError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 py-6 text-center text-xs text-red-400">
            Orders API failed: {ordersError}
          </div>
        ) : !ordersLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Loading orders...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            No active orders.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left font-medium">Symbol</th>
                  <th className="py-2 text-left font-medium">Side</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Price</th>
                  <th className="py-2 text-left font-medium">Status</th>
                  <th className="py-2 text-left font-medium">Time</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.orderId} className="border-b border-border/40">
                    <td className="py-3 font-mono">{order.symbol}</td>
                    <td className="py-3">
                      <Badge
                        variant="outline"
                        className={
                          order.side === "Buy"
                            ? "border-emerald-500/50 text-emerald-400"
                            : "border-red-500/50 text-red-400"
                        }
                      >
                        {order.side}
                      </Badge>
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {Number.isFinite(order.qty) ? order.qty : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {(() => {
                        const price =
                          typeof order.price === "number" &&
                          Number.isFinite(order.price) &&
                          order.price > 0
                            ? order.price
                            : null;
                        const trigger =
                          typeof order.triggerPrice === "number" &&
                          Number.isFinite(order.triggerPrice) &&
                          order.triggerPrice > 0
                            ? order.triggerPrice
                            : null;
                        if (price) {
                          return (
                            <div className="flex flex-col items-end">
                              <span>{price}</span>
                              {trigger && (
                                <span className="text-[10px] uppercase text-muted-foreground">
                                  trg {trigger}
                                </span>
                              )}
                            </div>
                          );
                        }
                        if (trigger) {
                          return (
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-[10px] uppercase text-muted-foreground">
                                trg
                              </span>
                              <span>{trigger}</span>
                            </div>
                          );
                        }
                        return "mkt";
                      })()}
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const badge = getOrderTypeBadge(order);
                          return badge ? (
                            <Badge variant="outline" className={badge.className}>
                              {badge.label}
                            </Badge>
                          ) : null;
                        })()}
                        <span>{order.status || "—"}</span>
                      </div>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {order.createdTime
                        ? new Date(order.createdTime).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-3 text-right text-xs text-muted-foreground">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 whitespace-nowrap border-sky-500/40 text-xs text-sky-300 hover:bg-sky-500/10 hover:text-white"
                        onClick={() => handleCancel(order)}
                        disabled={closingOrderId === order.orderId}
                      >
                        {closingOrderId === order.orderId
                          ? "Closing..."
                          : "Close position"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Fills">
        {!tradesLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Loading fills...
          </div>
        ) : filteredTrades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            No fills yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left font-medium">Symbol</th>
                  <th className="py-2 text-left font-medium">Side</th>
                  <th className="py-2 text-right font-medium">Qty</th>
                  <th className="py-2 text-right font-medium">Price</th>
                  <th className="py-2 text-right font-medium">Fee</th>
                  <th className="py-2 text-right font-medium">PnL</th>
                  <th className="py-2 text-left font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border/40">
                    <td className="py-3 font-mono">{trade.symbol}</td>
                    <td className="py-3">
                      <Badge
                        variant="outline"
                        className={
                          trade.side === "Buy"
                            ? "border-emerald-500/50 text-emerald-400"
                            : "border-red-500/50 text-red-400"
                        }
                      >
                        {trade.side}
                      </Badge>
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {Number.isFinite(trade.qty) ? trade.qty : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {Number.isFinite(trade.price) ? trade.price : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {Number.isFinite(trade.fee) ? trade.fee : "—"}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-muted-foreground">
                      —
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">
                      {trade.time
                        ? new Date(trade.time).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
