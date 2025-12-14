import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { TradingMode } from "../types";
const SystemStatusPanel = ({ theme, systemState, mode, onModeChange, }) => {
    const isDark = theme === "dark";
    const card = isDark
        ? "bg-gray-900/50 border-gray-700/50"
        : "bg-white border-gray-200";
    const statusColor = systemState.bybitStatus === "Connected"
        ? "text-green-400"
        : systemState.bybitStatus === "Error"
            ? "text-red-400"
            : "text-yellow-400";
    return (_jsxs("div", { className: `rounded-xl p-4 border ${card}`, children: [_jsx("h2", { className: `text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`, children: "System Status" }), _jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Bybit:" }), " ", _jsx("span", { className: `${statusColor} font-semibold`, children: systemState.bybitStatus })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-500", children: "Latency:" }), " ", _jsxs("span", { className: "text-cyan-400 font-semibold", children: [systemState.latency, " ms"] })] }), _jsxs("div", { className: "col-span-2", children: [_jsx("span", { className: "text-gray-500", children: "Last Error:" }), " ", _jsx("span", { className: "text-red-400", children: systemState.lastError ?? "None" })] })] }), _jsxs("div", { className: "mt-4 pt-4 border-t border-gray-700/40", children: [_jsx("h3", { className: `text-sm font-semibold mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`, children: "Trading Mode" }), _jsx("div", { className: "flex space-x-2", children: Object.values(TradingMode).map((m) => {
                            const active = mode === m;
                            return (_jsx("button", { onClick: () => onModeChange(m), className: `px-3 py-1.5 text-xs rounded border font-semibold transition ${active
                                    ? isDark
                                        ? "bg-cyan-600 text-white border-cyan-500"
                                        : "bg-cyan-500 text-white border-cyan-600"
                                    : isDark
                                        ? "border-gray-600 text-gray-300 hover:bg-gray-800"
                                        : "border-gray-300 text-gray-700 hover:bg-gray-200"}`, children: m }, m));
                        }) })] })] }));
};
export default SystemStatusPanel;
