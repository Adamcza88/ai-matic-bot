import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AssetPnlMap } from "@/lib/pnlHistory";
import type { LogEntry } from "@/types";
import Panel from "@/components/dashboard/Panel";

type ProfileMeta = {
  label: string;
  subtitle: string;
  symbols: string[];
  timeframes: string;
  session: string;
  risk: string;
  riskPct?: number;
  entry: string;
  execution: string;
};

type OverviewTabProps = {
  profileMeta: ProfileMeta;
  allowedSymbols: string[];
  assetPnlHistory: AssetPnlMap | null;
  pnlLoaded: boolean;
  resetPnlHistory: () => void;
  scanDiagnostics: Record<string, any> | null;
  scanLoaded: boolean;
  lastScanTs: number | null;
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
  totalCapital?: number;
  riskPerTradePct?: number;
  onOpenSettings: () => void;
};

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value?: number) {
  return Number.isFinite(value) ? USD_FORMATTER.format(value as number) : "—";
}

function formatSignedMoney(value?: number) {
  if (!Number.isFinite(value)) return "—";
  const resolved = value as number;
  return `${resolved >= 0 ? "+" : ""}${USD_FORMATTER.format(resolved)}`;
}

function formatPct(value?: number) {
  if (!Number.isFinite(value)) return "—";
  return `${((value as number) * 100).toFixed(2)}%`;
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
    return { label: "—", tone: "na" as const };
  }
  if (!diag?.signalActive) {
    return { label: "—", tone: "na" as const };
  }
  if (diag?.executionAllowed === false) {
    return { label: "BLOCKED", tone: "blocked" as const };
  }
  if (diag?.executionAllowed === true) {
    return { label: "PASS", tone: "pass" as const };
  }
  return { label: "—", tone: "na" as const };
}

function normalizeBlockReason(reason?: string) {
  if (!reason) return "No execution reason.";
  if (reason === "Exec OFF") return "Execution mode is manual.";
  if (reason === "čeká na signál") return "No active signal.";
  return reason;
}

export default function OverviewTab({
  profileMeta,
  allowedSymbols,
  assetPnlHistory,
  pnlLoaded,
  resetPnlHistory,
  scanDiagnostics,
  scanLoaded,
  lastScanTs,
  logEntries,
  logsLoaded,
  totalCapital,
  riskPerTradePct,
  onOpenSettings,
}: OverviewTabProps) {
  const lastScanLabel = formatClock(lastScanTs);

  const signalRows = useMemo(() => {
    return allowedSymbols
      .map((symbol) => {
        const diag = scanDiagnostics?.[symbol];
        const signalActive = Boolean(diag?.signalActive);
        const gate = gateSummary(diag, scanLoaded);
        return {
          symbol,
          signalActive,
          gate,
          feedAgeMs: diag?.feedAgeMs,
          feedAgeOk: diag?.feedAgeOk,
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

  const activeBlocks = useMemo(() => {
    return signalRows
      .filter((row) => row.gate.tone === "blocked")
      .slice(0, 3);
  }, [signalRows]);

  const pnlRows = useMemo(() => {
    if (!assetPnlHistory) return [];
    return Object.entries(assetPnlHistory)
      .map(([symbol, records]) => {
        const latest = records[0];
        const resetRecord = records.find((r) => r.note === "RESET");
        const baselineTs = resetRecord?.timestamp
          ? Date.parse(resetRecord.timestamp)
          : Number.NEGATIVE_INFINITY;
        const sum = records.reduce((acc, r) => {
          const ts = Date.parse(r.timestamp);
          if (Number.isFinite(baselineTs) && Number.isFinite(ts) && ts < baselineTs) {
            return acc;
          }
          return Number.isFinite(r.pnl) ? acc + r.pnl : acc;
        }, 0);
        return {
          symbol,
          netPnl: sum,
          latestPnl:
            latest && Number.isFinite(latest.pnl) ? latest.pnl : Number.NaN,
          lastTs: latest?.timestamp ?? "",
        };
      })
      .sort((a, b) => a.netPnl - b.netPnl);
  }, [assetPnlHistory]);

  const historicalSymbols = useMemo(() => {
    if (!assetPnlHistory) return [];
    return Object.keys(assetPnlHistory).sort();
  }, [assetPnlHistory]);

  const recentEvents = (logEntries ?? []).slice(0, 5);
  const riskPerTradeUsd =
    Number.isFinite(totalCapital) && Number.isFinite(riskPerTradePct)
      ? (totalCapital as number) * (riskPerTradePct as number)
      : Number.NaN;

  return (
    <div className="space-y-6">
      <Panel
        title="Why not trading now"
        description={`Last scan: ${lastScanLabel}`}
      >
        {!scanLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Loading gate diagnostics...
          </div>
        ) : activeBlocks.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-3 text-xs text-muted-foreground">
            No active execution block. Signals are idle or waiting for confirmation.
          </div>
        ) : (
          <div className="space-y-2">
            {activeBlocks.map((row) => (
              <div
                key={row.symbol}
                className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs"
              >
                <div className="font-mono text-foreground">{row.symbol}</div>
                <div className="mt-1 text-muted-foreground">{row.executionReason}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
        <Panel
          title="Strategy profile"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenSettings}
              className="h-8 text-xs"
            >
              Settings
            </Button>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Profile</span>
              <Badge variant="outline" className="border-emerald-500/50 text-emerald-400">
                {profileMeta.label}
              </Badge>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Timeframes</span>
              <span className="max-w-[70ch] text-right text-xs">{profileMeta.timeframes}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Session priority</span>
              <span className="max-w-[70ch] text-right text-xs">{profileMeta.session}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Risk</span>
              <span className="max-w-[70ch] text-right text-xs">
                {profileMeta.risk}
                <br />
                {formatPct(riskPerTradePct)} (≈ {formatMoney(riskPerTradeUsd)})
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Entry model</span>
              <span className="max-w-[70ch] text-right text-xs">{profileMeta.entry}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Execution rules</span>
              <span className="max-w-[70ch] text-right text-xs">{profileMeta.execution}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Trading universe</span>
              <span className="max-w-[70ch] text-right font-mono text-xs text-foreground">
                {allowedSymbols.join(", ")}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Historically traded</span>
              <span className="max-w-[70ch] text-right font-mono text-xs text-foreground">
                {historicalSymbols.length ? historicalSymbols.join(", ") : "N/A"}
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Signals" description={`Last scan: ${lastScanLabel}`}>
          {!scanLoaded ? (
            <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              Loading signal diagnostics...
            </div>
          ) : signalRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              No signal diagnostics yet.
            </div>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-[460px] text-xs">
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
                    <tr key={row.symbol} className="border-b border-border/40">
                      <td className="py-2 pr-2 font-mono">{row.symbol}</td>
                      <td className="py-2 pr-2">
                        <Badge
                          variant="outline"
                          className={
                            row.signalActive
                              ? "border-emerald-500/50 text-emerald-400"
                              : "border-border/60 text-muted-foreground"
                          }
                        >
                          {row.signalActive ? "Skenuje" : "Idle"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-2">
                        <Badge
                          variant="outline"
                          className={
                            row.gate.tone === "blocked"
                              ? "border-red-500/50 text-red-400"
                              : row.gate.tone === "pass"
                                ? "border-emerald-500/50 text-emerald-400"
                                : "border-border/60 text-muted-foreground"
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
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,1fr]">
        <Panel
          title="PnL history by symbol"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={resetPnlHistory}
              className="h-8 text-xs"
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
            <div className="max-h-72 overflow-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground">
                    <th className="py-2 pr-2 text-left font-medium">Symbol</th>
                    <th className="py-2 pr-2 text-right font-medium">Net PnL</th>
                    <th className="py-2 pr-2 text-right font-medium">Last</th>
                    <th className="py-2 text-right font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {pnlRows.map((row) => (
                    <tr key={row.symbol} className="border-b border-border/40">
                      <td className="py-2 pr-2 font-mono">{row.symbol}</td>
                      <td
                        className={`py-2 pr-2 text-right tabular-nums ${
                          row.netPnl >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {formatSignedMoney(row.netPnl)}
                      </td>
                      <td
                        className={`py-2 pr-2 text-right tabular-nums ${
                          row.latestPnl >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {formatSignedMoney(row.latestPnl)}
                      </td>
                      <td
                        className="py-2 text-right tabular-nums text-muted-foreground"
                        title={row.lastTs || ""}
                      >
                        {row.lastTs ? formatClock(Date.parse(row.lastTs)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Recent events">
          {!logsLoaded ? (
            <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              Loading events...
            </div>
          ) : recentEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              No recent events.
            </div>
          ) : (
            <div className="space-y-2">
              {recentEvents.map((entry) => (
                <div
                  key={entry.id}
                  className="flex gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
                >
                  <div
                    className="w-14 tabular-nums text-[11px] text-muted-foreground"
                    title={new Date(entry.timestamp).toLocaleString()}
                  >
                    {formatClock(Date.parse(entry.timestamp))}
                  </div>
                  <div className="min-w-[72px] text-[11px] font-semibold uppercase tracking-wide text-sky-400">
                    {entry.action}
                  </div>
                  <div className="text-foreground">{entry.message}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
