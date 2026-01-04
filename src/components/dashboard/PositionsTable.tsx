import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ActivePosition } from "@/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import Panel from "@/components/dashboard/Panel";

type PositionsTableProps = {
  positions: ActivePosition[];
  positionsLoaded: boolean;
  onClosePosition: (position: ActivePosition) => void;
};

function formatNumber(value?: number, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function formatMoney(value?: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export default function PositionsTable({
  positions,
  positionsLoaded,
  onClosePosition,
}: PositionsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  const rows = useMemo(() => {
    return positions.map((p) => {
      const size = Number(p.size ?? p.qty);
      const sideLower = String(p.side ?? "").toLowerCase();
      const isBuy = sideLower === "buy";
      const trail = Number(p.currentTrailingStop);
      const slValue = Number(p.sl);
      const sl =
        Number.isFinite(trail) && trail > 0
          ? trail
          : Number.isFinite(slValue)
            ? slValue
            : undefined;
      const tpValue = Number(p.tp);
      const tp = Number.isFinite(tpValue) ? tpValue : undefined;
      const upnl = Number(p.unrealizedPnl ?? p.pnl ?? p.pnlValue);
      const slMissing = !Number.isFinite(sl) || (sl as number) <= 0;
      const tpMissing = !Number.isFinite(tp) || tp <= 0;
      const protectionLabel =
        slMissing && tpMissing
          ? "TP/SL pending"
          : slMissing
            ? "SL missing"
            : tpMissing
              ? "TP missing"
              : "Protected";
      const protectionClass =
        slMissing || tpMissing
          ? "border-amber-500/50 text-amber-300"
          : "border-emerald-500/50 text-emerald-400";
      return {
        key: p.positionId || p.id || p.symbol,
        raw: p,
        size,
        isBuy,
        sl,
        tp,
        upnl,
        protectionLabel,
        protectionClass,
      };
    });
  }, [positions]);

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Panel title="Positions">
      {!positionsLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
          Loading positions...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
          No open positions.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="py-2 text-left font-medium">Symbol</th>
                <th className="py-2 text-left font-medium">Side</th>
                <th className="py-2 text-right font-medium">Size</th>
                <th className="py-2 text-right font-medium">Entry</th>
                <th className="py-2 text-right font-medium">PnL</th>
                <th className="py-2 text-right font-medium">TP</th>
                <th className="py-2 text-right font-medium">SL</th>
                <th className="py-2 text-left font-medium">Status</th>
                <th className="py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = Boolean(expandedRows[row.key]);
                return (
                  <Fragment key={row.key}>
                    <tr className="border-b border-border/40 text-sm">
                      <td className="py-3 pr-2">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => toggleRow(row.key)}
                            aria-label={
                              expanded
                                ? "Collapse position details"
                                : "Expand position details"
                            }
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                          <span className="font-mono">{row.raw.symbol}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <Badge
                          variant="outline"
                          className={
                            row.isBuy
                              ? "border-emerald-500/50 text-emerald-400"
                              : "border-red-500/50 text-red-400"
                          }
                        >
                          {String(row.raw.side ?? "").toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {formatNumber(row.size)}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {formatNumber(row.raw.entryPrice)}
                      </td>
                      <td
                        className={`py-3 text-right font-mono tabular-nums ${
                          Number.isFinite(row.upnl)
                            ? row.upnl >= 0
                              ? "text-emerald-400"
                              : "text-red-400"
                            : "text-muted-foreground"
                        }`}
                      >
                        {Number.isFinite(row.upnl)
                          ? `${row.upnl > 0 ? "+" : ""}${formatMoney(row.upnl)}`
                          : "—"}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {Number.isFinite(row.tp) ? formatNumber(row.tp) : "—"}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {Number.isFinite(row.sl) ? formatNumber(row.sl) : "—"}
                      </td>
                      <td className="py-3">
                        <Badge variant="outline" className={row.protectionClass}>
                          {row.protectionLabel}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onClosePosition(row.raw)}
                        >
                          Close
                        </Button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border/40 bg-background/40">
                        <td colSpan={9} className="py-3 pl-12 text-xs text-muted-foreground">
                          <div className="flex flex-wrap gap-4">
                            <span>
                              Trailing:{" "}
                              <span className="font-mono text-foreground">
                                {formatNumber(row.raw.trailingStop ?? row.raw.currentTrailingStop)}
                              </span>
                            </span>
                            <span>
                              Opened:{" "}
                              <span className="font-mono text-foreground">
                                {row.raw.openedAt
                                  ? new Date(row.raw.openedAt).toLocaleString()
                                  : "—"}
                              </span>
                            </span>
                            <span>
                              RRR:{" "}
                              <span className="font-mono text-foreground">
                                {Number.isFinite(row.raw.rrr)
                                  ? row.raw.rrr?.toFixed(2)
                                  : "—"}
                              </span>
                            </span>
                            <span>
                              Update:{" "}
                              <span className="text-foreground">
                                {row.raw.lastUpdateReason ?? "—"}
                              </span>
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
