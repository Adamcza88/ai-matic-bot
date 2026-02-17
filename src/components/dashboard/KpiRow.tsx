type KpiRowProps = {
  theme: "dark" | "light";
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

export default function KpiRow({
  theme,
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
  const isTvaTheme = theme === "light";
  const pnlTone = (value?: number) =>
    Number.isFinite(value)
      ? (value as number) >= 0
        ? "text-emerald-300"
        : "text-[#A94B4B] lm-pnl-negative"
      : "text-muted-foreground";

  return (
    <section className="space-y-3">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground lm-data-secondary lm-micro">
        {isTvaTheme ? "RISK MODULE ID: TR-04-A" : "Today Risk & Performance"}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border/70 bg-card/96 p-3">
          <div className="text-xs text-muted-foreground lm-data-secondary lm-micro">
            {isTvaTheme ? "Total Capital Allocation" : "Total capital"}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums lm-data-primary">
            {formatMoney(totalCapital)}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card/96 p-3">
          <div className="text-xs text-muted-foreground lm-data-secondary lm-micro">
            {isTvaTheme ? "Daily Temporal Deviation" : "Daily PnL"}
          </div>
          <div
            className={`mt-2 text-2xl font-semibold tabular-nums lm-data-primary ${pnlTone(
              dailyPnl
            )}`}
          >
            {formatSignedMoney(dailyPnl)}
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground lm-data-secondary">
            <div className="flex items-center justify-between gap-4">
              <span className="lm-micro">
                {isTvaTheme ? "Closed Ledger Impact" : "Realized"}
              </span>
              <span className="tabular-nums">
                {formatSignedMoney(dailyPnlBreakdown?.realized)}
              </span>
            </div>
            {Number.isFinite(dailyPnlBreakdown?.fees) ||
            Number.isFinite(dailyPnlBreakdown?.funding) ? (
              <div className="flex items-center justify-between gap-4">
                <span className="lm-micro">
                  {isTvaTheme ? "Operational Friction" : "Fees / Funding"}
                </span>
                <span className="tabular-nums">
                  {formatSignedMoney(
                    (dailyPnlBreakdown?.fees ?? 0) + (dailyPnlBreakdown?.funding ?? 0)
                  )}
                </span>
              </div>
            ) : isTvaTheme ? (
              <div className="flex items-center justify-between gap-4">
                <span className="lm-micro">Operational Friction</span>
                <span className="tabular-nums">N/A</span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card/96 p-3">
          <div className="text-xs text-muted-foreground lm-data-secondary lm-micro">
            {isTvaTheme ? "Open Position Deviation" : "Open PnL"}
          </div>
          <div
            className={`mt-2 text-2xl font-semibold tabular-nums lm-data-primary ${pnlTone(
              openPositionsPnl
            )}`}
          >
            {formatSignedMoney(openPositionsPnl)}
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border/70 bg-card/96 p-3">
          <div className="text-xs text-muted-foreground lm-data-secondary lm-micro">Positions</div>
          <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
            {openPositions}/{maxOpenPositions}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card/96 p-3">
          <div className="text-xs text-muted-foreground lm-data-secondary lm-micro">Orders</div>
          <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
            {openOrders}/{maxOpenOrders}
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card/96 p-3">
          <div className="text-xs text-muted-foreground lm-data-secondary lm-micro">
            {isTvaTheme ? "Risk Per Directive" : "Risk per trade"}
          </div>
          <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
            {formatPct(riskPerTradePct)}{" "}
            <span className="text-sm text-muted-foreground lm-data-secondary">
              ({Number.isFinite(riskPerTradeUsd) ? `≈ ${formatMoney(riskPerTradeUsd)}` : "N/A"})
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-border/70 bg-card/96 p-3">
          <div className="text-xs text-muted-foreground lm-data-secondary lm-micro">
            {isTvaTheme ? "Allocated Ceiling" : "Allocated (limit)"}
          </div>
          <div className="mt-2 text-lg font-semibold tabular-nums lm-data-primary">
            {formatMoney(allocated)}
          </div>
        </div>
      </div>
      {dailyPnlBreakdown?.note ? (
        <div className="rounded-lg border border-border/70 bg-card/96 px-3 py-2 text-[11px] text-muted-foreground lm-data-secondary">
          {dailyPnlBreakdown.note}
        </div>
      ) : null}
    </section>
  );
}
