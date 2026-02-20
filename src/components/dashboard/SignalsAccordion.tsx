import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
import type { ScanDiagnostics, SymbolDiagnostic } from "@/lib/diagnosticsTypes";

type SignalsAccordionProps = {
  allowedSymbols: string[];
  scanDiagnostics: ScanDiagnostics | null;
  scanLoaded: boolean;
  scanAgeOffsetMs?: number;
  loading?: boolean;
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
};

const FEED_OK_MS = 2_000;
const FEED_WARN_MS = 10_000;
const SIGNAL_RELAY_PAGE_SIZE = 7;

function summary(diag: SymbolDiagnostic | undefined, scanLoaded: boolean) {
  if (!scanLoaded || !diag) return "IDLE";
  if (diag.relayState === "PAUSED") return "PAUSED";
  if (diag.executionAllowed === true) return "READY";
  if (diag.executionAllowed === false) return "BLOCKED";
  return "WAITING";
}

function feedToneClass(feedAgeMs?: number) {
  if (!Number.isFinite(feedAgeMs)) return "text-muted-foreground";
  if ((feedAgeMs as number) < FEED_OK_MS) return "text-[#00C853]";
  if ((feedAgeMs as number) <= FEED_WARN_MS) return "text-[#FFB300]";
  return "text-[#D32F2F]";
}

function formatFeedAge(feedAgeMs?: number) {
  if (!Number.isFinite(feedAgeMs)) return "N/A";
  const ms = feedAgeMs as number;
  if (ms > FEED_WARN_MS) return `${(ms / 1000).toFixed(1)} s · STALE`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function SignalsAccordion({
  allowedSymbols,
  scanDiagnostics,
  scanLoaded,
  scanAgeOffsetMs,
  loading,
  selectedSymbol,
  onSelectSymbol,
}: SignalsAccordionProps) {
  const [page, setPage] = useState(0);
  const rows = useMemo(
    () =>
      allowedSymbols
        .map((symbol) => {
          const diag = scanDiagnostics?.[symbol];
          return {
            symbol,
            state: summary(diag, scanLoaded),
            feedAgeMs:
              Number.isFinite(Number(diag?.feedAgeMs))
                ? Number(diag?.feedAgeMs) + Math.max(0, scanAgeOffsetMs ?? 0)
                : Number.NaN,
          };
        })
        .sort((a, b) => {
          const aAge = Number.isFinite(a.feedAgeMs) ? a.feedAgeMs : -1;
          const bAge = Number.isFinite(b.feedAgeMs) ? b.feedAgeMs : -1;
          if (bAge !== aAge) return bAge - aAge;
          if (a.state !== b.state) {
            if (a.state === "PAUSED") return -1;
            if (b.state === "PAUSED") return 1;
            if (a.state === "BLOCKED") return -1;
            if (b.state === "BLOCKED") return 1;
          }
          return a.symbol.localeCompare(b.symbol);
        }),
    [allowedSymbols, scanAgeOffsetMs, scanDiagnostics, scanLoaded]
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / SIGNAL_RELAY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(() => {
    const start = safePage * SIGNAL_RELAY_PAGE_SIZE;
    return rows.slice(start, start + SIGNAL_RELAY_PAGE_SIZE);
  }, [rows, safePage]);
  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  useEffect(() => {
    setPage(0);
  }, [rows.length]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages - 1));
  }, [totalPages]);

  return (
    <Panel
      title="Signal Relay"
      description="Stav relaye podle trhu. Důvod blokace je pouze v Gate Engine."
      fileId="SIGNAL RELAY ID: TR-09-S"
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`signals-skeleton-${index}`}
              className="h-9 rounded-md border border-border/60 bg-background/40 tva-skeleton"
            />
          ))}
        </div>
      ) : !scanLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Načítám diagnostiku…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Není vybraný žádný trh.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="h-[320px] overflow-hidden rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-left border-b border-border/60">
                  <th>Trh</th>
                  <th>Stav</th>
                  <th>Feed age</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {pageRows.map((row) => {
                  const selected = selectedSymbol === row.symbol;
                  return (
                    <tr
                      key={row.symbol}
                      onClick={() => onSelectSymbol(row.symbol)}
                      className={`h-10 border-b border-border/40 cursor-pointer ${selected ? "bg-background/45" : "hover:bg-background/25"}`}
                    >
                      <td className="px-3 font-mono leading-6 truncate">{row.symbol}</td>
                      <td className="px-3">
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                            row.state === "READY"
                              ? "border-[#00C853]/60 text-[#00C853]"
                              : row.state === "PAUSED"
                                ? "border-[#FFB300]/60 text-[#FFB300]"
                              : row.state === "BLOCKED"
                                ? "border-[#D32F2F]/60 text-[#D32F2F]"
                                : "border-[#FFB300]/60 text-[#FFB300]"
                          }`}
                        >
                          {row.state}
                        </span>
                      </td>
                      <td className={`px-3 text-xs tabular-nums leading-6 ${feedToneClass(row.feedAgeMs)}`}>
                        {formatFeedAge(row.feedAgeMs)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
