import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const ClosedPositionsPanel = ({ theme, closedPositions, }) => {
    const isDark = theme === "dark";
    const card = isDark
        ? "bg-gray-900/50 border-gray-700/50"
        : "bg-white border-gray-200";
    return (_jsxs("div", { className: `rounded-xl p-4 border ${card}`, children: [_jsx("h2", { className: `text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`, children: "Closed Positions" }), closedPositions.length === 0 ? (_jsx("div", { className: `text-sm ${isDark ? "text-gray-500" : "text-gray-600"} italic`, children: "No closed trades yet." })) : (_jsx("div", { className: "space-y-3", children: closedPositions.map((pos) => (_jsxs("div", { className: `p-3 rounded border ${isDark
                        ? "border-gray-700 bg-gray-800/40"
                        : "border-gray-200 bg-gray-100"}`, children: [_jsxs("div", { className: "flex justify-between items-start", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-sm font-semibold", children: [pos.symbol, " \u2014 ", pos.side.toUpperCase()] }), _jsxs("div", { className: "text-xs text-gray-400", children: ["Entry: ", pos.entryPrice.toFixed(2), " | Exit:", " ", pos.exitPrice.toFixed(2)] }), _jsxs("div", { className: "text-xs text-gray-500 mt-1", children: ["Opened: ", pos.timestamp] }), _jsxs("div", { className: "text-xs text-gray-500", children: ["Closed: ", pos.closedAt] })] }), _jsxs("div", { className: `text-sm font-bold ml-4 ${pos.pnlValue >= 0 ? "text-green-400" : "text-red-400"}`, children: [pos.pnlValue.toFixed(2), " USD"] })] }), _jsxs("div", { className: "text-xs text-gray-500 mt-2", children: ["Size: ", pos.size.toFixed(4), " | RRR: ", pos.rrr?.toFixed?.(2) ?? "-"] })] }, pos.id))) }))] }));
};
export default ClosedPositionsPanel;
