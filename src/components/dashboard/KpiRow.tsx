type KpiRowProps = {
  totalCapital?: number;
  allocated?: number;
  dailyPnl?: number;
  openPositionsPnl?: number;
  openPositions: number;
  maxOpenPositions: number;
  openOrders: number;
  maxOpenOrders: number;
};

function formatMoney(value?: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export default function KpiRow({
  totalCapital,
  allocated,
  dailyPnl,
  openPositionsPnl,
  openPositions,
  maxOpenPositions,
  openOrders,
  maxOpenOrders,
}: KpiRowProps) {
  const formatPnl = (value?: number) => {
    if (!Number.isFinite(value)) return "—";
    const resolved = value as number;
    return `${resolved >= 0 ? "+" : ""}${resolved.toFixed(2)} USD`;
  };
  const pnlTone = (value?: number) =>
    Number.isFinite(value)
      ? (value as number) >= 0
        ? "text-emerald-400"
        : "text-red-400"
      : "text-muted-foreground";

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Total capital</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              ${formatMoney(totalCapital)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Allocated</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              ${formatMoney(allocated)}
            </div>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Daily PnL</div>
            <div
              className={`mt-2 text-lg font-semibold tabular-nums ${pnlTone(
                dailyPnl
              )}`}
            >
              {formatPnl(dailyPnl)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Open PnL</div>
            <div
              className={`mt-2 text-lg font-semibold tabular-nums ${pnlTone(
                openPositionsPnl
              )}`}
            >
              {formatPnl(openPositionsPnl)}
            </div>
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
            <div className="text-xs text-muted-foreground">Open orders</div>
            <div className="mt-2 text-lg font-semibold tabular-nums">
              {openOrders}/{maxOpenOrders}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
