import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
function gateSummary(diag, scanLoaded) {
    if (!scanLoaded || !diag) {
        return { label: "Gate: —", blocked: false };
    }
    const hardEnabled = diag?.hardEnabled !== false;
    const softEnabled = diag?.softEnabled !== false;
    const hardBlocked = Boolean(diag?.hardBlocked);
    const softBlocked = softEnabled && diag?.qualityPass === false;
    const execBlocked = diag?.executionAllowed === false;
    const gateBlocked = Array.isArray(diag?.gates)
        ? diag.gates.some((g) => g?.ok === false)
        : false;
    const blocked = (hardEnabled && hardBlocked) || softBlocked || execBlocked || gateBlocked;
    return {
        label: blocked ? "Gate: BLOCKED" : "Gate: PASS",
        blocked,
    };
}
export default function OverviewTab({ profileMeta, allowedSymbols, assetPnlHistory, pnlLoaded, resetPnlHistory, scanDiagnostics, scanLoaded, lastScanTs, logEntries, logsLoaded, useTestnet, onOpenSettings, }) {
    const lastScanLabel = lastScanTs
        ? new Date(lastScanTs).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        })
        : "—";
    const signalRows = useMemo(() => {
        return allowedSymbols
            .map((symbol) => {
            const diag = scanDiagnostics?.[symbol];
            const signalActive = Boolean(diag?.signalActive);
            const feedAgeMs = diag?.feedAgeMs;
            const feedAgeOk = diag?.feedAgeOk;
            const gate = gateSummary(diag, scanLoaded);
            return {
                symbol,
                signalActive,
                feedAgeMs,
                feedAgeOk,
                gate,
                qualityScore: diag?.qualityScore ?? null,
            };
        })
            .sort((a, b) => {
            if (a.signalActive !== b.signalActive) {
                return a.signalActive ? -1 : 1;
            }
            return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
        })
            .slice(0, 6);
    }, [allowedSymbols, scanDiagnostics, scanLoaded]);
    const recentEvents = (logEntries ?? []).slice(0, 3);
    return (_jsxs("div", { className: "grid gap-6 lg:grid-cols-[1.15fr,0.85fr]", children: [_jsxs("div", { className: "space-y-6", children: [_jsx(Panel, { title: "Strategy profile", action: _jsx(Button, { variant: "outline", size: "sm", onClick: onOpenSettings, className: "h-8 text-xs", children: "Settings" }), children: _jsxs("div", { className: "space-y-3 text-sm", children: [_jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx("span", { className: "text-muted-foreground", children: "Profile" }), _jsx(Badge, { variant: "outline", className: "border-emerald-500/50 text-emerald-400", children: profileMeta.label })] }), _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsx("span", { className: "text-muted-foreground", children: "Symbols" }), _jsx("span", { className: "font-mono text-right text-xs text-foreground", children: allowedSymbols.join(", ") })] }), _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsx("span", { className: "text-muted-foreground", children: "Timeframes" }), _jsx("span", { className: "text-right text-xs max-w-[70ch]", children: profileMeta.timeframes })] }), _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsx("span", { className: "text-muted-foreground", children: "Session" }), _jsx("span", { className: "text-right text-xs max-w-[70ch]", children: profileMeta.session })] }), _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsx("span", { className: "text-muted-foreground", children: "Risk" }), _jsx("span", { className: "text-right text-xs max-w-[70ch]", children: profileMeta.risk })] }), _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsx("span", { className: "text-muted-foreground", children: "Entry" }), _jsx("span", { className: "text-right text-xs max-w-[70ch]", children: profileMeta.entry })] }), _jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsx("span", { className: "text-muted-foreground", children: "Execution" }), _jsx("span", { className: "text-right text-xs max-w-[70ch]", children: profileMeta.execution })] })] }) }), _jsx(Panel, { title: "Asset PnL history", action: _jsx(Button, { variant: "outline", size: "sm", onClick: resetPnlHistory, className: "h-8 text-xs", children: "Reset" }), children: !pnlLoaded ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "Loading PnL history..." })) : !assetPnlHistory || Object.keys(assetPnlHistory).length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "No PnL history yet." })) : (_jsx("div", { className: "max-h-72 space-y-3 overflow-y-auto pr-1", children: Object.entries(assetPnlHistory)
                                .sort((a, b) => {
                                const latestA = a[1]?.[0]?.timestamp
                                    ? Date.parse(a[1][0].timestamp)
                                    : 0;
                                const latestB = b[1]?.[0]?.timestamp
                                    ? Date.parse(b[1][0].timestamp)
                                    : 0;
                                return latestB - latestA;
                            })
                                .map(([symbol, records]) => {
                                const latest = records[0];
                                const resetRecord = records.find((r) => r.note === "RESET");
                                const baselineTs = resetRecord?.timestamp
                                    ? Date.parse(resetRecord.timestamp)
                                    : Number.NEGATIVE_INFINITY;
                                const sum = records.reduce((acc, r) => {
                                    const ts = Date.parse(r.timestamp);
                                    if (Number.isFinite(baselineTs) && Number.isFinite(ts)) {
                                        if (ts < baselineTs)
                                            return acc;
                                    }
                                    return Number.isFinite(r.pnl) ? acc + r.pnl : acc;
                                }, 0);
                                const latestPnl = latest && Number.isFinite(latest.pnl) ? latest.pnl : null;
                                return (_jsxs("div", { className: "rounded-lg border border-border/60 bg-background/40 p-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono text-xs", children: symbol }), _jsxs("span", { className: `font-mono text-xs ${sum >= 0 ? "text-emerald-400" : "text-red-400"}`, children: [sum >= 0 ? "+" : "", sum.toFixed(2), " USD"] })] }), latest && (_jsxs("div", { className: "mt-1 text-[11px] text-muted-foreground", children: ["Last: ", latestPnl != null ? (latestPnl >= 0 ? "+" : "") : "", latestPnl != null ? latestPnl.toFixed(2) : "—", " \u00B7", " ", latest.timestamp
                                                    ? new Date(latest.timestamp).toLocaleString()
                                                    : "—"] }))] }, symbol));
                            }) })) })] }), _jsxs("div", { className: "space-y-6", children: [_jsx(Panel, { title: "Top signals", description: `Last scan: ${lastScanLabel}`, children: !scanLoaded ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "Loading signal diagnostics..." })) : signalRows.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "No signal diagnostics yet." })) : (_jsx("div", { className: "space-y-2", children: signalRows.map((row) => (_jsxs("div", { className: "flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs", children: [_jsx("div", { className: "font-mono", children: row.symbol }), _jsxs("div", { className: "flex items-center gap-2 text-xs", children: [_jsx(Badge, { variant: "outline", className: row.signalActive
                                                    ? "border-emerald-500/50 text-emerald-400"
                                                    : "border-border/60 text-muted-foreground", children: row.signalActive ? "Active" : "Idle" }), _jsx(Badge, { variant: "outline", className: row.gate.blocked
                                                    ? "border-red-500/50 text-red-400"
                                                    : "border-emerald-500/50 text-emerald-400", children: row.gate.label }), _jsx(Badge, { variant: "outline", className: row.feedAgeOk === false
                                                    ? "border-red-500/50 text-red-400"
                                                    : "border-border/60 text-muted-foreground", children: row.feedAgeMs != null && Number.isFinite(row.feedAgeMs)
                                                    ? `${row.feedAgeMs} ms`
                                                        : "Feed age —" })] })] }, row.symbol))) })) }), _jsx(Panel, { title: "Recent events", children: !logsLoaded ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "Loading events..." })) : recentEvents.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "No recent events." })) : (_jsx("div", { className: "space-y-2", children: recentEvents.map((entry) => (_jsxs("div", { className: "flex gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs", children: [_jsx("div", { className: "w-20 font-mono text-[11px] text-muted-foreground", children: new Date(entry.timestamp).toLocaleTimeString([], {
                                            hour12: false,
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            second: "2-digit",
                                        }) }), _jsx("div", { className: "min-w-[72px] text-[11px] font-semibold uppercase tracking-wide text-sky-400", children: entry.action }), _jsx("div", { className: "text-foreground", children: entry.message })] }, entry.id))) })) })] })] }));
}
