import React, { useState } from "react";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
}

const AIStrategyPanel: React.FC<Props> = ({
  settings,
}) => {
  const [local] = useState(settings);

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-xs">
      <div className="flex flex-col space-y-1.5 p-6">
        <h3 className="font-semibold leading-none tracking-tight">AI Strategy Settings</h3>
      </div>

      <div className="p-6 pt-0 grid gap-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">Profil</label>
          <div className="rounded-md border border-input bg-emerald-600/80 text-white px-3 py-2 text-sm">
            AI-Matic (uzamčeno)
          </div>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">Risk Engine</label>
          <div className="rounded-md border border-input bg-emerald-900/30 text-emerald-200 px-3 py-2 text-sm">
            AI-Matic (uzamčeno)
          </div>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">Enforce Trading Hours</label>
          <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
            {local.enforceSessionHours ? "On" : "Off"} (uzamčeno)
          </div>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium leading-none">Custom Strategy Text</label>
          <div className="rounded-md border border-input bg-slate-800 text-slate-200 px-3 py-2 text-sm">
            Uzamčeno pro AI-Matic
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIStrategyPanel;
