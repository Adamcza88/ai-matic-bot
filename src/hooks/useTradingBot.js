// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi";
import { getApiBase } from "../engine/networkConfig";
import { startPriceFeed } from "../engine/priceFeed";
import { TradingMode } from "../types";
const SETTINGS_STORAGE_KEY = "ai-matic-settings";
const LOG_DEDUPE_WINDOW_MS = 1500;
const FEED_AGE_OK_MS = 60_000;
const MIN_POSITION_NOTIONAL_USD = 4;
const MAX_POSITION_NOTIONAL_USD = 7;
const DEFAULT_SETTINGS = {
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
function loadStoredSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        return { ...DEFAULT_SETTINGS, ...parsed };
    }
    catch {
        return null;
    }
}
function persistSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
    catch {
        // ignore storage errors
    }
}
function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number.NaN;
}
function toIso(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0)
        return "";
    return new Date(n).toISOString();
}
function formatNumber(value, digits = 4) {
    return Number.isFinite(value) ? value.toFixed(digits) : "";
}
function asErrorMessage(err) {
    return err instanceof Error ? err.message : String(err ?? "unknown_error");
}
function extractList(data) {
    return data?.result?.list ?? data?.list ?? [];
}
const WATCH_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];
export function useTradingBot(mode, useTestnet = false, authToken) {
    const [settings, setSettings] = useState(() => loadStoredSettings() ?? DEFAULT_SETTINGS);
    const apiBase = useMemo(() => getApiBase(Boolean(useTestnet)), [useTestnet]);
    const [positions, setPositions] = useState(null);
    const [orders, setOrders] = useState(null);
    const [trades, setTrades] = useState(null);
    const [logEntries, setLogEntries] = useState(null);
    const [scanDiagnostics, setScanDiagnostics] = useState(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState(null);
    const [closedPnlRecords, setClosedPnlRecords] = useState(null);
    const [walletSnapshot, setWalletSnapshot] = useState(null);
    const [ordersError, setOrdersError] = useState(null);
    const [systemError, setSystemError] = useState(null);
    const [recentErrors, setRecentErrors] = useState([]);
    const [lastLatencyMs, setLastLatencyMs] = useState(null);
    const [lastSuccessAt, setLastSuccessAt] = useState(null);
    const fastPollRef = useRef(false);
    const slowPollRef = useRef(false);
    const orderSnapshotRef = useRef(new Map());
    const positionSnapshotRef = useRef(new Map());
    const execSeenRef = useRef(new Set());
    const pnlSeenRef = useRef(new Set());
    const fastOkRef = useRef(false);
    const slowOkRef = useRef(false);
    const modeRef = useRef(mode);
    const positionsRef = useRef([]);
    const ordersRef = useRef([]);
    const decisionRef = useRef({});
    const signalSeenRef = useRef(new Set());
    const intentPendingRef = useRef(new Set());
    const settingsRef = useRef(settings);
    const walletRef = useRef(walletSnapshot);
    const handleDecisionRef = useRef(null);
    const feedLogRef = useRef(null);
    const logDedupeRef = useRef(new Map());
    const gateOverridesRef = useRef({});
    const feedLastTickRef = useRef(0);
    const lastHeartbeatRef = useRef(0);
    const lastStateRef = useRef(new Map());
    const lastRestartRef = useRef(0);
    const [feedEpoch, setFeedEpoch] = useState(0);
    const symbolTickRef = useRef(new Map());
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
        if (positions)
            positionsRef.current = positions;
    }, [positions]);
    useEffect(() => {
        if (orders)
            ordersRef.current = orders;
    }, [orders]);
    const fetchJson = useCallback(async (path, params) => {
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
    }, [apiBase, authToken]);
    const addLogEntries = useCallback((entries) => {
        if (!entries.length)
            return;
        const dedupe = logDedupeRef.current;
        const now = Date.now();
        const filtered = [];
        for (const entry of entries) {
            const key = `${entry.action}:${entry.message}`;
            const last = dedupe.get(key);
            if (last && now - last < LOG_DEDUPE_WINDOW_MS)
                continue;
            dedupe.set(key, now);
            filtered.push(entry);
        }
        if (dedupe.size > 1000) {
            for (const [key, ts] of dedupe.entries()) {
                if (now - ts > 60_000)
                    dedupe.delete(key);
            }
        }
        if (!filtered.length)
            return;
        setLogEntries((prev) => {
            const list = prev ? [...prev] : [];
            const map = new Map(list.map((entry) => [entry.id, entry]));
            for (const entry of filtered) {
                map.set(entry.id, entry);
            }
            const merged = Array.from(map.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return merged.slice(0, 200);
        });
    }, []);
    const isGateEnabled = useCallback((name) => {
        const value = gateOverridesRef.current?.[name];
        return typeof value === "boolean" ? value : true;
    }, []);
    const getEquityValue = useCallback(() => {
        const wallet = walletRef.current;
        const totalEquity = toNumber(wallet?.totalEquity);
        if (Number.isFinite(totalEquity) && totalEquity > 0)
            return totalEquity;
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
    const isSessionAllowed = useCallback((now, next) => {
        if (!next.enforceSessionHours)
            return true;
        const day = now.getDay();
        if (Array.isArray(next.tradingDays) && next.tradingDays.length > 0) {
            if (!next.tradingDays.includes(day))
                return false;
        }
        const start = Number(next.tradingStartHour);
        const end = Number(next.tradingEndHour);
        if (!Number.isFinite(start) || !Number.isFinite(end))
            return true;
        if (start === end)
            return true;
        const hour = now.getHours();
        if (start < end)
            return hour >= start && hour <= end;
        return hour >= start || hour <= end;
    }, []);
    const computeNotionalForSignal = useCallback((entry, sl) => {
        const settings = settingsRef.current;
        const equity = getEquityValue();
        if (!Number.isFinite(equity) || equity <= 0) {
            return { ok: false, reason: "missing_equity" };
        }
        const baseRiskRaw = toNumber(settings.baseRiskPerTrade);
        if (!Number.isFinite(baseRiskRaw) || baseRiskRaw <= 0) {
            return { ok: false, reason: "invalid_risk" };
        }
        let riskUsd = baseRiskRaw <= 1 ? equity * baseRiskRaw : baseRiskRaw;
        const maxRiskPct = toNumber(settings.maxPortfolioRiskPercent);
        if (Number.isFinite(maxRiskPct) &&
            maxRiskPct > 0 &&
            maxRiskPct <= 1) {
            riskUsd = Math.min(riskUsd, equity * maxRiskPct);
        }
        const sizingMultiplier = toNumber(settings.positionSizingMultiplier);
        if (Number.isFinite(sizingMultiplier) && sizingMultiplier > 0) {
            riskUsd *= sizingMultiplier;
        }
        const riskPerUnit = Math.abs(entry - sl);
        if (!Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
            return { ok: false, reason: "invalid_sl_distance" };
        }
        let qty = riskUsd / riskPerUnit;
        if (!Number.isFinite(qty) || qty <= 0) {
            return { ok: false, reason: "invalid_qty" };
        }
        let notional = qty * entry;
        if (Number.isFinite(notional) && notional > 0) {
            notional = Math.min(Math.max(notional, MIN_POSITION_NOTIONAL_USD), MAX_POSITION_NOTIONAL_USD);
            qty = notional / entry;
        }
        const maxAllocPct = toNumber(settings.maxAllocatedCapitalPercent);
        if (Number.isFinite(maxAllocPct) &&
            maxAllocPct > 0 &&
            maxAllocPct <= 1 &&
            Number.isFinite(entry) &&
            entry > 0) {
            const maxNotional = equity * maxAllocPct;
            if (Number.isFinite(maxNotional) && maxNotional > 0) {
                if (maxNotional < MIN_POSITION_NOTIONAL_USD) {
                    return { ok: false, reason: "insufficient_equity" };
                }
                if (notional > maxNotional) {
                    notional = maxNotional;
                    qty = notional / entry;
                }
                if (notional < MIN_POSITION_NOTIONAL_USD) {
                    return { ok: false, reason: "insufficient_equity" };
                }
            }
        }
        return { ok: true, notional, qty, riskUsd, equity };
    }, [getEquityValue]);
    const getSymbolContext = useCallback((symbol, decision) => {
        const settings = settingsRef.current;
        const now = new Date();
        const sessionOk = isSessionAllowed(now, settings);
        const maxPositions = toNumber(settings.maxOpenPositions);
        const openPositionsCount = positionsRef.current.length;
        const maxPositionsOk = !Number.isFinite(maxPositions) ||
            maxPositions <= 0 ||
            openPositionsCount < maxPositions;
        const hasPosition = positionsRef.current.some((p) => {
            if (p.symbol !== symbol)
                return false;
            const size = toNumber(p.size ?? p.qty);
            return Number.isFinite(size) && size > 0;
        });
        const hasOrders = ordersRef.current.some((o) => String(o.symbol ?? "") === symbol);
        const engineOk = !(decision?.halted ?? false);
        return {
            settings,
            now,
            sessionOk,
            maxPositionsOk,
            maxPositions,
            openPositionsCount,
            hasPosition,
            hasOrders,
            engineOk,
        };
    }, [isSessionAllowed]);
    const resolveSymbolState = useCallback((symbol) => {
        const decision = decisionRef.current[symbol]?.decision;
        const state = String(decision?.state ?? "").toUpperCase();
        if (state === "MANAGE")
            return "MANAGE";
        if (state === "SCAN")
            return "SCAN";
        const hasPosition = positionsRef.current.some((p) => {
            if (p.symbol !== symbol)
                return false;
            const size = toNumber(p.size ?? p.qty);
            return Number.isFinite(size) && size > 0;
        });
        if (hasPosition)
            return "MANAGE";
        const hasOrders = ordersRef.current.some((o) => String(o.symbol ?? "") === symbol);
        if (hasOrders)
            return "MANAGE";
        return "SCAN";
    }, []);
    const buildScanDiagnostics = useCallback((symbol, decision, lastScanTs) => {
        const context = getSymbolContext(symbol, decision);
        const lastTick = symbolTickRef.current.get(symbol) ?? 0;
        const feedAgeMs = lastTick > 0 ? Math.max(0, Date.now() - lastTick) : null;
        const feedAgeOk = feedAgeMs == null ? null : feedAgeMs <= FEED_AGE_OK_MS;
        const signalActive = Boolean(decision?.signal);
        const pos = positionsRef.current.find((p) => p.symbol === symbol);
        const sl = toNumber(pos?.sl);
        const tp = toNumber(pos?.tp);
        const symbolOrders = ordersRef.current.filter((o) => String(o.symbol ?? "") === symbol);
        const gates = [];
        const addGate = (name, ok, detail) => {
            gates.push({ name, ok, detail: ok ? detail : undefined });
        };
        const signalDetail = (() => {
            const sig = decision?.signal;
            if (!sig)
                return undefined;
            const side = String(sig.intent?.side ?? "").toUpperCase();
            const entry = toNumber(sig.intent?.entry);
            const parts = [];
            if (side)
                parts.push(side);
            if (Number.isFinite(entry)) {
                parts.push(`@ ${formatNumber(entry, 2)}`);
            }
            return parts.join(" ") || "signal active";
        })();
        addGate("Signal", signalActive, signalDetail);
        addGate("Engine ok", context.engineOk, "running");
        const sessionDetail = context.settings.enforceSessionHours
            ? `${String(context.settings.tradingStartHour).padStart(2, "0")}:00-${String(context.settings.tradingEndHour).padStart(2, "0")}:00`
            : "24/7";
        addGate("Session ok", context.sessionOk, sessionDetail);
        addGate("Confirm required", !context.settings.requireConfirmationInAuto, "not required");
        const maxPositionsDetail = Number.isFinite(context.maxPositions)
            ? `open ${context.openPositionsCount}/${context.maxPositions}`
            : `open ${context.openPositionsCount}`;
        addGate("Max positions", context.maxPositionsOk, maxPositionsDetail);
        addGate("Position clear", !context.hasPosition, "no open position");
        addGate("Orders clear", !context.hasOrders, `open ${symbolOrders.length}`);
        const slOk = context.hasPosition && Number.isFinite(sl) && sl > 0;
        const tpOk = context.hasPosition && Number.isFinite(tp) && tp > 0;
        addGate("SL set", slOk, slOk ? `SL ${formatNumber(sl, 6)}` : undefined);
        addGate("TP set", tpOk, tpOk ? `TP ${formatNumber(tp, 6)}` : undefined);
        const hardEnabled = context.settings.enableHardGates !== false;
        const softEnabled = context.settings.enableSoftGates !== false;
        const hardReasons = [];
        if (hardEnabled) {
            if (!context.engineOk && isGateEnabled("Engine ok")) {
                hardReasons.push("Engine ok");
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
            if (context.hasOrders && isGateEnabled("Orders clear")) {
                hardReasons.push("Orders clear");
            }
            if (feedAgeOk === false && isGateEnabled("Feed age")) {
                hardReasons.push("Feed age");
            }
            if (context.settings.requireConfirmationInAuto &&
                isGateEnabled("Confirm required")) {
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
            lastScanTs,
            feedAgeMs,
            feedAgeOk,
        };
    }, [getSymbolContext, isGateEnabled]);
    const refreshDiagnosticsFromDecisions = useCallback(() => {
        const entries = Object.entries(decisionRef.current);
        if (!entries.length)
            return;
        setScanDiagnostics((prev) => {
            const next = { ...(prev ?? {}) };
            for (const [symbol, data] of entries) {
                next[symbol] = buildScanDiagnostics(symbol, data.decision, data.ts);
            }
            return next;
        });
    }, [buildScanDiagnostics]);
    const updateGateOverrides = useCallback((overrides) => {
        gateOverridesRef.current = { ...overrides };
        refreshDiagnosticsFromDecisions();
    }, [refreshDiagnosticsFromDecisions]);
    const refreshFast = useCallback(async () => {
        if (fastPollRef.current)
            return;
        fastPollRef.current = true;
        const now = Date.now();
        const results = await Promise.allSettled([
            fetchJson("/positions"),
            fetchJson("/orders", { limit: "50" }),
            fetchJson("/executions", { limit: "50" }),
        ]);
        let sawError = false;
        const newLogs = [];
        const [positionsRes, ordersRes, executionsRes] = results;
        if (positionsRes.status === "fulfilled") {
            const list = extractList(positionsRes.value);
            const prevPositions = positionSnapshotRef.current;
            const nextPositions = new Map();
            const next = list
                .map((p) => {
                const size = toNumber(p?.size ?? p?.qty);
                if (!Number.isFinite(size) || size <= 0)
                    return null;
                const sideRaw = String(p?.side ?? "");
                const side = sideRaw.toLowerCase() === "buy" ? "Buy" : "Sell";
                const entryPrice = toNumber(p?.entryPrice ?? p?.avgEntryPrice);
                const unrealized = toNumber(p?.unrealisedPnl ?? p?.unrealizedPnl);
                const openedAt = toIso(p?.createdTime ?? p?.updatedTime);
                nextPositions.set(String(p?.symbol ?? ""), { size, side });
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
                    currentTrailingStop: toNumber(p?.trailingStop ?? p?.trailingStopDistance) ||
                        undefined,
                    unrealizedPnl: Number.isFinite(unrealized)
                        ? unrealized
                        : Number.NaN,
                    openedAt: openedAt || "",
                    env: useTestnet ? "testnet" : "mainnet",
                };
            })
                .filter((p) => Boolean(p));
            setPositions(next);
            positionsRef.current = next;
            setLastSuccessAt(now);
            for (const [symbol, nextPos] of nextPositions.entries()) {
                const prev = prevPositions.get(symbol);
                if (!prev) {
                    newLogs.push({
                        id: `pos-open:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `POSITION OPEN ${symbol} ${nextPos.side} size ${formatNumber(nextPos.size, 4)}`,
                    });
                    continue;
                }
                if (Number.isFinite(prev.size) && prev.size !== nextPos.size) {
                    newLogs.push({
                        id: `pos-size:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `POSITION SIZE ${symbol} ${formatNumber(prev.size, 4)} → ${formatNumber(nextPos.size, 4)}`,
                    });
                }
            }
            for (const [symbol, prevPos] of prevPositions.entries()) {
                if (!nextPositions.has(symbol)) {
                    newLogs.push({
                        id: `pos-close:${symbol}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `POSITION CLOSED ${symbol} ${prevPos.side} size ${formatNumber(prevPos.size, 4)}`,
                    });
                }
            }
            positionSnapshotRef.current = nextPositions;
        }
        if (ordersRes.status === "fulfilled") {
            const list = extractList(ordersRes.value);
            const prevOrders = orderSnapshotRef.current;
            const nextOrders = new Map();
            const next = list
                .map((o) => {
                const qty = toNumber(o?.qty ?? o?.orderQty ?? o?.leavesQty);
                const price = toNumber(o?.price);
                const orderId = String(o?.orderId ?? o?.orderID ?? o?.id ?? "");
                const symbol = String(o?.symbol ?? "");
                const side = String(o?.side ?? "Buy");
                const status = String(o?.orderStatus ?? o?.order_status ?? o?.status ?? "");
                const entry = {
                    orderId,
                    symbol,
                    side: side,
                    qty: Number.isFinite(qty) ? qty : Number.NaN,
                    price: Number.isFinite(price) ? price : null,
                    status,
                    createdTime: toIso(o?.createdTime ?? o?.created_at) || "",
                };
                if (orderId) {
                    nextOrders.set(orderId, {
                        status,
                        qty: Number.isFinite(qty) ? qty : Number.NaN,
                        price: Number.isFinite(price) ? price : null,
                        side,
                        symbol,
                    });
                }
                return entry;
            })
                .filter((o) => Boolean(o.orderId));
            setOrders(next);
            ordersRef.current = next;
            setOrdersError(null);
            setLastSuccessAt(now);
            for (const [orderId, nextOrder] of nextOrders.entries()) {
                const prev = prevOrders.get(orderId);
                if (!prev) {
                    newLogs.push({
                        id: `order-new:${orderId}:${now}`,
                        timestamp: new Date(now).toISOString(),
                        action: "STATUS",
                        message: `ORDER NEW ${nextOrder.symbol} ${nextOrder.side} ${formatNumber(nextOrder.qty, 4)} @ ${nextOrder.price ?? "mkt"} | ${nextOrder.status}`,
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
                        message: `ORDER CLOSED ${prevOrder.symbol} ${prevOrder.side} ${formatNumber(prevOrder.qty, 4)} | ${prevOrder.status}`,
                    });
                }
            }
            orderSnapshotRef.current = nextOrders;
        }
        else {
            const msg = asErrorMessage(ordersRes.reason);
            setOrdersError(msg);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (executionsRes.status === "fulfilled") {
            const list = extractList(executionsRes.value);
            const execSeen = execSeenRef.current;
            const nextTrades = list.map((t) => {
                const price = toNumber(t?.execPrice ?? t?.price);
                const qty = toNumber(t?.execQty ?? t?.qty);
                const value = toNumber(t?.execValue ?? t?.value);
                const fee = toNumber(t?.execFee ?? t?.fee);
                return {
                    id: String(t?.execId ?? t?.tradeId ?? ""),
                    symbol: String(t?.symbol ?? ""),
                    side: (t?.side ?? "Buy"),
                    price: Number.isFinite(price) ? price : Number.NaN,
                    qty: Number.isFinite(qty) ? qty : Number.NaN,
                    value: Number.isFinite(value) ? value : Number.NaN,
                    fee: Number.isFinite(fee) ? fee : Number.NaN,
                    time: toIso(t?.execTime ?? t?.transactTime ?? t?.createdTime) || "",
                };
            });
            setTrades(nextTrades);
            const tradeLogs = list
                .map((t) => {
                const timestamp = toIso(t?.execTime ?? t?.transactTime ?? t?.createdTime);
                if (!timestamp)
                    return null;
                const symbol = String(t?.symbol ?? "");
                const side = String(t?.side ?? "");
                const qty = toNumber(t?.execQty ?? t?.qty);
                const price = toNumber(t?.execPrice ?? t?.price);
                const value = toNumber(t?.execValue ?? t?.value);
                const fee = toNumber(t?.execFee ?? t?.fee);
                const execType = String(t?.execType ?? t?.exec_type ?? "");
                const orderId = String(t?.orderId ?? t?.orderID ?? "");
                const orderLinkId = String(t?.orderLinkId ?? t?.orderLinkID ?? t?.clOrdId ?? "");
                const isMaker = typeof t?.isMaker === "boolean" ? t.isMaker : undefined;
                const parts = [];
                if (symbol &&
                    side &&
                    Number.isFinite(qty) &&
                    Number.isFinite(price)) {
                    parts.push(`${symbol} ${side} ${formatNumber(qty, 4)} @ ${formatNumber(price, 6)}`);
                }
                else if (symbol && side) {
                    parts.push(`${symbol} ${side}`);
                }
                if (Number.isFinite(value)) {
                    parts.push(`value ${formatNumber(value, 4)}`);
                }
                if (Number.isFinite(fee)) {
                    parts.push(`fee ${formatNumber(fee, 4)}`);
                }
                if (execType)
                    parts.push(`type ${execType}`);
                if (orderId)
                    parts.push(`order ${orderId}`);
                if (orderLinkId)
                    parts.push(`link ${orderLinkId}`);
                if (typeof isMaker === "boolean") {
                    parts.push(isMaker ? "maker" : "taker");
                }
                const message = parts.filter(Boolean).join(" | ");
                if (!message)
                    return null;
                const id = String(t?.execId ?? t?.tradeId ?? `${symbol}-${timestamp}`);
                if (execSeen.has(id))
                    return null;
                execSeen.add(id);
                return {
                    id,
                    timestamp,
                    action: "SYSTEM",
                    message,
                };
            })
                .filter((entry) => Boolean(entry));
            if (tradeLogs.length) {
                addLogEntries(tradeLogs);
            }
            else {
                setLogEntries((prev) => prev ?? []);
            }
            setLastSuccessAt(now);
        }
        else {
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
    }, [addLogEntries, fetchJson, refreshDiagnosticsFromDecisions, useTestnet]);
    const refreshSlow = useCallback(async () => {
        if (slowPollRef.current)
            return;
        slowPollRef.current = true;
        const now = Date.now();
        const results = await Promise.allSettled([
            fetchJson("/wallet"),
            fetchJson("/closed-pnl", { limit: "200" }),
            fetchJson("/reconcile"),
        ]);
        let sawError = false;
        const newLogs = [];
        const [walletRes, closedPnlRes, reconcileRes] = results;
        if (walletRes.status === "fulfilled") {
            const list = extractList(walletRes.value);
            const row = list[0] ?? {};
            const totalEquity = toNumber(row?.totalEquity ?? row?.totalWalletBalance);
            const availableBalance = toNumber(row?.totalAvailableBalance ?? row?.availableBalance);
            const totalWalletBalance = toNumber(row?.totalWalletBalance);
            setWalletSnapshot({
                totalEquity,
                availableBalance,
                totalWalletBalance,
            });
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(walletRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (closedPnlRes.status === "fulfilled") {
            const list = extractList(closedPnlRes.value);
            const records = list
                .map((r) => {
                const ts = toNumber(r?.execTime ?? r?.updatedTime ?? r?.createdTime);
                const pnl = toNumber(r?.closedPnl ?? r?.realisedPnl);
                const symbol = String(r?.symbol ?? "");
                if (!symbol || !Number.isFinite(ts) || !Number.isFinite(pnl))
                    return null;
                return { symbol, pnl, ts };
            })
                .filter((r) => Boolean(r));
            const map = {};
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
            const pnlSeen = pnlSeenRef.current;
            for (const r of records) {
                const id = `pnl:${r.symbol}:${r.ts}`;
                if (pnlSeen.has(id))
                    continue;
                pnlSeen.add(id);
                newLogs.push({
                    id,
                    timestamp: new Date(r.ts).toISOString(),
                    action: "SYSTEM",
                    message: `PNL ${r.symbol} ${r.pnl >= 0 ? "+" : ""}${r.pnl.toFixed(2)}`,
                });
            }
            setLastSuccessAt(now);
        }
        else {
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
                if (!label)
                    continue;
                const severity = String(diff?.severity ?? "").toUpperCase();
                newLogs.push({
                    id: `reconcile:${sym}:${label}:${now}`,
                    timestamp: new Date(now).toISOString(),
                    action: severity === "HIGH" ? "ERROR" : "STATUS",
                    message: `RECONCILE ${sym} ${label}`,
                });
            }
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(reconcileRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
        if (newLogs.length) {
            addLogEntries(newLogs);
        }
        else {
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
            if (!alive)
                return;
            await refreshFast();
        };
        const tickSlow = async () => {
            if (!alive)
                return;
            await refreshSlow();
        };
        const fastId = setInterval(tickFast, 1000);
        const slowId = setInterval(tickSlow, 10000);
        tickFast();
        tickSlow();
        return () => {
            alive = false;
            clearInterval(fastId);
            clearInterval(slowId);
        };
    }, [authToken, refreshFast, refreshSlow]);
    async function autoTrade(signal) {
        if (!authToken)
            throw new Error("missing_auth_token");
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
        };
        await sendIntent(intent, { authToken, useTestnet });
    }
    const handleDecision = useCallback((symbol, decision) => {
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
        if (!signal)
            return;
        const signalId = String(signal.id ?? `${symbol}-${now}`);
        if (signalSeenRef.current.has(signalId))
            return;
        signalSeenRef.current.add(signalId);
        const intent = signal.intent;
        const entry = toNumber(intent?.entry);
        const sl = toNumber(intent?.sl);
        const tp = toNumber(intent?.tp);
        const side = String(intent?.side ?? "").toLowerCase() === "buy" ? "Buy" : "Sell";
        const timestamp = signal.createdAt || new Date(now).toISOString();
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
        if (signal.message)
            msgParts.push(signal.message);
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
        const blockReasons = [];
        const hardEnabled = context.settings.enableHardGates !== false;
        if (hardEnabled) {
            if (!context.engineOk && isGateEnabled("Engine ok")) {
                blockReasons.push("Engine ok");
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
            if (context.hasOrders && isGateEnabled("Orders clear")) {
                blockReasons.push("Orders clear");
            }
            if (context.settings.requireConfirmationInAuto &&
                isGateEnabled("Confirm required")) {
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
        const sizing = computeNotionalForSignal(entry, sl);
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
                    symbol: symbol,
                    side,
                    entryPrice: entry,
                    slPrice: sl,
                    tpPrices: Number.isFinite(tp) ? [tp] : [],
                    notionalUSDT: sizing.notional,
                });
                addLogEntries([
                    {
                        id: `signal:sent:${signalId}`,
                        timestamp: new Date().toISOString(),
                        action: "STATUS",
                        message: `${symbol} intent sent | qty ${formatNumber(sizing.qty, 6)} | notional ${formatNumber(sizing.notional, 2)}`,
                    },
                ]);
            }
            catch (err) {
                addLogEntries([
                    {
                        id: `signal:error:${signalId}`,
                        timestamp: new Date().toISOString(),
                        action: "ERROR",
                        message: `${symbol} intent failed: ${asErrorMessage(err)}`,
                    },
                ]);
            }
            finally {
                intentPendingRef.current.delete(symbol);
            }
        })();
    }, [
        addLogEntries,
        autoTrade,
        buildScanDiagnostics,
        computeNotionalForSignal,
        getSymbolContext,
        isGateEnabled,
    ]);
    useEffect(() => {
        handleDecisionRef.current = handleDecision;
    }, [handleDecision]);
    useEffect(() => {
        if (!authToken)
            return;
        signalSeenRef.current.clear();
        intentPendingRef.current.clear();
        decisionRef.current = {};
        setScanDiagnostics(null);
        const stop = startPriceFeed(WATCH_SYMBOLS, (symbol, decision) => {
            handleDecisionRef.current?.(symbol, decision);
        }, {
            useTestnet,
            timeframe: "1",
        });
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
    }, [addLogEntries, authToken, feedEpoch, useTestnet]);
    useEffect(() => {
        if (!authToken)
            return;
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
            if (now - lastHeartbeatRef.current < 60_000)
                return;
            lastHeartbeatRef.current = now;
            const scan = [];
            const manage = [];
            for (const symbol of WATCH_SYMBOLS) {
                const state = resolveSymbolState(symbol);
                if (state === "MANAGE")
                    manage.push(symbol);
                else
                    scan.push(symbol);
            }
            const parts = [];
            if (scan.length)
                parts.push(`scan: ${scan.join(", ")}`);
            if (manage.length)
                parts.push(`manage: ${manage.join(", ")}`);
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
    const systemState = useMemo(() => {
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
    const portfolioState = useMemo(() => {
        const totalEquity = walletSnapshot?.totalEquity ?? Number.NaN;
        const availableBalance = walletSnapshot?.availableBalance ?? Number.NaN;
        const totalWalletBalance = walletSnapshot?.totalWalletBalance ?? Number.NaN;
        const openPositions = Array.isArray(positions)
            ? positions.length
            : Number.NaN;
        const allocatedCapital = Array.isArray(positions)
            ? positions.reduce((sum, p) => {
                const size = toNumber(p.size ?? p.qty);
                const entry = toNumber(p.entryPrice);
                if (!Number.isFinite(size) || !Number.isFinite(entry))
                    return sum;
                return sum + Math.abs(size * entry);
            }, 0)
            : Number.NaN;
        const dailyPnl = Array.isArray(closedPnlRecords)
            ? closedPnlRecords.reduce((sum, r) => {
                const dayAgo = Date.now() - 24 * 60 * 60_000;
                if (r.ts < dayAgo)
                    return sum;
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
        void refreshSlow();
    }, [refreshSlow]);
    const manualClosePosition = useCallback(async (pos) => {
        if (!authToken)
            throw new Error("missing_auth_token");
        const sizeRaw = toNumber(pos.size ?? pos.qty);
        if (!Number.isFinite(sizeRaw) || sizeRaw <= 0) {
            throw new Error("invalid_position_qty");
        }
        const closeSide = String(pos.side).toLowerCase() === "buy" ? "Sell" : "Buy";
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
    }, [apiBase, authToken, refreshFast]);
    const updateSettings = useCallback((next) => {
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
        dynamicSymbols: null,
        settings,
        updateSettings,
        updateGateOverrides,
    };
}
