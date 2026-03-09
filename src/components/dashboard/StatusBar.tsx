import { useEffect, useRef, useState } from "react";
import { TradingMode } from "@/types";
import { formatClock } from "@/lib/uiFormat";

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
  strategyHeader?: {
    htf: string;
    entry: string;
    feed: string;
  };
};

function signedTone(value?: number) {
  if (!Number.isFinite(value)) return "text-muted-foreground";
  return (value as number) >= 0 ? "text-[#00C853]" : "text-[#D32F2F]";
}

function formatUsdt(value?: number, signed = false) {
  if (!Number.isFinite(value)) return "—";
  const amount = value as number;
  const sign = signed && amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USDT`;
}

function badgeDotClass(tone: "ok" | "warn" | "danger" | "info") {
  if (tone === "ok") return "bg-[#00C853]";
  if (tone === "warn") return "bg-[#FFB300]";
  if (tone === "danger") return "bg-[#D32F2F]";
  return "bg-[#4FC3F7]";
}

function statusLabel({
  label,
  value,
  tone,
  pulse,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "danger" | "info";
  pulse?: boolean;
}) {
  const textTone =
    tone === "ok"
      ? "text-[#00C853]"
      : tone === "warn"
        ? "text-[#FFB300]"
        : tone === "danger"
          ? "text-[#D32F2F]"
          : "text-[#4FC3F7]";
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 flex items-center gap-2 text-[22px] font-bold uppercase tracking-[0.03em] ${textTone} ${
          pulse ? "tva-risk-pulse" : ""
        }`}
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${badgeDotClass(tone)}`}
          aria-hidden
        />
        {value}
      </div>
    </div>
  );
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
  strategyHeader,
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
  const healthLabel = dataHealthSafe ? "BEZPEČNÁ" : "RIZIKOVÁ";
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
      className={`rounded-xl border-2 p-4 shadow-[0_8px_18px_-10px_rgba(0,0,0,0.65)] ${shellTone} ${
        loading ? "tva-loading-values" : ""
      }`}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {statusLabel({
            label: "ENGINE",
            value: engineStatus === "Running" ? "BĚŽÍ" : "PAUZA",
            tone: engineStatus === "Running" ? "ok" : "warn",
          })}
          <button
            type="button"
            onClick={onRiskBadgeClick}
            className="text-left"
          >
            {statusLabel({
              label: "RISK",
              value: riskLevel,
              tone:
                riskLevel === "CRITICAL"
                  ? "danger"
                  : riskLevel === "ELEVATED"
                    ? "warn"
                    : "ok",
              pulse: riskPulseActive,
            })}
          </button>
          <div className={healthFxClass}>
            {statusLabel({
              label: "STAV DAT",
              value: healthLabel,
              tone: dataHealthSafe ? "ok" : "danger",
            })}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-border/70 bg-card/70 p-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-right">
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Otevřený PnL
            </div>
            <div
              className={`mt-1 font-mono-ui text-[30px] font-semibold tabular-nums leading-none ${signedTone(openPositionsPnl)}`}
            >
              {formatUsdt(openPositionsPnl, true)}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-right">
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Denní PnL
            </div>
            <div
              className={`mt-1 font-mono-ui text-[30px] font-semibold tabular-nums leading-none ${
                Number(dailyPnl) >= 0 ? "text-[#00C853]" : "text-[#D32F2F]"
              }`}
            >
              {formatUsdt(dailyPnl, true)}
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-right">
            <div className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              Kapitál účtu
            </div>
            <div className="mt-1 font-mono-ui text-[30px] font-semibold tabular-nums leading-none text-foreground">
              {formatUsdt(totalCapital, false)}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/72 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[22px] font-semibold leading-none">{title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Režim obchodování:{" "}
                <span className={riskTone}>
                  {executionMode === TradingMode.AUTO_ON ? "AUTO" : "MANUÁL"}
                </span>
              </div>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">
              Poslední scan: {formatClock(lastScanTs)}
            </div>
          </div>
          {subtitle ? (
            <div className="mt-2 text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded-md border border-border/60 bg-background/25 px-2 py-1.5 text-xs">
              <div className="uppercase tracking-[0.08em] text-muted-foreground">HTF</div>
              <div className="mt-0.5 font-medium text-foreground">
                {strategyHeader?.htf ?? "N/A"}
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-background/25 px-2 py-1.5 text-xs">
              <div className="uppercase tracking-[0.08em] text-muted-foreground">Vstup</div>
              <div className="mt-0.5 font-medium text-foreground">
                {strategyHeader?.entry ?? "N/A"}
              </div>
            </div>
            <div className="rounded-md border border-border/60 bg-background/25 px-2 py-1.5 text-xs">
              <div className="uppercase tracking-[0.08em] text-muted-foreground">Datový feed</div>
              <div className="mt-0.5 font-medium text-foreground">
                {strategyHeader?.feed ?? "N/A"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
