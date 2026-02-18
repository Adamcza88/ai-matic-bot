import { formatMoney, formatMs, formatPercentRatio, formatSignedMoney } from "@/lib/uiFormat";

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
};

type MetricLineProps = {
  label: string;
  value: string;
  valueClassName?: string;
};

function tileClass(priority: "primary" | "secondary") {
  return `rounded-xl border border-border/70 bg-card/96 p-4 dm-surface-elevated lm-kpi-tile ${
    priority === "primary" ? "shadow-[0_10px_16px_-12px_rgba(0,0,0,0.7)]" : ""
  }`;
}

function MetricLine({ label, value, valueClassName }: MetricLineProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums text-foreground ${valueClassName ?? ""}`}>{value}</span>
    </div>
  );
}

function formatRange(min?: number, max?: number, formatter: (value?: number) => string = formatMoney) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "—";
  if (Math.abs((min as number) - (max as number)) < 0.005) return formatter(min);
  return `${formatter(min)} – ${formatter(max)}`;
}

function formatFeedRange(range?: { min: number; max: number }) {
  if (!range) return "—";
  const toSec = (value: number) => `${(value / 1000).toFixed(1)} s`;
  return formatRange(range.min, range.max, toSec);
}

function feedToneClass(value?: number) {
  if (!Number.isFinite(value)) return "bg-border";
  if ((value as number) < 2_000) return "bg-emerald-500";
  if ((value as number) <= 10_000) return "bg-amber-500";
  return "bg-red-500";
}

function pnlTone(value?: number) {
  if (!Number.isFinite(value)) return "text-muted-foreground";
  return (value as number) >= 0
    ? "text-emerald-300 dm-pnl-positive"
    : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative";
}

export default function KpiRow({
  dataHealthSafe,
  latencyMs,
  feedAgeRangeMs,
  gatesPassCount,
  gatesTotal,
  blockedSignals,
  totalCapital,
  capitalRange,
  allocated,
  dailyPnl,
  dailyPnlBreakdown,
  openPositionsPnl,
  openPositionsPnlRange,
  openPositions,
  maxOpenPositions,
  openOrders,
  maxOpenOrders,
  riskPerTradePct,
  riskPerTradeUsd,
}: KpiRowProps) {
  const usagePct = maxOpenPositions > 0 ? Math.round((openPositions / maxOpenPositions) * 100) : 0;
  const feedStripeClass = feedToneClass(feedAgeRangeMs?.max);

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className={tileClass("secondary")}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Health & Latency</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Data Health</div>
              <div
                className={`mt-1 inline-flex items-center gap-1 font-semibold ${
                  dataHealthSafe ? "text-emerald-300" : "text-red-300"
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    dataHealthSafe ? "bg-emerald-400" : "bg-red-400"
                  }`}
                  aria-hidden
                />
                {dataHealthSafe ? "SAFE" : "UNSAFE"}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Latency</div>
              <div className="mt-1 font-semibold tabular-nums text-foreground">{formatMs(latencyMs)}</div>
            </div>

            <div className="col-span-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-muted-foreground">Feed age</div>
                <div className="text-2xl font-semibold tabular-nums text-foreground">{formatFeedRange(feedAgeRangeMs)}</div>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-background/50">
                <div className={`h-1.5 w-full rounded-full ${feedStripeClass}`} />
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Gates</div>
              <div className="mt-1 font-semibold tabular-nums text-foreground">
                {gatesPassCount}/{gatesTotal || 0}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">Blocked</div>
              <div className={`mt-1 font-semibold tabular-nums ${blockedSignals > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                {blockedSignals}
              </div>
            </div>
          </div>
        </div>

        <div className={tileClass("secondary")}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Positions & Risk</div>
          <div className="mt-3 space-y-2 text-sm">
            <MetricLine
              label="Pozice / příkazy"
              value={`${openPositions}/${maxOpenPositions} · ${openOrders}/${maxOpenOrders}`}
            />
            <MetricLine label="Alokováno" value={formatMoney(allocated)} />
            <MetricLine label="Využití limitu" value={`${usagePct} %`} />
            <MetricLine
              label="Riziko na obchod"
              value={`${formatPercentRatio(riskPerTradePct)} ≈ ${formatMoney(riskPerTradeUsd)}`}
            />
          </div>
        </div>

        <div className={tileClass("primary")}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PnL přehled</div>
          <div className="mt-3 text-right">
            <div className="text-[11px] text-muted-foreground">Denní PnL</div>
            <div className={`text-[42px] font-semibold tabular-nums leading-none ${pnlTone(dailyPnl)}`}>
              {formatSignedMoney(dailyPnl)}
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Realizováno</span>
              <span className={`font-semibold tabular-nums ${pnlTone(dailyPnlBreakdown?.realized)}`}>
                {formatSignedMoney(dailyPnlBreakdown?.realized)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Otevřené PnL</span>
              <span className={`font-semibold tabular-nums ${pnlTone(openPositionsPnl)}`}>
                {formatRange(openPositionsPnlRange?.min, openPositionsPnlRange?.max, formatSignedMoney)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Celkový kapitál</span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatRange(capitalRange?.min, capitalRange?.max, formatMoney) !== "—"
                  ? formatRange(capitalRange?.min, capitalRange?.max, formatMoney)
                  : formatMoney(totalCapital)}
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
