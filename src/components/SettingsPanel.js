import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
const IMAGE_LINE = /^!\[Image\]\((.+)\)$/;
const KEYCAP_HEADING = /^[0-9]\uFE0F?\u20E3/;
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
    var _a;
    const match = line.match(IMAGE_LINE);
    return (_a = match === null || match === void 0 ? void 0 : match[1]) !== null && _a !== void 0 ? _a : null;
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
function renderCheatBlocks(cheatBlocks, compactCheatSheet) {
    return cheatBlocks.map((block, blockIndex) => {
        const rawLines = compactCheatSheet
            ? block.lines.filter((line) => !extractImageUrl(line))
            : block.lines;
        const visibleLines = compactCheatSheet ? rawLines.slice(0, 3) : rawLines;
        const hiddenCount = rawLines.length - visibleLines.length;
        return _jsxs("div", { className: block.title
                ? "rounded-md border border-slate-800 bg-slate-950/40 p-2"
                : "", children: [block.title ? (_jsx("div", { className: "text-[11px] uppercase tracking-wide text-slate-300", children: block.title })) : null, _jsx("ul", { className: "mt-1 space-y-1 text-xs leading-relaxed", children: visibleLines.map((line, lineIndex) => {
                    const imageUrl = extractImageUrl(line);
                    if (imageUrl) {
                        const host = imageUrl.replace(/^https?:\/\//, "").split("/")[0];
                        return (_jsx("li", { children: _jsx("a", { href: imageUrl, target: "_blank", rel: "noreferrer", className: "text-sky-300 underline underline-offset-2", children: `Image reference (${host})` }) }, `${blockIndex}-${lineIndex}`));
                    }
                    return (_jsx("li", { children: compactCheatSheet ? compactLine(line) : line }, `${blockIndex}-${lineIndex}`));
                }) }), compactCheatSheet && hiddenCount > 0 ? (_jsxs("div", { className: "mt-1 text-[11px] text-slate-500", children: ["+", hiddenCount, " dalších"] })) : null] }, `${block.title || "block"}-${blockIndex}`);
    });
}
const SettingsPanel = ({ settings, onUpdateSettings, onClose }) => {
    const [local, setLocal] = useState(settings);
    const [compactCheatSheet, setCompactCheatSheet] = useState(true);
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
            description: "TF stack + POI analyzer (OB/FVG/Breaker/Liquidity) s prioritou.",
            notes: [
                "TF stack: 1H kontext, 15M mikro, 5M signál, 1M potvrzení/řízení",
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
            description: "SMC profil s HTF 4h/1h biasem a POI (OB/FVG/Breaker/Liquidity) a LTF 15m/1m entry přes CHOCH/MSS a displacement pullback.",
            notes: [
        "Trading hours: Off",
        "Páry: top 5 USDT dle 24h volume",
        "HTF: 4h + 1h structure (HH/HL, LH/LL) + swing points",
        "POI: Order blocky, FVG, breaker blocks, liquidity pools",
        "LTF: 15m + 1m displacement + CHOCH/MSS + mitigace",
        "Entry: pullback do HTF POI po inducement sweep; ignoruj LTF bez HTF",
        "Smart Money combo: OB + liquidity, sweep/inducement, break & retest, FVG",
        "Checklist gate: min 7/10 potvrzeni (EMA 8/21/50, pattern, volume, BTC, OB, sweep, retest, FVG, VP/SR, CoinGlass)",
        "LONG: EMA9 > EMA21 (M5), ADX>22, ATR <70% prům.20, cena nad VWAP; SL pod low, TP 1.8× ATR",
        "LONG: Pullback k EMA50 na M15 + higher low, ADX>20; entry break high, SL pod EMA50",
        "LONG: Momentum <30 na M1 + bullish engulfing; rychlý scalp",
        "LONG: Breakout nad resistance s ATR expanzí +20% a ADX>25",
                "SHORT: EMA9 < EMA21 (M5), ADX>22, ATR <70% prům.20, cena pod VWAP; SL nad high",
                "SHORT: Pullback k EMA50 na M15 + lower high, ADX>20; entry break low, SL nad EMA50",
                "SHORT: Momentum >70 na M1 + bearish engulfing",
                "SHORT: Breakdown pod support s ATR expanzí a ADX>25",
                "Filtrace: žádný vstup proti HTF biasu (např. 1h EMA200)",
                "Relaxed: 70%+ confidence (2+ indikátorů) · Auto‑On vždy s TP/SL + trailing",
            ],
        },
        "ai-matic-scalp": {
            title: "SCALPERA BOT AI MATIC EDITION",
            description: "Operational Implementation Guide v2.0 · Integrace AI Matic Intelligence Framework (Scalpera Systems, 2026).",
            notes: [
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
            ],
        },
    };
    const meta = profileCopy[local.riskMode];
    const cheatBlocks = useMemo(() => buildCheatBlocks(meta.notes), [meta.notes]);
    const profileSummary = {
        "ai-matic": "TF stack 1h/15m/5m/1m + POI (OB/FVG/Breaker/Liquidity). Struktura a pullbacky jsou klíčové.",
        "ai-matic-x": "HTF SMC bias (4h/1h) + LTF 15m/1m CHOCH/MSS. Smart‑money filtrace a přísnější vstupy.",
        "ai-matic-scalp": "Rychlé intraday scalpy: SMC/EMA + AI signály, kratší čas držení, pevné řízení rizika.",
        "ai-matic-tree": "Decision‑tree přístup: 1h kontext, 5m exekuce, jasné ANO/NE podle checklistu.",
    };
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
        entryStrictness: "ultra",
        enforceSessionHours: false,
        haltOnDailyLoss: true,
        haltOnDrawdown: true,
        useDynamicPositionSizing: true,
        lockProfitsWithTrail: true,
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
        entryStrictness: "ultra",
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
        tradingStartHour: 8,
        tradingEndHour: 17,
        tradingDays: [0, 1, 2, 3, 4, 5, 6],
    };
    const presets = {
        "ai-matic": AI_MATIC_PRESET_UI,
        "ai-matic-x": AI_MATIC_X_PRESET_UI,
        "ai-matic-scalp": AI_MATIC_SCALP_PRESET_UI,
    };
    const applyPreset = (mode) => {
        const preset = presets[mode];
        setLocal(preset);
    };
    return (_jsx("div", { className: "fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50", children: _jsxs("div", { className: "w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6 max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "flex flex-col space-y-1.5 mb-6", children: [_jsx("h2", { className: "text-lg font-semibold leading-none tracking-tight", children: "Settings" }), !local.strategyCheatSheetEnabled ? (_jsxs("div", { className: "rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-200", children: [_jsx("div", { className: "text-[11px] uppercase tracking-wide text-slate-400", children: "Strategie (bez Cheat Sheet)" }), _jsx("div", { children: profileSummary[local.riskMode] })] })) : null, _jsx("p", { className: "text-sm text-muted-foreground", children: "Zvolen\u00FD profil nastav\u00ED v\u00FDchoz\u00ED parametry; vybran\u00E9 podm\u00EDnky m\u016F\u017Ee\u0161 p\u0159epnout." })] }), _jsxs("div", { className: "grid gap-4 py-4", children: [_jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Profile" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => applyPreset("ai-matic"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-secondary-foreground"}`, children: "AI-Matic" }), _jsx("button", { onClick: () => applyPreset("ai-matic-x"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-x"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-secondary-foreground"}`, children: "AI-Matic-X" }), _jsx("button", { onClick: () => applyPreset("ai-matic-scalp"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-scalp"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-secondary-foreground"}`, children: "AI-Matic-Scalp" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Enforce Trading Hours" }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: local.enforceSessionHours ? "On" : "Off" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: local.enforceSessionHours ? tradingWindowLabel : `Vypnuto (${tzLabel})` })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                ...local,
                                                enforceSessionHours: !local.enforceSessionHours,
                                            }), className: `rounded-md border px-3 py-1 text-sm ${local.enforceSessionHours
                                                ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enforceSessionHours ? "On" : "Off" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Gates" }), _jsxs("div", { className: "grid gap-2", children: [_jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Hard podm\u00EDnky" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "P\u0159\u00EDsn\u00E9 blokace vstupu (spread hard, impulse, stale BBO)." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        enableHardGates: !local.enableHardGates,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.enableHardGates
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enableHardGates ? "On" : "Off" })] }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Soft podm\u00EDnky" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "Jemn\u00E9 sn\u00ED\u017Een\u00ED risku podle quality score." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        enableSoftGates: !local.enableSoftGates,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.enableSoftGates
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enableSoftGates ? "On" : "Off" })] })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Trend Gate Mode" }), _jsxs("div", { className: "rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm space-y-2", children: [_jsxs("select", { value: local.trendGateMode, onChange: (e) => setLocal({
                                                ...local,
                                                trendGateMode: e.target.value,
                                            }), className: "w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200", children: [_jsx("option", { value: "adaptive", children: "Adaptive" }), _jsx("option", { value: "follow", children: "Follow" }), _jsx("option", { value: "reverse", children: "Reverse" })] }), _jsx("div", { className: "text-xs text-secondary-foreground/70", children: "Adaptive: follow when ADX >= 25 or score >= 3, otherwise reverse. Follow: only with trend direction. Reverse: only mean-reversion." })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Cheat Sheet" }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: local.strategyCheatSheetEnabled ? "On" : "Off" }), _jsx("div", { className: "text-xs text-secondary-foreground/70 mt-1", children: "Prioritize saved entry setups (Limit/Conditional)." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                ...local,
                                                strategyCheatSheetEnabled: !local.strategyCheatSheetEnabled,
                                            }), className: `rounded-md border px-3 py-1 text-sm ${local.strategyCheatSheetEnabled
                                                ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.strategyCheatSheetEnabled ? "On" : "Off" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Max Positions" }), _jsx("div", { className: "rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm", children: local.maxOpenPositions })] }), _jsxs("div", { className: "mt-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2", children: [_jsx("div", { className: "font-semibold text-white", children: meta.title }), _jsx("div", { className: "text-slate-300", children: meta.description }), _jsxs("div", { className: "flex items-center justify-between text-xs text-slate-500", children: [_jsxs("div", { children: ["View: ", compactCheatSheet ? "Compact" : "Detail"] }), _jsx("button", { type: "button", onClick: () => setCompactCheatSheet((v) => !v), className: `rounded-md border px-2 py-1 text-[11px] ${compactCheatSheet ? "border-slate-700 bg-slate-900/60 text-slate-200" : "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"}`, children: compactCheatSheet ? "Compact" : "Detail" })] }), _jsx("div", { className: "space-y-3 text-slate-400", children: renderCheatBlocks(cheatBlocks, compactCheatSheet) }), _jsxs("div", { className: "text-xs text-slate-500", children: ["Parametry: Hours ", local.enforceSessionHours ? tradingWindowLabel : `Off (${tzLabel})`, " \u2022 Max positions", " ", local.maxOpenPositions] })] })] }), _jsxs("div", { className: "flex flex-col gap-2 sm:flex-row sm:justify-end mt-6", children: [_jsx("button", { type: "button", onClick: () => {
                                onUpdateSettings(local);
                                onClose();
                            }, className: "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-emerald-600 text-white hover:bg-emerald-500 h-10 px-4 py-2 w-full sm:w-auto", children: "Save" }), _jsx("button", { onClick: onClose, className: "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto", children: "Close" })] })] }) }));
};
export default SettingsPanel;
