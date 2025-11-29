import React from "react";
import { PendingSignal } from "../types";

interface Props {
  theme: string;
  lang: string;
  pendingSignals: PendingSignal[];
  onExecute: (id: string) => void;
  onReject: (id: string) => void;
}

const PendingSignalsPanel: React.FC<Props> = ({
  theme,
  lang,
  pendingSignals,
  onExecute,
  onReject,
}) => {
  const isDark = theme === "dark";

  const card = isDark
    ? "bg-gray-900/50 border-gray-700/50"
    : "bg-white border-gray-200";

  return (
    <div className={`rounded-xl p-4 border ${card}`}>
      <h2
        className={`text-lg font-semibold mb-4 ${
          isDark ? "text-white" : "text-gray-900"
        }`}
      >
        Pending Signals
      </h2>

      {pendingSignals.length === 0 ? (
        <div
          className={`text-sm ${
            isDark ? "text-gray-500" : "text-gray-600"
          } italic`}
        >
          No signals detected.
        </div>
      ) : (
        <div className="space-y-3">
          {pendingSignals.map((s) => (
            <div
              key={s.id}
              className={`p-3 rounded border ${
                isDark
                  ? "border-gray-700 bg-gray-800/40"
                  : "border-gray-200 bg-gray-100"
              }`}
            >
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-semibold">
                    {s.symbol} — {s.intent.side.toUpperCase()}
                  </div>
                  <div className="text-xs text-gray-400">
                    Entry: {s.intent.entry.toFixed(2)} | SL:{" "}
                    {s.intent.sl.toFixed(2)} | TP:{" "}
                    {s.intent.tp.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Risk Score: {(s.risk * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {s.message}
                  </div>
                </div>

                <div className="flex flex-col space-y-1 ml-4">
                  <button
                    onClick={() => onExecute(s.id)}
                    className={`px-3 py-1 text-xs rounded font-semibold ${
                      isDark
                        ? "bg-green-600/70 hover:bg-green-600 text-white"
                        : "bg-green-500 hover:bg-green-600 text-white"
                    }`}
                  >
                    Execute
                  </button>
                  <button
                    onClick={() => onReject(s.id)}
                    className={`px-3 py-1 text-xs rounded font-semibold ${
                      isDark
                        ? "bg-red-600/70 hover:bg-red-600 text-white"
                        : "bg-red-500 hover:bg-red-600 text-white"
                    }`}
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PendingSignalsPanel;