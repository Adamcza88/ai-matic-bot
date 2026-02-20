import { useMemo } from "react";
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
        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="[&>th]:py-2 [&>th]:px-3 [&>th]:text-left border-b border-border/60">
                <th>Trh</th>
                <th>Stav</th>
                <th>Feed age</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {rows.map((row) => {
                const selected = selectedSymbol === row.symbol;
                return (
                  <tr
                    key={row.symbol}
                    onClick={() => onSelectSymbol(row.symbol)}
                    className={`border-b border-border/40 cursor-pointer ${selected ? "bg-background/45" : "hover:bg-background/25"}`}
                  >
                    <td className="px-3 py-2 font-mono">{row.symbol}</td>
                    <td className="px-3 py-2">
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
                    <td className={`px-3 py-2 text-xs tabular-nums ${feedToneClass(row.feedAgeMs)}`}>
                      {formatFeedAge(row.feedAgeMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
