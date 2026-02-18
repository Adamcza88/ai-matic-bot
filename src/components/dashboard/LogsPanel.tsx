import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import type { LogEntry } from "@/types";
import Panel from "@/components/dashboard/Panel";
import { formatClock } from "@/lib/uiFormat";

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
      title="Logy"
      description={`Live feed a systémové události (${useTestnet ? "DEMO" : "MAINNET"}).`}
      fileId="AUDIT MODULE ID: TR-07-L"
      action={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filtr</span>
          <div className="flex items-center rounded-md border border-border/60 bg-card/95 p-0.5 dm-surface-elevated dm-border-soft">
            <Button
              variant={levelFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("all")}
              className={`dm-button-control ${
                levelFilter === "all"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Vše
            </Button>
            <Button
              variant={levelFilter === "blocked" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("blocked")}
              className={`dm-button-control ${
                levelFilter === "blocked"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Blokace
            </Button>
            <Button
              variant={levelFilter === "error" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("error")}
              className={`dm-button-control ${
                levelFilter === "error"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Chyba
            </Button>
            <Button
              variant={levelFilter === "warn" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("warn")}
              className={`dm-button-control ${
                levelFilter === "warn"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Varování
            </Button>
            <Button
              variant={levelFilter === "info" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("info")}
              className={`dm-button-control ${
                levelFilter === "info"
                  ? "bg-muted text-foreground dm-button-control-active"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Info
            </Button>
          </div>
        </div>
      }
    >
      {!logsLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Načítám logy…
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Zatím bez logů pro tento filtr.
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
                  className="rounded-lg border border-border/70 bg-card/96 px-3 py-3 text-xs dm-surface-elevated"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="w-[52px] tabular-nums text-[11px] text-muted-foreground">
                      {formatClock(entry.timestamp)}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        level === "error"
                          ? "border-red-500/50 text-red-400 dm-status-sell"
                          : level === "blocked"
                            ? "border-orange-500/50 text-orange-400 dm-status-warn"
                            : level === "warn"
                              ? "border-amber-500/50 text-amber-400 dm-status-warn"
                              : "border-border/60 text-muted-foreground dm-status-muted"
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
                          className="h-5 w-5 dm-button-control"
                          onClick={() => copyText(orderId)}
                          title="Kopírovat order id"
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
                          className="h-5 w-5 dm-button-control"
                          onClick={() => copyText(linkId)}
                          title="Kopírovat link id"
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
