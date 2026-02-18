import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { AssetPnlMap } from "@/lib/pnlHistory";
import Panel from "@/components/dashboard/Panel";
import { formatClock, formatSignedMoney } from "@/lib/uiFormat";
import { UI_COPY } from "@/lib/uiCopy";
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

type GateStep = {
  label: "HARD" | "CHECKLIST" | "ENTRY";
  pass: boolean;
  score: string;
  missing: number;
  reasons: string[];
};

function normalizeBlockReason(reason?: string) {
  if (!reason) return "Chybí důvod blokace.";
  if (reason === "Exec OFF") return "Exekuce je vypnutá (režim manuál).";
  if (reason === "čeká na signál") return "Čeká se na aktivní signál.";
  return reason;
}

function parseRatio(detail?: string) {
  if (!detail) return null;
  const match = detail.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  return {
    ok: Number(match[1]),
    total: Number(match[2]),
  };
}

function parseNeed(name: string, fallback = 0) {
  const allMatch = name.match(/all\s+(\d+)/i);
  if (allMatch) return Number(allMatch[1]);
  const ofMatch = name.match(/(\d+)\s+of\s+(\d+)/i);
  if (ofMatch) return Number(ofMatch[1]);
  return fallback;
}

function parseStep(
  diag: SymbolDiagnostic | undefined,
  label: GateStep["label"],
  gatePrefix: string
): GateStep {
  const gate = (Array.isArray(diag?.gates) ? diag?.gates : []).find((item: DiagnosticGate) =>
    item.name.toLowerCase().startsWith(gatePrefix.toLowerCase())
  );
  const ratio = parseRatio(gate?.detail);
  const total = ratio?.total ?? 0;
  const passed = ratio?.ok ?? 0;
  const need = gate ? parseNeed(gate.name, total) : 0;
  const missing = Math.max(0, need - passed);

  const reasons: string[] = [];
  if (label === "ENTRY") {
    const entryReasons = Array.isArray(diag?.entryBlockReasons) ? diag?.entryBlockReasons : [];
    entryReasons.forEach((reason) => reasons.push(normalizeBlockReason(reason)));
  } else if (label === "HARD" && typeof diag?.executionReason === "string") {
    if (diag.executionReason.toLowerCase().includes("hard")) {
      reasons.push(normalizeBlockReason(diag.executionReason));
    }
  } else if (label === "CHECKLIST" && typeof diag?.executionReason === "string") {
    if (diag.executionReason.toLowerCase().includes("checklist")) {
      reasons.push(normalizeBlockReason(diag.executionReason));
    }
  }
  if (!reasons.length && diag?.executionAllowed === false && diag?.executionReason) {
    reasons.push(normalizeBlockReason(diag.executionReason));
  }

  return {
    label,
    pass: Boolean(gate?.ok),
    score: ratio ? `${passed}/${total}` : "N/A",
    missing,
    reasons: reasons.slice(0, 2),
  };
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
    const blocked = allowedSymbols.find((symbol) => scanDiagnostics?.[symbol]?.executionAllowed === false);
    return blocked ?? allowedSymbols[0] ?? null;
  }, [allowedSymbols, scanDiagnostics, selectedSymbol]);

  const activeDiag = activeSymbol ? scanDiagnostics?.[activeSymbol] : undefined;
  const gateSteps = useMemo(
    () => [
      parseStep(activeDiag, "HARD", "Hard:"),
      parseStep(activeDiag, "CHECKLIST", "Checklist:"),
      parseStep(activeDiag, "ENTRY", "Entry:"),
    ],
    [activeDiag]
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
        title={UI_COPY.dashboard.whyNoTrade}
        description={`${activeSymbol ? `Trh ${activeSymbol}` : "Není vybraný trh"} · ${UI_COPY.dashboard.lastScan}: ${formatClock(lastScanTs)}`}
        fileId="GATE DIAGNOSTICS ID: TR-01-G"
      >
        {!scanLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám diagnostiku gate…
          </div>
        ) : !activeSymbol ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Není dostupný žádný trh.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {gateSteps.map((step) => (
              <div
                key={step.label}
                className="rounded-lg border border-border/60 bg-background/30 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">{step.label}</div>
                  <span className={`text-xs font-semibold ${step.pass ? "text-emerald-300" : "text-red-300"}`}>
                    {step.pass ? "PASS" : "FAIL"}
                  </span>
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums text-foreground">{step.score}</div>
                <div className="mt-1 text-xs text-muted-foreground">Chybí: {step.missing}</div>
                <div className="mt-2 space-y-1">
                  {step.reasons.length === 0 ? (
                    <div className="text-xs text-muted-foreground">Bez aktivního důvodu.</div>
                  ) : (
                    step.reasons.map((reason, idx) => (
                      <div key={`${step.label}-${idx}`} className="text-xs text-muted-foreground">
                        {reason}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
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
