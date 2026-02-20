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

type EventRow = {
  id: string;
  timestamp: string;
  action: LogEntry["action"];
  symbol: string;
  verdict: string;
  message: string;
  count: number;
};
const EVENT_TRACE_PAGE_SIZE = 10;

function isRiskLikeStatus(entry: LogEntry) {
  if (entry.action !== "STATUS") return false;
  const text = String(entry.message ?? "").toLowerCase();
  return (
    text.includes("skip entry") ||
    text.includes("entry blocked") ||
    text.includes("signal_relay_paused") ||
    text.includes("gate [max_")
  );
}

function eventGroup(entry: LogEntry): EventFilter {
  if (entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT" || isRiskLikeStatus(entry)) return "risk";
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
  if (entry.action === "RISK_BLOCK" || isRiskLikeStatus(entry)) return "NO TRADE";
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
  const gateMatch = message.match(/gate\s+\[([A-Z_+]+)\]:\s*(.+?)\s*->\s*skip entry/i);
  if (gateMatch) return `${gateMatch[1]} ${compactMessage(gateMatch[2], 50)}`;
  if (text.includes("max_pos") || text.includes("max pozic")) return "max positions reached";
  if (text.includes("max_orders") || text.includes("max order")) return "max orders reached";
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
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const list = (logEntries ?? []).slice(0, 200);
    const scoped = eventFilter === "all" ? list : list.filter((entry) => eventGroup(entry) === eventFilter);

    const rows: EventRow[] = [];
    const byKey = new Map<string, EventRow>();

    for (const entry of scoped) {
      const symbol = extractSymbol(entry.message);
      const verdict = verdictFor(entry);
      const normalized = compactMessage(entry.message);
      const riskLike = entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT" || isRiskLikeStatus(entry);

      if (riskLike) {
        const reason = riskReason(entry.message);
        const key = `${symbol}|${reason}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.count += 1;
          continue;
        }
        const row: EventRow = {
          id: key,
          timestamp: entry.timestamp,
          action: "RISK_BLOCK",
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
  }, [filtered.length]);

  useEffect(() => {
    setPage(0);
  }, [eventFilter]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages - 1));
  }, [totalPages]);

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
        <div className="space-y-2">
          <div className="h-[320px] overflow-hidden rounded-lg border border-border/60">
            <div className="divide-y divide-border/60">
              {pageRows.map((entry) => (
                <div
                  key={entry.id}
                  className="grid h-8 grid-cols-[54px_106px_126px_minmax(0,1fr)] items-center gap-2 bg-card/80 px-2 text-xs"
                  title={entry.message}
                >
                  <div className="tabular-nums leading-6 text-muted-foreground">
                    {formatClock(entry.timestamp)}
                  </div>
                  <Badge
                    variant="outline"
                    className="h-5 justify-center border-border/60 px-1.5 text-[10px] leading-4"
                  >
                    {entry.action}
                  </Badge>
                  <div className="min-w-0 font-mono text-foreground leading-6 truncate">
                    {entry.symbol} · {entry.verdict}
                    {entry.count > 1 ? ` ×${entry.count}` : ""}
                  </div>
                  <div className="min-w-0 text-muted-foreground leading-6 truncate">
                    {entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT"
                      ? `(${entry.message})`
                      : entry.message}
                  </div>
                </div>
              ))}
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
              Prev
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
              Next
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
