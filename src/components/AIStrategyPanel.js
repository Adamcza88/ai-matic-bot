import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
const AIStrategyPanel = ({ settings, onUpdateSettings, }) => {
    const [local, setLocal] = useState(settings);
    const update = (field, value) => {
        const updated = { ...local, [field]: value };
        setLocal(updated);
        onUpdateSettings(updated);
    };
    return (_jsxs("div", { className: "rounded-xl border bg-card text-card-foreground shadow-xs", children: [_jsx("div", { className: "flex flex-col space-y-1.5 p-6", children: _jsx("h3", { className: "font-semibold leading-none tracking-tight", children: "AI Strategy Settings" }) }), _jsxs("div", { className: "p-6 pt-0 grid gap-4", children: [_jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Strategy" }), _jsx("div", { className: "flex gap-2 flex-wrap", children: [
                                    { key: "off", label: "Off" },
                                    { key: "auto", label: "Auto" },
                                    { key: "scalp", label: "Scalp" },
                                    { key: "intraday", label: "Intraday" },
                                    { key: "swing", label: "Swing" },
                                    { key: "trend", label: "Trend" },
                                ].map((opt) => (_jsx("button", { onClick: () => update("strategyProfile", opt.key), className: `inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring border border-input hover:bg-accent hover:text-accent-foreground h-8 px-3 ${local.strategyProfile === opt.key
                                        ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary"
                                        : "bg-background"}`, children: opt.label }, opt.key))) })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Entry Strictness" }), _jsx("div", { className: "flex gap-2 flex-wrap", children: [
                                    { key: "base", label: "Base" },
                                    { key: "relaxed", label: "Relaxed" },
                                    { key: "ultra", label: "Ultra" },
                                    { key: "test", label: "Test" },
                                ].map((opt) => (_jsx("button", { onClick: () => update("entryStrictness", opt.key), className: `inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring border border-input hover:bg-accent hover:text-accent-foreground h-8 px-3 ${local.entryStrictness === opt.key
                                        ? "bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
                                        : "bg-background"}`, children: opt.label }, opt.key))) })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Enforce Trading Hours" }), _jsx("div", { className: "flex gap-2 flex-wrap", children: [
                                    { key: true, label: "On" },
                                    { key: false, label: "Off" },
                                ].map((opt) => (_jsx("button", { onClick: () => update("enforceSessionHours", opt.key), className: `inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring border border-input hover:bg-accent hover:text-accent-foreground h-8 px-3 ${local.enforceSessionHours === opt.key
                                        ? opt.key
                                            ? "bg-amber-500 text-black hover:bg-amber-600 border-amber-500"
                                            : "bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-600"
                                        : "bg-background"}`, children: opt.label }, opt.label))) })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Base Risk %" }), _jsx("input", { type: "number", value: local.baseRiskPerTrade, onChange: (e) => update("baseRiskPerTrade", Number(e.target.value)), className: "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", step: "0.01" })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Max Drawdown %" }), _jsx("input", { type: "number", value: local.maxDrawdownPercent, onChange: (e) => update("maxDrawdownPercent", Number(e.target.value)), className: "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", step: "0.01" })] })] }), _jsxs("div", { className: "grid gap-2", children: [_jsx("label", { className: "text-sm font-medium leading-none", children: "Custom Strategy Text" }), _jsx("textarea", { value: local.customStrategy, onChange: (e) => update("customStrategy", e.target.value), className: "flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" })] })] })] }));
};
export default AIStrategyPanel;
