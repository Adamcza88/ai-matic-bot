import { useEffect, useRef, useState } from "react";
import { formatMoney, formatMs, formatPercentRatio, formatSignedMoney } from "@/lib/uiFormat";

type KpiRowProps = {
  dataHealthSafe: boolean;
  latencyMs?: number;
  feedAgeRangeMs?: {
    min: number;
    max: number;
  };
  gatesPassCount: number;
  gatesTotal: number;
  blockedSignals: number;
  totalCapital?: number;
  capitalRange?: {
    min: number;
    max: number;
  };
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
  openPositionsPnlRange?: {
    min: number;
    max: number;
  };
  openPositions: number;
  maxOpenPositions: number;
  openOrders: number;
  maxOpenOrders: number;
  riskPerTradePct?: number;
  riskPerTradeUsd?: number;
  loading?: boolean;
};

type MetricLineProps = {
  label: string;
  value: string;
  valueClassName?: string;
};

function tileClass(priority: "primary" | "secondary") {
  return `rounded-xl border border-border/70 bg-card/96 p-4 lg:p-6 dm-surface-elevated lm-kpi-tile ${
    priority === "primary" ? "shadow-[0_10px_16px_-12px_rgba(0,0,0,0.7)]" : ""
  }`;
}

function MetricLine({ label, value, valueClassName }: MetricLineProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums text-foreground ${valueClassName ?? ""}`}>{value}</span>
    </div>
  );
}

function formatRange(min?: number, max?: number, formatter: (value?: number) => string = formatMoney) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return "—";
  if (Math.abs((min as number) - (max as number)) < 0.005) return formatter(min);
  return `${formatter(min)} – ${formatter(max)}`;
}

function formatFeedRange(range?: { min: number; max: number }) {
  if (!range) return "—";
  const toSec = (value: number) => `${(value / 1000).toFixed(1)} s`;
  return formatRange(range.min, range.max, toSec);
}

function feedToneClass(value?: number) {
  if (!Number.isFinite(value)) return "bg-border";
  if ((value as number) < 2_000) return "bg-[#00C853]";
  if ((value as number) <= 10_000) return "bg-[#FFB300]";
  return "bg-[#D32F2F]";
}

function pnlTone(value?: number) {
  if (!Number.isFinite(value)) return "text-muted-foreground";
  return (value as number) >= 0
    ? "text-[#00C853] dm-pnl-positive"
    : "text-[#D32F2F] lm-pnl-negative dm-pnl-negative";
}

export default function KpiRow({
  dataHealthSafe,
  latencyMs,
  feedAgeRangeMs,
  gatesPassCount,
  gatesTotal,
  blockedSignals,
  totalCapital,
  capitalRange,
  allocated,
  dailyPnl,
  dailyPnlBreakdown,
  openPositionsPnl,
  openPositionsPnlRange,
  openPositions,
  maxOpenPositions,
  openOrders,
  maxOpenOrders,
  riskPerTradePct,
  riskPerTradeUsd,
  loading,
}: KpiRowProps) {
  const previousCountRef = useRef<number | null>(null);
  const previousPnlRef = useRef<number | null>(null);
  const [countFxClass, setCountFxClass] = useState("");
  const [pnlFxClass, setPnlFxClass] = useState("");
  const usagePct = maxOpenPositions > 0 ? Math.round((openPositions / maxOpenPositions) * 100) : 0;
  const feedStripeClass = feedToneClass(feedAgeRangeMs?.max);
  const combinedCount = openPositions + openOrders;
  const countdownToDanger = Number.isFinite(feedAgeRangeMs?.max)
    ? Math.max(0, Math.ceil((10_000 - (feedAgeRangeMs?.max as number)) / 1_000))
    : 0;

  useEffect(() => {
    const previous = previousCountRef.current;
    previousCountRef.current = combinedCount;
    if (previous == null || previous === combinedCount) return;
    const positive = combinedCount > previous;
    setCountFxClass(`tva-bounce-400 ${positive ? "tva-glow-positive" : "tva-glow-negative"}`);
    const id = window.setTimeout(() => setCountFxClass(""), 400);
    return () => window.clearTimeout(id);
  }, [combinedCount]);

  useEffect(() => {
    const current = Number.isFinite(dailyPnl) ? (dailyPnl as number) : null;
    const previous = previousPnlRef.current;
    previousPnlRef.current = current;
    if (previous == null || current == null || previous === current) return;
    const crossZero = (previous < 0 && current >= 0) || (previous >= 0 && current < 0);
    const largeMove = Math.abs(current - previous) > 50;
    let nextClass = "tva-fade-in-200";
    if (crossZero) nextClass += " tva-cross-zero-300";
    if (largeMove) {
      nextClass += " tva-bounce-400";
      try {
        const audioCtx = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
        const oscillator = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        oscillator.type = "triangle";
        oscillator.frequency.value = current >= previous ? 820 : 620;
        gain.gain.value = 0.0001;
        oscillator.connect(gain);
        gain.connect(audioCtx.destination);
        oscillator.start();
        gain.gain.exponentialRampToValueAtTime(0.03, audioCtx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
        oscillator.stop(audioCtx.currentTime + 0.13);
      } catch {
        // Silent fallback when audio is blocked by browser policy.
      }
    }
    setPnlFxClass(nextClass);
    const id = window.setTimeout(() => setPnlFxClass(""), 420);
    return () => window.clearTimeout(id);
  }, [dailyPnl]);

  return (
    <section className={`space-y-3 ${loading ? "tva-loading-values" : ""}`}>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_2fr_2fr]">
        <div className={tileClass("secondary")}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Health & Latency</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Data Health</div>
              <div
                className={`mt-1 inline-flex items-center gap-1 font-semibold ${
                  dataHealthSafe ? "text-[#00C853]" : "text-[#D32F2F]"
                }`}
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    dataHealthSafe ? "bg-[#00C853]" : "bg-[#D32F2F]"
                  }`}
                  aria-hidden
                />
                {dataHealthSafe ? "SAFE" : "UNSAFE"}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Latency</div>
              <div className="mt-1 font-semibold tabular-nums text-foreground">{formatMs(latencyMs)}</div>
            </div>

            <div className="col-span-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Feed age</div>
                <div className="text-2xl font-semibold tabular-nums text-foreground tva-loading-text">{formatFeedRange(feedAgeRangeMs)}</div>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-background/50">
                <div className={`h-1.5 w-full rounded-full ${feedStripeClass}`} />
              </div>
              <div
                className={`mt-1 text-[11px] ${
                  Number.isFinite(feedAgeRangeMs?.max) && (feedAgeRangeMs?.max as number) > 10_000
                    ? "text-[#D32F2F] tva-stale-pulse-1s"
                    : Number.isFinite(feedAgeRangeMs?.max) && (feedAgeRangeMs?.max as number) > 2_000
                      ? "text-[#FFB300]"
                      : "text-[#00C853]"
                }`}
              >
                {Number.isFinite(feedAgeRangeMs?.max) && (feedAgeRangeMs?.max as number) > 10_000
                  ? "STALE"
                  : Number.isFinite(feedAgeRangeMs?.max) && (feedAgeRangeMs?.max as number) > 2_000
                    ? `Danger in ${countdownToDanger}s`
                    : "Fresh"}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Gates</div>
              <div className="mt-1 font-semibold tabular-nums text-foreground">
                {gatesPassCount}/{gatesTotal || 0}
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <div className="text-xs text-muted-foreground">Blocked</div>
              <div className={`mt-1 font-semibold tabular-nums ${blockedSignals > 0 ? "text-[#FFB300]" : "text-[#00C853]"}`}>
                {blockedSignals}
              </div>
            </div>
          </div>
        </div>

        <div className={tileClass("secondary")}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Positions & Risk</div>
          <div className="mt-3 space-y-2 text-sm">
            <MetricLine
              label="Pozice / příkazy"
              value={`${openPositions}/${maxOpenPositions} · ${openOrders}/${maxOpenOrders}`}
              valueClassName={countFxClass}
            />
            <MetricLine label="Alokováno" value={formatMoney(allocated)} />
            <MetricLine label="Využití limitu" value={`${usagePct} %`} />
            <MetricLine
              label="Riziko na obchod"
              value={`${formatPercentRatio(riskPerTradePct)} ≈ ${formatMoney(riskPerTradeUsd)}`}
            />
          </div>
        </div>

        <div className={tileClass("primary")}>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">PnL přehled</div>
          <div className="mt-3 text-right">
            <div className="text-xs text-muted-foreground">Denní PnL</div>
            <div className={`text-[42px] font-semibold tabular-nums leading-none tva-loading-text ${pnlTone(dailyPnl)} ${pnlFxClass}`}>
              {formatSignedMoney(dailyPnl)}
            </div>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Realizováno</span>
              <span className={`font-semibold tabular-nums ${pnlTone(dailyPnlBreakdown?.realized)}`}>
                {formatSignedMoney(dailyPnlBreakdown?.realized)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Otevřené PnL</span>
              <span className={`font-semibold tabular-nums ${pnlTone(openPositionsPnl)}`}>
                {formatRange(openPositionsPnlRange?.min, openPositionsPnlRange?.max, formatSignedMoney)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Celkový kapitál</span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatRange(capitalRange?.min, capitalRange?.max, formatMoney) !== "—"
                  ? formatRange(capitalRange?.min, capitalRange?.max, formatMoney)
                  : formatMoney(totalCapital)}
              </span>
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
