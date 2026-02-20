import { formatMoney, formatPercentRatio } from "@/lib/uiFormat";

type KpiRowProps = {
  dataHealthSafe: boolean;
  latencyMs?: number;
  feedAgeRangeMs?: {
    min: number;
    max: number;
  };
  gatesPassCount: number;
  gatesTotal: number;
  blockedSignals: number;
  totalCapital?: number;
  capitalRange?: {
    min: number;
    max: number;
  };
  allocated?: number;
  dailyPnl?: number;
  dailyPnlBreakdown?: {
    realized?: number;
    fees?: number;
    funding?: number;
    other?: number;
    note?: string;
  };
  openPositionsPnl?: number;
  openPositionsPnlRange?: {
    min: number;
    max: number;
  };
  openPositions: number;
  maxOpenPositions: number;
  openOrders: number;
  maxOpenOrders: number;
  riskPerTradePct?: number;
  riskPerTradeUsd?: number;
  loading?: boolean;
};

export default function KpiRow({
  openPositions,
  maxOpenPositions,
  openOrders,
  maxOpenOrders,
  riskPerTradePct,
  riskPerTradeUsd,
  loading,
}: KpiRowProps) {
  const positionUsagePct = maxOpenPositions > 0
    ? Math.round((openPositions / maxOpenPositions) * 100)
    : 0;
  const orderUsagePct = maxOpenOrders > 0
    ? Math.round((openOrders / maxOpenOrders) * 100)
    : 0;
  const capacityUsagePct = Math.max(positionUsagePct, orderUsagePct);
  const usageBarPct = Math.max(0, Math.min(100, capacityUsagePct));

  return (
    <section className={`${loading ? "tva-loading-values" : ""}`}>
      <div className="grid grid-cols-1 gap-3">
        <div className="rounded-xl border border-border/70 bg-card/96 p-4 lg:p-6 dm-surface-elevated">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Positions & Exposure</div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Aktivní pozice</span>
              <span className="font-semibold tabular-nums text-foreground">{openPositions}/{maxOpenPositions}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Otevřené příkazy</span>
              <span className="font-semibold tabular-nums text-foreground">{openOrders}/{maxOpenOrders}</span>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Využití kapacity (max pozice/příkazy)</span>
                <span className={`font-semibold tabular-nums ${capacityUsagePct > 80 ? "text-[#D32F2F]" : capacityUsagePct > 60 ? "text-[#FFB300]" : "text-[#00C853]"}`}>
                  {capacityUsagePct} %
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-background/60">
                <div
                  className={`h-1.5 rounded-full ${capacityUsagePct > 80 ? "bg-[#D32F2F]" : capacityUsagePct > 60 ? "bg-[#FFB300]" : "bg-[#00C853]"}`}
                  style={{ width: `${usageBarPct}%` }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Risk per trade</span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatPercentRatio(riskPerTradePct)} ≈ {formatMoney(riskPerTradeUsd)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
