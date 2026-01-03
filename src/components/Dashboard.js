import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// src/components/Dashboard.tsx
import { TradingMode } from "../types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Settings, TrendingUp, Zap } from "lucide-react";
import SettingsPanel from "./SettingsPanel";
export default function Dashboard({ mode, setMode, useTestnet, setUseTestnet, bot, }) {
    const { systemState, portfolioState, activePositions, logEntries, testnetOrders, testnetTrades, ordersError, refreshTestnetOrders, assetPnlHistory, resetPnlHistory, scanDiagnostics, manualClosePosition, dynamicSymbols, updateGateOverrides, } = bot;
    const formatMoney = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : "—";
    const dailyPnl = portfolioState?.dailyPnl;
    const dailyPnlOk = Number.isFinite(dailyPnl);
    const positionsLoaded = Array.isArray(activePositions);
    const ordersLoaded = Array.isArray(testnetOrders);
    const tradesLoaded = Array.isArray(testnetTrades);
    const logsLoaded = Array.isArray(logEntries);
    const pnlLoaded = Boolean(assetPnlHistory);
    const scanLoaded = scanDiagnostics !== null;
    const lastScanTs = useMemo(() => {
        if (!scanDiagnostics)
            return null;
        const values = Object.values(scanDiagnostics)
            .map((d) => d?.lastScanTs)
            .filter((ts) => Number.isFinite(ts));
        if (!values.length)
            return null;
        return Math.max(...values);
    }, [scanDiagnostics]);
    const modeOptions = [TradingMode.OFF, TradingMode.AUTO_ON];
    const riskMode = bot.settings?.riskMode ?? "ai-matic";
    const profileMeta = useMemo(() => {
        if (riskMode === "ai-matic-scalp") {
            return {
                label: "AI-MATIC-SCALP",
                subtitle: "Scalpera Bot v2.0 (1h/1m)",
                symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
                timeframes: "HTF 1h · LTF 1m",
                session: "08:00-12:00 & 13:00-17:00 UTC",
                risk: "SL 1.3 ATR · TP 2.6 ATR · trailing after 1.1R · max 1 pos/symbol",
                entry: "Trend-Pullback / Liquidity-Sweep (SMC + EMA + AI)",
                execution: "Adaptive executor (Trend/Sweep) · no pyramiding · Bybit webhook",
            };
        }
        if (riskMode === "ai-matic-x") {
            return {
                label: "AI-MATIC-X",
                subtitle: "SMC HTF/LTF (4h/1h/15m/1m)",
                symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
                timeframes: "HTF 4h · 1h · LTF 15m · 1m",
                session: "24/7",
                risk: "4 USDT / trade · 8 USDT total (after 3 losses: 2/4 for 60m) · max 3 pos",
                entry: "HTF bias + POI (OB/FVG/Breaker/Liquidity) → LTF CHOCH/MSS + displacement pullback",
                execution: "PostOnly LIMIT · timeout 1×1m",
            };
        }
        return {
            label: "AI-MATIC",
            subtitle: "AI-MATIC (1h/15m/5m/1m)",
            symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
            timeframes: "1h context · 15m micro · 5m signal · 1m confirm",
            session: "Tokyo/London/NY context (1h)",
            risk: "4 USDT / trade · 8 USDT total · max 3 pos",
            entry: "1h direction → 15m setup/bias → 5m entry → 1m confirm",
            execution: "1m confirmation + SL/TS management",
        };
    }, [riskMode]);
    const allowedSymbols = bot.settings?.riskMode === "ai-matic-x" && dynamicSymbols?.length
        ? dynamicSymbols
        : profileMeta.symbols;
    const exchangeOrders = ordersLoaded ? testnetOrders : [];
    const exchangeTrades = tradesLoaded ? testnetTrades : [];
    const refreshOrders = refreshTestnetOrders;
    const CHECKLIST_DEFAULTS_BY_PROFILE = useMemo(() => ({
        "ai-matic": {
            Signal: true,
            "Trend bias": false,
            "Engine ok": true,
            "Session ok": true,
            "Confirm required": false,
            "Max positions": true,
            "Position clear": true,
            "Orders clear": true,
            "SL set": true,
            "TP set": true,
            "Exec allowed": true,
            "Feed age": true,
        },
        "ai-matic-x": {
            Signal: true,
            "Trend bias": false,
            "Engine ok": true,
            "Session ok": true,
            "Confirm required": false,
            "Max positions": true,
            "Position clear": true,
            "Orders clear": true,
            "SL set": true,
            "TP set": true,
            "Exec allowed": true,
            "Feed age": true,
        },
        "ai-matic-scalp": {
            Signal: true,
            "Trend bias": true,
            "Engine ok": true,
            "Session ok": true,
            "Confirm required": false,
            "Max positions": true,
            "Position clear": true,
            "Orders clear": true,
            "SL set": true,
            "TP set": true,
            "Exec allowed": true,
            "Feed age": true,
        },
    }), []);
    const CHECKLIST_DEFAULTS = useMemo(() => {
        return (CHECKLIST_DEFAULTS_BY_PROFILE[riskMode] ??
            CHECKLIST_DEFAULTS_BY_PROFILE["ai-matic"]);
    }, [CHECKLIST_DEFAULTS_BY_PROFILE, riskMode]);
    const CHECKLIST_ALIASES = useMemo(() => ({
        "Feed age": ["BBO age", "BBO fresh"],
        "Position clear": ["Position open"],
        "Orders clear": ["Open orders"],
        "Session ok": ["Session"],
        "Confirm required": ["CONFIRM_REQUIRED"],
    }), []);
    const gateStorageKey = useMemo(() => `ai-matic-checklist-enabled:${riskMode}`, [riskMode]);
    const [checklistEnabled, setChecklistEnabled] = useState(() => CHECKLIST_DEFAULTS);
    useEffect(() => {
        if (typeof localStorage === "undefined") {
            setChecklistEnabled(CHECKLIST_DEFAULTS);
            return;
        }
        try {
            const legacy = localStorage.getItem("ai-matic-checklist-enabled");
            const raw = localStorage.getItem(gateStorageKey) ?? legacy;
            if (!raw) {
                setChecklistEnabled(CHECKLIST_DEFAULTS);
                return;
            }
            const parsed = JSON.parse(raw);
            const next = { ...CHECKLIST_DEFAULTS, ...(parsed ?? {}) };
            Object.entries(CHECKLIST_ALIASES).forEach(([name, aliases]) => {
                if (typeof parsed?.[name] === "boolean")
                    return;
                for (const alias of aliases) {
                    if (typeof parsed?.[alias] === "boolean") {
                        next[name] = parsed[alias];
                        break;
                    }
                }
            });
            setChecklistEnabled(next);
        }
        catch {
            setChecklistEnabled(CHECKLIST_DEFAULTS);
        }
    }, [CHECKLIST_ALIASES, CHECKLIST_DEFAULTS, gateStorageKey]);
    useEffect(() => {
        if (typeof localStorage === "undefined")
            return;
        localStorage.setItem(gateStorageKey, JSON.stringify(checklistEnabled));
    }, [checklistEnabled, gateStorageKey]);
    useEffect(() => {
        if (typeof localStorage === "undefined")
            return;
        const migrated = localStorage.getItem(`ai-matic-checklist-migration-v3:${riskMode}`);
        if (migrated)
            return;
        localStorage.setItem(`ai-matic-checklist-migration-v3:${riskMode}`, "true");
        setChecklistEnabled((prev) => ({
            ...prev,
            "Exec allowed": true,
            "Confirm required": false,
        }));
    }, [riskMode]);
    useEffect(() => {
        updateGateOverrides?.(checklistEnabled);
    }, [checklistEnabled, updateGateOverrides]);
    const toggleChecklist = (name) => {
        setChecklistEnabled((p) => ({ ...p, [name]: !(p[name] ?? true) }));
    };
    const resetChecklist = useCallback(() => {
        setChecklistEnabled(CHECKLIST_DEFAULTS);
    }, [CHECKLIST_DEFAULTS]);
    const [showSettings, setShowSettings] = useState(false);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col md:flex-row justify-between items-start md:items-center gap-4", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-3xl font-bold tracking-tight text-white", children: "Dashboard" }), _jsx("p", { className: "text-slate-400 hidden lg:block", children: profileMeta.subtitle })] }), _jsxs("div", { className: "flex flex-col sm:flex-row gap-4 items-start sm:items-center", children: [_jsxs("div", { className: "flex items-center bg-slate-900 p-1 rounded-lg border border-white/10", children: [_jsx(Button, { variant: useTestnet ? "secondary" : "ghost", size: "sm", onClick: () => setUseTestnet(true), className: useTestnet ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white", children: "TESTNET" }), _jsx(Button, { variant: !useTestnet ? "secondary" : "ghost", size: "sm", onClick: () => setUseTestnet(false), className: !useTestnet ? "bg-emerald-600 text-white hover:bg-emerald-700" : "text-slate-400 hover:text-white", children: "MAINNET" })] }), _jsx("div", { className: "flex items-center bg-slate-900 p-1 rounded-lg border border-white/10", children: modeOptions.map((m) => (_jsx(Button, { variant: mode === m ? "secondary" : "ghost", size: "sm", onClick: () => setMode(m), className: mode === m
                                        ? "bg-blue-600 text-white hover:bg-blue-700"
                                        : "text-slate-400 hover:text-white", children: m }, m))) })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6", children: [_jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { className: "pb-2", children: _jsxs(CardTitle, { className: "text-sm font-medium text-slate-400 flex items-center gap-2", children: [_jsx(Activity, { className: "w-4 h-4" }), "System & Portfolio"] }) }), _jsx(CardContent, { children: _jsxs("div", { className: "space-y-4 text-sm", children: [_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Bybit Connection" }), _jsx(Badge, { variant: "outline", className: systemState.bybitStatus === "Connected"
                                                                ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                                                                : "border-red-500/50 text-red-500 bg-red-500/10", children: systemState.bybitStatus })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-slate-400", children: "Latency" }), _jsx("span", { className: "font-mono", children: Number.isFinite(systemState.latency)
                                                                ? `${systemState.latency} ms`
                                                                : "—" })] }), _jsxs("div", { className: "flex justify-between items-center", children: [_jsx("span", { className: "text-slate-400", children: "Last Error" }), _jsx("span", { className: "text-red-400 truncate max-w-[200px]", title: systemState.lastError ?? "", children: systemState.lastError ?? "None" })] })] }), _jsxs("div", { className: "space-y-2 pt-3 border-t border-white/10", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Total Capital" }), _jsxs("span", { className: "font-mono font-medium text-lg", children: ["$", formatMoney(portfolioState.totalCapital)] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Allocated" }), _jsxs("span", { className: "font-mono text-slate-300", children: ["$", formatMoney(portfolioState.allocatedCapital)] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Daily PnL" }), _jsx("span", { className: `font-mono ${dailyPnlOk
                                                                ? dailyPnl >= 0
                                                                    ? "text-emerald-500"
                                                                    : "text-red-500"
                                                                : "text-slate-500"}`, children: dailyPnlOk
                                                                ? `${dailyPnl > 0 ? "+" : ""}${dailyPnl.toFixed(2)} USD`
                                                                : "—" })] })] })] }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { className: "pb-2", children: _jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsxs(CardTitle, { className: "text-sm font-medium text-slate-400 flex items-center gap-2", children: [_jsx(Zap, { className: "w-4 h-4" }), "Strategy Profile"] }), _jsxs(Button, { variant: "ghost", size: "sm", onClick: () => setShowSettings(true), className: "text-slate-300 hover:text-white hover:bg-white/10", children: [_jsx(Settings, { className: "w-4 h-4 mr-2" }), "Settings"] })] }) }), _jsx(CardContent, { children: _jsxs("div", { className: "space-y-3 text-sm", children: [_jsxs("div", { className: "grid grid-cols-[120px,1fr] items-center gap-4", children: [_jsx("span", { className: "text-slate-400", children: "Profile" }), _jsx(Badge, { variant: "secondary", className: "bg-emerald-600/80 text-white justify-self-end", children: profileMeta.label })] }), _jsxs("div", { className: "grid grid-cols-[120px,1fr] items-start gap-4", children: [_jsx("span", { className: "text-slate-400", children: "Symbols" }), _jsx("span", { className: "font-mono text-right break-words min-w-0", children: allowedSymbols.join(", ") })] }), _jsxs("div", { className: "grid grid-cols-[120px,1fr] items-start gap-4", children: [_jsx("span", { className: "text-slate-400", children: "Timeframes" }), _jsx("span", { className: "font-mono text-right break-words min-w-0", children: profileMeta.timeframes })] }), _jsxs("div", { className: "grid grid-cols-[120px,1fr] items-start gap-4", children: [_jsx("span", { className: "text-slate-400", children: "Session" }), _jsx("span", { className: "font-mono text-right break-words min-w-0", children: profileMeta.session })] }), _jsxs("div", { className: "grid grid-cols-[120px,1fr] items-start gap-4", children: [_jsx("span", { className: "text-slate-400", children: "Risk" }), _jsx("span", { className: "font-mono text-right break-words min-w-0", children: profileMeta.risk })] }), _jsxs("div", { className: "grid grid-cols-[120px,1fr] items-start gap-4", children: [_jsx("span", { className: "text-slate-400", children: "Entry" }), _jsx("span", { className: "font-mono text-right break-words min-w-0", children: profileMeta.entry })] }), _jsxs("div", { className: "grid grid-cols-[120px,1fr] items-start gap-4", children: [_jsx("span", { className: "text-slate-400", children: "Execution" }), _jsx("span", { className: "font-mono text-right break-words min-w-0", children: profileMeta.execution })] })] }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { children: _jsxs(CardTitle, { className: "flex items-center gap-2", children: [_jsx(TrendingUp, { className: "w-5 h-5 text-blue-500" }), "Active Positions"] }) }), _jsx(CardContent, { children: !positionsLoaded ? (_jsx("div", { className: "text-sm text-slate-500 italic py-8 text-center border border-dashed border-slate-800 rounded-lg", children: "Na\u010D\u00EDt\u00E1m pozice\u2026" })) : activePositions.length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic py-8 text-center border border-dashed border-slate-800 rounded-lg", children: "No open positions." })) : (_jsx("div", { className: "space-y-3", children: activePositions.map((p) => {
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
                                        const upnl = Number(p.unrealizedPnl);
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
                                                                        : "border-red-500/50 text-red-500 bg-red-500/10", children: sideLower.toUpperCase() }), _jsx(Badge, { variant: "outline", className: protectionClass, children: protectionLabel })] }), _jsxs("div", { className: "text-xs text-slate-400 mt-1 font-mono", children: ["Entry: ", Number.isFinite(p.entryPrice) ? Number(p.entryPrice).toFixed(4) : "—", " | Size: ", Number.isFinite(size) ? size.toFixed(4) : "—"] })] }), _jsxs("div", { className: "text-right", children: [_jsx("div", { className: `font-mono font-bold text-lg ${Number.isFinite(upnl)
                                                                ? upnl >= 0
                                                                    ? "text-emerald-500"
                                                                    : "text-red-500"
                                                                : "text-slate-500"}`, children: Number.isFinite(upnl)
                                                                ? `${upnl > 0 ? "+" : ""}${upnl.toFixed(2)} USD`
                                                                : "—" }), _jsxs("div", { className: "text-xs text-slate-400 mt-1 font-mono", children: ["TP: ", Number.isFinite(tp) ? tp : "—", " | SL: ", Number.isFinite(sl) ? sl : "—"] }), _jsx("div", { className: "mt-2 flex justify-end", children: _jsx(Button, { variant: "destructive", size: "sm", onClick: () => manualClosePosition(p), children: "Close" }) })] })] }, p.positionId || p.id || p.symbol));
                                    }) })) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsx(CardHeader, { children: _jsxs(CardTitle, { className: "text-sm font-medium text-slate-400", children: ["Live Feed ", useTestnet ? "(hidden on Testnet)" : "(Mainnet)"] }) }), _jsx(CardContent, { children: _jsx("div", { className: "h-[360px] overflow-y-auto space-y-2 pr-2 custom-scrollbar", children: useTestnet ? (_jsx("div", { className: "text-sm text-slate-500 italic", children: "Live feed je z bezpe\u010Dnostn\u00EDch d\u016Fvod\u016F skryt\u00FD na Testnetu. P\u0159epni na MAINNET pro zobrazen\u00ED." })) : !logsLoaded ? (_jsx("div", { className: "text-sm text-slate-500 italic", children: "Na\u010D\u00EDt\u00E1m logy\u2026" })) : logEntries.length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic", children: "No activity yet." })) : (logEntries
                                        .filter((l) => {
                                        if (l.action === "SIGNAL" || l.action === "ERROR" || l.action === "STATUS" || l.action === "REJECT" || l.action === "SYSTEM")
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
                                                }) }), _jsx("span", { className: "font-medium text-blue-400 w-24 text-xs uppercase tracking-wider", children: l.action }), _jsx("span", { className: "text-slate-300", children: l.message })] }, l.id)))) }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsxs(CardHeader, { className: "pb-2", children: [_jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsx(CardTitle, { className: "text-sm font-medium text-slate-400", children: "Signal Checklist (last scan)" }), _jsx(Button, { variant: "outline", size: "sm", onClick: resetChecklist, className: "h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white", children: "Reset gates" })] }), _jsx("div", { className: "text-[11px] text-slate-500 mt-1", children: scanLoaded && lastScanTs
                                            ? `Last scan: ${new Date(lastScanTs).toLocaleTimeString([], {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                                second: "2-digit",
                                            })}`
                                            : "Last scan: —" })] }), _jsx(CardContent, { children: _jsx("div", { className: "space-y-4", children: allowedSymbols.map((sym) => {
                                        const diag = scanDiagnostics?.[sym];
                                        const gates = diag?.gates ?? [];
                                        const hardEnabled = diag?.hardEnabled !== false;
                                        const softEnabled = diag?.softEnabled !== false;
                                        const hardBlocked = diag?.hardBlocked;
                                        const qualityScore = diag?.qualityScore;
                                        const qualityThreshold = diag?.qualityThreshold;
                                        const qualityPass = diag?.qualityPass;
                                        const breakdown = diag?.qualityBreakdown;
                                        const breakdownOrder = ["HTF", "Pullback", "Break", "ATR", "Spread", "Freshness"];
                                        const breakdownParts = breakdown
                                            ? breakdownOrder
                                                .map((key) => {
                                                const value = breakdown[key];
                                                return Number.isFinite(value) ? `${key} ${Math.round(value)}` : null;
                                            })
                                                .filter((entry) => Boolean(entry))
                                            : [];
                                        const signalLabel = !scanLoaded
                                            ? "LOADING"
                                            : diag?.signalActive
                                                ? "ACTIVE"
                                                : "IDLE";
                                        const signalClass = !scanLoaded
                                            ? "border-slate-500/50 text-slate-400"
                                            : diag?.signalActive
                                                ? "border-emerald-500/50 text-emerald-400"
                                                : "border-slate-500/50 text-slate-400";
                                        const execLabel = diag?.executionAllowed === true
                                            ? "YES"
                                            : diag?.executionAllowed === false
                                                ? (diag?.executionReason ?? "BLOCKED")
                                                : (diag?.executionReason ?? "N/A");
                                        const feedAgeMs = diag?.feedAgeMs;
                                        const feedAgeOk = diag?.feedAgeOk;
                                        const feedAgeLabel = feedAgeOk == null
                                            ? "N/A"
                                            : feedAgeOk
                                                ? "OK"
                                                : "FAIL";
                                        return (_jsxs("div", { className: "p-3 rounded-lg border border-white/5 bg-white/5", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "font-mono font-semibold", children: sym }), _jsx(Badge, { variant: "outline", className: signalClass, children: signalLabel })] }), !scanLoaded ? (_jsx("div", { className: "text-xs text-slate-500 italic", children: "Na\u010D\u00EDt\u00E1m posledn\u00ED scan\u2026" })) : gates.length === 0 ? (_jsx("div", { className: "text-xs text-slate-500 italic", children: "\u017D\u00E1dn\u00E1 data z posledn\u00EDho scanu." })) : (_jsxs("div", { className: "grid grid-cols-2 gap-2 text-xs", children: [_jsxs("div", { className: "flex items-center gap-2 text-left", title: hardBlocked ? `Hard block: ${diag?.hardBlock}` : hardEnabled ? "Hard gate OK" : "Hard gate disabled", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${hardEnabled ? (hardBlocked ? "bg-red-400" : "bg-emerald-400") : "bg-slate-600"}` }), _jsxs("span", { className: hardEnabled ? "text-white" : "text-slate-500", children: ["Hard gate ", hardEnabled ? (hardBlocked ? "BLOCK" : "OK") : "OFF"] })] }), _jsxs("div", { className: "flex items-center gap-2 text-left", title: softEnabled ? `Quality ${qualityScore ?? "—"} / ${qualityThreshold ?? "—"}` : "Soft gate disabled", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${softEnabled ? (qualityPass ? "bg-emerald-400" : "bg-amber-400") : "bg-slate-600"}` }), _jsxs("span", { className: softEnabled ? "text-white" : "text-slate-500", children: ["Soft score ", softEnabled ? (qualityScore != null ? qualityScore : "—") : "OFF"] })] }), gates.map((g) => (_jsxs("button", { type: "button", onClick: () => toggleChecklist(g.name), className: "flex items-center gap-2 text-left", title: "Kliknut\u00EDm zapne\u0161/vypne\u0161 gate pro validaci vstupu.", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${g.ok ? "bg-emerald-400" : "bg-slate-600"}` }), _jsxs("span", { className: checklistEnabled[g.name] ? "text-white" : "text-slate-500", children: [g.name, g.ok && g.detail ? `: ${g.detail}` : ""] })] }, g.name))), _jsxs("button", { type: "button", onClick: () => toggleChecklist("Exec allowed"), className: "flex items-center gap-2 text-left", title: "Kliknut\u00EDm zapne\u0161/vypne\u0161 gate pro validaci vstupu.", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${diag?.executionAllowed === true ? "bg-emerald-400" : diag?.executionAllowed === false ? "bg-amber-400" : "bg-slate-600"}` }), _jsxs("span", { className: checklistEnabled["Exec allowed"] ? "text-white" : "text-slate-500", children: ["Exec allowed (", execLabel, ")"] })] }), _jsxs("button", { type: "button", onClick: () => toggleChecklist("Feed age"), className: "flex items-center gap-2 text-left", title: "Kliknut\u00EDm zapne\u0161/vypne\u0161 gate pro validaci vstupu.", children: [_jsx("span", { className: `h-2 w-2 rounded-full ${feedAgeOk == null ? "bg-slate-600" : feedAgeOk ? "bg-emerald-400" : "bg-red-400"}` }), _jsxs("span", { className: checklistEnabled["Feed age"] ? "text-white" : "text-slate-500", children: ["Feed age ", feedAgeLabel, ": ", feedAgeMs != null && Number.isFinite(feedAgeMs) ? `${feedAgeMs} ms` : "—"] })] }), (breakdownParts.length > 0 || diag?.qualityTopReason) && (_jsxs("div", { className: "col-span-2 text-[11px] text-slate-400", children: [breakdownParts.length > 0 && (_jsxs("div", { children: ["Score: ", breakdownParts.join(" · ")] })), diag?.qualityTopReason && (_jsxs("div", { children: ["Top reason: ", diag.qualityTopReason] }))] }))] }))] }, sym));
                                    }) }) })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsxs(CardHeader, { className: "flex flex-row items-center justify-between space-y-0 pb-2", children: [_jsx(CardTitle, { className: "text-sm font-medium text-slate-400", children: useTestnet ? "Testnet Orders" : "Mainnet Orders" }), _jsxs("div", { className: "flex items-center gap-2", children: [ordersError && (_jsx("span", { className: "text-xs text-red-400 truncate max-w-[160px]", title: ordersError, children: ordersError })), _jsx(Button, { variant: "outline", size: "sm", onClick: () => refreshOrders(), className: "h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white", children: "Refresh" })] })] }), _jsxs(CardContent, { children: [ordersError ? (_jsxs("div", { className: "text-sm text-red-400 italic py-6 text-center border border-red-500/30 bg-red-500/5 rounded-lg", children: ["Orders API failed: ", ordersError] })) : !ordersLoaded ? (_jsx("div", { className: "text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg", children: "Na\u010D\u00EDt\u00E1m orders\u2026" })) : exchangeOrders.length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg", children: useTestnet ? "Žádné otevřené testnet orders." : "Žádné otevřené mainnet orders." })) : (_jsx("div", { className: "space-y-3", children: exchangeOrders.slice(0, 8).map((o) => (_jsxs("div", { className: "p-3 rounded-lg border border-white/5 bg-white/5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono font-semibold", children: o.symbol }), _jsx(Badge, { variant: "outline", className: o.side === "Buy" ? "border-emerald-500/50 text-emerald-500" : "border-red-500/50 text-red-500", children: o.side })] }), _jsxs("div", { className: "text-xs text-slate-400 font-mono mt-1", children: ["Qty ", Number.isFinite(o.qty) ? o.qty : "—", " @ ", Number.isFinite(o.price) ? o.price : "mkt", " | ", o.status] }), _jsx("div", { className: "text-[11px] text-slate-500 mt-1", children: o.createdTime
                                                        ? new Date(o.createdTime).toLocaleString()
                                                        : "—" })] }, o.orderId))) })), tradesLoaded && exchangeTrades.length > 0 && (_jsxs("div", { className: "mt-4 pt-3 border-t border-white/10", children: [_jsx("div", { className: "text-xs text-slate-400 mb-2", children: "Latest fills" }), _jsx("div", { className: "space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar", children: exchangeTrades.slice(0, 10).map((t) => (_jsxs("div", { className: "text-xs font-mono text-slate-300 flex justify-between", children: [_jsx("span", { className: "flex-1 truncate", children: t.symbol }), _jsx("span", { className: t.side === "Buy" ? "text-emerald-400" : "text-red-400", children: t.side }), _jsx("span", { children: Number.isFinite(t.qty) ? t.qty : "—" }), _jsxs("span", { children: ["@", Number.isFinite(t.price) ? t.price : "—"] }), _jsx("span", { children: t.time
                                                                ? new Date(t.time).toLocaleTimeString([], {
                                                                    hour: "2-digit",
                                                                    minute: "2-digit",
                                                                    second: "2-digit",
                                                                })
                                                                : "—" })] }, t.id))) })] }))] })] }), _jsxs(Card, { className: "bg-slate-900/50 border-white/10 text-white", children: [_jsxs(CardHeader, { className: "flex flex-row items-center justify-between space-y-0 pb-2", children: [_jsx(CardTitle, { className: "text-sm font-medium text-slate-400", children: "Asset PnL History" }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("span", { className: "text-xs text-slate-500", children: pnlLoaded ? `${Object.keys(assetPnlHistory).length} assets` : "—" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => resetPnlHistory(), className: "h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white", children: "Refresh" })] })] }), _jsx(CardContent, { children: !pnlLoaded ? (_jsx("div", { className: "text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg", children: "Na\u010D\u00EDt\u00E1m PnL\u2026" })) : Object.keys(assetPnlHistory).length === 0 ? (_jsx("div", { className: "text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg", children: "\u017D\u00E1dn\u00FD historick\u00FD PnL zat\u00EDm ulo\u017Een." })) : (_jsx("div", { className: "space-y-3", children: Object.entries(assetPnlHistory)
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
                                        const sum = records.reduce((acc, r) => {
                                            return Number.isFinite(r.pnl) ? acc + r.pnl : acc;
                                        }, 0);
                                        const latestPnl = latest && Number.isFinite(latest.pnl) ? latest.pnl : null;
                                        return (_jsxs("div", { className: "p-3 rounded-lg border border-white/5 bg-white/5", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "font-mono font-semibold", children: symbol }), _jsxs("span", { className: `font-mono text-sm ${sum >= 0 ? "text-emerald-400" : "text-red-400"}`, children: ["\u03A3 ", sum >= 0 ? "+" : "", sum.toFixed(2), " USD"] })] }), latest && (_jsxs("div", { className: "text-xs text-slate-400 font-mono mt-1", children: ["Posledn\u00ED: ", latestPnl != null ? (latestPnl >= 0 ? "+" : "") : "", latestPnl != null ? latestPnl.toFixed(2) : "—", " \u00B7 ", latest.timestamp ? new Date(latest.timestamp).toLocaleString() : "—"] }))] }, symbol));
                                    }) })) })] })] }), showSettings && bot.settings && (_jsx(SettingsPanel, { theme: "dark", lang: "cs", settings: bot.settings, onUpdateSettings: bot.updateSettings, onClose: () => setShowSettings(false) }))] }));
}
