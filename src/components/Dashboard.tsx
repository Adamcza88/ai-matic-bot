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
import SignalDetailPanel from "./dashboard/SignalDetailPanel";
import StrategyProfileMini from "./dashboard/StrategyProfileMini";
import RecentEventsPanel from "./dashboard/RecentEventsPanel";
import { SUPPORTED_SYMBOLS } from "../constants/symbols";

const RISK_PCT_BY_MODE = {
  "ai-matic": 0.004,
  "ai-matic-x": 0.003,
  "ai-matic-scalp": 0.0025,
  "ai-matic-tree": 0.003,
  "ai-matic-pro": 0.003,
} as const;

type DashboardProps = {
  mode: TradingMode;
  setMode: (m: TradingMode) => void;
  useTestnet: boolean;
  setUseTestnet: (v: boolean) => void;
  theme: "dark" | "light";
  envAvailability?: {
    canUseDemo: boolean;
    canUseMainnet: boolean;
    demoReason?: string;
    mainnetReason?: string;
  };
  bot: TradingBotApi;
  userEmail: string;
  isGuest: boolean;
  missingServices: string[];
  keysError: string | null;
  onSignOut: () => void;
  onToggleTheme: () => void;
  apiKeysUserId: string;
  onKeysUpdated: () => void | Promise<void>;
};

export default function Dashboard({
  mode,
  setMode,
  useTestnet,
  setUseTestnet,
  theme,
  envAvailability,
  bot,
  userEmail,
  isGuest,
  missingServices,
  keysError,
  onSignOut,
  onToggleTheme,
  apiKeysUserId,
  onKeysUpdated,
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
    allowOrderCancel,
    allowPositionClose,
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
  const profileMeta = useMemo(() => {
    if (riskMode === "ai-matic-scalp") {
      return {
        label: "AI-MATIC-SCALP",
        subtitle: "Scalp Core · 15m trend / 1m entry",
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "15m trend · 1m entry",
        session: "24/7",
        risk: "Risk 0.25% equity/trade · notional cap ~1% equity",
        riskPct: RISK_PCT_BY_MODE["ai-matic-scalp"],
        entry: "Fibo retrace + 1 potvrzení (OB/GAP/VP/EMA TL)",
        execution: "TP Fibo extension (dynamic) · ATR trailing 2.5x",
      };
    }
    if (riskMode === "ai-matic-x") {
      return {
        label: "AI-MATIC-X",
        subtitle: "Swing OB 15m/1h · Volume Profile · BTC filtr",
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "15m vstup · 1h kontext",
        session: "24/7",
        risk: "2 vstupy (60 % / 40 %) · TP1 0.9–1.2 % · TP2 2–3 %",
        riskPct: RISK_PCT_BY_MODE["ai-matic-x"],
        entry: "Entry 1: reakce z OB/sweep · Entry 2: retest OB/GAP/Fibo",
        execution: "SL pod strukturu/OB + ATR buffer · trailing 1.0R",
      };
    }
    if (riskMode === "ai-matic-tree") {
      const strictness = bot.settings?.entryStrictness ?? "base";
      const maxPos = bot.settings?.maxOpenPositions ?? 7;
      return {
        label: "AI-MATIC-TREE",
        subtitle: `Multi-TF Trend Engine · MaxPos: ${maxPos}`,
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "HTF 1h/15m · LTF 5m/1m",
        session: "24/7",
        risk: "Risk 0.30% equity/trade · notional cap ~1% equity",
        riskPct: RISK_PCT_BY_MODE["ai-matic-tree"],
        entry: `Strictness: ${strictness.toUpperCase()} · Momentum/Pullback/Breakout`,
        execution: "TP 2.2R + partial 1R · time stop ~2h",
      };
    }
    if (riskMode === "ai-matic-pro") {
      return {
        label: "AI-MATIC-PRO",
        subtitle: "Sideways only · Market Profile + Orderflow",
        symbols: SUPPORTED_SYMBOLS,
        timeframes: "1h režim · 15m/mid · 5m entry · 1m exec",
        session: "24/7",
        risk: "Risk 0.30% equity/trade · notional cap ~1% equity",
        riskPct: RISK_PCT_BY_MODE["ai-matic-pro"],
        entry: "VA edge + OFI/Delta absorpce",
        execution: "T1 VWAP/mid (60%) · T2 POC/VAH/VAL · time stop 10 svíček/60m",
      };
    }
    return {
      label: "AI-MATIC",
      subtitle: "AI-MATIC Core (HTF 1h/15m · LTF 5m)",
      symbols: SUPPORTED_SYMBOLS,
      timeframes: "HTF 1h · 15m · LTF 5m",
      session: "POI priorita: Breaker > OB > FVG > Liquidity",
      risk: "Risk 0.40% equity/trade · notional cap ~1% equity",
      riskPct: RISK_PCT_BY_MODE["ai-matic"],
      entry: "Entry 1/2 (60/40): OB reakce/sweep návrat + retest OB/GAP",
      execution:
        "SL pod strukturu/OB + ATR buffer · TP1 0.9–1.2% (70%) · TP2 2–3% · trailing +1.0%",
    };
  }, [bot.settings?.entryStrictness, bot.settings?.maxOpenPositions, riskMode]);

  const selectedSymbols =
    bot.settings?.selectedSymbols?.length ? bot.settings.selectedSymbols : null;
  const allowedSymbols = (selectedSymbols ?? profileMeta.symbols).map((symbol) =>
    String(symbol)
  );

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
    const aiMatic = {
      "Hard: 3 of 6": true,
      "Entry: Any of 5": true,
      "Checklist: 3 of 7": true,
      "Exec allowed": true,
    };
    return {
      "ai-matic": aiMatic,
      "ai-matic-x": base,
      "ai-matic-tree": base,
      "ai-matic-pro": {
        "Hurst < 0.45": true,
        "CHOP > 60": true,
        "HMM state0 p>=0.7": true,
        "VPIN < 0.8": true,
        "OFI/Delta trigger": true,
        "VA edge": true,
        "Exec allowed": true,
      },
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
  const [selectedSignalSymbol, setSelectedSignalSymbol] = useState<string | null>(null);

  useEffect(() => {
    if (!allowedSymbols.length) {
      setSelectedSignalSymbol(null);
      return;
    }
    if (selectedSignalSymbol && allowedSymbols.includes(selectedSignalSymbol)) return;
    const blocked = allowedSymbols.find(
      (symbol) => scanDiagnostics?.[symbol]?.executionAllowed === false
    );
    setSelectedSignalSymbol(blocked ?? allowedSymbols[0]);
  }, [allowedSymbols, scanDiagnostics, selectedSignalSymbol]);

  const rawMaxOpenPositions =
    portfolioState?.maxOpenPositions ?? bot.settings?.maxOpenPositions ?? 3;
  const maxOpenPositions = rawMaxOpenPositions;
  const openPositionsCount = positionsLoaded ? activePositions.length : 0;
  const openOrdersCount = ordersLoaded ? exchangeOrders.length : 0;
  const maxOpenOrders = bot.settings?.maxOpenOrders ?? 0;
  const totalCapital =
    portfolioState?.totalCapital ?? portfolioState?.totalEquity;
  const allocated = portfolioState?.allocatedCapital;
  const riskPerTradePct = profileMeta.riskPct;
  const riskPerTradeUsd =
    Number.isFinite(totalCapital) && Number.isFinite(riskPerTradePct)
      ? (totalCapital as number) * (riskPerTradePct as number)
      : Number.NaN;

  const blockedSignalsCount = useMemo(() => {
    if (!scanDiagnostics) return 0;
    return Object.values(scanDiagnostics).filter((diag: any) => {
      if (!diag) return false;
      if (diag?.executionAllowed === false) return true;
      if (diag?.symbolState === "HOLD") return true;
      const entryBlockReasons = Array.isArray(diag?.entryBlockReasons)
        ? diag.entryBlockReasons
        : [];
      return entryBlockReasons.length > 0;
    }).length;
  }, [scanDiagnostics]);

  const gateStats = useMemo(() => {
    let pass = 0;
    let total = 0;
    const gateSet = new Set(checklistGateNames);
    allowedSymbols.forEach((symbol) => {
      const diag = scanDiagnostics?.[symbol];
      const gates = Array.isArray(diag?.gates) ? diag.gates : [];
      gates.forEach((gate: any) => {
        if (!gateSet.has(gate.name)) return;
        total += 1;
        if (gate.ok) pass += 1;
      });
    });
    return { pass, total };
  }, [allowedSymbols, checklistGateNames, scanDiagnostics]);

  const feedStats = useMemo(() => {
    const ages: number[] = [];
    let ok = true;
    allowedSymbols.forEach((symbol) => {
      const diag = scanDiagnostics?.[symbol];
      const age = Number(diag?.feedAgeMs);
      if (Number.isFinite(age)) ages.push(age);
      if (diag?.feedAgeOk === false) ok = false;
    });
    return {
      maxAge: ages.length ? Math.max(...ages) : undefined,
      ok,
    };
  }, [allowedSymbols, scanDiagnostics]);

  const dailyPnlBreakdown = useMemo(
    () => ({
      realized: dailyPnl,
      fees: Number.NaN,
      funding: Number.NaN,
      other: Number.NaN,
      note: "Fees a funding nejsou dostupné v closed-PnL payload.",
    }),
    [dailyPnl]
  );
  const engineStatus = mode === TradingMode.AUTO_ON ? "Running" : "Paused";

  return (
    <div className="mx-auto max-w-[1360px] px-6 pt-6 pb-4">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12">
          <StatusBar
            title={profileMeta.label}
            subtitle={profileMeta.subtitle}
            mode={mode}
            setMode={setMode}
            useTestnet={useTestnet}
            setUseTestnet={setUseTestnet}
            systemState={systemState}
            engineStatus={engineStatus}
            lastScanTs={lastScanTs}
            envAvailability={envAvailability}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>

        <div className="col-span-12">
          <KpiRow
            totalCapital={totalCapital}
            allocated={allocated}
            dailyPnl={dailyPnl}
            dailyPnlBreakdown={dailyPnlBreakdown}
            openPositionsPnl={openPositionsPnl}
            openPositions={openPositionsCount}
            maxOpenPositions={maxOpenPositions}
            openOrders={openOrdersCount}
            maxOpenOrders={maxOpenOrders}
            riskPerTradePct={riskPerTradePct}
            riskPerTradeUsd={riskPerTradeUsd}
            blockedSignals={blockedSignalsCount}
            gatesPassCount={gateStats.pass}
            gatesTotal={gateStats.total}
            feedAgeMs={feedStats.maxAge}
            feedOk={feedStats.ok}
            latencyMs={systemState.latency}
          />
        </div>

        <div className="col-span-12 xl:col-span-8">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value);
              if (value === "logs" || value === "overview") {
                refreshTestnetOrders();
              }
            }}
            className="space-y-3 lm-tabs"
          >
            <TabsList className="h-12 w-full justify-start gap-2 rounded-xl border border-border/60 bg-card/80 p-1 lm-tabs-shell">
              <TabsTrigger value="overview" className="h-10 px-3 text-sm lm-tabs-trigger">
                Overview
              </TabsTrigger>
              <TabsTrigger value="positions" className="h-10 px-3 text-sm lm-tabs-trigger">
                Positions ({openPositionsCount})
              </TabsTrigger>
              <TabsTrigger value="signals" className="h-10 px-3 text-sm lm-tabs-trigger">
                Signals ({allowedSymbols.length})
              </TabsTrigger>
              <TabsTrigger value="orders" className="h-10 px-3 text-sm lm-tabs-trigger">
                Orders ({openOrdersCount})
              </TabsTrigger>
              <TabsTrigger value="logs" className="h-10 px-3 text-sm lm-tabs-trigger">
                Logs
              </TabsTrigger>
            </TabsList>

            <div className="dashboard-tab-viewport lm-tab-viewport">
              <TabsContent value="overview" className="mt-0">
                <OverviewTab
                  allowedSymbols={allowedSymbols}
                  assetPnlHistory={assetPnlHistory}
                  pnlLoaded={pnlLoaded}
                  resetPnlHistory={resetPnlHistory}
                  scanDiagnostics={scanDiagnostics}
                  scanLoaded={scanLoaded}
                  lastScanTs={lastScanTs}
                />
              </TabsContent>

              <TabsContent value="positions" className="mt-0">
                <PositionsTable
                  positions={positionsLoaded ? activePositions : []}
                  positionsLoaded={positionsLoaded}
                  onClosePosition={manualClosePosition}
                  allowClose={allowPositionClose}
                />
              </TabsContent>

              <TabsContent value="signals" className="mt-0">
                <SignalsAccordion
                  allowedSymbols={allowedSymbols}
                  scanDiagnostics={scanDiagnostics}
                  scanLoaded={scanLoaded}
                  lastScanTs={lastScanTs}
                  checklistEnabled={checklistEnabled}
                  resetChecklist={resetChecklist}
                  profileGateNames={checklistGateNames}
                  selectedSymbol={selectedSignalSymbol}
                  onSelectSymbol={setSelectedSignalSymbol}
                />
              </TabsContent>

              <TabsContent value="orders" className="mt-0">
                <OrdersPanel
                  orders={exchangeOrders}
                  trades={exchangeTrades}
                  ordersLoaded={ordersLoaded}
                  tradesLoaded={tradesLoaded}
                  onCancelOrder={cancelOrder}
                  allowCancel={allowOrderCancel}
                  refreshOrders={refreshOrders}
                  ordersError={ordersError}
                  useTestnet={useTestnet}
                />
              </TabsContent>

              <TabsContent value="logs" className="mt-0">
                <LogsPanel
                  logEntries={logEntries}
                  logsLoaded={logsLoaded}
                  useTestnet={useTestnet}
                  isActive={activeTab === "logs"}
                />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <div className="dashboard-right-stack space-y-4">
            <SignalDetailPanel
              selectedSymbol={selectedSignalSymbol}
              scanDiagnostics={scanDiagnostics}
              scanLoaded={scanLoaded}
              checklistEnabled={checklistEnabled}
              toggleChecklist={toggleChecklist}
              profileGateNames={checklistGateNames}
            />
            <StrategyProfileMini
              profileMeta={profileMeta}
              onOpenSettings={() => setShowSettings(true)}
            />
          </div>
        </div>

        <div className="col-span-12">
          <RecentEventsPanel
            logEntries={logEntries}
            logsLoaded={logsLoaded}
          />
        </div>
      </div>

      {showSettings && bot.settings && (
        <SettingsPanel
          theme={theme}
          lang="en"
          settings={bot.settings}
          onUpdateSettings={bot.updateSettings}
          onClose={() => setShowSettings(false)}
          userEmail={userEmail}
          isGuest={isGuest}
          missingServices={missingServices}
          keysError={keysError}
          onSignOut={onSignOut}
          onToggleTheme={onToggleTheme}
          apiKeysUserId={apiKeysUserId}
          onKeysUpdated={onKeysUpdated}
        />
      )}
    </div>
  );
}
