import React, { useState } from "react";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
}

const AIStrategyPanel: React.FC<Props> = ({
  settings,
  onUpdateSettings,
}) => {
  const [local, setLocal] = useState(settings);

  const update = (field: keyof AISettings, value: any) => {
    const updated = { ...local, [field]: value };
    setLocal(updated);
    onUpdateSettings(updated);
  };

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-xs">
      <div className="flex flex-col space-y-1.5 p-6">
        <h3 className="font-semibold leading-none tracking-tight">AI Strategy Settings</h3>
      </div>

      <div className="p-6 pt-0 grid gap-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">Strategy</label>
          <div className="flex gap-2 flex-wrap">
            {[
              { key: "off", label: "Off" },
              { key: "auto", label: "Auto" },
              { key: "scalp", label: "Scalp" },
              { key: "intraday", label: "Intraday" },
              { key: "swing", label: "Swing" },
              { key: "trend", label: "Trend" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => update("strategyProfile", opt.key as any)}
                className={`inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring border border-input hover:bg-accent hover:text-accent-foreground h-8 px-3 ${local.strategyProfile === opt.key
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary"
                    : "bg-background"
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">Base Risk %</label>
            <input
              type="number"
              value={local.baseRiskPerTrade}
              onChange={(e) => update("baseRiskPerTrade", Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              step="0.01"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">Max Drawdown %</label>
            <input
              type="number"
              value={local.maxDrawdownPercent}
              onChange={(e) => update("maxDrawdownPercent", Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              step="0.01"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">Custom Strategy Text</label>
          <textarea
            value={local.customStrategy}
            onChange={(e) => update("customStrategy", e.target.value)}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
};

export default AIStrategyPanel;
