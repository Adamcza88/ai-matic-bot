import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
import type {
  DiagnosticGate,
  ScanDiagnostics,
} from "@/lib/diagnosticsTypes";

type SignalDetailPanelProps = {
  selectedSymbol: string | null;
  scanDiagnostics: ScanDiagnostics | null;
  scanLoaded: boolean;
  checklistEnabled: Record<string, boolean>;
  toggleChecklist: (name: string) => void;
  profileGateNames: string[];
  resetChecklist: () => void;
};

const FEED_OK_MS = 2_000;
const FEED_WARN_MS = 10_000;

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

function formatFeedAge(feedAgeMs?: number) {
  if (!Number.isFinite(feedAgeMs)) return "N/A";
  const ms = feedAgeMs as number;
  return `${(ms / 1000).toFixed(1)} s`;
}

function feedToneClass(feedAgeMs?: number) {
  if (!Number.isFinite(feedAgeMs)) return "text-muted-foreground";
  const ms = feedAgeMs as number;
  if (ms < FEED_OK_MS) return "text-emerald-300";
  if (ms <= FEED_WARN_MS) return "text-amber-300";
  return "text-red-300";
}

function GateList({
  title,
  gates,
  checklistEnabled,
  toggleChecklist,
}: {
  title: string;
  gates: DiagnosticGate[];
  checklistEnabled: Record<string, boolean>;
  toggleChecklist: (name: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-2">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1.5">
        {gates.length === 0 ? (
          <div className="text-xs text-muted-foreground">Bez gate</div>
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
  resetChecklist,
}: SignalDetailPanelProps) {
  const diag = selectedSymbol ? scanDiagnostics?.[selectedSymbol] : null;
  const rawGates = Array.isArray(diag?.gates) ? diag.gates : [];
  const gateSet = new Set(profileGateNames);
  const gates = rawGates.filter((gate: DiagnosticGate) => gateSet.has(gate.name));
  const trend = gates.filter((gate: DiagnosticGate) => gateGroup(gate.name) === "trend");
  const liquidity = gates.filter((gate: DiagnosticGate) => gateGroup(gate.name) === "liquidity");
  const execution = gates.filter((gate: DiagnosticGate) => gateGroup(gate.name) === "execution");
  const entryBlocks = Array.isArray(diag?.entryBlockReasons)
    ? diag.entryBlockReasons
    : [];
  const skipReasonRaw = String(diag?.skipReason ?? "").trim();
  const skipCodeRaw = String(diag?.skipCode ?? "").trim();
  const skipReason =
    skipReasonRaw && skipCodeRaw
      ? `[${skipCodeRaw}] ${skipReasonRaw}`
      : skipReasonRaw;
  const reason =
    skipReason ||
    entryBlocks[0] ??
    diag?.executionReason ??
    diag?.manageReason ??
    "Bez aktivního důvodu exekuce.";

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
  const overrideEnabled = checklistEnabled["Exec allowed"] ?? true;

  return (
    <Panel
      title="Detail vybraného signálu"
      description={selectedSymbol ? `Trh: ${selectedSymbol}` : "Není vybraný trh."}
      fileId="SIGNAL DETAIL ID: TR-12-D"
      className="dashboard-detail-panel"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={
              overrideEnabled
                ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
            }
          >
            {overrideEnabled ? "Override ON" : "Override OFF"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => toggleChecklist("Exec allowed")}
          >
            Přepnout override
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={resetChecklist}>
            Reset gate
          </Button>
        </div>
      }
    >
      {!scanLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Načítám diagnostiku…
        </div>
      ) : !selectedSymbol ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Není vybraný trh.
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
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Exekuce</div>
              <div className="mt-1">
                <Badge variant="outline" className={statusTone}>
                  {statusLabel}
                </Badge>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/70 p-2 text-xs">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Feed age
            </div>
            <div className={`mt-1 tabular-nums ${feedToneClass(diag?.feedAgeMs)}`}>
              {formatFeedAge(diag?.feedAgeMs)} (OK &lt; 2.0s, WARN 2.0–10.0s, BAD &gt; 10.0s)
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/70 p-2 text-xs">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Checklist / důvod
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
            title="Likvidita / volatilita"
            gates={liquidity}
            checklistEnabled={checklistEnabled}
            toggleChecklist={toggleChecklist}
          />
          <GateList
            title="Checklist / gate"
            gates={execution}
            checklistEnabled={checklistEnabled}
            toggleChecklist={toggleChecklist}
          />
        </div>
      )}
    </Panel>
  );
}
