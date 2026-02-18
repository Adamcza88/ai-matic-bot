import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingMode, type SystemState } from "@/types";
import { UI_COPY } from "@/lib/uiCopy";
import { formatClock } from "@/lib/uiFormat";

type StatusBarProps = {
  title: string;
  subtitle?: string;
  mode: TradingMode;
  setMode: (m: TradingMode) => void;
  useTestnet: boolean;
  setUseTestnet: (v: boolean) => void;
  systemState: SystemState;
  engineStatus: "Running" | "Paused";
  lastScanTs: number | null;
  blockedSignals: number;
  gatesPassCount: number;
  gatesTotal: number;
  feedAgeMs?: number;
  feedOk: boolean;
  riskLevel: "LOW" | "ELEVATED" | "CRITICAL";
  dataHealthSafe: boolean;
  overrideEnabled: boolean;
  envAvailability?: {
    canUseDemo: boolean;
    canUseMainnet: boolean;
    demoReason?: string;
    mainnetReason?: string;
  };
  onOpenSettings: () => void;
};

const MODE_OPTIONS: TradingMode[] = [TradingMode.OFF, TradingMode.AUTO_ON];
const LATENCY_OK_MS = 2_000;
const LATENCY_WARN_MS = 10_000;

function modeLabel(value: TradingMode) {
  return value === TradingMode.AUTO_ON
    ? UI_COPY.statusBar.auto
    : UI_COPY.statusBar.manual;
}

function metricTone(value?: number) {
  if (!Number.isFinite(value)) return "na" as const;
  if ((value as number) < LATENCY_OK_MS) return "ok" as const;
  if ((value as number) <= LATENCY_WARN_MS) return "warn" as const;
  return "bad" as const;
}

function metricToneClass(tone: "ok" | "warn" | "bad" | "na") {
  if (tone === "ok") return "text-emerald-300";
  if (tone === "warn") return "text-amber-300";
  if (tone === "bad") return "text-red-300";
  return "text-muted-foreground";
}

function formatLatency(value?: number) {
  if (!Number.isFinite(value)) return "N/A";
  return `${Math.round(value as number)} ms`;
}

function formatFeedAge(value?: number) {
  if (!Number.isFinite(value)) return "N/A";
  const ms = Math.max(0, value as number);
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

export default function StatusBar({
  title,
  subtitle,
  mode,
  setMode,
  useTestnet,
  setUseTestnet,
  systemState,
  engineStatus,
  lastScanTs,
  blockedSignals,
  gatesPassCount,
  gatesTotal,
  feedAgeMs,
  feedOk,
  riskLevel,
  dataHealthSafe,
  overrideEnabled,
  envAvailability,
  onOpenSettings,
}: StatusBarProps) {
  const bybitStatus = systemState.bybitStatus ?? "Disconnected";
  const latencyTone = metricTone(systemState.latency);
  const feedTone = metricTone(feedAgeMs);
  const riskTone =
    riskLevel === "CRITICAL"
      ? "text-red-300"
      : riskLevel === "ELEVATED"
        ? "text-amber-300"
        : "text-emerald-300";
  const healthLabel = dataHealthSafe ? "SAFE" : "UNSAFE";
  const healthTone = dataHealthSafe ? "text-emerald-300" : "text-red-300";

  return (
    <section className="sticky top-0 z-20 rounded-xl border border-border/70 bg-card/85 p-3 shadow-[0_6px_8px_-6px_rgba(0,0,0,0.45)] backdrop-blur lm-panel dm-surface lm-topbar">
      <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm lg:grid-cols-8">
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              engineStatus === "Running" ? "bg-emerald-400" : "bg-amber-400"
            }`}
          />
          <span className="text-muted-foreground">ENGINE</span>
          <span className={engineStatus === "Running" ? "text-emerald-300" : "text-amber-300"}>
            {engineStatus.toUpperCase()}
          </span>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span className="text-muted-foreground">RISK</span>
          <div className={`font-semibold tabular-nums ${riskTone}`}>{riskLevel}</div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span className="text-muted-foreground">DATA HEALTH</span>
          <div className={`font-semibold tabular-nums ${healthTone}`}>{healthLabel}</div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span className="text-muted-foreground">BYBIT</span>
          <div
            className={`font-semibold tabular-nums ${
              bybitStatus === "Connected"
                ? metricToneClass(latencyTone)
                : "text-muted-foreground"
            }`}
          >
            {bybitStatus === "Connected"
              ? formatLatency(systemState.latency)
              : UI_COPY.statusBar.bybitDisconnected}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span className="text-muted-foreground">Gates</span>
          <div className="font-semibold tabular-nums text-foreground">
            {gatesPassCount}/{gatesTotal || 0}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span className="text-muted-foreground">Blocked</span>
          <div
            className={`font-semibold tabular-nums ${
              blockedSignals > 0 ? "text-amber-300" : "text-emerald-300"
            }`}
          >
            {blockedSignals}
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-card/70 px-2 py-1.5">
          <span className="text-muted-foreground">Feed age</span>
          <div
            className={`font-semibold tabular-nums ${
              feedOk ? metricToneClass(feedTone) : "text-red-300"
            }`}
          >
            {formatFeedAge(feedAgeMs)}
          </div>
        </div>

        <div className="flex items-center justify-start lg:justify-end">
          <Badge
            variant="outline"
            title={
              overrideEnabled
                ? "Execution override je aktivní a může obejít gate podmínky."
                : "Override je vypnutý, platí standardní gate pravidla."
            }
            className={
              overrideEnabled
                ? "inline-flex border-amber-500/40 bg-amber-500/15 px-2 py-1 text-amber-300 dm-status-warn"
                : "inline-flex border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-emerald-300 dm-status-pass"
            }
          >
            Execution Override: {overrideEnabled ? "Overrides gates" : "No overrides"}
          </Badge>
        </div>
      </div>

      <div className="mt-3 grid gap-3 border-t border-border/60 pt-3 xl:grid-cols-12 xl:items-center">
        <div className="xl:col-span-5">
          <div className="text-lg font-semibold leading-tight lm-heading lm-topbar-title">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground lm-topbar-meta">
            {subtitle ? <span>{subtitle}</span> : null}
            <span>•</span>
            <span>{UI_COPY.dashboard.lastScan} {formatClock(lastScanTs)}</span>
          </div>
        </div>

        <div className="xl:col-span-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-md border border-border/60 bg-card/95 p-0.5 dm-surface-elevated dm-border-soft lm-topbar-segment">
              <Button
                variant={useTestnet ? "secondary" : "ghost"}
                size="sm"
                data-testid="env-demo-button"
                onClick={() => setUseTestnet(true)}
                disabled={envAvailability ? !envAvailability.canUseDemo : false}
                title={
                  envAvailability && !envAvailability.canUseDemo
                    ? envAvailability.demoReason ?? "Demo prostředí není dostupné"
                    : "Použít demo prostředí"
                }
                className={useTestnet ? "h-8 min-w-20" : "h-8 min-w-20 text-muted-foreground"}
              >
                {UI_COPY.statusBar.demo}
              </Button>
              <Button
                variant={!useTestnet ? "secondary" : "ghost"}
                size="sm"
                data-testid="env-mainnet-button"
                onClick={() => setUseTestnet(false)}
                disabled={envAvailability ? !envAvailability.canUseMainnet : false}
                title={
                  envAvailability && !envAvailability.canUseMainnet
                    ? envAvailability.mainnetReason ?? "Mainnet prostředí není dostupné"
                    : "Použít mainnet prostředí"
                }
                className={!useTestnet ? "h-8 min-w-20" : "h-8 min-w-20 text-muted-foreground"}
              >
                {UI_COPY.statusBar.mainnet}
              </Button>
            </div>

            <div className="flex items-center rounded-md border border-border/60 bg-card/95 p-0.5 dm-surface-elevated dm-border-soft lm-topbar-segment">
              {MODE_OPTIONS.map((value) => (
                <Button
                  key={value}
                  variant={mode === value ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setMode(value)}
                  className={mode === value ? "h-8 min-w-20" : "h-8 min-w-20 text-muted-foreground"}
                >
                  {modeLabel(value)}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="xl:col-span-3">
          <div className="flex items-center justify-start gap-2 xl:justify-end lm-topbar-chip-row">
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenSettings}
              className="h-8 px-3 text-xs dm-button-control lm-topbar-settings"
            >
              {UI_COPY.common.settings}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
