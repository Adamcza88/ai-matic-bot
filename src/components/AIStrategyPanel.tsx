import React, { useState } from "react";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
}

const AIStrategyPanel: React.FC<Props> = ({
  theme,
  lang,
  settings,
  onUpdateSettings,
}) => {
  const isDark = theme === "dark";

  const card = isDark
    ? "bg-gray-900/50 border-gray-700/50"
    : "bg-white border-gray-200";

  const [local, setLocal] = useState(settings);

  const update = (field: keyof AISettings, value: any) => {
    const updated = { ...local, [field]: value };
    setLocal(updated);
    onUpdateSettings(updated);
  };

  return (
    <div className={`rounded-xl p-4 border ${card}`}>
      <h2
        className={`text-lg font-semibold mb-4 ${
          isDark ? "text-white" : "text-gray-900"
        }`}
      >
        AI Strategy Settings
      </h2>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <label className="flex flex-col col-span-2">
          <span className="text-gray-500">Strategie</span>
          <div className="flex gap-2 flex-wrap mt-2">
            {[
              { key: "auto", label: "Auto" },
              { key: "scalp", label: "Scalp" },
              { key: "intraday", label: "Intraday" },
              { key: "swing", label: "Swing" },
              { key: "trend", label: "Trend" },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => update("strategyProfile", opt.key as any)}
                className={`px-3 py-1 rounded border ${
                  local.strategyProfile === opt.key
                    ? "bg-cyan-500 text-white border-cyan-400"
                    : isDark
                    ? "bg-gray-800 border-gray-700 text-gray-200"
                    : "bg-white border-gray-300 text-gray-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </label>
        <label className="flex flex-col">
          <span className="text-gray-500">Base Risk %</span>
          <input
            type="number"
            value={local.baseRiskPerTrade}
            onChange={(e) =>
              update("baseRiskPerTrade", Number(e.target.value))
            }
            className={`px-2 py-1 rounded border ${
              isDark
                ? "bg-gray-800 border-gray-700 text-gray-200"
                : "bg-white border-gray-300 text-gray-800"
            }`}
            step="0.01"
          />
        </label>

        <label className="flex flex-col">
          <span className="text-gray-500">Max Drawdown %</span>
          <input
            type="number"
            value={local.maxDrawdownPercent}
            onChange={(e) =>
              update("maxDrawdownPercent", Number(e.target.value))
            }
            className={`px-2 py-1 rounded border ${
              isDark
                ? "bg-gray-800 border-gray-700 text-gray-200"
                : "bg-white border-gray-300 text-gray-800"
            }`}
            step="0.01"
          />
        </label>

        <label className="flex flex-col col-span-2">
          <span className="text-gray-500">Custom Strategy Text</span>
          <textarea
            value={local.customStrategy}
            onChange={(e) => update("customStrategy", e.target.value)}
            className={`px-2 py-1 rounded border h-20 ${
              isDark
                ? "bg-gray-800 border-gray-700 text-gray-200"
                : "bg-white border-gray-300 text-gray-800"
            }`}
          />
        </label>
      </div>
    </div>
  );
};

export default AIStrategyPanel;
