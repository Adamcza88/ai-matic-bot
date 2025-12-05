import React, { useState } from "react";
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
  const [local, setLocal] = useState(settings);

  const update = (field: keyof AISettings, value: any) => {
    const updated = { ...local, [field]: value };
    setLocal(updated);
    onUpdateSettings(updated);
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6">
        <div className="flex flex-col space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Settings
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure your AI trading parameters.
          </p>
        </div>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Profile
            </label>
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
                  className={`inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input hover:bg-accent hover:text-accent-foreground h-9 px-3 ${
                    local.strategyProfile === opt.key
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
              <label className="text-sm font-medium leading-none">
                Base Risk %
              </label>
              <input
                type="number"
                step="0.01"
                value={local.baseRiskPerTrade}
                onChange={(e) =>
                  update("baseRiskPerTrade", Number(e.target.value))
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none">
                Max Drawdown %
              </label>
              <input
                type="number"
                step="0.01"
                value={local.maxDrawdownPercent}
                onChange={(e) =>
                  update("maxDrawdownPercent", Number(e.target.value))
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Custom Strategy
            </label>
            <textarea
              value={local.customStrategy}
              onChange={(e) => update("customStrategy", e.target.value)}
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
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
