import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AssetPnlMap } from "@/lib/pnlHistory";
import Panel from "@/components/dashboard/Panel";
import type { DiagnosticGate, ScanDiagnostics, SymbolDiagnostic } from "@/lib/diagnosticsTypes";

type OverviewTabProps = {
  allowedSymbols: string[];
  assetPnlHistory: AssetPnlMap | null;
  pnlLoaded: boolean;
  resetPnlHistory: () => void;
  strategyLabel: string;
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

function formatFeedAgeMs(value?: number) {
  if (!Number.isFinite(value)) return "N/A";
  const ms = value as number;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function hardStatusLabel(value: "PASS" | "FAIL" | "N/A") {
  if (value === "PASS") return "OK";
  if (value === "FAIL") return "NEPROŠLO";
  return "N/A";
}

function entryStatusLabel(value: "PAUSED" | "READY" | "WAITING" | "BLOCKED") {
  if (value === "PAUSED") return "POZASTAVENO";
  if (value === "READY") return "PŘIPRAVENO";
  if (value === "WAITING") return "ČEKÁ";
  return "BLOKOVÁNO";
}

function dataHealthStatusLabel(value: string) {
  if (value === "SAFE") return "BEZPEČNÁ";
  if (value === "UNSAFE") return "RIZIKOVÁ";
  return value;
}

function heatColor(netPnl: number, maxAbs: number) {
  if (!Number.isFinite(netPnl) || maxAbs <= 0) return "rgba(148,163,184,0.18)";
  const intensity = Math.max(0.12, Math.min(0.9, Math.abs(netPnl) / maxAbs));
  return netPnl >= 0
    ? `rgba(0,200,83,${intensity})`
    : `rgba(211,47,47,${intensity})`;
}

function formatSignedUsdt(value?: number) {
  if (!Number.isFinite(value)) return "—";
  const amount = value as number;
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("cs-CZ", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
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
  strategyLabel,
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
  const entryStatus: "PAUSED" | "READY" | "WAITING" | "BLOCKED" =
    activeDiag?.relayState === "PAUSED"
      ? "PAUSED"
      : activeDiag?.executionAllowed === true
        ? "READY"
        : activeDiag?.relayState === "WAITING" || activeDiag?.executionAllowed == null
          ? "WAITING"
          : "BLOCKED";
  const skipReasonRaw = String(activeDiag?.skipReason ?? "").trim();
  const skipCodeRaw = String(activeDiag?.skipCode ?? "").trim();
  const skipReason = skipReasonRaw && skipCodeRaw ? `[${skipCodeRaw}] ${skipReasonRaw}` : skipReasonRaw;
  const blockReason = normalizeReason(
    activeDiag?.relayReason ||
    skipReason ||
    (Array.isArray(activeDiag?.entryBlockReasons) ? activeDiag?.entryBlockReasons[0] : "") ||
    (Array.isArray(activeDiag?.gateFailureReasons) ? activeDiag?.gateFailureReasons[0] : "") ||
      activeDiag?.executionReason ||
      activeDiag?.manageReason
  );
  const dataHealthStatus = activeDiag?.dataHealthStatus ?? (
    activeDiag?.feedAgeOk === false ? "UNSAFE" : "SAFE"
  );
  const dataHealthReasons = Array.isArray(activeDiag?.dataHealthReasons)
    ? activeDiag?.dataHealthReasons
    : [];
  const feedAgeText = formatFeedAgeMs(Number(activeDiag?.feedAgeMs));
  const tfSyncDetail = String(activeDiag?.timeframeSyncDetail ?? "N/A");
  const watchdogFails = Number(activeDiag?.dataIntegrityWatchdogFails ?? 0);

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
  const maxAbsNetPnl = useMemo(() => {
    const values = pnlRows
      .map((row) => Math.abs(row.netPnl))
      .filter((value) => Number.isFinite(value));
    return values.length > 0 ? Math.max(...values) : 0;
  }, [pnlRows]);

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
        title="Modul filtrů"
        description={activeSymbol ? `Trh ${activeSymbol}` : "Není vybraný trh"}
        fileId="GATE ENGINE ID: TR-01-G"
      >
        {!scanLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám modul filtrů…
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
                {hardStatusLabel(hardStatus)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">ENTRY FILTRY</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{checklistScore}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">STAV</div>
              <div
                className={`mt-1 text-lg font-semibold ${
                  entryStatus === "READY"
                    ? "text-[#00C853]"
                    : entryStatus === "PAUSED" || entryStatus === "WAITING"
                      ? "text-[#FFB300]"
                      : "text-[#D32F2F]"
                }`}
              >
                {entryStatusLabel(entryStatus)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">Důvod blokace</div>
              <div className="mt-1 text-sm text-foreground">
                {entryStatus === "READY" ? "Bez blokace." : blockReason}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Stav dat"
        description={activeSymbol ? `Trh ${activeSymbol}` : "Není vybraný trh"}
        fileId="DATA HEALTH ID: TR-14-DH"
      >
        {!scanLoaded ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Načítám zdraví dat…
          </div>
        ) : !activeSymbol ? (
          <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
            Není dostupný žádný trh.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">STAV</div>
              <div className={`mt-1 text-lg font-semibold ${dataHealthStatus === "SAFE" ? "text-[#00C853]" : "text-[#D32F2F]"}`}>
                {dataHealthStatusLabel(dataHealthStatus)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">Stáří dat</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{feedAgeText}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">Synchronizace H4 vs 5m</div>
              <div className="mt-1 text-sm text-foreground">{tfSyncDetail}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3">
              <div className="text-xs text-muted-foreground">Selhání watchdogu</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{watchdogFails}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/30 p-3 md:col-span-2">
              <div className="text-xs text-muted-foreground">Detail</div>
              <div className="mt-1 text-sm text-foreground">
                {dataHealthReasons.length > 0 ? dataHealthReasons.join(" | ") : "Bez aktivního data health alertu."}
              </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Historie PnL podle trhů"
        fileId="LEDGER ARCHIVE ID: TR-10-H"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={resetPnlHistory}
            className="h-8 text-xs dm-button-control"
          >
            Resetovat
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
            <div className="rounded-lg border border-border/60 bg-background/25 p-3">
              <div className="text-xs text-muted-foreground">
                PnL heatmapa (strategie: {strategyLabel})
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {pnlRows.slice(0, 12).map((row) => (
                  <div
                    key={`heat-${row.symbol}`}
                    className="rounded-md border border-border/60 px-2 py-1.5"
                    style={{ backgroundColor: heatColor(row.netPnl, maxAbsNetPnl) }}
                    title={`${row.symbol} ${formatSignedUsdt(row.netPnl)}`}
                  >
                    <div className="text-[11px] font-mono text-foreground">{row.symbol}</div>
                    <div className="text-xs tabular-nums text-foreground">{formatSignedUsdt(row.netPnl)}</div>
                  </div>
                ))}
              </div>
            </div>

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
                        {formatSignedUsdt(row.netPnl)}
                      </td>
                      <td
                        className={`px-3 text-right tabular-nums leading-6 ${
                          row.latestPnl >= 0
                            ? "text-emerald-300 dm-pnl-positive"
                            : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative"
                        }`}
                      >
                        {formatSignedUsdt(row.latestPnl)}
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
                Předchozí
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
                Další
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
