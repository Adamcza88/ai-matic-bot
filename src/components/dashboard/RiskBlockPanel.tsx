import { useMemo } from "react";
import { formatMoney, formatSignedMoney } from "@/lib/uiFormat";
import type { ScanDiagnostics } from "@/lib/diagnosticsTypes";
import type { LogEntry } from "@/types";

type RiskBlockPanelProps = {
  allowedSymbols: string[];
  scanDiagnostics: ScanDiagnostics | null;
  logEntries: LogEntry[] | null;
  logsLoaded: boolean;
  riskLevel: "LOW" | "ELEVATED" | "CRITICAL";
  dailyPnl?: number;
  maxDailyLossUsd?: number;
  killSwitchActive?: boolean;
  riskExposureUsd?: number;
  riskExposureLimitUsd?: number;
};

type AggregatedRiskEvent = {
  symbol: string;
  reason: string;
  count: number;
};

function extractSymbol(message: string) {
  const hit = message.match(/\b[A-Z]{2,10}USDT\b/);
  return hit?.[0] ?? "—";
}

function normalizeRiskReason(message: string) {
  const text = String(message ?? "").toLowerCase();
  if (text.includes("open pos/order") || text.includes("open position") || text.includes("pozice")) {
    return "open position";
  }
  if (text.includes("exec off")) return "execution off";
  return String(message ?? "blokováno").replace(/\s+/g, " ").trim();
}

export default function RiskBlockPanel({
  allowedSymbols,
  scanDiagnostics,
  logEntries,
  logsLoaded,
  riskLevel,
  dailyPnl,
  maxDailyLossUsd,
  killSwitchActive,
  riskExposureUsd,
  riskExposureLimitUsd,
}: RiskBlockPanelProps) {
  const exposurePct = Number.isFinite(riskExposureUsd) && Number.isFinite(riskExposureLimitUsd) && (riskExposureLimitUsd as number) > 0
    ? Math.round(((riskExposureUsd as number) / (riskExposureLimitUsd as number)) * 100)
    : 0;
  const cappedExposurePct = Math.max(0, Math.min(100, exposurePct));
  const maxDailyLossBreach = Number.isFinite(dailyPnl) && Number.isFinite(maxDailyLossUsd)
    ? (dailyPnl as number) <= (maxDailyLossUsd as number)
    : false;

  const aggregatedRiskEvents = useMemo(() => {
    const map = new Map<string, AggregatedRiskEvent>();
    for (const entry of (logEntries ?? []).slice(0, 200)) {
      if (entry.action !== "RISK_BLOCK" && entry.action !== "RISK_HALT") continue;
      const symbol = extractSymbol(entry.message);
      const reason = normalizeRiskReason(entry.message);
      const key = `${symbol}|${reason}`;
      const current = map.get(key);
      if (!current) {
        map.set(key, { symbol, reason, count: 1 });
      } else {
        current.count += 1;
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [logEntries]);

  const gateBlocked = useMemo(() => {
    return allowedSymbols
      .map((symbol) => {
        const diag = scanDiagnostics?.[symbol];
        const reasons = Array.isArray(diag?.entryBlockReasons) ? diag.entryBlockReasons : [];
        if (diag?.executionAllowed !== false || reasons.length === 0) return null;
        return `${symbol}: ${reasons[0]}`;
      })
      .filter(Boolean) as string[];
  }, [allowedSymbols, scanDiagnostics]);

  const shellTone =
    riskLevel === "CRITICAL"
      ? "border-[#D32F2F]/70 bg-[#D32F2F]/10"
      : riskLevel === "ELEVATED"
        ? "border-[#FFB300]/70 bg-[#FFB300]/10"
        : "border-border/70 bg-card/96";

  return (
    <section className={`rounded-xl border px-4 py-3 ${shellTone}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Risk Control</div>
          <div className="text-xs text-muted-foreground">Agregace blokací z posledních 200 událostí.</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
          <div className="text-xs text-muted-foreground">Max denní ztráta</div>
          <div className={`mt-1 font-semibold tabular-nums ${maxDailyLossBreach ? "text-[#D32F2F]" : "text-foreground"}`}>
            {formatSignedMoney(maxDailyLossUsd)}
          </div>
          <div className={`text-[11px] ${maxDailyLossBreach ? "text-[#D32F2F]" : "text-[#00C853]"}`}>
            {maxDailyLossBreach ? "Breach" : "Within limit"}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
          <div className="text-xs text-muted-foreground">Kill-switch</div>
          <div className={`mt-1 font-semibold ${killSwitchActive ? "text-[#D32F2F]" : "text-[#00C853]"}`}>
            {killSwitchActive ? "ACTIVE" : "READY"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {killSwitchActive ? "Trading halted" : "Monitoring only"}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
          <div className="text-xs text-muted-foreground">Risk exposure vs limit</div>
          <div className="mt-1 font-semibold tabular-nums text-foreground">
            {formatMoney(riskExposureUsd)} / {formatMoney(riskExposureLimitUsd)}
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-background/60">
            <div
              className={`h-1.5 rounded-full ${exposurePct > 100 ? "bg-[#D32F2F]" : exposurePct > 80 ? "bg-[#FFB300]" : "bg-[#00C853]"}`}
              style={{ width: `${cappedExposurePct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border/60 bg-background/35 p-2.5">
        <div className="text-xs text-muted-foreground">Blokace (agregace)</div>
        {!logsLoaded && aggregatedRiskEvents.length === 0 ? (
          <div className="mt-1 text-xs text-muted-foreground">Načítám risk události…</div>
        ) : aggregatedRiskEvents.length === 0 && gateBlocked.length === 0 ? (
          <div className="mt-1 text-xs text-muted-foreground">Bez aktivních blokací.</div>
        ) : (
          <div className="mt-1 space-y-1 text-xs">
            {aggregatedRiskEvents.map((event) => (
              <div key={`${event.symbol}-${event.reason}`} className="text-muted-foreground">
                RISK_BLOCK {event.symbol} ×{event.count} ({event.reason})
              </div>
            ))}
            {aggregatedRiskEvents.length === 0
              ? gateBlocked.slice(0, 2).map((row) => (
                  <div key={row} className="text-muted-foreground">
                    {row}
                  </div>
                ))
              : null}
          </div>
        )}
      </div>
    </section>
  );
}
