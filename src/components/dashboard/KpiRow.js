import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
function formatMoney(value, digits = 2) {
    return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
export default function KpiRow({ totalCapital, allocated, dailyPnl, openPositions, maxOpenPositions, openOrders, maxOpenOrders, }) {
    const dailyPnlOk = Number.isFinite(dailyPnl);
    const dailyPnlValue = dailyPnlOk ? dailyPnl : null;
    const dailyPnlLabel = dailyPnlOk
        ? `${dailyPnlValue >= 0 ? "+" : ""}${dailyPnlValue.toFixed(2)} USD`
        : "—";
    return (_jsxs("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-4", children: [_jsxs("div", { className: "rounded-lg border border-border/60 bg-card/60 p-3", children: [_jsx("div", { className: "text-xs text-muted-foreground", children: "Total capital" }), _jsxs("div", { className: "mt-2 text-lg font-semibold tabular-nums", children: ["$", formatMoney(totalCapital)] })] }), _jsxs("div", { className: "rounded-lg border border-border/60 bg-card/60 p-3", children: [_jsx("div", { className: "text-xs text-muted-foreground", children: "Allocated" }), _jsxs("div", { className: "mt-2 text-lg font-semibold tabular-nums", children: ["$", formatMoney(allocated)] })] }), _jsxs("div", { className: "rounded-lg border border-border/60 bg-card/60 p-3", children: [_jsx("div", { className: "text-xs text-muted-foreground", children: "Daily PnL" }), _jsx("div", { className: `mt-2 text-lg font-semibold tabular-nums ${dailyPnlOk
                            ? dailyPnlValue >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            : "text-muted-foreground"}`, children: dailyPnlLabel })] }), _jsx("div", { className: "rounded-lg border border-border/60 bg-card/60 p-3", children: _jsxs("div", { className: "grid grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("div", { className: "text-xs text-muted-foreground", children: "Open positions" }), _jsxs("div", { className: "mt-2 text-lg font-semibold tabular-nums", children: [openPositions, "/", maxOpenPositions] })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs text-muted-foreground", children: "Open orders" }), _jsxs("div", { className: "mt-2 text-lg font-semibold tabular-nums", children: [openOrders, "/", maxOpenOrders] })] })] }) })] }));
}
