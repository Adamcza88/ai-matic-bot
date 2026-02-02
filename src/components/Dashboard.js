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
    const { systemState, portfolioState, activePositions, logEntries, testnetOrders, testnetTrades, ordersError, refreshTestnetOrders, assetPnlHistory, resetPnlHistory, scanDiagnostics, manualClosePosition, allowPositionClose, cancelOrder, allowOrderCancel, updateGateOverrides, } = bot;
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
    const cheatEnabled = bot.settings?.strategyCheatSheetEnabled === true;
    const profileMeta = useMemo(() => {
        if (riskMode === "ai-matic-scalp") {
            return {
                label: "AI-MATIC-SCALP",
                subtitle: "Adaptive Trend Following (v1.3)",
                symbols: SUPPORTED_SYMBOLS,
                timeframes: "15m trend · 1m entry",
                session: "24/7",
                risk: "Risk 0.25% equity/trade · notional cap ~1% equity",
                entry: "EMA Cross + RSI Divergence + Volume Spike",
                execution: `Trailing Stop (ATR 2.5x) nebo Fixed TP (1.5 RRR) · ${cheatSheetNote}`,
            };
        }
        if (riskMode === "ai-matic-x") {
            return {
                label: "AI-MATIC-X",
                subtitle: "Swing OB 15m/1h · OB + Volume Profile + BTC filtr",
                symbols: SUPPORTED_SYMBOLS,
                timeframes: "15m vstup · 1h kontext",
                session: "24/7",
                risk: "2 vstupy (60 % / 40 %) · TP1 0.9–1.2 % · TP2 2–3 %",
                entry: "Entry 1: reakce z OB/sweep návrat · Entry 2: retest OB (GAP/Fibo)",
                execution: `SL pod strukturu/OB knot · trailing dle profilu (R-based / retracement) · ${cheatSheetNote}`,
            };
        }
        if (riskMode === "ai-matic-tree") {
            if (cheatEnabled) {
                return {
                    label: "AI-MATIC-TREE",
                    subtitle: "Decision Tree Gate (SWING/INTRADAY/SCALP)",
                    symbols: SUPPORTED_SYMBOLS,
                    timeframes: "SWING 4h/15m · INTRADAY 1h/5m/3m · SCALP 15m/1m/3m",
                    session: "24/7",
                    risk: "Risk 0.30% equity/trade · notional cap ~1% equity",
                    entry: "SWING: HTF reaction · INTRADAY: OB/BOS return · SCALP: rejection/BOS return",
                    execution: `LIMIT_MAKER_FIRST · scalp trailing po +0.5–0.7 % · limit wait: S 5–10m / I 15–30m / W 60–180m · ${cheatSheetNote}`,
                };
            }
            return {
                label: "AI-MATIC-TREE",
                subtitle: "Multi-TF Trend Engine (Cheat Sheet OFF)",
                symbols: SUPPORTED_SYMBOLS,
                timeframes: "HTF 1h/15m · LTF 5m/1m",
                session: "24/7",
                risk: "Risk 0.30% equity/trade · notional cap ~1% equity",
                entry: "Momentum / Pullback / Breakout (Mean reversion jen v range režimu)",
                execution: `TP ~2.2R + partial 1R · time stop ~2h · ${cheatSheetNote}`,
            };
        }
        return {
            label: "AI-MATIC",
            subtitle: "AI-MATIC Core (HTF 1h/15m · LTF 5m/1m)",
            symbols: SUPPORTED_SYMBOLS,
            timeframes: "HTF 1h · 15m · LTF 5m · 1m",
            session: "POI: Breaker > OB > FVG > Liquidity",
            risk: "Risk 0.40% equity/trade · notional cap ~1% equity",
            entry: "FVG/OB/Breaker + liquidity pools (0.2% tol, min 3 touches)",
            execution: `EMA50 trend gate · 1m timing + swing/ATR stop · ${cheatSheetNote}`,
        };
    }, [cheatEnabled, cheatSheetNote, riskMode]);
    const selectedSymbols = bot.settings?.selectedSymbols?.length ? bot.settings.selectedSymbols : null;
    const allowedSymbols = selectedSymbols ?? profileMeta.symbols;
    const exchangeOrders = ordersLoaded ? testnetOrders : [];
    const exchangeTrades = tradesLoaded ? testnetTrades : [];
    const refreshOrders = refreshTestnetOrders;
    const CHECKLIST_DEFAULTS_BY_PROFILE = useMemo(() => {
        const base = {
            "HTF bias": true,
            "EMA order": true,
            "EMA sep1": true,
            "EMA sep2": true,
            "ATR% window": true,
            "Volume Pxx": true,
            "LTF pullback": true,
            "Micro pivot": true,
            "Micro break close": true,
            "BBO fresh": true,
            "BBO age": true,
            "Trend strength": true,
            "Maker entry": true,
            "SL structural": true,
            "Exec allowed": true,
        };
        return {
            "ai-matic": base,
            "ai-matic-x": base,
            "ai-matic-tree": base,
            "ai-matic-scalp": {
                "Primary Timeframe: 15m for trend, 1m for entry.": true,
                "Entry Logic: EMA Cross (last <= 6 bars) + RSI Divergence + Volume Spike.": true,
                "Exit Logic: Trailing Stop (ATR 2.5x) or Fixed TP (1.5 RRR).": true,
                "Exec allowed": true,
            },
        };
    }, []);
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
        "HTF bias": ["Trend bias", "X setup", "Tree setup", "1h bias"],
        "Entry Logic: EMA Cross (last <= 6 bars) + RSI Divergence + Volume Spike.": [
            "Entry Logic: EMA Cross + RSI Divergence + Volume Spike.",
        ],
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
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(StatusBar, { title: profileMeta.label, subtitle: profileMeta.subtitle, mode: mode, setMode: setMode, useTestnet: useTestnet, setUseTestnet: setUseTestnet, systemState: systemState, engineStatus: engineStatus }), _jsx(KpiRow, { totalCapital: totalCapital, allocated: allocated, dailyPnl: dailyPnl, openPositionsPnl: openPositionsPnl, openPositions: openPositionsCount, maxOpenPositions: maxOpenPositions, openOrders: openOrdersCount, maxOpenOrders: maxOpenOrders }), _jsxs(Tabs, { defaultValue: "overview", className: "space-y-4", children: [_jsxs(TabsList, { className: "w-full justify-start", children: [_jsx(TabsTrigger, { value: "overview", children: "Overview" }), _jsx(TabsTrigger, { value: "positions", children: "Positions" }), _jsx(TabsTrigger, { value: "signals", children: "Signals" }), _jsx(TabsTrigger, { value: "orders", children: "Orders" }), _jsx(TabsTrigger, { value: "logs", children: "Logs" })] }), _jsx(TabsContent, { value: "overview", children: _jsx(OverviewTab, { profileMeta: profileMeta, allowedSymbols: allowedSymbols, assetPnlHistory: assetPnlHistory, pnlLoaded: pnlLoaded, resetPnlHistory: resetPnlHistory, scanDiagnostics: scanDiagnostics, scanLoaded: scanLoaded, lastScanTs: lastScanTs, logEntries: logEntries, logsLoaded: logsLoaded, useTestnet: useTestnet, onOpenSettings: () => setShowSettings(true) }) }), _jsx(TabsContent, { value: "positions", children: _jsx(PositionsTable, { positions: positionsLoaded ? activePositions : [], positionsLoaded: positionsLoaded, onClosePosition: manualClosePosition, allowClose: allowPositionClose }) }), _jsx(TabsContent, { value: "signals", children: _jsx(SignalsAccordion, { allowedSymbols: allowedSymbols, scanDiagnostics: scanDiagnostics, scanLoaded: scanLoaded, lastScanTs: lastScanTs, checklistEnabled: checklistEnabled, toggleChecklist: toggleChecklist, resetChecklist: resetChecklist, mode: mode, profileGateNames: checklistGateNames }) }), _jsx(TabsContent, { value: "orders", children: _jsx(OrdersPanel, { orders: exchangeOrders, ordersLoaded: ordersLoaded, ordersError: ordersError, refreshOrders: refreshOrders, trades: exchangeTrades, tradesLoaded: tradesLoaded, useTestnet: useTestnet, onCancelOrder: cancelOrder, allowCancel: allowOrderCancel }) }), _jsx(TabsContent, { value: "logs", children: _jsx(LogsPanel, { logEntries: logEntries, logsLoaded: logsLoaded, useTestnet: useTestnet }) })] }), showSettings && bot.settings && (_jsx(SettingsPanel, { theme: "dark", lang: "en", settings: bot.settings, onUpdateSettings: bot.updateSettings, onClose: () => setShowSettings(false) }))] }));
}
