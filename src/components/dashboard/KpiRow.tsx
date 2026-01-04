import { Badge } from "@/components/ui/badge";

type KpiRowProps = {
  totalCapital?: number;
  allocated?: number;
  dailyPnl?: number;
  openPositions: number;
  maxOpenPositions: number;
  openOrders: number;
  maxOpenOrders: number;
  engineStatus: "Running" | "Paused";
};

function formatMoney(value?: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export default function KpiRow({
  totalCapital,
  allocated,
  dailyPnl,
  openPositions,
  maxOpenPositions,
  openOrders,
  maxOpenOrders,
  engineStatus,
}: KpiRowProps) {
  const dailyPnlOk = Number.isFinite(dailyPnl);
  const dailyPnlValue = dailyPnlOk ? (dailyPnl as number) : null;
  const dailyPnlLabel = dailyPnlOk
    ? `${dailyPnlValue >= 0 ? "+" : ""}${dailyPnlValue.toFixed(2)} USD`
    : "—";

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="text-xs text-muted-foreground">Total capital</div>
        <div className="mt-2 text-lg font-semibold tabular-nums">
          ${formatMoney(totalCapital)}
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="text-xs text-muted-foreground">Allocated</div>
        <div className="mt-2 text-lg font-semibold tabular-nums">
          ${formatMoney(allocated)}
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="text-xs text-muted-foreground">Daily PnL</div>
        <div
          className={`mt-2 text-lg font-semibold tabular-nums ${
            dailyPnlOk
              ? dailyPnlValue >= 0
                ? "text-emerald-400"
                : "text-red-400"
              : "text-muted-foreground"
          }`}
        >
          {dailyPnlLabel}
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="text-xs text-muted-foreground">Open positions</div>
        <div className="mt-2 text-lg font-semibold tabular-nums">
          {openPositions}/{maxOpenPositions}
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="text-xs text-muted-foreground">Open orders</div>
        <div className="mt-2 text-lg font-semibold tabular-nums">
          {openOrders}/{maxOpenOrders}
        </div>
      </div>
      <div className="rounded-lg border border-border/60 bg-card/60 p-3">
        <div className="text-xs text-muted-foreground">Engine status</div>
        <div className="mt-2 text-lg font-semibold">
          <Badge
            variant="outline"
            className={
              engineStatus === "Running"
                ? "border-emerald-500/50 text-emerald-400"
                : "border-amber-500/50 text-amber-400"
            }
          >
            {engineStatus}
          </Badge>
        </div>
      </div>
    </div>
  );
}
