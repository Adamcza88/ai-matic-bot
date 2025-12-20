import React from "react";
import { PortfolioState, PriceAlert } from "../types";

interface Props {
  theme: string;
  portfolioState: PortfolioState;
  priceAlerts: PriceAlert[];
  onAddAlert: (symbol: string, price: number) => void;
  onRemoveAlert: (id: string) => void;
  onResetRisk: () => void;
}

const PortfolioRiskPanel: React.FC<Props> = ({
  theme,
  portfolioState,
  priceAlerts,
  onAddAlert,
  onRemoveAlert,
  onResetRisk,
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
        Portfolio & Risk
      </h2>

      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-500">Total Capital:</span>{" "}
          <span className={isDark ? "text-gray-200" : "text-gray-700"}>
            ${portfolioState.totalCapital.toFixed(2)}
          </span>
        </div>

        <div>
          <span className="text-gray-500">Allocated:</span>{" "}
          <span className="text-cyan-400">
            ${portfolioState.allocatedCapital.toFixed(2)}
          </span>
        </div>

        <div>
          <span className="text-gray-500">Daily PnL:</span>{" "}
          <span
            className={
              portfolioState.dailyPnl >= 0 ? "text-green-400" : "text-red-400"
            }
          >
            {portfolioState.dailyPnl.toFixed(2)} USD
          </span>
        </div>

        <div>
          <span className="text-gray-500">Drawdown:</span>{" "}
          <span className="text-yellow-400">
            {(portfolioState.currentDrawdown * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="mb-4 pt-3 border-t border-gray-700/40">
        <h3
          className={`text-sm font-semibold mb-2 ${isDark ? "text-gray-300" : "text-gray-700"
            }`}
        >
          Price Alerts
        </h3>

        <div className="space-y-2">
          {priceAlerts.map((a) => (
            <div
              key={a.id}
              className={`flex justify-between items-center p-2 rounded border ${isDark
                  ? "border-gray-700 bg-gray-800/40"
                  : "border-gray-200 bg-gray-100"
                }`}
            >
              <div className="text-sm">
                <span className="font-semibold">{a.symbol}</span>{" "}
                <span className="text-gray-400">@ {a.price}</span>
              </div>
              <button
                onClick={() => onRemoveAlert(a.id)}
                className="text-red-400 hover:text-red-600 text-xs font-semibold"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => onAddAlert("BTCUSDT", 100000)}
          className={`mt-3 px-3 py-1.5 text-xs rounded border ${isDark
              ? "border-gray-600 text-gray-300 hover:bg-gray-800"
              : "border-gray-300 text-gray-700 hover:bg-gray-200"
            }`}
        >
          + Add BTC 100k Alert
        </button>
      </div>

      <button
        onClick={onResetRisk}
        className={`w-full py-2 rounded text-sm font-semibold ${isDark
            ? "bg-red-600/70 text-white hover:bg-red-600"
            : "bg-red-500 text-white hover:bg-red-600"
          }`}
      >
        Reset Risk State
      </button>
    </div>
  );
};

export default PortfolioRiskPanel;
