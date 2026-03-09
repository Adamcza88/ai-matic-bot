import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
import type { LogEntry } from "@/types";
import { formatClock } from "@/lib/uiFormat";

type RecentEventsPanelProps = {
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
};

type EventFilter = "all" | "risk" | "orders" | "engine";
type EventStage = "SCAN" | "SIGNAL" | "RISK CHECK" | "ORDER" | "POSITION";

type EventRow = {
  id: string;
  timestamp: string;
  symbol: string;
  action: LogEntry["action"];
  stage: EventStage;
  message: string;
};

const EVENT_TRACE_PAGE_SIZE = 12;

function compactMessage(message: string, max = 140) {
  const normalized = String(message ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function extractSymbol(message: string) {
  const hit = String(message ?? "").match(/\b[A-Z]{2,10}USDT\b/);
  return hit?.[0] ?? "—";
}

function eventGroup(entry: LogEntry): EventFilter {
  if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT" || entry.action === "REJECT") {
    return "risk";
  }
  if (entry.action === "OPEN" || entry.action === "CLOSE" || entry.action === "AUTO_CLOSE") {
    return "orders";
  }
  return "engine";
}

function stageFor(entry: LogEntry): EventStage {
  const msg = String(entry.message ?? "").toLowerCase();
  if (entry.action === "SIGNAL" || msg.includes("signal")) return "SIGNAL";
  if (
    entry.action === "RISK_BLOCK" ||
    entry.action === "RISK_HALT" ||
    entry.action === "REJECT" ||
    msg.includes("risk") ||
    msg.includes("gate")
  ) {
    return "RISK CHECK";
  }
  if (entry.action === "OPEN" || entry.action === "CLOSE" || entry.action === "AUTO_CLOSE" || msg.includes("position")) {
    return "POSITION";
  }
  if (msg.includes("order")) return "ORDER";
  return "SCAN";
}

function stageTone(stage: EventStage) {
  if (stage === "SIGNAL") return "border-sky-500/60 text-sky-300";
  if (stage === "RISK CHECK") return "border-orange-500/60 text-orange-300";
  if (stage === "ORDER") return "border-indigo-500/60 text-indigo-300";
  if (stage === "POSITION") return "border-emerald-500/60 text-emerald-300";
  return "border-border/60 text-muted-foreground";
}

export default function RecentEventsPanel({
  logEntries,
  logsLoaded,
}: RecentEventsPanelProps) {
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const list = (logEntries ?? []).slice(0, 240);
    const scoped = eventFilter === "all" ? list : list.filter((entry) => eventGroup(entry) === eventFilter);
    return scoped.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      symbol: extractSymbol(entry.message),
      action: entry.action,
      stage: stageFor(entry),
      message: compactMessage(entry.message),
    })) as EventRow[];
  }, [eventFilter, logEntries]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / EVENT_TRACE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(() => {
    const start = safePage * EVENT_TRACE_PAGE_SIZE;
    return filtered.slice(start, start + EVENT_TRACE_PAGE_SIZE);
  }, [filtered, safePage]);
  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  useEffect(() => {
    setPage(0);
  }, [filtered.length, eventFilter]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages - 1));
  }, [totalPages]);

  return (
    <Panel
      title="Trace událostí"
      description="Tok událostí: SCAN → SIGNAL → RISK CHECK → ORDER → POSITION"
      fileId="EVENT TRACE ID: TR-11-E"
      action={
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-card/80 p-0.5">
          <Button
            variant={eventFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEventFilter("all")}
          >
            Vše
          </Button>
          <Button
            variant={eventFilter === "risk" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEventFilter("risk")}
          >
            Riziko
          </Button>
          <Button
            variant={eventFilter === "orders" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEventFilter("orders")}
          >
            Příkazy
          </Button>
          <Button
            variant={eventFilter === "engine" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEventFilter("engine")}
          >
            Engine
          </Button>
        </div>
      }
    >
      {!logsLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Načítám události…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Pro tento filtr nejsou události.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border/60 bg-background/30 p-2">
            <div className="max-h-[360px] overflow-y-auto pr-1">
              <div className="space-y-0">
                {pageRows.map((entry, index) => {
                  const isLast = index === pageRows.length - 1;
                  return (
                    <div key={entry.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
                      <div className="relative flex justify-center">
                        <span className="mt-3 h-2.5 w-2.5 rounded-full bg-primary/80" />
                        {!isLast ? (
                          <span className="absolute top-6 h-[calc(100%-8px)] w-px bg-border/70" />
                        ) : null}
                      </div>
                      <div className="pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono-ui text-xs tabular-nums text-muted-foreground">
                            {formatClock(entry.timestamp)}
                          </span>
                          <Badge variant="outline" className={`text-[10px] ${stageTone(entry.stage)}`}>
                            {entry.stage}
                          </Badge>
                          <span className="font-mono-ui text-xs text-foreground">
                            {entry.action} {entry.symbol}
                          </span>
                        </div>
                        <div className="mt-1 font-mono-ui text-xs leading-[1.6] text-muted-foreground">
                          {entry.message}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/60 px-1 pt-2 text-xs">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={!canPrev}
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
            >
              Předchozí
            </Button>
            <div className="tabular-nums text-muted-foreground">
              {safePage + 1} / {totalPages}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={!canNext}
              onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
            >
              Další
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
