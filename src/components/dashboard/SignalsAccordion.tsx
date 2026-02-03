import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingMode } from "@/types";
import { ChevronDown } from "lucide-react";
import Panel from "@/components/dashboard/Panel";

type SignalsAccordionProps = {
  allowedSymbols: string[];
  scanDiagnostics: Record<string, any> | null;
  scanLoaded: boolean;
  lastScanTs: number | null;
  checklistEnabled: Record<string, boolean>;
  toggleChecklist: (name: string) => void;
  resetChecklist: () => void;
  mode: TradingMode;
  profileGateNames: string[];
};

const MODE_LABELS: Record<TradingMode, string> = {
  [TradingMode.OFF]: "Manual",
  [TradingMode.AUTO_ON]: "Auto",
  [TradingMode.SIGNAL_ONLY]: "Signal",
  [TradingMode.BACKTEST]: "Backtest",
  [TradingMode.PAPER]: "Paper",
};

function gateSummary(
  diag: any,
  gates: any[],
  scanLoaded: boolean,
  checklistEnabled: Record<string, boolean>
) {
  if (!scanLoaded || !diag) {
    return { label: "Gate: —", tone: "na" as const };
  }
  if (!diag?.signalActive) {
    return { label: "Gate: —", tone: "na" as const };
  }
  const entryBlocks = Array.isArray(diag?.entryBlockReasons)
    ? diag.entryBlockReasons
    : [];
  if (diag?.executionAllowed === false && entryBlocks.length > 0) {
    return { label: "Gate: HOLD", tone: "hold" as const };
  }
  if (diag?.executionAllowed === false) {
    return { label: "Gate: BLOCKED", tone: "blocked" as const };
  }
  if (diag?.executionAllowed === true) {
    return { label: "Gate: PASS", tone: "pass" as const };
  }
  return { label: "Gate: —", tone: "na" as const };
}

function gateLabel(name: string, detail?: string) {
  if (name === "Confirm required") {
    if (detail === "not required") return "Confirm: No";
    if (detail === "required") return "Confirm: Yes";
    return "Confirm";
  }
  if (name === "Exec allowed") {
    return "Execution allowed";
  }
  return name;
}

export default function SignalsAccordion({
  allowedSymbols,
  scanDiagnostics,
  scanLoaded,
  lastScanTs,
  checklistEnabled,
  toggleChecklist,
  resetChecklist,
  mode,
  profileGateNames,
}: SignalsAccordionProps) {
  const lastScanLabel = lastScanTs
    ? new Date(lastScanTs).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  return (
    <Panel
      title="Signal checklist"
      description={`Last scan: ${lastScanLabel}`}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={resetChecklist}
          className="h-8 text-xs"
        >
          Reset gates
        </Button>
      }
    >
      <div className="space-y-3">
        {allowedSymbols.map((symbol) => {
          const diag = scanDiagnostics?.[symbol];
          const rawGates = Array.isArray(diag?.gates) ? diag.gates : [];
          const gateSet = new Set(profileGateNames);
          const gates = rawGates.filter((gate: any) => gateSet.has(gate.name));
          const hardEnabled = diag?.hardEnabled !== false;
          const softEnabled = diag?.softEnabled !== false;
          const hardBlocked = diag?.hardBlocked;
          const qualityScore = diag?.qualityScore;
          const qualityThreshold = diag?.qualityThreshold;
          const qualityPass = diag?.qualityPass;
          const signalActive = Boolean(diag?.signalActive);
          const breakdown = diag?.qualityBreakdown;
          const breakdownOrder = [
            "HTF",
            "Pullback",
            "Break",
            "ATR",
            "Spread",
            "Freshness",
          ];
          const breakdownParts = breakdown
            ? breakdownOrder
                .map((key) => {
                  const value = breakdown[key];
                  return Number.isFinite(value)
                    ? `${key} ${Math.round(value)}`
                    : null;
                })
                .filter((entry): entry is string => Boolean(entry))
            : [];
          const signalLabel = !scanLoaded
            ? "Loading"
            : diag?.signalActive
              ? "Active"
              : "Idle";
          const signalClass = !scanLoaded
            ? "border-border/60 text-muted-foreground"
            : diag?.signalActive
              ? "border-emerald-500/50 text-emerald-400"
              : "border-border/60 text-muted-foreground";
          const execLabel =
            diag?.executionAllowed === true
              ? "Yes"
              : diag?.executionAllowed === false
                ? diag?.executionReason ?? "Blocked"
                : diag?.executionReason ?? "N/A";
          const feedAgeMs = diag?.feedAgeMs;
          const feedAgeOk = diag?.feedAgeOk;
          const feedAgeLabel =
            feedAgeOk == null ? "—" : feedAgeOk ? "OK" : "Fail";
          const feedAgeValue =
            feedAgeMs != null && Number.isFinite(feedAgeMs)
              ? `${feedAgeMs} ms`
              : "—";
          const symbolState = diag?.symbolState;
          const manageReason = diag?.manageReason;
          const entryBlockReasons = Array.isArray(diag?.entryBlockReasons)
            ? diag.entryBlockReasons
            : [];
          const proState = diag?.proState;
          const manipActive = diag?.manipActive;
          const liqProximity = diag?.liqProximityPct;
          const manageLabel =
            entryBlockReasons.length > 0
              ? entryBlockReasons.join(" • ")
              : manageReason ?? null;
          const manageSummary =
            entryBlockReasons[0] ?? manageReason ?? null;
          const isManage = entryBlockReasons.length > 0 || Boolean(manageReason);
          const isHold = symbolState === "HOLD";
          const summary = gateSummary(
            diag,
            gates,
            scanLoaded,
            checklistEnabled
          );

          return (
            <details
              key={symbol}
              className="group rounded-lg border border-border/60 bg-background/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{symbol}</span>
                  <Badge
                    variant="outline"
                    className={
                      summary.tone === "blocked"
                        ? "border-red-500/50 text-red-400"
                        : summary.tone === "hold"
                          ? "border-amber-500/50 text-amber-400"
                          : summary.tone === "pass"
                            ? "border-emerald-500/50 text-emerald-400"
                            : "border-border/60 text-muted-foreground"
                    }
                  >
                    {summary.label}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={
                      feedAgeOk === false
                        ? "border-red-500/50 text-red-400"
                        : "border-border/60 text-muted-foreground"
                    }
                  >
                    Feed age {feedAgeLabel} · {feedAgeValue}
                  </Badge>
                  {isHold ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/50 text-amber-400"
                    >
                      HOLD{manageSummary ? ` · ${manageSummary}` : ""}
                    </Badge>
                  ) : null}
                  {!isHold && manageSummary ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/50 text-amber-400"
                    >
                      MANAGE · {manageSummary}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className="border-border/60 text-muted-foreground">
                    Mode {MODE_LABELS[mode]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Badge variant="outline" className={signalClass}>
                    {signalLabel}
                  </Badge>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </div>
              </summary>
              <div className="border-t border-border/60 px-4 py-3 text-xs">
                {!scanLoaded ? (
                  <div className="text-muted-foreground">
                    Loading diagnostics...
                  </div>
                ) : gates.length === 0 ? (
                  <div className="text-muted-foreground">
                    No scan data for this symbol.
                  </div>
                ) : (
                  <div className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          hardEnabled
                            ? hardBlocked
                              ? "bg-red-400"
                              : "bg-emerald-400"
                            : "bg-slate-600"
                        }`}
                      />
                      <span className={hardEnabled ? "text-foreground" : "text-muted-foreground"}>
                        Hard gate: {hardEnabled ? (hardBlocked ? "BLOCKED" : "PASS") : "OFF"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          softEnabled
                            ? qualityPass
                              ? "bg-emerald-400"
                              : "bg-amber-400"
                            : "bg-slate-600"
                        }`}
                      />
                      <span className={softEnabled ? "text-foreground" : "text-muted-foreground"}>
                        Soft score:{" "}
                        {softEnabled
                          ? qualityScore != null
                            ? `${qualityScore} / ${qualityThreshold ?? "—"}`
                            : "—"
                          : "OFF"}
                      </span>
                    </div>
                    {isManage && manageLabel ? (
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-amber-400" />
                        <span className="text-foreground">
                          Manage: {manageLabel}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {(proState || manipActive != null || liqProximity != null) && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {proState ? (
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-sky-400" />
                          <span className="text-foreground">
                            PRO state: {proState}
                          </span>
                        </div>
                      ) : null}
                      {manipActive != null ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              manipActive ? "bg-amber-400" : "bg-emerald-400"
                            }`}
                          />
                          <span className="text-foreground">
                            Manipulation {manipActive ? "ON" : "OFF"}
                          </span>
                        </div>
                      ) : null}
                      {liqProximity != null ? (
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-violet-400" />
                          <span className="text-foreground">
                            Liq proximity {Number.isFinite(liqProximity)
                              ? `${liqProximity.toFixed(2)}%`
                              : "—"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {gates.map((gate: any) => (
                        <button
                          key={gate.name}
                          type="button"
                          onClick={() => toggleChecklist(gate.name)}
                          className="flex items-center gap-2 text-left"
                          title="Toggle gate enforcement for this check."
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${
                              !((checklistEnabled[gate.name] ?? true)) ||
                              gate.detail === "not required" ||
                              (!signalActive && !gate.ok)
                                ? "bg-slate-600"
                                : gate.ok
                                  ? "bg-emerald-400"
                                  : "bg-red-400"
                            }`}
                          />
                          <span
                            className={
                              (checklistEnabled[gate.name] ?? true)
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }
                          >
                            {(() => {
                              const label = gateLabel(gate.name, gate.detail);
                              if (!gate.detail || gate.name === "Confirm required") {
                                return label;
                              }
                              return `${label}: ${
                                gate.detail === "not required" ? "N/A" : gate.detail
                              }`;
                            })()}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => toggleChecklist("Exec allowed")}
                        className="flex items-center gap-2 text-left"
                        title="Toggle gate enforcement for this check."
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            !(checklistEnabled["Exec allowed"] ?? true)
                              ? "bg-slate-600"
                              : diag?.executionAllowed === true
                                ? "bg-emerald-400"
                                : diag?.executionAllowed === false
                                  ? "bg-amber-400"
                                  : "bg-slate-600"
                          }`}
                        />
                        <span
                          className={
                            (checklistEnabled["Exec allowed"] ?? true)
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }
                        >
                          Execution allowed ({execLabel})
                        </span>
                      </button>
                    </div>
                    {(breakdownParts.length > 0 || diag?.qualityTopReason) && (
                      <div className="text-[11px] text-muted-foreground">
                        {breakdownParts.length > 0 && (
                          <div>Score: {breakdownParts.join(" · ")}</div>
                        )}
                        {diag?.qualityTopReason && (
                          <div>Top reason: {diag.qualityTopReason}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </Panel>
  );
}
