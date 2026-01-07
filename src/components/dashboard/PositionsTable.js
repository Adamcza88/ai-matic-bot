import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import Panel from "@/components/dashboard/Panel";
function formatNumber(value, digits = 4) {
    return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
function formatMoney(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
export default function PositionsTable({ positions, positionsLoaded, onClosePosition, }) {
    const [expandedRows, setExpandedRows] = useState({});
    const rows = useMemo(() => {
        return positions.map((p) => {
            const size = Number(p.size ?? p.qty);
            const sideLower = String(p.side ?? "").toLowerCase();
            const isBuy = sideLower === "buy";
            const trail = Number(p.currentTrailingStop);
            const slValue = Number(p.sl);
            const sl = Number.isFinite(trail) && trail > 0
                ? trail
                : Number.isFinite(slValue)
                    ? slValue
                    : undefined;
            const tpValue = Number(p.tp);
            const tp = Number.isFinite(tpValue) ? tpValue : undefined;
            const upnl = Number(p.unrealizedPnl ?? p.pnl ?? p.pnlValue);
            const slMissing = !Number.isFinite(sl) || sl <= 0;
            const tpMissing = !Number.isFinite(tp) || tp <= 0;
            const protectionLabel = slMissing && tpMissing
                ? "TP/SL pending"
                : slMissing
                    ? "SL missing"
                    : tpMissing
                        ? "TP missing"
                        : "Protected";
            const protectionClass = slMissing || tpMissing
                ? "border-amber-500/50 text-amber-300"
                : "border-emerald-500/50 text-emerald-400";
            return {
                key: p.positionId || p.id || p.symbol,
                raw: p,
                size,
                isBuy,
                sl,
                tp,
                upnl,
                protectionLabel,
                protectionClass,
            };
        });
    }, [positions]);
    const toggleRow = (key) => {
        setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
    };
    return (_jsx(Panel, { title: "Positions", children: !positionsLoaded ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground", children: "Loading positions..." })) : rows.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground", children: "No open positions." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full text-sm", children: [_jsx("thead", { className: "text-xs text-muted-foreground", children: _jsxs("tr", { className: "border-b border-border/60", children: [_jsx("th", { className: "py-2 text-left font-medium", children: "Symbol" }), _jsx("th", { className: "py-2 text-left font-medium", children: "Side" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Size" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Entry" }), _jsx("th", { className: "py-2 text-right font-medium", children: "PnL" }), _jsx("th", { className: "py-2 text-right font-medium", children: "TP" }), _jsx("th", { className: "py-2 text-right font-medium", children: "SL" }), _jsx("th", { className: "py-2 text-left font-medium", children: "Status" }), _jsx("th", { className: "py-2 text-right font-medium", children: "Actions" })] }) }), _jsx("tbody", { children: rows.map((row) => {
                            const expanded = Boolean(expandedRows[row.key]);
                            return (_jsxs(Fragment, { children: [_jsxs("tr", { className: "border-b border-border/40 text-sm", children: [_jsx("td", { className: "py-3 pr-2", children: _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(Button, { variant: "ghost", size: "icon", className: "h-7 w-7 text-muted-foreground hover:text-foreground", onClick: () => toggleRow(row.key), "aria-label": expanded
                                                                ? "Collapse position details"
                                                                : "Expand position details", children: expanded ? (_jsx(ChevronDown, { className: "h-4 w-4" })) : (_jsx(ChevronRight, { className: "h-4 w-4" })) }), _jsx("span", { className: "font-mono", children: row.raw.symbol })] }) }), _jsx("td", { className: "py-3", children: _jsx(Badge, { variant: "outline", className: row.isBuy
                                                        ? "border-emerald-500/50 text-emerald-400"
                                                        : "border-red-500/50 text-red-400", children: String(row.raw.side ?? "").toUpperCase() }) }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: formatNumber(row.size) }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: formatNumber(row.raw.entryPrice) }), _jsx("td", { className: `py-3 text-right font-mono tabular-nums ${Number.isFinite(row.upnl)
                                                    ? row.upnl >= 0
                                                        ? "text-emerald-400"
                                                        : "text-red-400"
                                                    : "text-muted-foreground"}`, children: Number.isFinite(row.upnl)
                                                    ? `${row.upnl > 0 ? "+" : ""}${formatMoney(row.upnl)}`
                                                    : "—" }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: Number.isFinite(row.tp) ? formatNumber(row.tp) : "—" }), _jsx("td", { className: "py-3 text-right font-mono tabular-nums", children: Number.isFinite(row.sl) ? formatNumber(row.sl) : "—" }), _jsx("td", { className: "py-3", children: _jsx(Badge, { variant: "outline", className: row.protectionClass, children: row.protectionLabel }) }), _jsx("td", { className: "py-3 text-right", children: _jsx(Button, { variant: "destructive", size: "sm", onClick: () => onClosePosition(row.raw), children: "Close" }) })] }), expanded && (_jsx("tr", { className: "border-b border-border/40 bg-background/40", children: _jsx("td", { colSpan: 9, className: "py-3 pl-12 text-xs text-muted-foreground", children: _jsxs("div", { className: "flex flex-wrap gap-4", children: [_jsxs("span", { children: ["Trailing:", " ", _jsx("span", { className: "font-mono text-foreground", children: formatNumber(row.raw.trailingStop ?? row.raw.currentTrailingStop) })] }), _jsxs("span", { children: ["Opened:", " ", _jsx("span", { className: "font-mono text-foreground", children: row.raw.openedAt
                                                                    ? new Date(row.raw.openedAt).toLocaleString()
                                                                    : "—" })] }), _jsxs("span", { children: ["RRR:", " ", _jsx("span", { className: "font-mono text-foreground", children: Number.isFinite(row.raw.rrr)
                                                                    ? row.raw.rrr?.toFixed(2)
                                                                    : "—" })] }), _jsxs("span", { children: ["Update:", " ", _jsx("span", { className: "text-foreground", children: row.raw.lastUpdateReason ?? "—" })] })] }) }) }))] }, row.key));
                        }) })] }) })) }));
}
