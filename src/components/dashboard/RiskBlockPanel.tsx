import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/uiFormat";
import type { ScanDiagnostics } from "@/lib/diagnosticsTypes";
import type { LogEntry } from "@/types";

type RiskBlockPanelProps = {
  allowedSymbols: string[];
  scanDiagnostics: ScanDiagnostics | null;
  lastScanTs: number | null;
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
  riskLevel: "LOW" | "ELEVATED" | "CRITICAL";
  expandSignal?: number;
};

type RiskRow = {
  id: string;
  symbol: string;
  message: string;
  timestamp: number | string | null;
};

function extractSymbol(message: string) {
  const hit = message.match(/\b[A-Z]{2,10}USDT\b/);
  return hit?.[0] ?? "—";
}

function compactMessage(message: string, max = 132) {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function normalizeDiagReason(reason?: string) {
  if (!reason) return "blokováno";
  if (reason === "Exec OFF") return "blokováno (manuální režim)";
  return reason;
}

export default function RiskBlockPanel({
  allowedSymbols,
  scanDiagnostics,
  lastScanTs,
  logEntries,
  logsLoaded,
  riskLevel,
  expandSignal,
}: RiskBlockPanelProps) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (riskLevel === "ELEVATED" || riskLevel === "CRITICAL") {
      setExpanded(true);
    }
  }, [riskLevel, expandSignal]);

  const rows = useMemo(() => {
    const riskLogs: RiskRow[] = (logEntries ?? [])
      .filter((entry) => entry.action === "RISK_BLOCK" || entry.action === "RISK_HALT")
      .slice(0, 4)
      .map((entry) => ({
        id: `log:${entry.id}`,
        symbol: extractSymbol(entry.message),
        message: compactMessage(entry.message),
        timestamp: entry.timestamp,
      }));

    const fromDiag: RiskRow[] = (
      allowedSymbols
        .map((symbol) => {
          const diag = scanDiagnostics?.[symbol];
          if (!diag) return null;
          const entryReasons = Array.isArray(diag.entryBlockReasons) ? diag.entryBlockReasons : [];
          if (diag.executionAllowed !== false && entryReasons.length === 0) return null;
          return {
            id: `diag:${symbol}`,
            symbol,
            message: normalizeDiagReason(entryReasons[0] ?? diag.executionReason ?? diag.manageReason),
            timestamp: diag.lastScanTs ?? lastScanTs,
          };
        })
        .filter(Boolean) as RiskRow[]
    ).slice(0, 4);

    return riskLogs.length > 0 ? riskLogs : fromDiag;
  }, [allowedSymbols, lastScanTs, logEntries, scanDiagnostics]);

  const headerTime = rows[0]?.timestamp ?? lastScanTs;
  const critical = riskLevel === "CRITICAL" || rows.length > 0;

  return (
    <section
      className={`rounded-xl border-2 px-4 py-3 ${
        critical
          ? "border-[#D32F2F]/70 bg-[#D32F2F]/10"
          : "border-[#FFB300]/70 bg-[#FFB300]/10"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-foreground">
          RISK BLOCK – poslední události ({formatClock(headerTime)})
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Skrýt" : "Zobrazit"}
        </Button>
      </div>

      {expanded ? (
        !logsLoaded && rows.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">Načítám risk události…</div>
        ) : rows.length === 0 ? (
          <div className="mt-2 text-xs text-muted-foreground">Bez aktivních risk blokací.</div>
        ) : (
          <div className="mt-2 space-y-1.5">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-[96px,1fr] gap-2 rounded-lg border border-border/60 bg-card/80 px-2.5 py-2 text-xs"
                title={row.message}
              >
                <div className="font-mono text-foreground">{row.symbol}</div>
                <div className="text-muted-foreground">{row.message}</div>
              </div>
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
