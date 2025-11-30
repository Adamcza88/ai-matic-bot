import React from "react";
import { PendingSignal } from "../types";

interface Props {
  theme: string;
  lang: string;
  pendingSignals: PendingSignal[];
  onExecute: (id: string) => void;
  onReject: (id: string) => void;
}

const PendingSignalsPanel: React.FC<Props> = ({
  pendingSignals,
  onExecute,
  onReject,
}) => {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-xs">
      <div className="flex flex-col space-y-1.5 p-6">
        <h3 className="font-semibold leading-none tracking-tight">
          Pending Signals
        </h3>
      </div>

      <div className="p-6 pt-0">
        {pendingSignals.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">
            No signals detected.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingSignals.map((s) => (
              <div
                key={s.id}
                className="p-3 rounded-lg border bg-muted/50 flex flex-col gap-2"
              >
                <div className="flex justify-between items-center">
                  <div className="font-semibold text-sm">{s.symbol}</div>
                  <div
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.intent.side === "buy"
                        ? "bg-green-500/20 text-green-600 dark:text-green-400"
                        : "bg-red-500/20 text-red-600 dark:text-red-400"
                      }`}
                  >
                    {s.intent.side.toUpperCase()}
                  </div>
                </div>

                <div className="text-xs text-muted-foreground grid grid-cols-3 gap-1">
                  <span>Entry: {s.intent.entry.toFixed(2)}</span>
                  <span>SL: {s.intent.sl.toFixed(2)}</span>
                  <span>TP: {s.intent.tp.toFixed(2)}</span>
                </div>

                <div className="text-xs text-muted-foreground">
                  Risk Score: {(s.risk * 100).toFixed(1)}%
                </div>

                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => onExecute(s.id)}
                    className="flex-1 inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring bg-primary text-primary-foreground hover:bg-primary/90 h-7 px-2"
                  >
                    Execute
                  </button>
                  <button
                    onClick={() => onReject(s.id)}
                    className="flex-1 inline-flex items-center justify-center rounded-md text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring bg-destructive text-destructive-foreground hover:bg-destructive/90 h-7 px-2"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingSignalsPanel;