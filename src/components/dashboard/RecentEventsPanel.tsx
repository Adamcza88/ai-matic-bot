import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
import type { LogEntry } from "@/types";

type RecentEventsPanelProps = {
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
};

type EventFilter = "all" | "risk" | "orders" | "engine";

function formatClock(timestamp: string) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventGroup(entry: LogEntry): EventFilter {
  if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT") return "risk";
  if (entry.action === "OPEN" || entry.action === "CLOSE" || entry.action === "AUTO_CLOSE") {
    return "orders";
  }
  return "engine";
}

function extractSymbol(message: string) {
  const hit = message.match(/\b[A-Z]{2,10}USDT\b/);
  return hit?.[0] ?? "—";
}

function verdictFor(entry: LogEntry) {
  if (entry.action === "RISK_BLOCK") return "NO TRADE";
  if (entry.action === "RISK_HALT") return "HALTED";
  if (entry.action === "OPEN") return "OPENED";
  if (entry.action === "CLOSE" || entry.action === "AUTO_CLOSE") return "CLOSED";
  if (entry.action === "ERROR") return "ERROR";
  return "INFO";
}

function compactMessage(message: string, max = 120) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export default function RecentEventsPanel({
  logEntries,
  logsLoaded,
}: RecentEventsPanelProps) {
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const filtered = useMemo(() => {
    const list = (logEntries ?? []).slice(0, 120);
    if (eventFilter === "all") return list;
    return list.filter((entry) => eventGroup(entry) === eventFilter);
  }, [eventFilter, logEntries]);

  return (
    <Panel
      title="Recent events"
      description="Compact event stream with risk/order/engine filters."
      fileId="EVENT TRACE ID: TR-11-E"
      action={
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-card/80 p-0.5">
          <Button
            variant={eventFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEventFilter("all")}
          >
            All
          </Button>
          <Button
            variant={eventFilter === "risk" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEventFilter("risk")}
          >
            Risk
          </Button>
          <Button
            variant={eventFilter === "orders" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEventFilter("orders")}
          >
            Orders
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
          Loading events...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          No events for this filter.
        </div>
      ) : (
        <div className="max-h-[240px] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[54px,118px,96px,1fr] items-start gap-2 rounded-lg border border-border/60 bg-card/80 px-2.5 py-2 text-xs"
                title={entry.message}
              >
                <div className="tabular-nums text-muted-foreground">{formatClock(entry.timestamp)}</div>
                <Badge variant="outline" className="justify-center border-border/60 text-[10px]">
                  {entry.action}
                </Badge>
                <div className="font-mono text-foreground">
                  {extractSymbol(entry.message)} · {verdictFor(entry)}
                </div>
                <div className="text-muted-foreground">{compactMessage(entry.message)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
