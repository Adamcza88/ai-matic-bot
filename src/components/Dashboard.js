import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// src/components/Dashboard.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingMode } from "../types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SettingsPanel from "./SettingsPanel";
import StatusBar from "./dashboard/StatusBar";
import KpiRow from "./dashboard/KpiRow";
import OverviewTab from "./dashboard/OverviewTab";
import PositionsTable from "./dashboard/PositionsTable";
import OrdersPanel from "./dashboard/OrdersPanel";
import SignalsAccordion from "./dashboard/SignalsAccordion";
import LogsPanel from "./dashboard/LogsPanel";
export default function Dashboard({ mode, setMode, useTestnet, setUseTestnet, bot, }) {
    const { systemState, portfolioState, activePositions, logEntries, testnetOrders, testnetTrades, ordersError, refreshTestnetOrders, assetPnlHistory, resetPnlHistory, scanDiagnostics, manualClosePosition, cancelOrder, dynamicSymbols, updateGateOverrides, } = bot;
    const dailyPnl = portfolioState?.dailyPnl;
    const positionsLoaded = Array.isArray(activePositions);
    const openPositionsPnl = positionsLoaded
        ? activePositions.reduce((sum, position) => {
            const pnl = Number(position?.unrealizedPnl);
            return Number.isFinite(pnl) ? sum + pnl : sum;
        }, 0)
        : undefined;
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
                subtitle: "SMC HTF/LTF (bull 12h/4h→1h/5m · bear 1d/4h→1h/15m)",
                symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
                timeframes: "Bull: HTF 12h/4h · LTF 1h/5m · Bear: HTF 1d/4h · LTF 1h/15m",
                session: "24/7",
                risk: "4 USDT / trade · 8 USDT total (after 3 losses: 2/4 for 60m) · max 3 pos",
                entry: "HTF bias + POI (bull 12h/4h, bear 1d/4h) → LTF 1h/(5m/15m) CHOCH/MSS + displacement pullback",
                execution: "PostOnly LIMIT · timeout 1×1m",
            };
        }
        if (riskMode === "ai-matic-tree") {
            return {
                label: "AI-MATIC TREE",
                subtitle: "Decision Tree – Market → Action (1h context / 5m execution)",
                symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
                timeframes: "1h context · 5m execution",
                session: "Bybit Linear Perpetuals · ~40 markets scan",
                risk: "Risk ON: 1R · Risk OFF: 0.25R · max 5 trades/day",
                entry: "Families 1–6 · A-setup required",
                execution: "Checklist B management · Kill switch -3R",
            };
        }
        return {
            label: "AI-MATIC",
            subtitle: "AI-MATIC (1h/5m)",
            symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
            timeframes: "1h/5m + POI analyzer",
            session: "POI: Breaker > OB > FVG > Liquidity",
            risk: "4 USDT / trade · 8 USDT total · max 3 pos",
            entry: "FVG/OB/Breaker + liquidity pools (0.2% tol, min 3 touches)",
            execution: "Swing window 7 · 5m management + SL/TS",
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
        "ai-matic-tree": {
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
    const maxOpenPositions = portfolioState?.maxOpenPositions ?? bot.settings?.maxOpenPositions ?? 3;
    const openPositionsCount = positionsLoaded ? activePositions.length : 0;
    const openOrdersCount = ordersLoaded ? exchangeOrders.length : 0;
    const maxOpenOrders = Math.max(Number.isFinite(maxOpenPositions) ? maxOpenPositions * 2 : 0, 1);
    const totalCapital = portfolioState?.totalCapital ?? portfolioState?.totalEquity;
    const allocated = portfolioState?.allocatedCapital;
    const engineStatus = mode === TradingMode.AUTO_ON ? "Running" : "Paused";
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(StatusBar, { title: profileMeta.label, subtitle: profileMeta.subtitle, mode: mode, setMode: setMode, useTestnet: useTestnet, setUseTestnet: setUseTestnet, systemState: systemState, engineStatus: engineStatus }), _jsx(KpiRow, { totalCapital: totalCapital, allocated: allocated, dailyPnl: dailyPnl, openPositionsPnl: openPositionsPnl, openPositions: openPositionsCount, maxOpenPositions: maxOpenPositions, openOrders: openOrdersCount, maxOpenOrders: maxOpenOrders }), _jsxs(Tabs, { defaultValue: "overview", className: "space-y-4", children: [_jsxs(TabsList, { className: "w-full justify-start", children: [_jsx(TabsTrigger, { value: "overview", children: "Overview" }), _jsx(TabsTrigger, { value: "positions", children: "Positions" }), _jsx(TabsTrigger, { value: "signals", children: "Signals" }), _jsx(TabsTrigger, { value: "orders", children: "Orders" }), _jsx(TabsTrigger, { value: "logs", children: "Logs" })] }), _jsx(TabsContent, { value: "overview", children: _jsx(OverviewTab, { profileMeta: profileMeta, allowedSymbols: allowedSymbols, assetPnlHistory: assetPnlHistory, pnlLoaded: pnlLoaded, resetPnlHistory: resetPnlHistory, scanDiagnostics: scanDiagnostics, scanLoaded: scanLoaded, lastScanTs: lastScanTs, logEntries: logEntries, logsLoaded: logsLoaded, useTestnet: useTestnet, onOpenSettings: () => setShowSettings(true) }) }), _jsx(TabsContent, { value: "positions", children: _jsx(PositionsTable, { positions: positionsLoaded ? activePositions : [], positionsLoaded: positionsLoaded, onClosePosition: manualClosePosition }) }), _jsx(TabsContent, { value: "signals", children: _jsx(SignalsAccordion, { allowedSymbols: allowedSymbols, scanDiagnostics: scanDiagnostics, scanLoaded: scanLoaded, lastScanTs: lastScanTs, checklistEnabled: checklistEnabled, toggleChecklist: toggleChecklist, resetChecklist: resetChecklist, mode: mode }) }), _jsx(TabsContent, { value: "orders", children: _jsx(OrdersPanel, { orders: exchangeOrders, ordersLoaded: ordersLoaded, ordersError: ordersError, refreshOrders: refreshOrders, trades: exchangeTrades, tradesLoaded: tradesLoaded, useTestnet: useTestnet, onCancelOrder: cancelOrder }) }), _jsx(TabsContent, { value: "logs", children: _jsx(LogsPanel, { logEntries: logEntries, logsLoaded: logsLoaded, useTestnet: useTestnet }) })] }), showSettings && bot.settings && (_jsx(SettingsPanel, { theme: "dark", lang: "en", settings: bot.settings, onUpdateSettings: bot.updateSettings, onClose: () => setShowSettings(false) }))] }));
}
