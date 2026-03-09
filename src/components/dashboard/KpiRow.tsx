type KpiRowProps = {
  totalCapital?: number;
  availableBalance?: number;
  openPositions: number;
  maxOpenPositions: number;
  openOrders: number;
  maxOpenOrders: number;
  riskPerTradePct?: number;
  riskPerTradeUsd?: number;
  riskExposureUsd?: number;
  riskExposureLimitUsd?: number;
  loading?: boolean;
};

function formatUsdt(value?: number, signed = false) {
  if (!Number.isFinite(value)) return "—";
  const amount = value as number;
  const sign = signed && amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
}

function formatPercent(value?: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return `${((value as number) * 100).toFixed(digits)} %`;
}

function usageTone(pct: number) {
  if (pct > 80) return "text-[#D32F2F]";
  if (pct > 60) return "text-[#FFB300]";
  return "text-[#00C853]";
}

function barTone(pct: number) {
  if (pct > 80) return "bg-[#D32F2F]";
  if (pct > 60) return "bg-[#FFB300]";
  return "bg-[#00C853]";
}

function buildTextBar(current: number, limit: number, width = 10) {
  if (!Number.isFinite(limit) || limit <= 0) return "░".repeat(width);
  const ratio = Math.max(0, Math.min(1, current / limit));
  const filled = Math.round(ratio * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export default function KpiRow({
  totalCapital,
  availableBalance,
  openPositions,
  maxOpenPositions,
  openOrders,
  maxOpenOrders,
  riskPerTradePct,
  riskPerTradeUsd,
  riskExposureUsd,
  riskExposureLimitUsd,
  loading,
}: KpiRowProps) {
  const positionUsagePct =
    maxOpenPositions > 0 ? Math.round((openPositions / maxOpenPositions) * 100) : 0;
  const orderUsagePct =
    maxOpenOrders > 0 ? Math.round((openOrders / maxOpenOrders) * 100) : 0;
  const positionBarPct = Math.max(0, Math.min(100, positionUsagePct));
  const orderBarPct = Math.max(0, Math.min(100, orderUsagePct));
  const usedMargin =
    Number.isFinite(totalCapital) && Number.isFinite(availableBalance)
      ? Math.max(0, (totalCapital as number) - (availableBalance as number))
      : Number.NaN;
  const leverageExposure =
    Number.isFinite(riskExposureUsd) && Number.isFinite(totalCapital) && (totalCapital as number) > 0
      ? (riskExposureUsd as number) / (totalCapital as number)
      : Number.NaN;
  const liquidationBuffer =
    Number.isFinite(availableBalance) && Number.isFinite(totalCapital) && (totalCapital as number) > 0
      ? (availableBalance as number) / (totalCapital as number)
      : Number.NaN;

  return (
    <section className={`${loading ? "tva-loading-values" : ""}`}>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-card/96 p-4 dm-surface-elevated">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Rizikový panel
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Riziko / obchod</div>
              <div className="mt-1 font-mono-ui text-lg font-semibold tabular-nums text-foreground">
                {formatPercent(riskPerTradePct)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Riziko pozice</div>
              <div className="mt-1 font-mono-ui text-lg font-semibold tabular-nums text-foreground">
                {formatUsdt(riskPerTradeUsd)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Max přidání pozice</div>
              <div className="mt-1 font-mono-ui text-lg font-semibold tabular-nums text-foreground">1</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/96 p-4 dm-surface-elevated">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Pozice a expozice
          </div>
          <div className="mt-3 space-y-3 text-sm">
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">POZICE</span>
                <span className={`font-mono-ui tabular-nums ${usageTone(positionUsagePct)}`}>
                  {openPositions} / {maxOpenPositions}
                </span>
              </div>
              <div className="mt-1 font-mono-ui text-xs text-muted-foreground">
                {buildTextBar(openPositions, maxOpenPositions)} {positionUsagePct}%
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-background/60">
                <div
                  className={`h-1.5 rounded-full ${barTone(positionUsagePct)}`}
                  style={{ width: `${positionBarPct}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">OTEVŘENÉ PŘÍKAZY</span>
                <span className={`font-mono-ui tabular-nums ${usageTone(orderUsagePct)}`}>
                  {openOrders} / {maxOpenOrders}
                </span>
              </div>
              <div className="mt-1 font-mono-ui text-xs text-muted-foreground">
                {buildTextBar(openOrders, maxOpenOrders)} {orderUsagePct}%
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-background/60">
                <div
                  className={`h-1.5 rounded-full ${barTone(orderUsagePct)}`}
                  style={{ width: `${orderBarPct}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Expozice vůči limitu</div>
              <div className="mt-1 font-mono-ui text-xs tabular-nums text-foreground">
                {formatUsdt(riskExposureUsd)} / {formatUsdt(riskExposureLimitUsd)}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/96 p-4 dm-surface-elevated">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Marže
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Volná marže</span>
              <span className="font-mono-ui font-semibold tabular-nums text-foreground">
                {formatUsdt(availableBalance)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Použitá marže</span>
              <span className="font-mono-ui font-semibold tabular-nums text-foreground">
                {formatUsdt(usedMargin)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Využití páky</span>
              <span className="font-mono-ui font-semibold tabular-nums text-foreground">
                {formatPercent(leverageExposure)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Likvidační rezerva</span>
              <span className="font-mono-ui font-semibold tabular-nums text-foreground">
                {formatPercent(liquidationBuffer)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
