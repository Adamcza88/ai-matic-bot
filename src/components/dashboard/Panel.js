import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "@/lib/utils";
export default function Panel({ title, action, description, className, children, }) {
    return (_jsxs("section", { className: cn("rounded-xl border border-border/60 bg-card/60 p-4 text-sm text-foreground", className), children: [(title || action || description) && (_jsxs("div", { className: "mb-3 flex flex-wrap items-center justify-between gap-2", children: [_jsxs("div", { className: "min-w-0", children: [title && (_jsx("h3", { className: "text-sm font-semibold tracking-tight", children: title })), description && (_jsx("p", { className: "mt-1 text-xs text-muted-foreground max-w-[70ch]", children: description }))] }), action && _jsx("div", { className: "flex items-center gap-2", children: action })] })), children] }));
}
