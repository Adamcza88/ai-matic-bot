import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingMode } from "@/types";
import { ChevronDown } from "lucide-react";
import Panel from "@/components/dashboard/Panel";

type SignalsAccordionProps = {
  theme: "dark" | "light";
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

function gateSummary(diag: any, scanLoaded: boolean) {
  if (!scanLoaded || !diag || !diag?.signalActive) {
    return { label: "—", tone: "na" as const };
  }
  const entryBlocks = Array.isArray(diag?.entryBlockReasons)
    ? diag.entryBlockReasons
    : [];
  if (diag?.executionAllowed === false && entryBlocks.length > 0) {
    return { label: "HOLD", tone: "hold" as const };
  }
  if (diag?.executionAllowed === false) {
    return { label: "BLOCKED", tone: "blocked" as const };
  }
  if (diag?.executionAllowed === true) {
    return { label: "PASS", tone: "pass" as const };
  }
  return { label: "—", tone: "na" as const };
}

function gateLabel(name: string, detail?: string) {
  if (name === "Confirm required") {
    if (detail === "not required") return "Confirm: No";
    if (detail === "required") return "Confirm: Yes";
    return "Confirm";
  }
  if (name === "Exec allowed") {
    return "Exec";
  }
  return name;
}

function formatDetail(detail?: string) {
  if (!detail) return "—";
  if (detail === "not required") return "N/A";
  const compact = String(detail).replace(/\s+/g, " ").trim();
  const slashIndex = compact.indexOf("/");
  if (slashIndex > 0 && slashIndex < compact.length - 1) {
    const left = compact.slice(0, slashIndex).trim();
    const right = compact.slice(slashIndex + 1).trim();
    if (left && right) return `${left} -> ${right}`;
  }
  return compact;
}

function formatClock(ts?: number | null) {
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts as number).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function normalizeReason(diag: any) {
  const entryBlockReasons = Array.isArray(diag?.entryBlockReasons)
    ? diag.entryBlockReasons
    : [];
  if (entryBlockReasons.length > 0) return String(entryBlockReasons[0]);
  if (diag?.manageReason) return String(diag.manageReason);
  if (diag?.executionReason) return String(diag.executionReason);
  return "bez omezení";
}

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

function gateTooltip(name: string) {
  if (name.includes("EMA")) {
    return "EMA -> určení trendu; vliv: povolí/blokuje vstup.";
  }
  if (name.includes("ATR")) {
    return "ATR -> aktuální volatilita; vliv: filtr nestabilního trhu.";
  }
  if (name.includes("BBO")) {
    return "BBO -> nejlepší bid/ask; vliv: kontrola kvality exekuce.";
  }
  if (name.includes("Volume")) {
    return "Volume -> likvidita trhu; vliv: filtr slabých setupů.";
  }
  return undefined;
}

function GateRow({
  gate,
  signalActive,
  checklistEnabled,
  toggleChecklist,
}: {
  gate: any;
  signalActive: boolean;
  checklistEnabled: Record<string, boolean>;
  toggleChecklist: (name: string) => void;
}) {
  const enabled = checklistEnabled[gate.name] ?? true;
  const muted = !enabled || gate.detail === "not required" || (!signalActive && !gate.ok);
  const toneClass = muted ? "bg-[#6a625b]" : gate.ok ? "bg-[#3FA7A3]" : "bg-[#C87C3A]";

  return (
    <button
      type="button"
      onClick={() => toggleChecklist(gate.name)}
      className="flex items-start gap-2 rounded-none border border-border/60 bg-background/30 px-2 py-1 text-left"
      title={gateTooltip(gate.name) ?? "Toggle gate enforcement for this check."}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneClass}`} />
      <span className={enabled ? "text-foreground" : "text-muted-foreground"}>
        <span className="text-muted-foreground">{gateLabel(gate.name, gate.detail)}:</span>{" "}
        <span className="tabular-nums">{formatDetail(gate.detail)}</span>
      </span>
    </button>
  );
}

export default function SignalsAccordion({
  theme,
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
  const isTvaTheme = theme === "light";
  const lastScanLabel = formatClock(lastScanTs);

  return (
    <Panel
      title={isTvaTheme ? "Authorization Case Registry" : "Signal checklist"}
      description={isTvaTheme ? `Last archive refresh: ${lastScanLabel}` : `Last scan: ${lastScanLabel}`}
      fileId={isTvaTheme ? "AUTHORIZATION MODULE ID: TR-03-S" : undefined}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={resetChecklist}
          className="h-8 text-xs tva-button"
        >
          {isTvaTheme ? "Revoke Authorizations" : "Reset gates"}
        </Button>
      }
    >
      <div className="space-y-3">
        {allowedSymbols.map((symbol) => {
          const diag = scanDiagnostics?.[symbol];
          const rawGates = Array.isArray(diag?.gates) ? diag.gates : [];
          const gateSet = new Set(profileGateNames);
          const gates = rawGates.filter((gate: any) => gateSet.has(gate.name));
          const summary = gateSummary(diag, scanLoaded);
          const signalActive = Boolean(diag?.signalActive);
          const reason = normalizeReason(diag);
          const feedAgeMs = diag?.feedAgeMs;
          const feedAgeOk = diag?.feedAgeOk;
          const feedAgeLabel =
            feedAgeOk == null ? "Feed —" : feedAgeOk ? "Feed OK" : "Feed Fail";
          const feedAgeValue =
            feedAgeMs != null && Number.isFinite(feedAgeMs) ? `${feedAgeMs} ms` : "—";
          const trendBias = String(
            diag?.trendBias ?? diag?.symbolState ?? diag?.marketBias ?? "UNRESOLVED"
          )
            .replace(/\s+/g, "_")
            .toUpperCase();
          const executionProtocol = (() => {
            const source = String(
              diag?.executionProtocol ?? diag?.executionReason ?? diag?.manageReason ?? ""
            ).toLowerCase();
            if (source.includes("maker")) return "LIMIT_MAKER_FIRST";
            if (source.includes("market")) return "MARKET_FOLLOW";
            if (source.includes("blocked")) return "BLOCKED";
            return source ? source.replace(/\s+/g, "_").toUpperCase() : "LIMIT_MAKER_FIRST";
          })();
          const caseStatus =
            summary.tone === "pass"
              ? "AUTHORIZED"
              : summary.tone === "hold"
                ? "HOLD"
                : summary.tone === "blocked"
                  ? "RESTRICTED"
                  : "PENDING";
          const manualOverride =
            checklistEnabled["Exec allowed"] === false ? "DISABLED" : "ENABLED";
          const advisoryMetrics = Number.isFinite(diag?.qualityScore)
            ? "ACTIVE"
            : "INACTIVE";

          const groups = {
            trend: [] as any[],
            liquidity: [] as any[],
            execution: [] as any[],
          };
          gates.forEach((gate: any) => {
            groups[gateGroup(gate.name)].push(gate);
          });

          return (
            <details
              key={symbol}
              className={`group border border-border/60 bg-background/40 ${
                isTvaTheme ? "rounded-none" : "rounded-lg"
              }`}
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-3 py-2 text-xs">
                <div className="min-w-0">
                  {isTvaTheme ? (
                    <div className="space-y-1">
                      <div className="font-mono text-[11px] tracking-[0.16em] text-foreground lm-micro">
                        CASE FILE: {symbol}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            summary.tone === "blocked"
                              ? "rounded-none border lm-status-badge lm-status-badge-error"
                              : summary.tone === "hold"
                                ? "rounded-none border lm-status-badge lm-status-badge-warn"
                                : summary.tone === "pass"
                                  ? "rounded-none border lm-status-badge lm-status-badge-ok"
                                  : "rounded-none border border-border/70 text-muted-foreground lm-status-badge"
                          }
                        >
                          {caseStatus}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground lm-micro">
                          FEED LATENCY: {feedAgeValue}
                        </span>
                        <span className="text-[11px] text-muted-foreground lm-micro">
                          MODE: {mode === TradingMode.AUTO_ON ? "AUTOMATED DIRECTIVE" : "MANUAL INTERVENTION"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-foreground">{symbol}</span>
                        <span className="text-muted-foreground">·</span>
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
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">
                          {feedAgeLabel} ({feedAgeValue})
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground">Režim {MODE_LABELS[mode]}</span>
                        <span className="text-muted-foreground">·</span>
                        <Badge
                          variant="outline"
                          className={
                            signalActive
                              ? "border-emerald-500/50 text-emerald-400"
                              : "border-border/60 text-muted-foreground"
                          }
                        >
                          {signalActive ? "Skenuje" : "Idle"}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">Důvod: {reason}</div>
                    </>
                  )}
                </div>
                <ChevronDown className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-border/60 px-4 py-3 text-xs">
                {!scanLoaded ? (
                  <div className="text-muted-foreground">Loading diagnostics...</div>
                ) : gates.length === 0 ? (
                  <div className="text-muted-foreground">No scan data for this symbol.</div>
                ) : (
                  <div className="space-y-3">
                    {isTvaTheme && (
                      <div className="grid gap-1 border border-border/70 bg-background/20 px-3 py-2 font-mono text-[11px]">
                        <div className="lm-micro">CASE FILE: {symbol}</div>
                        <div className="lm-micro">STATUS: {caseStatus}</div>
                        <div className="lm-micro">FEED LATENCY: {feedAgeValue}</div>
                        <div className="lm-micro">TREND BIAS: {trendBias}</div>
                        <div className="lm-micro">EXECUTION PROTOCOL: {executionProtocol}</div>
                        <div className="lm-micro">MANUAL OVERRIDE: {manualOverride}</div>
                        <div className="lm-micro">ADVISORY METRICS: {advisoryMetrics}</div>
                      </div>
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className={`border border-border/40 bg-background/30 px-2 py-1.5 ${isTvaTheme ? "rounded-none" : "rounded-md"}`}>
                        <div className="text-[11px] text-muted-foreground lm-micro">
                          {isTvaTheme ? "Trend Review" : "Trend"}
                        </div>
                        <div className="mt-1 grid gap-1">
                          {groups.trend.map((gate: any) => (
                            <GateRow
                              key={gate.name}
                              gate={gate}
                              signalActive={signalActive}
                              checklistEnabled={checklistEnabled}
                              toggleChecklist={toggleChecklist}
                            />
                          ))}
                          {groups.trend.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground">Bez položek</div>
                          ) : null}
                        </div>
                      </div>
                      <div className={`border border-border/40 bg-background/30 px-2 py-1.5 ${isTvaTheme ? "rounded-none" : "rounded-md"}`}>
                        <div className="text-[11px] text-muted-foreground lm-micro">
                          {isTvaTheme ? "Liquidity and Volatility" : "Likvidita/Volatilita"}
                        </div>
                        <div className="mt-1 grid gap-1">
                          {groups.liquidity.map((gate: any) => (
                            <GateRow
                              key={gate.name}
                              gate={gate}
                              signalActive={signalActive}
                              checklistEnabled={checklistEnabled}
                              toggleChecklist={toggleChecklist}
                            />
                          ))}
                          {groups.liquidity.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground">Bez položek</div>
                          ) : null}
                        </div>
                      </div>
                      <div className={`sm:col-span-2 border border-border/40 bg-background/30 px-2 py-1.5 ${isTvaTheme ? "rounded-none" : "rounded-md"}`}>
                        <div className="text-[11px] text-muted-foreground lm-micro">
                          {isTvaTheme ? "Execution Authority" : "Exekuce"}
                        </div>
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          {groups.execution.map((gate: any) => (
                            <GateRow
                              key={gate.name}
                              gate={gate}
                              signalActive={signalActive}
                              checklistEnabled={checklistEnabled}
                              toggleChecklist={toggleChecklist}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => toggleChecklist("Exec allowed")}
                            className="flex items-start gap-2 rounded-none border border-border/40 bg-background/40 px-2 py-1 text-left"
                            title="Toggle gate enforcement for this check."
                          >
                            <span
                              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
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
                                checklistEnabled["Exec allowed"] ?? true
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                              }
                            >
                              <span className="text-muted-foreground">
                                {isTvaTheme ? "Manual Override:" : "Exec:"}
                              </span>{" "}
                              {diag?.executionAllowed === true
                                ? isTvaTheme
                                  ? "Enabled"
                                  : "Yes"
                                : diag?.executionAllowed === false
                                  ? isTvaTheme
                                    ? "Disabled"
                                    : "Blocked"
                                  : "N/A"}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
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
