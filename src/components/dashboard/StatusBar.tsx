import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TradingMode, type SystemState } from "@/types";

type StatusBarProps = {
  title: string;
  subtitle?: string;
  mode: TradingMode;
  setMode: (m: TradingMode) => void;
  useTestnet: boolean;
  setUseTestnet: (v: boolean) => void;
  systemState: SystemState;
  engineStatus: "Running" | "Paused";
  envAvailability?: {
    canUseDemo: boolean;
    canUseMainnet: boolean;
    demoReason?: string;
    mainnetReason?: string;
  };
};

const MODE_LABELS: Record<TradingMode, string> = {
  [TradingMode.OFF]: "Manual",
  [TradingMode.AUTO_ON]: "Auto",
  [TradingMode.SIGNAL_ONLY]: "Signal",
  [TradingMode.BACKTEST]: "Backtest",
  [TradingMode.PAPER]: "Paper",
};

const MODE_OPTIONS: TradingMode[] = [TradingMode.OFF, TradingMode.AUTO_ON];

export default function StatusBar({
  title,
  subtitle,
  mode,
  setMode,
  useTestnet,
  setUseTestnet,
  systemState,
  engineStatus,
  envAvailability,
}: StatusBarProps) {
  const bybitStatus = systemState.bybitStatus ?? "Disconnected";
  const latencyLabel = Number.isFinite(systemState.latency)
    ? `${systemState.latency} ms`
    : null;
  const isConnected = bybitStatus === "Connected";
  const isError =
    bybitStatus === "Error" || bybitStatus === "Disconnected";
  const bybitChipLabel =
    isConnected && latencyLabel
      ? `Bybit • ${latencyLabel}`
      : `Bybit • ${bybitStatus}`;

  return (
    <div className="sticky top-0 z-20">
      <div className="rounded-xl border border-border/70 bg-card/96 p-3 shadow-[0_6px_8px_-6px_rgba(0,0,0,0.45)] lm-panel">
        <div className="space-y-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              System status
            </div>
            <div className="text-lg font-semibold leading-tight">{title}</div>
            {subtitle && (
              <div className="max-w-[70ch] text-xs text-muted-foreground">{subtitle}</div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Prostředí</span>
                <div className="flex items-center rounded-md border border-border/60 bg-card/95 p-0.5">
                  <Button
                    variant={useTestnet ? "secondary" : "ghost"}
                    size="sm"
                    data-testid="env-demo-button"
                    onClick={() => setUseTestnet(true)}
                    disabled={envAvailability ? !envAvailability.canUseDemo : false}
                    title={
                      envAvailability && !envAvailability.canUseDemo
                        ? envAvailability.demoReason ?? "Demo environment unavailable"
                        : "Use demo environment"
                    }
                    className={
                      useTestnet
                        ? "min-w-20 bg-muted text-foreground"
                        : "min-w-20 text-muted-foreground hover:text-foreground"
                    }
                  >
                    DEMO
                  </Button>
                  <Button
                    variant={!useTestnet ? "secondary" : "ghost"}
                    size="sm"
                    data-testid="env-mainnet-button"
                    onClick={() => setUseTestnet(false)}
                    disabled={envAvailability ? !envAvailability.canUseMainnet : false}
                    title={
                      envAvailability && !envAvailability.canUseMainnet
                        ? envAvailability.mainnetReason ?? "Mainnet environment unavailable"
                        : "Use mainnet environment"
                    }
                    className={
                      !useTestnet
                        ? "min-w-20 bg-emerald-600 text-white hover:bg-emerald-700"
                        : "min-w-20 text-muted-foreground hover:text-foreground"
                    }
                  >
                    MAINNET
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Režim</span>
                <div className="flex items-center rounded-md border border-border/60 bg-card/95 p-0.5">
                  {MODE_OPTIONS.map((m) => (
                    <Button
                      key={m}
                      variant={mode === m ? "secondary" : "ghost"}
                      size="sm"
                      data-testid={
                        m === TradingMode.OFF ? "mode-manual-button" : "mode-auto-button"
                      }
                      onClick={() => setMode(m)}
                      className={
                        mode === m
                          ? "min-w-20 bg-sky-600 text-white hover:bg-sky-700"
                          : "min-w-20 text-muted-foreground hover:text-foreground"
                      }
                    >
                      {MODE_LABELS[m]}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  isConnected
                    ? "min-w-32 justify-center rounded-sm border lm-status-badge lm-status-badge-ok"
                    : isError
                      ? "min-w-32 justify-center rounded-sm border lm-status-badge lm-status-badge-error"
                      : "min-w-32 justify-center rounded-sm border lm-status-badge lm-status-badge-warn"
                }
              >
                {bybitChipLabel.toUpperCase()}
              </Badge>
              <Badge
                variant="outline"
                className={
                  engineStatus === "Running"
                    ? "min-w-24 justify-center rounded-sm border lm-status-badge lm-status-badge-ok"
                    : "min-w-24 justify-center rounded-sm border lm-status-badge lm-status-badge-warn"
                }
              >
                ENGINE - {engineStatus.toUpperCase()}
              </Badge>
              {systemState.lastError && (
                <Badge
                  variant="destructive"
                  className="max-w-[220px] truncate rounded-sm border shadow-none lm-status-badge lm-status-badge-error"
                  title={systemState.lastError}
                >
                  ERROR: {systemState.lastError}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
