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

  return (
    <div className="sticky top-0 z-20">
      <div className="rounded-xl border border-border/60 bg-card/80 p-3 backdrop-blur-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Strategy
            </div>
            <div className="text-lg font-semibold leading-tight">{title}</div>
            {subtitle && (
              <div className="text-xs text-muted-foreground max-w-[70ch]">
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Environment</span>
              <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
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
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
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
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "text-muted-foreground hover:text-foreground"
                  }
                >
                  MAINNET
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Execution</span>
              <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
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
                        ? "bg-sky-600 text-white hover:bg-sky-700"
                        : "text-muted-foreground hover:text-foreground"
                    }
                  >
                    {MODE_LABELS[m]}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={
                  isConnected
                    ? "border-emerald-500/50 text-emerald-400"
                    : isError
                      ? "border-red-500/50 text-red-400"
                      : "border-amber-500/50 text-amber-400"
                }
              >
                Bybit {bybitStatus}
              </Badge>
              {latencyLabel && (
                <Badge variant="outline" className="border-border/60 text-foreground">
                  {latencyLabel}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={
                  engineStatus === "Running"
                    ? "border-emerald-500/50 text-emerald-400"
                    : "border-amber-500/50 text-amber-400"
                }
              >
                Engine {engineStatus}
              </Badge>
              {systemState.lastError && (
                <Badge
                  variant="destructive"
                  className="max-w-[220px] truncate"
                  title={systemState.lastError}
                >
                  Error: {systemState.lastError}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
