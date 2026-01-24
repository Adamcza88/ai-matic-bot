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
import { SUPPORTED_SYMBOLS } from "../constants/symbols";
import { getCheatSheetSetup } from "../engine/strategyCheatSheet";
export default function Dashboard({ mode, setMode, useTestnet, setUseTestnet, bot, }) {
    const { systemState, portfolioState, activePositions, logEntries, testnetOrders, testnetTrades, ordersError, refreshTestnetOrders, assetPnlHistory, resetPnlHistory, scanDiagnostics, manualClosePosition, cancelOrder, updateGateOverrides, } = bot;
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
    const cheatSheetSetupId = ({
        "ai-matic": "ai-matic-core",
        "ai-matic-x": "ai-matic-x-smart-money-combo",
        "ai-matic-scalp": "ai-matic-scalp-scalpera",
        "ai-matic-tree": "ai-matic-decision-tree",
    }[riskMode] ?? "ai-matic-core");
    const cheatSheetSetup = getCheatSheetSetup(cheatSheetSetupId);
    const cheatSheetStatus = bot.settings?.strategyCheatSheetEnabled ? "On" : "Off";
    const cheatSheetLabel = cheatSheetSetup?.name ?? "Cheat sheet";
    const cheatSheetNote = `Cheat sheet: ${cheatSheetLabel} (${cheatSheetStatus})`;
    const profileMeta = useMemo(() => {
        if (riskMode === "ai-matic-scalp") {
            return {
                label: "AI-MATIC-SCALP",
                subtitle: "Scalp (1h bias / 15m context / 1m entry)",
                symbols: SUPPORTED_SYMBOLS,
                timeframes: "1h bias · 15m context · 1m entry",
                session: "08:00-12:00 / 13:00-17:00 UTC",
                risk: "RTC/TP1 gate · fee-aware scalp",
                entry: "SR/BR setups · maker-first entry",
                execution: `TP1 >= 2.5× RTC · time stop · ${cheatSheetNote}`,
            };
        }
        if (riskMode === "ai-matic-x") {
            return {
                label: "AI-MATIC-X",
                subtitle: "EMA12/26 HTF bias + 5m pullback + micro break close",
                symbols: SUPPORTED_SYMBOLS,
                timeframes: "1h context · 5m execution",
                session: "24/7",
                risk: "Risk 100 USDT/trade · sizing by SL distance · notional cap ~1% allocation",
                entry: "5m pullback do EMA12/EMA12–26 zóny + micro break CLOSE",
                execution: `BBO filter (fresh/age) · SL pod/nad pivot + ATR buffer · ${cheatSheetNote}`,
            };
        }
        if (riskMode === "ai-matic-tree") {
            return {
                label: "AI-MATIC-TREE",
                subtitle: "Fibonacci Strategy (trend pullbacks / confluence)",
                symbols: SUPPORTED_SYMBOLS,
                timeframes: "1h context · 5m execution",
                session: "Bybit Linear Perpetuals · ~40 markets scan",
                risk: "Order value per symbol · margin 100 USDT · Max positions/orders dle settings",
                entry: "Fib retracement pullback v trendu · confluence se strukturou",
                execution: `Targets přes Fib extensions · SL za další Fib nebo swing · ${cheatSheetNote}`,
            };
        }
        return {
            label: "AI-MATIC",
            subtitle: "AI-MATIC Core (HTF 1h/15m · LTF 5m/1m)",
            symbols: SUPPORTED_SYMBOLS,
            timeframes: "HTF 1h · 15m · LTF 5m · 1m",
            session: "POI: Breaker > OB > FVG > Liquidity",
            risk: "Order value per symbol · margin 100 USDT · max positions by settings",
            entry: "FVG/OB/Breaker + liquidity pools (0.2% tol, min 3 touches)",
            execution: `EMA50 trend gate · 1m timing + swing/ATR stop · ${cheatSheetNote}`,
        };
    }, [cheatSheetNote, riskMode]);
    const selectedSymbols = bot.settings?.selectedSymbols?.length ? bot.settings.selectedSymbols : null;
    const allowedSymbols = selectedSymbols ?? profileMeta.symbols;
    const exchangeOrders = ordersLoaded ? testnetOrders : [];
    const exchangeTrades = tradesLoaded ? testnetTrades : [];
    const refreshOrders = refreshTestnetOrders;
    const CHECKLIST_DEFAULTS_BY_PROFILE = useMemo(() => ({
        "ai-matic": {
            "Trend bias": true,
            "Exec allowed": true,
        },
        "ai-matic-x": {
            "X setup": true,
            "Exec allowed": true,
        },
        "ai-matic-tree": {
            "Trend bias": true,
            "Exec allowed": true,
        },
        "ai-matic-scalp": {
            "TP1 >= min": true,
            "1h bias": true,
            "15m context": true,
            "Chop filter": true,
            "Level defined": true,
            "Maker entry": true,
            "SL structural": true,
            "BE+ / time stop": true,
            "Exec allowed": true,
        },
    }), []);
    const CHECKLIST_DEFAULTS = useMemo(() => {
        return (CHECKLIST_DEFAULTS_BY_PROFILE[riskMode] ??
            CHECKLIST_DEFAULTS_BY_PROFILE["ai-matic"]);
    }, [CHECKLIST_DEFAULTS_BY_PROFILE, riskMode]);
    const checklistGateNames = useMemo(() => {
        const defaults = CHECKLIST_DEFAULTS_BY_PROFILE[riskMode] ??
            CHECKLIST_DEFAULTS_BY_PROFILE["ai-matic"];
        return Object.keys(defaults).filter((name) => name !== "Exec allowed");
    }, [CHECKLIST_DEFAULTS_BY_PROFILE, riskMode]);
    const CHECKLIST_ALIASES = useMemo(() => ({
        "Trend bias": ["Tree setup"],
        "X setup": ["Trend bias"],
        "1h bias": ["Trend bias"],
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
    const rawMaxOpenPositions = portfolioState?.maxOpenPositions ?? bot.settings?.maxOpenPositions ?? 3;
    const maxOpenPositions = rawMaxOpenPositions;
    const openPositionsCount = positionsLoaded ? activePositions.length : 0;
    const openOrdersCount = ordersLoaded ? exchangeOrders.length : 0;
    const maxOpenOrders = bot.settings?.maxOpenOrders ?? 0;
    const totalCapital = portfolioState?.totalCapital ?? portfolioState?.totalEquity;
    const allocated = portfolioState?.allocatedCapital;
    const engineStatus = mode === TradingMode.AUTO_ON ? "Running" : "Paused";
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(StatusBar, { title: profileMeta.label, subtitle: profileMeta.subtitle, mode: mode, setMode: setMode, useTestnet: useTestnet, setUseTestnet: setUseTestnet, systemState: systemState, engineStatus: engineStatus }), _jsx(KpiRow, { totalCapital: totalCapital, allocated: allocated, dailyPnl: dailyPnl, openPositionsPnl: openPositionsPnl, openPositions: openPositionsCount, maxOpenPositions: maxOpenPositions, openOrders: openOrdersCount, maxOpenOrders: maxOpenOrders }), _jsxs(Tabs, { defaultValue: "overview", className: "space-y-4", children: [_jsxs(TabsList, { className: "w-full justify-start", children: [_jsx(TabsTrigger, { value: "overview", children: "Overview" }), _jsx(TabsTrigger, { value: "positions", children: "Positions" }), _jsx(TabsTrigger, { value: "signals", children: "Signals" }), _jsx(TabsTrigger, { value: "orders", children: "Orders" }), _jsx(TabsTrigger, { value: "logs", children: "Logs" })] }), _jsx(TabsContent, { value: "overview", children: _jsx(OverviewTab, { profileMeta: profileMeta, allowedSymbols: allowedSymbols, assetPnlHistory: assetPnlHistory, pnlLoaded: pnlLoaded, resetPnlHistory: resetPnlHistory, scanDiagnostics: scanDiagnostics, scanLoaded: scanLoaded, lastScanTs: lastScanTs, logEntries: logEntries, logsLoaded: logsLoaded, useTestnet: useTestnet, onOpenSettings: () => setShowSettings(true) }) }), _jsx(TabsContent, { value: "positions", children: _jsx(PositionsTable, { positions: positionsLoaded ? activePositions : [], positionsLoaded: positionsLoaded, onClosePosition: manualClosePosition }) }), _jsx(TabsContent, { value: "signals", children: _jsx(SignalsAccordion, { allowedSymbols: allowedSymbols, scanDiagnostics: scanDiagnostics, scanLoaded: scanLoaded, lastScanTs: lastScanTs, checklistEnabled: checklistEnabled, toggleChecklist: toggleChecklist, resetChecklist: resetChecklist, mode: mode, profileGateNames: checklistGateNames }) }), _jsx(TabsContent, { value: "orders", children: _jsx(OrdersPanel, { orders: exchangeOrders, ordersLoaded: ordersLoaded, ordersError: ordersError, refreshOrders: refreshOrders, trades: exchangeTrades, tradesLoaded: tradesLoaded, useTestnet: useTestnet, onCancelOrder: cancelOrder }) }), _jsx(TabsContent, { value: "logs", children: _jsx(LogsPanel, { logEntries: logEntries, logsLoaded: logsLoaded, useTestnet: useTestnet }) })] }), showSettings && bot.settings && (_jsx(SettingsPanel, { theme: "dark", lang: "en", settings: bot.settings, onUpdateSettings: bot.updateSettings, onClose: () => setShowSettings(false) }))] }));
}
