import React from "react";
import { ClosedPosition, Theme } from "../types";

interface HistoryAnalyticsProps {
  closedPositions: ClosedPosition[];
  theme?: Theme;
}

const HistoryAnalytics: React.FC<HistoryAnalyticsProps> = ({
  closedPositions = [],
  theme = "dark",
}) => {
  const totalTrades = closedPositions.length;

  const wins = closedPositions.filter((p) => p.pnlValue > 0);
  const losses = closedPositions.filter((p) => p.pnlValue <= 0);

  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  const totalPnlValue = closedPositions.reduce(
    (sum, p) => sum + p.pnlValue,
    0
  );

  const grossProfit = wins.reduce((sum, p) => sum + p.pnlValue, 0);
  const grossLoss = Math.abs(
    losses.reduce((sum, p) => sum + p.pnlValue, 0)
  );

  const profitFactor =
    grossLoss > 0
      ? grossProfit / grossLoss
      : grossProfit > 0
      ? Infinity
      : 0;

  const isDark = theme === "dark";

  const cardBg = isDark
    ? "bg-gray-900/50 border-gray-700/50"
    : "bg-white border-gray-200 shadow-sm";

  const labelColor = isDark ? "text-gray-400" : "text-gray-500";
  const valueColor = isDark ? "text-white" : "text-gray-900";
  const subColor = isDark ? "text-gray-500" : "text-gray-400";

  const StatCard = ({ label, value, subValue, color }: any) => (
    <div
      className={`${cardBg} rounded p-3 border flex flex-col items-center justify-center`}
    >
      <span className={`text-xs ${labelColor} uppercase tracking-wider`}>
        {label}
      </span>
      <span
        className={`text-lg font-bold mt-1 ${color || valueColor}`}
      >
        {value}
      </span>
      {subValue && (
        <span className={`text-xs ${subColor}`}>{subValue}</span>
      )}
    </div>
  );

  const green = isDark ? "text-green-400" : "text-green-600";
  const red = isDark ? "text-red-400" : "text-red-600";
  const yellow = isDark ? "text-yellow-400" : "text-yellow-600";
  const cyan = isDark ? "text-cyan-300" : "text-cyan-600";
  const gray = isDark ? "text-gray-300" : "text-gray-600";

  return (
    <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="Total PnL"
        value={`$${totalPnlValue.toFixed(2)}`}
        color={totalPnlValue >= 0 ? green : red}
      />

      <StatCard
        label="Win Rate"
        value={`${winRate.toFixed(1)}%`}
        subValue={`${wins.length}W - ${losses.length}L`}
        color={winRate >= 50 ? green : yellow}
      />

      <StatCard
        label="Profit Factor"
        value={profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}
        color={profitFactor >= 1.5 ? green : gray}
      />

      <StatCard label="Total Trades" value={totalTrades} color={cyan} />
    </div>
  );
};

export default HistoryAnalytics;