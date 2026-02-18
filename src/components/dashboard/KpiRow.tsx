import { formatMoney, formatMs, formatPercentRatio, formatSignedMoney } from "@/lib/uiFormat";

type KpiRowProps = {
  totalCapital?: number;
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
  openPositions: number;
  maxOpenPositions: number;
  openOrders: number;
  maxOpenOrders: number;
  riskPerTradePct?: number;
  riskPerTradeUsd?: number;
  blockedSignals: number;
  gatesPassCount: number;
  gatesTotal: number;
  feedAgeMs?: number;
  feedOk: boolean;
  latencyMs?: number;
};

function tileClass(base: "a" | "b") {
  return `dashboard-tile dashboard-tile-${base} rounded-xl border border-border/70 bg-card/96 p-3 dm-surface-elevated lm-kpi-tile`;
}

export default function KpiRow({
  totalCapital,
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
  blockedSignals,
  gatesPassCount,
  gatesTotal,
  feedAgeMs,
  feedOk,
  latencyMs,
}: KpiRowProps) {
  const pnlTone = (value?: number) =>
    Number.isFinite(value)
      ? (value as number) >= 0
        ? "text-emerald-300 dm-pnl-positive"
        : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative"
      : "text-muted-foreground";

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("a")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Celkový kapitál</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums lm-data-primary lm-kpi-value">
              {formatMoney(totalCapital)}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("a")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Denní PnL</div>
            <div
              className={`mt-2 text-2xl font-semibold tabular-nums lm-data-primary lm-kpi-value ${pnlTone(
                dailyPnl
              )}`}
            >
              {formatSignedMoney(dailyPnl)}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Realizováno {formatSignedMoney(dailyPnlBreakdown?.realized)}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("a")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Otevřené PnL</div>
            <div
              className={`mt-2 text-2xl font-semibold tabular-nums lm-data-primary lm-kpi-value ${pnlTone(
                openPositionsPnl
              )}`}
            >
              {formatSignedMoney(openPositionsPnl)}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("a")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Alokováno</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums lm-data-primary lm-kpi-value">
              {formatMoney(allocated)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 sm:col-span-6 xl:col-span-2">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Pozice</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary lm-kpi-value">
              {openPositions}/{maxOpenPositions}
            </div>
          </div>
        </div>
        <div className="col-span-12 sm:col-span-6 xl:col-span-2">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Příkazy</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary lm-kpi-value">
              {openOrders}/{maxOpenOrders}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Riziko na obchod</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary lm-kpi-value">
              {formatPercentRatio(riskPerTradePct)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {Number.isFinite(riskPerTradeUsd) ? `≈ ${formatMoney(riskPerTradeUsd)}` : "N/A"}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Gate stav</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary lm-kpi-value">
              {gatesPassCount}/{gatesTotal || 0}
            </div>
            <div className="text-[11px] text-muted-foreground">Blokované signály: {blockedSignals}</div>
          </div>
        </div>
        <div className="col-span-12 sm:col-span-6 xl:col-span-2">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground lm-kpi-label">Feed / latence</div>
            <div className="mt-2 text-sm font-semibold tabular-nums lm-data-primary lm-kpi-value">
              {Number.isFinite(feedAgeMs) ? formatMs(feedAgeMs) : "Feed N/A"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {feedOk ? "Feed OK" : "Feed zpožděný"} · {Number.isFinite(latencyMs) ? formatMs(latencyMs) : "N/A"}
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
