import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
import { formatClock } from "@/lib/uiFormat";
import type {
  DiagnosticGate,
  ScanDiagnostics,
  SymbolDiagnostic,
} from "@/lib/diagnosticsTypes";

type SignalsAccordionProps = {
  allowedSymbols: string[];
  scanDiagnostics: ScanDiagnostics | null;
  scanLoaded: boolean;
  lastScanTs: number | null;
  overrideEnabled: boolean;
  setOverrideEnabled: (value: boolean) => void;
  resetChecklist: () => void;
  profileGateNames: string[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
};

const FEED_OK_MS = 2_000;
const FEED_WARN_MS = 10_000;

function gateSummary(diag: SymbolDiagnostic | undefined, scanLoaded: boolean) {
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

function normalizeReason(diag: SymbolDiagnostic | undefined) {
  const entryBlockReasons = Array.isArray(diag?.entryBlockReasons)
    ? diag?.entryBlockReasons
    : [];
  const reason =
    entryBlockReasons[0] ??
    diag?.manageReason ??
    diag?.executionReason ??
    "";
  if (!reason) return "Bez aktivního důvodu.";
  if (reason === "Exec OFF") return "Exekuce je vypnutá (manuál).";
  if (reason === "čeká na signál") return "Čeká na potvrzení signálu.";
  return String(reason);
}

function gatePassRatio(diag: SymbolDiagnostic | undefined, profileGateNames: string[]) {
  const rawGates = Array.isArray(diag?.gates) ? diag.gates : [];
  const set = new Set(profileGateNames);
  const gates = rawGates.filter((gate: DiagnosticGate) => set.has(gate.name));
  const pass = gates.filter((gate: DiagnosticGate) => Boolean(gate.ok)).length;
  return `${pass}/${gates.length}`;
}

function feedToneClass(feedAgeMs?: number) {
  if (!Number.isFinite(feedAgeMs)) return "text-muted-foreground";
  if ((feedAgeMs as number) < FEED_OK_MS) return "text-emerald-300";
  if ((feedAgeMs as number) <= FEED_WARN_MS) return "text-amber-300";
  return "text-red-300";
}

function formatFeedAge(feedAgeMs?: number) {
  if (!Number.isFinite(feedAgeMs)) return "N/A";
  return `${((feedAgeMs as number) / 1000).toFixed(1)} s`;
}

export default function SignalsAccordion({
  allowedSymbols,
  scanDiagnostics,
  scanLoaded,
  lastScanTs,
  overrideEnabled,
  setOverrideEnabled,
  resetChecklist,
  profileGateNames,
  selectedSymbol,
  onSelectSymbol,
}: SignalsAccordionProps) {
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const lastScanLabel = formatClock(lastScanTs);

  const rows = useMemo(
    () =>
      allowedSymbols
        .map((symbol) => {
          const diag = scanDiagnostics?.[symbol];
          return {
            symbol,
            summary: gateSummary(diag, scanLoaded),
            reason: normalizeReason(diag),
            ratio: gatePassRatio(diag, profileGateNames),
            feedAgeMs: Number(diag?.feedAgeMs),
            signalActive: Boolean(diag?.signalActive),
          };
        })
        .sort((a, b) => {
          const aAge = Number.isFinite(a.feedAgeMs) ? a.feedAgeMs : -1;
          const bAge = Number.isFinite(b.feedAgeMs) ? b.feedAgeMs : -1;
          if (bAge !== aAge) return bAge - aAge;
          if (a.summary.tone !== b.summary.tone) {
            if (a.summary.tone === "blocked") return -1;
            if (b.summary.tone === "blocked") return 1;
          }
          return a.symbol.localeCompare(b.symbol);
        }),
    [allowedSymbols, profileGateNames, scanDiagnostics, scanLoaded]
  );

  return (
    <Panel
      title="Přehled signálů"
      description={`Jedna pravda · Poslední sken: ${lastScanLabel}`}
      fileId="SIGNAL RELAY ID: TR-09-S"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-border/60 p-0.5">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("table")}
            >
              Table
            </Button>
            <Button
              variant={viewMode === "cards" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setViewMode("cards")}
            >
              Cards
            </Button>
          </div>
          <Badge
            variant="outline"
            title={
              overrideEnabled
                ? "Execution override je aktivní a může obejít gate podmínky."
                : "Override je vypnutý, platí standardní gate pravidla."
            }
            className={
              overrideEnabled
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            }
          >
            {overrideEnabled ? "Overrides gates" : "No overrides"}
          </Badge>
          <Button variant="outline" size="sm" onClick={resetChecklist} className="h-8 text-xs">
            Reset gate
          </Button>
        </div>
      }
    >
      {!scanLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Načítám diagnostiku…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Není vybraný žádný trh.
        </div>
      ) : viewMode === "table" ? (
        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="[&>th]:py-2 [&>th]:px-3 [&>th]:text-left border-b border-border/60">
                <th>Trh</th>
                <th>Stav</th>
                <th>Gate</th>
                <th>Feed age</th>
                <th>Akce</th>
              </tr>
            </thead>
            <tbody className="text-foreground">
              {rows.map((row) => {
                const summaryClass =
                  row.summary.tone === "blocked"
                    ? "border-red-500/50 text-red-300 dm-status-sell"
                    : row.summary.tone === "hold"
                      ? "border-amber-500/50 text-amber-300 dm-status-warn"
                      : row.summary.tone === "pass"
                        ? "border-emerald-500/50 text-emerald-300 dm-status-pass"
                        : "border-border/60 text-muted-foreground dm-status-muted";
                return (
                  <tr
                    key={row.symbol}
                    onClick={() => onSelectSymbol(row.symbol)}
                    className={`cursor-pointer border-b border-border/40 hover:bg-background/30 ${
                      selectedSymbol === row.symbol ? "bg-primary/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono">{row.symbol}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={
                          row.signalActive
                            ? "border-emerald-500/50 text-emerald-300 dm-status-pass"
                            : "border-border/60 text-muted-foreground dm-status-muted"
                        }
                      >
                        {row.signalActive ? "Skenuje" : "Idle"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={summaryClass}>
                        {row.summary.label} · {row.ratio}
                      </Badge>
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${feedToneClass(row.feedAgeMs)}`}>
                      {formatFeedAge(row.feedAgeMs)}
                    </td>
                    <td className="px-3 py-2">
                      {row.summary.tone === "blocked" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant={overrideEnabled ? "secondary" : "outline"}
                            className="h-7 px-2 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectSymbol(row.symbol);
                              setOverrideEnabled(!overrideEnabled);
                            }}
                          >
                            Override {overrideEnabled ? "ON" : "OFF"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            onClick={(event) => {
                              event.stopPropagation();
                              resetChecklist();
                            }}
                          >
                            Reset
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="max-h-[520px] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            {rows.map((row) => {
              const selected = selectedSymbol === row.symbol;
              const summaryClass =
                row.summary.tone === "blocked"
                  ? "border-red-500/50 text-red-400 dm-status-sell"
                  : row.summary.tone === "hold"
                    ? "border-amber-500/50 text-amber-400 dm-status-warn"
                    : row.summary.tone === "pass"
                      ? "border-emerald-500/50 text-emerald-400 dm-status-pass"
                      : "border-border/60 text-muted-foreground dm-status-muted";

              return (
                <div
                  key={row.symbol}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSymbol(row.symbol)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSymbol(row.symbol);
                    }
                  }}
                  className={`grid w-full grid-cols-[96px,126px,minmax(0,1fr),72px] items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs ${
                    selected
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/70 bg-card/90 hover:bg-card"
                  }`}
                >
                  <div className="font-mono text-sm text-foreground">{row.symbol}</div>
                  <Badge variant="outline" className={summaryClass}>
                    {row.summary.label} · {row.ratio}
                  </Badge>
                  <div className="truncate text-muted-foreground" title={row.reason}>
                    {row.reason}
                  </div>
                  <div className={`text-right text-[11px] tabular-nums ${feedToneClass(row.feedAgeMs)}`}>
                    {formatFeedAge(row.feedAgeMs)}
                  </div>
                  <div className="col-span-4 mt-1 flex items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant={overrideEnabled ? "secondary" : "outline"}
                      className="h-7 px-2 text-[11px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectSymbol(row.symbol);
                        setOverrideEnabled(!overrideEnabled);
                      }}
                    >
                      Override {overrideEnabled ? "ON" : "OFF"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[11px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        resetChecklist();
                      }}
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
