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

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value?: number) {
  if (!Number.isFinite(value)) return "—";
  return USD_FORMATTER.format(value as number).replace(/,/g, " ");
}

function formatSignedMoney(value?: number) {
  if (!Number.isFinite(value)) return "—";
  const resolved = value as number;
  return `${resolved >= 0 ? "+" : ""}${USD_FORMATTER.format(resolved).replace(/,/g, " ")}`;
}

function formatPct(value?: number) {
  if (!Number.isFinite(value)) return "—";
  return `${((value as number) * 100).toFixed(2)} %`;
}

function tileClass(base: "a" | "b") {
  return `dashboard-tile dashboard-tile-${base} rounded-xl border border-border/70 bg-card/96 p-3 dm-surface-elevated`;
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
            <div className="text-xs text-muted-foreground">Total capital</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums lm-data-primary">
              {formatMoney(totalCapital)}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("a")}>
            <div className="text-xs text-muted-foreground">Daily PnL</div>
            <div
              className={`mt-2 text-2xl font-semibold tabular-nums lm-data-primary ${pnlTone(
                dailyPnl
              )}`}
            >
              {formatSignedMoney(dailyPnl)}
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Realized {formatSignedMoney(dailyPnlBreakdown?.realized)}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("a")}>
            <div className="text-xs text-muted-foreground">Open PnL</div>
            <div
              className={`mt-2 text-2xl font-semibold tabular-nums lm-data-primary ${pnlTone(
                openPositionsPnl
              )}`}
            >
              {formatSignedMoney(openPositionsPnl)}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("a")}>
            <div className="text-xs text-muted-foreground">Allocated</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums lm-data-primary">
              {formatMoney(allocated)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 sm:col-span-6 xl:col-span-2">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground">Positions</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
              {openPositions}/{maxOpenPositions}
            </div>
          </div>
        </div>
        <div className="col-span-12 sm:col-span-6 xl:col-span-2">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground">Orders</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
              {openOrders}/{maxOpenOrders}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground">Risk per trade</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
              {formatPct(riskPerTradePct)}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {Number.isFinite(riskPerTradeUsd) ? `≈ ${formatMoney(riskPerTradeUsd)}` : "N/A"}
            </div>
          </div>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground">Risk status / Gates</div>
            <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
              {gatesPassCount}/{gatesTotal || 0}
            </div>
            <div className="text-[11px] text-muted-foreground">Blocked signals: {blockedSignals}</div>
          </div>
        </div>
        <div className="col-span-12 sm:col-span-6 xl:col-span-2">
          <div className={tileClass("b")}>
            <div className="text-xs text-muted-foreground">Feed / Latency</div>
            <div className="mt-2 text-sm font-semibold tabular-nums lm-data-primary">
              {Number.isFinite(feedAgeMs) ? `${feedAgeMs} ms` : "Feed N/A"}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {feedOk ? "Feed OK" : "Feed delay"} · {Number.isFinite(latencyMs) ? `${latencyMs} ms` : "N/A"}
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
