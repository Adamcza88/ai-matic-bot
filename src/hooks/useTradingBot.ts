// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi";
import { EntryType, Symbol } from "../api/types";
import { getApiBase } from "../engine/networkConfig";
import { startPriceFeed } from "../engine/priceFeed";
import { evaluateStrategyForSymbol } from "../engine/botEngine";
import { evaluateSmcStrategyForSymbol } from "../engine/smcStrategy";
import { evaluateHTFMultiTrend } from "../engine/htfTrendFilter";
import type { PriceFeedDecision } from "../engine/priceFeed";
import type { BotConfig } from "../engine/botEngine";
import { TradingMode } from "../types";
import type {
  AISettings,
  ActivePosition,
  LogEntry,
  PortfolioState,
  SystemState,
  TestnetOrder,
  TestnetTrade,
} from "../types";
import {
  loadPnlHistory,
  mergePnlRecords,
  resetPnlHistoryMap,
} from "../lib/pnlHistory";
import type { AssetPnlMap } from "../lib/pnlHistory";

const SETTINGS_STORAGE_KEY = "ai-matic-settings";
const LOG_DEDUPE_WINDOW_MS = 1500;
const FEED_AGE_OK_MS = 60_000;
const MIN_POSITION_NOTIONAL_USD = 4;
const MAX_POSITION_NOTIONAL_USD = 7;
const MAX_OPEN_POSITIONS_CAP = 4;
const ORDERS_PER_POSITION = 5;
const MAX_OPEN_ORDERS_CAP = 20;
const TS_VERIFY_INTERVAL_MS = 180_000;
const TREND_GATE_STRONG_ADX = 25;
const TREND_GATE_STRONG_SCORE = 3;
const TREND_GATE_REVERSE_ADX = 19;
const TREND_GATE_REVERSE_SCORE = 1;
const CORRELATION_WAVE_WINDOW_MS = 60 * 60_000;
const CORRELATION_GROUPS: Symbol[][] = [
  ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
];
const HTF_TIMEFRAMES_MIN = [60, 240, 1440];
const AI_MATIC_HTF_TIMEFRAMES_MIN = [60, 15];
const AI_MATIC_LTF_TIMEFRAMES_MIN = [5, 1];
const SCALP_LTF_TIMEFRAMES_MIN = [1];

const DEFAULT_SETTINGS: AISettings = {
  riskMode: "ai-matic",
  trendGateMode: "adaptive",
  strictRiskAdherence: true,
  pauseOnHighVolatility: false,
  avoidLowLiquidity: false,
  useTrendFollowing: true,
  smcScalpMode: true,
  useLiquiditySweeps: false,
  strategyCheatSheetEnabled: false,
  enableHardGates: true,
  enableSoftGates: true,
  entryStrictness: "base",
  enforceSessionHours: true,
  haltOnDailyLoss: true,
  haltOnDrawdown: true,
  useDynamicPositionSizing: true,
  lockProfitsWithTrail: true,
  autoRefreshEnabled: false,
  baseRiskPerTrade: 0,
  maxAllocatedCapitalPercent: 1.0,
  maxPortfolioRiskPercent: 0.2,
  maxOpenPositions: 3,
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

function loadStoredSettings(): AISettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const merged = { ...DEFAULT_SETTINGS, ...parsed } as AISettings;
    if (
      merged.trendGateMode !== "adaptive" &&
      merged.trendGateMode !== "follow" &&
      merged.trendGateMode !== "reverse"
    ) {
      merged.trendGateMode = "adaptive";
    }
    if (typeof merged.autoRefreshEnabled !== "boolean") {
      merged.autoRefreshEnabled = DEFAULT_SETTINGS.autoRefreshEnabled;
    }
    if (!Number.isFinite(merged.maxOpenPositions)) {
      merged.maxOpenPositions = DEFAULT_SETTINGS.maxOpenPositions;
    } else {
      merged.maxOpenPositions = Math.min(
        MAX_OPEN_POSITIONS_CAP,
        Math.max(1, Math.round(merged.maxOpenPositions))
      );
    }
    return merged;
  } catch {
    return null;
  }
}

function persistSettings(settings: AISettings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toEpoch(value: unknown) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return n < 1e12 ? n * 1000 : n;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function toIso(ts: unknown) {
  const epoch = toEpoch(ts);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : "";
}

function formatNumber(value: number, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "";
}

function asErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "unknown_error");
}

function extractList(data: any) {
  return data?.result?.list ?? data?.list ?? [];
}

type EntryFallback = { triggerPrice?: number; price?: number; ts: number };

function buildEntryFallback(list: any[]) {
  const map = new Map<string, EntryFallback>();
  for (const o of list) {
    const symbol = String(o?.symbol ?? "");
    const side = String(o?.side ?? "");
    if (!symbol || !side) continue;
    const reduceOnly = Boolean(o?.reduceOnly ?? o?.reduce_only ?? o?.reduce);
    if (reduceOnly) continue;
    const triggerPrice = toNumber(o?.triggerPrice ?? o?.trigger_price);
    const price = toNumber(o?.price);
    if (!Number.isFinite(triggerPrice) && !Number.isFinite(price)) continue;
    const ts = toEpoch(
      o?.createdTime ?? o?.created_at ?? o?.updatedTime ?? o?.updated_at
    );
    const entry: EntryFallback = {
      triggerPrice: Number.isFinite(triggerPrice) ? triggerPrice : undefined,
      price: Number.isFinite(price) ? price : undefined,
      ts: Number.isFinite(ts) ? ts : 0,
    };
    const key = `${symbol}:${side}`;
    const prev = map.get(key);
    if (!prev || entry.ts >= prev.ts) {
      map.set(key, entry);
    }
  }
  return map;
}

type ClosedPnlRecord = { symbol: string; pnl: number; ts: number };
const WATCH_SYMBOLS: Symbol[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];
const FIXED_QTY_BY_SYMBOL: Record<Symbol, number> = {
  BTCUSDT: 0.005,
  ETHUSDT: 0.15,
  SOLUSDT: 3.5,
  ADAUSDT: 995,
};

const TRAIL_PROFILE_BY_RISK_MODE: Record<
  AISettings["riskMode"],
  { activateR: number; lockR: number; retracementRate?: number }
> = {
  "ai-matic": { activateR: 0.5, lockR: 0.3, retracementRate: 0.003 },
  "ai-matic-x": { activateR: 0.5, lockR: 0.3 },
  "ai-matic-scalp": { activateR: 0.6, lockR: 0.3 },
  "ai-matic-tree": { activateR: 0.5, lockR: 0.3 },
};
const TRAIL_SYMBOL_MODE: Partial<Record<Symbol, "on" | "off">> = {
  SOLUSDT: "on",
  ADAUSDT: "on",
  BTCUSDT: "on",
  ETHUSDT: "on",
};
const CHEAT_SHEET_SETUP_BY_RISK_MODE: Partial<
  Record<AISettings["riskMode"], string>
> = {
  "ai-matic": "ai-matic-core",
  "ai-matic-x": "ai-matic-x-smart-money-combo",
  "ai-matic-scalp": "ai-matic-scalp-scalpera",
  "ai-matic-tree": "ai-matic-decision-tree",
};


export function useTradingBot(
  mode?: TradingMode,
  useTestnet = false,
  authToken?: string
) {
  const [settings, setSettings] = useState<AISettings>(
    () => loadStoredSettings() ?? DEFAULT_SETTINGS
  );
  const apiBase = useMemo(() => getApiBase(Boolean(useTestnet)), [useTestnet]);
  const engineConfig = useMemo<Partial<BotConfig>>(() => {
    const cheatSheetSetupId = settings.strategyCheatSheetEnabled
      ? CHEAT_SHEET_SETUP_BY_RISK_MODE[settings.riskMode]
      : undefined;
    const baseConfig: Partial<BotConfig> = {
      useStrategyCheatSheet: settings.strategyCheatSheetEnabled,
      ...(cheatSheetSetupId ? { cheatSheetSetupId } : {}),
    };
    const strictness =
      settings.entryStrictness === "base"
        ? "ultra"
        : settings.entryStrictness;
    if (settings.riskMode === "ai-matic" || settings.riskMode === "ai-matic-tree") {
      return {
        ...baseConfig,
        baseTimeframe: "1h",
        signalTimeframe: "5m",
        aiMaticMultiTf: true,
        aiMaticHtfTimeframe: "1h",
        aiMaticMidTimeframe: "15m",
        aiMaticEntryTimeframe: "5m",
        aiMaticExecTimeframe: "1m",
        entryStrictness: strictness,
        partialSteps: [{ r: 1.0, exitFraction: 0.5 }],
        adxThreshold: 20,
        aggressiveAdxThreshold: 28,
        minAtrFractionOfPrice: 0.0004,
        atrEntryMultiplier: 1.6,
        entryStopMode: "swing",
        entrySwingBackoffAtr: 1.0,
        swingBackoffAtr: 0.6,
        liquiditySweepVolumeMult: 1.0,
        volExpansionAtrMult: 1.15,
        volExpansionVolMult: 1.1,
        cooldownBars: 0,
      };
    }
    if (settings.riskMode === "ai-matic-scalp") {
      const strictness =
        settings.entryStrictness === "base"
          ? "ultra"
          : settings.entryStrictness;
      return {
        ...baseConfig,
        strategyProfile: "scalp",
        baseTimeframe: "1h",
        signalTimeframe: "1m",
        entryStrictness: strictness,
      };
    }
    return baseConfig;
  }, [settings.entryStrictness, settings.riskMode, settings.strategyCheatSheetEnabled]);

  const [positions, setPositions] = useState<ActivePosition[] | null>(null);
  const [orders, setOrders] = useState<TestnetOrder[] | null>(null);
  const [trades, setTrades] = useState<TestnetTrade[] | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[] | null>(null);
  const [scanDiagnostics, setScanDiagnostics] = useState<
    Record<string, any> | null
  >(null);
  const [assetPnlHistory, setAssetPnlHistory] = useState<AssetPnlMap | null>(
    () => loadPnlHistory()
  );
  const [closedPnlRecords, setClosedPnlRecords] = useState<
    ClosedPnlRecord[] | null
  >(null);
  const [walletSnapshot, setWalletSnapshot] = useState<{
    totalEquity: number;
    availableBalance: number;
    totalWalletBalance: number;
  } | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [recentErrors, setRecentErrors] = useState<string[]>([]);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const fastPollRef = useRef(false);
  const slowPollRef = useRef(false);
  const orderSnapshotRef = useRef<
    Map<string, { status: string; qty: number; price: number | null; side: string; symbol: string }>
  >(new Map());
  const positionSnapshotRef = useRef<Map<string, { size: number; side: string }>>(
    new Map()
  );
  const execSeenRef = useRef<Set<string>>(new Set());
  const pnlSeenRef = useRef<Set<string>>(new Set());
  const fastOkRef = useRef(false);
  const slowOkRef = useRef(false);
  const modeRef = useRef<TradingMode | undefined>(mode);
  const positionsRef = useRef<ActivePosition[]>([]);
  const ordersRef = useRef<TestnetOrder[]>([]);
  const cancelingOrdersRef = useRef<Set<string>>(new Set());
  const decisionRef = useRef<
    Record<string, { decision: PriceFeedDecision; ts: number }>
  >({});
  const signalSeenRef = useRef<Set<string>>(new Set());
  const intentPendingRef = useRef<Set<string>>(new Set());
  const trailingSyncRef = useRef<Map<string, number>>(new Map());
  const correlationWaveRef = useRef<Map<string, number>>(new Map());
  const settingsRef = useRef<AISettings>(settings);
  const walletRef = useRef<typeof walletSnapshot | null>(walletSnapshot);
  const handleDecisionRef = useRef<
    ((symbol: string, decision: PriceFeedDecision) => void) | null
  >(null);
  const feedLogRef = useRef<{ env: string; ts: number } | null>(null);
  const logDedupeRef = useRef<Map<string, number>>(new Map());
  const gateOverridesRef = useRef<Record<string, boolean>>({});
  const feedLastTickRef = useRef(0);
  const lastHeartbeatRef = useRef(0);
  const lastStateRef = useRef<Map<string, string>>(new Map());
  const lastRestartRef = useRef(0);
  const [feedEpoch, setFeedEpoch] = useState(0);
  const symbolTickRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    walletRef.current = walletSnapshot;
  }, [walletSnapshot]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (positions) positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (orders) ordersRef.current = orders;
  }, [orders]);

  const fetchJson = useCallback(
    async (path: string, params?: Record<string, string>) => {
      if (!authToken) {
        throw new Error("missing_auth_token");
      }
      const qs = params ? `?${new URLSearchParams(params)}` : "";
      const url = `${apiBase}${path}${qs}`;
      const started = performance.now();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json().catch(() => ({}));
      const latency = Math.round(performance.now() - started);
      setLastLatencyMs(latency);
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `HTTP_${res.status}`);
      }
      return json?.data ?? json;
    },
    [apiBase, authToken]
  );

  const postJson = useCallback(
    async (path: string, body?: Record<string, unknown>) => {
      if (!authToken) {
        throw new Error("missing_auth_token");
      }
      const url = `${apiBase}${path}`;
      const started = performance.now();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      const latency = Math.round(performance.now() - started);
      setLastLatencyMs(latency);
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `HTTP_${res.status}`);
      }
      return json?.data ?? json;
    },
    [apiBase, authToken]
  );

  const addLogEntries = useCallback((entries: LogEntry[]) => {
    if (!entries.length) return;
    const dedupe = logDedupeRef.current;
    const now = Date.now();
    const filtered: LogEntry[] = [];
    for (const entry of entries) {
      const key = `${entry.action}:${entry.message}`;
      const last = dedupe.get(key);
      if (last && now - last < LOG_DEDUPE_WINDOW_MS) continue;
      dedupe.set(key, now);
      filtered.push(entry);
    }
    if (dedupe.size > 1000) {
      for (const [key, ts] of dedupe.entries()) {
        if (now - ts > 60_000) dedupe.delete(key);
      }
    }
    if (!filtered.length) return;
    setLogEntries((prev) => {
      const list = prev ? [...prev] : [];
      const map = new Map(list.map((entry) => [entry.id, entry]));
      for (const entry of filtered) {
        map.set(entry.id, entry);
      }
      const merged = Array.from(map.values()).sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      return merged.slice(0, 200);
    });
  }, []);


  const isGateEnabled = useCallback((name: string) => {
    const value = gateOverridesRef.current?.[name];
    return typeof value === "boolean" ? value : true;
  }, []);

  const getEquityValue = useCallback(() => {
    const wallet = walletRef.current;
    const totalEquity = toNumber(wallet?.totalEquity);
    if (Number.isFinite(totalEquity) && totalEquity > 0) return totalEquity;
    const totalWalletBalance = toNumber(wallet?.totalWalletBalance);
    if (Number.isFinite(totalWalletBalance) && totalWalletBalance > 0) {
      return totalWalletBalance;
    }
    const availableBalance = toNumber(wallet?.availableBalance);
    if (Number.isFinite(availableBalance) && availableBalance > 0) {
      return availableBalance;
    }
    return Number.NaN;
  }, []);

  const isSessionAllowed = useCallback((now: Date, next: AISettings) => {
    if (!next.enforceSessionHours) return true;
    const useUtc =
      next.riskMode === "ai-matic-scalp";
    const day = useUtc ? now.getUTCDay() : now.getDay();
    if (Array.isArray(next.tradingDays) && next.tradingDays.length > 0) {
      if (!next.tradingDays.includes(day)) return false;
    }
    if (next.riskMode === "ai-matic-scalp") {
      const hour = now.getUTCHours();
      const inMorning = hour >= 8 && hour < 12;
      const inAfternoon = hour >= 13 && hour < 17;
      return inMorning || inAfternoon;
    }
    const start = Number(next.tradingStartHour);
    const end = Number(next.tradingEndHour);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return true;
    if (start === end) return true;
    const hour = now.getHours();
    if (start < end) return hour >= start && hour <= end;
    return hour >= start || hour <= end;
  }, []);

  const computeNotionalForSignal = useCallback(
    (entry: number, sl: number) => {
      const settings = settingsRef.current;
      const equity = getEquityValue();
      if (!Number.isFinite(equity) || equity <= 0) {
        return { ok: false, reason: "missing_equity" as const };
      }

      const baseRiskRaw = toNumber(settings.baseRiskPerTrade);
      if (!Number.isFinite(baseRiskRaw) || baseRiskRaw <= 0) {
        return { ok: false, reason: "invalid_risk" as const };
      }

      let riskUsd =
        baseRiskRaw <= 1 ? equity * baseRiskRaw : baseRiskRaw;
      const maxRiskPct = toNumber(settings.maxPortfolioRiskPercent);
      if (
        Number.isFinite(maxRiskPct) &&
        maxRiskPct > 0 &&
        maxRiskPct <= 1
      ) {
        riskUsd = Math.min(riskUsd, equity * maxRiskPct);
      }
      const sizingMultiplier = toNumber(settings.positionSizingMultiplier);
      if (Number.isFinite(sizingMultiplier) && sizingMultiplier > 0) {
        riskUsd *= sizingMultiplier;
      }

      const riskPerUnit = Math.abs(entry - sl);
      if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
        return { ok: false, reason: "invalid_sl_distance" as const };
      }

      let qty = riskUsd / riskPerUnit;
      if (!Number.isFinite(qty) || qty <= 0) {
        return { ok: false, reason: "invalid_qty" as const };
      }

      let notional = qty * entry;
      if (Number.isFinite(notional) && notional > 0) {
        notional = Math.min(
          Math.max(notional, MIN_POSITION_NOTIONAL_USD),
          MAX_POSITION_NOTIONAL_USD
        );
        qty = notional / entry;
      }
      const maxAllocPct = toNumber(settings.maxAllocatedCapitalPercent);
      if (
        Number.isFinite(maxAllocPct) &&
        maxAllocPct > 0 &&
        maxAllocPct <= 1 &&
        Number.isFinite(entry) &&
        entry > 0
      ) {
        const maxNotional = equity * maxAllocPct;
        if (Number.isFinite(maxNotional) && maxNotional > 0) {
          if (maxNotional < MIN_POSITION_NOTIONAL_USD) {
            return { ok: false, reason: "insufficient_equity" as const };
          }
          if (notional > maxNotional) {
            notional = maxNotional;
            qty = notional / entry;
          }
          if (notional < MIN_POSITION_NOTIONAL_USD) {
            return { ok: false, reason: "insufficient_equity" as const };
          }
        }
      }

      return { ok: true as const, notional, qty, riskUsd, equity };
    },
    [getEquityValue]
  );

  const computeFixedSizing = useCallback(
    (symbol: Symbol, entry: number, sl: number) => {
      const fixedQty = FIXED_QTY_BY_SYMBOL[symbol];
      if (fixedQty == null) return null;
      if (!Number.isFinite(fixedQty) || fixedQty <= 0) {
        return { ok: false as const, reason: "invalid_fixed_qty" as const };
      }
      if (!Number.isFinite(entry) || entry <= 0) {
        return { ok: false as const, reason: "invalid_entry" as const };
      }
      const notional = fixedQty * entry;
      if (!Number.isFinite(notional) || notional <= 0) {
        return { ok: false as const, reason: "invalid_fixed_notional" as const };
      }
      const riskPerUnit = Math.abs(entry - sl);
      const riskUsd =
        Number.isFinite(riskPerUnit) && riskPerUnit > 0
          ? riskPerUnit * fixedQty
          : Number.NaN;
      const equity = getEquityValue();
      return { ok: true as const, notional, qty: fixedQty, riskUsd, equity };
    },
    [getEquityValue]
  );


  const computeTrailingPlan = useCallback(
    (entry: number, sl: number, side: "Buy" | "Sell", symbol: Symbol) => {
      const settings = settingsRef.current;
      const symbolMode = TRAIL_SYMBOL_MODE[symbol];
      const forceTrail =
        settings.riskMode === "ai-matic" ||
        settings.riskMode === "ai-matic-x" ||
        settings.riskMode === "ai-matic-tree";
      if (symbolMode === "off") return null;
      if (!forceTrail && !settings.lockProfitsWithTrail && symbolMode !== "on") {
        return null;
      }
      const r = Math.abs(entry - sl);
      if (!Number.isFinite(r) || r <= 0) return null;
      const profile =
        TRAIL_PROFILE_BY_RISK_MODE[settings.riskMode] ??
        TRAIL_PROFILE_BY_RISK_MODE["ai-matic"];
      const activateR = profile.activateR;
      const lockR = profile.lockR;
      const retracementRate = profile.retracementRate;
      const distance = Number.isFinite(retracementRate)
        ? entry * (retracementRate as number)
        : Math.abs(activateR - lockR) * r;
      if (!Number.isFinite(distance) || distance <= 0) return null;
      const dir = side === "Buy" ? 1 : -1;
      const activePrice = entry + dir * activateR * r;
      if (!Number.isFinite(activePrice) || activePrice <= 0) return null;
      return { trailingStop: distance, trailingActivePrice: activePrice };
    },
    []
  );

  const syncTrailingProtection = useCallback(
    async (positions: ActivePosition[]) => {
      const now = Date.now();
      const seenSymbols = new Set(
        positions.map((p) => String(p.symbol ?? "")).filter(Boolean)
      );
      for (const symbol of trailingSyncRef.current.keys()) {
        if (!seenSymbols.has(symbol)) {
          trailingSyncRef.current.delete(symbol);
        }
      }

      for (const pos of positions) {
        const symbol = String(pos.symbol ?? "");
        if (!symbol) continue;
        const currentTrail = toNumber(pos.currentTrailingStop);
        if (Number.isFinite(currentTrail) && currentTrail > 0) {
          trailingSyncRef.current.delete(symbol);
          continue;
        }
        const entry = toNumber(pos.entryPrice);
        const sl = toNumber(pos.sl);
        if (
          !Number.isFinite(entry) ||
          !Number.isFinite(sl) ||
          entry <= 0 ||
          sl <= 0
        ) {
          continue;
        }
        const side = pos.side === "Sell" ? "Sell" : "Buy";
        const plan = computeTrailingPlan(
          entry,
          sl,
          side,
          symbol as Symbol
        );
        if (!plan) continue;

        const lastAttempt = trailingSyncRef.current.get(symbol);
        if (lastAttempt && now - lastAttempt < TS_VERIFY_INTERVAL_MS) {
          continue;
        }
        trailingSyncRef.current.set(symbol, now);

        try {
          await postJson("/protection", {
            symbol,
            trailingStop: plan.trailingStop,
            trailingActivePrice: plan.trailingActivePrice,
            positionIdx: 0,
          });
          addLogEntries([
            {
              id: `trail:set:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} TS nastaven | aktivace ${formatNumber(
                plan.trailingActivePrice ?? Number.NaN,
                6
              )} | distance ${formatNumber(
                plan.trailingStop ?? Number.NaN,
                6
              )}`,
            },
          ]);
        } catch (err) {
          addLogEntries([
            {
              id: `trail:error:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
              message: `${symbol} TS update failed: ${asErrorMessage(err)}`,
            },
          ]);
        }
      }
    },
    [addLogEntries, computeTrailingPlan, postJson]
  );

  const getSymbolContext = useCallback(
    (symbol: string, decision?: PriceFeedDecision | null) => {
      const settings = settingsRef.current;
      const now = new Date();
      const sessionOk = isSessionAllowed(now, settings);
      const maxPositions = toNumber(settings.maxOpenPositions);
      const openPositionsCount = positionsRef.current.length;
      const maxPositionsOk =
        !Number.isFinite(maxPositions) ||
        maxPositions <= 0 ||
        openPositionsCount < maxPositions;
      const hasPosition = positionsRef.current.some((p) => {
        if (p.symbol !== symbol) return false;
        const size = toNumber(p.size ?? p.qty);
        return Number.isFinite(size) && size > 0;
      });
      const openOrdersCount = ordersRef.current.length;
      const maxOrders =
        Number.isFinite(maxPositions) && maxPositions > 0
          ? Math.min(maxPositions * ORDERS_PER_POSITION, MAX_OPEN_ORDERS_CAP)
          : MAX_OPEN_ORDERS_CAP;
      const ordersClearOk =
        !Number.isFinite(maxOrders) || openOrdersCount < maxOrders;
      const engineOk = !(decision?.halted ?? false);
      return {
        settings,
        now,
        sessionOk,
        maxPositionsOk,
        maxPositions,
        maxOrders,
        openPositionsCount,
        hasPosition,
        openOrdersCount,
        ordersClearOk,
        engineOk,
      };
    },
    [isSessionAllowed]
  );

  const resolveTrendGate = useCallback(
    (
      decision: PriceFeedDecision | null | undefined,
      signal?: PriceFeedDecision["signal"] | null
    ) => {
      const settings = settingsRef.current;
      const htfTrend = (decision as any)?.htfTrend;
      const ltfTrend = (decision as any)?.ltfTrend;
      const htfConsensusRaw =
        typeof htfTrend?.consensus === "string" ? htfTrend.consensus : "";
      const htfConsensus =
        htfConsensusRaw === "bull" || htfConsensusRaw === "bear"
          ? htfConsensusRaw
          : "";
      const ltfConsensus =
        typeof ltfTrend?.consensus === "string" ? ltfTrend.consensus : "";
      const normalizeTrend = (value: string) => {
        const upper = value.trim().toUpperCase();
        if (!upper || upper === "—") return "—";
        if (upper.startsWith("BULL") || upper === "UP") return "BULL";
        if (upper.startsWith("BEAR") || upper === "DOWN") return "BEAR";
        if (upper.startsWith("RANGE") || upper === "NONE" || upper === "NEUTRAL") {
          return "RANGE";
        }
        return upper;
      };
      const trendRaw =
        htfConsensus ||
        String((decision as any)?.trendH1 ?? decision?.trend ?? "");
      const htfDir = normalizeTrend(trendRaw);
      let ltfDir = normalizeTrend(ltfConsensus);
      const adx = toNumber((decision as any)?.trendAdx);
      const htfScore = toNumber(htfTrend?.score);
      const score = Number.isFinite(htfScore)
        ? htfScore
        : toNumber((decision as any)?.trendScore);
      const alignedCount = toNumber(htfTrend?.alignedCount);
      const htfStrong = Number.isFinite(alignedCount) && alignedCount >= 2;
      const strong =
        (Number.isFinite(adx) && adx >= TREND_GATE_STRONG_ADX) ||
        (Number.isFinite(score) && score >= TREND_GATE_STRONG_SCORE) ||
        htfStrong;
      const modeSetting = settings.trendGateMode ?? "adaptive";
      const reverseAllowed =
        (Number.isFinite(adx) ? adx <= TREND_GATE_REVERSE_ADX : false) &&
        (Number.isFinite(score) ? score <= TREND_GATE_REVERSE_SCORE : false) &&
        !htfStrong;
      let mode: "FOLLOW" | "REVERSE" = "FOLLOW";
      if (modeSetting === "adaptive") {
        mode = reverseAllowed && !strong ? "REVERSE" : "FOLLOW";
      } else if (modeSetting === "reverse") {
        mode = reverseAllowed ? "REVERSE" : "FOLLOW";
      } else {
        mode = "FOLLOW";
      }
      if (ltfDir === "RANGE" && Array.isArray(ltfTrend?.byTimeframe)) {
        const dirs = ltfTrend.byTimeframe.map((entry: any) =>
          String(entry?.result?.direction ?? "none").toLowerCase()
        );
        const hasBull = dirs.includes("bull");
        const hasBear = dirs.includes("bear");
        if (hasBull && hasBear) ltfDir = "MIXED";
      }
      const ltfActive = ltfDir === "BULL" || ltfDir === "BEAR";
      const ltfConflicted = ltfDir === "MIXED";
      const ltfMatchesTrend =
        (!ltfActive && !ltfConflicted) || ltfDir === htfDir;
      const ltfMatchesSignal = (signalDir: "BULL" | "BEAR") =>
        (!ltfActive && !ltfConflicted) || ltfDir === signalDir;
      const detailParts = [`HTF ${htfDir}`];
      if (ltfConsensus) {
        detailParts.push(`LTF ${ltfDir}`);
      }
      if (htfConsensus) {
        const total = Array.isArray(htfTrend?.byTimeframe)
          ? htfTrend.byTimeframe.length
          : 0;
        const countLabel =
          Number.isFinite(alignedCount) && total > 0
            ? ` (${alignedCount}/${total})`
            : "";
        detailParts.push(`Consensus ${htfConsensus.toUpperCase()}${countLabel}`);
      }
      if (Number.isFinite(adx)) {
        detailParts.push(`ADX ${formatNumber(adx, 1)}`);
      }
      if (Number.isFinite(score)) {
        detailParts.push(`score ${formatNumber(score, 0)}`);
      }
      if (Array.isArray(htfTrend?.byTimeframe)) {
        const tfLabel = (tf: number) => {
          if (tf >= 1440) return `${Math.round(tf / 1440)}D`;
          if (tf >= 60) return `${Math.round(tf / 60)}H`;
          return `${tf}m`;
        };
        const tfParts = htfTrend.byTimeframe.map((entry: any) => {
          const dir = String(entry?.result?.direction ?? "none").toUpperCase();
          return `${tfLabel(Number(entry?.timeframeMin ?? 0))} ${dir}`;
        });
        if (tfParts.length) detailParts.push(`HTF ${tfParts.join(" · ")}`);
      }
      if (Array.isArray(ltfTrend?.byTimeframe)) {
        const tfLabel = (tf: number) => {
          if (tf >= 1440) return `${Math.round(tf / 1440)}D`;
          if (tf >= 60) return `${Math.round(tf / 60)}H`;
          return `${tf}m`;
        };
        const tfParts = ltfTrend.byTimeframe.map((entry: any) => {
          const dir = String(entry?.result?.direction ?? "none").toUpperCase();
          return `${tfLabel(Number(entry?.timeframeMin ?? 0))} ${dir}`;
        });
        if (tfParts.length) detailParts.push(`LTF ${tfParts.join(" · ")}`);
      }
      detailParts.push(
        `mode ${mode}${modeSetting === "adaptive" ? " (adaptive)" : ""}`
      );
      const detail = detailParts.join(" | ");

      if (!signal) {
        return { ok: true, detail };
      }

      const sideRaw = String(signal.intent?.side ?? "").toLowerCase();
      const signalDir = sideRaw === "buy" ? "BULL" : "BEAR";
      const kind = signal.kind ?? "OTHER";
      const isMeanRev = kind === "MEAN_REVERSION";
      let ok = true;
      if (htfDir === "BULL") {
        ok = mode === "FOLLOW"
          ? signalDir === "BULL" && ltfMatchesTrend
          : isMeanRev && signalDir === "BEAR" && ltfMatchesSignal(signalDir);
      } else if (htfDir === "BEAR") {
        ok = mode === "FOLLOW"
          ? signalDir === "BEAR" && ltfMatchesTrend
          : isMeanRev && signalDir === "BULL" && ltfMatchesSignal(signalDir);
      } else {
        ok = mode === "FOLLOW" ? false : isMeanRev && ltfMatchesSignal(signalDir);
      }
      return { ok, detail };
    },
    []
  );

  const resolveCorrelationGate = useCallback(
    (symbol: string, now = Date.now()) => {
      const group =
        CORRELATION_GROUPS.find((g) => g.includes(symbol as Symbol)) ?? [];
      const peers = group.filter((s) => s !== symbol);
      if (!peers.length) {
        return { ok: true, detail: "no correlated peers" };
      }
      const openSymbols = new Set<string>();
      positionsRef.current.forEach((p) => {
        if (p.symbol) openSymbols.add(String(p.symbol));
      });
      ordersRef.current.forEach((o) => {
        if (o.symbol) openSymbols.add(String(o.symbol));
      });
      const activePeers = peers.filter((p) => openSymbols.has(p));
      if (activePeers.length) {
        return { ok: false, detail: `open ${activePeers.join(", ")}` };
      }
      const recentPeers = peers.filter((p) => {
        const ts = correlationWaveRef.current.get(p) ?? 0;
        return ts > 0 && now - ts <= CORRELATION_WAVE_WINDOW_MS;
      });
      if (recentPeers.length) {
        return { ok: false, detail: `recent wave ${recentPeers.join(", ")}` };
      }
      return { ok: true, detail: "clear" };
    },
    []
  );

  const resolveQualityScore = useCallback(
    (
      decision: PriceFeedDecision | null | undefined,
      signalActive: boolean
    ) => {
      const adx = toNumber((decision as any)?.trendAdx);
      const trendScore = toNumber((decision as any)?.trendScore);
      const htfTrend = (decision as any)?.htfTrend;
      const alignedCount = toNumber(htfTrend?.alignedCount);
      const tfCount = Array.isArray(htfTrend?.byTimeframe)
        ? htfTrend.byTimeframe.length
        : 0;

      const hasTrendScore = Number.isFinite(trendScore);
      const hasAdx = Number.isFinite(adx);
      const hasHtf = tfCount > 0 && Number.isFinite(alignedCount);

      const trendPoints = hasTrendScore
        ? Math.min(4, Math.max(0, trendScore))
        : 0;
      const adxPoints = hasAdx
        ? adx >= 30
          ? 3
          : adx >= 20
            ? 2
            : adx >= 15
              ? 1
              : 0
        : 0;
      const htfPoints = hasHtf ? Math.min(alignedCount, tfCount) : 0;
      const maxPoints =
        (hasTrendScore ? 4 : 0) + (hasAdx ? 3 : 0) + (hasHtf ? tfCount : 0);

      if (!maxPoints) {
        return { score: null, threshold: null, pass: undefined };
      }

      const normalized = ((trendPoints + adxPoints + htfPoints) / maxPoints) * 10;
      const score = Math.round(normalized * 10) / 10;
      const threshold = 6;
      const pass = score >= threshold;
      return { score, threshold, pass };
    },
    []
  );

  const resolveSymbolState = useCallback((symbol: string) => {
    const decision = decisionRef.current[symbol]?.decision;
    const state = String(decision?.state ?? "").toUpperCase();
    if (state === "MANAGE") return "MANAGE";
    if (state === "SCAN") return "SCAN";

    const hasPosition = positionsRef.current.some((p) => {
      if (p.symbol !== symbol) return false;
      const size = toNumber(p.size ?? p.qty);
      return Number.isFinite(size) && size > 0;
    });
    if (hasPosition) return "MANAGE";
    const hasOrders = ordersRef.current.some(
      (o) => String(o.symbol ?? "") === symbol
    );
    if (hasOrders) return "MANAGE";
    return "SCAN";
  }, []);

  const buildScanDiagnostics = useCallback(
    (symbol: string, decision: PriceFeedDecision, lastScanTs: number) => {
      const context = getSymbolContext(symbol, decision);
      const lastTick = symbolTickRef.current.get(symbol) ?? 0;
      const feedAgeMs =
        lastTick > 0 ? Math.max(0, Date.now() - lastTick) : null;
      const feedAgeOk =
        feedAgeMs == null ? null : feedAgeMs <= FEED_AGE_OK_MS;
      const signalActive = Boolean(decision?.signal);
      const quality = resolveQualityScore(decision, signalActive);
      const pos = positionsRef.current.find((p) => p.symbol === symbol);
      const sl = toNumber(pos?.sl);
      const tp = toNumber(pos?.tp);

      const gates: { name: string; ok: boolean; detail?: string }[] = [];
      const addGate = (name: string, ok: boolean, detail?: string) => {
        gates.push({ name, ok, detail: ok ? detail : undefined });
      };

      const signalDetail = (() => {
        const sig = decision?.signal;
        if (!sig) return undefined;
        const side = String(sig.intent?.side ?? "").toUpperCase();
        const entry = toNumber(sig.intent?.entry);
        const parts: string[] = [];
        if (side) parts.push(side);
        if (Number.isFinite(entry)) {
          parts.push(`@ ${formatNumber(entry, 2)}`);
        }
        if (sig.kind) {
          parts.push(String(sig.kind).toUpperCase());
        }
        return parts.join(" ") || "signal active";
      })();
      const trendGate = resolveTrendGate(
        decision,
        signalActive ? decision?.signal ?? null : null
      );
      addGate("Signal", signalActive, signalDetail);
      addGate("Trend bias", trendGate.ok, trendGate.detail);
      addGate("Engine ok", context.engineOk, "running");
      const sessionDetail = context.settings.enforceSessionHours
        ? context.settings.riskMode === "ai-matic-scalp"
          ? "08:00-12:00 / 13:00-17:00 UTC"
          : `${String(context.settings.tradingStartHour).padStart(2, "0")}:00-${String(
              context.settings.tradingEndHour
            ).padStart(2, "0")}:00`
        : "24/7";
      addGate("Session ok", context.sessionOk, sessionDetail);
      addGate(
        "Confirm required",
        !context.settings.requireConfirmationInAuto,
        "not required"
      );
      const maxPositionsDetail = Number.isFinite(context.maxPositions)
        ? `open ${context.openPositionsCount}/${context.maxPositions}`
        : `open ${context.openPositionsCount}`;
      addGate("Max positions", context.maxPositionsOk, maxPositionsDetail);
      addGate("Position clear", !context.hasPosition, "no open position");
      const ordersDetail = Number.isFinite(context.maxOrders)
        ? `open ${context.openOrdersCount}/${context.maxOrders}`
        : `open ${context.openOrdersCount}/no limit`;
      addGate("Orders clear", context.ordersClearOk, ordersDetail);
      const correlationGate = resolveCorrelationGate(symbol, Date.now());
      addGate("Correlation", correlationGate.ok, correlationGate.detail);
      const slOk =
        context.hasPosition && Number.isFinite(sl) && sl > 0;
      const tpOk =
        context.hasPosition && Number.isFinite(tp) && tp > 0;
      addGate(
        "SL set",
        slOk,
        slOk ? `SL ${formatNumber(sl, 6)}` : undefined
      );
      addGate(
        "TP set",
        tpOk,
        tpOk ? `TP ${formatNumber(tp, 6)}` : undefined
      );

      const hardEnabled = context.settings.enableHardGates !== false;
      const softEnabled = context.settings.enableSoftGates !== false;
      const hardReasons: string[] = [];
      if (hardEnabled) {
        if (!context.engineOk && isGateEnabled("Engine ok")) {
          hardReasons.push("Engine ok");
        }
        if (!trendGate.ok && isGateEnabled("Trend bias")) {
          hardReasons.push("Trend bias");
        }
        if (!context.sessionOk && isGateEnabled("Session ok")) {
          hardReasons.push("Session ok");
        }
        if (!context.maxPositionsOk && isGateEnabled("Max positions")) {
          hardReasons.push("Max positions");
        }
        if (context.hasPosition && isGateEnabled("Position clear")) {
          hardReasons.push("Position clear");
        }
        if (!context.ordersClearOk && isGateEnabled("Orders clear")) {
          hardReasons.push("Orders clear");
        }
        if (feedAgeOk === false && isGateEnabled("Feed age")) {
          hardReasons.push("Feed age");
        }
        if (!correlationGate.ok && isGateEnabled("Correlation")) {
          hardReasons.push("Correlation");
        }
        if (
          context.settings.requireConfirmationInAuto &&
          isGateEnabled("Confirm required")
        ) {
          hardReasons.push("Confirm required");
        }
      }

      const hardBlocked = hardEnabled && hardReasons.length > 0;
      const execEnabled = isGateEnabled("Exec allowed");
      const executionAllowed = signalActive
        ? execEnabled
          ? hardReasons.length === 0
          : false
        : null;

      return {
        signalActive,
        hardEnabled,
        softEnabled,
        hardBlocked,
        hardBlock: hardBlocked ? hardReasons.join(" · ") : undefined,
        executionAllowed,
        executionReason: signalActive
          ? execEnabled
            ? hardReasons.length > 0
              ? hardReasons.join(" · ")
              : undefined
            : "Exec allowed (OFF)"
          : execEnabled
            ? "Waiting for signal"
            : "Exec allowed (OFF)",
        gates,
        qualityScore: quality.score,
        qualityThreshold: quality.threshold,
        qualityPass: quality.pass,
        lastScanTs,
        feedAgeMs,
        feedAgeOk,
      };
    },
    [
      getSymbolContext,
      isGateEnabled,
      resolveCorrelationGate,
      resolveQualityScore,
      resolveTrendGate,
    ]
  );

  const refreshDiagnosticsFromDecisions = useCallback(() => {
    const entries = Object.entries(decisionRef.current);
    if (!entries.length) return;
    setScanDiagnostics((prev) => {
      const next = { ...(prev ?? {}) };
      for (const [symbol, data] of entries) {
        next[symbol] = buildScanDiagnostics(
          symbol,
          data.decision,
          data.ts
        );
      }
      return next;
    });
  }, [buildScanDiagnostics]);

  const updateGateOverrides = useCallback(
    (overrides: Record<string, boolean>) => {
      gateOverridesRef.current = { ...overrides };
      refreshDiagnosticsFromDecisions();
    },
    [refreshDiagnosticsFromDecisions]
  );

  const refreshFast = useCallback(async () => {
    if (fastPollRef.current) return;
    fastPollRef.current = true;

    const now = Date.now();
    const results = await Promise.allSettled([
      fetchJson("/positions"),
      fetchJson("/orders", { limit: "50" }),
      fetchJson("/executions", { limit: "50" }),
    ]);

    let sawError = false;
    const newLogs: LogEntry[] = [];
    const [positionsRes, ordersRes, executionsRes] = results;
    const entryFallbackByKey =
      ordersRes.status === "fulfilled"
        ? buildEntryFallback(extractList(ordersRes.value))
        : new Map<string, EntryFallback>();

    if (positionsRes.status === "fulfilled") {
      const list = extractList(positionsRes.value);
      const prevPositions = positionSnapshotRef.current;
      const nextPositions = new Map<string, { size: number; side: string }>();
      const next = list
        .map((p: any) => {
          const size = toNumber(p?.size ?? p?.qty);
          if (!Number.isFinite(size) || size <= 0) return null;
          const sideRaw = String(p?.side ?? "");
          const side =
            sideRaw.toLowerCase() === "buy" ? "Buy" : "Sell";
          const symbol = String(p?.symbol ?? "");
          const entryPrice = toNumber(
            p?.entryPrice ?? p?.avgEntryPrice ?? p?.avgPrice
          );
          const unrealized = toNumber(
            p?.unrealisedPnl ?? p?.unrealizedPnl
          );
          const openEpoch = toEpoch(p?.openTime);
          const updatedEpoch = toEpoch(p?.updatedTime ?? p?.updated_at);
          const openedAt = Number.isFinite(openEpoch)
            ? new Date(openEpoch).toISOString()
            : "";
          const updatedAt = Number.isFinite(updatedEpoch)
            ? new Date(updatedEpoch).toISOString()
            : "";
          const triggerFromPos = toNumber(
            p?.triggerPrice ?? p?.trigger_price
          );
          const sl = toNumber(p?.stopLoss ?? p?.sl);
          const tp = toNumber(p?.takeProfit ?? p?.tp);
          const trailingStop = toNumber(
            p?.trailingStop ??
              p?.trailingStopDistance ??
              p?.trailingStopPrice ??
              p?.trailPrice
          );
          const fallback =
            entryFallbackByKey.get(`${symbol}:${side}`) ?? null;
          const triggerPrice = Number.isFinite(triggerFromPos)
            ? triggerFromPos
            : fallback?.triggerPrice;
          const resolvedEntry = Number.isFinite(entryPrice)
            ? entryPrice
            : Number.isFinite(triggerPrice)
              ? triggerPrice
              : Number.isFinite(fallback?.price)
                ? (fallback?.price as number)
                : Number.NaN;
          const rrr =
            Number.isFinite(resolvedEntry) &&
            Number.isFinite(sl) &&
            Number.isFinite(tp) &&
            resolvedEntry !== sl
              ? Math.abs(tp - resolvedEntry) /
                Math.abs(resolvedEntry - sl)
              : Number.NaN;
          nextPositions.set(symbol, { size, side });
          return {
            positionId: String(p?.positionId ?? `${p?.symbol}-${sideRaw}`),
            id: String(p?.positionId ?? ""),
            symbol,
            side,
            qty: size,
            size,
            entryPrice: Number.isFinite(resolvedEntry)
              ? resolvedEntry
              : Number.NaN,
            triggerPrice: Number.isFinite(triggerPrice)
              ? triggerPrice
              : undefined,
            sl: Number.isFinite(sl) ? sl : undefined,
            tp: Number.isFinite(tp) ? tp : undefined,
            currentTrailingStop:
              Number.isFinite(trailingStop) && trailingStop > 0
                ? trailingStop
                : undefined,
            unrealizedPnl: Number.isFinite(unrealized)
              ? unrealized
              : Number.NaN,
            openedAt: openedAt || "",
            rrr: Number.isFinite(rrr) ? rrr : undefined,
            lastUpdateReason: String(p?.lastUpdateReason ?? "") || undefined,
            timestamp: updatedAt || openedAt || "",
            env: useTestnet ? "testnet" : "mainnet",
          } satisfies ActivePosition;
        })
        .filter((p: ActivePosition | null): p is ActivePosition => Boolean(p));
      setPositions(next);
      positionsRef.current = next;
      setLastSuccessAt(now);
      void syncTrailingProtection(next);

      for (const [symbol, nextPos] of nextPositions.entries()) {
        const prev = prevPositions.get(symbol);
        if (!prev) {
          newLogs.push({
            id: `pos-open:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `POSITION OPEN ${symbol} ${nextPos.side} size ${formatNumber(
              nextPos.size,
              4
            )}`,
          });
          continue;
        }
        if (Number.isFinite(prev.size) && prev.size !== nextPos.size) {
          newLogs.push({
            id: `pos-size:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `POSITION SIZE ${symbol} ${formatNumber(
              prev.size,
              4
            )} → ${formatNumber(nextPos.size, 4)}`,
          });
        }
      }
      for (const [symbol, prevPos] of prevPositions.entries()) {
        if (!nextPositions.has(symbol)) {
          newLogs.push({
            id: `pos-close:${symbol}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `POSITION CLOSED ${symbol} ${prevPos.side} size ${formatNumber(
              prevPos.size,
              4
            )}`,
          });
        }
      }
      positionSnapshotRef.current = nextPositions;
    }

    if (ordersRes.status === "fulfilled") {
      const list = extractList(ordersRes.value);
      const prevOrders = orderSnapshotRef.current;
      const nextOrders = new Map<
        string,
        {
          status: string;
          qty: number;
          price: number | null;
          side: string;
          symbol: string;
        }
      >();
      const mapped = list
        .map((o: any) => {
          const qty = toNumber(o?.qty ?? o?.orderQty ?? o?.leavesQty);
          const price = toNumber(o?.price);
          const triggerPrice = toNumber(o?.triggerPrice ?? o?.trigger_price);
          const orderId = String(o?.orderId ?? o?.orderID ?? o?.id ?? "");
          const orderLinkId = String(
            o?.orderLinkId ?? o?.order_link_id ?? o?.orderLinkID ?? ""
          );
          const symbol = String(o?.symbol ?? "");
          const side = String(o?.side ?? "Buy");
          const status = String(o?.orderStatus ?? o?.order_status ?? o?.status ?? "");
          const orderType = String(o?.orderType ?? o?.order_type ?? "");
          const stopOrderType = String(o?.stopOrderType ?? o?.stop_order_type ?? "");
          const orderFilter = String(o?.orderFilter ?? o?.order_filter ?? "");
          const reduceOnly = Boolean(o?.reduceOnly ?? o?.reduce_only ?? o?.reduce);
          const entry = {
            orderId,
            orderLinkId: orderLinkId || undefined,
            symbol,
            side: side as "Buy" | "Sell",
            qty: Number.isFinite(qty) ? qty : Number.NaN,
            price: Number.isFinite(price) ? price : null,
            triggerPrice: Number.isFinite(triggerPrice) ? triggerPrice : null,
            orderType: orderType || undefined,
            stopOrderType: stopOrderType || undefined,
            orderFilter: orderFilter || undefined,
            reduceOnly,
            status,
            createdTime: toIso(o?.createdTime ?? o?.created_at) || "",
          } as TestnetOrder;
          if (orderId || orderLinkId) {
            nextOrders.set(orderId || orderLinkId, {
              status,
              qty: Number.isFinite(qty) ? qty : Number.NaN,
              price: Number.isFinite(price) ? price : null,
              side,
              symbol,
            });
          }
          return entry;
        })
        .filter((o: TestnetOrder) => Boolean(o.orderId || o.orderLinkId));
      const isProtectionOrder = (order: TestnetOrder) => {
        const stopType = String(order.stopOrderType ?? "").toLowerCase();
        const filter = String(order.orderFilter ?? "").toLowerCase();
        return (
          order.reduceOnly ||
          filter === "tpsl" ||
          stopType === "takeprofit" ||
          stopType === "stoploss" ||
          stopType === "trailingstop"
        );
      };
      const isNewEntryOrder = (order: TestnetOrder) => {
        if (isProtectionOrder(order)) return false;
        const status = String(order.status ?? "").toLowerCase();
        return status === "new" || status === "created";
      };
      const latestNewBySymbol = new Map<
        string,
        { order: TestnetOrder; ts: number }
      >();
      for (const order of mapped) {
        if (!isNewEntryOrder(order)) continue;
        const ts = toEpoch(order.createdTime);
        const resolvedTs = Number.isFinite(ts) ? ts : 0;
        const prev = latestNewBySymbol.get(order.symbol);
        if (!prev || resolvedTs >= prev.ts) {
          latestNewBySymbol.set(order.symbol, {
            order,
            ts: resolvedTs,
          });
        }
      }
      const latestNewIds = new Map<
        string,
        { orderId: string; orderLinkId?: string }
      >();
      for (const [symbol, data] of latestNewBySymbol.entries()) {
        latestNewIds.set(symbol, {
          orderId: data.order.orderId,
          orderLinkId: data.order.orderLinkId,
        });
      }
      const next = mapped.filter((order) => {
        if (!isNewEntryOrder(order)) return true;
        const latest = latestNewIds.get(order.symbol);
        if (!latest) return true;
        return (
          (latest.orderId && order.orderId === latest.orderId) ||
          (latest.orderLinkId && order.orderLinkId === latest.orderLinkId)
        );
      });
      setOrders(next);
      ordersRef.current = next;
      setOrdersError(null);
      setLastSuccessAt(now);
      const cancelTargets =
        authToken
          ? mapped.filter((order) => {
              if (!isNewEntryOrder(order)) return false;
              const latest = latestNewIds.get(order.symbol);
              if (!latest) return false;
              const isLatest =
                (latest.orderId && order.orderId === latest.orderId) ||
                (latest.orderLinkId &&
                  order.orderLinkId === latest.orderLinkId);
              return !isLatest;
            })
          : [];
      if (cancelTargets.length) {
        void (async () => {
          for (const order of cancelTargets) {
            const key = order.orderId || order.orderLinkId;
            if (!key || cancelingOrdersRef.current.has(key)) continue;
            cancelingOrdersRef.current.add(key);
            try {
              const res = await fetch(`${apiBase}/cancel`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({
                  symbol: order.symbol,
                  orderId: order.orderId || undefined,
                  orderLinkId: order.orderLinkId || undefined,
                }),
              });
              const json = await res.json().catch(() => ({}));
              if (res.ok && json?.ok !== false) {
                addLogEntries([
                  {
                    id: `order-prune:${key}:${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    action: "STATUS",
                    message: `ORDER PRUNE (NEW) ${order.symbol} ${order.side} ${key}`,
                  },
                ]);
              }
            } catch {
              // ignore cancel errors in enforcement loop
            } finally {
              cancelingOrdersRef.current.delete(key);
            }
          }
        })();
      }

      for (const [orderId, nextOrder] of nextOrders.entries()) {
        const prev = prevOrders.get(orderId);
        if (!prev) {
          newLogs.push({
            id: `order-new:${orderId}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `ORDER NEW ${nextOrder.symbol} ${nextOrder.side} ${formatNumber(
              nextOrder.qty,
              4
            )} @ ${nextOrder.price ?? "mkt"} | ${nextOrder.status}`,
          });
          continue;
        }
        if (prev.status !== nextOrder.status) {
          newLogs.push({
            id: `order-status:${orderId}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `ORDER STATUS ${nextOrder.symbol} ${prev.status} → ${nextOrder.status}`,
          });
        }
      }
      for (const [orderId, prevOrder] of prevOrders.entries()) {
        if (!nextOrders.has(orderId)) {
          newLogs.push({
            id: `order-closed:${orderId}:${now}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `ORDER CLOSED ${prevOrder.symbol} ${prevOrder.side} ${formatNumber(
              prevOrder.qty,
              4
            )} | ${prevOrder.status}`,
          });
        }
      }
      orderSnapshotRef.current = nextOrders;
    } else {
      const msg = asErrorMessage(ordersRes.reason);
      setOrdersError(msg);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (executionsRes.status === "fulfilled") {
      const list = extractList(executionsRes.value);
      const execSeen = execSeenRef.current;
      const nextTrades = list.map((t: any) => {
        const price = toNumber(t?.execPrice ?? t?.price);
        const qty = toNumber(t?.execQty ?? t?.qty);
        const value = toNumber(t?.execValue ?? t?.value);
        const fee = toNumber(t?.execFee ?? t?.fee);
        return {
          id: String(t?.execId ?? t?.tradeId ?? ""),
          symbol: String(t?.symbol ?? ""),
          side: (t?.side ?? "Buy") as "Buy" | "Sell",
          price: Number.isFinite(price) ? price : Number.NaN,
          qty: Number.isFinite(qty) ? qty : Number.NaN,
          value: Number.isFinite(value) ? value : Number.NaN,
          fee: Number.isFinite(fee) ? fee : Number.NaN,
          time: toIso(t?.execTime ?? t?.transactTime ?? t?.createdTime) || "",
        } as TestnetTrade;
      });
      setTrades(nextTrades);
      const tradeLogs = list
        .map((t: any) => {
          const timestamp = toIso(
            t?.execTime ?? t?.transactTime ?? t?.createdTime
          );
          if (!timestamp) return null;
          const symbol = String(t?.symbol ?? "");
          const side = String(t?.side ?? "");
          const qty = toNumber(t?.execQty ?? t?.qty);
          const price = toNumber(t?.execPrice ?? t?.price);
          const value = toNumber(t?.execValue ?? t?.value);
          const fee = toNumber(t?.execFee ?? t?.fee);
          const execType = String(t?.execType ?? t?.exec_type ?? "");
          const orderId = String(t?.orderId ?? t?.orderID ?? "");
          const orderLinkId = String(
            t?.orderLinkId ?? t?.orderLinkID ?? t?.clOrdId ?? ""
          );
          const isMaker =
            typeof t?.isMaker === "boolean" ? t.isMaker : undefined;

          const parts: string[] = [];
          if (
            symbol &&
            side &&
            Number.isFinite(qty) &&
            Number.isFinite(price)
          ) {
            parts.push(
              `${symbol} ${side} ${formatNumber(qty, 4)} @ ${formatNumber(
                price,
                6
              )}`
            );
          } else if (symbol && side) {
            parts.push(`${symbol} ${side}`);
          }
          if (Number.isFinite(value)) {
            parts.push(`value ${formatNumber(value, 4)}`);
          }
          if (Number.isFinite(fee)) {
            parts.push(`fee ${formatNumber(fee, 4)}`);
          }
          if (execType) parts.push(`type ${execType}`);
          if (orderId) parts.push(`order ${orderId}`);
          if (orderLinkId) parts.push(`link ${orderLinkId}`);
          if (typeof isMaker === "boolean") {
            parts.push(isMaker ? "maker" : "taker");
          }

          const message = parts.filter(Boolean).join(" | ");
          if (!message) return null;
          const id = String(
            t?.execId ?? t?.tradeId ?? `${symbol}-${timestamp}`
          );
          if (execSeen.has(id)) return null;
          execSeen.add(id);
          return {
            id,
            timestamp,
            action: "SYSTEM",
            message,
          } as LogEntry;
        })
        .filter((entry: LogEntry | null): entry is LogEntry => Boolean(entry));
      if (tradeLogs.length) {
        addLogEntries(tradeLogs);
      } else {
        setLogEntries((prev) => prev ?? []);
      }
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(executionsRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }
    if (newLogs.length) {
      addLogEntries(newLogs);
    }

    refreshDiagnosticsFromDecisions();

    fastOkRef.current = !sawError;
    if (!sawError && slowOkRef.current) {
      setSystemError(null);
    }

    fastPollRef.current = false;
  }, [
    addLogEntries,
    apiBase,
    authToken,
    fetchJson,
    refreshDiagnosticsFromDecisions,
    syncTrailingProtection,
    useTestnet,
  ]);

  const refreshSlow = useCallback(async () => {
    if (slowPollRef.current) return;
    slowPollRef.current = true;

    const now = Date.now();
    const results = await Promise.allSettled([
      fetchJson("/wallet"),
      fetchJson("/closed-pnl", { limit: "200" }),
      fetchJson("/reconcile"),
    ]);

    let sawError = false;
    const newLogs: LogEntry[] = [];
    const [walletRes, closedPnlRes, reconcileRes] = results;

    if (walletRes.status === "fulfilled") {
      const list = extractList(walletRes.value);
      const row = list[0] ?? {};
      const totalEquity = toNumber(
        row?.totalEquity ?? row?.totalWalletBalance
      );
      const availableBalance = toNumber(
        row?.totalAvailableBalance ?? row?.availableBalance
      );
      const totalWalletBalance = toNumber(row?.totalWalletBalance);
      setWalletSnapshot({
        totalEquity,
        availableBalance,
        totalWalletBalance,
      });
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(walletRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (closedPnlRes.status === "fulfilled") {
      const list = extractList(closedPnlRes.value);
      const records = list
        .map((r: any) => {
          const ts = toNumber(r?.execTime ?? r?.updatedTime ?? r?.createdTime);
          const pnl = toNumber(r?.closedPnl ?? r?.realisedPnl);
          const symbol = String(r?.symbol ?? "");
          if (!symbol || !Number.isFinite(ts) || !Number.isFinite(pnl))
            return null;
          return { symbol, pnl, ts };
        })
        .filter((r: ClosedPnlRecord | null): r is ClosedPnlRecord =>
          Boolean(r)
        );
      const pnlRecords = records.map((r) => ({
        symbol: r.symbol,
        pnl: r.pnl,
        timestamp: new Date(r.ts).toISOString(),
      }));
      const map = mergePnlRecords(pnlRecords);
      setClosedPnlRecords(records);
      setAssetPnlHistory(map);
      const pnlSeen = pnlSeenRef.current;
      for (const r of records) {
        const id = `pnl:${r.symbol}:${r.ts}`;
        if (pnlSeen.has(id)) continue;
        pnlSeen.add(id);
        newLogs.push({
          id,
          timestamp: new Date(r.ts).toISOString(),
          action: "SYSTEM",
          message: `PNL ${r.symbol} ${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(
            2
          )}`,
        });
      }
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(closedPnlRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (reconcileRes.status === "fulfilled") {
      const payload = reconcileRes.value ?? {};
      const reconDiffs = payload?.diffs ?? [];
      for (const diff of reconDiffs) {
        const sym = String(diff?.symbol ?? "");
        const label = String(diff?.message ?? diff?.field ?? diff?.type ?? "");
        if (!label) continue;
        const severity = String(diff?.severity ?? "").toUpperCase();
        newLogs.push({
          id: `reconcile:${sym}:${label}:${now}`,
          timestamp: new Date(now).toISOString(),
          action: severity === "HIGH" ? "ERROR" : "STATUS",
          message: `RECONCILE ${sym} ${label}`,
        });
      }
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(reconcileRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (newLogs.length) {
      addLogEntries(newLogs);
    } else {
      setLogEntries((prev) => prev ?? []);
    }

    slowOkRef.current = !sawError;
    if (!sawError && fastOkRef.current) {
      setSystemError(null);
    }

    slowPollRef.current = false;
  }, [addLogEntries, fetchJson]);

  useEffect(() => {
    if (!authToken) {
      setSystemError("missing_auth_token");
      return;
    }
    let alive = true;
    const tickFast = async () => {
      if (!alive) return;
      await refreshFast();
    };
    const tickSlow = async () => {
      if (!alive) return;
      await refreshSlow();
    };
    const fastId = setInterval(tickFast, 1000);
    const slowId = setInterval(tickSlow, 10000);
    const tsId = setInterval(() => {
      void syncTrailingProtection(positionsRef.current);
    }, TS_VERIFY_INTERVAL_MS);
    tickFast();
    tickSlow();
    return () => {
      alive = false;
      clearInterval(fastId);
      clearInterval(slowId);
      clearInterval(tsId);
    };
  }, [authToken, refreshFast, refreshSlow, syncTrailingProtection]);

  async function autoTrade(signal: {
    symbol: Symbol;
    side: "Buy" | "Sell";
    entryPrice: number;
    slPrice: number;
    tpPrices: number[];
    entryType: EntryType;
    triggerPrice?: number;
    qtyMode: "USDT_NOTIONAL" | "BASE_QTY";
    qtyValue: number;
  }) {
    if (!authToken) throw new Error("missing_auth_token");
    const intent = {
      intentId: crypto.randomUUID(),
      createdAt: Date.now(),
      profile: "AI-MATIC",
      symbol: signal.symbol,
      side: signal.side,
      entryType: signal.entryType,
      entryPrice: signal.entryPrice,
      triggerPrice: signal.triggerPrice,
      qtyMode: signal.qtyMode,
      qtyValue: signal.qtyValue,
      slPrice: signal.slPrice,
      tpPrices: signal.tpPrices ?? [],
      expireAfterMs: 30_000,
      tags: { env: useTestnet ? "testnet" : "mainnet", mode: "intent" },
    } as const;

    await sendIntent(intent, { authToken, useTestnet });
    correlationWaveRef.current.set(signal.symbol, Date.now());
  }

  const handleDecision = useCallback(
    (symbol: string, decision: PriceFeedDecision) => {
      const now = Date.now();
      feedLastTickRef.current = now;
      symbolTickRef.current.set(symbol, now);
      decisionRef.current[symbol] = { decision, ts: now };
      setScanDiagnostics((prev) => ({
        ...(prev ?? {}),
        [symbol]: buildScanDiagnostics(symbol, decision, now),
      }));

      const nextState = String(decision?.state ?? "").toUpperCase();
      if (nextState) {
        const prevState = lastStateRef.current.get(symbol);
        if (prevState && prevState !== nextState) {
          addLogEntries([
            {
              id: `state:${symbol}:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "STATUS",
              message: `${symbol} state ${prevState} → ${nextState}`,
            },
          ]);
        }
        lastStateRef.current.set(symbol, nextState);
      }

      const signal = decision?.signal ?? null;
      if (!signal) return;

      const signalId = String(signal.id ?? `${symbol}-${now}`);
      if (signalSeenRef.current.has(signalId)) return;
      signalSeenRef.current.add(signalId);

      const intent = signal.intent;
      const entry = toNumber(intent?.entry);
      const sl = toNumber(intent?.sl);
      const tp = toNumber(intent?.tp);
      const side =
        String(intent?.side ?? "").toLowerCase() === "buy" ? "Buy" : "Sell";
      const entryType =
        signal.entryType === "CONDITIONAL" ||
        signal.entryType === "LIMIT" ||
        signal.entryType === "LIMIT_MAKER_FIRST"
          ? signal.entryType
          : "LIMIT_MAKER_FIRST";
      const triggerPrice =
        entryType === "CONDITIONAL"
          ? Number.isFinite(signal.triggerPrice)
            ? signal.triggerPrice
            : entry
          : undefined;
      const timestamp =
        signal.createdAt || new Date(now).toISOString();

      const msgParts = [`${symbol} ${side}`];
      if (Number.isFinite(entry)) {
        msgParts.push(`entry ${formatNumber(entry, 6)}`);
      }
      if (Number.isFinite(sl)) {
        msgParts.push(`sl ${formatNumber(sl, 6)}`);
      }
      if (Number.isFinite(tp)) {
        msgParts.push(`tp ${formatNumber(tp, 6)}`);
      }
      if (signal.message) msgParts.push(signal.message);

      addLogEntries([
        {
          id: `signal:${signalId}`,
          timestamp,
          action: "SIGNAL",
          message: msgParts.join(" | "),
        },
      ]);

      if (modeRef.current !== TradingMode.AUTO_ON) {
        addLogEntries([
          {
            id: `signal:auto-off:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `AUTO_OFF ${symbol} signal not executed`,
          },
        ]);
        return;
      }

      const context = getSymbolContext(symbol, decision);
      const trendGate = resolveTrendGate(decision, signal);
      const correlationGate = resolveCorrelationGate(symbol, now);
      const blockReasons: string[] = [];
      const hardEnabled = context.settings.enableHardGates !== false;
      if (hardEnabled) {
        if (!context.engineOk && isGateEnabled("Engine ok")) {
          blockReasons.push("Engine ok");
        }
        if (!trendGate.ok && isGateEnabled("Trend bias")) {
          blockReasons.push("Trend bias");
        }
        if (!correlationGate.ok && isGateEnabled("Correlation")) {
          blockReasons.push("Correlation");
        }
        if (!context.sessionOk && isGateEnabled("Session ok")) {
          blockReasons.push("Session ok");
        }
        if (!context.maxPositionsOk && isGateEnabled("Max positions")) {
          blockReasons.push("Max positions");
        }
        if (context.hasPosition && isGateEnabled("Position clear")) {
          blockReasons.push("Position clear");
        }
        if (!context.ordersClearOk && isGateEnabled("Orders clear")) {
          blockReasons.push("Orders clear");
        }
        if (
          context.settings.requireConfirmationInAuto &&
          isGateEnabled("Confirm required")
        ) {
          blockReasons.push("Confirm required");
        }
      }

      const execEnabled = isGateEnabled("Exec allowed");
      if (blockReasons.length) {
        addLogEntries([
          {
            id: `signal:block:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "RISK_BLOCK",
            message: `${symbol} blocked by: ${blockReasons.join(" · ")}`,
          },
        ]);
        return;
      }
      if (!execEnabled) {
        addLogEntries([
          {
            id: `signal:exec-off:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `${symbol} exec disabled (manual)`,
          },
        ]);
        return;
      }

      if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0 || sl <= 0) {
        addLogEntries([
          {
            id: `signal:invalid:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "ERROR",
            message: `${symbol} invalid signal params (entry/sl)`,
          },
        ]);
        return;
      }

      const fixedSizing = computeFixedSizing(symbol as Symbol, entry, sl);
      const sizing = fixedSizing ?? computeNotionalForSignal(entry, sl);
      if (!sizing.ok) {
        addLogEntries([
          {
            id: `signal:sizing:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "ERROR",
            message: `${symbol} sizing failed: ${sizing.reason}`,
          },
        ]);
        return;
      }
      const useFixedQty = fixedSizing?.ok === true;
      const qtyMode = useFixedQty ? "BASE_QTY" : "USDT_NOTIONAL";
      const qtyValue = useFixedQty ? sizing.qty : sizing.notional;

      if (intentPendingRef.current.has(symbol)) {
        addLogEntries([
          {
            id: `signal:pending:${signalId}`,
            timestamp: new Date(now).toISOString(),
            action: "STATUS",
            message: `${symbol} intent pending`,
          },
        ]);
        return;
      }

      intentPendingRef.current.add(symbol);
      void (async () => {
        try {
          await autoTrade({
            symbol: symbol as Symbol,
            side,
            entryPrice: entry,
            entryType,
            triggerPrice,
            slPrice: sl,
            tpPrices: Number.isFinite(tp) ? [tp] : [],
            qtyMode,
            qtyValue,
          });
          addLogEntries([
            {
              id: `signal:sent:${signalId}`,
              timestamp: new Date().toISOString(),
              action: "STATUS",
              message: `${symbol} intent sent | qty ${formatNumber(
                sizing.qty,
                6
              )} | notional ${formatNumber(sizing.notional, 2)}`,
            },
          ]);
        } catch (err) {
          addLogEntries([
            {
              id: `signal:error:${signalId}`,
              timestamp: new Date().toISOString(),
              action: "ERROR",
              message: `${symbol} intent failed: ${asErrorMessage(err)}`,
            },
          ]);
        } finally {
          intentPendingRef.current.delete(symbol);
        }
      })();
    },
    [
      addLogEntries,
      autoTrade,
      buildScanDiagnostics,
      computeFixedSizing,
      computeNotionalForSignal,
      getSymbolContext,
      isGateEnabled,
      resolveCorrelationGate,
      resolveTrendGate,
    ]
  );

  useEffect(() => {
    handleDecisionRef.current = handleDecision;
  }, [handleDecision]);

  useEffect(() => {
    if (!authToken) return;

    signalSeenRef.current.clear();
    intentPendingRef.current.clear();
    decisionRef.current = {};
    setScanDiagnostics(null);

    const riskMode = settingsRef.current.riskMode;
    const isSmc = riskMode === "ai-matic-x";
    const isAiMatic = riskMode === "ai-matic" || riskMode === "ai-matic-tree";
    const isScalp = riskMode === "ai-matic-scalp";
    const decisionFn = (
      symbol: string,
      candles: Parameters<typeof evaluateStrategyForSymbol>[1],
      config?: Partial<BotConfig>
    ) => {
      const baseDecision = isSmc
        ? evaluateSmcStrategyForSymbol(symbol, candles, config)
        : evaluateStrategyForSymbol(symbol, candles, config);
      const htfTimeframes = isAiMatic
        ? AI_MATIC_HTF_TIMEFRAMES_MIN
        : HTF_TIMEFRAMES_MIN;
      const ltfTimeframes = isAiMatic
        ? AI_MATIC_LTF_TIMEFRAMES_MIN
        : isScalp
          ? SCALP_LTF_TIMEFRAMES_MIN
          : null;
      const htfTrend = evaluateHTFMultiTrend(candles, {
        timeframesMin: htfTimeframes,
      });
      const ltfTrend = ltfTimeframes
        ? evaluateHTFMultiTrend(candles, {
            timeframesMin: ltfTimeframes,
          })
        : null;
      return { ...baseDecision, htfTrend, ltfTrend };
    };
    const maxCandles = isSmc ? 3000 : isAiMatic ? 5000 : undefined;
    const backfill = isSmc
      ? { enabled: true, interval: "1", lookbackMinutes: 1440, limit: 1000 }
      : isAiMatic
        ? { enabled: true, interval: "1", lookbackMinutes: 4320, limit: 1000 }
        : undefined;
    const stop = startPriceFeed(
      WATCH_SYMBOLS,
      (symbol, decision) => {
        handleDecisionRef.current?.(symbol, decision);
      },
      {
        useTestnet,
        timeframe: "1",
        configOverrides: engineConfig,
        decisionFn,
        maxCandles,
        backfill,
      }
    );

    const envLabel = useTestnet ? "testnet" : "mainnet";
    const lastLog = feedLogRef.current;
    const now = Date.now();
    if (!lastLog || lastLog.env !== envLabel || now - lastLog.ts > 5000) {
      feedLogRef.current = { env: envLabel, ts: now };
      addLogEntries([
        {
          id: `feed:start:${envLabel}:${now}`,
          timestamp: new Date(now).toISOString(),
          action: "STATUS",
          message: `Price feed connected (${envLabel})`,
        },
      ]);
    }

    return () => {
      stop();
    };
  }, [addLogEntries, authToken, engineConfig, feedEpoch, useTestnet]);

  useEffect(() => {
    if (!authToken) return;
    const heartbeatId = setInterval(() => {
      const now = Date.now();
      const lastTick = feedLastTickRef.current;
      const staleMs = lastTick ? now - lastTick : Number.POSITIVE_INFINITY;
      if (staleMs > 60_000) {
        const lastRestart = lastRestartRef.current;
        if (now - lastRestart > 120_000) {
          lastRestartRef.current = now;
          addLogEntries([
            {
              id: `feed:stale:${now}`,
              timestamp: new Date(now).toISOString(),
              action: "ERROR",
              message: `Price feed stale (${Math.round(staleMs / 1000)}s) - reconnecting`,
            },
          ]);
          setFeedEpoch((v) => v + 1);
        }
      }

      if (now - lastHeartbeatRef.current < 60_000) return;
      lastHeartbeatRef.current = now;

      const scan: string[] = [];
      const manage: string[] = [];
      for (const symbol of WATCH_SYMBOLS) {
        const state = resolveSymbolState(symbol);
        if (state === "MANAGE") manage.push(symbol);
        else scan.push(symbol);
      }

      const parts: string[] = [];
      if (scan.length) parts.push(`scan: ${scan.join(", ")}`);
      if (manage.length) parts.push(`manage: ${manage.join(", ")}`);
      const message = parts.length
        ? `BOT HEARTBEAT | ${parts.join(" | ")}`
        : "BOT HEARTBEAT | idle";

      addLogEntries([
        {
          id: `heartbeat:${now}`,
          timestamp: new Date(now).toISOString(),
          action: "STATUS",
          message,
        },
      ]);
    }, 30_000);

    return () => {
      clearInterval(heartbeatId);
    };
  }, [addLogEntries, authToken, resolveSymbolState]);

  const systemState = useMemo<SystemState>(() => {
    const hasSuccess = Boolean(lastSuccessAt);
    const status = !authToken
      ? "Disconnected"
      : systemError
        ? "Error"
        : hasSuccess
          ? "Connected"
          : "Connecting...";
    return {
      bybitStatus: status,
      latency: lastLatencyMs ?? Number.NaN,
      lastError: systemError ?? null,
      recentErrors,
    };
  }, [authToken, lastLatencyMs, lastSuccessAt, recentErrors, systemError]);

  const portfolioState = useMemo<PortfolioState>(() => {
    const totalEquity = walletSnapshot?.totalEquity ?? Number.NaN;
    const availableBalance = walletSnapshot?.availableBalance ?? Number.NaN;
    const totalWalletBalance =
      walletSnapshot?.totalWalletBalance ?? Number.NaN;
    const openPositions = Array.isArray(positions)
      ? positions.length
      : Number.NaN;
    const allocatedCapital = Array.isArray(positions)
      ? positions.reduce((sum, p) => {
          const size = toNumber(p.size ?? p.qty);
          const entry = toNumber(p.entryPrice);
          if (!Number.isFinite(size) || !Number.isFinite(entry)) return sum;
          return sum + Math.abs(size * entry);
        }, 0)
      : Number.NaN;
    const dailyPnl = Array.isArray(closedPnlRecords)
      ? closedPnlRecords.reduce((sum, r) => {
          const dayAgo = Date.now() - 24 * 60 * 60_000;
          if (r.ts < dayAgo) return sum;
          return sum + r.pnl;
        }, 0)
      : Number.NaN;
    return {
      totalEquity,
      availableBalance,
      dailyPnl,
      openPositions,
      totalCapital: Number.isFinite(totalEquity)
        ? totalEquity
        : totalWalletBalance,
      allocatedCapital,
      maxAllocatedCapital: totalWalletBalance,
      peakCapital: totalWalletBalance,
      currentDrawdown: Number.NaN,
      maxOpenPositions: settings.maxOpenPositions,
    };
  }, [closedPnlRecords, positions, settings.maxOpenPositions, walletSnapshot]);

  const resetPnlHistory = useCallback(() => {
    const symbols = new Set<string>();
    if (assetPnlHistory) {
      Object.keys(assetPnlHistory).forEach((symbol) => {
        if (symbol) symbols.add(symbol);
      });
    }
    if (Array.isArray(positions)) {
      positions.forEach((pos) => {
        if (pos.symbol) symbols.add(pos.symbol);
      });
    }
    if (symbols.size === 0) {
      WATCH_SYMBOLS.forEach((symbol) => symbols.add(symbol));
    }
    const next = resetPnlHistoryMap(Array.from(symbols));
    setAssetPnlHistory(next);
    setClosedPnlRecords([]);
    pnlSeenRef.current = new Set();
  }, [assetPnlHistory, positions]);

  const manualClosePosition = useCallback(
    async (pos: ActivePosition) => {
      if (!authToken) throw new Error("missing_auth_token");
      const sizeRaw = toNumber(pos.size ?? pos.qty);
      if (!Number.isFinite(sizeRaw) || sizeRaw <= 0) {
        throw new Error("invalid_position_qty");
      }
      const closeSide =
        String(pos.side).toLowerCase() === "buy" ? "Sell" : "Buy";
      const payload = {
        symbol: pos.symbol,
        side: closeSide,
        qty: Math.abs(sizeRaw),
        orderType: "Market",
        reduceOnly: true,
        timeInForce: "IOC",
      };
      const res = await fetch(`${apiBase}/order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `close_failed:${res.status}`);
      }
      await refreshFast();
      return true;
    },
    [apiBase, authToken, refreshFast]
  );

  const cancelOrder = useCallback(
    async (order: TestnetOrder) => {
      if (!authToken) throw new Error("missing_auth_token");
      if (!order?.symbol) throw new Error("missing_order_symbol");
      const orderId = order?.orderId || "";
      const orderLinkId = order?.orderLinkId || "";
      if (!orderId && !orderLinkId) throw new Error("missing_order_id");
      const res = await fetch(`${apiBase}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          symbol: order.symbol,
          orderId: orderId || undefined,
          orderLinkId: orderLinkId || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `cancel_failed:${res.status}`);
      }
      await refreshFast();
      return true;
    },
    [apiBase, authToken, refreshFast]
  );

  const updateSettings = useCallback((next: AISettings) => {
    setSettings(next);
  }, []);

  return {
    autoTrade,
    systemState,
    portfolioState,
    activePositions: positions,
    logEntries,
    testnetOrders: orders,
    testnetTrades: trades,
    ordersError,
    refreshTestnetOrders: refreshFast,
    assetPnlHistory,
    resetPnlHistory,
    scanDiagnostics,
    manualClosePosition,
    cancelOrder,
    dynamicSymbols: null,
    settings,
    updateSettings,
    updateGateOverrides,
  };
}

export type TradingBotApi = ReturnType<typeof useTradingBot>;
