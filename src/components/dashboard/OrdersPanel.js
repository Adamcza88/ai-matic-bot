import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import Panel from "@/components/dashboard/Panel";
function parseTimestamp(value) {
    if (!value)
        return NaN;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed))
        return parsed;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
}
function asErrorMessage(err) {
    return err instanceof Error ? err.message : String(err ?? "unknown_error");
}
function getOrderTypeBadge(order) {
    const stopType = String(order.stopOrderType ?? "").trim().toLowerCase();
    const orderType = String(order.orderType ?? "").trim().toLowerCase();
    const typeHint = `${stopType} ${orderType}`.trim();
    if (!typeHint)
        return null;
    if (stopType === "tp" ||
        stopType === "takeprofit" ||
        typeHint.includes("takeprofit")) {
        return {
            label: "TP",
            className: "border-emerald-500/50 text-emerald-400",
        };
    }
    if (stopType === "sl" ||
        stopType === "stoploss" ||
        typeHint.includes("stoploss")) {
        return {
            label: "SL",
            className: "border-red-500/50 text-red-400",
        };
    }
    return null;
}
export default function OrdersPanel({ orders, ordersLoaded, ordersError, refreshOrders, trades, tradesLoaded, useTestnet, onCancelOrder, allowCancel = true, }) {
    const [filterMode, setFilterMode] = useState("all");
    const [selectedSymbol, setSelectedSymbol] = useState("");
    const [actionError, setActionError] = useState(null);
    const [closingOrderId, setClosingOrderId] = useState(null);
    const showActions = allowCancel !== false;
    const symbolOptions = useMemo(() => {
        const symbols = new Set();
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
    const canCancelOrder = (order) => {
        const status = String(order.status ?? "").trim().toLowerCase();
        if (!status)
            return true;
        if (status.includes("cancel") ||
            status.includes("reject") ||
            status.includes("filled")) {
            return false;
        }
        return (status === "new" ||
            status === "created" ||
            status === "untriggered" ||
            status === "open" ||
            status === "partiallyfilled");
    };
    const handleCancel = async (order) => {
        if (!showActions || !onCancelOrder)
            return;
        setActionError(null);
        setClosingOrderId(order.orderId);
        try {
            await onCancelOrder(order);
        }
        catch (err) {
            setActionError(asErrorMessage(err));
        }
        finally {
            setClosingOrderId((prev) => (prev === order.orderId ? null : prev));
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs(Panel, { title: useTestnet ? "Demo orders" : "Mainnet orders", action: _jsxs("div", { className: "flex items-center gap-2", children: [ordersError && (_jsx("span", { className: "max-w-[220px] truncate text-xs text-red-400", title: ordersError, children: ordersError })), _jsx(Button, { variant: "outline", size: "sm", onClick: refreshOrders, className: "h-8 text-xs", children: "Refresh" })] }), children: [_jsxs("div", { className: "mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { children: "Filter" }), _jsxs("div", { className: "flex items-center rounded-md border border-border/60 bg-background/60 p-0.5", children: [_jsx(Button, { variant: filterMode === "all" ? "secondary" : "ghost", size: "sm", onClick: () => setFilterMode("all"), className: filterMode === "all"
                                            ? "bg-muted text-foreground"
                                            : "text-muted-foreground hover:text-foreground", children: "All" }), _jsx(Button, { variant: filterMode === "symbol" ? "secondary" : "ghost", size: "sm", onClick: () => setFilterMode("symbol"), className: filterMode === "symbol"
                                            ? "bg-muted text-foreground"
                                            : "text-muted-foreground hover:text-foreground", children: "Selected symbol" }), _jsx(Button, { variant: filterMode === "last1h" ? "secondary" : "ghost", size: "sm", onClick: () => setFilterMode("last1h"), className: filterMode === "last1h"
                                            ? "bg-muted text-foreground"
                                            : "text-muted-foreground hover:text-foreground", children: "Last 1h" })] }), filterMode === "symbol" && (_jsx("div", { className: "min-w-[180px]", children: _jsxs(Select, { value: selectedSymbol, onValueChange: (value) => setSelectedSymbol(value), children: [_jsx(SelectTrigger, { className: "h-8 text-xs", children: _jsx(SelectValue, { placeholder: "Select symbol" }) }), _jsx(SelectContent, { children: symbolOptions.map((symbol) => (_jsx(SelectItem, { value: symbol, children: symbol }, symbol))) })] }) }))] }), actionError && (_jsxs("div", { className: "mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300", children: ["Order action failed: ", actionError] })), ordersError ? (_jsxs("div", { className: "rounded-lg border border-red-500/30 bg-red-500/5 py-6 text-center text-xs text-red-400", children: ["Orders API failed: ", ordersError] })) : !ordersLoaded ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "Loading orders..." })) : filteredOrders.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "No active orders." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "text-xs text-muted-foreground", children: _jsxs("tr", { className: "border-b border-border/60", children: [_jsx("th", { className: "py-2 text-left font-medium", children: "Symbol" }), _jsx("th", { className: "py-2 text-left font-medium", children: "Side" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Qty" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Price" }), _jsx("th", { className: "py-2 text-left font-medium", children: "Status" }), _jsx("th", { className: "py-2 text-left font-medium", children: "Time" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Actions" })] }) }), _jsx("tbody", { children: filteredOrders.map((order) => (_jsxs("tr", { className: "border-b border-border/40", children: [_jsx("td", { className: "py-3 font-mono", children: order.symbol }), _jsx("td", { className: "py-3", children: _jsx(Badge, { variant: "outline", className: order.side === "Buy"
                                                        ? "border-emerald-500/50 text-emerald-400"
                                                        : "border-red-500/50 text-red-400", children: order.side }) }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: Number.isFinite(order.qty) ? order.qty : "—" }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: (() => {
                                                    const price = typeof order.price === "number" &&
                                                        Number.isFinite(order.price) &&
                                                        order.price > 0
                                                        ? order.price
                                                        : null;
                                                    const trigger = typeof order.triggerPrice === "number" &&
                                                        Number.isFinite(order.triggerPrice) &&
                                                        order.triggerPrice > 0
                                                        ? order.triggerPrice
                                                        : null;
                                                    if (price) {
                                                        return (_jsxs("div", { className: "flex flex-col items-end", children: [_jsx("span", { children: price }), trigger && (_jsxs("span", { className: "text-[10px] uppercase text-muted-foreground", children: ["trg ", trigger] }))] }));
                                                    }
                                                    if (trigger) {
                                                        return (_jsxs("div", { className: "flex items-center justify-end gap-1", children: [_jsx("span", { className: "text-[10px] uppercase text-muted-foreground", children: "trg" }), _jsx("span", { children: trigger })] }));
                                                    }
                                                    return "mkt";
                                                })() }), _jsx("td", { className: "py-3 text-xs text-muted-foreground", children: _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [(() => {
                                                            const badge = getOrderTypeBadge(order);
                                                            return badge ? (_jsx(Badge, { variant: "outline", className: badge.className, children: badge.label })) : null;
                                                        })(), _jsx("span", { children: order.status || "—" })] }) }), _jsx("td", { className: "py-3 text-xs text-muted-foreground", children: order.createdTime
                                                    ? new Date(order.createdTime).toLocaleString()
                                                    : "—" }), _jsx("td", { className: "py-3 text-right text-xs text-muted-foreground", children: canCancelOrder(order)
                                                        ? _jsx(Button, { variant: "outline", size: "sm", className: "h-7 whitespace-nowrap border-sky-500/40 text-xs text-sky-300 hover:bg-sky-500/10 hover:text-white", onClick: () => handleCancel(order), disabled: closingOrderId === order.orderId, children: closingOrderId === order.orderId
                                                                ? "Closing..."
                                                                : "Close position" })
                                                        : "—" })] }, order.orderId))) })] }) }))] }), _jsx(Panel, { title: "Fills", children: !tradesLoaded ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "Loading fills..." })) : filteredTrades.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "No fills yet." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "text-xs text-muted-foreground", children: _jsxs("tr", { className: "border-b border-border/60", children: [_jsx("th", { className: "py-2 text-left font-medium", children: "Symbol" }), _jsx("th", { className: "py-2 text-left font-medium", children: "Side" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Qty" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Price" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Fee" }), _jsx("th", { className: "py-2 text-right font-medium", children: "PnL" }), _jsx("th", { className: "py-2 text-left font-medium", children: "Time" })] }) }), _jsx("tbody", { children: filteredTrades.map((trade) => (_jsxs("tr", { className: "border-b border-border/40", children: [_jsx("td", { className: "py-3 font-mono", children: trade.symbol }), _jsx("td", { className: "py-3", children: _jsx(Badge, { variant: "outline", className: trade.side === "Buy"
                                                    ? "border-emerald-500/50 text-emerald-400"
                                                    : "border-red-500/50 text-red-400", children: trade.side }) }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: Number.isFinite(trade.qty) ? trade.qty : "—" }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: Number.isFinite(trade.price) ? trade.price : "—" }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: Number.isFinite(trade.fee) ? trade.fee : "—" }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums text-muted-foreground", children: "\u2014" }), _jsx("td", { className: "py-3 text-xs text-muted-foreground", children: trade.time
                                                ? new Date(trade.time).toLocaleTimeString([], {
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                    second: "2-digit",
                                                })
                                                : "—" })] }, trade.id))) })] }) })) })] }));
}
