import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// src/components/Dashboard.tsx
import { TradingMode } from "../types";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Settings, TrendingUp, Zap } from "lucide-react";
import SettingsPanel from "./SettingsPanel";
export default function Dashboard({ mode, setMode, useTestnet, setUseTestnet, bot, }) {
    const { systemState, portfolioState, activePositions, logEntries, testnetOrders, testnetTrades, ordersError, refreshTestnetOrders, assetPnlHistory, resetPnlHistory, scanDiagnostics, } = bot;
    const modeOptions = [TradingMode.OFF, TradingMode.AUTO_ON];
    const profileMeta = useMemo(() => {
        const riskMode = bot.settings?.riskMode ?? "ai-matic";
        if (riskMode === "ai-matic-scalp") {
            return {
                label: "AI-MATIC-SCALP",
                subtitle: "SMC/AMD (1h/15m/5m/1m)",
                symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
                timeframes: "HTF 1h · M15 · M5 · LTF 1m",
                session: "London/NY killzones (Prague)",
                risk: "1% equity (min 10 / cap 200) · margin 5/pos · max 2 pos",
                entry: "Sweep → CHoCH → FVG → PostOnly LIMIT",
                execution: "LIMIT(PostOnly) + SL server-side + TP1 1R",
            };
        }
        if (riskMode === "ai-matic-x") {
            return {
                label: "AI-MATIC-X",
                subtitle: "AI-MATIC (15m/1m)",
                symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
                timeframes: "HTF 15m · LTF 1m",
                session: "24/7",
                risk: "4 USDT / trade · 8 USDT total · max 2 pos",
                entry: "ST15 bias + ST1 flip + EMA21 pullback + RVOL≥1.2",
                execution: "PostOnly LIMIT · timeout 1×1m",
            };
        }
        return {
            label: "AI-MATIC",
            subtitle: "AI-MATIC (15m/1m)",
            symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
            timeframes: "HTF 15m · LTF 1m",
            session: "24/7",
            risk: "4 USDT / trade · 8 USDT total · max 2 pos",
            entry: "ST15 bias + ST1 flip + EMA21 pullback + RVOL≥1.2",
            execution: "PostOnly LIMIT · timeout 1×1m",
        };
    }, [bot.settings?.riskMode]);
    const allowedSymbols = profileMeta.symbols;
    const exchangeOrders = testnetOrders;
    const exchangeTrades = testnetTrades;
    const refreshOrders = refreshTestnetOrders;
    const CHECKLIST_DEFAULTS = useMemo(() => ({
        "HTF bias": true,
        "ST flip": true,
        "EMA pullback": true,
        "Close vs ST": true,
        "HTF line projection": true,
        "RVOL ≥ 1.2": true,
        "Anti-breakout": true,
        "BBO fresh": true,
        Session: true,
        "Spread ok": true,
        "Asia range": true,
        Sweep: true,
        "CHoCH+FVG": true,
        PostOnly: true,
        "Exec allowed": true,
        "BBO age": true,
    }), []);
    const [checklistEnabled, setChecklistEnabled] = useState(() => {
        if (typeof localStorage === "undefined")
            return CHECKLIST_DEFAULTS;
        try {
            const raw = localStorage.getItem("ai-matic-checklist-enabled");
            if (!raw)
                return CHECKLIST_DEFAULTS;
            const parsed = JSON.parse(raw);
            return { ...CHECKLIST_DEFAULTS, ...parsed };
        }
        catch {
            return CHECKLIST_DEFAULTS;
        }
    });
    useEffect(() => {
        if (typeof localStorage === "undefined")
            return;
        localStorage.setItem("ai-matic-checklist-enabled", JSON.stringify(checklistEnabled));
    }, [checklistEnabled]);
    const toggleChecklist = (name) => {
        setChecklistEnabled((p) => ({ ...p, [name]: !(p[name] ?? true) }));
    };
    const [showSettings, setShowSettings] = useState(false);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col md:flex-row justify-between items-start md:items-center gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-3xl font-bold tracking-tight text-white", children: "Dashboard" }), _jsx("p", { className: "text-slate-400 hidden lg:block", children: profileMeta.subtitle })] }), _jsxs("div", { className: "flex flex-col sm:flex-row gap-4 items-start sm:items-center", children: [_jsxs("div", { className: "flex items-center bg-slate-900 p-1 rounded-lg border border-white/10", children: [_jsx(Button, { variant: useTestnet ? "secondary" : "ghost", size: "sm", onClick: () => setUseTestnet(true), className: useTestnet ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white", children: "TESTNET" }), _jsx(Button, { variant: !useTestnet ? "secondary" : "ghost", size: "sm", onClick: () => setUseTestnet(false), className: !useTestnet ? "bg-emerald-600 text-white hover:bg-emerald-700" : "text-slate-400 hover:text-white", children: "MAINNET" })] }), _jsx("div", { className: "flex items-center bg-slate-900 p-1 rounded-lg border border-white/10", children: modeOptions.map((m) => (_jsx(Button, { variant: mode === m ? "secondary" : "ghost", size: "sm", onClick: () => setMode(m), className: mode === m
                                        ? "bg-blue-600 text-white hover:bg-blue-700"
                                        : "text-slate-400 hover:text-white", children: m }, m))) })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6", children: [_jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { className: "pb-2", children: _jsxs(CardTitle, { className: "text-sm font-medium text-slate-400 flex items-center gap-2", children: [_jsx(Activity, { className: "w-4 h-4" }), "System & Portfolio"] }) }), _jsx(CardContent, { children: _jsxs("div", { className: "space-y-4 text-sm", children: [_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Bybit Connection" }), _jsx(Badge, { variant: "outline", className: systemState.bybitStatus === "Connected"
                                                                ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                                                                : "border-red-500/50 text-red-500 bg-red-500/10", children: systemState.bybitStatus })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-slate-400", children: "Latency" }), _jsxs("span", { className: "font-mono", children: [systemState.latency, " ms"] })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-slate-400", children: "Last Error" }), _jsx("span", { className: "text-red-400 truncate max-w-[200px]", title: systemState.lastError ?? "", children: systemState.lastError ?? "None" })] })] }), _jsxs("div", { className: "space-y-2 pt-3 border-t border-white/10", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Total Capital" }), _jsxs("span", { className: "font-mono font-medium text-lg", children: ["$", portfolioState.totalCapital.toFixed(2)] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Allocated" }), _jsxs("span", { className: "font-mono text-slate-300", children: ["$", portfolioState.allocatedCapital.toFixed(2)] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Daily PnL" }), _jsxs("span", { className: `font-mono ${portfolioState.dailyPnl >= 0
                                                                ? "text-emerald-500"
                                                                : "text-red-500"}`, children: [portfolioState.dailyPnl > 0 ? "+" : "", portfolioState.dailyPnl.toFixed(2), " USD"] })] })] })] }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { className: "pb-2", children: _jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsxs(CardTitle, { className: "text-sm font-medium text-slate-400 flex items-center gap-2", children: [_jsx(Zap, { className: "w-4 h-4" }), "Strategy Profile"] }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => setShowSettings(true), className: "text-slate-300 hover:text-white hover:bg-white/10", children: [_jsx(Settings, { className: "w-4 h-4 mr-2" }), "Settings"] })] }) }), _jsx(CardContent, { children: _jsxs("div", { className: "space-y-3 text-sm", children: [_jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-slate-400", children: "Profile" }), _jsx(Badge, { variant: "secondary", className: "bg-emerald-600/80 text-white", children: profileMeta.label })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Symbols" }), _jsx("span", { className: "font-mono", children: allowedSymbols.join(", ") })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Timeframes" }), _jsx("span", { className: "font-mono", children: profileMeta.timeframes })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Session" }), _jsx("span", { className: "font-mono", children: profileMeta.session })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Risk" }), _jsx("span", { className: "font-mono", children: profileMeta.risk })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Entry" }), _jsx("span", { className: "font-mono", children: profileMeta.entry })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Execution" }), _jsx("span", { className: "font-mono", children: profileMeta.execution })] })] }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { children: _jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(TrendingUp, { className: "w-5 h-5 text-blue-500" }), "Active Positions"] }) }), _jsx(CardContent, { children: activePositions.length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic py-8 text-center border border-dashed border-slate-800 rounded-lg", children: "No open positions." })) : (_jsx("div", { className: "space-y-3", children: activePositions.map((p) => {
                                        const size = Number(p.size ?? p.qty ?? 0);
                                        const sideLower = String(p.side ?? "").toLowerCase();
                                        const isBuy = sideLower === "buy";
                                        const trail = Number(p.currentTrailingStop ?? 0);
                                        const slValue = Number(p.sl ?? 0);
                                        const sl = (Number.isFinite(trail) && trail > 0 ? trail : slValue) || undefined;
                                        const tp = Number(p.tp ?? 0) || undefined;
                                        const upnl = Number(p.unrealizedPnl ?? 0) || 0;
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
                                            ? "border-amber-500/50 text-amber-300 bg-amber-500/10"
                                            : "border-emerald-500/50 text-emerald-300 bg-emerald-500/10";
                                        return (_jsxs("div", { className: "flex items-center justify-between p-4 border border-white/5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors", children: [_jsxs("div", { children: [_jsxs("div", { className: "font-bold flex items-center gap-2 text-lg", children: [p.symbol, _jsx(Badge, { variant: "outline", className: isBuy
                                                                        ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                                                                        : "border-red-500/50 text-red-500 bg-red-500/10", children: sideLower.toUpperCase() }), _jsx(Badge, { variant: "outline", className: protectionClass, children: protectionLabel })] }), _jsxs("div", { className: "text-xs text-slate-400 mt-1 font-mono", children: ["Entry: ", p.entryPrice, " | Size: ", Number.isFinite(size) ? size.toFixed(4) : "-"] })] }), _jsxs("div", { className: "text-right", children: [_jsxs("div", { className: `font-mono font-bold text-lg ${upnl >= 0 ? "text-emerald-500" : "text-red-500"}`, children: [upnl > 0 ? "+" : "", upnl.toFixed(2), " USD"] }), _jsxs("div", { className: "text-xs text-slate-400 mt-1 font-mono", children: ["TP: ", tp ?? "-", " | SL: ", sl ?? "-"] })] })] }, p.positionId || p.id || p.symbol));
                                    }) })) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { children: _jsxs(CardTitle, { className: "text-sm font-medium text-slate-400", children: ["Live Feed ", useTestnet ? "(hidden on Testnet)" : "(Mainnet)"] }) }), _jsx(CardContent, { children: _jsx("div", { className: "h-[360px] overflow-y-auto space-y-2 pr-2 custom-scrollbar", children: useTestnet ? (_jsx("div", { className: "text-sm text-slate-500 italic", children: "Live feed je z bezpe\u010Dnostn\u00EDch d\u016Fvod\u016F skryt\u00FD na Testnetu. P\u0159epni na MAINNET pro zobrazen\u00ED." })) : logEntries.length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic", children: "No activity yet." })) : (logEntries
                                        .filter((l) => {
                                        if (l.action === "SIGNAL" || l.action === "ERROR" || l.action === "STATUS" || l.action === "REJECT")
                                            return true;
                                        const msg = String(l.message || "");
                                        if (msg.startsWith("TIMING "))
                                            return true;
                                        if (msg.startsWith("PAUSE ") || msg.includes("SAFE_MODE"))
                                            return true;
                                        return false;
                                    })
                                        .slice(0, 50)
                                        .map((l) => (_jsxs("div", { className: "text-sm flex gap-3 py-2 border-b border-white/5 last:border-0", children: [_jsx("span", { className: "text-slate-500 text-xs whitespace-nowrap font-mono w-20", children: new Date(l.timestamp).toLocaleTimeString([], {
                                                    hour12: false,
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                    second: "2-digit",
                                                }) }), _jsx("span", { className: "font-medium text-blue-400 w-24 text-xs uppercase tracking-wider", children: l.action }), _jsx("span", { className: "text-slate-300", children: l.message })] }, l.id)))) }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { children: _jsx(CardTitle, { className: "text-sm font-medium text-slate-400", children: "Signal Checklist (last scan)" }) }), _jsx(CardContent, { children: _jsx("div", { className: "space-y-4", children: allowedSymbols.map((sym) => {
                                        const diag = scanDiagnostics?.[sym];
                                        const gates = diag?.gates ?? [];
                                        const hardEnabled = diag?.hardEnabled !== false;
                                        const softEnabled = diag?.softEnabled !== false;
                                        const hardBlocked = diag?.hardBlocked;
                                        const qualityScore = diag?.qualityScore;
                                        const qualityThreshold = diag?.qualityThreshold;
                                        const qualityPass = diag?.qualityPass;
                                        return (_jsxs("div", { className: "p-3 rounded-lg border border-white/5 bg-white/5", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "font-mono font-semibold", children: sym }), _jsx(Badge, { variant: "outline", className: diag?.signalActive ? "border-emerald-500/50 text-emerald-400" : "border-slate-500/50 text-slate-400", children: diag?.signalActive ? "SIGNAL" : "NO SIGNAL" })] }), gates.length === 0 ? (_jsx("div", { className: "text-xs text-slate-500 italic", children: "\u017D\u00E1dn\u00E1 data z posledn\u00EDho scanu." })) : (_jsxs("div", { className: "grid grid-cols-2 gap-2 text-xs", children: [_jsxs("div", { className: "flex items-center gap-2 text-left", title: hardBlocked ? `Hard block: ${diag?.hardBlock}` : hardEnabled ? "Hard gate OK" : "Hard gate disabled", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${hardEnabled ? (hardBlocked ? "bg-red-400" : "bg-emerald-400") : "bg-slate-600"}` }), _jsxs("span", { className: hardEnabled ? "text-white" : "text-slate-500", children: ["Hard gate ", hardEnabled ? (hardBlocked ? "BLOCK" : "OK") : "OFF"] })] }), _jsxs("div", { className: "flex items-center gap-2 text-left", title: softEnabled ? `Quality ${qualityScore ?? "—"} / ${qualityThreshold ?? "—"}` : "Soft gate disabled", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${softEnabled ? (qualityPass ? "bg-emerald-400" : "bg-amber-400") : "bg-slate-600"}` }), _jsxs("span", { className: softEnabled ? "text-white" : "text-slate-500", children: ["Soft score ", softEnabled ? (qualityScore != null ? qualityScore : "—") : "OFF"] })] }), gates.map((g) => (_jsxs("button", { type: "button", onClick: () => toggleChecklist(g.name), className: "flex items-center gap-2 text-left", title: "Kliknut\u00EDm zahrne\u0161/vylou\u010D\u00ED\u0161 z checklistu (jen UI, neovliv\u0148uje obchodov\u00E1n\u00ED).", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${g.ok ? "bg-emerald-400" : "bg-slate-600"}` }), _jsx("span", { className: checklistEnabled[g.name] ? "text-white" : "text-slate-500", children: g.name })] }, g.name))), _jsxs("button", { type: "button", onClick: () => toggleChecklist("Exec allowed"), className: "flex items-center gap-2 text-left", title: "Kliknut\u00EDm zahrne\u0161/vylou\u010D\u00ED\u0161 z checklistu (jen UI, neovliv\u0148uje obchodov\u00E1n\u00ED).", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${diag?.executionAllowed === true ? "bg-emerald-400" : diag?.executionAllowed === false ? "bg-amber-400" : "bg-slate-600"}` }), _jsxs("span", { className: checklistEnabled["Exec allowed"] ? "text-white" : "text-slate-500", children: ["Exec allowed (", diag?.executionAllowed === true ? "YES" : diag?.executionAllowed === false ? "WAIT BBO" : "N/A", ")"] })] }), _jsxs("button", { type: "button", onClick: () => toggleChecklist("BBO age"), className: "flex items-center gap-2 text-left", title: "Kliknut\u00EDm zahrne\u0161/vylou\u010D\u00ED\u0161 z checklistu (jen UI, neovliv\u0148uje obchodov\u00E1n\u00ED).", children: [_jsx("span", { className: "h-2 w-2 rounded-full bg-slate-500" }), _jsxs("span", { className: checklistEnabled["BBO age"] ? "text-white" : "text-slate-500", children: ["BBO age: ", diag?.bboAgeMs != null && Number.isFinite(diag.bboAgeMs) ? `${diag.bboAgeMs} ms` : "—"] })] })] }))] }, sym));
                                    }) }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsxs(CardHeader, { className: "flex flex-row items-center justify-between space-y-0 pb-2", children: [_jsx(CardTitle, { className: "text-sm font-medium text-slate-400", children: useTestnet ? "Testnet Orders" : "Mainnet Orders" }), _jsxs("div", { className: "flex items-center gap-2", children: [ordersError && (_jsx("span", { className: "text-xs text-red-400 truncate max-w-[160px]", title: ordersError, children: ordersError })), _jsx(Button, { variant: "outline", size: "sm", onClick: () => refreshOrders(), className: "h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white", children: "Refresh" })] })] }), _jsxs(CardContent, { children: [ordersError ? (_jsxs("div", { className: "text-sm text-red-400 italic py-6 text-center border border-red-500/30 bg-red-500/5 rounded-lg", children: ["Orders API failed: ", ordersError] })) : exchangeOrders.length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg", children: useTestnet ? "Žádné otevřené testnet orders." : "Žádné otevřené mainnet orders." })) : (_jsx("div", { className: "space-y-3", children: exchangeOrders.slice(0, 8).map((o) => (_jsxs("div", { className: "p-3 rounded-lg border border-white/5 bg-white/5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono font-semibold", children: o.symbol }), _jsx(Badge, { variant: "outline", className: o.side === "Buy" ? "border-emerald-500/50 text-emerald-500" : "border-red-500/50 text-red-500", children: o.side })] }), _jsxs("div", { className: "text-xs text-slate-400 font-mono mt-1", children: ["Qty ", o.qty, " @ ", o.price ?? "mkt", " | ", o.status] }), _jsx("div", { className: "text-[11px] text-slate-500 mt-1", children: new Date(o.createdTime).toLocaleString() })] }, o.orderId))) })), exchangeTrades.length > 0 && (_jsxs("div", { className: "mt-4 pt-3 border-t border-white/10", children: [_jsx("div", { className: "text-xs text-slate-400 mb-2", children: "Latest fills" }), _jsx("div", { className: "space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar", children: exchangeTrades.slice(0, 10).map((t) => (_jsxs("div", { className: "text-xs font-mono text-slate-300 flex justify-between", children: [_jsx("span", { className: "flex-1 truncate", children: t.symbol }), _jsx("span", { className: t.side === "Buy" ? "text-emerald-400" : "text-red-400", children: t.side }), _jsx("span", { children: t.qty }), _jsxs("span", { children: ["@", t.price] }), _jsx("span", { children: new Date(t.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) })] }, t.id))) })] }))] })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsxs(CardHeader, { className: "flex flex-row items-center justify-between space-y-0 pb-2", children: [_jsx(CardTitle, { className: "text-sm font-medium text-slate-400", children: "Asset PnL History" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("span", { className: "text-xs text-slate-500", children: [Object.keys(assetPnlHistory).length, " assets"] }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => resetPnlHistory(), className: "h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white", children: "Reset" })] })] }), _jsx(CardContent, { children: Object.keys(assetPnlHistory).length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg", children: "\u017D\u00E1dn\u00FD historick\u00FD PnL zat\u00EDm ulo\u017Een." })) : (_jsx("div", { className: "space-y-3", children: Object.entries(assetPnlHistory).map(([symbol, records]) => {
                                        const latest = records[0];
                                        const sum = records.reduce((acc, r) => acc + (r.pnl ?? 0), 0);
                                        return (_jsxs("div", { className: "p-3 rounded-lg border border-white/5 bg-white/5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono font-semibold", children: symbol }), _jsxs("span", { className: `font-mono text-sm ${sum >= 0 ? "text-emerald-400" : "text-red-400"}`, children: ["\u03A3 ", sum >= 0 ? "+" : "", sum.toFixed(2), " USD"] })] }), latest && (_jsxs("div", { className: "text-xs text-slate-400 font-mono mt-1", children: ["Posledn\u00ED: ", latest.pnl >= 0 ? "+" : "", latest.pnl.toFixed(2), " \u00B7 ", new Date(latest.timestamp).toLocaleString()] }))] }, symbol));
                                    }) })) })] })] }), showSettings && bot.settings && (_jsx(SettingsPanel, { theme: "dark", lang: "cs", settings: bot.settings, onUpdateSettings: bot.updateSettings, onClose: () => setShowSettings(false) }))] }));
}
