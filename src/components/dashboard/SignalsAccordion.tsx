import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Panel from "@/components/dashboard/Panel";
import { TradingMode } from "@/types";
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
  scanAgeOffsetMs?: number;
  overrideEnabled: boolean;
  setOverrideEnabled: (value: boolean) => void;
  resetChecklist: () => void;
  mode: TradingMode;
  loading?: boolean;
  bulkExecutedSymbols?: string[];
  resetVersion?: number;
  onToast?: (message: string, tone?: "success" | "neutral" | "danger") => void;
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
  if ((feedAgeMs as number) < FEED_OK_MS) return "text-[#00C853]";
  if ((feedAgeMs as number) <= FEED_WARN_MS) return "text-[#FFB300]";
  return "text-[#D32F2F]";
}

function formatFeedAge(feedAgeMs?: number) {
  if (!Number.isFinite(feedAgeMs)) return "N/A";
  const ms = feedAgeMs as number;
  if (ms > FEED_WARN_MS) return `${(ms / 1000).toFixed(1)} s · STALE`;
  if (ms > FEED_OK_MS) {
    const countdown = Math.max(0, Math.ceil((FEED_WARN_MS - ms) / 1000));
    return `${(ms / 1000).toFixed(1)} s · T-${countdown}s`;
  }
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function SignalsAccordion({
  allowedSymbols,
  scanDiagnostics,
  scanLoaded,
  lastScanTs,
  scanAgeOffsetMs,
  overrideEnabled,
  setOverrideEnabled,
  resetChecklist,
  mode,
  loading,
  bulkExecutedSymbols,
  resetVersion,
  onToast,
  profileGateNames,
  selectedSymbol,
  onSelectSymbol,
}: SignalsAccordionProps) {
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [symbolOverrideState, setSymbolOverrideState] = useState<
    Record<string, "OFF" | "ON" | "EXECUTE">
  >({});
  const lastScanLabel = formatClock(lastScanTs);

  useEffect(() => {
    setSymbolOverrideState({});
  }, [resetVersion]);

  useEffect(() => {
    if (!bulkExecutedSymbols?.length) return;
    setSymbolOverrideState((prev) => {
      const next = { ...prev };
      bulkExecutedSymbols.forEach((symbol) => {
        next[symbol] = "EXECUTE";
      });
      return next;
    });
  }, [bulkExecutedSymbols]);

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
            feedAgeMs:
              Number.isFinite(Number(diag?.feedAgeMs))
                ? Number(diag?.feedAgeMs) + Math.max(0, scanAgeOffsetMs ?? 0)
                : Number.NaN,
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
    [allowedSymbols, profileGateNames, scanAgeOffsetMs, scanDiagnostics, scanLoaded]
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
                ? "border-[#FFB300]/60 bg-[#FFB300]/10 text-[#FFB300]"
                : "border-[#00C853]/60 bg-[#00C853]/10 text-[#00C853]"
            }
          >
            {overrideEnabled ? "Overrides gates" : "No overrides"}
          </Badge>
          <span key={mode} className="text-xs text-muted-foreground tva-text-swap">
            Execution: {mode === TradingMode.AUTO_ON ? "Auto" : "Manual"}
          </span>
          <Button variant="outline" size="sm" onClick={resetChecklist} className="h-8 text-xs">
            Reset gate
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`signals-skeleton-${index}`}
              className="h-9 rounded-md border border-border/60 bg-background/40 tva-skeleton"
            />
          ))}
        </div>
      ) : !scanLoaded ? (
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
                const overrideState = symbolOverrideState[row.symbol] ?? "OFF";
                const manualMode = mode !== TradingMode.AUTO_ON;
                const summaryLabel =
                  overrideState === "EXECUTE"
                    ? `EXECUTE · ${row.ratio}`
                    : overrideState === "ON"
                      ? `OVERRIDE · ${row.ratio}`
                      : `${row.summary.label} · ${row.ratio}`;
                const summaryClass =
                  overrideState === "EXECUTE"
                    ? "border-[#00C853]/60 text-[#00C853] dm-status-pass"
                    : overrideState === "ON"
                      ? "border-[#FFB300]/70 text-[#FFB300] dm-status-warn tva-gate-pulse-1200"
                      : row.summary.tone === "blocked"
                        ? "border-[#D32F2F]/60 text-[#D32F2F] dm-status-sell"
                        : row.summary.tone === "hold"
                          ? "border-[#FFB300]/60 text-[#FFB300] dm-status-warn"
                          : row.summary.tone === "pass"
                            ? "border-[#00C853]/60 text-[#00C853] dm-status-pass"
                            : "border-border/60 text-muted-foreground dm-status-muted";
                const rowClass =
                  overrideState === "ON"
                    ? "tva-gate-pulse-1200 border-[#FFB300]/70"
                    : overrideState === "EXECUTE"
                      ? "border-[#00C853]/60"
                      : row.summary.tone === "pass"
                        ? "border-border/40"
                        : "border-border/40";
                return (
                  <tr
                    key={row.symbol}
                    onClick={() => onSelectSymbol(row.symbol)}
                    className={`cursor-pointer border-b hover:bg-background/30 ${rowClass} ${
                      manualMode ? "opacity-70" : ""
                    } ${
                      selectedSymbol === row.symbol ? "bg-primary/10" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-mono">{row.symbol}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={
                          row.signalActive
                            ? "border-[#00C853]/60 text-[#00C853] dm-status-pass"
                            : "border-border/60 text-muted-foreground dm-status-muted"
                        }
                      >
                        {row.signalActive ? "Skenuje" : "Idle"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={summaryClass} title={row.reason}>
                        {summaryLabel}
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
                            variant={
                              overrideState === "EXECUTE"
                                ? "secondary"
                                : overrideState === "ON"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="h-7 px-2 text-[11px]"
                            aria-label={`Přepnout override pro ${row.symbol}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectSymbol(row.symbol);
                              if (overrideState === "OFF") {
                                setOverrideEnabled(true);
                                setSymbolOverrideState((prev) => ({
                                  ...prev,
                                  [row.symbol]: "ON",
                                }));
                                return;
                              }
                              if (overrideState === "EXECUTE") {
                                setSymbolOverrideState((prev) => ({
                                  ...prev,
                                  [row.symbol]: "OFF",
                                }));
                              }
                            }}
                          >
                            {overrideState === "EXECUTE"
                              ? "Executed"
                              : `Override ${overrideState === "ON" ? "ON" : "OFF"}`}
                          </Button>
                          {overrideState === "ON" ? (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSymbolOverrideState((prev) => ({
                                    ...prev,
                                    [row.symbol]: "EXECUTE",
                                  }));
                                  onToast?.(`${row.symbol} executed`, "success");
                                }}
                              >
                                Confirm
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSymbolOverrideState((prev) => ({
                                    ...prev,
                                    [row.symbol]: "OFF",
                                  }));
                                }}
                              >
                                Cancel
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              aria-label="Resetovat gate checklist"
                              onClick={(event) => {
                                event.stopPropagation();
                                resetChecklist();
                              }}
                            >
                              Reset
                            </Button>
                          )}
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
              const overrideState = symbolOverrideState[row.symbol] ?? "OFF";
              const manualMode = mode !== TradingMode.AUTO_ON;
              const summaryLabel =
                overrideState === "EXECUTE"
                  ? `EXECUTE · ${row.ratio}`
                  : overrideState === "ON"
                    ? `OVERRIDE · ${row.ratio}`
                    : `${row.summary.label} · ${row.ratio}`;
              const summaryClass =
                overrideState === "EXECUTE"
                  ? "border-[#00C853]/60 text-[#00C853] dm-status-pass"
                  : overrideState === "ON"
                    ? "border-[#FFB300]/70 text-[#FFB300] dm-status-warn tva-gate-pulse-1200"
                    : row.summary.tone === "blocked"
                      ? "border-[#D32F2F]/60 text-[#D32F2F] dm-status-sell"
                      : row.summary.tone === "hold"
                        ? "border-[#FFB300]/60 text-[#FFB300] dm-status-warn"
                        : row.summary.tone === "pass"
                          ? "border-[#00C853]/60 text-[#00C853] dm-status-pass"
                          : "border-border/60 text-muted-foreground dm-status-muted";
              const itemClass =
                overrideState === "ON"
                  ? "border-[#FFB300]/80 tva-gate-pulse-1200"
                  : overrideState === "EXECUTE"
                    ? "border-[#00C853]/70"
                    : row.summary.tone === "pass"
                      ? "border-border/70"
                      : "border-border/70";

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
                      : `${itemClass} bg-card/90 hover:bg-card`
                  } ${manualMode ? "opacity-70" : ""} ${
                    selected && overrideState === "ON" ? "tva-gate-pulse-1200" : ""
                  }`}
                >
                  <div className="font-mono text-sm text-foreground">{row.symbol}</div>
                  <Badge variant="outline" className={summaryClass}>
                    {summaryLabel}
                  </Badge>
                  <div className="truncate text-muted-foreground" title={row.reason}>
                    {row.reason}
                  </div>
                  <div className={`text-right text-[11px] tabular-nums ${feedToneClass(row.feedAgeMs)}`}>
                    {formatFeedAge(row.feedAgeMs)}
                  </div>
                  <div className="col-span-4 mt-1 flex items-center justify-end gap-1.5">
                    {row.summary.tone === "blocked" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            overrideState === "EXECUTE"
                              ? "secondary"
                              : overrideState === "ON"
                                ? "secondary"
                                : "outline"
                          }
                          className="h-7 px-2 text-[11px]"
                          aria-label={`Přepnout override pro ${row.symbol}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelectSymbol(row.symbol);
                            if (overrideState === "OFF") {
                              setOverrideEnabled(true);
                              setSymbolOverrideState((prev) => ({
                                ...prev,
                                [row.symbol]: "ON",
                              }));
                              return;
                            }
                            if (overrideState === "EXECUTE") {
                              setSymbolOverrideState((prev) => ({
                                ...prev,
                                [row.symbol]: "OFF",
                              }));
                            }
                          }}
                        >
                          {overrideState === "EXECUTE"
                            ? "Executed"
                            : `Override ${overrideState === "ON" ? "ON" : "OFF"}`}
                        </Button>
                        {overrideState === "ON" ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px]"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSymbolOverrideState((prev) => ({
                                  ...prev,
                                  [row.symbol]: "EXECUTE",
                                }));
                                onToast?.(`${row.symbol} executed`, "success");
                              }}
                            >
                              Confirm
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px]"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSymbolOverrideState((prev) => ({
                                  ...prev,
                                  [row.symbol]: "OFF",
                                }));
                              }}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            aria-label="Resetovat gate checklist"
                            onClick={(event) => {
                              event.stopPropagation();
                              resetChecklist();
                            }}
                          >
                            Reset
                          </Button>
                        )}
                      </>
                    )}
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
