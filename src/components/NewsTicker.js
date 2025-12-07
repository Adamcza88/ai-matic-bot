import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const NewsTicker = ({ theme, news }) => {
    const isDark = theme === "dark";
    const bg = isDark
        ? "bg-black/30 border-gray-700/50"
        : "bg-white/70 border-gray-300";
    return (_jsx("div", { className: `w-full border rounded-lg px-3 py-2 overflow-hidden ${bg} backdrop-blur-sm`, children: _jsx("div", { className: "animate-marquee whitespace-nowrap text-sm flex space-x-10", children: news.map((item) => (_jsxs("div", { className: "flex items-center space-x-2 opacity-80", children: [_jsx("span", { className: item.sentiment === "positive"
                            ? "text-green-400"
                            : item.sentiment === "negative"
                                ? "text-red-400"
                                : "text-yellow-400", children: "\u25CF" }), _jsx("span", { className: isDark ? "text-gray-300" : "text-gray-700", children: item.headline })] }, item.id))) }) }));
};
export default NewsTicker;
