import React from "react";
import { ClosedPosition } from "../types";

interface Props {
  theme: string;
  lang: string;
  closedPositions: ClosedPosition[];
}

const ClosedPositionsPanel: React.FC<Props> = ({
  theme,
  lang,
  closedPositions,
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
        Closed Positions
      </h2>

      {closedPositions.length === 0 ? (
        <div
          className={`text-sm ${
            isDark ? "text-gray-500" : "text-gray-600"
          } italic`}
        >
          No closed trades yet.
        </div>
      ) : (
        <div className="space-y-3">
          {closedPositions.map((pos) => (
            <div
              key={pos.id}
              className={`p-3 rounded border ${
                isDark
                  ? "border-gray-700 bg-gray-800/40"
                  : "border-gray-200 bg-gray-100"
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-semibold">
                    {pos.symbol} — {pos.side.toUpperCase()}
                  </div>
                  <div className="text-xs text-gray-400">
                    Entry: {pos.entryPrice.toFixed(2)} | Exit:{" "}
                    {pos.exitPrice.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Opened: {pos.timestamp}
                  </div>
                  <div className="text-xs text-gray-500">
                    Closed: {pos.closedAt}
                  </div>
                </div>

                <div
                  className={`text-sm font-bold ml-4 ${
                    pos.pnlValue >= 0 ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {pos.pnlValue.toFixed(2)} USD
                </div>
              </div>

              <div className="text-xs text-gray-500 mt-2">
                Size: {pos.size.toFixed(4)} | RRR: {pos.rrr?.toFixed?.(2) ?? "-"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ClosedPositionsPanel;