import { formatMoney, formatPercentRatio, formatSignedMoney } from "@/lib/uiFormat";

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

function pnlTone(value?: number) {
  if (!Number.isFinite(value)) return "text-muted-foreground";
  return (value as number) >= 0
    ? "text-[#00C853] dm-pnl-positive"
    : "text-[#FF6B6B] dm-pnl-negative";
}

function moneyRange(range?: { min: number; max: number }, fallback?: number) {
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return formatMoney(fallback);
  }
  if (Math.abs(range.min - range.max) < 0.005) return formatMoney(range.min);
  return `${formatMoney(range.min)} – ${formatMoney(range.max)}`;
}

export default function KpiRow({
  totalCapital,
  capitalRange,
  allocated,
  dailyPnl,
  dailyPnlBreakdown,
  openPositionsPnl,
  openPositions,
  maxOpenPositions,
  openOrders,
  maxOpenOrders,
  riskPerTradePct,
  riskPerTradeUsd,
  loading,
}: KpiRowProps) {
  const usagePct = maxOpenPositions > 0 ? Math.round((openPositions / maxOpenPositions) * 100) : 0;
  const usageBarPct = Math.max(0, Math.min(100, usagePct));
  const negativeDaily = Number.isFinite(dailyPnl) ? (dailyPnl as number) < 0 : false;

  return (
    <section className={`space-y-3 ${loading ? "tva-loading-values" : ""}`}>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.8fr_1.2fr]">
        <div className="rounded-xl border border-border/70 bg-card/96 p-4 lg:p-6 dm-surface-elevated">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Capital & Risk</div>

          <div
            className={`mt-3 rounded-xl border-2 px-4 py-4 ${
              negativeDaily
                ? "border-[#D32F2F]/80 bg-[#31141A]"
                : "border-[#00C853]/40 bg-[#0C2216]"
            }`}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Denní PnL</div>
            <div className={`mt-2 text-[52px] font-semibold tabular-nums leading-none ${pnlTone(dailyPnl)}`}>
              {formatSignedMoney(dailyPnl)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Celkový kapitál</span>
              <span className="font-semibold tabular-nums text-foreground">{moneyRange(capitalRange, totalCapital)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Realizováno</span>
              <span className={`font-semibold tabular-nums ${pnlTone(dailyPnlBreakdown?.realized)}`}>
                {formatSignedMoney(dailyPnlBreakdown?.realized)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Otevřené PnL</span>
              <span className={`font-semibold tabular-nums ${pnlTone(openPositionsPnl)}`}>
                {formatSignedMoney(openPositionsPnl)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Alokováno</span>
              <span className="font-semibold tabular-nums text-foreground">{formatMoney(allocated)}</span>
            </div>
          </div>
        </div>

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
                <span className="text-muted-foreground">Využití limitu</span>
                <span className={`font-semibold tabular-nums ${usagePct > 80 ? "text-[#D32F2F]" : usagePct > 60 ? "text-[#FFB300]" : "text-[#00C853]"}`}>
                  {usagePct} %
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-background/60">
                <div
                  className={`h-1.5 rounded-full ${usagePct > 80 ? "bg-[#D32F2F]" : usagePct > 60 ? "bg-[#FFB300]" : "bg-[#00C853]"}`}
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

      {dailyPnlBreakdown?.note ? (
        <div className="rounded-lg border border-border/70 bg-card/96 px-3 py-2 text-[11px] text-muted-foreground dm-surface-elevated">
          {dailyPnlBreakdown.note}
        </div>
      ) : null}
    </section>
  );
}
