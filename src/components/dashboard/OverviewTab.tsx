import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssetPnlMap } from "@/lib/pnlHistory";
import Panel from "@/components/dashboard/Panel";

type OverviewTabProps = {
  allowedSymbols: string[];
  assetPnlHistory: AssetPnlMap | null;
  pnlLoaded: boolean;
  resetPnlHistory: () => void;
  scanDiagnostics: Record<string, any> | null;
  scanLoaded: boolean;
  lastScanTs: number | null;
};

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatSignedMoney(value?: number) {
  if (!Number.isFinite(value)) return "—";
  const resolved = value as number;
  return `${resolved >= 0 ? "+" : ""}${USD_FORMATTER.format(resolved).replace(/,/g, " ")}`;
}

function formatClock(ts?: number | null) {
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts as number).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function gateSummary(diag: any, scanLoaded: boolean) {
  if (!scanLoaded || !diag) {
    return { label: "IDLE", tone: "na" as const };
  }
  if (diag?.executionAllowed === false) {
    return { label: "BLOCKED", tone: "blocked" as const };
  }
  if (diag?.executionAllowed === true) {
    return { label: "PASS", tone: "pass" as const };
  }
  return { label: "IDLE", tone: "na" as const };
}

function normalizeBlockReason(reason?: string) {
  if (!reason) return "No execution reason.";
  if (reason === "Exec OFF") return "Execution mode is manual.";
  if (reason === "čeká na signál") return "No active signal.";
  return reason;
}

export default function OverviewTab({
  allowedSymbols,
  assetPnlHistory,
  pnlLoaded,
  resetPnlHistory,
  scanDiagnostics,
  scanLoaded,
  lastScanTs,
}: OverviewTabProps) {
  const signalRows = useMemo(() => {
    return allowedSymbols
      .map((symbol) => {
        const diag = scanDiagnostics?.[symbol];
        return {
          symbol,
          signalActive: Boolean(diag?.signalActive),
          gate: gateSummary(diag, scanLoaded),
          feedAgeMs: diag?.feedAgeMs,
          executionReason: normalizeBlockReason(diag?.executionReason),
          qualityScore: diag?.qualityScore ?? null,
        };
      })
      .sort((a, b) => {
        if (a.gate.tone !== b.gate.tone) {
          if (a.gate.tone === "blocked") return -1;
          if (b.gate.tone === "blocked") return 1;
        }
        if (a.signalActive !== b.signalActive) {
          return a.signalActive ? -1 : 1;
        }
        return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
      });
  }, [allowedSymbols, scanDiagnostics, scanLoaded]);

  const activeBlocks = useMemo(
    () => signalRows.filter((row) => row.gate.tone === "blocked").slice(0, 4),
    [signalRows]
  );

  const pnlRows = useMemo(() => {
    if (!assetPnlHistory) return [];
    return Object.entries(assetPnlHistory)
      .map(([symbol, records]) => {
        const latest = records[0];
        const sum = records.reduce((acc, r) => {
          return Number.isFinite(r.pnl) ? acc + r.pnl : acc;
        }, 0);
        return {
          symbol,
          netPnl: sum,
          latestPnl: latest && Number.isFinite(latest.pnl) ? latest.pnl : Number.NaN,
          lastTs: latest?.timestamp ?? "",
        };
      })
      .sort((a, b) => a.netPnl - b.netPnl);
  }, [assetPnlHistory]);

  return (
    <div className="space-y-4">
      <Panel
        title="Why not trading now"
        description={`Last scan: ${formatClock(lastScanTs)}`}
        fileId="GATE DIAGNOSTICS ID: TR-01-G"
      >
        {!scanLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Loading gate diagnostics...
          </div>
        ) : activeBlocks.length === 0 ? (
          <div className="rounded-lg border border-border/70 bg-card/96 px-3 py-3 text-xs text-muted-foreground">
            No active execution block. Signals are idle or waiting for confirmation.
          </div>
        ) : (
          <div className="space-y-2">
            {activeBlocks.map((row) => (
              <div
                key={row.symbol}
                className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs dm-status-sell"
              >
                <div className="font-mono text-foreground">{row.symbol}</div>
                <div className="mt-1 text-muted-foreground">{row.executionReason}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Signals snapshot"
        description={`Last scan: ${formatClock(lastScanTs)}`}
        fileId="SIGNAL SNAPSHOT ID: TR-14-S"
      >
        {!scanLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Loading signal diagnostics...
          </div>
        ) : signalRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            No signal diagnostics yet.
          </div>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[460px] text-xs lm-table dm-table">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground">
                  <th className="py-2 pr-2 text-left font-medium">Symbol</th>
                  <th className="py-2 pr-2 text-left font-medium">Status</th>
                  <th className="py-2 pr-2 text-left font-medium">Gate</th>
                  <th className="py-2 text-right font-medium">Feed age</th>
                </tr>
              </thead>
              <tbody>
                {signalRows.slice(0, 12).map((row) => (
                  <tr key={row.symbol} className="border-b border-border/40 lm-table-row">
                    <td className="py-2 pr-2 font-mono">{row.symbol}</td>
                    <td className="py-2 pr-2">
                      <Badge
                        variant="outline"
                        className={
                          row.signalActive
                            ? "border-emerald-500/50 text-emerald-400 dm-status-pass"
                            : "border-border/60 text-muted-foreground dm-status-muted"
                        }
                      >
                        {row.signalActive ? "Scanning" : "Idle"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-2">
                      <Badge
                        variant="outline"
                        className={
                          row.gate.tone === "blocked"
                            ? "border-red-500/50 text-red-400 dm-status-sell"
                            : row.gate.tone === "pass"
                              ? "border-emerald-500/50 text-emerald-400 dm-status-pass"
                              : "border-border/60 text-muted-foreground dm-status-muted"
                        }
                      >
                        {row.gate.label}
                      </Badge>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {row.feedAgeMs != null && Number.isFinite(row.feedAgeMs)
                        ? `${row.feedAgeMs} ms`
                        : "N/A"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="PnL history by symbol"
        fileId="LEDGER ARCHIVE ID: TR-10-H"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={resetPnlHistory}
            className="h-8 text-xs dm-button-control"
          >
            Reset
          </Button>
        }
      >
        {!pnlLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Loading PnL history...
          </div>
        ) : pnlRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            No PnL history yet.
          </div>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[520px] text-xs lm-table dm-table">
              <thead>
                <tr className="border-b border-border/60 text-muted-foreground">
                  <th className="py-2 pr-2 text-left font-medium">Symbol</th>
                  <th className="py-2 pr-2 text-right font-medium">Net PnL</th>
                  <th className="py-2 pr-2 text-right font-medium">Last</th>
                </tr>
              </thead>
              <tbody>
                {pnlRows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border/40 lm-table-row">
                    <td className="py-2 pr-2 font-mono">{row.symbol}</td>
                    <td
                      className={`py-2 pr-2 text-right tabular-nums ${
                        row.netPnl >= 0
                          ? "text-emerald-300 dm-pnl-positive"
                          : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative"
                      }`}
                    >
                      {formatSignedMoney(row.netPnl)}
                    </td>
                    <td
                      className={`py-2 pr-2 text-right tabular-nums ${
                        row.latestPnl >= 0
                          ? "text-emerald-300 dm-pnl-positive"
                          : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative"
                      }`}
                    >
                      {formatSignedMoney(row.latestPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
