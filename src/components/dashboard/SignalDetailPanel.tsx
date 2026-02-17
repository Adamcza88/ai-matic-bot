import { Badge } from "@/components/ui/badge";
import Panel from "@/components/dashboard/Panel";

type SignalDetailPanelProps = {
  selectedSymbol: string | null;
  scanDiagnostics: Record<string, any> | null;
  scanLoaded: boolean;
  checklistEnabled: Record<string, boolean>;
  toggleChecklist: (name: string) => void;
  profileGateNames: string[];
};

function gateGroup(name: string): "trend" | "liquidity" | "execution" {
  const key = name.toLowerCase();
  if (
    key.includes("ema") ||
    key.includes("htf") ||
    key.includes("trend") ||
    key.includes("pullback") ||
    key.includes("pivot") ||
    key.includes("break") ||
    key.includes("bias")
  ) {
    return "trend";
  }
  if (
    key.includes("atr") ||
    key.includes("volume") ||
    key.includes("bbo") ||
    key.includes("spread") ||
    key.includes("fresh") ||
    key.includes("age") ||
    key.includes("liq") ||
    key.includes("vpin") ||
    key.includes("chop")
  ) {
    return "liquidity";
  }
  return "execution";
}

function formatDetail(detail?: string) {
  if (!detail) return "—";
  if (detail === "not required") return "N/A";
  return String(detail).replace(/\s+/g, " ").trim();
}

function GateList({
  title,
  gates,
  checklistEnabled,
  toggleChecklist,
}: {
  title: string;
  gates: any[];
  checklistEnabled: Record<string, boolean>;
  toggleChecklist: (name: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-2">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1.5">
        {gates.length === 0 ? (
          <div className="text-xs text-muted-foreground">No gates</div>
        ) : (
          gates.map((gate) => {
            const enabled = checklistEnabled[gate.name] ?? true;
            return (
              <button
                key={gate.name}
                type="button"
                onClick={() => toggleChecklist(gate.name)}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border/50 bg-background/30 px-2 py-1 text-left text-xs"
                title="Toggle gate enforcement"
              >
                <span className={enabled ? "text-foreground" : "text-muted-foreground"}>
                  {gate.name}
                </span>
                <span
                  className={
                    gate.ok
                      ? "text-emerald-300"
                      : enabled
                        ? "text-amber-300"
                        : "text-muted-foreground"
                  }
                >
                  {formatDetail(gate.detail)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function SignalDetailPanel({
  selectedSymbol,
  scanDiagnostics,
  scanLoaded,
  checklistEnabled,
  toggleChecklist,
  profileGateNames,
}: SignalDetailPanelProps) {
  const diag = selectedSymbol ? scanDiagnostics?.[selectedSymbol] : null;
  const rawGates = Array.isArray(diag?.gates) ? diag.gates : [];
  const gateSet = new Set(profileGateNames);
  const gates = rawGates.filter((gate: any) => gateSet.has(gate.name));
  const trend = gates.filter((gate: any) => gateGroup(gate.name) === "trend");
  const liquidity = gates.filter((gate: any) => gateGroup(gate.name) === "liquidity");
  const execution = gates.filter((gate: any) => gateGroup(gate.name) === "execution");
  const entryBlocks = Array.isArray(diag?.entryBlockReasons)
    ? diag.entryBlockReasons
    : [];
  const reason =
    entryBlocks[0] ??
    diag?.executionReason ??
    diag?.manageReason ??
    "No active execution reason.";

  const statusTone =
    diag?.executionAllowed === true
      ? "border-emerald-500/50 text-emerald-400"
      : diag?.executionAllowed === false
        ? "border-amber-500/50 text-amber-400"
        : "border-border/60 text-muted-foreground";
  const statusLabel =
    diag?.executionAllowed === true
      ? "PASS"
      : diag?.executionAllowed === false
        ? "HOLD"
        : "IDLE";

  return (
    <Panel
      title="Selected signal detail"
      description={selectedSymbol ? `Symbol: ${selectedSymbol}` : "No symbol selected."}
      fileId="SIGNAL DETAIL ID: TR-12-D"
      className="dashboard-detail-panel"
    >
      {!scanLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Loading diagnostics...
        </div>
      ) : !selectedSymbol ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          No symbol selected.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/60 bg-card/70 p-2">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Trend</div>
              <div className="mt-1 text-sm font-medium">
                {String(diag?.trendBias ?? diag?.symbolState ?? "UNRESOLVED")}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/70 p-2">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Execution</div>
              <div className="mt-1">
                <Badge variant="outline" className={statusTone}>
                  {statusLabel}
                </Badge>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/70 p-2 text-xs">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Checklist / reason
            </div>
            <div className="mt-1 text-foreground">{reason}</div>
          </div>

          <GateList
            title="Trend"
            gates={trend}
            checklistEnabled={checklistEnabled}
            toggleChecklist={toggleChecklist}
          />
          <GateList
            title="Liquidity / Volatility"
            gates={liquidity}
            checklistEnabled={checklistEnabled}
            toggleChecklist={toggleChecklist}
          />
          <GateList
            title="Checklist / Gates"
            gates={execution}
            checklistEnabled={checklistEnabled}
            toggleChecklist={toggleChecklist}
          />
        </div>
      )}
    </Panel>
  );
}
