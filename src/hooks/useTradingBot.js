// hooks/useTradingBot.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendIntent } from "../api/botApi";
import { getApiBase } from "../engine/networkConfig";
const SETTINGS_STORAGE_KEY = "ai-matic-settings";
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
function asErrorMessage(err) {
    return err instanceof Error ? err.message : String(err ?? "unknown_error");
}
function extractList(data) {
    return data?.result?.list ?? data?.list ?? [];
}
export function useTradingBot(_mode, useTestnet = false, authToken) {
    const [settings, setSettings] = useState(() => loadStoredSettings() ?? DEFAULT_SETTINGS);
    const apiBase = useMemo(() => getApiBase(Boolean(useTestnet)), [useTestnet]);
    const [positions, setPositions] = useState(null);
    const [orders, setOrders] = useState(null);
    const [trades, setTrades] = useState(null);
    const [logEntries, setLogEntries] = useState(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState(null);
    const [closedPnlRecords, setClosedPnlRecords] = useState(null);
    const [walletSnapshot, setWalletSnapshot] = useState(null);
    const [ordersError, setOrdersError] = useState(null);
    const [systemError, setSystemError] = useState(null);
    const [recentErrors, setRecentErrors] = useState([]);
    const [lastLatencyMs, setLastLatencyMs] = useState(null);
    const [lastSuccessAt, setLastSuccessAt] = useState(null);
    const pollRef = useRef(false);
    useEffect(() => {
        persistSettings(settings);
    }, [settings]);
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
    const refreshAll = useCallback(async () => {
        if (pollRef.current)
            return;
        pollRef.current = true;
        const now = Date.now();
        const results = await Promise.allSettled([
            fetchJson("/positions"),
            fetchJson("/orders", { limit: "50" }),
            fetchJson("/executions", { limit: "50" }),
            fetchJson("/wallet"),
            fetchJson("/closed-pnl", { limit: "200" }),
        ]);
        let sawError = false;
        const [positionsRes, ordersRes, executionsRes, walletRes, closedPnlRes,] = results;
        if (positionsRes.status === "fulfilled") {
            const list = extractList(positionsRes.value);
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
            setLastSuccessAt(now);
        }
        if (ordersRes.status === "fulfilled") {
            const list = extractList(ordersRes.value);
            const next = list
                .map((o) => {
                const qty = toNumber(o?.qty ?? o?.orderQty ?? o?.leavesQty);
                const price = toNumber(o?.price);
                return {
                    orderId: String(o?.orderId ?? o?.orderID ?? o?.id ?? ""),
                    symbol: String(o?.symbol ?? ""),
                    side: (o?.side ?? "Buy"),
                    qty: Number.isFinite(qty) ? qty : Number.NaN,
                    price: Number.isFinite(price) ? price : null,
                    status: String(o?.orderStatus ?? o?.order_status ?? o?.status ?? ""),
                    createdTime: toIso(o?.createdTime ?? o?.created_at) || "",
                };
            })
                .filter((o) => Boolean(o.orderId));
            setOrders(next);
            setOrdersError(null);
            setLastSuccessAt(now);
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
            setLogEntries(nextTrades
                .filter((t) => Boolean(t.id && t.time) &&
                Number.isFinite(t.qty) &&
                Number.isFinite(t.price))
                .map((t) => ({
                id: t.id,
                timestamp: t.time,
                action: "SYSTEM",
                message: `${t.symbol} ${t.side} ${t.qty} @ ${t.price}`,
            })));
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(executionsRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
        }
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
            setLastSuccessAt(now);
        }
        else {
            const msg = asErrorMessage(closedPnlRes.reason);
            setSystemError(msg);
            setRecentErrors((prev) => [msg, ...prev].slice(0, 5));
            sawError = true;
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
            if (!alive)
                return;
            await refreshAll();
        };
        const id = setInterval(tick, 2500);
        tick();
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, [authToken, refreshAll]);
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
        void refreshAll();
    }, [refreshAll]);
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
        await refreshAll();
        return true;
    }, [apiBase, authToken, refreshAll]);
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
        refreshTestnetOrders: refreshAll,
        assetPnlHistory,
        resetPnlHistory,
        scanDiagnostics: null,
        manualClosePosition,
        dynamicSymbols: null,
        settings,
        updateSettings,
    };
}
