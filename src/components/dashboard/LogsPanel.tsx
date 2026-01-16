import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LogEntry } from "@/types";
import Panel from "@/components/dashboard/Panel";

type LogsPanelProps = {
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
  useTestnet: boolean;
};

type LevelFilter = "all" | "info" | "warn" | "error";

function levelForEntry(entry: LogEntry): "info" | "warn" | "error" {
  if (entry.action === "ERROR") return "error";
  if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT") {
    return "warn";
  }
  if (entry.action === "REJECT") return "warn";
  return "info";
}

export default function LogsPanel({
  logEntries,
  logsLoaded,
  useTestnet,
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

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setStickToBottom(scrollHeight - scrollTop - clientHeight < 12);
  };

  return (
    <Panel
      title="Logs"
      description="Live feed and system events."
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
          </div>
        </div>
      }
    >
      {useTestnet ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Live feed is hidden on Demo. Switch to Mainnet to view logs.
        </div>
      ) : !logsLoaded ? (
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
          <div className="space-y-2">
            {filteredEntries.map((entry) => {
              const level = levelForEntry(entry);
              return (
                <div
                  key={entry.id}
                  className="flex gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
                >
                  <div className="w-20 font-mono text-[11px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      level === "error"
                        ? "border-red-500/50 text-red-400"
                        : level === "warn"
                          ? "border-amber-500/50 text-amber-400"
                          : "border-border/60 text-muted-foreground"
                    }
                  >
                    {entry.action}
                  </Badge>
                  <div className="text-foreground">{entry.message}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
