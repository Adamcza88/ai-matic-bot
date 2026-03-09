import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LogEntry } from "@/types";
import Panel from "@/components/dashboard/Panel";
import { formatClock } from "@/lib/uiFormat";

type LogsPanelProps = {
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
  useTestnet: boolean;
  isActive: boolean;
};

type LevelFilter = "all" | "error" | "risk" | "signal" | "status" | "system";
type Tone = "red" | "orange" | "blue" | "gray" | "purple";

function extractSymbol(message: string) {
  const hit = String(message ?? "").match(/\b[A-Z]{2,10}USDT\b/);
  return hit?.[0] ?? "—";
}

function normalizeMessage(message: string) {
  return String(message ?? "").replace(/\s*\|\s*/g, " — ").trim();
}

function levelForEntry(entry: LogEntry): LevelFilter {
  if (entry.action === "ERROR") return "error";
  if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT" || entry.action === "REJECT") {
    return "risk";
  }
  if (entry.action === "SIGNAL") return "signal";
  if (entry.action === "STATUS") return "status";
  return "system";
}

function toneForEntry(entry: LogEntry): Tone {
  if (entry.action === "ERROR") return "red";
  if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT" || entry.action === "REJECT") {
    return "orange";
  }
  if (entry.action === "SIGNAL") return "blue";
  if (entry.action === "STATUS") return "gray";
  return "purple";
}

function toneClasses(tone: Tone) {
  if (tone === "red") {
    return {
      badge: "border-red-500/60 text-red-300",
      row: "border-red-500/30 bg-red-500/5",
    };
  }
  if (tone === "orange") {
    return {
      badge: "border-orange-500/60 text-orange-300",
      row: "border-orange-500/30 bg-orange-500/5",
    };
  }
  if (tone === "blue") {
    return {
      badge: "border-sky-500/60 text-sky-300",
      row: "border-sky-500/30 bg-sky-500/5",
    };
  }
  if (tone === "gray") {
    return {
      badge: "border-border/60 text-slate-300",
      row: "border-border/60 bg-background/35",
    };
  }
  return {
    badge: "border-violet-500/60 text-violet-300",
    row: "border-violet-500/30 bg-violet-500/5",
  };
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
      title="AUDIT MODULE"
      description={`TR-07-L · Strategy decision tracker · ${useTestnet ? "DEMO" : "MAINNET"}`}
      fileId="AUDIT MODULE"
      action={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filter</span>
          <div className="flex items-center rounded-md border border-border/60 bg-card/95 p-0.5 dm-surface-elevated dm-border-soft">
            <Button
              variant={levelFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("all")}
              className="h-7 px-2 text-xs"
            >
              All
            </Button>
            <Button
              variant={levelFilter === "error" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("error")}
              className="h-7 px-2 text-xs"
            >
              ERROR
            </Button>
            <Button
              variant={levelFilter === "risk" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("risk")}
              className="h-7 px-2 text-xs"
            >
              RISK
            </Button>
            <Button
              variant={levelFilter === "signal" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("signal")}
              className="h-7 px-2 text-xs"
            >
              SIGNAL
            </Button>
            <Button
              variant={levelFilter === "status" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("status")}
              className="h-7 px-2 text-xs"
            >
              STATUS
            </Button>
            <Button
              variant={levelFilter === "system" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLevelFilter("system")}
              className="h-7 px-2 text-xs"
            >
              SYSTEM
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
          className="max-h-[520px] overflow-y-auto pr-1"
        >
          <div className="space-y-2">
            {filteredEntries.map((entry) => {
              const tone = toneForEntry(entry);
              const classes = toneClasses(tone);
              const symbol = extractSymbol(entry.message);
              return (
                <div
                  key={entry.id}
                  className={`rounded-lg border px-3 py-2 font-mono-ui text-[12px] leading-[1.6] ${classes.row}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-[48px] tabular-nums text-muted-foreground">
                      {formatClock(entry.timestamp)}
                    </span>
                    <Badge variant="outline" className={`${classes.badge} h-5 px-1.5 text-[10px]`}>
                      {entry.action}
                    </Badge>
                    <span className="font-semibold text-foreground">{symbol}</span>
                  </div>
                  <div className="mt-1 pl-[56px] text-foreground">
                    {normalizeMessage(entry.message)}
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

