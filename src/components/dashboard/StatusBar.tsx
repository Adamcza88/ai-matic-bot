import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingMode, type SystemState } from "@/types";
import { UI_COPY } from "@/lib/uiCopy";
import { formatClock, formatMs } from "@/lib/uiFormat";

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
  envAvailability?: {
    canUseDemo: boolean;
    canUseMainnet: boolean;
    demoReason?: string;
    mainnetReason?: string;
  };
  onOpenSettings: () => void;
};

const MODE_OPTIONS: TradingMode[] = [TradingMode.OFF, TradingMode.AUTO_ON];

function modeLabel(value: TradingMode) {
  return value === TradingMode.AUTO_ON
    ? UI_COPY.statusBar.auto
    : UI_COPY.statusBar.manual;
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
  envAvailability,
  onOpenSettings,
}: StatusBarProps) {
  const bybitStatus = systemState.bybitStatus ?? "Disconnected";
  const latencyLabel = formatMs(systemState.latency);
  const bybitChipLabel = bybitStatus === "Connected"
    ? `BYBIT • ${latencyLabel}`
    : UI_COPY.statusBar.bybitDisconnected;

  return (
    <section className="rounded-xl border border-border/70 bg-card/96 p-3 shadow-[0_6px_8px_-6px_rgba(0,0,0,0.45)] lm-panel dm-surface lm-topbar">
      <div className="grid gap-3 xl:grid-cols-12 xl:items-center">
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
            <Badge
              variant="outline"
              className={
                bybitStatus === "Connected"
                  ? "h-8 min-w-32 justify-center border-emerald-500/50 text-emerald-400 dm-status-pass lm-status-badge lm-status-badge-ok"
                  : "h-8 min-w-32 justify-center border-border/60 text-muted-foreground dm-status-muted lm-status-badge"
              }
            >
              {bybitChipLabel}
            </Badge>
            <Badge
              variant="outline"
              className={
                engineStatus === "Running"
                  ? "h-8 min-w-32 justify-center border-emerald-500/50 text-emerald-400 dm-status-pass lm-status-badge lm-status-badge-ok"
                  : "h-8 min-w-32 justify-center border-amber-500/50 text-amber-400 dm-status-warn lm-status-badge lm-status-badge-warn"
              }
            >
              {engineStatus === "Running"
                ? UI_COPY.statusBar.engineRunning
                : UI_COPY.statusBar.enginePaused}
            </Badge>
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
