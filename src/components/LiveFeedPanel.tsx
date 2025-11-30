import React from "react";
import { LogEntry } from "../types";

interface Props {
  theme: string;
  lang: string;
  logs: LogEntry[];
}

const LiveFeedPanel: React.FC<Props> = ({ logs }) => {
  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-xs h-full">
      <div className="flex flex-col space-y-1.5 p-6">
        <h3 className="font-semibold leading-none tracking-tight">Live Feed</h3>
      </div>

      <div className="p-6 pt-0">
        <div className="h-64 overflow-y-auto pr-2 space-y-2 text-sm">
          {logs.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">
              No activity yet.
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="p-2 rounded border bg-muted/30 text-xs"
              >
                <div className="flex justify-between mb-1">
                  <span className="font-semibold text-primary">{log.action}</span>
                  <span className="text-muted-foreground">
                    {log.timestamp.split("T")[1].split(".")[0]}
                  </span>
                </div>
                <div className="text-foreground/90">{log.message}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveFeedPanel;