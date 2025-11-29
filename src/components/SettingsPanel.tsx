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
  theme,
  lang,
  settings,
  onUpdateSettings,
  onClose,
}) => {
  const isDark = theme === "dark";

  const card = isDark
    ? "bg-gray-900 border-gray-700"
    : "bg-white border-gray-300";

  const [local, setLocal] = useState(settings);

  const update = (field: keyof AISettings, value: any) => {
    const updated = { ...local, [field]: value };
    setLocal(updated);
    onUpdateSettings(updated);
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50"
    >
      <div className={`w-full max-w-lg p-6 rounded-xl border ${card}`}>
        <h2
          className={`text-xl font-semibold mb-4 ${
            isDark ? "text-white" : "text-gray-900"
          }`}
        >
          Settings
        </h2>

        <div className="grid grid-cols-2 gap-4 text-sm">

          <label className="flex flex-col">
            <span className="text-gray-500">Base Risk %</span>
            <input
              type="number"
              step="0.01"
              value={local.baseRiskPerTrade}
              onChange={(e) =>
                update("baseRiskPerTrade", Number(e.target.value))
              }
              className={`px-2 py-1 rounded border ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-200"
                  : "bg-white border-gray-300 text-gray-800"
              }`}
            />
          </label>

          <label className="flex flex-col">
            <span className="text-gray-500">Max Drawdown %</span>
            <input
              type="number"
              step="0.01"
              value={local.maxDrawdownPercent}
              onChange={(e) =>
                update("maxDrawdownPercent", Number(e.target.value))
              }
              className={`px-2 py-1 rounded border ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-200"
                  : "bg-white border-gray-300 text-gray-800"
              }`}
            />
          </label>

          <label className="flex flex-col col-span-2">
            <span className="text-gray-500">Custom Strategy</span>
            <textarea
              value={local.customStrategy}
              onChange={(e) =>
                update("customStrategy", e.target.value)
              }
              className={`px-2 py-1 rounded border h-24 ${
                isDark
                  ? "bg-gray-800 border-gray-700 text-gray-200"
                  : "bg-white border-gray-300 text-gray-800"
              }`}
            />
          </label>

        </div>

        <button
          onClick={onClose}
          className={`mt-6 w-full py-2 rounded font-semibold ${
            isDark
              ? "bg-cyan-600 text-white hover:bg-cyan-500"
              : "bg-cyan-500 text-white hover:bg-cyan-600"
          }`}
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default SettingsPanel;