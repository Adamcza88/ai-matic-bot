import React from "react";

interface Props {
  isBreakeven?: boolean;
  className?: string;
}

export const BreakevenBadge: React.FC<Props> = ({ isBreakeven, className }) => {
  if (!isBreakeven) return null;

  return (
    <div className={`flex items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 ${className}`} title="Breakeven Secured">
      BE
    </div>
  );
};