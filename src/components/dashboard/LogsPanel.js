import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
function levelForEntry(entry) {
    if (entry.action === "ERROR")
        return "error";
    if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT") {
        return "warn";
    }
    if (entry.action === "REJECT")
        return "warn";
    return "info";
}
export default function LogsPanel({ logEntries, logsLoaded, useTestnet, }) {
    const [levelFilter, setLevelFilter] = useState("all");
    const scrollRef = useRef(null);
    const [stickToBottom, setStickToBottom] = useState(true);
    const filteredEntries = useMemo(() => {
        const list = logEntries ?? [];
        if (levelFilter === "all")
            return list;
        return list.filter((entry) => levelForEntry(entry) === levelFilter);
    }, [logEntries, levelFilter]);
    useEffect(() => {
        if (!scrollRef.current || !stickToBottom)
            return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [filteredEntries, stickToBottom]);
    const handleScroll = () => {
        if (!scrollRef.current)
            return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        setStickToBottom(scrollHeight - scrollTop - clientHeight < 12);
    };
    return (_jsx(Panel, { title: "Logs", description: "Live feed and system events.", action: _jsxs("div", { className: "flex items-center gap-2 text-xs text-muted-foreground", children: [_jsx("span", { children: "Filter" }), _jsxs("div", { className: "flex items-center rounded-md border border-border/60 bg-background/60 p-0.5", children: [_jsx(Button, { variant: levelFilter === "all" ? "secondary" : "ghost", size: "sm", onClick: () => setLevelFilter("all"), className: levelFilter === "all"
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground", children: "All" }), _jsx(Button, { variant: levelFilter === "info" ? "secondary" : "ghost", size: "sm", onClick: () => setLevelFilter("info"), className: levelFilter === "info"
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground", children: "Info" }), _jsx(Button, { variant: levelFilter === "warn" ? "secondary" : "ghost", size: "sm", onClick: () => setLevelFilter("warn"), className: levelFilter === "warn"
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground", children: "Warn" }), _jsx(Button, { variant: levelFilter === "error" ? "secondary" : "ghost", size: "sm", onClick: () => setLevelFilter("error"), className: levelFilter === "error"
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:text-foreground", children: "Error" })] })] }), children: !logsLoaded ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "Loading logs..." })) : filteredEntries.length === 0 ? (_jsx("div", { className: "rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground", children: "No log activity yet." })) : (_jsx("div", { ref: scrollRef, onScroll: handleScroll, className: "max-h-[520px] overflow-y-auto pr-2", children: _jsx("div", { className: "space-y-2", children: filteredEntries.map((entry) => {
                    const level = levelForEntry(entry);
                    return (_jsxs("div", { className: "flex gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs", children: [_jsx("div", { className: "w-20 font-mono text-[11px] text-muted-foreground", children: new Date(entry.timestamp).toLocaleTimeString([], {
                                    hour12: false,
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                }) }), _jsx(Badge, { variant: "outline", className: level === "error"
                                    ? "border-red-500/50 text-red-400"
                                    : level === "warn"
                                        ? "border-amber-500/50 text-amber-400"
                                        : "border-border/60 text-muted-foreground", children: entry.action }), _jsx("div", { className: "text-foreground", children: entry.message })] }, entry.id));
                }) }) })) }));
}
