import React from "react";
import { LogEntry } from "../types";

interface Props {
  theme: string;
  lang: string;
  logs: LogEntry[];
}

const LiveFeedPanel: React.FC<Props> = ({ theme, logs }) => {
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
        Live Feed
      </h2>

      <div className="h-64 overflow-y-auto pr-2 space-y-2 text-sm">
        {logs.length === 0 ? (
          <div
            className={`text-sm ${
              isDark ? "text-gray-500" : "text-gray-600"
            } italic`}
          >
            No activity yet.
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`p-2 rounded border ${
                isDark
                  ? "border-gray-700 bg-gray-800/40"
                  : "border-gray-200 bg-gray-100"
              }`}
            >
              <div className="font-semibold text-xs text-cyan-400">
                {log.action}
              </div>
              <div className="text-gray-400 text-xs">{log.timestamp}</div>
              <div className="text-gray-300 text-sm">{log.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LiveFeedPanel;