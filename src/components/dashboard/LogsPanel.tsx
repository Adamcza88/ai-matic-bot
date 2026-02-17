import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import type { LogEntry } from "@/types";
import Panel from "@/components/dashboard/Panel";

type LogsPanelProps = {
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
  useTestnet: boolean;
  isActive: boolean;
};

type LevelFilter = "all" | "info" | "warn" | "error" | "blocked";

function levelForEntry(entry: LogEntry): LevelFilter {
  if (entry.action === "ERROR") return "error";
  if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT") {
    return "blocked";
  }
  if (entry.action === "REJECT") return "blocked";
  if (entry.action === "STATUS") return "warn";
  if (/\bwarn\b|\bfail(ed)?\b/i.test(entry.message)) return "warn";
  return "info";
}

function shortId(value?: string | null) {
  if (!value) return "—";
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function extractIds(message: string) {
  const orderMatch = message.match(/\border(?:[_\s-]?id)?\s*[:=]?\s*([a-z0-9_-]{6,})/i);
  const linkMatch = message.match(/\b(?:order)?link(?:[_\s-]?id)?\s*[:=]?\s*([a-z0-9_-]{6,})/i);
  return {
    orderId: orderMatch?.[1] ?? null,
    linkId: linkMatch?.[1] ?? null,
  };
}

function formatClock(timestamp: string) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function copyText(value?: string | null) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // no-op
  }
}

export default function LogsPanel({
  logEntries,
  logsLoaded,
  useTestnet,
  isActive,
}: LogsPanelProps) {
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  const filteredEntries = useMemo(() => {
    const list = logEntries ?? [];
    if (levelFilter === "all") return list;
    return list.filter((entry) => levelForEntry(entry) === levelFilter);
  }, [logEntries, levelFilter]);

  useEffect(() => {
    if (!scrollRef.current || !stickToBottom) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filteredEntries, stickToBottom]);

  useEffect(() => {
    if (!isActive || !scrollRef.current) return;
    setStickToBottom(true);
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [isActive]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setStickToBottom(scrollHeight - scrollTop - clientHeight < 12);
  };

  return (
    <Panel
      title="Logs"
      description={`Live feed and system events (${useTestnet ? "DEMO" : "MAINNET"}).`}
      action={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filter</span>
          <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
            <Button
              variant={levelFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("all")}
              className={
                levelFilter === "all"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              All
            </Button>
            <Button
              variant={levelFilter === "blocked" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("blocked")}
              className={
                levelFilter === "blocked"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Blocked
            </Button>
            <Button
              variant={levelFilter === "error" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("error")}
              className={
                levelFilter === "error"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Error
            </Button>
            <Button
              variant={levelFilter === "warn" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("warn")}
              className={
                levelFilter === "warn"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Warn
            </Button>
            <Button
              variant={levelFilter === "info" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("info")}
              className={
                levelFilter === "info"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }
            >
              Info
            </Button>
          </div>
        </div>
      }
    >
      {!logsLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Loading logs...
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          No log activity yet.
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="max-h-[520px] overflow-y-auto pr-2"
        >
          <div className="space-y-3">
            {filteredEntries.map((entry) => {
              const level = levelForEntry(entry);
              const ids = extractIds(entry.message);
              const orderId = ids.orderId;
              const linkId = ids.linkId;
              return (
                <div
                  key={entry.id}
                  className="rounded-lg border border-border/60 bg-background/40 px-3 py-3 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-[52px] tabular-nums text-[11px] text-muted-foreground">
                      {formatClock(entry.timestamp)}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        level === "error"
                          ? "border-red-500/50 text-red-400"
                          : level === "blocked"
                            ? "border-orange-500/50 text-orange-400"
                            : level === "warn"
                              ? "border-amber-500/50 text-amber-400"
                              : "border-border/60 text-muted-foreground"
                      }
                    >
                      {entry.action}
                    </Badge>
                    <div className="min-w-0 flex-1 text-foreground">{entry.message}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span>order: {shortId(orderId)}</span>
                      {orderId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => copyText(orderId)}
                          title="Copy order id"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <span>link: {shortId(linkId)}</span>
                      {linkId ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => copyText(linkId)}
                          title="Copy link id"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
