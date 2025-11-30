import React from "react";
import { ActivePosition } from "../types";

interface Props {
  theme: string;
  activePositions: ActivePosition[];
  currentPrices: Record<string, number>;
}

const ActivePositionsPanel: React.FC<Props> = ({
  theme,
  activePositions,
  currentPrices,
}) => {
  const isDark = theme === "dark";

  const card = isDark
    ? "bg-gray-900/50 border-gray-700/50"
    : "bg-white border-gray-200";

  return (
    <div className={`rounded-xl p-4 border ${card}`}>
      <h2
        className={`text-lg font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"
          }`}
      >
        Active Positions
      </h2>

      {activePositions.length === 0 ? (
        <div
          className={`text-sm ${isDark ? "text-gray-500" : "text-gray-600"
            } italic`}
        >
          No open positions.
        </div>
      ) : (
        <div className="space-y-3">
          {activePositions.map((pos) => {
            const live = currentPrices[pos.symbol] ?? pos.entryPrice;
            const pnlValue =
              pos.side === "buy"
                ? (live - pos.entryPrice) * pos.size
                : (pos.entryPrice - live) * pos.size;

            return (
              <div
                key={pos.id}
                className={`p-3 rounded border ${isDark
                    ? "border-gray-700 bg-gray-800/40"
                    : "border-gray-200 bg-gray-100"
                  }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm font-semibold">
                      {pos.symbol} — {pos.side.toUpperCase()}
                    </div>
                    <div className="text-xs text-gray-400">
                      Entry: {pos.entryPrice.toFixed(2)} | SL:{" "}
                      {pos.sl.toFixed(2)} | TP: {pos.tp.toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Live Price: {live.toFixed(2)}
                    </div>
                  </div>

                  <div
                    className={`text-sm font-bold ml-4 ${pnlValue >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                  >
                    {pnlValue.toFixed(2)} USD
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ActivePositionsPanel;