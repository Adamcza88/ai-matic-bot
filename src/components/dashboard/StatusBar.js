import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingMode } from "@/types";
const MODE_LABELS = {
    [TradingMode.OFF]: "Manual",
    [TradingMode.AUTO_ON]: "Auto",
    [TradingMode.SIGNAL_ONLY]: "Signal",
    [TradingMode.BACKTEST]: "Backtest",
    [TradingMode.PAPER]: "Paper",
};
const MODE_OPTIONS = [TradingMode.OFF, TradingMode.AUTO_ON];
export default function StatusBar({ title, subtitle, mode, setMode, useTestnet, setUseTestnet, systemState, engineStatus, }) {
    const bybitStatus = systemState.bybitStatus ?? "Disconnected";
    const latencyLabel = Number.isFinite(systemState.latency)
        ? `${systemState.latency} ms`
        : null;
    const isConnected = bybitStatus === "Connected";
    const isError = bybitStatus === "Error" || bybitStatus === "Disconnected";
    return (_jsx("div", { className: "sticky top-0 z-20", children: _jsx("div", { className: "rounded-xl border border-border/60 bg-card/80 p-3 backdrop-blur-sm", children: _jsxs("div", { className: "flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-[11px] uppercase tracking-widest text-muted-foreground", children: "Strategy" }), _jsx("div", { className: "text-lg font-semibold leading-tight", children: title }), subtitle && (_jsx("div", { className: "text-xs text-muted-foreground max-w-[70ch]", children: subtitle }))] }), _jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { children: "Environment" }), _jsxs("div", { className: "flex items-center rounded-md border border-border/60 bg-background/60 p-0.5", children: [_jsx(Button, { variant: useTestnet ? "secondary" : "ghost", size: "sm", onClick: () => setUseTestnet(true), className: useTestnet
                                                    ? "bg-muted text-foreground"
                                                    : "text-muted-foreground hover:text-foreground", children: "TESTNET" }), _jsx(Button, { variant: !useTestnet ? "secondary" : "ghost", size: "sm", onClick: () => setUseTestnet(false), className: !useTestnet
                                                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                                    : "text-muted-foreground hover:text-foreground", children: "MAINNET" })] })] }), _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { children: "Execution" }), _jsx("div", { className: "flex items-center rounded-md border border-border/60 bg-background/60 p-0.5", children: MODE_OPTIONS.map((m) => (_jsx(Button, { variant: mode === m ? "secondary" : "ghost", size: "sm", onClick: () => setMode(m), className: mode === m
                                                ? "bg-sky-600 text-white hover:bg-sky-700"
                                                : "text-muted-foreground hover:text-foreground", children: MODE_LABELS[m] }, m))) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs(Badge, { variant: "outline", className: isConnected
                                            ? "border-emerald-500/50 text-emerald-400"
                                            : isError
                                                ? "border-red-500/50 text-red-400"
                                                : "border-amber-500/50 text-amber-400", children: ["Bybit ", bybitStatus] }), latencyLabel && (_jsx(Badge, { variant: "outline", className: "border-border/60 text-foreground", children: latencyLabel })), _jsxs(Badge, { variant: "outline", className: engineStatus === "Running"
                                            ? "border-emerald-500/50 text-emerald-400"
                                            : "border-amber-500/50 text-amber-400", children: ["Engine ", engineStatus] }), systemState.lastError && (_jsxs(Badge, { variant: "destructive", className: "max-w-[220px] truncate", title: systemState.lastError, children: ["Error: ", systemState.lastError] }))] })] })] }) }) }));
}
