import React from "react";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
  onClose: () => void;
}

const SettingsPanel: React.FC<Props> = ({
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const local = settings;
  const tzLabel = (() => {
    const off = new Date().getTimezoneOffset(); // CET: -60, CEST: -120
    if (off === -60) return "SEČ";
    if (off === -120) return "SELČ";
    return "lokální čas";
  })();

  const tradingWindowLabel = `${String(local.tradingStartHour).padStart(2, "0")}:00–${String(
    local.tradingEndHour
  ).padStart(2, "0")}:00 (${tzLabel})`;

  const profileCopy: Record<AISettings["riskMode"], { title: string; description: string; notes: string[] }> = {
    "ai-matic": {
      title: "AI-Matic",
      description: "Konzervativnější intraday / scalp mix s kontrolou sezení a širšími filtry volatility.",
      notes: [
        "Trading hours: On (0–23 SEČ/SELČ)",
        "Base risk 2 %, risk budget 20 % / 2 pozice",
        "Halt na denní ztrátu a drawdown, trailing profit lock",
      ],
    },
    "ai-matic-x": {
      title: "AI-Matic-X",
      description: "Agresivnější profil s přísnějšími vstupy, bez session hours a se silnějším sizingem.",
      notes: [
        "Trading hours: Off",
        "Base risk 2 %, risk budget 20 % / 2 pozice",
        "Halt na denní ztrátu/drawdown, dyn. sizing multiplier 1.2×",
      ],
    },
  };
  const meta = profileCopy[settings.riskMode];

  const AI_MATIC_PRESET_UI: AISettings = {
    riskMode: "ai-matic",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.07,
    maxDailyProfitPercent: 0.5,
    maxDrawdownPercent: 0.2,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
    entryStrictness: "base",
    enforceSessionHours: true,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.0,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.0,
    minWinRate: 65,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
  };

  const AI_MATIC_X_PRESET_UI: AISettings = {
    riskMode: "ai-matic-x",
    strictRiskAdherence: true,
    pauseOnHighVolatility: false,
    avoidLowLiquidity: false,
    useTrendFollowing: true,
    smcScalpMode: true,
    useLiquiditySweeps: false,
    useVolatilityExpansion: true,
    maxDailyLossPercent: 0.1,
    maxDailyProfitPercent: 1.0,
    maxDrawdownPercent: 0.2,
    baseRiskPerTrade: 0.02,
    maxPortfolioRiskPercent: 0.2,
    maxAllocatedCapitalPercent: 1.0,
    maxOpenPositions: 2,
    entryStrictness: "ultra",
    enforceSessionHours: false,
    haltOnDailyLoss: true,
    haltOnDrawdown: true,
    useDynamicPositionSizing: true,
    lockProfitsWithTrail: true,
    requireConfirmationInAuto: false,
    positionSizingMultiplier: 1.2,
    customInstructions: "",
    customStrategy: "",
    min24hVolume: 50,
    minProfitFactor: 1.1,
    minWinRate: 65,
    tradingStartHour: 0,
    tradingEndHour: 23,
    tradingDays: [0, 1, 2, 3, 4, 5, 6],
  };

  const presets: Record<AISettings["riskMode"], AISettings> = {
    "ai-matic": AI_MATIC_PRESET_UI,
    "ai-matic-x": AI_MATIC_X_PRESET_UI,
  };

  const applyPreset = (mode: AISettings["riskMode"]) => {
    const preset = presets[mode];
    onUpdateSettings(preset);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6">
        <div className="flex flex-col space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Settings
          </h2>
          <p className="text-sm text-muted-foreground">
            Zvolený profil nastaví výchozí parametry; vybrané podmínky můžeš přepnout.
          </p>
        </div>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Profile
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => applyPreset("ai-matic")}
                className={`flex-1 rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                AI-Matic
              </button>
              <button
                onClick={() => applyPreset("ai-matic-x")}
                className={`flex-1 rounded-md border border-input px-3 py-2 text-sm ${
                  local.riskMode === "ai-matic-x"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-200"
                }`}
              >
                AI-Matic-X
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Enforce Trading Hours
            </label>
            <div className="flex items-center justify-between rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
              <div>
                <div className="font-medium">{local.enforceSessionHours ? "On" : "Off"}</div>
                <div className="text-xs text-slate-400 mt-1">
                  {local.enforceSessionHours ? tradingWindowLabel : `Vypnuto (${tzLabel})`}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  onUpdateSettings({
                    ...settings,
                    enforceSessionHours: !settings.enforceSessionHours,
                  })
                }
                className={`rounded-md border px-3 py-1 text-sm ${
                  local.enforceSessionHours
                    ? "border-emerald-500/40 bg-emerald-900/30 text-emerald-200"
                    : "border-slate-700 bg-slate-900/40 text-slate-200"
                }`}
              >
                {local.enforceSessionHours ? "On" : "Off"}
              </button>
            </div>
          </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Base Risk %
            </label>
              <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
                {(local.baseRiskPerTrade * 100).toFixed(2)}%
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none">
                Max Drawdown %
              </label>
              <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
                {(local.maxDrawdownPercent * 100).toFixed(2)}%
              </div>
            </div>
          </div>

          <div className="mt-2 p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-sm space-y-2">
            <div className="font-semibold text-white">{meta.title}</div>
            <div className="text-slate-300">{meta.description}</div>
            <ul className="list-disc list-inside space-y-1 text-slate-400">
            {meta.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="text-xs text-slate-500">
            Parametry: Hours {local.enforceSessionHours ? tradingWindowLabel : `Off (${tzLabel})`} • Base risk{" "}
            {(local.baseRiskPerTrade * 100).toFixed(2)}% • Risk budget{" "}
            {(local.maxPortfolioRiskPercent * 100).toFixed(1)}% / {local.maxOpenPositions} pos • Max alloc{" "}
            {(local.maxAllocatedCapitalPercent * 100).toFixed(1)}% • Max DD{" "}
            {(local.maxDrawdownPercent * 100).toFixed(2)}%
          </div>
        </div>
      </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
