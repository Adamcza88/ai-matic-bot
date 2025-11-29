import React from "react";
import { SystemState, TradingMode } from "../types";

interface Props {
  theme: string;
  lang: string;
  systemState: SystemState;
  mode: TradingMode;
  onModeChange: (m: TradingMode) => void;
}

const SystemStatusPanel: React.FC<Props> = ({
  theme,
  lang,
  systemState,
  mode,
  onModeChange,
}) => {
  const isDark = theme === "dark";

  const card = isDark
    ? "bg-gray-900/50 border-gray-700/50"
    : "bg-white border-gray-200";

  const statusColor =
    systemState.bybitStatus === "Connected"
      ? "text-green-400"
      : systemState.bybitStatus === "Error"
      ? "text-red-400"
      : "text-yellow-400";

  return (
    <div className={`rounded-xl p-4 border ${card}`}>
      <h2
        className={`text-lg font-semibold mb-4 ${
          isDark ? "text-white" : "text-gray-900"
        }`}
      >
        System Status
      </h2>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500">Bybit:</span>{" "}
          <span className={`${statusColor} font-semibold`}>
            {systemState.bybitStatus}
          </span>
        </div>

        <div>
          <span className="text-gray-500">Latency:</span>{" "}
          <span className="text-cyan-400 font-semibold">
            {systemState.latency} ms
          </span>
        </div>

        <div className="col-span-2">
          <span className="text-gray-500">Last Error:</span>{" "}
          <span className="text-red-400">
            {systemState.lastError ?? "None"}
          </span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700/40">
        <h3
          className={`text-sm font-semibold mb-2 ${
            isDark ? "text-gray-300" : "text-gray-700"
          }`}
        >
          Trading Mode
        </h3>

        <div className="flex space-x-2">
          {Object.values(TradingMode).map((m) => {
            const active = mode === m;

            return (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                className={`px-3 py-1.5 text-xs rounded border font-semibold transition ${
                  active
                    ? isDark
                      ? "bg-cyan-600 text-white border-cyan-500"
                      : "bg-cyan-500 text-white border-cyan-600"
                    : isDark
                    ? "border-gray-600 text-gray-300 hover:bg-gray-800"
                    : "border-gray-300 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SystemStatusPanel;