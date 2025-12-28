// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi";
import { Symbol } from "../api/types";
import { getApiBase } from "../engine/networkConfig";
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

const SETTINGS_STORAGE_KEY = "ai-matic-settings";

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

function loadStoredSettings(): AISettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { ...DEFAULT_SETTINGS, ...parsed } as AISettings;
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

function toIso(ts: unknown) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n).toISOString();
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

type ClosedPnlRecord = { symbol: string; pnl: number; ts: number };
const WATCH_SYMBOLS: Symbol[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];

export function useTradingBot(
  _mode?: unknown,
  useTestnet = false,
  authToken?: string
) {
  const [settings, setSettings] = useState<AISettings>(
    () => loadStoredSettings() ?? DEFAULT_SETTINGS
  );
  const apiBase = useMemo(() => getApiBase(Boolean(useTestnet)), [useTestnet]);

  const [positions, setPositions] = useState<ActivePosition[] | null>(null);
  const [orders, setOrders] = useState<TestnetOrder[] | null>(null);
  const [trades, setTrades] = useState<TestnetTrade[] | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[] | null>(null);
  const [scanDiagnostics, setScanDiagnostics] = useState<
    Record<string, any> | null
  >(null);
  const [assetPnlHistory, setAssetPnlHistory] = useState<AssetPnlMap | null>(
    null
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
  const pollRef = useRef(false);

  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

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

  const refreshAll = useCallback(async () => {
    if (pollRef.current) return;
    pollRef.current = true;

    const now = Date.now();
    const results = await Promise.allSettled([
      fetchJson("/positions"),
      fetchJson("/orders", { limit: "50" }),
      fetchJson("/executions", { limit: "50" }),
      fetchJson("/wallet"),
      fetchJson("/closed-pnl", { limit: "200" }),
      fetchJson("/reconcile"),
    ]);

    let sawError = false;
    let tradeLogs: LogEntry[] | null = null;
    let pnlLogs: LogEntry[] | null = null;
    const [
      positionsRes,
      ordersRes,
      executionsRes,
      walletRes,
      closedPnlRes,
      reconcileRes,
    ] = results;

    if (positionsRes.status === "fulfilled") {
      const list = extractList(positionsRes.value);
      const next = list
        .map((p: any) => {
          const size = toNumber(p?.size ?? p?.qty);
          if (!Number.isFinite(size) || size <= 0) return null;
          const sideRaw = String(p?.side ?? "");
          const side =
            sideRaw.toLowerCase() === "buy" ? "Buy" : "Sell";
          const entryPrice = toNumber(p?.entryPrice ?? p?.avgEntryPrice);
          const unrealized = toNumber(
            p?.unrealisedPnl ?? p?.unrealizedPnl
          );
          const openedAt = toIso(p?.createdTime ?? p?.updatedTime);
          return {
            positionId: String(p?.positionId ?? `${p?.symbol}-${sideRaw}`),
            id: String(p?.positionId ?? ""),
            symbol: String(p?.symbol ?? ""),
            side,
            qty: size,
            size,
            entryPrice: Number.isFinite(entryPrice) ? entryPrice : Number.NaN,
            sl: toNumber(p?.stopLoss ?? p?.sl) || undefined,
            tp: toNumber(p?.takeProfit ?? p?.tp) || undefined,
            currentTrailingStop:
              toNumber(p?.trailingStop ?? p?.trailingStopDistance) ||
              undefined,
            unrealizedPnl: Number.isFinite(unrealized)
              ? unrealized
              : Number.NaN,
            openedAt: openedAt || "",
            env: useTestnet ? "testnet" : "mainnet",
          } satisfies ActivePosition;
        })
        .filter((p: ActivePosition | null): p is ActivePosition => Boolean(p));
      setPositions(next);
      setLastSuccessAt(now);
    }

    if (ordersRes.status === "fulfilled") {
      const list = extractList(ordersRes.value);
      const next = list
        .map((o: any) => {
          const qty = toNumber(o?.qty ?? o?.orderQty ?? o?.leavesQty);
          const price = toNumber(o?.price);
          return {
          orderId: String(o?.orderId ?? o?.orderID ?? o?.id ?? ""),
          symbol: String(o?.symbol ?? ""),
          side: (o?.side ?? "Buy") as "Buy" | "Sell",
          qty: Number.isFinite(qty) ? qty : Number.NaN,
          price: Number.isFinite(price) ? price : null,
          status: String(o?.orderStatus ?? o?.order_status ?? o?.status ?? ""),
          createdTime: toIso(o?.createdTime ?? o?.created_at) || "",
          } as TestnetOrder;
        })
        .filter((o: TestnetOrder) => Boolean(o.orderId));
      setOrders(next);
      setOrdersError(null);
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(ordersRes.reason);
      setOrdersError(msg);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (executionsRes.status === "fulfilled") {
      const list = extractList(executionsRes.value);
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
      tradeLogs = list
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
          return {
            id,
            timestamp,
            action: "SYSTEM",
            message,
          } as LogEntry;
        })
        .filter((entry: LogEntry | null): entry is LogEntry => Boolean(entry));
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(executionsRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

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
      const map: AssetPnlMap = {};
      for (const r of records) {
        const entry = {
          symbol: r.symbol,
          pnl: r.pnl,
          timestamp: new Date(r.ts).toISOString(),
        };
        map[r.symbol] = [entry, ...(map[r.symbol] ?? [])];
      }
      setClosedPnlRecords(records);
      setAssetPnlHistory(map);
      pnlLogs = records
        .map((r) => {
          const timestamp = new Date(r.ts).toISOString();
          if (!timestamp) return null;
          const message = `PNL ${r.symbol} ${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(2)}`;
          return {
            id: `pnl:${r.symbol}:${r.ts}`,
            timestamp,
            action: "SYSTEM",
            message,
          } as LogEntry;
        })
        .filter((entry: LogEntry | null): entry is LogEntry => Boolean(entry));
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(closedPnlRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (reconcileRes.status === "fulfilled") {
      const payload = reconcileRes.value ?? {};
      const reconPositions = payload?.positions ?? [];
      const reconOrders = payload?.orders ?? [];
      const reconDiffs = payload?.diffs ?? [];
      const symbols = new Set<string>(WATCH_SYMBOLS);
      for (const p of reconPositions) {
        const sym = String(p?.symbol ?? "");
        if (sym) symbols.add(sym);
      }
      for (const o of reconOrders) {
        const sym = String(o?.symbol ?? "");
        if (sym) symbols.add(sym);
      }
      for (const d of reconDiffs) {
        const sym = String(d?.symbol ?? "");
        if (sym) symbols.add(sym);
      }

      const nextDiagnostics: Record<string, any> = {};
      for (const sym of symbols) {
        const pos = reconPositions.find(
          (p: any) => String(p?.symbol ?? "") === sym
        );
        const symOrders = reconOrders.filter(
          (o: any) => String(o?.symbol ?? "") === sym
        );
        const symDiffs = reconDiffs.filter(
          (d: any) => String(d?.symbol ?? "") === sym
        );
        const hardBlocked = symDiffs.some(
          (d: any) => String(d?.severity ?? "").toUpperCase() === "HIGH"
        );
        const hardBlock = symDiffs
          .map((d: any) => d?.message)
          .filter(Boolean)
          .join("; ");
        const gates: { name: string; ok: boolean }[] = [];
        const gateNames = new Set<string>();
        const pushGate = (name: string, ok: boolean) => {
          if (!name || gateNames.has(name)) return;
          gateNames.add(name);
          gates.push({ name, ok });
        };

        pushGate("Position open", Boolean(pos));
        pushGate("Open orders", symOrders.length > 0);
        if (pos) {
          const sl = toNumber(pos?.sl ?? pos?.stopLoss);
          const tp = toNumber(pos?.tp ?? pos?.takeProfit);
          pushGate("SL set", Number.isFinite(sl) && sl > 0);
          pushGate("TP set", Number.isFinite(tp) && tp > 0);
        }
        for (const diff of symDiffs) {
          const label = String(diff?.message ?? diff?.field ?? diff?.type ?? "");
          if (label) pushGate(label, false);
        }

        nextDiagnostics[sym] = {
          signalActive: Boolean(pos) || symOrders.length > 0,
          hardEnabled: true,
          softEnabled: false,
          hardBlocked,
          hardBlock: hardBlock || undefined,
          gates,
        };
      }
      setScanDiagnostics(nextDiagnostics);
      setLastSuccessAt(now);
    } else {
      const msg = asErrorMessage(reconcileRes.reason);
      setSystemError(msg);
      setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
      sawError = true;
    }

    if (tradeLogs || pnlLogs) {
      const combined = [...(tradeLogs ?? []), ...(pnlLogs ?? [])]
        .filter((entry) => Boolean(entry.timestamp))
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() -
            new Date(a.timestamp).getTime()
        );
      const seen = new Set<string>();
      const unique: LogEntry[] = [];
      for (const entry of combined) {
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        unique.push(entry);
      }
      setLogEntries(unique.slice(0, 200));
    }

    if (!sawError) {
      setSystemError(null);
    }

    pollRef.current = false;
  }, [fetchJson, useTestnet]);

  useEffect(() => {
    if (!authToken) {
      setSystemError("missing_auth_token");
      return;
    }
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await refreshAll();
    };
    const id = setInterval(tick, 2500);
    tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [authToken, refreshAll]);

  async function autoTrade(signal: {
    symbol: Symbol;
    side: "Buy" | "Sell";
    entryPrice: number;
    slPrice: number;
    tpPrices: number[];
    notionalUSDT: number;
  }) {
    if (!authToken) throw new Error("missing_auth_token");
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
      tags: { env: useTestnet ? "testnet" : "mainnet", mode: "intent" },
    } as const;

    await sendIntent(intent, { authToken, useTestnet });
  }

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
    void refreshAll();
  }, [refreshAll]);

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
      await refreshAll();
      return true;
    },
    [apiBase, authToken, refreshAll]
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
    refreshTestnetOrders: refreshAll,
    assetPnlHistory,
    resetPnlHistory,
    scanDiagnostics,
    manualClosePosition,
    dynamicSymbols: null,
    settings,
    updateSettings,
  };
}

export type TradingBotApi = ReturnType<typeof useTradingBot>;
