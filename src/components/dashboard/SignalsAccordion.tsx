import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";

type SignalsAccordionProps = {
  allowedSymbols: string[];
  scanDiagnostics: Record<string, any> | null;
  scanLoaded: boolean;
  lastScanTs: number | null;
  checklistEnabled: Record<string, boolean>;
  resetChecklist: () => void;
  profileGateNames: string[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
};

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
  const entryBlocks = Array.isArray(diag?.entryBlockReasons) ? diag.entryBlockReasons : [];
  if (diag?.executionAllowed === false && entryBlocks.length > 0) {
    return { label: "HOLD", tone: "hold" as const };
  }
  if (diag?.executionAllowed === false) {
    return { label: "BLOCKED", tone: "blocked" as const };
  }
  if (diag?.executionAllowed === true) {
    return { label: "SCAN", tone: "pass" as const };
  }
  return { label: "IDLE", tone: "na" as const };
}

function normalizeReason(diag: any) {
  const entryBlockReasons = Array.isArray(diag?.entryBlockReasons)
    ? diag.entryBlockReasons
    : [];
  if (entryBlockReasons.length > 0) return String(entryBlockReasons[0]);
  if (diag?.manageReason) return String(diag.manageReason);
  if (diag?.executionReason) return String(diag.executionReason);
  return "No active reason";
}

function gatePassRatio(diag: any, profileGateNames: string[]) {
  const rawGates = Array.isArray(diag?.gates) ? diag.gates : [];
  const set = new Set(profileGateNames);
  const gates = rawGates.filter((gate: any) => set.has(gate.name));
  const pass = gates.filter((gate: any) => Boolean(gate.ok)).length;
  return `${pass}/${gates.length}`;
}

export default function SignalsAccordion({
  allowedSymbols,
  scanDiagnostics,
  scanLoaded,
  lastScanTs,
  checklistEnabled,
  resetChecklist,
  profileGateNames,
  selectedSymbol,
  onSelectSymbol,
}: SignalsAccordionProps) {
  const lastScanLabel = formatClock(lastScanTs);

  return (
    <Panel
      title="Signals"
      description={`Compact list mode · Last scan: ${lastScanLabel}`}
      fileId="SIGNAL RELAY ID: TR-09-S"
      action={
        <div className="flex items-center gap-2">
          <div className="text-[11px] text-muted-foreground">
            Exec override: {(checklistEnabled["Exec allowed"] ?? true) ? "ON" : "OFF"}
          </div>
          <Button variant="outline" size="sm" onClick={resetChecklist} className="h-8 text-xs">
            Reset gates
          </Button>
        </div>
      }
    >
      {!scanLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Loading diagnostics...
        </div>
      ) : allowedSymbols.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          No symbols configured.
        </div>
      ) : (
        <div className="max-h-[520px] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            {allowedSymbols.map((symbol) => {
              const diag = scanDiagnostics?.[symbol];
              const summary = gateSummary(diag, scanLoaded);
              const reason = normalizeReason(diag);
              const selected = selectedSymbol === symbol;
              const summaryClass =
                summary.tone === "blocked"
                  ? "border-red-500/50 text-red-400 dm-status-sell"
                  : summary.tone === "hold"
                    ? "border-amber-500/50 text-amber-400 dm-status-warn"
                    : summary.tone === "pass"
                      ? "border-emerald-500/50 text-emerald-400 dm-status-pass"
                      : "border-border/60 text-muted-foreground dm-status-muted";

              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => onSelectSymbol(symbol)}
                  className={`grid w-full grid-cols-[96px,96px,minmax(0,1fr),90px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs ${
                    selected
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/70 bg-card/90 hover:bg-card"
                  }`}
                >
                  <div className="font-mono text-sm text-foreground">{symbol}</div>
                  <Badge variant="outline" className={summaryClass}>
                    {summary.label}
                  </Badge>
                  <div className="truncate text-muted-foreground" title={reason}>
                    {reason}
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    {gatePassRatio(diag, profileGateNames)}
                    <span className="ml-1">Details</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
