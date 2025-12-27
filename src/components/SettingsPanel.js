import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
const SettingsPanel = ({ settings, onUpdateSettings, onClose }) => {
    const [local, setLocal] = useState(settings);
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
    const tradingWindowLabel = `${String(local.tradingStartHour).padStart(2, "0")}:00–${String(local.tradingEndHour).padStart(2, "0")}:00 (${tzLabel})`;
    const profileCopy = {
        "ai-matic": {
            title: "AI-Matic",
            description: "Konzervativnější intraday / scalp mix s kontrolou sezení a širšími filtry volatility.",
            notes: [
                "Trading hours: On (0–23 SEČ/SELČ)",
                "Limit: max 2 pozice současně",
                "Risk: 4 USDT / trade · 8 USDT total (po 3 ztrátách 2/4 na 60m)",
                "Trailing profit lock",
            ],
        },
        "ai-matic-x": {
            title: "AI-Matic-X",
            description: "Agresivnější profil s přísnějšími vstupy, bez session hours a se silnějším sizingem.",
            notes: [
                "Trading hours: Off",
                "Páry: top 5 USDT dle 24h volume",
                "Limit: max 2 pozice současně",
                "Dyn. sizing multiplier 1.0×",
            ],
        },
        "ai-matic-scalp": {
            title: "AI-Matic-Scalp",
            description: "SMC/AMD scalper (M1/M5) se session logikou (London/NY killzones) a limit-maker exekucí.",
            notes: [
                "Trading hours: řízeno killzones (London/NY)",
                "Entry: Sweep → CHoCH → FVG → PostOnly LIMIT",
                "TP1: 1R (50/50 split) + BE, runner přes trailing SL",
            ],
        },
    };
    const meta = profileCopy[local.riskMode];
    const AI_MATIC_PRESET_UI = {
        riskMode: "ai-matic",
        strictRiskAdherence: true,
        pauseOnHighVolatility: false,
        avoidLowLiquidity: false,
        useTrendFollowing: true,
        smcScalpMode: true,
        useLiquiditySweeps: false,
        enableHardGates: true,
        enableSoftGates: true,
        baseRiskPerTrade: 0.02,
        maxPortfolioRiskPercent: 0.2,
        maxAllocatedCapitalPercent: 1.0,
        maxOpenPositions: 2,
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
        strictRiskAdherence: true,
        pauseOnHighVolatility: false,
        avoidLowLiquidity: false,
        useTrendFollowing: true,
        smcScalpMode: true,
        useLiquiditySweeps: false,
        enableHardGates: true,
        enableSoftGates: true,
        baseRiskPerTrade: 0.005,
        maxPortfolioRiskPercent: 0.2,
        maxAllocatedCapitalPercent: 1.0,
        maxOpenPositions: 2,
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
        strictRiskAdherence: true,
        pauseOnHighVolatility: false,
        avoidLowLiquidity: false,
        useTrendFollowing: true,
        smcScalpMode: true,
        useLiquiditySweeps: false,
        enableHardGates: true,
        enableSoftGates: true,
        baseRiskPerTrade: 0.01,
        maxPortfolioRiskPercent: 0.2,
        maxAllocatedCapitalPercent: 1.0,
        maxOpenPositions: 2,
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
    };
    const applyPreset = (mode) => {
        const preset = presets[mode];
        setLocal(preset);
    };
    return (_jsx("div", { className: "fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50", children: _jsxs("div", { className: "w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6 max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "flex flex-col space-y-1.5 mb-6", children: [_jsx("h2", { className: "text-lg font-semibold leading-none tracking-tight", children: "Settings" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Zvolen\u00FD profil nastav\u00ED v\u00FDchoz\u00ED parametry; vybran\u00E9 podm\u00EDnky m\u016F\u017Ee\u0161 p\u0159epnout." })] }), _jsxs("div", { className: "grid gap-4 py-4", children: [_jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Profile" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => applyPreset("ai-matic"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-slate-200"}`, children: "AI-Matic" }), _jsx("button", { onClick: () => applyPreset("ai-matic-x"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-x"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-slate-200"}`, children: "AI-Matic-X" }), _jsx("button", { onClick: () => applyPreset("ai-matic-scalp"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-scalp"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-slate-200"}`, children: "AI-Matic-Scalp" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Enforce Trading Hours" }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: local.enforceSessionHours ? "On" : "Off" }), _jsx("div", { className: "text-xs text-slate-400 mt-1", children: local.enforceSessionHours ? tradingWindowLabel : `Vypnuto (${tzLabel})` })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                ...local,
                                                enforceSessionHours: !local.enforceSessionHours,
                                            }), className: `rounded-md border px-3 py-1 text-sm ${local.enforceSessionHours
                                                ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enforceSessionHours ? "On" : "Off" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Gates" }), _jsxs("div", { className: "grid gap-2", children: [_jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Hard podm\u00EDnky" }), _jsx("div", { className: "text-xs text-slate-400 mt-1", children: "P\u0159\u00EDsn\u00E9 blokace vstupu (spread hard, impulse, stale BBO)." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        enableHardGates: !local.enableHardGates,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.enableHardGates
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enableHardGates ? "On" : "Off" })] }), _jsxs("div", { className: "flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: [_jsxs("div", { children: [_jsx("div", { className: "font-medium", children: "Soft podm\u00EDnky" }), _jsx("div", { className: "text-xs text-slate-400 mt-1", children: "Jemn\u00E9 sn\u00ED\u017Een\u00ED risku podle quality score." })] }), _jsx("button", { type: "button", onClick: () => setLocal({
                                                        ...local,
                                                        enableSoftGates: !local.enableSoftGates,
                                                    }), className: `rounded-md border px-3 py-1 text-sm ${local.enableSoftGates
                                                        ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                                                        : "border-slate-700 bg-slate-900/40 text-slate-200"}`, children: local.enableSoftGates ? "On" : "Off" })] })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Max Positions" }), _jsx("div", { className: "rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: local.maxOpenPositions })] }), _jsxs("div", { className: "mt-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2", children: [_jsx("div", { className: "font-semibold text-white", children: meta.title }), _jsx("div", { className: "text-slate-300", children: meta.description }), _jsx("ul", { className: "list-disc list-inside space-y-1 text-slate-400", children: meta.notes.map((n) => (_jsx("li", { children: n }, n))) }), _jsxs("div", { className: "text-xs text-slate-500", children: ["Parametry: Hours ", local.enforceSessionHours ? tradingWindowLabel : `Off (${tzLabel})`, " \u2022 Max positions", " ", local.maxOpenPositions] })] })] }), _jsxs("div", { className: "flex flex-col gap-2 sm:flex-row sm:justify-end mt-6", children: [_jsx("button", { type: "button", onClick: () => {
                                onUpdateSettings(local);
                                onClose();
                            }, className: "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-emerald-600 text-white hover:bg-emerald-500 h-10 px-4 py-2 w-full sm:w-auto", children: "Save" }), _jsx("button", { onClick: onClose, className: "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto", children: "Close" })] })] }) }));
};
export default SettingsPanel;
