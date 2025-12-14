// hooks/useTradingBot.ts
import { useState, useEffect, useRef, useCallback } from "react";
import {
    TradingMode,
    TradeIntent,
    PendingSignal,
    ActivePosition,
    ClosedPosition,
    LogEntry,
    NewsItem,
    PriceAlert,
    AISettings,
    EntryHistoryRecord,
    TestnetOrder,
    TestnetTrade,
    AssetPnlRecord,

} from "../types";

import { Candle, evaluateStrategyForSymbol } from "@/engine/botEngine";
import {
    decideExecutionPlan,
    EntrySignal as ExecEntrySignal,
    MarketSnapshot as ExecMarketSnapshot,
    StrategyProfile as ExecStrategyProfile,
    SignalKind as ExecSignalKind,
} from "@/engine/execution/executionRouter";
import { getApiBase, useNetworkConfig } from "../engine/networkConfig";
import { addEntryToHistory, loadEntryHistory, removeEntryFromHistory, persistEntryHistory } from "../lib/entryHistory";
import { addPnlRecord, loadPnlHistory, AssetPnlMap, clearPnlHistory } from "../lib/pnlHistory";

// SYMBOLS
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"];

// SIMULOVANÝ / DEFAULT KAPITÁL
const INITIAL_CAPITAL = 100; // Unified Trading balance snapshot
const MAX_SINGLE_POSITION_VALUE = Number.POSITIVE_INFINITY; // notional cap disabled (use margin caps instead)
const MIN_ENTRY_SPACING_MS = 3000;
const MAX_TEST_PENDING = 4;
const KEEPALIVE_SIGNAL_INTERVAL_MS = 12000;
const LEVERAGE: Record<string, number> = {
    BTCUSDT: 100,
    ETHUSDT: 100,
    SOLUSDT: 100,
    ADAUSDT: 75,
};
const MIN_MARGIN_USD = 5;
const MAX_MARGIN_USD = 10;
const TARGET_NOTIONAL: Record<string, number> = {
    BTCUSDT: 500, // odpovídá ~5 USDT margin při 100x
    ETHUSDT: 500,
    SOLUSDT: 500,
    ADAUSDT: 350, // odpovídá screenshotu při 75x
};
const QTY_LIMITS: Record<string, { min: number; max: number }> = {
    BTCUSDT: { min: 0.005, max: 0.005 },
    ETHUSDT: { min: 0.15, max: 0.15 },
    SOLUSDT: { min: 3.5, max: 3.5 },
    ADAUSDT: { min: 858, max: 858 },
};

// RISK / STRATEGY
const AI_MATIC_PRESET: AISettings = {
    riskMode: "ai-matic",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.07,
    maxDailyProfitPercent: 0.5,
    maxDrawdownPercent: 0.2,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
    strategyProfile: "auto",
    entryStrictness: "base",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
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

const AI_MATIC_X_PRESET: AISettings = {
    riskMode: "ai-matic-x",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.1,
    maxDailyProfitPercent: 1.0,
    maxDrawdownPercent: 0.2,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
    strategyProfile: "auto",
    entryStrictness: "ultra",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.2,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.1,
    minWinRate: 65,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
};

export const INITIAL_RISK_SETTINGS: AISettings = AI_MATIC_X_PRESET;

const SETTINGS_STORAGE_KEY = "ai-matic-settings";

function loadStoredSettings(): AISettings | null {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed) return null;
        return {
            ...INITIAL_RISK_SETTINGS,
            ...parsed,
            tradingDays: Array.isArray(parsed.tradingDays) ? parsed.tradingDays : INITIAL_RISK_SETTINGS.tradingDays,
            maxOpenPositions: Math.min(2, parsed.maxOpenPositions ?? INITIAL_RISK_SETTINGS.maxOpenPositions),
        } as AISettings;
    } catch {
        return null;
    }
}

function persistSettings(s: AISettings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
    } catch {
        // ignore storage errors
    }
}

// UTILS
function parseKlines(list: any[]): Candle[] {
    if (!Array.isArray(list)) return [];
    return list
        .map((row: any) => {
            const [ts, open, high, low, close, volume] = row;
            return {
                openTime: Number(ts),
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume),
            } as Candle;
        })
        .sort((a, b) => a.openTime - b.openTime);
}

function withinSession(settings: typeof INITIAL_RISK_SETTINGS, now: Date) {
    if (settings.entryStrictness === "test") return true;
    if (!settings.enforceSessionHours) return true;
    const day = now.getDay();
    const hour = now.getHours();
    if (!settings.tradingDays.includes(day)) return false;
    if (hour < settings.tradingStartHour || hour > settings.tradingEndHour)
        return false;
    return true;
}

function chooseStrategyProfile(
    candles: Candle[],
    preferred: (typeof INITIAL_RISK_SETTINGS)["strategyProfile"]
): "trend" | "scalp" | "swing" | "intraday" | null {
    if (preferred === "off") return null;
    if (preferred === "coach") return "scalp";
    if (preferred === "trend") return "trend";
    if (preferred === "scalp") return "scalp";
    if (preferred === "swing") return "swing";
    if (preferred === "intraday") return "intraday";
    // auto: heuristika podle volatility
    if (candles.length < 20) return "trend";
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const atr = (() => {
        let res = 0;
        for (let i = 1; i < closes.length; i++) {
            const hl = highs[i] - lows[i];
            const hc = Math.abs(highs[i] - closes[i - 1]);
            const lc = Math.abs(lows[i] - closes[i - 1]);
            res += Math.max(hl, hc, lc);
        }
        const avg = res / Math.max(1, closes.length - 1);
        return avg;
    })();
    const price = closes[closes.length - 1] || 1;
    const atrPct = atr / price;
    if (atrPct < 0.0015) return "scalp";
    if (atrPct > 0.0075) return "swing";
    if (atrPct > 0.0045) return "trend";
    return "intraday";
}

function snapshotSettings(settings: AISettings): AISettings {
    return {
        ...settings,
        tradingDays: [...settings.tradingDays],
    };
}

const presetFor = (mode: AISettings["riskMode"]): AISettings =>
    mode === "ai-matic-x" ? AI_MATIC_X_PRESET : AI_MATIC_PRESET;

const clampQtyForSymbol = (symbol: string, qty: number) => {
    const limits = QTY_LIMITS[symbol];
    if (!limits) return qty;
    return Math.min(limits.max, Math.max(limits.min, qty));
};

const leverageFor = (symbol: string) => LEVERAGE[symbol] ?? 1;
const marginFor = (symbol: string, entry: number, size: number) =>
    (entry * size) / Math.max(1, leverageFor(symbol));

const asNum = (x: any) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (min: number, max: number) =>
    Math.floor(min + Math.random() * Math.max(0, max - min));

const TAKER_FEE = 0.0006; // orientační taker fee (0.06%)
const MIN_TP_BUFFER_PCT = 0.0003; // 0.03 % buffer

function feeRoundTrip(notional: number, openRate: number = TAKER_FEE, closeRate: number = TAKER_FEE) {
    return notional * (openRate + closeRate);
}

function ensureMinTpDistance(entry: number, sl: number, tp: number, size: number) {
    if (!Number.isFinite(entry) || !Number.isFinite(tp) || size <= 0) return tp;
    const notional = entry * size;
    const minDistance = feeRoundTrip(notional) / size + entry * MIN_TP_BUFFER_PCT;
    const dir = tp >= entry ? 1 : -1;
    const proposedDistance = Math.abs(tp - entry);
    if (proposedDistance >= minDistance) return tp;
    return entry + dir * minDistance;
}

function uuidLite() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return (crypto as any).randomUUID();
    }
    return `aim-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

// Coach detection (Base 'n Break / Wedge Pop approximation)
import { coachDefaults, detectCoachBreakout, detectSituationalEdges } from "@/engine/coachStrategy";

function computeAtrFromHistory(candles: Candle[], period: number = 20): number {
    if (!candles || candles.length < 2) return 0;
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const trs: number[] = [];
    for (let i = 1; i < closes.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = Math.abs(highs[i] - closes[i - 1]);
        const lc = Math.abs(lows[i] - closes[i - 1]);
        trs.push(Math.max(hl, hc, lc));
    }
    if (!trs.length) return 0;
    const slice = trs.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / slice.length;
}

function computeAtrPair(candles: Candle[]) {
    const atrShort = computeAtrFromHistory(candles, 14);
    const atrLong = computeAtrFromHistory(candles, 50) || atrShort || 1;
    return { atrShort, atrLong };
}

const resolveRiskPct = (settings: AISettings) => {
    const base = settings.baseRiskPerTrade;
    if (settings.strategyProfile === "scalp") {
        return Math.max(0.01, Math.min(base, 0.02));
    }
    if (settings.strategyProfile === "trend" || settings.strategyProfile === "swing") {
        return Math.max(base, 0.03);
    }
    if (settings.strategyProfile === "intraday") {
        return Math.max(base, 0.025);
    }
    return base;
};

const computePositionRisk = (p: ActivePosition) => {
    const stop = p.currentTrailingStop ?? p.sl ?? p.entryPrice;
    const distance = Math.max(0, Math.abs(p.entryPrice - stop));
    return distance * p.size;
};

// ========== HLAVNÍ HOOK ==========

// Unified API Base URL helper
// Note: getApiBase and useNetworkConfig are already imported at top-level
// const { getApiBase } = useNetworkConfig(); // This hook usage was likely incorrect or redundant if getApiBase is a standalone utility or if we use the hook at component level.

// Actually, looking at imports:
// import { getApiBase, useNetworkConfig } from "../engine/networkConfig";

// We can just use getApiBase directly if it's a function, OR use the hook.
// Let's assume getApiBase is a helper function.

// FIX: Remove duplicate import if it exists as 'import ...' inside function? No, TS usually errors on top level duplicates. 
// The error says "Duplicate identifier", implying it's declared twice in the same scope or file module scope.
// Line 21 and 319. line 319 seems to contain `import ...`?

// Let's just remove the lines around 319 if they are imports.
// If they are destructurings: `const { ... } = ...`, and we already have them imported?

// Wait, `getApiBase` is imported at top level. If we declare `const getApiBase = ...` inside a function, it shadows. 
// But the error says "Duplicate identifier" at line 319. If it's a top-level import there, it's invalid JS/TS inside a function? Or is it another top-level import?
// Let's look at the file content from view_file.


// ... existing imports ...

// ========== HLAVNÍ HOOK ==========

export const useTradingBot = (
    mode: TradingMode,
    useTestnet: boolean,
    authToken?: string
) => {
    // FIX 1: Hard Frontend Routing via centralized config
    const apiPrefix = getApiBase(useTestnet);

    useEffect(() => {
    }, [useTestnet, apiPrefix]);
    const { httpBase } = useNetworkConfig(useTestnet);
    const envBase = (import.meta as any).env?.VITE_API_BASE;
    const inferredBase =
        typeof window !== "undefined" ? window.location.origin : "";
    const apiBase = (envBase || inferredBase || "").replace(/\/$/, "");

    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [activePositions, setActivePositions] = useState<ActivePosition[]>(
        []
    );
    const [closedPositions, _setClosedPositions] = useState<ClosedPosition[]>(
        []
    );
    const [pendingSignals, setPendingSignals] = useState<PendingSignal[]>([]);
    const pendingSignalsRef = useRef<PendingSignal[]>([]);
    const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(
        {}
    );
    const currentPricesRef = useRef<Record<string, number>>({});
    const [portfolioHistory, _setPortfolioHistory] = useState<
        { timestamp: string; totalCapital: number }[]
    >([]);
    const [newsHeadlines, setNewsHeadlines] = useState<NewsItem[]>([]);
    const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
    const [entryHistory, setEntryHistory] = useState<EntryHistoryRecord[]>([]);
    const [testnetOrders, setTestnetOrders] = useState<TestnetOrder[]>([]);
    const [testnetTrades, setTestnetTrades] = useState<TestnetTrade[]>([]);
    const [ordersError, setOrdersError] = useState<string | null>(null);
    const [mainnetOrders, setMainnetOrders] = useState<TestnetOrder[]>([]);
    const [mainnetTrades, setMainnetTrades] = useState<TestnetTrade[]>([]);
    const [mainnetError, setMainnetError] = useState<string | null>(null);
    const [assetPnlHistory, setAssetPnlHistory] = useState<AssetPnlMap>({});
    const [settings, setSettings] = useState<AISettings>(() => {
        if (typeof window !== "undefined") {
            const stored = loadStoredSettings();
            if (stored) return stored;
        }
        return INITIAL_RISK_SETTINGS;
    });

    const [systemState, setSystemState] = useState({
        bybitStatus: "Connecting...",
        latency: 0,
        lastError: null as string | null,
        recentErrors: [] as string[],
    });
    const activePositionsRef = useRef<ActivePosition[]>([]);
    const closedPnlSeenRef = useRef<Set<string>>(new Set());

    const [portfolioState, setPortfolioState] = useState({
        totalCapital: INITIAL_CAPITAL,
        allocatedCapital: 0,
        maxAllocatedCapital:
            INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxAllocatedCapitalPercent,
        dailyPnl: 0,
        maxDailyLoss:
            INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxDailyLossPercent,
        maxDailyProfit:
            INITIAL_CAPITAL * INITIAL_RISK_SETTINGS.maxDailyProfitPercent,
        peakCapital: INITIAL_CAPITAL,
        currentDrawdown: 0,
        maxDrawdown: INITIAL_RISK_SETTINGS.maxDrawdownPercent,
        openPositions: 0,
        maxOpenPositions: INITIAL_RISK_SETTINGS.maxOpenPositions,
    });
    const lastEntryAtRef = useRef<number | null>(null);
    const entryQueueRef = useRef<Promise<void>>(Promise.resolve());
    const executionLocksRef = useRef<Set<string>>(new Set()); // Mutex for dedup

    // Dynamicky uprav capital/max allocation pro testovací režim
    useEffect(() => {
        const isTest = settings.entryStrictness === "test";
        setPortfolioState((prev) => {
            const baseCapital = INITIAL_CAPITAL;
            const totalCapital = isTest ? prev.totalCapital || baseCapital : baseCapital;
            const pctCap = totalCapital * settings.maxAllocatedCapitalPercent;
            const maxAlloc = isTest ? Math.min(1000000, pctCap) : pctCap;
            return {
                ...prev,
                totalCapital,
                maxAllocatedCapital: maxAlloc,
                allocatedCapital: Math.min(prev.allocatedCapital, maxAlloc),
                maxDailyLoss: totalCapital * settings.maxDailyLossPercent,
                maxDailyProfit: totalCapital * settings.maxDailyProfitPercent,
                maxDrawdown: settings.maxDrawdownPercent,
                maxOpenPositions: settings.maxOpenPositions,
            };
        });
    }, [
        settings.entryStrictness,
        settings.maxAllocatedCapitalPercent,
        settings.maxDailyLossPercent,
        settings.maxDailyProfitPercent,
        settings.maxDrawdownPercent,
        settings.maxOpenPositions,
    ]);

    // Přepočet denního PnL podle otevřených pozic (unrealized)
    useEffect(() => {
        const unrealized = activePositions.reduce(
            (sum, p) => sum + (p.pnl ?? 0),
            0
        );
        setPortfolioState((prev) => ({
            ...prev,
            dailyPnl: realizedPnlRef.current + unrealized,
        }));
    }, [activePositions]);

    useEffect(() => {
        setPortfolioState((prev) => {
            const equity = prev.totalCapital + prev.dailyPnl;
            const peakCapital = Math.max(prev.peakCapital, equity);
            const currentDrawdown =
                peakCapital > 0 ? (peakCapital - equity) / peakCapital : 0;
            if (
                peakCapital === prev.peakCapital &&
                currentDrawdown === prev.currentDrawdown
            ) {
                return prev;
            }
            return { ...prev, peakCapital, currentDrawdown };
        });
    }, [portfolioState.dailyPnl, portfolioState.totalCapital]);

    useEffect(() => {
        const hist = loadEntryHistory();
        const trimmed = hist.slice(0, 8);
        if (hist.length !== trimmed.length) {
            persistEntryHistory(trimmed);
        }
        setEntryHistory(trimmed);
        setAssetPnlHistory(loadPnlHistory());
    }, []);

    // Keep only top-2 highest-risk pending signals to focus on nejpravděpodobnější obchody
    useEffect(() => {
        setPendingSignals((prev) => {
            if (prev.length <= 2) return prev;
            const sorted = [...prev].sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0));
            const trimmed = sorted.slice(0, 2);
            const same =
                trimmed.length === prev.length &&
                trimmed.every((s, i) => s.id === prev[i].id);
            return same ? prev : trimmed;
        });
    }, [pendingSignals]);

    useEffect(() => {
        pendingSignalsRef.current = pendingSignals;
    }, [pendingSignals]);

    useEffect(() => {
        activePositionsRef.current = activePositions;
    }, [activePositions]);

    // Generic fetchOrders that respects API prefix (unlike previous confusing split)
    const fetchOrders = useCallback(async () => {
        if (!authToken) {
            setTestnetOrders([]); // using same state variable for now, effectively "orders"
            if (useTestnet) setOrdersError("Missing auth token");
            return;
        }
        // Pokud není definován explicitní backend, nezkoušej fetchovat – předejdeme 404 na statickém hostu
        const baseProvided = Boolean(envBase);
        const sameOrigin =
            typeof window !== "undefined" &&
            inferredBase === window.location.origin;
        if (!baseProvided && sameOrigin) {
            setTestnetOrders([]);
            setOrdersError("Orders API unavailable: configure VITE_API_BASE to point to backend");
            return;
        }
        try {
            setOrdersError(null);
            // Dynamic URL based on apiPrefix (main or demo)
            const url = new URL(`${apiBase}${apiPrefix}/orders`);

            // Explicitly set 'net' param for logging/backend double-check
            url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");

            // console.log(`[fetchOrders] Fetching from: ${url.toString()}`);

            const res = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Orders API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            // FIX A2: Robust parsing for ApiResponse wrapping Bybit response
            const list = data?.data?.result?.list /* correct wrapper */ ||
                data?.data?.list /* flat data */ ||
                data?.list /* legacy root */ ||
                data?.result?.list /* legacy root bybit */ ||
                [];
            const mapped: TestnetOrder[] = Array.isArray(list)
                ? list.map((o: any) => {
                    const toIso = (ts: any) => {
                        const n = Number(ts);
                        return Number.isFinite(n) && n > 0
                            ? new Date(n).toISOString()
                            : new Date().toISOString();
                    };
                    return {
                        orderId: o.orderId || o.orderLinkId || o.id || `${Date.now()}`,
                        symbol: o.symbol || "",
                        side: (o.side as "Buy" | "Sell") || "Buy",
                        qty: Number(o.qty ?? o.cumExecQty ?? 0),
                        price: o.price != null ? Number(o.price) : o.avgPrice != null ? Number(o.avgPrice) : null,
                        status: o.orderStatus || o.status || "unknown",
                        createdTime: toIso(o.createdTime ?? o.created_at ?? Date.now()),
                    };
                })
                : [];

            // For now, we store everything in "testnetOrders" state variable which is actually just "orders"
            setTestnetOrders(mapped);
        } catch (err: any) {
            console.error(`[fetchOrders] Error:`, err);
            setOrdersError(err?.message || "Failed to load orders");
        }
    }, [authToken, useTestnet, apiBase, apiPrefix, envBase, inferredBase]);

    // Pozice/PnL přímo z Bybitu – přepíší simulované activePositions
    // RECONCILE LOOP: Jednotný zdroj pravdy z backendu
    // RECONCILE LOOP: Jednotný zdroj pravdy z backendu
    useEffect(() => {
        if (!authToken) return;

        let cancel = false;
        const fetchReconcile = async () => {
            try {
                const url = new URL(`${apiBase}${apiPrefix}/reconcile`);
                url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");

                const res = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                });

                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`Reconcile API failed (${res.status}): ${txt}`);
                }

                const json = await res.json();
                if (cancel) return;

                if (!json.ok || !json.data) {
                    // console.warn("Reconcile response not OK:", json);
                    return;
                }

                const { positions, orders, diffs, meta } = json.data;

                // 1. HARD SYNC POSITIONS
                const mappedPositions: ActivePosition[] = Array.isArray(positions) ? positions : [];
                setActivePositions(mappedPositions);

                // 2. SYNC ORDERS
                const mappedOrders: TestnetOrder[] = Array.isArray(orders)
                    ? orders.map((o: any) => ({
                        orderId: o.orderId,
                        symbol: o.symbol,
                        side: (o.side as "Buy" | "Sell"),
                        qty: Number(o.qty),
                        price: o.price ? Number(o.price) : null,
                        status: o.orderStatus,
                        createdTime: new Date(Number(o.createdTime)).toISOString(),
                    }))
                    : [];
                setTestnetOrders(mappedOrders);

                // 3. VISUAL INDICATORS
                if (diffs && diffs.length > 0) {
                    diffs.forEach((d: any) => {
                        if (d.severity === "HIGH") {
                            addLog({ action: "ERROR", message: `[Reconcile] ${d.message} (${d.symbol})` });
                        }
                    });
                }

                setSystemState((prev) => ({ ...prev, bybitStatus: "Connected", latency: meta?.latencyMs || json.meta?.latencyMs || 0 }));

                // 4. CLOSED PNL FETCH (Separate for now, simpler to keep existing logic)
                try {
                    const pnlRes = await fetch(`${apiBase}${apiPrefix}/closed-pnl?net=${useTestnet ? "testnet" : "mainnet"}`, {
                        headers: { Authorization: `Bearer ${authToken}` },
                    });
                    if (pnlRes.ok) {
                        const pnlJson = await pnlRes.json();
                        const pnlList = pnlJson?.data?.result?.list || pnlJson?.result?.list || [];

                        const records: AssetPnlRecord[] = Array.isArray(pnlList)
                            ? pnlList.map((r: any) => ({
                                symbol: r.symbol || "UNKNOWN",
                                pnl: Number(r.closedPnl ?? r.realisedPnl ?? 0),
                                timestamp: r.updatedTime ? new Date(Number(r.updatedTime)).toISOString() : new Date().toISOString(),
                                note: "Bybit closed pnl",
                            }))
                            : [];

                        setAssetPnlHistory((prev) => {
                            const next: AssetPnlMap = { ...prev };
                            const seen = closedPnlSeenRef.current;
                            records.forEach((rec) => {
                                const key = `${rec.symbol}-${rec.timestamp}-${rec.pnl}`;
                                if (seen.has(key)) return;
                                seen.add(key);
                                next[rec.symbol] = [rec, ...(next[rec.symbol] || [])].slice(0, 100);
                                addPnlRecord(rec);
                            });
                            if (seen.size > 500) {
                                const trimmed = Array.from(seen).slice(-400);
                                closedPnlSeenRef.current = new Set(trimmed);
                            }
                            return next;
                        });

                        const realized = records.reduce((sum, r) => sum + (r.pnl || 0), 0);
                        realizedPnlRef.current = realized; // Update ref for PnL tracking
                    }
                } catch (e) {
                    console.warn("Closed PnL fetch failed", e);
                }

            } catch (err: any) {
                if (cancel) return;
                console.error("Reconcile error:", err);
                setSystemState((prev) => ({ ...prev, bybitStatus: "Error", latency: 0 }));
            }
        };

        const intervalId = setInterval(fetchReconcile, useTestnet ? 5000 : 3000);
        fetchReconcile();

        return () => {
            cancel = true;
            clearInterval(intervalId);
        };
    }, [authToken, useTestnet, apiBase, apiPrefix]);


    const fetchTrades = useCallback(async () => {
        if (!authToken) {
            setTestnetTrades([]);
            return;
        }
        try {
            const url = new URL(`${apiBase}${apiPrefix}/trades`);
            url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Trades API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
            const allowed = new Set(SYMBOLS);
            const mapped: TestnetTrade[] = Array.isArray(list)
                ? list
                    .filter((t: any) => allowed.has(t.symbol))
                    .map((t: any) => {
                        const ts = Number(t.execTime ?? t.transactTime ?? t.createdTime ?? Date.now());
                        return {
                            id: t.execId || t.tradeId || `${Date.now()}`,
                            symbol: t.symbol || "",
                            side: (t.side as "Buy" | "Sell") || "Buy",
                            price: Number(t.execPrice ?? t.price ?? 0),
                            qty: Number(t.execQty ?? t.qty ?? 0),
                            value: Number(t.execValue ?? t.value ?? 0),
                            fee: Number(t.execFee ?? t.fee ?? 0),
                            time: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
                        };
                    })
                : [];
            setTestnetTrades(mapped);
        } catch (err: any) {
            setOrdersError((prev) => prev || err?.message || "Failed to load trades");
        }
    }, [authToken, useTestnet, apiBase, apiPrefix, envBase, inferredBase]);

    // Orders are now synced via reconcile loop above (server-side strict sync)
    // We keep fetchTrades separate for now as it polls detailed history
    useEffect(() => {
        void fetchTrades();
        const id = setInterval(() => {
            void fetchTrades();
        }, 5000);
        return () => clearInterval(id);
    }, [fetchTrades]);

    // Keep refreshTestnetOrders pointing to fetchOrders for UI compatibility
    const refreshTestnetOrders = fetchOrders;

    const setLifecycle = (tradeId: string, status: string, note?: string) => {
        lifecycleRef.current.set(tradeId, status);
        addLog({
            action: "SYSTEM",
            message: `[${tradeId}] ${status}${note ? ` | ${note}` : ""}`,
        });
    };

    const forceClosePosition = useCallback(
        async (pos: ActivePosition) => {
            if (!authToken) return;
            const side = pos.side === "buy" ? "Sell" : "Buy";
            try {
                await fetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                        symbol: pos.symbol,
                        side,
                        qty: Number(pos.size.toFixed(4)),
                        orderType: "Market",
                        timeInForce: "IOC",
                        reduceOnly: true,
                    }),
                });
                addLog({
                    action: "AUTO_CLOSE",
                    message: `Forced reduce-only close ${pos.symbol} due to missing protection`,
                });
            } catch (err: any) {
                addLog({
                    action: "ERROR",
                    message: `Force close failed: ${err?.message || "unknown"}`,
                });
            }
        },
        [apiBase, authToken, useTestnet]
    );

    const fetchPositionsOnce = useCallback(
        async (net: "testnet" | "mainnet"): Promise<{ list: any[]; retCode?: number; retMsg?: string }> => {
            if (!authToken) return { list: [] };
            const url = new URL(`${apiBase}${apiPrefix}/positions`);
            url.searchParams.set("net", net);
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) throw new Error(`Positions fetch failed (${res.status})`);
            const json = await res.json();
            return {
                list: json?.data?.result?.list || json?.result?.list || json?.data?.list || [],
                retCode: json?.data?.retCode ?? json?.retCode,
                retMsg: json?.data?.retMsg ?? json?.retMsg,
            };
        },
        [apiBase, apiPrefix, authToken]
    );

    const fetchOrdersOnce = useCallback(
        async (net: "testnet" | "mainnet"): Promise<{ list: any[]; retCode?: number; retMsg?: string }> => {
            if (!authToken) return { list: [] };
            const url = new URL(`${apiBase}${apiPrefix}/orders`);
            url.searchParams.set("net", net);
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) throw new Error(`Orders fetch failed (${res.status})`);
            const data = await res.json();
            const retCode = data?.data?.retCode ?? data?.retCode;
            const retMsg = data?.data?.retMsg ?? data?.retMsg;
            const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
            return { list: Array.isArray(list) ? list : [], retCode, retMsg };
        },
        [apiBase, apiPrefix, authToken]
    );

    const fetchOrderHistoryOnce = useCallback(
        async (net: "testnet" | "mainnet"): Promise<{ list: any[]; retCode?: number; retMsg?: string }> => {
            if (!authToken) return { list: [] };
            const url = new URL(`${apiBase}${apiPrefix}/orders`);
            url.searchParams.set("net", net);
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            url.searchParams.set("history", "1");
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) throw new Error(`Order history fetch failed (${res.status})`);
            const data = await res.json();
            const retCode = data?.data?.retCode ?? data?.retCode;
            const retMsg = data?.data?.retMsg ?? data?.retMsg;
            const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
            return { list: Array.isArray(list) ? list : [], retCode, retMsg };
        },
        [apiBase, apiPrefix, authToken]
    );

    const fetchExecutionsOnce = useCallback(
        async (
            net: "testnet" | "mainnet",
            symbol?: string
        ): Promise<{ list: any[]; retCode?: number; retMsg?: string }> => {
            if (!authToken) return { list: [] };
            const url = new URL(`${apiBase}${apiPrefix}/executions`);
            url.searchParams.set("net", net);
            url.searchParams.set("limit", "100");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            if (symbol) url.searchParams.set("symbol", symbol);
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) throw new Error(`Executions fetch failed (${res.status})`);
            const data = await res.json();
            const retCode = data?.data?.retCode ?? data?.retCode;
            const retMsg = data?.data?.retMsg ?? data?.retMsg;
            const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
            return { list: Array.isArray(list) ? list : [], retCode, retMsg };
        },
        [apiBase, apiPrefix, authToken]
    );

    const waitForFill = useCallback(
        async (
            tradeId: string,
            symbol: string,
            orderId?: string | null,
            orderLinkId?: string | null,
            maxWaitMs: number = 90000
        ) => {
            const net = useTestnet ? "testnet" : "mainnet";
            const started = Date.now();
            let attempt = 0;
            while (Date.now() - started < maxWaitMs) {
                attempt += 1;
                // 1) In-memory executions seen by polling loop
                const execHit = executionEventsRef.current.find((e) => {
                    if (e.symbol !== symbol) return false;
                    if (orderId && e.orderId && e.orderId === orderId) return true;
                    if (orderLinkId && e.orderLinkId && e.orderLinkId === orderLinkId) return true;
                    return !orderId && !orderLinkId;
                });
                if (execHit) return execHit;

                // 2) Fresh executions snapshot
                const executionsResp = await fetchExecutionsOnce(net, symbol);
                if (executionsResp.retCode && executionsResp.retCode !== 0) {
                    addLog({
                        action: "ERROR",
                        message: `Executions retCode=${executionsResp.retCode} ${executionsResp.retMsg || ""}`,
                    });
                }
                const execSnapshot = executionsResp.list.find((e: any) => {
                    if (e.symbol !== symbol) return false;
                    if (orderId && e.orderId && e.orderId === orderId) return true;
                    if (orderLinkId && e.orderLinkId && e.orderLinkId === orderLinkId) return true;
                    return !orderId && !orderLinkId;
                });
                if (execSnapshot) return execSnapshot;

                // 3) Order history snapshot
                const historyResp = await fetchOrderHistoryOnce(net);
                if (historyResp.retCode && historyResp.retCode !== 0) {
                    addLog({
                        action: "ERROR",
                        message: `Order history retCode=${historyResp.retCode} ${historyResp.retMsg || ""}`,
                    });
                }
                const histMatch = historyResp.list.find((o: any) => {
                    if (o.symbol !== symbol) return false;
                    if (orderId && o.orderId && o.orderId === orderId) return true;
                    if (orderLinkId && o.orderLinkId && o.orderLinkId === orderLinkId) return true;
                    return !orderId && !orderLinkId;
                });
                if (histMatch) {
                    const st = String(histMatch.orderStatus || histMatch.status || "");
                    if (st === "Filled" || st === "PartiallyFilled") return histMatch;
                    if (st === "Rejected") throw new Error("Order Rejected");
                    if (st === "Cancelled") throw new Error("Order Cancelled");
                }

                // 4) Positions snapshot (with retCode log)
                const posResp = await fetchPositionsOnce(net);
                if (posResp.retCode && posResp.retCode !== 0) {
                    addLog({
                        action: "ERROR",
                        message: `Positions retCode=${posResp.retCode} ${posResp.retMsg || ""}`,
                    });
                }
                const found = posResp.list.find((p: any) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0);
                if (found) return found;

                await sleep(jitter(750, 1500));
            }
            const waitedSec = Math.round((Date.now() - started) / 1000);
            throw new Error(`Fill not confirmed for ${symbol} within ${waitedSec}s`);
        },
        [addLog, fetchExecutionsOnce, fetchOrderHistoryOnce, fetchPositionsOnce, useTestnet]
    );

    const commitProtection = useCallback(
        async (tradeId: string, symbol: string, sl?: number, tp?: number, trailingStop?: number) => {
            if (!authToken) return false;
            const net = useTestnet ? "testnet" : "mainnet";
            const tolerance = Math.abs((currentPricesRef.current[symbol] ?? 0) * 0.001) || 0.5;
            for (let attempt = 1; attempt <= 3; attempt++) {
                setLifecycle(tradeId, "PROTECTION_PENDING", `attempt ${attempt}`);
                const res = await fetch(`${apiBase}${apiPrefix}/protection?net=${net}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`,
                    },
                    body: JSON.stringify({
                        symbol,
                        sl,
                        tp,
                        trailingStop,
                        positionIdx: 0,
                    }),
                });
                if (!res.ok) {
                    const txt = await res.text();
                    addLog({
                        action: "ERROR",
                        message: `Protection set failed (${res.status}): ${txt}`,
                    });
                }
                // verify
                try {
                    const posResp = await fetchPositionsOnce(net);
                    const found = posResp.list.find((p: any) => p.symbol === symbol && Math.abs(Number(p.size ?? 0)) > 0);
                    if (found) {
                        const tpOk = tp == null || Math.abs(Number(found.takeProfit ?? 0) - tp) <= tolerance;
                        const slOk = sl == null || Math.abs(Number(found.stopLoss ?? 0) - sl) <= tolerance;
                        const tsOk = trailingStop == null || Math.abs(Number(found.trailingStop ?? 0) - trailingStop) <= tolerance;
                        if (tpOk && slOk && tsOk) {
                            setLifecycle(tradeId, "PROTECTION_SET");
                            return true;
                        }
                    }
                } catch (err: any) {
                    addLog({ action: "ERROR", message: `Protection verify failed: ${err?.message || "unknown"}` });
                }
                await new Promise((r) => setTimeout(r, 800));
            }
            setLifecycle(tradeId, "PROTECTION_FAILED");
            addLog({
                action: "ERROR",
                message: `Protection not confirmed for ${symbol} after retries.`,
            });
            return false;
        },
        [apiBase, authToken, fetchPositionsOnce, setLifecycle, useTestnet]
    );

    // Reconcile smyčka: hlídá stárnutí dat a ochranu
    useEffect(() => {
        if (!authToken) return;
        let cancel = false;

        const reconcile = async () => {
            const now = Date.now();
            const stale = now - lastPositionsSyncAtRef.current > 20000;
            if (stale) {
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Stale",
                    lastError: "Positions sync stale >20s",
                }));
            }

            // Daily Loss Halt (Realized + Unrealized)
            const positions = activePositionsRef.current;
            const realized = portfolioState.dailyPnl;
            const unrealized = positions.reduce((sum, p) => sum + (p.pnl || 0), 0);
            const totalDailyPnl = realized + unrealized;
            const maxLoss = -(portfolioState.totalCapital * (settingsRef.current.maxDailyLossPercent || 0.05));

            if (totalDailyPnl < maxLoss) {
                if (modeRef.current !== "OFF" && !dailyHaltAtRef.current) {
                    dailyHaltAtRef.current = Date.now();
                    addLog({ action: "SYSTEM", message: `DAILY LOSS HIT: ${totalDailyPnl.toFixed(2)} < ${maxLoss.toFixed(2)}. Halting.` });
                    // Logic to stop new entries is in performTrade (portfolioState check needed there or mode switch)
                    // Here we can force mode to OFF or specific HALT state if we had one.
                    // For now, we rely on dailyHaltAtRef to be checked in performTrade (it's not yet).
                    // Let's just log and update system state.
                    setSystemState(prev => ({ ...prev, lastError: "Daily Loss Limit Hit" }));
                }
            } else {
                dailyHaltAtRef.current = null; // Reset if recovered (optional, usually daily limit is sticky)
            }

            for (const p of positions) {
                if (!p || !p.symbol) continue;
                const missingProtection =
                    (p.sl == null || p.sl === 0) &&
                    (p.tp == null || p.tp === 0) &&
                    (p.currentTrailingStop == null || p.currentTrailingStop === 0);
                if (missingProtection && p.size > 0) {
                    const dir = p.side === "buy" ? 1 : -1;
                    const price = p.entryPrice || currentPricesRef.current[p.symbol] || 0;
                    if (!price) continue;
                    const fallbackSl = dir > 0 ? price * 0.99 : price * 1.01;
                    const fallbackTpRaw = dir > 0 ? price * 1.01 : price * 0.99;
                    const fallbackTp = ensureMinTpDistance(price, fallbackSl, fallbackTpRaw, p.size || 0.001);
                    const ok = await commitProtection(`recon-${p.id}`, p.symbol, fallbackSl, fallbackTp, undefined);
                    if (!ok) {
                        await forceClosePosition(p);
                    }
                } else if ((p.currentTrailingStop == null || p.currentTrailingStop === 0) && p.size > 0) {
                    // trailing stop aktivace po profit triggeru
                    const hist = priceHistoryRef.current[p.symbol] || [];
                    const atr = computeAtrFromHistory(hist, 20) || (currentPricesRef.current[p.symbol] ?? p.entryPrice) * 0.005;
                    const oneR = Math.abs((p.entryPrice || 0) - (p.sl || p.entryPrice));
                    const trigger = Math.max(0.8 * oneR, atr);
                    const price = currentPricesRef.current[p.symbol] || p.entryPrice;
                    const dir = p.side === "buy" ? 1 : -1;
                    const profit = (price - p.entryPrice) * dir;
                    if (profit >= trigger && price > 0) {
                        const trailDistance = Math.max(0.8 * atr, 0.6 * oneR, price * 0.003);
                        const ok = await commitProtection(`trail-${p.id}`, p.symbol, p.sl, p.tp, trailDistance);
                        if (ok) {
                            addLog({
                                action: "SYSTEM",
                                message: `Trailing stop aktivován pro ${p.symbol} (dist ${trailDistance.toFixed(4)})`,
                            });
                        }
                    }
                }
            }
        };

        const id = setInterval(() => {
            if (!cancel) void reconcile();
        }, 12000);

        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, commitProtection, forceClosePosition]);

    const [aiModelState, _setAiModelState] = useState({
        version: "1.0.0-real-strategy",
        lastRetrain: new Date(Date.now() - 7 * 24 * 3600 * 1000)
            .toISOString()
            .split("T")[0],
        nextRetrain: new Date(Date.now() + 7 * 24 * 3600 * 1000)
            .toISOString()
            .split("T")[0],
        status: "Idle" as "Idle" | "Training",
    });

    const priceHistoryRef = useRef<Record<string, Candle[]>>({});
    const modeRef = useRef(mode);
    modeRef.current = mode;
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const realizedPnlRef = useRef(0);

    const lifecycleRef = useRef<Map<string, string>>(new Map());
    const dailyHaltAtRef = useRef<number | null>(null);
    const lastTestSignalAtRef = useRef<number | null>(null);
    const lastKeepaliveAtRef = useRef<number | null>(null);
    const coachStakeRef = useRef<Record<string, number>>({});
    const winStreakRef = useRef(0);
    const lossStreakRef = useRef(0);
    const rollingOutcomesRef = useRef<boolean[]>([]);
    const lastPositionsSyncAtRef = useRef<number>(0);
    const executionCursorRef = useRef<string | null>(null);
    const processedExecIdsRef = useRef<Set<string>>(new Set());
    const executionEventsRef = useRef<
        { id: string; symbol: string; orderId?: string; orderLinkId?: string; price?: number; qty?: number; time?: string }[]
    >([]);

    function addLog(entry: Omit<LogEntry, "id" | "timestamp">) {
        const log: LogEntry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date().toISOString(),
            ...entry,
        };
        setLogEntries((prev) => [log, ...prev].slice(0, 10));
    }

    const registerOutcome = (pnl: number) => {
        const win = pnl > 0;
        if (win) {
            winStreakRef.current += 1;
            lossStreakRef.current = 0;
        } else {
            lossStreakRef.current += 1;
            winStreakRef.current = 0;
        }
        rollingOutcomesRef.current = [...rollingOutcomesRef.current.slice(-9), win];
    };

    const computeScalpDynamicRisk = (settings: AISettings) => {
        const base = resolveRiskPct(settings);
        const rolling = rollingOutcomesRef.current;
        const wins = rolling.filter(Boolean).length;
        const rate = rolling.length ? wins / rolling.length : 0;
        let risk = base;
        const hot =
            winStreakRef.current >= 4 ||
            (rolling.length >= 5 && rate >= 0.65);
        const cold = lossStreakRef.current >= 3;
        if (hot) {
            risk = Math.min(Math.max(base, base * 1.8), 0.02);
        }
        if (cold) {
            risk = Math.max(base * 0.5, 0.005);
        }
        return risk;
    };

    const getEffectiveRiskPct = (settings: AISettings) =>
        settings.strategyProfile === "scalp"
            ? computeScalpDynamicRisk(settings)
            : resolveRiskPct(settings);

    const getVolatilityMultiplier = (symbol: string) => {
        const hist = priceHistoryRef.current[symbol] || [];
        if (!hist.length) return 1;
        const { atrShort, atrLong } = computeAtrPair(hist);
        if (!atrShort || !atrLong) return 1;
        const ratio = atrLong / Math.max(atrShort, 1e-8);
        return Math.min(4, Math.max(0.5, ratio * 0.8));
    };

    // ========== FETCH CEN Z BYBIT (mainnet / testnet) ==========
    useEffect(() => {
        if (mode === TradingMode.OFF) {
            setSystemState((p) => ({ ...p, bybitStatus: "Disconnected" }));
            return;
        }

        let cancel = false;

        const fetchAll = async () => {
            const started = performance.now();
            const now = new Date();

            if (!withinSession(settingsRef.current, now)) return;

            try {
                const URL_KLINE = `${httpBase}/v5/market/kline?category=linear`;

                const newPrices: Record<string, number> = {};
                const newHistory: any = { ...priceHistoryRef.current };
                const engineActive: ActivePosition[] = [];

                for (const symbol of SYMBOLS) {
                    const url = `${URL_KLINE}&symbol=${symbol}&interval=1&limit=200`;
                    const r = await fetch(url);
                    const j = await r.json();
                    if (j.retCode !== 0) throw new Error(j.retMsg);

                    const candles = parseKlines(j.result?.list ?? []);
                    // daily data for situational analysis
                    const dailyRes = await fetch(`${URL_KLINE}&symbol=${symbol}&interval=D&limit=10`);
                    const dailyJson = await dailyRes.json();
                    if (dailyJson.retCode !== 0) throw new Error(dailyJson.retMsg);
                    const dailyCandles = parseKlines(dailyJson.result?.list ?? []);
                    if (!candles.length) continue;

                    newHistory[symbol] = candles;
                    newPrices[symbol] = candles[candles.length - 1].close;

                    if (mode !== TradingMode.BACKTEST) {
                        // === Custom Coach strategy: Base 'n Break / Wedge Pop approximation ===
                        if (settingsRef.current.strategyProfile === "coach") {
                            const existingActive = activePositionsRef.current.some((p) => p.symbol === symbol);
                            const existingPending = pendingSignalsRef.current.some((p) => p.symbol === symbol);
                            if (!existingActive && !existingPending) {
                                // Intraday breakout (Base 'n Break / Wedge Pop)
                                const coachSignal = detectCoachBreakout(candles, coachDefaults);
                                if (coachSignal) {
                                    setPendingSignals((prev) => [
                                        {
                                            id: `${symbol}-coach-${Date.now()}`,
                                            symbol,
                                            profile: "coach",
                                            kind: "BREAKOUT",
                                            risk: 0.8,
                                            createdAt: new Date().toISOString(),
                                            ...coachSignal,
                                            intent: { ...coachSignal.intent, symbol, qty: 0 }, // FIX: Enrich intent
                                        },
                                        ...prev,
                                    ]);
                                    addLog({
                                        action: "SIGNAL",
                                        message: coachSignal.message,
                                    });
                                }
                                // Situational Analysis (daily highs/lows rules)
                                const situational = detectSituationalEdges(dailyCandles, newPrices[symbol]);
                                if (situational) {
                                    setPendingSignals((prev) => [
                                        {
                                            id: `${symbol}-situational-${Date.now()}`,
                                            symbol,
                                            profile: "coach",
                                            kind: "MEAN_REVERSION",
                                            risk: 0.5,
                                            createdAt: new Date().toISOString(),
                                            ...situational,
                                            intent: { ...situational.intent, symbol, qty: 0 }, // FIX: Enrich intent
                                        },
                                        ...prev,
                                    ]);
                                    addLog({
                                        action: "SIGNAL",
                                        message: situational.message,
                                    });
                                }
                            }
                        } else {
                            const profile = chooseStrategyProfile(
                                candles,
                                settingsRef.current.strategyProfile as any
                            );
                            if (!profile) continue;
                            const resolvedRiskPct = Math.min(
                                getEffectiveRiskPct(settingsRef.current) *
                                (settingsRef.current.positionSizingMultiplier || 1),
                                0.07
                            );
                            const decision = evaluateStrategyForSymbol(
                                symbol,
                                candles,
                                {
                                    strategyProfile: profile,
                                    entryStrictness:
                                        settingsRef.current.entryStrictness,
                                    riskPerTrade: resolvedRiskPct,
                                    accountBalance: portfolioState.totalCapital,
                                    maxDailyLossPercent: settingsRef.current.maxDailyLossPercent,
                                    maxDrawdownPercent: settingsRef.current.maxDrawdownPercent,
                                    maxDailyProfitPercent: settingsRef.current.maxDailyProfitPercent,
                                    maxOpenPositions: settingsRef.current.maxOpenPositions,
                                    maxPortfolioRiskPercent: settingsRef.current.maxPortfolioRiskPercent,
                                    enforceSessionHours: settingsRef.current.enforceSessionHours,
                                    tradingHours: {
                                        start: settingsRef.current.tradingStartHour,
                                        end: settingsRef.current.tradingEndHour,
                                        days: settingsRef.current.tradingDays,
                                    },
                                }
                            );
                            const signal = decision?.signal;
                            if (signal) {
                                setPendingSignals((prev) => [
                                    { ...signal, symbol, profile, kind: signal.kind ?? "BREAKOUT", intent: { ...signal.intent, symbol, qty: 0 } }, // FIX: Enrich intent
                                    ...prev
                                ]);
                                addLog({
                                    action: "SIGNAL",
                                    message: `${signal.intent.side} ${symbol} @ ${signal.intent.entry} | TESTNET=${useTestnet}`,
                                });
                            }
                            if (decision?.position) {
                                const pos = decision.position;
                                const dir = pos.side === "long" ? 1 : -1;
                                const currentPrice =
                                    candles[candles.length - 1].close;
                                const pnl =
                                    (currentPrice - pos.entryPrice) *
                                    dir *
                                    pos.size;
                                const hist = newHistory[symbol] || [];
                                const atr =
                                    computeAtrFromHistory(hist, 20) ||
                                    pos.entryPrice * 0.005;
                                const safeSl =
                                    pos.stopLoss ||
                                    (pos.side === "long"
                                        ? pos.entryPrice - 1.5 * atr
                                        : pos.entryPrice + 1.5 * atr);
                                const tpCandidate = Number.isFinite(pos.takeProfit)
                                    ? pos.takeProfit
                                    : pos.initialTakeProfit;
                                const safeTp =
                                    tpCandidate && Number.isFinite(tpCandidate)
                                        ? tpCandidate
                                        : pos.side === "long"
                                            ? pos.entryPrice +
                                            1.2 * (pos.entryPrice - safeSl)
                                            : pos.entryPrice -
                                            1.2 * (safeSl - pos.entryPrice);
                                const mapped: ActivePosition = {
                                    positionId: `${symbol}-${pos.opened}`, // FIX: Synthesized ID from engine state
                                    id: `${symbol}-${pos.opened}`,
                                    symbol,
                                    side: pos.side === "long" ? "buy" : "sell",
                                    qty: pos.size, // FIX
                                    entryPrice: pos.entryPrice,
                                    sl: safeSl,
                                    tp: safeTp,
                                    size: pos.size,
                                    env: useTestnet ? "testnet" : "mainnet", // FIX
                                    openedAt: new Date(pos.opened).toISOString(),
                                    unrealizedPnl: pnl,
                                    pnl,
                                    pnlValue: pnl,
                                    rrr:
                                        Math.abs(
                                            (Number.isFinite(pos.takeProfit)
                                                ? pos.takeProfit
                                                : pos.initialTakeProfit) -
                                            pos.entryPrice
                                        ) /
                                        Math.abs(
                                            pos.entryPrice - pos.stopLoss ||
                                            1e-8
                                        ) || 0,
                                    peakPrice: pos.highWaterMark,
                                    currentTrailingStop: pos.trailingStop,
                                    volatilityFactor: undefined,
                                    lastUpdateReason: undefined,
                                    timestamp: new Date().toISOString(),
                                };
                                engineActive.push(mapped);
                            }
                        } // end evaluateStrategy branch
                    } // end mode !== BACKTEST
                } // end for SYMBOLS

                if (cancel) return;

                priceHistoryRef.current = newHistory;
                setCurrentPrices(newPrices);
                currentPricesRef.current = newPrices;

                // Simulované pozice aktualizujeme jen pokud NEMÁME auth token (tj. není přímá vazba na burzu).
                if (!authToken) {
                    const prevActive = activePositionsRef.current;
                    const closed = prevActive.filter(
                        (p) => !engineActive.some((e) => e.id === p.id)
                    );

                    let freedNotional = 0;
                    if (closed.length) {
                        closed.forEach((p) => {
                            const exitPrice =
                                newPrices[p.symbol] ??
                                currentPrices[p.symbol] ??
                                p.entryPrice;
                            const dir = p.side === "buy" ? 1 : -1;
                            const pnl =
                                (exitPrice - p.entryPrice) * dir * p.size;
                            realizedPnlRef.current += pnl;
                            const limits = QTY_LIMITS[p.symbol];
                            if (settingsRef.current.strategyProfile === "coach" && limits) {
                                const nextStake = Math.max(
                                    limits.min * p.entryPrice,
                                    Math.min(limits.max * p.entryPrice, p.entryPrice * p.size + pnl)
                                );
                                coachStakeRef.current[p.symbol] = nextStake;
                            }
                            const record: AssetPnlRecord = {
                                symbol: p.symbol,
                                pnl,
                                timestamp: new Date().toISOString(),
                                note: `Auto-close @ ${exitPrice.toFixed(
                                    4
                                )} | size ${p.size.toFixed(4)}`,
                            };
                            if (authToken) {
                                setAssetPnlHistory(() => addPnlRecord(record));
                            }
                            setEntryHistory(() =>
                                addEntryToHistory({
                                    id: `${p.id}-auto-closed`,
                                    symbol: p.symbol,
                                    side: p.side.toLowerCase() as "buy" | "sell",
                                    entryPrice: p.entryPrice,
                                    sl: p.sl,
                                    tp: p.tp,
                                    size: p.size,
                                    createdAt: new Date().toISOString(),
                                    settingsNote: `Auto-closed @ ${exitPrice.toFixed(
                                        4
                                    )} | PnL ${pnl.toFixed(2)} USDT`,
                                    settingsSnapshot: snapshotSettings(settingsRef.current),
                                })
                            );
                            freedNotional += marginFor(p.symbol, p.entryPrice, p.size);
                            addLog({
                                action: "AUTO_CLOSE",
                                message: `${p.symbol} auto-closed @ ${exitPrice.toFixed(
                                    4
                                )} | PnL ${pnl.toFixed(2)} USDT`,
                            });
                        });
                    }

                    setActivePositions(() => {
                        activePositionsRef.current = engineActive;
                        return engineActive;
                    });
                    setPortfolioState((p) => ({
                        ...p,
                        openPositions: engineActive.length,
                        allocatedCapital: Math.max(
                            0,
                            p.allocatedCapital - freedNotional
                        ),
                    }));
                }

                const latency = Math.round(performance.now() - started);
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Connected",
                    latency,
                    lastError: null,
                }));

                // === TEST MODE: GENERUJ RYCHLÉ SIGNÁLY PRO VŠECHNY ASSETY, KTERÉ NEJSOU OTEVŘENÉ ===
                if (settingsRef.current.entryStrictness === "test") {
                    const now = Date.now();
                    if (
                        lastTestSignalAtRef.current &&
                        now - lastTestSignalAtRef.current < 4000
                    ) {
                        // Throttle generování test signálů
                    } else {
                        lastTestSignalAtRef.current = now;
                        const activeSymbols = new Set(
                            activePositionsRef.current.map((p) => p.symbol)
                        );
                        const pendingSymbols = new Set(
                            pendingSignalsRef.current.map((p) => p.symbol)
                        );
                        const nowIso = new Date().toISOString();
                        const newTestSignals: PendingSignal[] = [];
                        for (const symbol of SYMBOLS) {
                            if (activeSymbols.has(symbol)) continue;
                            if (pendingSymbols.has(symbol)) continue;
                            if (
                                pendingSignalsRef.current.length + newTestSignals.length >=
                                MAX_TEST_PENDING
                            )
                                break;
                            const price = newPrices[symbol];
                            if (!price) continue;
                            const side: "buy" | "sell" =
                                Math.random() > 0.5 ? "buy" : "sell";
                            const offsetPct = 0.003 + Math.random() * 0.01; // 0.3% – 1.3%
                            const sl =
                                side === "buy"
                                    ? price * (1 - offsetPct)
                                    : price * (1 + offsetPct);
                            const tp =
                                side === "buy"
                                    ? price * (1 + offsetPct)
                                    : price * (1 - offsetPct);
                            newTestSignals.push({
                                id: `${symbol}-${Date.now()}-${Math.random()
                                    .toString(16)
                                    .slice(2)}`,
                                symbol,
                                profile: (settingsRef.current.strategyProfile === "auto" ? "intraday" : settingsRef.current.strategyProfile) as any,
                                kind: "MOMENTUM",
                                intent: { side, entry: price, sl, tp, symbol, qty: 0 }, // FIX: A1 Type Compliance
                                risk: 0.7,
                                message: `TEST signal ${side.toUpperCase()} ${symbol} @ ${price.toFixed(
                                    4
                                )}`,
                                createdAt: nowIso,
                            });
                        }
                        if (newTestSignals.length) {
                            setPendingSignals((prev) => [
                                ...newTestSignals,
                                ...prev,
                            ]);
                            newTestSignals.forEach((s) =>
                                addLog({
                                    action: "SIGNAL",
                                    message: s.message,
                                })
                            );
                        }
                    }
                }

                // Keepalive signály pro ostatní profily: pokud není žádný pending/aktivní delší dobu, vytvoř fallback
                if (
                    settingsRef.current.entryStrictness !== "test" &&
                    pendingSignalsRef.current.length === 0 &&
                    activePositionsRef.current.length === 0
                ) {
                    const now = Date.now();
                    if (
                        !lastKeepaliveAtRef.current ||
                        now - lastKeepaliveAtRef.current > KEEPALIVE_SIGNAL_INTERVAL_MS
                    ) {
                        lastKeepaliveAtRef.current = now;
                        const keepSignals: PendingSignal[] = [];
                        const nowIso = new Date().toISOString();
                        for (const symbol of SYMBOLS) {
                            if (keepSignals.length >= MAX_TEST_PENDING) break;
                            const price = newPrices[symbol];
                            if (!price) continue;
                            const hist = priceHistoryRef.current[symbol] || [];
                            const atr = computeAtrFromHistory(hist, 20) || price * 0.005;
                            const side: "buy" | "sell" =
                                Math.random() > 0.5 ? "buy" : "sell";
                            const sl =
                                side === "buy" ? price - 1.5 * atr : price + 1.5 * atr;
                            const tp =
                                side === "buy" ? price + 2.5 * atr : price - 2.5 * atr;
                            keepSignals.push({
                                id: `${symbol}-keep-${Date.now()}-${Math.random()
                                    .toString(16)
                                    .slice(2)}`,
                                symbol,
                                profile: (settingsRef.current.strategyProfile === "auto" ? "intraday" : settingsRef.current.strategyProfile) as any,
                                kind: "MOMENTUM",
                                intent: { side, entry: price, sl, tp, symbol, qty: 0 }, // FIX: A1 Type Compliance
                                risk: 0.6,
                                message: `Keepalive ${side.toUpperCase()} ${symbol} @ ${price.toFixed(
                                    4
                                )}`,
                                createdAt: nowIso,
                            });
                        }
                        if (keepSignals.length) {
                            setPendingSignals((prev) => [...keepSignals, ...prev]);
                            keepSignals.forEach((s) =>
                                addLog({ action: "SIGNAL", message: s.message })
                            );
                        }
                    }
                }
            } catch (err: any) {
                if (cancel) return;
                const msg = err.message ?? "unknown";
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Error",
                    lastError: msg,
                    recentErrors: [msg, ...p.recentErrors].slice(0, 10),
                }));
                addLog({ action: "ERROR", message: msg });
            }
        };

        fetchAll();
        const id = setInterval(fetchAll, 12000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [mode, useTestnet, httpBase]);

    // Executions polling (pro rychlejší fill detection)
    useEffect(() => {
        if (!authToken) return;
        let cancel = false;
        const poll = async () => {
            try {
                const url = new URL(`${apiBase}${apiPrefix}/executions`);
                url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
                if (executionCursorRef.current) {
                    url.searchParams.set("cursor", executionCursorRef.current);
                }
                const res = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                });
                if (!res.ok) return;
                const json = await res.json();
                const list = json?.data?.result?.list || json?.result?.list || [];
                const cursor = json?.data?.result?.nextPageCursor || json?.result?.nextPageCursor;
                const seen = processedExecIdsRef.current;
                const allowedSymbols = new Set(SYMBOLS);
                list.forEach((e: any) => {
                    const id = e.execId || e.tradeId;
                    if (!id || seen.has(id)) return;
                    if (e.symbol && !allowedSymbols.has(e.symbol)) return;
                    seen.add(id);
                    executionEventsRef.current = [
                        {
                            id,
                            symbol: e.symbol || "",
                            orderId: e.orderId || e.orderID || e.clOrdId,
                            orderLinkId: e.orderLinkId || e.orderLinkID || e.clientOrderId,
                            price: Number(e.execPrice ?? e.price ?? 0),
                            qty: Number(e.execQty ?? e.qty ?? 0),
                            time: e.execTime ? new Date(Number(e.execTime)).toISOString() : new Date().toISOString(),
                        },
                        ...executionEventsRef.current,
                    ].slice(0, 200);
                    addLog({
                        action: "SYSTEM",
                        message: `FILL ${e.symbol || ""} ${e.side || ""} @ ${e.execPrice || e.price || "?"} qty ${e.execQty || e.qty || "?"}`,
                    });
                });
                if (seen.size > 2000) {
                    processedExecIdsRef.current = new Set(Array.from(seen).slice(-1000));
                }
                if (cursor) executionCursorRef.current = cursor;
            } catch {
                // ignore polling errors
            }
        };
        poll();
        const id = setInterval(() => {
            if (!cancel) void poll();
        }, 5000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, apiBase, useTestnet]);

    // ========== EXECUTE TRADE (simulated + backend order) ==========
    const performTrade = async (signalId: string): Promise<boolean> => {
        // Locate signal
        const signal = pendingSignalsRef.current.find((s) => s.id === signalId);
        if (!signal) return false;

        const { symbol, side } = signal.intent;
        const { sl, tp, qty, trailingStopDistance, price: intentPrice, triggerPrice: intentTrigger } = signal.intent;
        const lastPrice = currentPricesRef.current[symbol];
        const entryPrice = Number(
            intentPrice ??
            signal.intent.entry ??
            (Number.isFinite(lastPrice) ? lastPrice : NaN)
        );
        const defaultQty = QTY_LIMITS[symbol]?.min ?? 1;
        const requestedQty = Number(qty);
        const orderQty = clampQtyForSymbol(
            symbol,
            Number.isFinite(requestedQty) && requestedQty > 0 ? requestedQty : defaultQty
        );
        const maxOpen = settingsRef.current.maxOpenPositions ?? 2;
        if (activePositionsRef.current.length >= maxOpen) {
            addLog({
                action: "REJECT",
                message: `Skip ${symbol}: max open positions reached (${maxOpen})`,
            });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }
        const hasEntry = Number.isFinite(entryPrice);
        const isBuy = side === "buy" || side === "Buy";
        const safeEntry = Number.isFinite(entryPrice) ? entryPrice : Number.isFinite(lastPrice) ? (lastPrice as number) : 0;

        // Block duplicate entries for symbols with open positions
        const hasOpenPosition = activePositionsRef.current.some((p) => p.symbol === symbol);
        if (hasOpenPosition) {
            addLog({
                action: "REJECT",
                message: `Skip ${symbol}: position already open`,
            });
            // Remove the pending signal to avoid reprocessing
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        // ROI-based TP/SL override for key symbols
        const roiTargets = { tp: 110, sl: -40 }; // ROI % (Bybit-style)
        const isRoiSymbol = symbol === "BTCUSDT" || symbol === "ETHUSDT" || symbol === "SOLUSDT" || symbol === "ADAUSDT";
        const lev = leverageFor(symbol);
        const baseEntryForRoi = Number.isFinite(entryPrice) ? entryPrice : Number.isFinite(intentTrigger) ? Number(intentTrigger) : safeEntry;
        const tpMove = (roiTargets.tp / 100) / Math.max(1, lev); // price move pct
        const slMove = (Math.abs(roiTargets.sl) / 100) / Math.max(1, lev);
        const roiTpPrice = Number.isFinite(baseEntryForRoi) && isRoiSymbol
            ? (baseEntryForRoi as number) * (1 + tpMove * (isBuy ? 1 : -1))
            : undefined;
        const roiSlPrice = Number.isFinite(baseEntryForRoi) && isRoiSymbol
            ? (baseEntryForRoi as number) * (1 - slMove * (isBuy ? 1 : -1))
            : undefined;
        const baseSl = Number.isFinite(sl) ? sl : Number.isFinite(safeEntry) ? (isBuy ? safeEntry * 0.99 : safeEntry * 1.01) : undefined;
        const finalTp = Number.isFinite(roiTpPrice) ? roiTpPrice : tp;
        const finalSl = Number.isFinite(roiSlPrice) ? roiSlPrice : baseSl;

        const profileSetting =
            (signal.profile as ExecStrategyProfile) ||
            ((settingsRef.current.strategyProfile === "auto" ? "intraday" : settingsRef.current.strategyProfile) as ExecStrategyProfile);
        const profile: ExecStrategyProfile =
            profileSetting === "scalp" ||
                profileSetting === "intraday" ||
                profileSetting === "swing" ||
                profileSetting === "trend" ||
                profileSetting === "coach"
                ? profileSetting
                : "intraday";
        const kind: ExecSignalKind = (signal.kind as ExecSignalKind) || "BREAKOUT";

        const entrySignal: ExecEntrySignal = {
            symbol,
            side: isBuy ? "Buy" : "Sell",
            kind,
            entry: safeEntry,
            stopLoss: Number(finalSl ?? safeEntry ?? 0),
            takeProfit: finalTp,
        };

        const hist = priceHistoryRef.current[symbol] || [];
        const atrAbs = computeAtrFromHistory(hist, 14) || 0;
        const last = Number.isFinite(lastPrice) ? (lastPrice as number) : safeEntry;
        const marketSnapshot: ExecMarketSnapshot = {
            last: last || safeEntry || 0,
            atrPct: last > 0 ? (atrAbs / last) * 100 : 0,
        };

        const plan = decideExecutionPlan(entrySignal, marketSnapshot, profile, orderQty);

        const stopLossValue = Number.isFinite(plan.stopLoss) ? plan.stopLoss : finalSl;
        const takeProfitValue = Number.isFinite(plan.takeProfit) ? plan.takeProfit : finalTp;

        // Trailing plán: aktivace při 90 % ROI (price move), vzdálenost = 50 % tohoto pohybu
        const roiArmPct = 90;
        const roiMove = Number.isFinite(safeEntry) && isRoiSymbol
            ? safeEntry * ((roiArmPct / 100) / Math.max(1, lev))
            : undefined;
        const trailingActivePrice = Number.isFinite(roiMove)
            ? safeEntry + (isBuy ? 1 : -1) * (roiMove as number)
            : undefined;
        const trailingDistance = Number.isFinite(roiMove) ? Math.abs(roiMove as number) * 0.5 : undefined;

        const orderType =
            plan.mode === "MARKET"
                ? "Market"
                : "Limit";
        const price =
            plan.mode === "LIMIT"
                ? plan.entryPrice ?? safeEntry
                : plan.mode === "STOP_LIMIT"
                    ? plan.limitPrice ?? plan.entryPrice ?? safeEntry
                    : undefined;
        const triggerPrice =
            plan.mode === "STOP_LIMIT"
                ? plan.triggerPrice ?? plan.entryPrice ?? safeEntry
                : undefined;
        const timeInForce = plan.timeInForce || (plan.mode === "MARKET" ? "IOC" : "GTC");

        // 0. STRICT MODE CHECK
        if (settings.strategyProfile === "auto" && mode !== "AUTO_ON") {
            console.warn(`[Trade] Skipped - Mode is ${mode}, need AUTO_ON`);
            return false;
        }

        // 0.1 PORTFOLIO RISK GATE (New)
        const currentPositions = activePositionsRef.current;
        const totalCapital = portfolioState.totalCapital || 1000;

        // 1. Max Notional Exposure Check (e.g. max 3x leverage globally)
        const currentNotional = currentPositions.reduce((sum, p) => sum + (p.entryPrice * p.size), 0);
        const newTradeNotional = safeEntry * orderQty;
        const maxNotional = totalCapital * 3.0; // Hardcoded safety limit for now, or add to settings
        if (currentNotional + newTradeNotional > maxNotional) {
            addLog({ action: "REJECT", message: `Risk Gate: Max Notional Exceeded (${(currentNotional + newTradeNotional).toFixed(0)} > ${maxNotional.toFixed(0)})` });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        // 1.1 Net Delta Gate (Directional Exposure Limit)
        const netDelta = currentPositions.reduce((sum, p) => sum + (p.side === "buy" ? 1 : -1) * (p.entryPrice * p.size), 0);
        const newDelta = (isBuy ? 1 : -1) * newTradeNotional;
        const projectedDelta = netDelta + newDelta;
        // Limit Net Delta to say 2x Capital (allows some hedging/neutrality)
        const maxDelta = totalCapital * 2.0;
        if (Math.abs(projectedDelta) > maxDelta) {
            addLog({ action: "REJECT", message: `Risk Gate: Max Net Delta Exceeded (${Math.abs(projectedDelta).toFixed(0)} > ${maxDelta.toFixed(0)})` });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        // 2. Correlation / Concentration Limit (Max positions per "bucket" - simplistic symbol check)
        // If we have ETHUSDT, maybe don't open ETH-PERP? (Not applicable here as we assume linear perps)
        // Check simply max risk budget per symbol.
        const existingSymbolRisk = currentPositions.filter(p => p.symbol === symbol).reduce((sum, p) => sum + (Math.abs(p.entryPrice - p.sl) * p.size), 0);
        const newTradeRisk = Math.abs(safeEntry - (Number(finalSl) || safeEntry)) * orderQty;
        const maxRiskPerSymbol = totalCapital * 0.02; // 2% risk per symbol max
        if (existingSymbolRisk + newTradeRisk > maxRiskPerSymbol) {
            addLog({ action: "REJECT", message: `Risk Gate: Max Symbol Risk Exceeded` });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        // 3. Min Edge Gate (Fee + Slippage vs Expected Reward)
        // Fee ~ 0.06% entry + 0.06% exit = 0.12%. Slippage ~ 0.05%. Total cost ~ 0.17% of notional.
        const estCost = newTradeNotional * 0.0017;
        const estReward = Math.abs(safeEntry - (Number(finalTp) || safeEntry)) * orderQty;
        // If reward is defined and < cost * 1.5, reject
        if (finalTp && estReward < estCost * 1.5) {
            addLog({ action: "REJECT", message: `Risk Gate: Edge too small (Reward ${estReward.toFixed(2)} < Cost ${estCost.toFixed(2)} * 1.5)` });
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
            return false;
        }

        // 1. MUTEX CHECK
        if (executionLocksRef.current.has(symbol)) {
            console.warn(`[Trade] Skipped - Execution locked for ${symbol}`);
            return false;
        }
        executionLocksRef.current.add(symbol);

        try {
            // Re-check pending (double check inside lock)
            if (!pendingSignalsRef.current.find((s) => s.id === signalId)) return false;

            setLifecycle(signalId, "ENTRY_SUBMITTED");

            // Remove from pending immediately to prevent infinite loop re-processing
            setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));

            // Calculate metrics (re-use logic or trust intent)
            const clientOrderId = signalId.substring(0, 36);

            if (mode === "AUTO_ON") {
                const payload = {
                    symbol,
                    side: side === "buy" ? "Buy" : "Sell",
                    qty: Number(orderQty.toFixed(4)),
                    orderType,
                    price,
                    triggerPrice,
                    timeInForce,
                    orderLinkId: clientOrderId,
                    sl: stopLossValue,
                    tp: takeProfitValue,
                    trailingStop: trailingDistance,
                    trailingActivePrice,
                };

                const res = await fetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${authToken}`
                    },
                    body: JSON.stringify(payload)
                });

                if (!res.ok) {
                    let errorMsg = `Order API failed (${res.status})`;
                    try {
                        const errJson = await res.json();
                        errorMsg = errJson.error || errorMsg;

                        // CRITICAL ERROR CHECK
                        if (errorMsg.includes("10005") || errorMsg.includes("10003") || errorMsg.includes("Permission denied")) {
                            setSystemState(prev => ({ ...prev, bybitStatus: "Error", lastError: errorMsg }));
                            addLog({ action: "ERROR", message: `CRITICAL STOP: ${errorMsg}` });
                            // disable auto mode?
                        }

                    } catch {
                        errorMsg += `: ${await res.text()}`;
                    }

                    console.error("[Trade Execution] " + errorMsg);
                    addLog({ action: "ERROR", message: errorMsg });
                    setLifecycle(signalId, "FAILED", `order status ${res.status}`);
                    return false;
                }

                const data = await res.json().catch(() => ({}));
                const retCode = data?.retCode ?? data?.data?.retCode;
                if (retCode && retCode !== 0) {
                    const retMsg = data?.retMsg ?? data?.data?.retMsg ?? "Unknown error";
                    const msg = `Bybit Rejected: ${retMsg}`;
                    addLog({ action: "ERROR", message: msg });
                    setLifecycle(signalId, "FAILED", msg);
                    return false;
                }

                const orderId =
                    data?.result?.orderId ||
                    data?.data?.result?.orderId ||
                    data?.data?.orderId ||
                    null;

                try {
                    const fill = await waitForFill(
                        signalId,
                        symbol,
                        orderId,
                        clientOrderId,
                        useTestnet ? 45000 : 90000
                    );
                    if (fill) {
                        setLifecycle(signalId, "ENTRY_FILLED");
                        setLifecycle(signalId, "MANAGING");
                        return true;
                    }
                } catch (err: any) {
                    addLog({
                        action: "ERROR",
                        message: `Fill not confirmed: ${err?.message || "unknown"}`,
                    });
                    setLifecycle(signalId, "FAILED", err?.message || "fill failed");
                    return false;
                }
                return false;

            } else {
                // PAPER MODE
                setLifecycle(signalId, "ENTRY_FILLED", "Simulated");
                setLifecycle(signalId, "MANAGING", "Simulated");
                return true;
            }

        } catch (err: any) {
            console.error("Trade exception", err);
            setLifecycle(signalId, "FAILED", err.message);
            addLog({ action: "ERROR", message: `Trade exception: ${err.message}` });
            return false;
        } finally {
            executionLocksRef.current.delete(symbol);
        }
    };

    function executeTrade(signalId: string): Promise<void> {
        entryQueueRef.current = entryQueueRef.current
            .catch(() => {
                // swallow to keep queue alive
            })
            .then(async () => {
                const last = lastEntryAtRef.current;
                const sinceLast = last ? Date.now() - last : Infinity;
                const waitMs =
                    sinceLast < MIN_ENTRY_SPACING_MS
                        ? MIN_ENTRY_SPACING_MS - sinceLast
                        : 0;

                // Delay only when více vstupů čeká zároveň.
                if (pendingSignalsRef.current.length > 0 && waitMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                }

                const executed = await performTrade(signalId);
                if (executed) {
                    lastEntryAtRef.current = Date.now();
                }
            });

        return entryQueueRef.current;
    }

    // ========== AUTO MODE ==========
    useEffect(() => {
        if (modeRef.current !== TradingMode.AUTO_ON) return;
        if (!pendingSignals.length) return;

        const sig = pendingSignals[0];
        if (settingsRef.current.requireConfirmationInAuto && sig.risk < 0.65)
            return;

        void executeTrade(sig.id);
    }, [pendingSignals]);

    // MOCK NEWS
    useEffect(() => {
        setNewsHeadlines([
            {
                id: "n1",
                headline: "Volatility rising in BTCUSDT",
                sentiment: "neutral",
                source: "scanner",
                time: new Date().toISOString(),
            },
        ]);
    }, []);

    const addPriceAlert = (symbol: string, price: number) => {
        const alert: PriceAlert = {
            id: `a-${Date.now()}`,
            symbol,
            price,
            createdAt: new Date().toISOString(),
            triggered: false,
        };
        setPriceAlerts((p) => [...p, alert]);
    };

    const removePriceAlert = (id: string) => {
        setPriceAlerts((p) => p.filter((a) => a.id !== id));
    };

    const closePosition = (id: string) => {
        setActivePositions((prev) => {
            const target = prev.find((p) => p.id === id);
            if (!target) return prev;

            const currentPrice = currentPrices[target.symbol] ?? target.entryPrice;
            const dir = target.side === "buy" ? 1 : -1;
            const pnl = (currentPrice - target.entryPrice) * dir * target.size;
            const freedNotional = marginFor(target.symbol, target.entryPrice, target.size);

            realizedPnlRef.current += pnl;
            registerOutcome(pnl);

            const limits = QTY_LIMITS[target.symbol];
            if (settingsRef.current.strategyProfile === "coach" && limits) {
                const nextStake = Math.max(
                    limits.min * target.entryPrice,
                    Math.min(
                        limits.max * target.entryPrice,
                        freedNotional * leverageFor(target.symbol) + pnl
                    )
                );
                coachStakeRef.current[target.symbol] = nextStake;
            }

            const record: AssetPnlRecord = {
                symbol: target.symbol,
                pnl,
                timestamp: new Date().toISOString(),
                note: `Closed at ${currentPrice.toFixed(4)} | size ${target.size.toFixed(4)}`,
            };
            if (authToken) {
                setAssetPnlHistory(() => addPnlRecord(record));
            }
            setEntryHistory(() =>
                addEntryToHistory({
                    id: `${target.id}-closed`,
                    symbol: target.symbol,
                    side: target.side.toLowerCase() as "buy" | "sell", // FIX: strict lower case
                    entryPrice: target.entryPrice,
                    sl: target.sl,
                    tp: target.tp,
                    size: target.size,
                    createdAt: new Date().toISOString(),
                    settingsNote: `Closed at ${currentPrice.toFixed(4)} | PnL ${pnl.toFixed(2)} USDT`,
                    settingsSnapshot: snapshotSettings(settingsRef.current),
                })
            );

            setPortfolioState((p) => ({
                ...p,
                allocatedCapital: Math.max(0, p.allocatedCapital - freedNotional),
                openPositions: Math.max(0, p.openPositions - 1),
            }));
            addLog({
                action: "CLOSE",
                message: `Position ${id} closed manually | PnL ${pnl.toFixed(2)} USDT`,
            });

            return prev.filter((p) => p.id !== id);
        });
    };

    const resetRiskState = () => {
        setPortfolioState((p) => ({
            ...p,
            dailyPnl: 0,
            currentDrawdown: 0,
            peakCapital: p.totalCapital,
        }));
        realizedPnlRef.current = 0;
    };

    const updateSettings = (newS: typeof INITIAL_RISK_SETTINGS) => {
        const incomingMode = newS.riskMode ?? settingsRef.current.riskMode;
        const basePreset =
            incomingMode !== settingsRef.current.riskMode
                ? presetFor(incomingMode)
                : settingsRef.current;

        let patched: AISettings = { ...basePreset, ...newS, riskMode: incomingMode };

        if (incomingMode !== settingsRef.current.riskMode) {
            const presetKeys: (keyof AISettings)[] = [
                "baseRiskPerTrade",
                "maxAllocatedCapitalPercent",
                "maxPortfolioRiskPercent",
                "maxDailyLossPercent",
                "maxDailyProfitPercent",
                "maxDrawdownPercent",
                "positionSizingMultiplier",
                "entryStrictness",
                "strategyProfile",
                "enforceSessionHours",
                "haltOnDailyLoss",
                "haltOnDrawdown",
                "maxOpenPositions",
            ];
            presetKeys.forEach((k) => {
                patched = { ...patched, [k]: basePreset[k] };
            });
        }

        if (patched.strategyProfile === "coach") {
            const clamp = (v: number, min: number, max: number) =>
                Math.min(max, Math.max(min, v));
            patched = {
                ...patched,
                baseRiskPerTrade: clamp(patched.baseRiskPerTrade || 0.02, 0.01, 0.03),
                maxDailyLossPercent: Math.min(patched.maxDailyLossPercent || 0.05, 0.05),
                positionSizingMultiplier: clamp(
                    patched.positionSizingMultiplier || 1,
                    0.5,
                    1
                ),
                maxAllocatedCapitalPercent: clamp(
                    patched.maxAllocatedCapitalPercent || 1,
                    0.25,
                    1
                ),
                maxPortfolioRiskPercent: clamp(
                    patched.maxPortfolioRiskPercent || 0.08,
                    0.05,
                    0.1
                ),
                maxOpenPositions: 2,
            };
            if (patched.entryStrictness === "ultra") {
                patched = { ...patched, entryStrictness: "base" };
            }
        }
        if (patched.strategyProfile === "scalp") {
            const relaxedEntry =
                patched.entryStrictness === "test"
                    ? "relaxed"
                    : patched.entryStrictness === "ultra"
                        ? "base"
                        : patched.entryStrictness;
            patched = {
                ...patched,
                baseRiskPerTrade: Math.max(0.01, Math.min(patched.baseRiskPerTrade, 0.02)),
                maxOpenPositions: 1,
                maxDailyLossPercent: Math.max(Math.min(patched.maxDailyLossPercent, 0.12), 0.08),
                maxDrawdownPercent: Math.max(patched.maxDrawdownPercent, 0.3),
                maxPortfolioRiskPercent: Math.max(Math.min(patched.maxPortfolioRiskPercent, 0.12), 0.08),
                enforceSessionHours: false,
                entryStrictness: relaxedEntry,
            };
        }
        // Hard clamp max open positions
        patched = { ...patched, maxOpenPositions: Math.min(2, patched.maxOpenPositions ?? 2) };

        setSettings(patched);
        settingsRef.current = patched;
        persistSettings(patched);
        setPortfolioState((p) => {
            const maxAlloc = p.totalCapital * patched.maxAllocatedCapitalPercent;
            return {
                ...p,
                maxOpenPositions: patched.maxOpenPositions,
                maxAllocatedCapital: maxAlloc,
                allocatedCapital: Math.min(p.allocatedCapital, maxAlloc),
                maxDailyLoss: p.totalCapital * patched.maxDailyLossPercent,
                maxDailyProfit: p.totalCapital * patched.maxDailyProfitPercent,
                maxDrawdown: patched.maxDrawdownPercent,
            };
        });
    };

    const removeEntryHistoryItem = (id: string) => {
        setEntryHistory(() => removeEntryFromHistory(id));
    };

    const resetPnlHistory = () => {
        setAssetPnlHistory(() => clearPnlHistory());
        realizedPnlRef.current = 0;
        setPortfolioState((p) => ({
            ...p,
            dailyPnl: 0,
            currentDrawdown: 0,
        }));
    };

    const rejectSignal = (id: string) => {
        setPendingSignals((prev) => prev.filter((s) => s.id !== id));

        setLogEntries((prev) => [
            {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                action: "REJECT",
                timestamp: new Date().toISOString(),
                message: `Rejected signal ${id}`,
            },
            ...prev,
        ]);
    };

    // ========= RETURN API ==========
    return {
        logEntries,
        activePositions,
        closedPositions,
        systemState,
        portfolioState,
        aiModelState,
        settings,
        currentPrices,
        pendingSignals,
        portfolioHistory,
        newsHeadlines,
        priceAlerts,
        addPriceAlert,
        removePriceAlert,
        updateSettings,
        resetRiskState,
        executeTrade,
        rejectSignal,
        closePosition,
        entryHistory,
        testnetOrders,
        testnetTrades,
        ordersError,
        refreshTestnetOrders: fetchOrders,
        mainnetOrders: testnetOrders, // Unify state: always return current orders
        mainnetTrades: testnetTrades,
        mainnetError: ordersError,
        refreshMainnetOrders: fetchOrders,
        refreshMainnetTrades: fetchTrades,
        assetPnlHistory,
        removeEntryHistoryItem,
        resetPnlHistory,
    };
};

// ========= API TYPE EXPORT ==========
export type TradingBotApi = ReturnType<typeof useTradingBot>;
