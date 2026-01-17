import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { SUPPORTED_SYMBOLS, filterSupportedSymbols } from "../constants/symbols";
const IMAGE_LINE = /^!\[Image\]\((.+)\)$/;
const KEYCAP_HEADING = /^[0-9]\uFE0F?\u20E3/;
const PROFILE_SETTINGS_STORAGE_KEY = "ai-matic-profile-settings";
const MAX_OPEN_POSITIONS_CAP = 100;
const MAX_OPEN_ORDERS_CAP = MAX_OPEN_POSITIONS_CAP * 4;
const MIN_AUTO_REFRESH_MINUTES = 1;
const DEFAULT_AUTO_REFRESH_MINUTES = 3;
const ORDER_VALUE_NOTE = "Order value & leverage: BTC/ETH/SOL 10k@100x; ADA/XRP/DOGE/XPLUS/HYPE/FART 7.5k@75x; LINK 5k@50x; XMR 2.5k@25x; MELANIA 2k@20x; margin cost 100 USDT.";
function loadProfileSettingsMap() {
    if (typeof localStorage === "undefined")
        return {};
    try {
        const raw = localStorage.getItem(PROFILE_SETTINGS_STORAGE_KEY);
        if (!raw)
            return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return {};
        return parsed;
    }
    catch {
        return {};
    }
}
function persistProfileSettingsMap(map) {
    if (typeof localStorage === "undefined")
        return;
    try {
        localStorage.setItem(PROFILE_SETTINGS_STORAGE_KEY, JSON.stringify(map));
    }
    catch {
        // ignore storage errors
    }
}
function isHeadingLine(line) {
    return (KEYCAP_HEADING.test(line) ||
        /^\d+\)/.test(line) ||
        /^[A-Z]\)/.test(line) ||
        /^[A-Z]\s[-–]/.test(line) ||
        line.startsWith("KROK ") ||
        line.startsWith("ROZHODOVACÍ STROM") ||
        line.startsWith("RODINA ") ||
        line.startsWith("CHEAT-SHEET") ||
        line.startsWith("CHECKLIST") ||
        line.startsWith("RYCHLÁ PAMĚŤOVKA") ||
        line.startsWith("VIZUÁLNÍ ZKRATKA") ||
        line.startsWith("JAK S TÍM PRACOVAT") ||
        line.startsWith("FINÁLNÍ PRINCIP") ||
        line.startsWith("PROVOZNÍ"));
}
function buildCheatBlocks(notes) {
    const blocks = [];
    let current = { lines: [] };
    for (const line of notes) {
        if (isHeadingLine(line)) {
            if (current.title || current.lines.length)
                blocks.push(current);
            current = { title: line, lines: [] };
        }
        else {
            current.lines.push(line);
        }
    }
    if (current.title || current.lines.length)
        blocks.push(current);
    return blocks;
}
function extractImageUrl(line) {
    const match = line.match(IMAGE_LINE);
    return match?.[1] ?? null;
}
function compactLine(line, maxLen = 140) {
    let text = line;
    text = text.replace(/^CO TO ZNAMENÁ:\s*/i, "CO: ");
    text = text.replace(/^JAK TO POZNÁŠ[^:]*:\s*/i, "VIDÍŠ: ");
    text = text.replace(/^JAK TO VIDÍŠ:\s*/i, "VIDÍŠ: ");
    text = text.replace(/^JAK TO URČÍŠ:\s*/i, "URČÍŠ: ");
    text = text.replace(/^CO DĚLÁŠ:\s*/i, "AKCE: ");
    text = text.replace(/^SIGNÁLY:\s*/i, "SIGNÁLY: ");
    text = text.replace(/^.*?NA CO SI DÁT POZOR:\s*/i, "POZOR: ");
    text = text.replace(/^.*?NEJDŮLEŽITĚJŠÍ:\s*/i, "POINT: ");
    if (text.length > maxLen)
        return `${text.slice(0, maxLen - 1)}…`;
    return text;
}
const SettingsPanel = ({ settings, onUpdateSettings, onClose }) => {
    const [local, setLocal] = useState(settings);
    const [compactCheatSheet, setCompactCheatSheet] = useState(true);
    const profileSettingsRef = useRef(loadProfileSettingsMap());
    useEffect(() => {
        setLocal(settings);
    }, [settings]);
    const tzLabel = (() => {
        const off = new Date().getTimezoneOffset(); // CET: -60, CEST: -120
        if (off === -60)
            return "SEČ";
        if (off === -120)
            return "SELČ";
        return "lokální čas";
    })();
    const tradingWindowLabel = local.riskMode === "ai-matic-scalp"
        ? "08:00–12:00 / 13:00–17:00 (UTC)"
        : `${String(local.tradingStartHour).padStart(2, "0")}:00–${String(local.tradingEndHour).padStart(2, "0")}:00 (${tzLabel})`;
    const profileCopy = {
        "ai-matic": {
            title: "AI-Matic",
            description: "TF stack (HTF 1h/15m + LTF 5m/1m) + POI analyzer (OB/FVG/Breaker/Liquidity) s prioritou.",
            notes: [
                ORDER_VALUE_NOTE,
                "HTF 1h: Určuje směr trhu. Nikdy neobchoduj proti němu.",
                "HTF 15m: Sleduj mini OB, přesnější korekce/pullbacky.",
                "LTF 5m: Vstupní patterny, potvrzení objemů, Smart Money kontext.",
                "LTF 1m: Absolutní přesnost vstupu, exekuce, správa SL/TS.",
                "FVG: 3-svíčková imbalance (priority 1)",
                "OB: poslední opačná svíčka před impulsem (priority 2)",
                "Breaker: mitigace OB + close za extremem (priority 3)",
                "Liquidity pools: equal highs/lows, tolerance 0.2 %, min 3 dotyky",
                "Swing points window: 7 (pro highs/lows)",
                "POI priorita: Breaker > OB > FVG > Liquidity",
            ],
        },
        "ai-matic-x": {
            title: "AI-Matic-X",
            description: "Decision tree: čistá struktura (1h kontext / 5m exekuce), bez EMA/ATR; RSI divergence jen pro reversal.",
            notes: [
                ORDER_VALUE_NOTE,
                "1h trend: HH/HL nebo LL/LH bez overlapu (swing 2L/2R).",
                "5m trend: impuls (>=1.2× avg range) → korekce (<=60%) → pokračování.",
                "Rodiny 1–6: pullback, continuation, range fade, break&flip, reversal, no trade.",
                "Reversal (#5): RSI divergence + CHOCH, rychlý exit (0.25–0.5R).",
                "Risk OFF: -2R denně nebo 2 ztráty po sobě nebo chop → NO TRADE.",
                "Entry: LIMIT default; MARKET jen při strong expanse; PostOnly jen v low‑vol range.",
                "Trailing: aktivace +1R, offset 0.2% (0.25% v expanzi).",
                "Max 1 pozice celkem; BTC bias musí souhlasit se všemi entry.",
            ],
        },
        "ai-matic-scalp": {
            title: "SCALPERA BOT AI MATIC EDITION",
            description: "Operational Implementation Guide v2.0 · Integrace AI Matic Intelligence Framework (Scalpera Systems, 2026).",
            notes: [
                ORDER_VALUE_NOTE,
                "Cil: spojit presnost SMC/ICT se silou AI Matic; adaptivni exekuce podle struktury, objemu, sentimentu a volatility.",
                "Core SMC/ICT: BOS, CHOCH, OB, FVG; EMA 8/21/50/200; volume baseline SMA20.",
                "AI layer: Trend Predictor (EMA stack + AI smer), Volatility Scanner (ATR + OI delta), Sentiment Engine (funding/OI/text/social), Price Cone (Monte Carlo 12-24h), Adaptive Executor (Trend/Sweep).",
                "Pipeline: Bybit OHLCV+Orderbook, CoinGlass OI/Funding/LS ratio, Birdeye DEX volume + whales, AI Matic feed.",
                "Signal format: {symbol, signal, confidence, mode, entry, sl, tp, validation, data_missing}.",
                "Rezimy: Trend-Pullback (EMA8>21>50, FVG/OB retrace, volume > SMA20*1.2, AI cone + sentiment>0).",
                "Rezimy: Liquidity-Sweep (sweep + rychly navrat, volume spike + negativni sentiment, OI delta + funding zmena).",
                "Rezimy: Adaptive (AI prepina Trend/Sweep, confidence >60%).",
                "Risk: SL 1.3 ATR(14) * volatility_factor; TP 2.6 ATR(14) * cone_direction; trailing po RRR 1.1; max 1 pozice/symbol; bez pyramidovani.",
                "Predikce: price cone 12h/24h; bias >0.60 long, <0.40 short.",
                "Validace: validation passed/failed; data_missing => WAIT.",
                "Integrace: webhook Bybit + monitoring a adaptivni update.",
                "Metriky: success rate 63-72%, RRR 1.8-2.2, drawdown max 2%/trade.",
                "Modules: TrendPredictor, VolatilityScanner, SentimentEngine, PriceConeGenerator, AdaptiveExecutor.",
                "SMART MONEY – HLOUBKOVA INTEGRACE",
                "Mindset: posuzuj kazdy signal optikou instituci; neodevzdavej likviditu.",
                "EMA 8/21/50 + Order Block musi potvrdit stejny smer; konflikt = NO TRADE.",
                "Liquidity sweep/inducement: cekej na sweep a navrat do OB + objemovou reakci.",
                "Break & retest: vstup az po retestu OB/S&R/PoC, ne na prvni impuls.",
                "FVG: SL za FVG, TP na FVG/OB/S&R v ceste.",
                "Multi-TF: BOS/CHoCH na 1h i 15m, vstupni pattern na 5m/1m.",
                "Management: opacny BOS/CHoCH na 1m/5m = rucni exit.",
                "Chyby: OB bez EMA, vstup bez sweepu/retestu, SL v likvidite.",
            ],
        },
        "ai-matic-tree": {
            title: "AI-Matic Tree (Market → Akce)",
            description: "Rozhodovací strom A + Rodiny C + Checklist B + Risk protokol D (Bybit Linear, 1h/5m).",
            notes: [
                ORDER_VALUE_NOTE,
                "Bybit Linear Perpetuals · kontext 1h · exekuce 5m · scan ~40 trhů",
                "Strom A: Kontext → Režim trhu → Směr → Risk ON/OFF → High/Low Prob → Akce",
                "Rodiny 1–6: Trend Pullback, Trend Continuation, Range Fade, Range→Trend, Reversal (omezeně), No Trade",
                "Checklist B: invalidace → režim → logický target → trend zdravý → čas → risk off → hold",
                "Risk protokol: Risk ON 1R; Risk OFF 0.25R; max 5 obchodů/den; max 2 pozice",
                "Absolutní zákazy: žádné přidávání; žádná změna plánu v otevřeném obchodu",
            ],
        },
    };
    const meta = profileCopy[local.riskMode];
    const cheatBlocks = useMemo(() => buildCheatBlocks(meta.notes), [meta.notes]);
    const profileSummary = {
        "ai-matic": "AI‑MATIC core (1h/15m/5m/1m): POI + struktura, pullbacky a řízení přes R‑multiple.",
        "ai-matic-x": "AI‑MATIC‑X (1h/5m): decision tree, čistá struktura, max 1 pozice celkem.",
        "ai-matic-scalp": "Scalp profil (1h/1m): rychlé intraday vstupy, krátké držení, disciplinované řízení rizika.",
        "ai-matic-tree": "AI‑MATIC‑TREE (1h/5m): decision‑tree overlay nad AI‑MATIC core enginem.",
    };
    const statusItems = [
        {
            label: "Cheat Sheet",
            value: local.strategyCheatSheetEnabled ? "On" : "Off",
        },
        { label: "Hard gates", value: local.enableHardGates ? "On" : "Off" },
        { label: "Soft gates", value: local.enableSoftGates ? "On" : "Off" },
        { label: "Strict risk", value: local.strictRiskAdherence ? "On" : "Off" },
        { label: "Max daily loss", value: local.haltOnDailyLoss ? "On" : "Off" },
        { label: "Max drawdown", value: local.haltOnDrawdown ? "On" : "Off" },
        {
            label: "Trading hours",
            value: local.enforceSessionHours
                ? tradingWindowLabel
                : `Off (${tzLabel})`,
        },
        {
            label: "Auto-refresh",
            value: local.autoRefreshEnabled
                ? `${local.autoRefreshMinutes}m`
                : "Off",
        },
        { label: "Trend gate", value: local.trendGateMode },
        { label: "Max pos", value: String(local.maxOpenPositions) },
        { label: "Max orders", value: String(local.maxOpenOrders) },
        { label: "Symbols", value: local.selectedSymbols.join(", ") },
    ];
    const AI_MATIC_PRESET_UI = {
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
        baseRiskPerTrade: 0.02,
        maxPortfolioRiskPercent: 0.2,
        maxAllocatedCapitalPercent: 1.0,
        maxOpenPositions: 3,
        maxOpenOrders: 12,
        selectedSymbols: [...SUPPORTED_SYMBOLS],
        entryStrictness: "base",
        enforceSessionHours: true,
        haltOnDailyLoss: true,
        haltOnDrawdown: true,
        useDynamicPositionSizing: true,
        lockProfitsWithTrail: true,
        autoRefreshEnabled: false,
        autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
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
    const AI_MATIC_X_PRESET_UI = {
        riskMode: "ai-matic-x",
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
        baseRiskPerTrade: 0.005,
        maxPortfolioRiskPercent: 0.2,
        maxAllocatedCapitalPercent: 1.0,
        maxOpenPositions: 3,
        maxOpenOrders: 12,
        selectedSymbols: [...SUPPORTED_SYMBOLS],
        entryStrictness: "ultra",
        enforceSessionHours: false,
        haltOnDailyLoss: true,
        haltOnDrawdown: true,
        useDynamicPositionSizing: true,
        lockProfitsWithTrail: true,
        autoRefreshEnabled: false,
        autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
        requireConfirmationInAuto: false,
        positionSizingMultiplier: 1.0,
        customInstructions: "",
        customStrategy: "",
        min24hVolume: 50,
        minProfitFactor: 0,
        minWinRate: 65,
        tradingStartHour: 0,
        tradingEndHour: 23,
        tradingDays: [0, 1, 2, 3, 4, 5, 6],
    };
    const AI_MATIC_SCALP_PRESET_UI = {
        riskMode: "ai-matic-scalp",
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
        baseRiskPerTrade: 0.01,
        maxPortfolioRiskPercent: 0.2,
        maxAllocatedCapitalPercent: 1.0,
        maxOpenPositions: 3,
        maxOpenOrders: 12,
        selectedSymbols: [...SUPPORTED_SYMBOLS],
        entryStrictness: "ultra",
        enforceSessionHours: true,
        haltOnDailyLoss: true,
        haltOnDrawdown: true,
        useDynamicPositionSizing: true,
        lockProfitsWithTrail: true,
        autoRefreshEnabled: false,
        autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
        requireConfirmationInAuto: false,
        positionSizingMultiplier: 1.0,
        customInstructions: "",
        customStrategy: "",
        min24hVolume: 50,
        minProfitFactor: 1.0,
        minWinRate: 65,
        tradingStartHour: 8,
        tradingEndHour: 17,
        tradingDays: [0, 1, 2, 3, 4, 5, 6],
    };
    const AI_MATIC_TREE_PRESET_UI = {
        riskMode: "ai-matic-tree",
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
        baseRiskPerTrade: 0.01,
        maxPortfolioRiskPercent: 0.2,
        maxAllocatedCapitalPercent: 1.0,
        maxOpenPositions: 2,
        maxOpenOrders: 8,
        selectedSymbols: [...SUPPORTED_SYMBOLS],
        entryStrictness: "base",
        enforceSessionHours: false,
        haltOnDailyLoss: true,
        haltOnDrawdown: true,
        useDynamicPositionSizing: true,
        lockProfitsWithTrail: true,
        autoRefreshEnabled: false,
        autoRefreshMinutes: DEFAULT_AUTO_REFRESH_MINUTES,
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
    const presets = {
        "ai-matic": AI_MATIC_PRESET_UI,
        "ai-matic-x": AI_MATIC_X_PRESET_UI,
        "ai-matic-scalp": AI_MATIC_SCALP_PRESET_UI,
        "ai-matic-tree": AI_MATIC_TREE_PRESET_UI,
    };
    const stashProfileSettings = (mode, next) => {
        profileSettingsRef.current = {
            ...profileSettingsRef.current,
            [mode]: next,
        };
        persistProfileSettingsMap(profileSettingsRef.current);
    };
    const resolveProfileSettings = (mode) => {
        const preset = presets[mode];
        const saved = profileSettingsRef.current[mode];
        if (!saved)
            return preset;
        const merged = { ...preset, ...saved, riskMode: mode };
        if (!Array.isArray(merged.tradingDays)) {
            merged.tradingDays = preset.tradingDays;
        }
        if (!Number.isFinite(merged.maxOpenPositions)) {
            merged.maxOpenPositions = preset.maxOpenPositions;
        }
        else {
            merged.maxOpenPositions = Math.min(MAX_OPEN_POSITIONS_CAP, Math.max(0, Math.round(merged.maxOpenPositions)));
        }
        if (!Number.isFinite(merged.maxOpenOrders)) {
            merged.maxOpenOrders = preset.maxOpenOrders;
        }
        else {
            merged.maxOpenOrders = Math.min(MAX_OPEN_ORDERS_CAP, Math.max(0, Math.round(merged.maxOpenOrders)));
        }
        if (!Number.isFinite(merged.autoRefreshMinutes)) {
            merged.autoRefreshMinutes = preset.autoRefreshMinutes;
        }
        else {
            merged.autoRefreshMinutes = Math.max(MIN_AUTO_REFRESH_MINUTES, Math.round(merged.autoRefreshMinutes));
        }
        const selectedSymbols = filterSupportedSymbols(merged.selectedSymbols);
        merged.selectedSymbols =
            selectedSymbols.length > 0
                ? selectedSymbols
                : [...preset.selectedSymbols];
        return merged;
    };
    const applyPreset = (mode) => {
        stashProfileSettings(local.riskMode, local);
        setLocal(resolveProfileSettings(mode));
    };
    return (_jsx("div", { className: "fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50", children: _jsxs("div", { className: "w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6 max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "flex flex-col space-y-1.5 mb-6", children: [_jsx("h2", { className: "text-lg font-semibold leading-none tracking-tight", children: "Settings" }), _jsxs("div", { className: "rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200", children: [_jsx("div", { className: "text-[11px] uppercase tracking-wide text-slate-400", children: "Strategie (aktu\u00E1ln\u00ED stav)" }), _jsx("div", { children: profileSummary[local.riskMode] }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400", children: statusItems.map((item) => (_jsxs("span", { className: "rounded-full border border-slate-800 bg-slate-950/40 px-2 py-0.5", children: [item.label, ": ", item.value] }, item.label))) })] }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Zvolen\u00FD profil nastav\u00ED v\u00FDchoz\u00ED parametry; vybran\u00E9 podm\u00EDnky m\u016F\u017Ee\u0161 p\u0159epnout." })] }), _jsxs("div", { className: "grid gap-4 py-4", children: [_jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Profile" }), _jsxs("div", { className: "grid grid-cols-2 gap-2", children: [_jsx("button", { onClick: () => applyPreset("ai-matic"), className: `rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-secondary-foreground"}`, children: "AI-Matic" }), _jsx("button", { onClick: () => applyPreset("ai-matic-x"), className: `rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-x"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-secondary-foreground"}`, children: "AI-Matic-X" }), _jsx("button", { onClick: () => applyPreset("ai-matic-scalp"), className: `rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-scalp"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-secondary-foreground"}`, children: "AI-Matic-Scalp" }), _jsx("button", { onClick: () => applyPreset("ai-matic-tree"), className: `rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-tree"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-secondary-foreground"}`, children: "AI-Matic-Tree" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Enforce Trading Hours" }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: local.enforceSessionHours ? "On" : "Off" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: local.enforceSessionHours ? tradingWindowLabel : `Vypnuto (${tzLabel})` })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                ...local,
                                                enforceSessionHours: !local.enforceSessionHours,
                                            }), className: `rounded-md border px-3 py-1 text-sm ${local.enforceSessionHours
                                                ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enforceSessionHours ? "On" : "Off" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Auto-refresh" }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: local.autoRefreshEnabled ? "On" : "Off" }), _jsxs("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: ["Obnov\u00ED aplikaci ka\u017Ed\u00FDch ", local.autoRefreshMinutes, " min."] })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "number", min: MIN_AUTO_REFRESH_MINUTES, step: 1, value: local.autoRefreshMinutes, onChange: (event) => {
                                                        const next = event.currentTarget.valueAsNumber;
                                                        setLocal({
                                                            ...local,
                                                            autoRefreshMinutes: Number.isFinite(next)
                                                                ? Math.max(MIN_AUTO_REFRESH_MINUTES, Math.round(next))
                                                                : DEFAULT_AUTO_REFRESH_MINUTES,
                                                        });
                                                    }, className: "w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-200" }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        autoRefreshEnabled: !local.autoRefreshEnabled,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.autoRefreshEnabled
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.autoRefreshEnabled ? "On" : "Off" })] })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Gates" }), _jsxs("div", { className: "grid gap-2", children: [_jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Hard podm\u00EDnky" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "P\u0159\u00EDsn\u00E9 blokace vstupu (spread hard, impulse, stale BBO)." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        enableHardGates: !local.enableHardGates,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.enableHardGates
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enableHardGates ? "On" : "Off" })] }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Soft podm\u00EDnky" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "Jemn\u00E9 sn\u00ED\u017Een\u00ED risku podle quality score." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        enableSoftGates: !local.enableSoftGates,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.enableSoftGates
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enableSoftGates ? "On" : "Off" })] })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Risk Stops" }), _jsxs("div", { className: "grid gap-2", children: [_jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Strict risk adherence" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "Vynucuje risk protokol: R limit (max ztr\u00E1ta v R), povinn\u00E9 stopky a \u017E\u00E1dn\u00E9 obch\u00E1zen\u00ED pravidel." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        strictRiskAdherence: !local.strictRiskAdherence,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.strictRiskAdherence
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.strictRiskAdherence ? "On" : "Off" })] }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Max daily loss gate" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "Blokuje vstupy po dosa\u017Een\u00ED denn\u00ED ztr\u00E1ty." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        haltOnDailyLoss: !local.haltOnDailyLoss,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.haltOnDailyLoss
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.haltOnDailyLoss ? "On" : "Off" })] }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Max drawdown gate" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "Blokuje vstupy po p\u0159ekro\u010Den\u00ED max drawdownu." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        haltOnDrawdown: !local.haltOnDrawdown,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.haltOnDrawdown
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.haltOnDrawdown ? "On" : "Off" })] })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Trend Gate Mode" }), _jsxs("div", { className: "rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm space-y-2", children: [_jsxs("select", { value: local.trendGateMode, onChange: (e) => setLocal({
                                                ...local,
                                                trendGateMode: e.target.value,
                                            }), className: "w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200", children: [_jsx("option", { value: "adaptive", children: "Adaptive" }), _jsx("option", { value: "follow", children: "Follow" }), _jsx("option", { value: "reverse", children: "Reverse" })] }), _jsx("div", { className: "text-xs text-secondary-foreground/70", children: "Trend Gate filtruje vstupy podle sm\u011Bru trendu z HTF 1h. Adaptive: p\u0159ep\u00EDn\u00E1 Follow/Reverse podle s\u00EDly trendu (ADX/score); Reverse jen p\u0159i slab\u00E9m trendu a mean\u2011reversion sign\u00E1lu. Follow: pouze se sm\u011Brem 1h trendu." })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Cheat Sheet" }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: local.strategyCheatSheetEnabled ? "On" : "Off" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "Prioritize saved entry setups (Limit/Conditional)." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                ...local,
                                                strategyCheatSheetEnabled: !local.strategyCheatSheetEnabled,
                                            }), className: `rounded-md border px-3 py-1 text-sm ${local.strategyCheatSheetEnabled
                                                ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.strategyCheatSheetEnabled ? "On" : "Off" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Max Positions" }), _jsxs("div", { className: "flex items-center gap-3 rounded-md border border-input bg-slate-800 px-3 py-2 text-sm", children: [_jsx("input", { type: "number", min: 0, max: MAX_OPEN_POSITIONS_CAP, step: 1, value: local.maxOpenPositions, onChange: (event) => {
                                                const next = event.currentTarget.valueAsNumber;
                                                setLocal({
                                                    ...local,
                                                    maxOpenPositions: Number.isFinite(next)
                                                        ? Math.min(MAX_OPEN_POSITIONS_CAP, Math.max(0, Math.round(next)))
                                                        : 0,
                                                });
                                            }, className: "w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200" }), _jsx("span", { className: "text-xs text-secondary-foreground/70", children: "0-100 pozic (0 = \u017E\u00E1dn\u00E1 pozice)" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Max Orders" }), _jsxs("div", { className: "flex items-center gap-3 rounded-md border border-input bg-slate-800 px-3 py-2 text-sm", children: [_jsx("input", { type: "number", min: 0, max: MAX_OPEN_ORDERS_CAP, step: 1, value: local.maxOpenOrders, onChange: (event) => {
                                                const next = event.currentTarget.valueAsNumber;
                                                setLocal({
                                                    ...local,
                                                    maxOpenOrders: Number.isFinite(next)
                                                        ? Math.min(MAX_OPEN_ORDERS_CAP, Math.max(0, Math.round(next)))
                                                        : 0,
                                                });
                                            }, className: "w-24 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200" }), _jsxs("span", { className: "text-xs text-secondary-foreground/70", children: ["0-", MAX_OPEN_ORDERS_CAP, " order\u016F (0 = \u017E\u00E1dn\u00E1 objedn\u00E1vka)"] })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Trading Symbols" }), _jsx("div", { className: "flex flex-wrap gap-2 rounded-md border border-input bg-slate-800 px-3 py-2 text-sm", children: SUPPORTED_SYMBOLS.map((symbol) => {
                                        const active = local.selectedSymbols.includes(symbol);
                                        return (_jsx("button", { type: "button", onClick: () => {
                                                const next = new Set(local.selectedSymbols);
                                                if (next.has(symbol)) {
                                                    if (next.size === 1)
                                                        return;
                                                    next.delete(symbol);
                                                }
                                                else {
                                                    next.add(symbol);
                                                }
                                                setLocal({
                                                    ...local,
                                                    selectedSymbols: SUPPORTED_SYMBOLS.filter((s) => next.has(s)),
                                                });
                                            }, className: `rounded-md border px-3 py-1 text-xs font-medium ${active
                                                ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: symbol }, symbol));
                                    }) }), _jsx("span", { className: "text-xs text-secondary-foreground/70", children: "Vyber, kter\u00E9 coiny bot skenuje a obchoduje." })] }), _jsxs("div", { className: "mt-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2", children: [_jsx("div", { className: "font-semibold text-white", children: meta.title }), _jsx("div", { className: "text-slate-300", children: meta.description }), _jsxs("div", { className: "flex items-center justify-between text-xs text-slate-500", children: [_jsxs("div", { children: ["View: ", compactCheatSheet ? "Compact" : "Detail"] }), _jsx("button", { type: "button", onClick: () => setCompactCheatSheet((v) => !v), className: `rounded-md border px-2 py-1 text-[11px] ${compactCheatSheet
                                                ? "border-slate-700 bg-slate-900/60 text-slate-200"
                                                : "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"}`, children: compactCheatSheet ? "Compact" : "Detail" })] }), _jsx("div", { className: "space-y-3 text-slate-400", children: cheatBlocks.map((block, blockIndex) => {
                                        const rawLines = compactCheatSheet
                                            ? block.lines.filter((line) => !extractImageUrl(line))
                                            : block.lines;
                                        const visibleLines = compactCheatSheet
                                            ? rawLines.slice(0, 3)
                                            : rawLines;
                                        const hiddenCount = rawLines.length - visibleLines.length;
                                        return (_jsxs("div", { className: block.title
                                                ? "rounded-md border border-slate-800 bg-slate-950/40 p-2"
                                                : "", children: [block.title ? (_jsx("div", { className: "text-[11px] uppercase tracking-wide text-slate-300", children: block.title })) : null, _jsx("ul", { className: "mt-1 space-y-1 text-xs leading-relaxed", children: visibleLines.map((line, lineIndex) => {
                                                        const imageUrl = extractImageUrl(line);
                                                        if (imageUrl) {
                                                            const host = imageUrl
                                                                .replace(/^https?:\/\//, "")
                                                                .split("/")[0];
                                                            return (_jsx("li", { children: _jsxs("a", { href: imageUrl, target: "_blank", rel: "noreferrer", className: "text-sky-300 underline underline-offset-2", children: ["Image reference (", host, ")"] }) }, `${blockIndex}-${lineIndex}`));
                                                        }
                                                        return (_jsx("li", { children: compactCheatSheet ? compactLine(line) : line }, `${blockIndex}-${lineIndex}`));
                                                    }) }), compactCheatSheet && hiddenCount > 0 ? (_jsxs("div", { className: "mt-1 text-[11px] text-slate-500", children: ["+", hiddenCount, " dal\u0161\u00EDch"] })) : null] }, `${block.title ?? "block"}-${blockIndex}`));
                                    }) }), _jsxs("div", { className: "text-xs text-slate-500", children: ["Parametry: Hours ", local.enforceSessionHours ? tradingWindowLabel : `Off (${tzLabel})`, " \u2022 Max positions", " ", local.maxOpenPositions, " \u2022 Max orders ", local.maxOpenOrders] })] })] }), _jsxs("div", { className: "flex flex-col gap-2 sm:flex-row sm:justify-end mt-6", children: [_jsx("button", { type: "button", onClick: () => {
                                stashProfileSettings(local.riskMode, local);
                                onUpdateSettings(local);
                                onClose();
                            }, className: "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-emerald-600 text-white hover:bg-emerald-500 h-10 px-4 py-2 w-full sm:w-auto", children: "Save" }), _jsx("button", { onClick: onClose, className: "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto", children: "Close" })] })] }) }));
};
export default SettingsPanel;
