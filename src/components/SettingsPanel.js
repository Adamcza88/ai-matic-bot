import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const SettingsPanel = ({ settings, onUpdateSettings, onClose, }) => {
    const local = settings;
    const AI_MATIC_PRESET_UI = {
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
        useVolatilityExpansion: true,
        maxDailyLossPercent: 0.1,
    maxDailyProfitPercent: 1.0,
    maxDrawdownPercent: 0.2,
    baseRiskPerTrade: 0.02,
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
    const presets = {
        "ai-matic": AI_MATIC_PRESET_UI,
        "ai-matic-x": AI_MATIC_X_PRESET_UI,
    };
    const applyPreset = (mode) => {
        const preset = presets[mode];
        onUpdateSettings(preset);
    };
    return (_jsx("div", { className: "fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50", children: _jsxs("div", { className: "w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6", children: [_jsxs("div", { className: "flex flex-col space-y-1.5 mb-6", children: [_jsx("h2", { className: "text-lg font-semibold leading-none tracking-tight", children: "Settings" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "AI-Matic je uzam\u010Den\u00FD profil (pouze ke \u010Dten\u00ED)." })] }), _jsxs("div", { className: "grid gap-4 py-4", children: [_jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Strategy Profile" }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: () => applyPreset("ai-matic"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-slate-200"}`, children: "AI-Matic" }), _jsx("button", { onClick: () => applyPreset("ai-matic-x"), className: `flex-1 rounded-md border border-input px-3 py-2 text-sm ${local.riskMode === "ai-matic-x"
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-800 text-slate-200"}`, children: "AI-Matic-X" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Entry Strictness" }), _jsxs("div", { className: "rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: [local.entryStrictness, " (locked)"] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", children: "Enforce Trading Hours" }), _jsxs("div", { className: "rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: [local.enforceSessionHours ? "On" : "Off", " (locked)"] })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Base Risk %" }), _jsxs("div", { className: "rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: [(local.baseRiskPerTrade * 100).toFixed(2), "%"] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Max Drawdown %" }), _jsxs("div", { className: "rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: [(local.maxDrawdownPercent * 100).toFixed(2), "%"] })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Custom Strategy" }), _jsx("div", { className: "flex min-h-[80px] w-full rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm", children: "Locked for AI-Matic" })] })] }), _jsx("div", { className: "flex justify-end mt-6", children: _jsx("button", { onClick: onClose, className: "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto", children: "Close" }) })] }) }));
};
export default SettingsPanel;
