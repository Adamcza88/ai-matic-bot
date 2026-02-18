import { formatMoney, formatPercentRatio, formatSignedMoney } from "@/lib/uiFormat";

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
};

function tileClass(priority: "primary" | "secondary") {
  return `rounded-xl border border-border/70 bg-card/96 p-4 dm-surface-elevated lm-kpi-tile ${
    priority === "primary" ? "shadow-[0_10px_16px_-12px_rgba(0,0,0,0.7)]" : ""
  }`;
}

function pnlTone(value?: number) {
  if (!Number.isFinite(value)) return "text-muted-foreground";
  return (value as number) >= 0
    ? "text-emerald-300 dm-pnl-positive"
    : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative";
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
}: KpiRowProps) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className={tileClass("primary")}>
          <div className="text-xs text-muted-foreground lm-kpi-label">Denní PnL</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums lm-kpi-value ${pnlTone(dailyPnl)}`}>
            {formatSignedMoney(dailyPnl)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Realizováno <span className={`tabular-nums ${pnlTone(dailyPnlBreakdown?.realized)}`}>{formatSignedMoney(dailyPnlBreakdown?.realized)}</span>
          </div>
        </div>

        <div className={tileClass("primary")}>
          <div className="text-xs text-muted-foreground lm-kpi-label">Celkový kapitál</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums lm-data-primary lm-kpi-value">
            {formatMoney(totalCapital)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Otevřené PnL <span className={`tabular-nums ${pnlTone(openPositionsPnl)}`}>{formatSignedMoney(openPositionsPnl)}</span>
          </div>
        </div>

        <div className={tileClass("primary")}>
          <div className="text-xs text-muted-foreground lm-kpi-label">Riziko na obchod</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums lm-data-primary lm-kpi-value">
            {formatPercentRatio(riskPerTradePct)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            ≈ <span className="tabular-nums text-foreground">{formatMoney(riskPerTradeUsd)}</span>
          </div>
        </div>

        <div className={tileClass("primary")}>
          <div className="text-xs text-muted-foreground lm-kpi-label">Realizováno</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums lm-kpi-value ${pnlTone(openPositionsPnl)}`}>
            {formatSignedMoney(openPositionsPnl)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Aktuální PnL otevřených pozic
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={tileClass("secondary")}>
          <div className="text-xs text-muted-foreground lm-kpi-label">Pozice / Příkazy</div>
          <div className="mt-1 text-lg font-semibold tabular-nums lm-data-primary lm-kpi-value">
            {openPositions}/{maxOpenPositions}
          </div>
          <div className="text-xs text-muted-foreground">
            Příkazy <span className="tabular-nums text-foreground">{openOrders}/{maxOpenOrders}</span>
          </div>
        </div>

        <div className={tileClass("secondary")}>
          <div className="text-xs text-muted-foreground lm-kpi-label">Alokováno</div>
          <div className="mt-1 text-lg font-semibold tabular-nums lm-data-primary lm-kpi-value">
            {formatMoney(allocated)}
          </div>
        </div>

        <div className={tileClass("secondary")}>
          <div className="text-xs text-muted-foreground lm-kpi-label">Limit využití</div>
          <div className="mt-1 text-lg font-semibold tabular-nums lm-data-primary lm-kpi-value">
            {maxOpenPositions > 0 ? `${Math.round((openPositions / maxOpenPositions) * 100)} %` : "—"}
          </div>
          <div className="text-xs text-muted-foreground">
            Příkazy {maxOpenOrders > 0 ? `${Math.round((openOrders / maxOpenOrders) * 100)} %` : "—"}
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
