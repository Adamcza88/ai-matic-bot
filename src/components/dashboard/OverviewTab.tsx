import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AssetPnlMap } from "@/lib/pnlHistory";
import Panel from "@/components/dashboard/Panel";
import { formatSignedMoney } from "@/lib/uiFormat";
import type { DiagnosticGate, ScanDiagnostics, SymbolDiagnostic } from "@/lib/diagnosticsTypes";

type OverviewTabProps = {
  allowedSymbols: string[];
  assetPnlHistory: AssetPnlMap | null;
  pnlLoaded: boolean;
  resetPnlHistory: () => void;
  scanDiagnostics: ScanDiagnostics | null;
  scanLoaded: boolean;
  selectedSymbol: string | null;
};

const PNL_HISTORY_PAGE_SIZE = 12;

function normalizeReason(reason?: string) {
  if (!reason) return "Bez aktivní blokace.";
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
  selectedSymbol,
}: OverviewTabProps) {
  const [page, setPage] = useState(0);

  const activeSymbol = useMemo(() => {
    if (selectedSymbol && allowedSymbols.includes(selectedSymbol)) return selectedSymbol;
    const paused = allowedSymbols.find((symbol) => scanDiagnostics?.[symbol]?.relayState === "PAUSED");
    if (paused) return paused;
    const blocked = allowedSymbols.find((symbol) => scanDiagnostics?.[symbol]?.executionAllowed === false);
    return blocked ?? allowedSymbols[0] ?? null;
  }, [allowedSymbols, scanDiagnostics, selectedSymbol]);

  const activeDiag = activeSymbol ? scanDiagnostics?.[activeSymbol] : undefined;
  const activeGates = Array.isArray(activeDiag?.gates)
    ? (activeDiag?.gates as DiagnosticGate[])
    : [];
  const hardGate =
    gateByPrefix(activeDiag, "Hard:") ??
    gateByPrefix(activeDiag, "Signal Checklist") ??
    activeGates[0];
  const checklistGate =
    gateByPrefix(activeDiag, "Checklist:") ??
    gateByPrefix(activeDiag, "Signal Checklist");
  const passedGateCount = activeGates.filter((gate) => gate.ok).length;
  const hardStatus = !hardGate ? "N/A" : hardGate.ok ? "PASS" : "FAIL";
  const checklistScore =
    parseRatio(checklistGate?.detail) ??
    (activeGates.length > 0 ? `${passedGateCount}/${activeGates.length}` : "N/A");
  const entryStatus = activeDiag?.relayState === "PAUSED"
    ? "PAUSED"
    : activeDiag?.executionAllowed
      ? "READY"
      : "BLOCKED";
  const skipReasonRaw = String(activeDiag?.skipReason ?? "").trim();
  const skipCodeRaw = String(activeDiag?.skipCode ?? "").trim();
  const skipReason = skipReasonRaw && skipCodeRaw ? `[${skipCodeRaw}] ${skipReasonRaw}` : skipReasonRaw;
  const blockReason = normalizeReason(
    activeDiag?.relayReason ||
    skipReason ||
    (Array.isArray(activeDiag?.entryBlockReasons) ? activeDiag?.entryBlockReasons[0] : "") ||
      activeDiag?.executionReason ||
      activeDiag?.manageReason
  );

  const pnlRows = useMemo(() => {
    if (!assetPnlHistory) return [];
    const allowedSet = new Set(allowedSymbols.map((symbol) => String(symbol).toUpperCase()));
    return Object.entries(assetPnlHistory)
      .filter(([symbol]) => allowedSet.has(String(symbol).toUpperCase()))
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
  }, [allowedSymbols, assetPnlHistory]);

  const totalPages = Math.max(1, Math.ceil(pnlRows.length / PNL_HISTORY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo(() => {
    const start = safePage * PNL_HISTORY_PAGE_SIZE;
    return pnlRows.slice(start, start + PNL_HISTORY_PAGE_SIZE);
  }, [pnlRows, safePage]);
  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  useEffect(() => {
    setPage(0);
  }, [pnlRows.length]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages - 1));
  }, [totalPages]);

  return (
    <div className="space-y-4">
      <Panel
        title="Gate Engine"
        description={activeSymbol ? `Trh ${activeSymbol}` : "Není vybraný trh"}
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
              <div
                className={`mt-1 text-lg font-semibold ${
                  entryStatus === "READY"
                    ? "text-[#00C853]"
                    : entryStatus === "PAUSED"
                      ? "text-[#FFB300]"
                      : "text-[#D32F2F]"
                }`}
              >
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
          <div className="space-y-2">
            <div className="h-[320px] overflow-hidden rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="[&>th]:h-8 [&>th]:px-3 [&>th]:text-left border-b border-border/60">
                    <th>Trh</th>
                    <th className="text-right">Čisté PnL</th>
                    <th className="text-right">Poslední</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {pageRows.map((row) => (
                    <tr key={row.symbol} className="h-6 border-b border-border/40 hover:bg-background/30">
                      <td className="px-3 font-mono leading-6 truncate">{row.symbol}</td>
                      <td
                        className={`px-3 text-right tabular-nums leading-6 ${
                          row.netPnl >= 0
                            ? "text-emerald-300 dm-pnl-positive"
                            : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative"
                        }`}
                      >
                        {formatSignedMoney(row.netPnl)}
                      </td>
                      <td
                        className={`px-3 text-right tabular-nums leading-6 ${
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
    </div>
  );
}
