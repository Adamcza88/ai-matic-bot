import { useCallback, useEffect, useMemo, useState } from "react";
import { TradingMode } from "../types";
import type { TradingBotApi } from "../hooks/useTradingBot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import RiskBlockPanel from "./dashboard/RiskBlockPanel";
import { SUPPORTED_SYMBOLS } from "../constants/symbols";
import type { DiagnosticGate, SymbolDiagnostic } from "@/lib/diagnosticsTypes";
import { UI_COPY } from "@/lib/uiCopy";

const RISK_PCT_BY_MODE = {
  "ai-matic": 0.004,
  "ai-matic-x": 0.003,
  "ai-matic-scalp": 0.0025,
  "ai-matic-tree": 0.003,
  "ai-matic-pro": 0.003,
} as const;

const HEALTH_OK_MS = 2_000;
const MODE_OPTIONS: TradingMode[] = [TradingMode.OFF, TradingMode.AUTO_ON];

function modeLabel(value: TradingMode) {
  return value === TradingMode.AUTO_ON
    ? UI_COPY.statusBar.auto
    : UI_COPY.statusBar.manual;
}

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
  const openPositionsPnlRange = positionsLoaded
    ? (() => {
        const values = activePositions
          .map((position) => Number(position?.unrealizedPnl))
          .filter((value) => Number.isFinite(value)) as number[];
        if (!values.length) return undefined;
        return {
          min: Math.min(...values),
          max: Math.max(...values),
        };
      })()
    : undefined;
  const ordersLoaded = Array.isArray(testnetOrders);
  const tradesLoaded = Array.isArray(testnetTrades);
  const logsLoaded = Array.isArray(logEntries);
  const pnlLoaded = Boolean(assetPnlHistory);
  const scanLoaded = scanDiagnostics !== null;
  const [activeTab, setActiveTab] = useState("decision");

  const lastScanTs = useMemo(() => {
    if (!scanDiagnostics) return null;
    const values = Object.values(scanDiagnostics)
      .map((d: SymbolDiagnostic) => d?.lastScanTs)
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
      "Hard: ALL 4": true,
      "Entry: 3 of 4": true,
      "Checklist: 5 of 8": true,
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
      "Hard: ALL 4": ["Hard: 3 of 6"],
      "Entry: 3 of 4": ["Entry: Any of 5"],
      "Checklist: 5 of 8": ["Checklist: 3 of 7"],
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
  const capitalRange = useMemo(() => {
    if (!Number.isFinite(totalCapital)) return undefined;
    if (!Number.isFinite(openPositionsPnl)) return undefined;
    if (!openPositionsPnlRange) return undefined;
    const realizedBase = (totalCapital as number) - (openPositionsPnl as number);
    return {
      min: realizedBase + openPositionsPnlRange.min,
      max: realizedBase + openPositionsPnlRange.max,
    };
  }, [openPositionsPnl, openPositionsPnlRange, totalCapital]);

  const blockedSignalsCount = useMemo(() => {
    if (!scanDiagnostics) return 0;
    return Object.values(scanDiagnostics).filter((diag: SymbolDiagnostic) => {
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
      gates.forEach((gate: DiagnosticGate) => {
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
      minAge: ages.length ? Math.min(...ages) : undefined,
      maxAge: ages.length ? Math.max(...ages) : undefined,
      ok,
    };
  }, [allowedSymbols, scanDiagnostics]);

  const execOverrideEnabled = checklistEnabled["Exec allowed"] ?? true;
  const setExecOverrideEnabled = useCallback((enabled: boolean) => {
    setChecklistEnabled((prev) => ({
      ...prev,
      "Exec allowed": enabled,
    }));
  }, []);

  const dataHealthSafe = useMemo(() => {
    if (mode !== TradingMode.AUTO_ON) return false;
    if (systemState.bybitStatus !== "Connected") return false;
    if (!Number.isFinite(feedStats.maxAge)) return false;
    return (feedStats.maxAge as number) < HEALTH_OK_MS && feedStats.ok;
  }, [feedStats.maxAge, feedStats.ok, mode, systemState.bybitStatus]);

  const riskLevel = useMemo(() => {
    if (execOverrideEnabled) return "CRITICAL" as const;
    if (blockedSignalsCount > 0) return "ELEVATED" as const;
    if (gateStats.total > 0 && gateStats.pass < gateStats.total) return "ELEVATED" as const;
    return "LOW" as const;
  }, [blockedSignalsCount, execOverrideEnabled, gateStats.pass, gateStats.total]);

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
    <div className="mx-auto max-w-[1200px] space-y-4 px-4 py-4 lg:px-6">
      <StatusBar
        title={profileMeta.label}
        subtitle={profileMeta.subtitle}
        engineStatus={engineStatus}
        lastScanTs={lastScanTs}
        riskLevel={riskLevel}
        dataHealthSafe={dataHealthSafe}
        dailyPnl={dailyPnl}
        totalCapital={totalCapital}
        openPositionsPnlRange={openPositionsPnlRange}
        capitalRange={capitalRange}
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value);
          if (value === "audit" || value === "decision") {
            refreshTestnetOrders();
          }
        }}
        className="space-y-3 lm-tabs"
      >
        <section className="sticky top-[152px] z-10 space-y-3 rounded-xl border border-border/70 bg-card/92 p-3 shadow-[0_8px_16px_-12px_rgba(0,0,0,0.7)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  riskLevel === "CRITICAL"
                    ? "border-red-500/50 bg-red-500/15 px-2 py-1 text-red-300"
                    : riskLevel === "ELEVATED"
                      ? "border-amber-500/50 bg-amber-500/15 px-2 py-1 text-amber-300"
                      : "border-emerald-500/50 bg-emerald-500/15 px-2 py-1 text-emerald-300"
                }
              >
                RISK {riskLevel}
              </Badge>
              <Button
                type="button"
                variant={execOverrideEnabled ? "destructive" : "default"}
                size="sm"
                onClick={() => setExecOverrideEnabled(true)}
                className="h-11 px-4 text-sm font-semibold"
              >
                Override ALL HOLD → EXECUTE
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExecOverrideEnabled(false)}
                className="h-11 px-4 text-sm font-semibold"
              >
                Disable Override
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetChecklist}
                className="h-11 px-4 text-sm font-semibold"
              >
                Reset ALL gates
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-md border border-border/60 bg-background/70 p-1">
                <Button
                  variant={useTestnet ? "default" : "ghost"}
                  size="sm"
                  data-testid="env-demo-button"
                  onClick={() => setUseTestnet(true)}
                  disabled={envAvailability ? !envAvailability.canUseDemo : false}
                  title={
                    envAvailability && !envAvailability.canUseDemo
                      ? envAvailability.demoReason ?? "Demo prostředí není dostupné"
                      : "Použít demo prostředí"
                  }
                  className={useTestnet ? "h-11 min-w-24 text-sm font-semibold" : "h-11 min-w-24 text-sm font-semibold text-muted-foreground"}
                >
                  {UI_COPY.statusBar.demo}
                </Button>
                <Button
                  variant={!useTestnet ? "default" : "ghost"}
                  size="sm"
                  data-testid="env-mainnet-button"
                  onClick={() => setUseTestnet(false)}
                  disabled={envAvailability ? !envAvailability.canUseMainnet : false}
                  title={
                    envAvailability && !envAvailability.canUseMainnet
                      ? envAvailability.mainnetReason ?? "Mainnet prostředí není dostupné"
                      : "Použít mainnet prostředí"
                  }
                  className={!useTestnet ? "h-11 min-w-24 text-sm font-semibold" : "h-11 min-w-24 text-sm font-semibold text-muted-foreground"}
                >
                  {UI_COPY.statusBar.mainnet}
                </Button>
              </div>

              <div className="flex items-center rounded-md border border-border/60 bg-background/70 p-1">
                {MODE_OPTIONS.map((value) => (
                  <Button
                    key={value}
                    variant={mode === value ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setMode(value)}
                    className={mode === value ? "h-11 min-w-24 text-sm font-semibold" : "h-11 min-w-24 text-sm font-semibold text-muted-foreground"}
                  >
                    {modeLabel(value)}
                  </Button>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(true)}
                className="h-11 px-4 text-sm font-semibold"
              >
                {UI_COPY.common.settings}
              </Button>
            </div>
          </div>

          <TabsList className="h-12 w-full justify-start gap-2 rounded-xl border border-border/60 bg-card/80 p-1 lm-tabs-shell">
            <TabsTrigger value="decision" className="h-10 px-3 text-sm lm-tabs-trigger">
              Rozhodování
            </TabsTrigger>
            <TabsTrigger value="execution" className="h-10 px-3 text-sm lm-tabs-trigger">
              Exekuce ({openPositionsCount + openOrdersCount})
            </TabsTrigger>
            <TabsTrigger value="audit" className="h-10 px-3 text-sm lm-tabs-trigger">
              Audit
            </TabsTrigger>
          </TabsList>
        </section>

        <KpiRow
          dataHealthSafe={dataHealthSafe}
          latencyMs={systemState.latency}
          feedAgeRangeMs={
            Number.isFinite(feedStats.minAge) && Number.isFinite(feedStats.maxAge)
              ? {
                  min: feedStats.minAge as number,
                  max: feedStats.maxAge as number,
                }
              : undefined
          }
          gatesPassCount={gateStats.pass}
          gatesTotal={gateStats.total}
          blockedSignals={blockedSignalsCount}
          totalCapital={totalCapital}
          capitalRange={capitalRange}
          allocated={allocated}
          dailyPnl={dailyPnl}
          dailyPnlBreakdown={dailyPnlBreakdown}
          openPositionsPnl={openPositionsPnl}
          openPositionsPnlRange={openPositionsPnlRange}
          openPositions={openPositionsCount}
          maxOpenPositions={maxOpenPositions}
          openOrders={openOrdersCount}
          maxOpenOrders={maxOpenOrders}
          riskPerTradePct={riskPerTradePct}
          riskPerTradeUsd={riskPerTradeUsd}
        />

        <div className="dashboard-tab-viewport lm-tab-viewport">
          <TabsContent value="decision" className="mt-0">
            <div className="space-y-4">
              <RiskBlockPanel
                allowedSymbols={allowedSymbols}
                scanDiagnostics={scanDiagnostics}
                lastScanTs={lastScanTs}
                logEntries={logEntries}
                logsLoaded={logsLoaded}
              />
              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 xl:col-span-8">
                  <OverviewTab
                    allowedSymbols={allowedSymbols}
                    assetPnlHistory={assetPnlHistory}
                    pnlLoaded={pnlLoaded}
                    resetPnlHistory={resetPnlHistory}
                    scanDiagnostics={scanDiagnostics}
                    scanLoaded={scanLoaded}
                    lastScanTs={lastScanTs}
                    selectedSymbol={selectedSignalSymbol}
                  />
                </div>
                <div className="col-span-12 xl:col-span-4 space-y-4">
                  <SignalsAccordion
                    allowedSymbols={allowedSymbols}
                    scanDiagnostics={scanDiagnostics}
                    scanLoaded={scanLoaded}
                    lastScanTs={lastScanTs}
                    overrideEnabled={execOverrideEnabled}
                    setOverrideEnabled={setExecOverrideEnabled}
                    resetChecklist={resetChecklist}
                    profileGateNames={checklistGateNames}
                    selectedSymbol={selectedSignalSymbol}
                    onSelectSymbol={setSelectedSignalSymbol}
                  />
                  <SignalDetailPanel
                    selectedSymbol={selectedSignalSymbol}
                    scanDiagnostics={scanDiagnostics}
                    scanLoaded={scanLoaded}
                    checklistEnabled={checklistEnabled}
                    toggleChecklist={toggleChecklist}
                    profileGateNames={checklistGateNames}
                    resetChecklist={resetChecklist}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="execution" className="mt-0">
            <div className="space-y-4">
              <PositionsTable
                positions={positionsLoaded ? activePositions : []}
                positionsLoaded={positionsLoaded}
                onClosePosition={manualClosePosition}
                allowClose={allowPositionClose}
              />
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
            </div>
          </TabsContent>

          <TabsContent value="audit" className="mt-0">
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 xl:col-span-8 space-y-4">
                <LogsPanel
                  logEntries={logEntries}
                  logsLoaded={logsLoaded}
                  useTestnet={useTestnet}
                  isActive={activeTab === "audit"}
                />
                <RecentEventsPanel
                  logEntries={logEntries}
                  logsLoaded={logsLoaded}
                />
              </div>
              <div className="col-span-12 xl:col-span-4">
                <StrategyProfileMini
                  profileMeta={profileMeta}
                  onOpenSettings={() => setShowSettings(true)}
                />
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>

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
