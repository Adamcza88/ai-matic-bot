import { useEffect, useRef, useState } from "react";
import { TradingMode } from "@/types";
import { formatClock, formatMoney, formatSignedMoney } from "@/lib/uiFormat";

type StatusBarProps = {
  title: string;
  subtitle?: string;
  engineStatus: "Running" | "Paused";
  lastScanTs: number | null;
  riskLevel: "LOW" | "ELEVATED" | "CRITICAL";
  riskPulseActive?: boolean;
  onRiskBadgeClick?: () => void;
  dataHealthSafe: boolean;
  loading?: boolean;
  executionMode: TradingMode;
  dailyPnl?: number;
  openPositionsPnl?: number;
  totalCapital?: number;
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

function pnlTone(value?: number) {
  if (!Number.isFinite(value)) return "text-[#D32F2F]";
  return (value as number) >= 0 ? "text-[#00C853]" : "text-[#D32F2F]";
}

export default function StatusBar({
  title,
  subtitle,
  engineStatus,
  lastScanTs,
  riskLevel,
  riskPulseActive,
  onRiskBadgeClick,
  dataHealthSafe,
  loading,
  executionMode,
  dailyPnl,
  openPositionsPnl,
  totalCapital,
  capitalRange,
}: StatusBarProps) {
  const previousHealthRef = useRef<boolean | null>(null);
  const [healthFxClass, setHealthFxClass] = useState("");

  useEffect(() => {
    const previous = previousHealthRef.current;
    previousHealthRef.current = dataHealthSafe;
    if (previous == null || previous === dataHealthSafe) return;
    setHealthFxClass(dataHealthSafe ? "tva-health-safe-flash-300" : "tva-health-unsafe-shake-200");
    const id = window.setTimeout(() => setHealthFxClass(""), dataHealthSafe ? 300 : 200);
    return () => window.clearTimeout(id);
  }, [dataHealthSafe]);

  const riskTone =
    riskLevel === "CRITICAL"
      ? "text-[#D32F2F]"
      : riskLevel === "ELEVATED"
        ? "text-[#FFB300]"
        : "text-[#00C853]";
  const healthLabel = dataHealthSafe ? "SAFE" : "UNSAFE";
  const healthTone = dataHealthSafe ? "text-[#00C853]" : "text-[#D32F2F]";
  const shellTone =
    riskLevel === "CRITICAL"
      ? "border-[#D32F2F]/80 bg-[#D32F2F]/10"
      : riskLevel === "ELEVATED"
        ? "border-[#FFB300]/80 bg-[#FFB300]/10"
        : "border-[#00C853]/70 bg-[#00C853]/10";

  return (
    <section
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-20 rounded-xl border-2 p-4 shadow-[0_8px_18px_-10px_rgba(0,0,0,0.65)] backdrop-blur ${shellTone} ${
        loading ? "tva-loading-values" : ""
      }`}
    >
      <div className="grid gap-3 xl:grid-cols-[0.95fr,1.05fr]">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="text-xs text-muted-foreground">ENGINE</div>
            <div
              className={`mt-0.5 text-[19px] font-semibold tracking-wide tva-loading-text ${
                engineStatus === "Running" ? "text-[#00C853]" : "text-[#FFB300]"
              }`}
            >
              {engineStatus.toUpperCase()}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="text-xs text-muted-foreground">RISK</div>
            <button
              type="button"
              className={`mt-0.5 text-[19px] font-semibold tracking-wide ${riskTone} ${
                riskPulseActive ? "tva-risk-pulse" : ""
              }`}
              onClick={onRiskBadgeClick}
            >
              <span className="tva-loading-text">{riskLevel}</span>
            </button>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="text-xs text-muted-foreground">DATA HEALTH</div>
            <div
              className={`mt-0.5 inline-flex items-center gap-1 text-[19px] font-semibold tracking-wide tva-loading-text ${healthTone} ${healthFxClass}`}
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  dataHealthSafe ? "bg-[#00C853]" : "bg-[#D32F2F]"
                }`}
                aria-hidden
              />
              {healthLabel}
            </div>
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-border/70 bg-card/70 p-3 sm:grid-cols-3">
          <div className="text-right sm:text-left">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Aktuální PnL otevřených pozic</div>
            <div className={`mt-1 text-[30px] font-semibold tabular-nums leading-none ${pnlTone(openPositionsPnl)}`}>
              {formatSignedMoney(openPositionsPnl)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Neuzavřené pozice</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Denní PnL</div>
            <div
              className={`mt-1 text-[42px] font-semibold tabular-nums leading-none ${
                Number(dailyPnl) >= 0 ? "text-[#00C853]" : "text-[#D32F2F]"
              }`}
            >
              {formatSignedMoney(dailyPnl)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Realizováno {formatSignedMoney(dailyPnl)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Celkový kapitál</div>
            <div className="mt-1 text-[30px] font-semibold tabular-nums leading-none text-foreground">
              {formatMoneyRange(capitalRange) !== "—" ? formatMoneyRange(capitalRange) : formatMoney(totalCapital)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Aktuální zůstatek účtu</div>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="text-sm font-semibold leading-tight">{title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span key={executionMode} className="tva-text-swap">
            Execution: {executionMode === TradingMode.AUTO_ON ? "Auto" : "Manual"}
          </span>
          <span>•</span>
          {subtitle ? <span>{subtitle}</span> : null}
          <span>•</span>
          <span>Poslední sken {formatClock(lastScanTs)}</span>
        </div>
      </div>
    </section>
  );
}
