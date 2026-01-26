// src/components/Dashboard.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingMode } from "../types";
import type { TradingBotApi } from "../hooks/useTradingBot";
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

type DashboardProps = {
  mode: TradingMode;
  setMode: (m: TradingMode) => void;
  useTestnet: boolean;
  setUseTestnet: (v: boolean) => void;
  bot: TradingBotApi;
};

export default function Dashboard({
  mode,
  setMode,
  useTestnet,
  setUseTestnet,
  bot,
}: DashboardProps) {
  const {
    systemState,
    portfolioState,
    activePositions,
    logEntries,
    testnetOrders,
    testnetTrades,
    ordersError,
    refreshTestnetOrders,
    assetPnlHistory,
    resetPnlHistory,
    scanDiagnostics,
    manualClosePosition,
    cancelOrder,
    updateGateOverrides,
  } = bot;

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
  const [activeTab, setActiveTab] = useState("overview");

  const lastScanTs = useMemo(() => {
    if (!scanDiagnostics) return null;
    const values = Object.values(scanDiagnostics)
      .map((d: any) => d?.lastScanTs)
      .filter((ts) => Number.isFinite(ts));
    if (!values.length) return null;
    return Math.max(...(values as number[]));
  }, [scanDiagnostics]);

  const riskMode = bot.settings?.riskMode ?? "ai-matic";
  const cheatSheetSetupId =
    {
      "ai-matic": "ai-matic-core",
      "ai-matic-x": "ai-matic-x-smart-money-combo",
      "ai-matic-scalp": "ai-matic-scalp-scalpera",
      "ai-matic-tree": "ai-matic-decision-tree",
    }[riskMode] ?? "ai-matic-core";
  const cheatSheetSetup = getCheatSheetSetup(cheatSheetSetupId);
  const cheatSheetStatus = bot.settings?.strategyCheatSheetEnabled ? "On" : "Off";
  const cheatSheetLabel = cheatSheetSetup?.name ?? "Cheat sheet";
  const cheatSheetNote = `Cheat sheet: ${cheatSheetLabel} (${cheatSheetStatus})`;
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
        entry:
          "Entry 1: reakce z OB/sweep návrat · Entry 2: retest OB (GAP/Fibo)",
        execution: `SL pod strukturu/OB knot · trailing po +1.0 % (EMA20 / 0.5–0.8 %) · ${cheatSheetNote}`,
      };
    }
    if (riskMode === "ai-matic-tree") {
      return {
        label: "AI-MATIC-TREE",
        subtitle: "Fibonacci Strategy (trend pullbacks / confluence)",
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "1h context · 5m execution",
        session: "Bybit Linear Perpetuals · ~40 markets scan",
        risk: "Risk 0.30% equity/trade · notional cap ~1% equity",
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
      risk: "Risk 0.40% equity/trade · notional cap ~1% equity",
      entry: "FVG/OB/Breaker + liquidity pools (0.2% tol, min 3 touches)",
      execution: `EMA50 trend gate · 1m timing + swing/ATR stop · ${cheatSheetNote}`,
    };
  }, [cheatSheetNote, riskMode]);

  const selectedSymbols =
    bot.settings?.selectedSymbols?.length ? bot.settings.selectedSymbols : null;
  const allowedSymbols =
    selectedSymbols ?? profileMeta.symbols;

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
    return (
      CHECKLIST_DEFAULTS_BY_PROFILE[riskMode] ??
      CHECKLIST_DEFAULTS_BY_PROFILE["ai-matic"]
    );
  }, [CHECKLIST_DEFAULTS_BY_PROFILE, riskMode]);
  const checklistGateNames = useMemo(() => {
    const defaults =
      CHECKLIST_DEFAULTS_BY_PROFILE[riskMode] ??
      CHECKLIST_DEFAULTS_BY_PROFILE["ai-matic"];
    return Object.keys(defaults).filter((name) => name !== "Exec allowed");
  }, [CHECKLIST_DEFAULTS_BY_PROFILE, riskMode]);
  const CHECKLIST_ALIASES = useMemo(
    () => ({
      "HTF bias": ["Trend bias", "X setup", "Tree setup", "1h bias"],
      "Entry Logic: EMA Cross (last <= 6 bars) + RSI Divergence + Volume Spike.": [
        "Entry Logic: EMA Cross + RSI Divergence + Volume Spike.",
      ],
    }),
    []
  );

  const gateStorageKey = useMemo(
    () => `ai-matic-checklist-enabled:${riskMode}`,
    [riskMode]
  );
  const [checklistEnabled, setChecklistEnabled] = useState<Record<string, boolean>>(
    () => CHECKLIST_DEFAULTS
  );

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
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      const next = { ...CHECKLIST_DEFAULTS, ...(parsed ?? {}) };
      Object.entries(CHECKLIST_ALIASES).forEach(([name, aliases]) => {
        if (typeof parsed?.[name] === "boolean") return;
        for (const alias of aliases) {
          if (typeof parsed?.[alias] === "boolean") {
            next[name] = parsed[alias];
            break;
          }
        }
      });
      setChecklistEnabled(next);
    } catch {
      setChecklistEnabled(CHECKLIST_DEFAULTS);
    }
  }, [CHECKLIST_ALIASES, CHECKLIST_DEFAULTS, gateStorageKey]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(gateStorageKey, JSON.stringify(checklistEnabled));
  }, [checklistEnabled, gateStorageKey]);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    const migrated = localStorage.getItem(
      `ai-matic-checklist-migration-v3:${riskMode}`
    );
    if (migrated) return;
    localStorage.setItem(
      `ai-matic-checklist-migration-v3:${riskMode}`,
      "true"
    );
    setChecklistEnabled((prev) => ({
      ...prev,
      "Exec allowed": true,
    }));
  }, [riskMode]);

  useEffect(() => {
    updateGateOverrides?.(checklistEnabled);
  }, [checklistEnabled, updateGateOverrides]);

  const toggleChecklist = (name: string) => {
    setChecklistEnabled((p) => ({ ...p, [name]: !(p[name] ?? true) }));
  };
  const resetChecklist = useCallback(() => {
    setChecklistEnabled(CHECKLIST_DEFAULTS);
  }, [CHECKLIST_DEFAULTS]);
  const [showSettings, setShowSettings] = useState(false);

  const rawMaxOpenPositions =
    portfolioState?.maxOpenPositions ?? bot.settings?.maxOpenPositions ?? 3;
  const maxOpenPositions = rawMaxOpenPositions;
  const openPositionsCount = positionsLoaded ? activePositions.length : 0;
  const openOrdersCount = ordersLoaded ? exchangeOrders.length : 0;
  const maxOpenOrders = bot.settings?.maxOpenOrders ?? 0;
  const totalCapital =
    portfolioState?.totalCapital ?? portfolioState?.totalEquity;
  const allocated = portfolioState?.allocatedCapital;
  const engineStatus = mode === TradingMode.AUTO_ON ? "Running" : "Paused";

  return (
    <div className="space-y-6">
      <StatusBar
        title={profileMeta.label}
        subtitle={profileMeta.subtitle}
        mode={mode}
        setMode={setMode}
        useTestnet={useTestnet}
        setUseTestnet={setUseTestnet}
        systemState={systemState}
        engineStatus={engineStatus}
      />

      <KpiRow
        totalCapital={totalCapital}
        allocated={allocated}
        dailyPnl={dailyPnl}
        openPositionsPnl={openPositionsPnl}
        openPositions={openPositionsCount}
        maxOpenPositions={maxOpenPositions}
        openOrders={openOrdersCount}
        maxOpenOrders={maxOpenOrders}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          if (value === "logs") {
            refreshTestnetOrders();
          }
        }}
        className="space-y-4"
      >
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="signals">Signals</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab
            profileMeta={profileMeta}
            allowedSymbols={allowedSymbols}
            assetPnlHistory={assetPnlHistory}
            pnlLoaded={pnlLoaded}
            resetPnlHistory={resetPnlHistory}
            scanDiagnostics={scanDiagnostics}
            scanLoaded={scanLoaded}
            lastScanTs={lastScanTs}
            logEntries={logEntries}
            logsLoaded={logsLoaded}
            useTestnet={useTestnet}
            onOpenSettings={() => setShowSettings(true)}
          />
        </TabsContent>
        <TabsContent value="positions">
          <PositionsTable
            positions={positionsLoaded ? activePositions : []}
            positionsLoaded={positionsLoaded}
            onClosePosition={manualClosePosition}
          />
        </TabsContent>
          <TabsContent value="signals">
            <SignalsAccordion
              allowedSymbols={allowedSymbols}
              scanDiagnostics={scanDiagnostics}
              scanLoaded={scanLoaded}
              lastScanTs={lastScanTs}
              checklistEnabled={checklistEnabled}
              toggleChecklist={toggleChecklist}
              resetChecklist={resetChecklist}
              mode={mode}
              profileGateNames={checklistGateNames}
            />
          </TabsContent>
        <TabsContent value="orders">
          <OrdersPanel
            orders={exchangeOrders}
            ordersLoaded={ordersLoaded}
            ordersError={ordersError}
            refreshOrders={refreshOrders}
            trades={exchangeTrades}
            tradesLoaded={tradesLoaded}
            useTestnet={useTestnet}
            onCancelOrder={cancelOrder}
          />
        </TabsContent>
        <TabsContent value="logs">
          <LogsPanel
            logEntries={logEntries}
            logsLoaded={logsLoaded}
            useTestnet={useTestnet}
            isActive={activeTab === "logs"}
          />
        </TabsContent>
      </Tabs>

      {showSettings && bot.settings && (
        <SettingsPanel
          theme="dark"
          lang="en"
          settings={bot.settings}
          onUpdateSettings={bot.updateSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
