import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { AssetPnlMap } from "@/lib/pnlHistory";
import Panel from "@/components/dashboard/Panel";
import { formatClock, formatSignedMoney } from "@/lib/uiFormat";
import type { DiagnosticGate, ScanDiagnostics, SymbolDiagnostic } from "@/lib/diagnosticsTypes";

type OverviewTabProps = {
  allowedSymbols: string[];
  assetPnlHistory: AssetPnlMap | null;
  pnlLoaded: boolean;
  resetPnlHistory: () => void;
  scanDiagnostics: ScanDiagnostics | null;
  scanLoaded: boolean;
  lastScanTs: number | null;
  selectedSymbol: string | null;
};

function normalizeReason(reason?: string) {
  if (!reason) return "Bez aktivní blokace.";
  if (reason === "Exec OFF") return "Execution je vypnutý (manual).";
  if (reason === "čeká na signál") return "Čeká na potvrzení signálu.";
  return reason;
}

function parseRatio(detail?: string) {
  if (!detail) return null;
  const match = detail.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  return `${Number(match[1])}/${Number(match[2])}`;
}

function gateByPrefix(diag: SymbolDiagnostic | undefined, prefix: string) {
  return (Array.isArray(diag?.gates) ? diag.gates : []).find((gate: DiagnosticGate) =>
    gate.name.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

export default function OverviewTab({
  allowedSymbols,
  assetPnlHistory,
  pnlLoaded,
  resetPnlHistory,
  scanDiagnostics,
  scanLoaded,
  lastScanTs,
  selectedSymbol,
}: OverviewTabProps) {
  const activeSymbol = useMemo(() => {
    if (selectedSymbol && allowedSymbols.includes(selectedSymbol)) return selectedSymbol;
    const paused = allowedSymbols.find((symbol) => scanDiagnostics?.[symbol]?.relayState === "PAUSED");
    if (paused) return paused;
    const blocked = allowedSymbols.find((symbol) => scanDiagnostics?.[symbol]?.executionAllowed === false);
    return blocked ?? allowedSymbols[0] ?? null;
  }, [allowedSymbols, scanDiagnostics, selectedSymbol]);

  const activeDiag = activeSymbol ? scanDiagnostics?.[activeSymbol] : undefined;
  const hardGate = gateByPrefix(activeDiag, "Hard:");
  const checklistGate = gateByPrefix(activeDiag, "Checklist:");

  const hardStatus = hardGate?.ok ? "PASS" : "FAIL";
  const checklistScore = parseRatio(checklistGate?.detail) ?? (checklistGate?.ok ? "OK" : "N/A");
  const entryStatus = activeDiag?.relayState === "PAUSED"
    ? "PAUSED"
    : activeDiag?.executionAllowed
      ? "READY"
      : "BLOCKED";
  const skipReasonRaw = String(activeDiag?.skipReason ?? "").trim();
  const skipCodeRaw = String(activeDiag?.skipCode ?? "").trim();
  const skipReason =
    skipReasonRaw && skipCodeRaw
      ? `[${skipCodeRaw}] ${skipReasonRaw}`
      : skipReasonRaw;
  const blockReason = normalizeReason(
    activeDiag?.relayReason ||
    skipReason ||
    (Array.isArray(activeDiag?.entryBlockReasons) ? activeDiag?.entryBlockReasons[0] : "") ||
      activeDiag?.executionReason ||
      activeDiag?.manageReason
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
        };
      })
      .sort((a, b) => a.netPnl - b.netPnl);
  }, [assetPnlHistory]);

  return (
    <div className="space-y-4">
      <Panel
        title="Gate Engine"
        description={`${activeSymbol ? `Trh ${activeSymbol}` : "Není vybraný trh"} · Poslední sken: ${formatClock(lastScanTs)}`}
        fileId="GATE ENGINE ID: TR-01-G"
      >
        {!scanLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám Gate Engine…
          </div>
        ) : !activeSymbol ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Není dostupný žádný trh.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">HARD</div>
              <div className={`mt-1 text-lg font-semibold ${hardStatus === "PASS" ? "text-[#00C853]" : "text-[#D32F2F]"}`}>
                {hardStatus}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">CHECKLIST</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{checklistScore}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">ENTRY</div>
              <div className={`mt-1 text-lg font-semibold ${
                entryStatus === "READY"
                  ? "text-[#00C853]"
                  : entryStatus === "PAUSED"
                    ? "text-[#FFB300]"
                    : "text-[#D32F2F]"
              }`}>
                {entryStatus}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">BLOCK důvod</div>
              <div className="mt-1 text-sm text-foreground">{entryStatus === "READY" ? "Bez blokace." : blockReason}</div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Historie PnL podle trhu"
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
            Načítám historii PnL…
          </div>
        ) : pnlRows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Zatím bez historie PnL.
          </div>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="[&>th]:py-2 [&>th]:px-3 [&>th]:text-left border-b border-border/60">
                  <th>Trh</th>
                  <th className="text-right">Čisté PnL</th>
                  <th className="text-right">Poslední</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {pnlRows.map((row) => (
                  <tr key={row.symbol} className="border-b border-border/40 hover:bg-background/30">
                    <td className="py-2 px-3 font-mono">{row.symbol}</td>
                    <td
                      className={`py-2 px-3 text-right tabular-nums ${
                        row.netPnl >= 0
                          ? "text-emerald-300 dm-pnl-positive"
                          : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative"
                      }`}
                    >
                      {formatSignedMoney(row.netPnl)}
                    </td>
                    <td
                      className={`py-2 px-3 text-right tabular-nums ${
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
