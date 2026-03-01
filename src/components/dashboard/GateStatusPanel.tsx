import { useMemo } from "react";
import Panel from "@/components/dashboard/Panel";
import type {
  GateBlockerItem,
  EntryGateState,
  GateDisplayRow,
  GateDisplayStatus,
  ScanDiagnostics,
} from "@/lib/diagnosticsTypes";
import { buildGateBlockers, buildGateDisplayRows } from "@/lib/gateStatusModel";
import { buildRingSegmentsFromRows } from "@/lib/entryGateProgressModel";
import { UI_COPY } from "@/lib/uiCopy";

type GateStatusPanelProps = {
  strategyLabel: string;
  selectedSymbol: string | null;
  scanDiagnostics: ScanDiagnostics | null;
  scanLoaded: boolean;
  profileGateNames: string[];
  checklistEnabled: Record<string, boolean>;
  activeFilter: GateDisplayStatus | null;
  onActiveFilterChange: (status: GateDisplayStatus | null) => void;
};

const STATUS_ORDER: GateDisplayStatus[] = [
  "ALLOWED",
  "WAITING",
  "BLOCKED",
  "DISABLED",
];
const RING_SIZE = 180;
const RING_CENTER = RING_SIZE / 2;
const RING_RADIUS = 64;
const RING_STROKE = 16;

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

function statusStroke(status: GateDisplayStatus): string {
  if (status === "ALLOWED") return "#00C853";
  if (status === "WAITING") return "#FFB300";
  if (status === "BLOCKED") return "#D32F2F";
  return "#6B7280";
}

function entryStateLabel(state: EntryGateState): string {
  if (state === "READY") return UI_COPY.dashboard.gateStatus.entryReady;
  if (state === "BLOCKED") return UI_COPY.dashboard.gateStatus.entryBlocked;
  return UI_COPY.dashboard.gateStatus.entryWaiting;
}

function entryStateClass(state: EntryGateState): string {
  if (state === "READY") return "text-[#00C853]";
  if (state === "BLOCKED") return "text-[#D32F2F]";
  return "text-[#FFB300]";
}

function blockerTitle(kind: GateBlockerItem["kind"]): string {
  if (kind === "SYSTEM") return UI_COPY.dashboard.gateStatus.blockerSystem;
  if (kind === "GATE_BLOCKED") return UI_COPY.dashboard.gateStatus.blockerGateBlocked;
  return UI_COPY.dashboard.gateStatus.blockerWaiting;
}

function blockerClass(kind: GateBlockerItem["kind"]): string {
  if (kind === "SYSTEM") {
    return "border-[#D32F2F]/60 bg-[#D32F2F]/10 text-[#D32F2F]";
  }
  if (kind === "GATE_BLOCKED") {
    return "border-[#D32F2F]/45 bg-[#D32F2F]/5 text-[#D32F2F]";
  }
  return "border-[#FFB300]/45 bg-[#FFB300]/5 text-[#FFB300]";
}

export default function GateStatusPanel({
  strategyLabel,
  selectedSymbol,
  scanDiagnostics,
  scanLoaded,
  profileGateNames,
  checklistEnabled,
  activeFilter,
  onActiveFilterChange,
}: GateStatusPanelProps) {
  const diag = selectedSymbol ? scanDiagnostics?.[selectedSymbol] : null;
  const circumference = 2 * Math.PI * RING_RADIUS;
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

  const ringSegments = useMemo(() => {
    const base = buildRingSegmentsFromRows(rows);
    let offset = 0;
    return base.map((segment) => {
      const length = (segment.pct / 100) * circumference;
      const current = {
        ...segment,
        length,
        offset,
      };
      offset += length;
      return current;
    });
  }, [circumference, rows]);

  const filteredRows = useMemo(() => {
    if (!activeFilter) return rows;
    return rows.filter((row) => row.status === activeFilter);
  }, [activeFilter, rows]);
  const blockers = useMemo(
    () =>
      buildGateBlockers({
        diag,
        rows,
        waitingDetail: UI_COPY.dashboard.gateStatus.waitingDetail,
        noDetail: UI_COPY.dashboard.gateStatus.noDetail,
      }),
    [diag, rows]
  );

  const progress = diag?.entryGateProgress;
  const progressState: EntryGateState = progress?.state ?? "WAITING";
  const progressPct = Number.isFinite(progress?.pct) ? Number(progress?.pct) : 0;
  const progressLabel = progress?.label ?? "Checklist";
  const progressPassed = Number.isFinite(progress?.passed) ? Number(progress?.passed) : 0;
  const progressRequired = Number.isFinite(progress?.required) ? Number(progress?.required) : 0;

  const toggleFilter = (status: GateDisplayStatus) => {
    onActiveFilterChange(activeFilter === status ? null : status);
  };

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
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-md border border-border/60 bg-background/30 px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-foreground">
              {strategyLabel}
            </span>
            <span className="inline-flex rounded-md border border-border/60 bg-background/30 px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {selectedSymbol}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-background/25 p-3">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {UI_COPY.dashboard.gateStatus.entryProgressTitle}
              </div>
              <div className="mt-3 flex items-center gap-4">
                <svg
                  width={RING_SIZE}
                  height={RING_SIZE}
                  viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
                  className="shrink-0"
                >
                  <circle
                    cx={RING_CENTER}
                    cy={RING_CENTER}
                    r={RING_RADIUS}
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.2)"
                    strokeWidth={RING_STROKE}
                  />
                  <g transform={`rotate(-90 ${RING_CENTER} ${RING_CENTER})`}>
                    {ringSegments
                      .filter((segment) => segment.count > 0 && segment.length > 0)
                      .map((segment) => (
                        <circle
                          key={segment.status}
                          cx={RING_CENTER}
                          cy={RING_CENTER}
                          r={RING_RADIUS}
                          fill="none"
                          stroke={statusStroke(segment.status)}
                          strokeWidth={
                            activeFilter === segment.status
                              ? RING_STROKE + 3
                              : RING_STROKE
                          }
                          strokeDasharray={`${segment.length} ${Math.max(
                            0,
                            circumference - segment.length
                          )}`}
                          strokeDashoffset={-segment.offset}
                          className="cursor-pointer transition-all duration-200"
                          style={{
                            opacity:
                              activeFilter == null || activeFilter === segment.status
                                ? 1
                                : 0.35,
                          }}
                          onClick={() => toggleFilter(segment.status)}
                        />
                      ))}
                  </g>
                  <text
                    x={RING_CENTER}
                    y={RING_CENTER - 2}
                    textAnchor="middle"
                    className="fill-foreground text-lg font-semibold"
                  >
                    {progressPct}%
                  </text>
                  <text
                    x={RING_CENTER}
                    y={RING_CENTER + 18}
                    textAnchor="middle"
                    className={`text-[10px] font-semibold uppercase tracking-widest ${entryStateClass(
                      progressState
                    )}`}
                    fill="currentColor"
                  >
                    {progressState}
                  </text>
                </svg>
                <div className="min-w-0 space-y-1">
                  <div className={`text-sm font-semibold ${entryStateClass(progressState)}`}>
                    {entryStateLabel(progressState)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {progressPassed}/{progressRequired} · {progressLabel}
                  </div>
                  {progress?.reason ? (
                    <div className="text-xs text-muted-foreground">{progress.reason}</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="xl:col-span-2 grid grid-cols-2 gap-2 md:grid-cols-4">
              {STATUS_ORDER.map((status) => {
                const selected = activeFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleFilter(status)}
                    className={`rounded-lg border p-2 text-left transition-colors ${
                      selected
                        ? "border-foreground/40 bg-background/40"
                        : "border-border/60 bg-background/25"
                    }`}
                  >
                    <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                      {statusLabel(status)}
                    </div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                      {stats[status]}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {activeFilter
                ? `Filtr: ${statusLabel(activeFilter)} (${filteredRows.length})`
                : `Všechny gate (${rows.length})`}
            </div>
            {activeFilter ? (
              <button
                type="button"
                onClick={() => onActiveFilterChange(null)}
                className="rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {UI_COPY.dashboard.gateStatus.showAll}
              </button>
            ) : null}
          </div>

          <div className="rounded-lg border border-border/60 bg-background/25 p-3">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {UI_COPY.dashboard.gateStatus.blockersTitle}
            </div>
            {blockers.length === 0 ? (
              <div className="mt-2 text-xs text-muted-foreground">
                {UI_COPY.dashboard.gateStatus.blockerEmpty}
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {blockers.map((item, index) => (
                  <button
                    key={`${item.kind}:${item.reason}:${index}`}
                    type="button"
                    onClick={() => onActiveFilterChange(item.targetStatus)}
                    className={`rounded-md border px-2 py-1 text-left text-xs transition-colors ${
                      activeFilter === item.targetStatus
                        ? "border-foreground/45 bg-background/45"
                        : "border-border/60 bg-background/20"
                    }`}
                  >
                    <span
                      className={`mr-2 inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${blockerClass(
                        item.kind
                      )}`}
                    >
                      {blockerTitle(item.kind)}
                    </span>
                    <span className="text-muted-foreground">
                      {item.gateName ? `${item.gateName}: ` : ""}
                      {item.reason}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
                {filteredRows.length === 0 ? (
                  <tr className="h-14 border-b border-border/40">
                    <td colSpan={3} className="px-3 text-xs text-muted-foreground">
                      Pro zvolený filtr nejsou dostupné žádné gate.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row: GateDisplayRow) => (
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Panel>
  );
}
