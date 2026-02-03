import React from "react";

interface Props {
  trend?: "rising" | "falling" | "flat";
  className?: string;
}

export const OpenInterestBadge: React.FC<Props> = ({ trend, className }) => {
  if (!trend) return null;

  let color = "bg-slate-500/20 text-slate-400 border-slate-500/30";
  let icon = "•";
  let label = "Flat";

  if (trend === "rising") {
    color = "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    icon = "↗";
    label = "Rising";
  } else if (trend === "falling") {
    color = "bg-rose-500/20 text-rose-400 border-rose-500/30";
    icon = "↘";
    label = "Falling";
  }

  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${color} ${className}`}>
      <span>OI</span>
      <span className="text-[10px]">{icon}</span>
      <span>{label}</span>
    </div>
  );
};