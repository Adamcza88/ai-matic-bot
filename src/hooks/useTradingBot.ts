// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchState, sendIntent } from "../api/botApi";
import { ExecutionState, Symbol } from "../api/types";
import type {
  AISettings,
  ActivePosition,
  LogEntry,
  PortfolioState,
  SystemState,
  TestnetOrder,
  TestnetTrade,
} from "../types";
import type { AssetPnlMap } from "../lib/pnlHistory";

const DEFAULT_SETTINGS: AISettings = {
  riskMode: "ai-matic",
  strictRiskAdherence: true,
  pauseOnHighVolatility: false,
  avoidLowLiquidity: false,
  useTrendFollowing: true,
  smcScalpMode: true,
  useLiquiditySweeps: false,
  enableHardGates: true,
  enableSoftGates: true,
  entryStrictness: "base",
  enforceSessionHours: true,
  haltOnDailyLoss: true,
  haltOnDrawdown: true,
  useDynamicPositionSizing: true,
  lockProfitsWithTrail: true,
  baseRiskPerTrade: 0,
  maxAllocatedCapitalPercent: 1.0,
  maxPortfolioRiskPercent: 0.2,
  maxOpenPositions: 2,
  requireConfirmationInAuto: false,
  positionSizingMultiplier: 1.0,
  customInstructions: "",
  customStrategy: "",
  min24hVolume: 50,
  minProfitFactor: 1.0,
  minWinRate: 65,
  tradingStartHour: 0,
  tradingEndHour: 23,
  tradingDays: [0, 1, 2, 3, 4, 5, 6],
};

export function useTradingBot(
  _mode?: unknown,
  _useTestnet?: boolean,
  _authToken?: string
) {
  const [exec, setExec] = useState<ExecutionState | null>(null);
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);

  // Poll state (throttled)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await fetchState();
        if (alive) setExec(s);
      } catch {
        // ignore transient errors
      }
    };
    const id = setInterval(tick, 500);
    tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function autoTrade(signal: {
    symbol: Symbol;
    side: "Buy" | "Sell";
    entryPrice: number;
    slPrice: number;
    tpPrices: number[];
    notionalUSDT: number;
  }) {
    const intent = {
      intentId: crypto.randomUUID(),
      createdAt: Date.now(),
      profile: "AI-MATIC",
      symbol: signal.symbol,
      side: signal.side,
      entryType: "LIMIT_MAKER_FIRST",
      entryPrice: signal.entryPrice,
      qtyMode: "USDT_NOTIONAL",
      qtyValue: signal.notionalUSDT,
      slPrice: signal.slPrice,
      tpPrices: signal.tpPrices ?? [],
      expireAfterMs: 30_000,
      tags: { env: "mainnet", account: "UTA", mode: "oneway" },
    } as const;

    await sendIntent(intent);
  }

  const systemState = useMemo<SystemState>(() => {
    const market = exec?.ws?.market;
    const priv = exec?.ws?.private;
    const connected = market === "UP" && priv === "UP";
    const stale = market === "STALE" || priv === "STALE";
    return {
      bybitStatus: exec
        ? connected
          ? "Connected"
          : stale
            ? "Error"
            : "Disconnected"
        : "Connecting...",
      latency: 0,
      lastError: exec?.reason ?? null,
      recentErrors: exec?.reason ? [exec.reason] : [],
    };
  }, [exec]);

  const portfolioState = useMemo<PortfolioState>(() => {
    const total = 0;
    return {
      totalEquity: total,
      availableBalance: total,
      dailyPnl: 0,
      openPositions: exec?.position?.size ? 1 : 0,
      totalCapital: total,
      allocatedCapital: 0,
      maxAllocatedCapital: total,
      peakCapital: total,
      currentDrawdown: 0,
      maxOpenPositions: settings.maxOpenPositions,
    };
  }, [exec, settings.maxOpenPositions]);

  const activePositions = useMemo<ActivePosition[]>(() => {
    const pos = exec?.position;
    const size = Number(pos?.size ?? 0);
    if (!pos || !Number.isFinite(size) || size === 0) return [];
    const side = pos.side === "LONG" ? "Buy" : "Sell";
    const entryPrice = Number(pos.entryPrice ?? 0);
    const openedAt = new Date(exec?.ts ?? Date.now()).toISOString();
    return [
      {
        positionId: `${pos.symbol}-${side}`,
        symbol: pos.symbol,
        side,
        qty: size,
        size,
        entryPrice: Number.isFinite(entryPrice) ? entryPrice : 0,
        unrealizedPnl: Number(pos.unrealizedPnl ?? 0),
        openedAt,
        env: "mainnet",
      },
    ];
  }, [exec]);

  const logEntries = useMemo<LogEntry[]>(() => [], []);

  const testnetOrders = useMemo<TestnetOrder[]>(() => {
    const orders = exec?.orders ?? [];
    return orders.map((o: any) => ({
      orderId: String(o.orderId ?? ""),
      symbol: String(o.symbol ?? ""),
      side: (o.side ?? "Buy") as "Buy" | "Sell",
      qty: Number(o.qty ?? 0),
      price: o.price != null ? Number(o.price) : null,
      status: String(o.status ?? "UNK"),
      createdTime: new Date(exec?.ts ?? Date.now()).toISOString(),
    }));
  }, [exec]);

  const testnetTrades = useMemo<TestnetTrade[]>(() => [], []);
  const ordersError = null as string | null;
  const assetPnlHistory = useMemo<AssetPnlMap>(() => ({}), []);
  const scanDiagnostics = useMemo<Record<string, any>>(() => ({}), []);
  const dynamicSymbols = useMemo<string[]>(() => [], []);

  const refreshTestnetOrders = useCallback(async () => {
    try {
      const s = await fetchState();
      setExec(s);
    } catch {
      // ignore refresh errors
    }
  }, []);

  const resetPnlHistory = useCallback(() => {
    // no-op: history lives on the old client-side cache
  }, []);

  const manualClosePosition = useCallback(async (_pos: ActivePosition) => {
    // TODO: wire to backend close/kill switch
    return false;
  }, []);

  const updateSettings = useCallback((next: AISettings) => {
    setSettings(next);
  }, []);

  return {
    exec,
    autoTrade,
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
    dynamicSymbols,
    settings,
    updateSettings,
  };
}

export type TradingBotApi = ReturnType<typeof useTradingBot>;
