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
import {
  computeExecutionAnalytics,
  type LifecycleStage,
} from "@/lib/executionAnalytics";
import { formatMoney, formatSignedMoney } from "@/lib/uiFormat";

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
const FILLS_PAGE_SIZE = 10;
const MAX_HEAT_ROWS = 24;
const MAX_SLICE_ROWS = 12;
const MAX_CHURN_ROWS = 8;

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
  if (value.toLowerCase() === "untriggered") return "Čekající";
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

function formatSigned(value?: number) {
  if (!Number.isFinite(value)) return "—";
  return formatSignedMoney(value, "USD");
}

function formatLatency(value?: number) {
  if (!Number.isFinite(value)) return "N/A";
  return `${Math.round(value as number)} ms`;
}

function formatBasisPoints(value?: number) {
  if (!Number.isFinite(value)) return "N/A";
  return `${(value as number).toFixed(2)} bps`;
}

function formatId(value?: string) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-6)}` : text;
}

function lifecycleClass(stage: LifecycleStage) {
  if (stage === "ENTRY") return "border-emerald-500/50 text-emerald-400";
  if (stage === "PARTIAL") return "border-amber-500/50 text-amber-300";
  if (stage === "EXIT") return "border-sky-500/50 text-sky-300";
  if (stage === "REDUCE") return "border-orange-500/50 text-orange-300";
  if (stage === "REVERSE") return "border-violet-500/50 text-violet-300";
  return "border-border/60 text-muted-foreground";
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
  const [fillsPage, setFillsPage] = useState(1);
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

  const sortedTrades = useMemo(() => {
    return [...filteredTrades].sort((a, b) => {
      const aTs = parseTimestamp(a.time);
      const bTs = parseTimestamp(b.time);
      const aValid = Number.isFinite(aTs);
      const bValid = Number.isFinite(bTs);
      if (aValid && bValid && aTs !== bTs) return bTs - aTs;
      if (aValid && !bValid) return -1;
      if (!aValid && bValid) return 1;
      return String(b.id).localeCompare(String(a.id));
    });
  }, [filteredTrades]);

  const executionAnalytics = useMemo(
    () => computeExecutionAnalytics(sortedTrades),
    [sortedTrades]
  );
  const analyzedTrades = executionAnalytics.fills;
  const slicedRows = executionAnalytics.sliceSequences
    .filter((row) => row.fillCount > 1)
    .slice(0, MAX_SLICE_ROWS);
  const churnRows = executionAnalytics.churnClusters.slice(0, MAX_CHURN_ROWS);
  const heatRows = executionAnalytics.heatmap.slice(-MAX_HEAT_ROWS);

  const fillsPageCount = Math.max(
    1,
    Math.ceil(analyzedTrades.length / FILLS_PAGE_SIZE)
  );
  const fillsPageStart = (fillsPage - 1) * FILLS_PAGE_SIZE;
  const pagedTrades = useMemo(
    () => analyzedTrades.slice(fillsPageStart, fillsPageStart + FILLS_PAGE_SIZE),
    [analyzedTrades, fillsPageStart]
  );

  useEffect(() => {
    setFillsPage(1);
  }, [filterMode, selectedSymbol]);

  useEffect(() => {
    setFillsPage((prev) => Math.min(prev, fillsPageCount));
  }, [fillsPageCount]);

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
                      {formatPrice(order.shownPrice ?? order.price)}
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
        ) : analyzedTrades.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Zatím bez fillů.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
              <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                Fill count:{" "}
                <span className="font-semibold tabular-nums">
                  {executionAnalytics.totals.trades}
                </span>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                Total fee:{" "}
                <span className="font-semibold tabular-nums">
                  {formatMoney(executionAnalytics.totals.totalFee, "USD")}
                </span>
              </div>
              <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                Reconstructed realized:{" "}
                <span className="font-semibold tabular-nums">
                  {formatSigned(executionAnalytics.totals.netResult)}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Stránka {fillsPage}/{fillsPageCount}
              </span>
              <span>
                Zobrazeno {fillsPageStart + 1}-
                {Math.min(fillsPageStart + FILLS_PAGE_SIZE, analyzedTrades.length)} z{" "}
                {analyzedTrades.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1360px] text-sm lm-table dm-table">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="py-2 text-left font-medium">Symbol</th>
                    <th className="py-2 text-left font-medium">Směr</th>
                    <th className="py-2 text-left font-medium">Lifecycle</th>
                    <th className="py-2 text-right font-medium">Objem</th>
                    <th className="py-2 text-right font-medium">Cena</th>
                    <th className="py-2 text-right font-medium">Poplatek</th>
                    <th className="py-2 text-right font-medium">Realized PnL</th>
                    <th className="py-2 text-left font-medium">Liquidity</th>
                    <th className="py-2 text-left font-medium">Reduce</th>
                    <th className="py-2 text-left font-medium">Order ID</th>
                    <th className="py-2 text-left font-medium">Trade ID</th>
                    <th className="py-2 text-right font-medium">Čas</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTrades.map((trade, idx) => (
                    <tr
                      key={`${trade.id}:${trade.time}:${idx}`}
                      className="border-b border-border/40 lm-table-row"
                    >
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
                      <td className="py-3">
                        <Badge
                          variant="outline"
                          className={lifecycleClass(trade.lifecycle)}
                        >
                          {trade.lifecycle}
                        </Badge>
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {formatQty(trade.qty)}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {formatPrice(trade.price)}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {formatPrice(trade.feePaid ?? trade.fee)}
                      </td>
                      <td
                        className={`py-3 text-right font-mono tabular-nums ${
                          Number.isFinite(trade.realizedPnlDelta)
                            ? trade.realizedPnlDelta >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatSigned(trade.realizedPnlDelta)}
                      </td>
                      <td className="py-3 text-left text-xs font-medium uppercase text-muted-foreground">
                        {trade.liquidity ?? "unknown"}
                      </td>
                      <td className="py-3 text-left text-xs text-muted-foreground">
                        {trade.reduceOnly ? "YES" : "—"}
                      </td>
                      <td
                        className="py-3 font-mono text-xs text-muted-foreground"
                        title={trade.orderId}
                      >
                        {formatId(trade.orderId)}
                      </td>
                      <td
                        className="py-3 font-mono text-xs text-muted-foreground"
                        title={trade.tradeId}
                      >
                        {formatId(trade.tradeId)}
                      </td>
                      <td className="py-3 text-right text-xs tabular-nums text-muted-foreground">
                        {formatOrderTime(trade.time)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {fillsPageCount > 1 ? (
              <div className="flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs dm-button-control"
                  onClick={() => setFillsPage((prev) => Math.max(1, prev - 1))}
                  disabled={fillsPage <= 1}
                >
                  Předchozí
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs dm-button-control"
                  onClick={() =>
                    setFillsPage((prev) => Math.min(fillsPageCount, prev + 1))
                  }
                  disabled={fillsPage >= fillsPageCount}
                >
                  Další
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Fee Burn a Audit" fileId="EXECUTION AUDIT ID: TR-06-F-AUDIT">
        {!tradesLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám fee audit…
          </div>
        ) : executionAnalytics.auditRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Audit bez dat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm lm-table dm-table">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left font-medium">Symbol</th>
                  <th className="py-2 text-right font-medium">Trades</th>
                  <th className="py-2 text-right font-medium">Total fee</th>
                  <th className="py-2 text-right font-medium">Fee / trade</th>
                  <th className="py-2 text-right font-medium">Net result</th>
                  <th className="py-2 text-right font-medium">ENTRY</th>
                  <th className="py-2 text-right font-medium">PARTIAL</th>
                  <th className="py-2 text-right font-medium">EXIT</th>
                </tr>
              </thead>
              <tbody>
                {executionAnalytics.auditRows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border/40 lm-table-row">
                    <td className="py-3 font-mono">{row.symbol}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{row.trades}</td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatMoney(row.totalFee, "USD")}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatMoney(row.feePerTrade, "USD")}
                    </td>
                    <td
                      className={`py-3 text-right font-mono tabular-nums ${
                        row.netResult >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {formatSigned(row.netResult)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">{row.entryCount}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{row.partialCount}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{row.exitCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Churn a Slicing" fileId="EXECUTION CHURN ID: TR-06-F-CHURN">
        {!tradesLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám churn analýzu…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Slice validace (symbol + čas + cena)
              </div>
              {slicedRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">
                  Bez slice sekvencí.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm lm-table dm-table">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border/60">
                        <th className="py-2 text-left font-medium">Symbol</th>
                        <th className="py-2 text-right font-medium">Fill count</th>
                        <th className="py-2 text-right font-medium">Avg fill size</th>
                        <th className="py-2 text-right font-medium">Target size</th>
                        <th className="py-2 text-right font-medium">Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {slicedRows.map((row) => (
                        <tr key={row.key} className="border-b border-border/40 lm-table-row">
                          <td className="py-3 font-mono">{row.symbol}</td>
                          <td className="py-3 text-right font-mono tabular-nums">{row.fillCount}</td>
                          <td className="py-3 text-right font-mono tabular-nums">
                            {formatQty(row.avgFillSize)}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums">
                            {formatQty(row.targetPositionSize)}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums">
                            {formatMoney(row.totalFee, "USD")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Churn alert (window 1s, count &gt; 3)
              </div>
              {churnRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 py-6 text-center text-xs text-muted-foreground">
                  Churn pattern nedetekován.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm lm-table dm-table">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border/60">
                        <th className="py-2 text-left font-medium">Symbol</th>
                        <th className="py-2 text-right font-medium">Cena</th>
                        <th className="py-2 text-right font-medium">Fill count</th>
                        <th className="py-2 text-right font-medium">Objem</th>
                        <th className="py-2 text-right font-medium">Čas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {churnRows.map((row) => (
                        <tr key={row.key} className="border-b border-border/40 lm-table-row">
                          <td className="py-3 font-mono">{row.symbol}</td>
                          <td className="py-3 text-right font-mono tabular-nums">
                            {formatPrice(row.price)}
                          </td>
                          <td className="py-3 text-right font-mono tabular-nums">{row.fillCount}</td>
                          <td className="py-3 text-right font-mono tabular-nums">
                            {formatQty(row.totalQty)}
                          </td>
                          <td className="py-3 text-right text-xs tabular-nums text-muted-foreground">
                            {formatOrderTime(new Date(row.secondBucketMs).toISOString())}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Execution Heatmap" fileId="EXECUTION HEATMAP ID: TR-06-F-H">
        {!tradesLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám heatmapu…
          </div>
        ) : heatRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Heatmap bez dat.
          </div>
        ) : (
          <div className="space-y-2">
            {heatRows.map((row) => (
              <div key={row.minuteBucketMs} className="flex items-center gap-3 text-xs">
                <span className="w-16 font-mono tabular-nums text-muted-foreground">
                  {row.label}
                </span>
                <div className="h-2 flex-1 rounded-full bg-background/60">
                  <div
                    className="h-2 rounded-full bg-emerald-500/70"
                    style={{ width: `${Math.max(6, row.intensity * 100)}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono tabular-nums">{row.tradeCount}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Diagnostika exekučního modulu"
        description="execution_latency a slippage jsou odhad z fill sekvencí ve stejném burstu."
        fileId="MODULE ID: TR-06-F"
      >
        {!tradesLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám diagnostiku modulu…
          </div>
        ) : executionAnalytics.diagnosticsRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Diagnostika bez dat.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm lm-table dm-table">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="py-2 text-left font-medium">Symbol</th>
                  <th className="py-2 text-right font-medium">fill_count</th>
                  <th className="py-2 text-right font-medium">burst_count</th>
                  <th className="py-2 text-right font-medium">avg_burst_fills</th>
                  <th className="py-2 text-right font-medium">execution_latency</th>
                  <th className="py-2 text-right font-medium">slippage</th>
                </tr>
              </thead>
              <tbody>
                {executionAnalytics.diagnosticsRows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border/40 lm-table-row">
                    <td className="py-3 font-mono">{row.symbol}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{row.fillCount}</td>
                    <td className="py-3 text-right font-mono tabular-nums">{row.burstCount}</td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatQty(row.avgBurstFillCount)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatLatency(row.avgLatencyMs)}
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums">
                      {formatBasisPoints(row.avgSlippageBps)}
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
