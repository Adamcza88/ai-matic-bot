import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingMode } from "@/types";
import { ChevronDown } from "lucide-react";
import Panel from "@/components/dashboard/Panel";
const MODE_LABELS = {
    [TradingMode.OFF]: "Manual",
    [TradingMode.AUTO_ON]: "Auto",
    [TradingMode.SIGNAL_ONLY]: "Signal",
    [TradingMode.BACKTEST]: "Backtest",
    [TradingMode.PAPER]: "Paper",
};
function gateSummary(diag, gates, scanLoaded, checklistEnabled) {
    if (!scanLoaded || !diag) {
        return { label: "Gate: —", blocked: false };
    }
    const hardEnabled = diag?.hardEnabled !== false;
    const softEnabled = diag?.softEnabled !== false;
    const hardBlocked = Boolean(diag?.hardBlocked);
    const softBlocked = softEnabled && diag?.qualityPass === false;
    const execBlocked = diag?.executionAllowed === false;
    const gatesBlocked = gates.some((g) => (checklistEnabled[g.name] ?? true) && g?.ok === false);
    const blocked = (hardEnabled && hardBlocked) || softBlocked || execBlocked || gatesBlocked;
    return {
        label: blocked ? "Gate: BLOCKED" : "Gate: PASS",
        blocked,
    };
}
function gateLabel(name, detail) {
    if (name === "Confirm required") {
        if (detail === "not required")
            return "Confirm: No";
        if (detail === "required")
            return "Confirm: Yes";
        return "Confirm";
    }
    if (name === "Exec allowed") {
        return "Execution allowed";
    }
    return name;
}
export default function SignalsAccordion({ allowedSymbols, scanDiagnostics, scanLoaded, lastScanTs, checklistEnabled, toggleChecklist, resetChecklist, mode, }) {
    const lastScanLabel = lastScanTs
        ? new Date(lastScanTs).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        })
        : "—";
    return (_jsx(Panel, { title: "Signal checklist", description: `Last scan: ${lastScanLabel}`, action: _jsx(Button, { variant: "outline", size: "sm", onClick: resetChecklist, className: "h-8 text-xs", children: "Reset gates" }), children: _jsx("div", { className: "space-y-3", children: allowedSymbols.map((symbol) => {
                const diag = scanDiagnostics?.[symbol];
                const gates = Array.isArray(diag?.gates) ? diag.gates : [];
                const hardEnabled = diag?.hardEnabled !== false;
                const softEnabled = diag?.softEnabled !== false;
                const hardBlocked = diag?.hardBlocked;
                const qualityScore = diag?.qualityScore;
                const qualityThreshold = diag?.qualityThreshold;
                const qualityPass = diag?.qualityPass;
                const breakdown = diag?.qualityBreakdown;
                const breakdownOrder = [
                    "HTF",
                    "Pullback",
                    "Break",
                    "ATR",
                    "Spread",
                    "Freshness",
                ];
                const breakdownParts = breakdown
                    ? breakdownOrder
                        .map((key) => {
                        const value = breakdown[key];
                        return Number.isFinite(value)
                            ? `${key} ${Math.round(value)}`
                            : null;
                    })
                        .filter((entry) => Boolean(entry))
                    : [];
                const signalLabel = !scanLoaded
                    ? "Loading"
                    : diag?.signalActive
                        ? "Active"
                        : "Idle";
                const signalClass = !scanLoaded
                    ? "border-border/60 text-muted-foreground"
                    : diag?.signalActive
                        ? "border-emerald-500/50 text-emerald-400"
                        : "border-border/60 text-muted-foreground";
                const execLabel = diag?.executionAllowed === true
                    ? "Yes"
                    : diag?.executionAllowed === false
                        ? diag?.executionReason ?? "Blocked"
                        : diag?.executionReason ?? "N/A";
                const feedAgeMs = diag?.feedAgeMs;
                const feedAgeOk = diag?.feedAgeOk;
                const feedAgeLabel = feedAgeOk == null ? "—" : feedAgeOk ? "OK" : "Fail";
                const feedAgeValue = feedAgeMs != null && Number.isFinite(feedAgeMs)
                    ? `${feedAgeMs} ms`
                    : "—";
                const summary = gateSummary(diag, gates, scanLoaded, checklistEnabled);
                return (_jsxs("details", { className: "group rounded-lg border border-border/60 bg-background/40", children: [_jsxs("summary", { className: "flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs", children: [_jsxs("div", { className: "flex min-w-0 flex-wrap items-center gap-2", children: [_jsx("span", { className: "font-mono text-sm", children: symbol }), _jsx(Badge, { variant: "outline", className: summary.blocked ? "border-red-500/50 text-red-400" : "border-emerald-500/50 text-emerald-400", children: summary.label }), _jsxs(Badge, { variant: "outline", className: feedAgeOk === false
                                                ? "border-red-500/50 text-red-400"
                                                : "border-border/60 text-muted-foreground", children: ["Feed age ", feedAgeLabel, " \u00B7 ", feedAgeValue] }), _jsxs(Badge, { variant: "outline", className: "border-border/60 text-muted-foreground", children: ["Mode ", MODE_LABELS[mode]] })] }), _jsxs("div", { className: "flex items-center gap-2 text-muted-foreground", children: [_jsx(Badge, { variant: "outline", className: signalClass, children: signalLabel }), _jsx(ChevronDown, { className: "h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" })] })] }), _jsx("div", { className: "border-t border-border/60 px-4 py-3 text-xs", children: !scanLoaded ? (_jsx("div", { className: "text-muted-foreground", children: "Loading diagnostics..." })) : gates.length === 0 ? (_jsx("div", { className: "text-muted-foreground", children: "No scan data for this symbol." })) : (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "grid gap-2 sm:grid-cols-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${hardEnabled
                                                            ? hardBlocked
                                                                ? "bg-red-400"
                                                                : "bg-emerald-400"
                                                            : "bg-slate-600"}` }), _jsxs("span", { className: hardEnabled ? "text-foreground" : "text-muted-foreground", children: ["Hard gate: ", hardEnabled ? (hardBlocked ? "BLOCKED" : "PASS") : "OFF"] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${softEnabled
                                                            ? qualityPass
                                                                ? "bg-emerald-400"
                                                                : "bg-amber-400"
                                                            : "bg-slate-600"}` }), _jsxs("span", { className: softEnabled ? "text-foreground" : "text-muted-foreground", children: ["Soft score:", " ", softEnabled
                                                                ? qualityScore != null
                                                                    ? `${qualityScore} / ${qualityThreshold ?? "—"}`
                                                                    : "—"
                                                                : "OFF"] })] })] }), _jsxs("div", { className: "grid gap-2 sm:grid-cols-2", children: [gates.map((gate) => (_jsxs("button", { type: "button", onClick: () => toggleChecklist(gate.name), className: "flex items-center gap-2 text-left", title: "Toggle gate enforcement for this check.", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${gate.ok ? "bg-emerald-400" : "bg-slate-600"}` }), _jsx("span", { className: checklistEnabled[gate.name]
                                                            ? "text-foreground"
                                                            : "text-muted-foreground", children: (() => {
                                                            const label = gateLabel(gate.name, gate.detail);
                                                            const detail = gate.ok && gate.detail
                                                                ? gate.detail === "not required"
                                                                    ? "No"
                                                                    : gate.detail
                                                                : "";
                                                            if (!detail || gate.name === "Confirm required") {
                                                                return label;
                                                            }
                                                            return `${label}: ${detail}`;
                                                        })() })] }, gate.name))), _jsxs("button", { type: "button", onClick: () => toggleChecklist("Exec allowed"), className: "flex items-center gap-2 text-left", title: "Toggle gate enforcement for this check.", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${diag?.executionAllowed === true
                                                            ? "bg-emerald-400"
                                                            : diag?.executionAllowed === false
                                                                ? "bg-amber-400"
                                                                : "bg-slate-600"}` }), _jsxs("span", { className: checklistEnabled["Exec allowed"]
                                                            ? "text-foreground"
                                                            : "text-muted-foreground", children: ["Execution allowed (", execLabel, ")"] })] }), _jsxs("button", { type: "button", onClick: () => toggleChecklist("Feed age"), className: "flex items-center gap-2 text-left", title: "Toggle gate enforcement for this check.", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${feedAgeOk == null
                                                            ? "bg-slate-600"
                                                            : feedAgeOk
                                                                ? "bg-emerald-400"
                                                                : "bg-red-400"}` }), _jsxs("span", { className: checklistEnabled["Feed age"]
                                                            ? "text-foreground"
                                                            : "text-muted-foreground", children: ["Feed age ", feedAgeLabel, ":", " ", feedAgeMs != null && Number.isFinite(feedAgeMs)
                                                                ? `${feedAgeMs} ms`
                                                                : "—"] })] })] }), (breakdownParts.length > 0 || diag?.qualityTopReason) && (_jsxs("div", { className: "text-[11px] text-muted-foreground", children: [breakdownParts.length > 0 && (_jsxs("div", { children: ["Score: ", breakdownParts.join(" · ")] })), diag?.qualityTopReason && (_jsxs("div", { children: ["Top reason: ", diag.qualityTopReason] }))] }))] })) })] }, symbol));
            }) }) }));
}
