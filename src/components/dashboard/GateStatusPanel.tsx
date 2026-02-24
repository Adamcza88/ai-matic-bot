import { useMemo } from "react";
import Panel from "@/components/dashboard/Panel";
import type {
  GateDisplayRow,
  GateDisplayStatus,
  ScanDiagnostics,
} from "@/lib/diagnosticsTypes";
import { buildGateDisplayRows } from "@/lib/gateStatusModel";
import { UI_COPY } from "@/lib/uiCopy";

type GateStatusPanelProps = {
  selectedSymbol: string | null;
  scanDiagnostics: ScanDiagnostics | null;
  scanLoaded: boolean;
  profileGateNames: string[];
  checklistEnabled: Record<string, boolean>;
};

const STATUS_ORDER: GateDisplayStatus[] = [
  "ALLOWED",
  "WAITING",
  "BLOCKED",
  "DISABLED",
];

function statusLabel(status: GateDisplayStatus): string {
  return UI_COPY.dashboard.gateStatus[status];
}

function statusClass(status: GateDisplayStatus): string {
  if (status === "ALLOWED") {
    return "border-[#00C853]/60 bg-[#00C853]/10 text-[#00C853]";
  }
  if (status === "WAITING") {
    return "border-[#FFB300]/60 bg-[#FFB300]/10 text-[#FFB300]";
  }
  if (status === "BLOCKED") {
    return "border-[#D32F2F]/60 bg-[#D32F2F]/10 text-[#D32F2F]";
  }
  return "border-border/60 bg-background/25 text-muted-foreground";
}

export default function GateStatusPanel({
  selectedSymbol,
  scanDiagnostics,
  scanLoaded,
  profileGateNames,
  checklistEnabled,
}: GateStatusPanelProps) {
  const diag = selectedSymbol ? scanDiagnostics?.[selectedSymbol] : null;
  const rows = useMemo(
    () =>
      buildGateDisplayRows({
        diag,
        profileGateNames,
        checklistEnabled,
        waitingDetail: UI_COPY.dashboard.gateStatus.waitingDetail,
        noDetail: UI_COPY.dashboard.gateStatus.noDetail,
      }),
    [checklistEnabled, diag, profileGateNames]
  );

  const stats = useMemo(() => {
    const counts: Record<GateDisplayStatus, number> = {
      ALLOWED: 0,
      WAITING: 0,
      BLOCKED: 0,
      DISABLED: 0,
    };
    for (const row of rows) {
      counts[row.status] += 1;
    }
    return counts;
  }, [rows]);

  return (
    <Panel
      title="Checklist Gate Stavy"
      description={selectedSymbol ? `Trh ${selectedSymbol}` : "Není vybraný trh"}
      fileId="CHECKLIST STATUS ID: TR-13-GS"
    >
      {!scanLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Načítám stavy gate…
        </div>
      ) : !selectedSymbol ? (
        <div className="rounded-lg border border-dashed border-border/60 py-8 text-center text-xs text-muted-foreground">
          Není dostupný žádný trh.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {STATUS_ORDER.map((status) => (
              <div
                key={status}
                className="rounded-lg border border-border/60 bg-background/25 p-2"
              >
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  {statusLabel(status)}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                  {stats[status]}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="[&>th]:h-9 [&>th]:px-3 [&>th]:text-left border-b border-border/60">
                  <th>Gate</th>
                  <th>Stav</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {rows.map((row: GateDisplayRow) => (
                  <tr key={row.name} className="h-10 border-b border-border/40">
                    <td className="px-3 text-xs md:text-sm">{row.name}</td>
                    <td className="px-3">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusClass(
                          row.status
                        )}`}
                      >
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-3 text-xs text-muted-foreground md:text-sm">
                      {row.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
