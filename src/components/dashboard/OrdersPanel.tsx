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
import { RefreshCw, X } from "lucide-react";
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
  onCancelOrder?: (
    order: TestnetOrder
  ) => boolean | undefined | Promise<boolean | undefined>;
  allowCancel?: boolean;
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

function getOrderTypeTag(order: TestnetOrder) {
  const stopType = String(order.stopOrderType ?? "").trim().toLowerCase();
  const orderType = String(order.orderType ?? "").trim().toLowerCase();
  const typeHint = `${stopType} ${orderType}`.trim();
  if (!typeHint) return "—";
  if (
    stopType === "tp" ||
    stopType === "takeprofit" ||
    typeHint.includes("takeprofit")
  ) {
    return "TP";
  }
  if (
    stopType === "sl" ||
    stopType === "stoploss" ||
    typeHint.includes("stoploss")
  ) {
    return "SL";
  }
  return "—";
}

function formatOrderStatus(status?: string) {
  const value = String(status ?? "").trim();
  if (!value) return "—";
  if (value.toLowerCase() === "untriggered") return "Neaktivní";
  return value;
}

function formatOrderTime(value?: string) {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatQty(value?: number) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "—";
}

function formatPrice(value?: number | null) {
  return Number.isFinite(value) ? Number(value).toFixed(4) : "—";
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
  allowCancel = true,
}: OrdersPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [closingOrderId, setClosingOrderId] = useState<string | null>(null);
  const showActions = allowCancel !== false;

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

  const canCancelOrder = (order: TestnetOrder) => {
    const status = String(order.status ?? "").trim().toLowerCase();
    if (!status) return true;
    if (
      status.includes("cancel") ||
      status.includes("reject") ||
      status.includes("filled")
    ) {
      return false;
    }
    return (
      status === "new" ||
      status === "created" ||
      status === "untriggered" ||
      status === "open" ||
      status === "partiallyfilled"
    );
  };

  const handleCancel = async (order: TestnetOrder) => {
    if (!showActions || !onCancelOrder) return;
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
        title={useTestnet ? "Příkazy (demo)" : "Příkazy (mainnet)"}
        fileId="ORDER MODULE ID: TR-05-O"
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
              size="icon"
              onClick={refreshOrders}
              className="h-8 w-8 dm-button-control"
              title="Obnovit příkazy"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Filtr</span>
          <div className="flex items-center rounded-md border border-border/60 bg-card/95 p-0.5 dm-surface-elevated dm-border-soft">
            <Button
              variant={filterMode === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterMode("all")}
              className={`dm-button-control ${
                filterMode === "all"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Vše
            </Button>
            <Button
              variant={filterMode === "symbol" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterMode("symbol")}
              className={`dm-button-control ${
                filterMode === "symbol"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Trh
            </Button>
            <Button
              variant={filterMode === "last1h" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setFilterMode("last1h")}
              className={`dm-button-control ${
                filterMode === "last1h"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Poslední 1 h
            </Button>
          </div>
          {filterMode === "symbol" && (
            <div className="min-w-[180px]">
              <Select
                value={selectedSymbol}
                onValueChange={(value) => setSelectedSymbol(value)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Vyberte trh" />
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
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300 dm-status-warn">
            Akce s příkazem se nezdařila: {actionError}. Zkuste obnovit data a opakovat.
          </div>
        )}

        {ordersError ? (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 py-6 text-center text-xs text-red-400 dm-status-sell">
            Načtení příkazů selhalo: {ordersError}. Zkontrolujte připojení a API klíče.
          </div>
        ) : !ordersLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám příkazy…
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Žádné aktivní příkazy.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm lm-table dm-table">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="w-[120px] py-2 text-left font-medium">Symbol</th>
                  <th className="w-[84px] py-2 text-left font-medium">Směr</th>
                  <th className="w-[92px] py-2 text-right font-medium">Objem</th>
                  <th className="w-[120px] py-2 text-right font-medium">Cena</th>
                  <th className="w-[120px] py-2 text-right font-medium">TRG</th>
                  <th className="w-[76px] py-2 text-left font-medium">Typ</th>
                  <th className="w-[140px] py-2 text-left font-medium">Stav</th>
                  <th className="w-[90px] py-2 text-right font-medium">Čas</th>
                  {showActions && <th className="w-[72px] py-2 text-right font-medium"> </th>}
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.orderId} className="border-b border-border/40 lm-table-row">
                    <td className="py-3 font-mono">{order.symbol}</td>
                    <td className="py-3">
                      <Badge
                        variant="outline"
                        className={
                          order.side === "Buy"
                            ? "border-emerald-500/50 text-emerald-400 dm-status-pass"
                            : "border-red-500/50 text-red-400 dm-status-sell"
                        }
                      >
                        {order.side}
                      </Badge>
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatQty(order.qty)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatPrice(order.price)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatPrice(order.triggerPrice)}
                    </td>
                    <td className="py-3 text-left text-xs">
                      <Badge variant="outline" className="border-border/60 text-muted-foreground dm-status-muted">
                        {getOrderTypeTag(order)}
                      </Badge>
                    </td>
                    <td className="py-3 text-xs text-muted-foreground">{formatOrderStatus(order.status)}</td>
                    <td className="py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {formatOrderTime(order.createdTime)}
                    </td>
                    {showActions && (
                      <td className="py-3 text-right text-xs text-muted-foreground">
                        {canCancelOrder(order) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 border border-border/60 dm-button-control"
                            onClick={() => handleCancel(order)}
                            disabled={closingOrderId === order.orderId}
                            title={closingOrderId === order.orderId ? "Ruším…" : "Zrušit příkaz"}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Filly" fileId="EXECUTION LEDGER ID: TR-06-F">
        {!tradesLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám filly…
          </div>
        ) : filteredTrades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Zatím bez fillů.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm lm-table dm-table">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left font-medium">Symbol</th>
                  <th className="py-2 text-left font-medium">Směr</th>
                  <th className="py-2 text-right font-medium">Objem</th>
                  <th className="py-2 text-right font-medium">Cena</th>
                  <th className="py-2 text-right font-medium">Poplatek</th>
                  <th className="py-2 text-right font-medium">PnL</th>
                  <th className="py-2 text-right font-medium">Čas</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-border/40 lm-table-row">
                    <td className="py-3 font-mono">{trade.symbol}</td>
                    <td className="py-3">
                      <Badge
                        variant="outline"
                        className={
                          trade.side === "Buy"
                            ? "border-emerald-500/50 text-emerald-400 dm-status-pass"
                            : "border-red-500/50 text-red-400 dm-status-sell"
                        }
                      >
                        {trade.side}
                      </Badge>
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">{formatQty(trade.qty)}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{formatPrice(trade.price)}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{formatPrice(trade.fee)}</td>
                    <td className="py-3 text-right font-mono tabular-nums text-muted-foreground">—</td>
                    <td className="py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {formatOrderTime(trade.time)}
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
