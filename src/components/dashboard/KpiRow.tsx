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

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value?: number) {
  return Number.isFinite(value) ? USD_FORMATTER.format(value as number) : "—";
}

function formatSignedMoney(value?: number) {
  if (!Number.isFinite(value)) return "—";
  const resolved = value as number;
  return `${resolved >= 0 ? "+" : ""}${USD_FORMATTER.format(resolved)}`;
}

function formatPct(value?: number) {
  if (!Number.isFinite(value)) return "—";
  return `${((value as number) * 100).toFixed(2)}%`;
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
  const pnlTone = (value?: number) =>
    Number.isFinite(value)
      ? (value as number) >= 0
        ? "text-emerald-400"
        : "text-red-400"
      : "text-muted-foreground";

  return (
    <section className="space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
        Today Risk & Performance
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Total capital</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {formatMoney(totalCapital)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Allocated</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {formatMoney(allocated)}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div>
          <div className="text-xs text-muted-foreground">Daily PnL</div>
          <div
            className={`mt-2 text-lg font-semibold tabular-nums ${pnlTone(
              dailyPnl
            )}`}
          >
            {formatSignedMoney(dailyPnl)}
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <div className="flex items-center justify-between gap-4">
              <span>Realized</span>
              <span className="tabular-nums">
                {formatSignedMoney(dailyPnlBreakdown?.realized)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Fees</span>
              <span className="tabular-nums">
                {formatSignedMoney(dailyPnlBreakdown?.fees)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Funding</span>
              <span className="tabular-nums">
                {formatSignedMoney(dailyPnlBreakdown?.funding)}
              </span>
            </div>
            {dailyPnlBreakdown?.note ? (
              <div className="pt-1">{dailyPnlBreakdown.note}</div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Open positions</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {openPositions}/{maxOpenPositions}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Open PnL</div>
            <div
              className={`mt-2 text-lg font-semibold tabular-nums ${pnlTone(
                openPositionsPnl
              )}`}
            >
              {formatSignedMoney(openPositionsPnl)}
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Open orders</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {openOrders}/{maxOpenOrders}
            </div>
          </div>
          <div />
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="text-xs text-muted-foreground">Risk per trade</div>
        <div className="mt-2 text-lg font-semibold tabular-nums">
          {formatPct(riskPerTradePct)}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {Number.isFinite(riskPerTradeUsd)
            ? `≈ ${formatMoney(riskPerTradeUsd)}`
            : "N/A"}
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Based on current total capital.
        </div>
      </div>
    </div>
    </section>
  );
}
