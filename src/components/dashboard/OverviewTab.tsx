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
  useTestnet: boolean;
  onOpenSettings: () => void;
};

function gateSummary(diag: any, scanLoaded: boolean) {
  if (!scanLoaded || !diag) {
    return { label: "Gate: —", blocked: false };
  }
  const hardEnabled = diag?.hardEnabled !== false;
  const softEnabled = diag?.softEnabled !== false;
  const hardBlocked = Boolean(diag?.hardBlocked);
  const softBlocked = softEnabled && diag?.qualityPass === false;
  const execBlocked = diag?.executionAllowed === false;
  const gateBlocked = Array.isArray(diag?.gates)
    ? diag.gates.some((g: any) => g?.ok === false)
    : false;
  const blocked =
    (hardEnabled && hardBlocked) || softBlocked || execBlocked || gateBlocked;
  return {
    label: blocked ? "Gate: BLOCKED" : "Gate: PASS",
    blocked,
  };
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
  useTestnet,
  onOpenSettings,
}: OverviewTabProps) {
  const lastScanLabel = lastScanTs
    ? new Date(lastScanTs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  const signalRows = useMemo(() => {
    return allowedSymbols
      .map((symbol) => {
        const diag = scanDiagnostics?.[symbol];
        const signalActive = Boolean(diag?.signalActive);
        const feedAgeMs = diag?.feedAgeMs;
        const feedAgeOk = diag?.feedAgeOk;
        const gate = gateSummary(diag, scanLoaded);
        return {
          symbol,
          signalActive,
          feedAgeMs,
          feedAgeOk,
          gate,
          qualityScore: diag?.qualityScore ?? null,
        };
      })
      .sort((a, b) => {
        if (a.signalActive !== b.signalActive) {
          return a.signalActive ? -1 : 1;
        }
        return (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
      })
      .slice(0, 6);
  }, [allowedSymbols, scanDiagnostics, scanLoaded]);

  const recentEvents = (logEntries ?? []).slice(0, 3);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
      <div className="space-y-6">
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
              <span className="text-muted-foreground">Symbols</span>
              <span className="font-mono text-right text-xs text-foreground">
                {allowedSymbols.join(", ")}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Timeframes</span>
              <span className="text-right text-xs max-w-[70ch]">
                {profileMeta.timeframes}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Session</span>
              <span className="text-right text-xs max-w-[70ch]">
                {profileMeta.session}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Risk</span>
              <span className="text-right text-xs max-w-[70ch]">
                {profileMeta.risk}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Entry</span>
              <span className="text-right text-xs max-w-[70ch]">
                {profileMeta.entry}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-muted-foreground">Execution</span>
              <span className="text-right text-xs max-w-[70ch]">
                {profileMeta.execution}
              </span>
            </div>
          </div>
        </Panel>

        <Panel
          title="Asset PnL history"
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
          ) : !assetPnlHistory || Object.keys(assetPnlHistory).length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              No PnL history yet.
            </div>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {Object.entries(assetPnlHistory)
                .sort((a, b) => {
                  const latestA = a[1]?.[0]?.timestamp
                    ? Date.parse(a[1][0].timestamp)
                    : 0;
                  const latestB = b[1]?.[0]?.timestamp
                    ? Date.parse(b[1][0].timestamp)
                    : 0;
                  return latestB - latestA;
                })
                .map(([symbol, records]) => {
                  const latest = records[0];
                  const resetRecord = records.find((r) => r.note === "RESET");
                  const baselineTs = resetRecord?.timestamp
                    ? Date.parse(resetRecord.timestamp)
                    : Number.NEGATIVE_INFINITY;
                  const sum = records.reduce((acc, r) => {
                    const ts = Date.parse(r.timestamp);
                    if (Number.isFinite(baselineTs) && Number.isFinite(ts)) {
                      if (ts < baselineTs) return acc;
                    }
                    return Number.isFinite(r.pnl) ? acc + r.pnl : acc;
                  }, 0);
                  const latestPnl =
                    latest && Number.isFinite(latest.pnl) ? latest.pnl : null;
                  return (
                    <div
                      key={symbol}
                      className="rounded-lg border border-border/60 bg-background/40 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs">{symbol}</span>
                        <span
                          className={`font-mono text-xs ${
                            sum >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {sum >= 0 ? "+" : ""}
                          {sum.toFixed(2)} USD
                        </span>
                      </div>
                      {latest && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Last: {latestPnl != null ? (latestPnl >= 0 ? "+" : "") : ""}
                          {latestPnl != null ? latestPnl.toFixed(2) : "—"} ·{" "}
                          {latest.timestamp
                            ? new Date(latest.timestamp).toLocaleString()
                            : "—"}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel
          title="Top signals"
          description={`Last scan: ${lastScanLabel}`}
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
            <div className="space-y-2">
              {signalRows.map((row) => (
                <div
                  key={row.symbol}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
                >
                  <div className="font-mono">{row.symbol}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge
                      variant="outline"
                      className={
                        row.signalActive
                          ? "border-emerald-500/50 text-emerald-400"
                          : "border-border/60 text-muted-foreground"
                      }
                    >
                      {row.signalActive ? "Active" : "Idle"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        row.gate.blocked
                          ? "border-red-500/50 text-red-400"
                          : "border-emerald-500/50 text-emerald-400"
                      }
                    >
                      {row.gate.label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        row.feedAgeOk === false
                          ? "border-red-500/50 text-red-400"
                          : "border-border/60 text-muted-foreground"
                      }
                    >
                      {row.feedAgeMs != null && Number.isFinite(row.feedAgeMs)
                        ? `${row.feedAgeMs} ms`
                        : "Feed age —"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Recent events">
          {useTestnet ? (
            <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
              Live feed is hidden on Testnet.
            </div>
          ) : !logsLoaded ? (
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
                  <div className="w-20 font-mono text-[11px] text-muted-foreground">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
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
