import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
const Card = ({ title, theme, children }) => {
    const bg = theme === 'dark'
        ? 'bg-slate-900 border-slate-800'
        : 'bg-white border-slate-200';
    const titleColor = theme === 'dark'
        ? 'text-emerald-300'
        : 'text-emerald-700';
    return (_jsxs("div", { className: `rounded-xl border ${bg} p-4`, children: [title && (_jsx("h3", { className: `mb-3 font-bold text-lg ${titleColor}`, children: title })), children] }));
};
export default Card;
