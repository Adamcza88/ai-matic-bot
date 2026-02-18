import { formatClock, formatMoney, formatSignedMoney } from "@/lib/uiFormat";

type StatusBarProps = {
  title: string;
  subtitle?: string;
  engineStatus: "Running" | "Paused";
  lastScanTs: number | null;
  riskLevel: "LOW" | "ELEVATED" | "CRITICAL";
  dataHealthSafe: boolean;
  dailyPnl?: number;
  totalCapital?: number;
  openPositionsPnlRange?: {
    min: number;
    max: number;
  };
  capitalRange?: {
    min: number;
    max: number;
  };
};

function formatMoneyRange(range?: { min: number; max: number }) {
  if (!range) return "—";
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return "—";
  if (Math.abs(range.min - range.max) < 0.005) return formatMoney(range.min);
  return `${formatMoney(range.min)} – ${formatMoney(range.max)}`;
}

function formatSignedMoneyRange(range?: { min: number; max: number }) {
  if (!range) return "—";
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return "—";
  if (Math.abs(range.min - range.max) < 0.005) return formatSignedMoney(range.min);
  return `${formatSignedMoney(range.min)} – ${formatSignedMoney(range.max)}`;
}

export default function StatusBar({
  title,
  subtitle,
  engineStatus,
  lastScanTs,
  riskLevel,
  dataHealthSafe,
  dailyPnl,
  totalCapital,
  openPositionsPnlRange,
  capitalRange,
}: StatusBarProps) {
  const riskTone =
    riskLevel === "CRITICAL"
      ? "text-red-300"
      : riskLevel === "ELEVATED"
        ? "text-amber-300"
        : "text-emerald-300";
  const healthLabel = dataHealthSafe ? "SAFE" : "UNSAFE";
  const healthTone = dataHealthSafe ? "text-emerald-300" : "text-red-300";
  const shellTone =
    riskLevel === "CRITICAL"
      ? "border-red-500/70 bg-red-500/5"
      : riskLevel === "ELEVATED"
        ? "border-amber-500/70 bg-amber-500/5"
        : "border-emerald-500/60 bg-emerald-500/5";

  return (
    <section
      className={`sticky top-0 z-20 rounded-xl border-2 p-4 shadow-[0_8px_18px_-10px_rgba(0,0,0,0.65)] backdrop-blur ${shellTone}`}
    >
      <div className="grid gap-3 xl:grid-cols-[0.95fr,1.05fr]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">ENGINE</div>
            <div
              className={`mt-0.5 text-sm font-semibold tracking-wide ${
                engineStatus === "Running" ? "text-emerald-300" : "text-amber-300"
              }`}
            >
              {engineStatus.toUpperCase()}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">RISK</div>
            <div className={`mt-0.5 text-sm font-semibold tracking-wide ${riskTone}`}>
              {riskLevel}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">DATA HEALTH</div>
            <div className={`mt-0.5 inline-flex items-center gap-1 text-sm font-semibold tracking-wide ${healthTone}`}>
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  dataHealthSafe ? "bg-emerald-400" : "bg-red-400"
                }`}
                aria-hidden
              />
              {healthLabel}
            </div>
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-border/70 bg-card/70 p-3 sm:grid-cols-2">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Denní PnL</div>
            <div
              className={`mt-1 text-4xl font-semibold tabular-nums leading-none ${
                Number(dailyPnl) >= 0 ? "text-emerald-300" : "text-[#A94B4B]"
              }`}
            >
              {formatSignedMoney(dailyPnl)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Realizováno {formatSignedMoney(dailyPnl)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Celkový kapitál</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums leading-none text-foreground">
              {formatMoneyRange(capitalRange) !== "—" ? formatMoneyRange(capitalRange) : formatMoney(totalCapital)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Otevřené PnL {formatSignedMoneyRange(openPositionsPnlRange)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="text-sm font-semibold leading-tight">{title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {subtitle ? <span>{subtitle}</span> : null}
          <span>•</span>
          <span>Poslední sken {formatClock(lastScanTs)}</span>
        </div>
      </div>
    </section>
  );
}
