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
    dynamicSymbols,
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

  const lastScanTs = useMemo(() => {
    if (!scanDiagnostics) return null;
    const values = Object.values(scanDiagnostics)
      .map((d: any) => d?.lastScanTs)
      .filter((ts) => Number.isFinite(ts));
    if (!values.length) return null;
    return Math.max(...(values as number[]));
  }, [scanDiagnostics]);

  const riskMode = bot.settings?.riskMode ?? "ai-matic";
  const profileMeta = useMemo(() => {
    if (riskMode === "ai-matic-scalp") {
      return {
        label: "AI-MATIC-SCALP",
        subtitle: "Scalp (15m trend / 1m entry)",
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "15m trend / 1m entry",
        session: "08:00-12:00 / 13:00-17:00 UTC",
        risk: "RRR target 1.5",
        entry: "EMA cross + RSI divergence + volume spike",
        execution: "Trailing stop ATR 2.5x or fixed TP 1.5 RRR",
      };
    }
    if (riskMode === "ai-matic-x") {
      return {
        label: "AI-MATIC-X",
        subtitle: "Decision Tree (1h context / 5m execution)",
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "1h context · 5m execution",
        session: "24/7",
        risk: "Order value per symbol · margin 100 USDT · max 1 position total",
        entry: "Families 1–6: pullback, continuation, range fade, break&flip, reversal, no trade",
        execution: "LIMIT default · MARKET only in strong expanse · PostOnly only in low‑vol range",
      };
    }
    if (riskMode === "ai-matic-tree") {
      return {
        label: "AI-MATIC TREE",
        subtitle: "Decision Tree – Market → Action (1h context / 5m execution)",
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "1h context · 5m execution",
        session: "Bybit Linear Perpetuals · ~40 markets scan",
        risk: "Order value per symbol · Risk ON: 1R · Risk OFF: 0.25R · max 5 trades/day · margin 100 USDT",
        entry: "Families 1–6 · A-setup required",
        execution: "Checklist B management · Kill switch -3R",
      };
    }
    return {
      label: "AI-MATIC",
      subtitle: "AI-MATIC (HTF 1h/15m · LTF 5m/1m)",
      symbols: SUPPORTED_SYMBOLS,
      timeframes: "HTF 1h · 15m · LTF 5m · 1m",
      session: "POI: Breaker > OB > FVG > Liquidity",
      risk: "Order value per symbol · margin 100 USDT · max positions by settings",
      entry: "FVG/OB/Breaker + liquidity pools (0.2% tol, min 3 touches)",
      execution: "Swing window 7 · 5m management + SL/TS",
    };
  }, [riskMode]);

  const selectedSymbols =
    bot.settings?.selectedSymbols?.length ? bot.settings.selectedSymbols : null;
  const allowedSymbols =
    selectedSymbols ??
    (bot.settings?.riskMode === "ai-matic-x" && dynamicSymbols?.length
      ? dynamicSymbols
      : profileMeta.symbols);

  const exchangeOrders = ordersLoaded ? testnetOrders : [];
  const exchangeTrades = tradesLoaded ? testnetTrades : [];
  const refreshOrders = refreshTestnetOrders;

  const CHECKLIST_DEFAULTS_BY_PROFILE = useMemo(
    () => ({
      "ai-matic": {
        "Trend bias": false,
        "Exec allowed": true,
      },
      "ai-matic-x": {
        "X setup": false,
        "Exec allowed": true,
      },
      "ai-matic-tree": {
        "Tree setup": false,
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
    }),
    []
  );
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
      "1h bias": ["Trend bias"],
      "X setup": ["Trend bias"],
      "Tree setup": ["Trend bias"],
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

      <Tabs defaultValue="overview" className="space-y-4">
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
