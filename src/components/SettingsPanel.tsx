import React, { useState } from "react";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onClose: () => void;
}

const SettingsPanel: React.FC<Props> = ({
  settings,
  onClose,
}) => {
  const [local] = useState(settings);

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-card text-card-foreground rounded-xl border shadow-lg p-6">
        <div className="flex flex-col space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            Settings
          </h2>
          <p className="text-sm text-muted-foreground">
            AI-Matic je uzamčený profil (pouze ke čtení).
          </p>
        </div>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Strategy Profile
            </label>
            <div className="rounded-md border border-input bg-emerald-600/80 text-white px-3 py-2 text-sm">
              AI-Matic (locked)
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Entry Strictness
            </label>
            <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
              {local.entryStrictness} (locked)
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Enforce Trading Hours
            </label>
            <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
              {local.enforceSessionHours ? "On" : "Off"} (locked)
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none">
                Base Risk %
              </label>
              <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
                {(local.baseRiskPerTrade * 100).toFixed(2)}%
              </div>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium leading-none">
                Max Drawdown %
              </label>
              <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
                {(local.maxDrawdownPercent * 100).toFixed(2)}%
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium leading-none">
              Custom Strategy
            </label>
            <div className="flex min-h-[80px] w-full rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
              Locked for AI-Matic
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 w-full sm:w-auto"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
