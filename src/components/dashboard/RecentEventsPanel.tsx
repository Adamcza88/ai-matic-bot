import { useMemo, useState } from "react";
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

type EventRow = {
  id: string;
  timestamp: string;
  action: LogEntry["action"];
  symbol: string;
  verdict: string;
  message: string;
  count: number;
};

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

function riskReason(message: string) {
  const text = String(message ?? "").toLowerCase();
  if (text.includes("open pos/order") || text.includes("open position") || text.includes("pozice")) {
    return "open position";
  }
  if (text.includes("exec off")) return "execution off";
  return compactMessage(message, 70);
}

export default function RecentEventsPanel({
  logEntries,
  logsLoaded,
}: RecentEventsPanelProps) {
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const filtered = useMemo(() => {
    const list = (logEntries ?? []).slice(0, 200);
    const scoped = eventFilter === "all" ? list : list.filter((entry) => eventGroup(entry) === eventFilter);

    const rows: EventRow[] = [];
    const byKey = new Map<string, EventRow>();

    for (const entry of scoped) {
      const symbol = extractSymbol(entry.message);
      const verdict = verdictFor(entry);
      const normalized = compactMessage(entry.message);

      if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT") {
        const reason = riskReason(entry.message);
        const key = `${entry.action}|${symbol}|${reason}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.count += 1;
          continue;
        }
        const row: EventRow = {
          id: key,
          timestamp: entry.timestamp,
          action: entry.action,
          symbol,
          verdict,
          message: reason,
          count: 1,
        };
        byKey.set(key, row);
        rows.push(row);
        continue;
      }

      rows.push({
        id: entry.id,
        timestamp: entry.timestamp,
        action: entry.action,
        symbol,
        verdict,
        message: normalized,
        count: 1,
      });
    }

    return rows;
  }, [eventFilter, logEntries]);

  return (
    <Panel
      title="Poslední události"
      description="Agregovaný stream riziko, příkazy a engine."
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
        <div className="max-h-[240px] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[54px,118px,126px,1fr] items-start gap-2 rounded-lg border border-border/60 bg-card/80 px-2.5 py-2 text-xs"
                title={entry.message}
              >
                <div className="tabular-nums text-muted-foreground">{formatClock(entry.timestamp)}</div>
                <Badge variant="outline" className="justify-center border-border/60 text-[10px]">
                  {entry.action}
                </Badge>
                <div className="font-mono text-foreground">
                  {entry.symbol} · {entry.verdict}
                  {entry.count > 1 ? ` ×${entry.count}` : ""}
                </div>
                <div className="text-muted-foreground">
                  {entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT"
                    ? `(${entry.message})`
                    : entry.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
