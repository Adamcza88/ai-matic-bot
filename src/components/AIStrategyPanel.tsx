import React, { useState } from "react";
import { AISettings } from "../types";

interface Props {
  theme: string;
  lang: string;
  settings: AISettings;
  onUpdateSettings: (s: AISettings) => void;
  onClose?: () => void;
}

const AIStrategyPanel: React.FC<Props> = ({
  settings,
  onClose,
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
          <label className="text-sm font-medium leading-none">Custom Strategy Text</label>
          <div className="rounded-md border border-input bg-slate-800 text-secondary-foreground px-3 py-2 text-sm">
            Uzamčeno pro AI-Matic
          </div>
        </div>
      </div>

      <div className="flex justify-end p-6 pt-0">
        <button
          type="button"
          onClick={() => onClose?.()}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4"
        >
          Close
        </button>
      </div>
    </div>
  );
};

export default AIStrategyPanel;
