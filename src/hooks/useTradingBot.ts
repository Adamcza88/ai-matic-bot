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
import { useNetworkConfig } from "../engine/networkConfig";
import { addEntryToHistory, loadEntryHistory, removeEntryFromHistory } from "../lib/entryHistory";
import { addPnlRecord, loadPnlHistory, AssetPnlMap } from "../lib/pnlHistory";

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
    BTCUSDT: { min: 0.0005, max: 0.01 },
    ETHUSDT: { min: 0.001, max: 0.2 },
    SOLUSDT: { min: 0.01, max: 5 },
    ADAUSDT: { min: 10, max: 5000 },
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
    maxOpenPositions: 4,
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
    minWinRate: 60,
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
    maxOpenPositions: 4,
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
    minWinRate: 55,
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

export const useTradingBot = (
    mode: TradingMode,
    useTestnet: boolean,
    authToken?: string
) => {
    const apiPrefix = useTestnet ? "/api/demo" : "/api/main";
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
        setEntryHistory(loadEntryHistory());
        setAssetPnlHistory(loadPnlHistory());
    }, []);

    useEffect(() => {
        pendingSignalsRef.current = pendingSignals;
    }, [pendingSignals]);

    useEffect(() => {
        activePositionsRef.current = activePositions;
    }, [activePositions]);

    const fetchTestnetOrders = useCallback(async () => {
        if (!authToken) {
            setTestnetOrders([]);
            setOrdersError("Missing auth token");
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
            const url = new URL(`${apiBase}${apiPrefix}/orders`);
            url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
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
            const list = data?.data?.list || data?.list || data?.result?.list || [];
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
            setTestnetOrders(mapped);
        } catch (err: any) {
            setOrdersError(err?.message || "Failed to load orders");
        }
    }, [authToken, useTestnet, apiBase]);

    // Pozice/PnL přímo z Bybitu – přepíší simulované activePositions
    useEffect(() => {
        if (!authToken) return;

        let cancel = false;
        const fetchPositions = async () => {
            try {
                const url = new URL(`${apiBase}${apiPrefix}/positions`);
                url.searchParams.set("net", useTestnet ? "testnet" : "mainnet");
                url.searchParams.set("settleCoin", "USDT");
                const res = await fetch(url.toString(), {
                    headers: { Authorization: `Bearer ${authToken}` },
                });
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`Positions API failed (${res.status}): ${txt || "unknown"}`);
                }
                const data = await res.json();
                const retCode = data?.data?.retCode ?? data?.retCode;
                const retMsg = data?.data?.retMsg ?? data?.retMsg;
                const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
                if (retCode && retCode !== 0) {
                    throw new Error(`Positions retCode=${retCode} ${retMsg || ""}`);
                }
                const mapped: ActivePosition[] = Array.isArray(list)
                    ? list
                          .filter((p: any) => Math.abs(Number(p.size ?? 0)) > 0)
                          .map((p: any, idx: number) => {
                              const avgPrice = Number(p.avgPrice ?? p.entryPrice ?? p.lastPrice ?? 0);
                              const size = Math.abs(Number(p.size ?? 0));
                              const pnl = Number(p.unrealisedPnl ?? 0);
                              return {
                                  id: p.symbol ? `${p.symbol}-${p.positionIdx ?? idx}` : `pos-${idx}`,
                                  symbol: p.symbol || "UNKNOWN",
                                  side: (p.side === "Buy" ? "buy" : "sell") as "buy" | "sell",
                                  entryPrice: avgPrice,
                                  sl: p.stopLoss != null ? Number(p.stopLoss) : p.side === "Buy" ? avgPrice * 0.99 : avgPrice * 1.01,
                                  tp: p.takeProfit != null ? Number(p.takeProfit) : avgPrice,
                                  size,
                                  openedAt: new Date(Number(p.updatedTime ?? p.createdTime ?? Date.now())).toISOString(),
                                  unrealizedPnl: pnl,
                                  pnl,
                                  pnlValue: pnl,
                                  rrr: 0,
                                  peakPrice: Number(p.markPrice ?? p.lastPrice ?? avgPrice),
                                  currentTrailingStop: p.trailingStop != null ? Number(p.trailingStop) : undefined,
                                  volatilityFactor: undefined,
                                  lastUpdateReason: undefined,
                                  timestamp: new Date().toISOString(),
                              };
                          })
                    : [];
                if (cancel) return;

                // Wallet pro equity
                let equity = portfolioState.totalCapital;
                try {
                    const walletRes = await fetch(`${apiBase}${apiPrefix}/wallet?net=${useTestnet ? "testnet" : "mainnet"}`, {
                        headers: { Authorization: `Bearer ${authToken}` },
                    });
                    if (walletRes.ok) {
                        const w = await walletRes.json();
                        const wlist = w?.data?.result?.list || w?.result?.list || [];
                        const usdt = Array.isArray(wlist) ? wlist.find((x: any) => x.coin === "USDT") : null;
                        equity = Number(usdt?.equity ?? usdt?.walletBalance ?? equity ?? 0);
                    }
                } catch {
                    // swallow wallet errors, keep previous equity
                }

                // Realized PnL from closed-pnl
                try {
                    const pnlRes = await fetch(`${apiBase}${apiPrefix}/closed-pnl?net=${useTestnet ? "testnet" : "mainnet"}`, {
                        headers: { Authorization: `Bearer ${authToken}` },
                    });
                    if (pnlRes.ok) {
                        const pnlJson = await pnlRes.json();
                        const pnlList = pnlJson?.data?.result?.list || pnlJson?.result?.list || [];
                        // deduplikace closed PnL záznamů
                        const seen = closedPnlSeenRef.current;
                        const records: AssetPnlRecord[] = Array.isArray(pnlList)
                            ? pnlList.map((r: any) => ({
                                  symbol: r.symbol || "UNKNOWN",
                                  pnl: Number(r.closedPnl ?? r.realisedPnl ?? 0),
                                  timestamp: r.updatedTime ? new Date(Number(r.updatedTime)).toISOString() : new Date().toISOString(),
                                  note: "Bybit closed pnl",
                              }))
                            : [];
                        const realized = records.reduce((sum, r) => sum + (r.pnl || 0), 0);
                        realizedPnlRef.current = realized;
                        setAssetPnlHistory((prev) => {
                            const next: AssetPnlMap = { ...prev };
                            records.forEach((rec) => {
                                const key = `${rec.symbol}-${rec.timestamp}-${rec.pnl}`;
                                if (seen.has(key)) return;
                                seen.add(key);
                                next[rec.symbol] = [rec, ...(next[rec.symbol] || [])].slice(0, 100);
                                addPnlRecord(rec);
                            });
                            // udržet set v rozumné velikosti
                            if (seen.size > 500) {
                                const trimmed = Array.from(seen).slice(-400);
                                closedPnlSeenRef.current = new Set(trimmed);
                            }
                            return next;
                        });
                    }
                } catch {
                    // ignore closed pnl failure
                }

                setActivePositions(() => {
                    activePositionsRef.current = mapped;
                    return mapped;
                });
                lastPositionsSyncAtRef.current = Date.now();
                setPortfolioState((p) => ({
                    ...p,
                    totalCapital: equity || p.totalCapital,
                    peakCapital: Math.max(p.peakCapital, equity || p.peakCapital),
                    openPositions: mapped.length,
                    allocatedCapital: mapped.reduce((sum, pos) => sum + marginFor(pos.symbol, pos.entryPrice, pos.size), 0),
                }));
                setSystemState((prev) => ({
                    ...prev,
                    bybitStatus: "Connected",
                    lastError: null,
                }));
                addLog({
                    action: "SYSTEM",
                    message: `Synced ${mapped.length} ${useTestnet ? "testnet" : "mainnet"} positions`,
                });
            } catch (err: any) {
                if (cancel) return;
                addLog({
                    action: "ERROR",
                    message: `Positions sync failed: ${err?.message || "unknown"}`,
                });
                setSystemState((p) => ({
                    ...p,
                    bybitStatus: "Error",
                    lastError: err?.message || "Failed to load positions",
                }));
            }
        };

        void fetchPositions();
        const id = setInterval(fetchPositions, 10000);
        return () => {
            cancel = true;
            clearInterval(id);
        };
    }, [authToken, useTestnet, apiBase, envBase, inferredBase]);

    const fetchTestnetTrades = useCallback(async () => {
        if (!authToken) {
            setTestnetTrades([]);
            return;
        }
        try {
            const res = await fetch(`${apiBase}${apiPrefix}/trades?net=${useTestnet ? "testnet" : "mainnet"}`, {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Trades API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
            const mapped: TestnetTrade[] = Array.isArray(list)
                ? list.map((t: any) => {
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
    }, [authToken, useTestnet, apiBase, envBase, inferredBase]);

    const fetchMainnetOrders = useCallback(async () => {
        if (!authToken) {
            setMainnetOrders([]);
            setMainnetError("Missing auth token");
            return;
        }
        const baseProvided = Boolean(envBase);
        const sameOrigin =
            typeof window !== "undefined" &&
            inferredBase === window.location.origin;
        if (!baseProvided && sameOrigin) {
            setMainnetOrders([]);
            setMainnetError("Orders API unavailable: configure VITE_API_BASE to point to backend");
            return;
        }
        try {
            setMainnetError(null);
            const url = new URL(`${apiBase}/api/main/orders`);
            url.searchParams.set("net", "mainnet");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Mainnet orders API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
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
            setMainnetOrders(mapped);
        } catch (err: any) {
            setMainnetError(err?.message || "Failed to load mainnet orders");
        }
    }, [authToken, envBase, inferredBase, apiBase]);

    const fetchMainnetTrades = useCallback(async () => {
        if (!authToken) {
            setMainnetTrades([]);
            return;
        }
        try {
            const url = new URL(`${apiBase}/api/main/trades`);
            url.searchParams.set("net", "mainnet");
            url.searchParams.set("settleCoin", "USDT");
            url.searchParams.set("category", "linear");
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Mainnet trades API failed (${res.status}): ${txt || "unknown"}`);
            }
            const data = await res.json();
            const list = data?.data?.list || data?.list || data?.result?.list || [];
            const mapped: TestnetTrade[] = Array.isArray(list)
                ? list.map((t: any) => {
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
            setMainnetTrades(mapped);
        } catch (err: any) {
            setMainnetError((prev) => prev || err?.message || "Failed to load mainnet trades");
        }
    }, [authToken, apiBase, envBase, inferredBase]);

    useEffect(() => {
        void fetchTestnetOrders();
        void fetchTestnetTrades();
        void fetchMainnetOrders();
        void fetchMainnetTrades();
    }, [fetchTestnetOrders, fetchTestnetTrades, fetchMainnetOrders, fetchMainnetTrades]);

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
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) throw new Error(`Positions fetch failed (${res.status})`);
            const data = await res.json();
            const retCode = data?.data?.retCode ?? data?.retCode;
            const retMsg = data?.data?.retMsg ?? data?.retMsg;
            const list = data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
            return { list: Array.isArray(list) ? list : [], retCode, retMsg };
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
        async (net: "testnet" | "mainnet"): Promise<any[]> => {
            if (!authToken) return [];
            const url = new URL(`${apiBase}${apiPrefix}/executions`);
            url.searchParams.set("net", net);
            url.searchParams.set("limit", "100");
            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${authToken}` },
            });
            if (!res.ok) return [];
            const data = await res.json();
            return data?.data?.result?.list || data?.result?.list || data?.data?.list || [];
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
                const executions = await fetchExecutionsOnce(net);
                const execSnapshot = executions.find((e: any) => {
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

            const positions = activePositionsRef.current;
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
    const closedPnlSeenRef = useRef<Set<string>>(new Set());
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
        setLogEntries((prev) => [log, ...prev].slice(0, 200));
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
                                            risk: 0.8,
                                            createdAt: new Date().toISOString(),
                                            ...coachSignal,
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
                                            risk: 0.5,
                                            createdAt: new Date().toISOString(),
                                            ...situational,
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
                            setPendingSignals((prev) => [signal, ...prev]);
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
                                id: `${symbol}-${pos.opened}`,
                                symbol,
                                side: pos.side === "long" ? "buy" : "sell",
                                entryPrice: pos.entryPrice,
                                sl: safeSl,
                                tp: safeTp,
                                size: pos.size,
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
                                side: p.side,
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
                                intent: { side, entry: price, sl, tp },
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
                                intent: { side, entry: price, sl, tp },
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
                list.forEach((e: any) => {
                    const id = e.execId || e.tradeId;
                    if (!id || seen.has(id)) return;
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
        const signal = pendingSignalsRef.current.find((s) => s.id === signalId);
        if (!signal) return false;
        const tradeId = uuidLite();
        const clientOrderId = `aim-${tradeId.slice(-8)}`;
        setLifecycle(tradeId, "SIGNAL_READY", `symbol=${signal.symbol}`);

        // Risk-engine: guardrails for capital allocation, portfolio risk, and halts
        const openCount = authToken ? activePositionsRef.current.length : portfolioState.openPositions;
        const maxAlloc = portfolioState.maxAllocatedCapital;
        const currentAlloc = portfolioState.allocatedCapital;
        const baseRiskPct = getEffectiveRiskPct(settings);
        const volMult = getVolatilityMultiplier(signal.symbol);
        const recoveryMult =
            portfolioState.currentDrawdown >= 0.15 &&
            portfolioState.currentDrawdown < settings.maxDrawdownPercent
                ? 0.5
                : 1;
        const riskPctWithMult = Math.min(
            Math.max(0.005, baseRiskPct * volMult * recoveryMult * (settings.positionSizingMultiplier || 1)),
            0.04
        );

        if (
            settings.haltOnDailyLoss &&
            portfolioState.dailyPnl <= -portfolioState.maxDailyLoss
        ) {
            const now = Date.now();
            if (!dailyHaltAtRef.current) dailyHaltAtRef.current = now;
            const haltUntil = dailyHaltAtRef.current + 2 * 60 * 60 * 1000;
            if (now < haltUntil) {
                addLog({
                    action: "RISK_HALT",
                    message: `Trading halted: daily loss limit hit (${(
                        (portfolioState.maxDailyLoss * 100) /
                        Math.max(1, portfolioState.totalCapital)
                    ).toFixed(2)}%). Resume after cooldown.`,
                });
                return false;
            } else {
                dailyHaltAtRef.current = null;
                realizedPnlRef.current = 0;
                setPortfolioState((p) => ({ ...p, dailyPnl: 0 }));
                addLog({
                    action: "SYSTEM",
                    message: "Daily halt cooldown elapsed, resetting PnL window.",
                });
            }
        }

        if (
            settings.haltOnDrawdown &&
            portfolioState.currentDrawdown >= portfolioState.maxDrawdown
        ) {
            addLog({
                action: "RISK_HALT",
                message: `Trading halted: drawdown cap reached (${(
                    portfolioState.maxDrawdown * 100
                ).toFixed(1)}%).`,
            });
            return false;
        }

        if (openCount >= settings.maxOpenPositions) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: max open positions (${settings.maxOpenPositions}) reached.`,
            });
            return false;
        }

        const intent: TradeIntent = signal.intent;
        const side = intent.side;
        const entry = intent.entry;

        // Dynamické SL/TP/TS dle ATR
        const history = priceHistoryRef.current[signal.symbol] || [];
        const atr = computeAtrFromHistory(history, 20) || entry * 0.005;
        let sl = intent.sl;
        let tp = intent.tp;
        if (!sl) {
            sl = side === "buy" ? entry - 1.5 * atr : entry + 1.5 * atr;
        }
        if (!tp) {
            tp = side === "buy" ? entry + 2.5 * atr : entry - 2.5 * atr;
        }

        const riskPerTrade = portfolioState.totalCapital * riskPctWithMult;
        const riskPerUnit = Math.abs(entry - sl);
        if (riskPerUnit <= 0 || entry <= 0) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: invalid SL/entry distance.`,
            });
            return false;
        }

        const limits = QTY_LIMITS[signal.symbol] ?? { min: 0, max: Number.POSITIVE_INFINITY };

        const riskBudget = portfolioState.totalCapital * settings.maxPortfolioRiskPercent;
        const openRiskAmount = activePositionsRef.current.reduce((sum, p) => sum + computePositionRisk(p), 0);
        const remainingRiskBudget = Math.max(0, riskBudget - openRiskAmount);
        const remainingAllocation = Math.max(0, maxAlloc - currentAlloc);

        const maxSizePerTrade = riskPerUnit > 0 ? riskPerTrade / riskPerUnit : 0;
        const maxSizeBudget = riskPerUnit > 0 ? remainingRiskBudget / riskPerUnit : 0;
        const maxSizeAllocation = entry > 0 ? (remainingAllocation * leverageFor(signal.symbol)) / entry : 0;
        const maxSizeNotional = entry > 0 ? Number.POSITIVE_INFINITY : 0;
        const targetNotional = TARGET_NOTIONAL[signal.symbol];
        const targetSize = targetNotional && entry > 0 ? targetNotional / entry : Number.POSITIVE_INFINITY;

        let size = Math.min(
            limits.max ?? Number.POSITIVE_INFINITY,
            maxSizePerTrade,
            maxSizeBudget,
            maxSizeAllocation,
            maxSizeNotional,
            targetSize
        );

        if (size <= 0) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: žádný prostor pro velikost (risk/alokace/$5 cap).`,
            });
            return false;
        }

        if (limits.min && size < limits.min) {
            const minNotional = limits.min * entry;
            const minMargin = minNotional / Math.max(1, leverageFor(signal.symbol));
            const minRisk = riskPerUnit * limits.min;
            const reasons: string[] = [];
            if (minMargin > remainingAllocation) reasons.push("allocation headroom");
            if (minMargin > MAX_MARGIN_USD) reasons.push("margin cap");
            if (minRisk > remainingRiskBudget) reasons.push("risk budget");
            if (reasons.length) {
                addLog({
                    action: "RISK_BLOCK",
                    message: `Signal on ${signal.symbol} blocked: burzovní minimum ${limits.min} by překročilo ${reasons.join(
                        "/"
                    )}.`,
                });
                return false;
            }
            size = limits.min;
        }

        let notional = size * entry;
        let margin = marginFor(signal.symbol, entry, size);
        const newRiskAmount = riskPerUnit * size;

        if (size <= 0 || notional <= 0) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: zero size after caps.`,
            });
            return false;
        }
        if (openRiskAmount + newRiskAmount > riskBudget) {
            addLog({
                action: "RISK_BLOCK",
                message: `Signal on ${signal.symbol} blocked: portfolio risk cap (${(
                    settings.maxPortfolioRiskPercent * 100
                ).toFixed(1)}%) would be exceeded.`,
            });
            return false;
        }

        if (margin < MIN_MARGIN_USD) {
            const lev = Math.max(1, leverageFor(signal.symbol));
            size = (MIN_MARGIN_USD * lev) / entry;
            margin = marginFor(signal.symbol, entry, size);
            notional = size * entry;
        }
        if (margin > MAX_MARGIN_USD) {
            const lev = Math.max(1, leverageFor(signal.symbol));
            size = (MAX_MARGIN_USD * lev) / entry;
            margin = marginFor(signal.symbol, entry, size);
            notional = size * entry;
        }

        if (portfolioState.allocatedCapital + margin > portfolioState.maxAllocatedCapital) {
            const headroom = Math.max(0, portfolioState.maxAllocatedCapital - portfolioState.allocatedCapital);
            const lev = Math.max(1, leverageFor(signal.symbol));
            const scaledSize = (headroom * lev) / entry;
            const maxOnlyClamp = limits ? Math.min(limits.max, Math.max(0, scaledSize)) : Math.max(0, scaledSize);
            size = maxOnlyClamp;
            notional = size * entry;
            margin = marginFor(signal.symbol, entry, size);
            if (size <= 0 || notional <= 0 || portfolioState.allocatedCapital + margin > portfolioState.maxAllocatedCapital) {
                addLog({
                    action: "RISK_BLOCK",
                    message: `Signal on ${signal.symbol} exceeds capital allocation limit.`,
                });
                return false;
            }
        }

        // Fee-aware TP úprava
        tp = ensureMinTpDistance(entry, sl, tp, size);

        // Trailing stop posuneme až po potvrzení filla (neposíláme v initial orderu)
        const trailingStopPct: number | undefined = undefined;
        const trailingStopDistance: number | undefined = undefined;
        const trailingActivationPrice: number | null = null;

        setPendingSignals((prev) => prev.filter((s) => s.id !== signalId));
        if (!authToken) {
            const position: ActivePosition = {
                id: `pos-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                symbol: signal.symbol,
                side,
                entryPrice: entry,
                sl,
                tp,
                size,
                openedAt: new Date().toISOString(),
                unrealizedPnl: 0,
                currentTrailingStop: sl,
                rrr: Math.abs(tp - entry) / Math.abs(entry - sl) || 0,
                pnl: 0,
                pnlValue: 0,
                timestamp: new Date().toISOString(),
                peakPrice: entry,
            };
            setActivePositions((prev) => [position, ...prev]);
            setPortfolioState((prev) => ({
                ...prev,
                allocatedCapital: prev.allocatedCapital + margin,
                openPositions: prev.openPositions + 1,
            }));
        }

        addLog({
            action: "OPEN",
            message: `Opened ${side.toUpperCase()} ${
                signal.symbol
            } at ${entry.toFixed(4)} (size ≈ ${size.toFixed(
                4
            )}, notional ≈ ${notional.toFixed(2)} USDT)`,
        });

        const settingsSnapshot = snapshotSettings(settingsRef.current);
        // === VOLÁNÍ BACKENDU – POSÍLÁME SL/TP + DYNAMICKÝ TRAILING ===
        try {
            if (!authToken) {
                addLog({
                    action: "ERROR",
                    message:
                        "Missing auth token for placing order. Please re-login.",
                });
                return true;
            }

            setLifecycle(tradeId, "ENTRY_SUBMITTED");
            const res = await fetch(`${apiBase}${apiPrefix}/order?net=${useTestnet ? "testnet" : "mainnet"}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                    body: JSON.stringify({
                        symbol: signal.symbol,
                        side: side === "buy" ? "Buy" : "Sell",
                        qty: Number(size.toFixed(4)),
                        orderType: "Market",
                        timeInForce: "IOC",
                        orderLinkId: clientOrderId,
                        sl,
                        tp,
                    }),
            });

            if (!res.ok) {
                const errText = await res.text();
                addLog({
                    action: "ERROR",
                    message: `Order API failed (${res.status}): ${errText}`,
                });
                setLifecycle(tradeId, "FAILED", `order status ${res.status}`);
                return false;
            }

            const orderJson = await res.json().catch(() => ({}));
            const orderId =
                orderJson?.order?.result?.orderId ||
                orderJson?.bybitResponse?.result?.orderId ||
                orderJson?.result?.orderId ||
                orderJson?.data?.orderId ||
                null;

            // čekáme na fill a pak nastavíme ochranu
            try {
                const filled = await waitForFill(tradeId, signal.symbol, orderId, clientOrderId);
                setLifecycle(tradeId, "ENTRY_FILLED", `size=${filled?.size ?? "?"}`);
                const protectionOk = await commitProtection(tradeId, signal.symbol, sl, tp, trailingStopDistance);
                if (protectionOk) {
                    setLifecycle(tradeId, "MANAGING");
                }
            } catch (err: any) {
                const msg = err?.message || "fill/protection failed";
                setLifecycle(tradeId, "FAILED", msg);
                setSystemState((p) => ({ ...p, bybitStatus: "Error", lastError: msg }));
                addLog({
                    action: "ERROR",
                    message: `Fill/protection failed: ${msg}`,
                });
            }
        } catch (err: any) {
            addLog({
                action: "ERROR",
                message: `Demo API order failed: ${err?.message || "unknown"}`,
            });
        }
        return true;
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
                    side: target.side,
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
        refreshTestnetOrders: fetchTestnetOrders,
        mainnetOrders,
        mainnetTrades,
        mainnetError,
        refreshMainnetOrders: fetchMainnetOrders,
        refreshMainnetTrades: fetchMainnetTrades,
        assetPnlHistory,
        removeEntryHistoryItem,
    };
};

// ========= API TYPE EXPORT ==========
export type TradingBotApi = ReturnType<typeof useTradingBot>;
