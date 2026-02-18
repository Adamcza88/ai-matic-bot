import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ActivePosition } from "@/types";
import { ChevronDown, ChevronRight } from "lucide-react";
import Panel from "@/components/dashboard/Panel";

type PositionsTableProps = {
  positions: ActivePosition[];
  positionsLoaded: boolean;
  onClosePosition?: (position: ActivePosition) => void;
  allowClose?: boolean;
};

function formatNumber(value?: number, digits = 4) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "—";
}

function formatSignedMoney(value?: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  const amount = Number(value).toFixed(digits);
  return `${value && value > 0 ? "+" : ""}${amount}`;
}

function formatClock(value?: string) {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function PositionsTable({
  positions,
  positionsLoaded,
  onClosePosition,
  allowClose = true,
}: PositionsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const showActions = allowClose !== false;

  const rows = useMemo(() => {
    return positions.map((p) => {
      const size = Number(p.size ?? p.qty);
      const sideLower = String(p.side ?? "").toLowerCase();
      const isBuy = sideLower === "buy";
      const trail = Number(p.currentTrailingStop);
      const trailingActivePrice = Number(p.trailingActivePrice);
      const markPrice = Number(p.markPrice);
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
      const entryValue = Number.isFinite(p.entryPrice)
        ? p.entryPrice
        : Number.isFinite(p.triggerPrice)
          ? p.triggerPrice
          : Number.NaN;
      const protectionLabel =
        slMissing && tpMissing
          ? "Čeká na TP/SL"
          : slMissing
            ? "Chybí SL"
            : tpMissing
              ? "Chybí TP"
              : "Zajištěno";
      const protectionClass =
        slMissing || tpMissing
          ? "border-amber-500/50 text-amber-300"
          : "border-emerald-500/50 text-emerald-400";
      const updateLabel = (() => {
        if (p.lastUpdateReason) return p.lastUpdateReason;
        if (!p.timestamp) return "—";
        const parsed = Date.parse(p.timestamp);
        return Number.isFinite(parsed)
          ? new Date(parsed).toLocaleString()
          : "—";
      })();
      const hasTrailing =
        Boolean(p.trailPlanned) ||
        (Number.isFinite(trail) && trail > 0) ||
        (Number.isFinite(trailingActivePrice) && trailingActivePrice > 0);
      const activationHit =
        Number.isFinite(trailingActivePrice) &&
        trailingActivePrice > 0 &&
        Number.isFinite(markPrice) &&
        (isBuy ? markPrice >= trailingActivePrice : markPrice <= trailingActivePrice);
      return {
        key: p.positionId || p.id || p.symbol,
        raw: p,
        size,
        isBuy,
        sl,
        tp,
        upnl,
        entryValue,
        updateLabel,
        protectionLabel,
        protectionClass,
        hasTrailing,
        activationHit,
      };
    });
  }, [positions]);

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Panel title="Pozice" fileId="POSITION MODULE ID: TR-02-P">
      {!positionsLoaded ? (
        <div className="rounded-lg border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
          Načítám pozice…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 py-10 text-center text-xs text-muted-foreground">
          Žádné otevřené pozice.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm lm-table dm-table">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="w-[170px] py-2 text-left font-medium">Symbol</th>
                <th className="w-[90px] py-2 text-left font-medium">Směr</th>
                <th className="w-[90px] py-2 text-right font-medium">Objem</th>
                <th className="w-[130px] py-2 text-right font-medium">Vstup</th>
                <th className="w-[120px] py-2 text-right font-medium">PnL</th>
                <th className="py-2 text-left font-medium">Stav</th>
                {showActions && (
                  <th className="w-[100px] py-2 text-right font-medium">Akce</th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expanded = Boolean(expandedRows[row.key]);
                return (
                  <Fragment key={row.key}>
                    <tr className="border-b border-border/40 text-sm lm-table-row">
                      <td className="py-3 pr-2">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => toggleRow(row.key)}
                            aria-label={
                              expanded
                                ? "Sbalit detail pozice"
                                : "Rozbalit detail pozice"
                            }
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                          <span className="font-mono text-foreground">{row.raw.symbol}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <Badge
                          variant="outline"
                          className={
                            row.isBuy
                              ? "border-emerald-500/50 text-emerald-400 dm-status-pass"
                              : "border-red-500/50 text-red-400 dm-status-sell"
                          }
                        >
                          {row.isBuy ? "LONG" : "SHORT"}
                        </Badge>
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {formatNumber(row.size, 2)}
                      </td>
                      <td className="py-3 text-right font-mono tabular-nums">
                        {Number.isFinite(row.entryValue) ? formatNumber(row.entryValue) : "—"}
                      </td>
                      <td
                        className={`py-3 text-right font-mono tabular-nums ${
                          Number.isFinite(row.upnl)
                            ? row.upnl >= 0
                              ? "text-emerald-300 dm-pnl-positive"
                              : "text-[#A94B4B] lm-pnl-negative dm-pnl-negative"
                            : "text-muted-foreground"
                        }`}
                      >
                        {formatSignedMoney(row.upnl)}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`${row.protectionClass} text-[10px] ${
                              row.protectionLabel === "Zajištěno"
                                ? "dm-status-pass"
                                : "dm-status-warn"
                            }`}
                          >
                            {row.protectionLabel}
                          </Badge>
                          {row.hasTrailing ? (
                            <Badge
                              variant="outline"
                              className="border-sky-500/50 text-[10px] text-sky-300 dm-status-muted"
                            >
                              TRAIL
                            </Badge>
                          ) : null}
                          {row.activationHit ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-500/50 text-[10px] text-emerald-400 dm-status-pass"
                            >
                              Aktivní
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      {showActions && (
                        <td className="py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs dm-action-close"
                            onClick={() => onClosePosition?.(row.raw)}
                          >
                            Zavřít
                          </Button>
                        </td>
                      )}
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border/40 bg-background/40 lm-table-row-muted dm-table-row-muted">
                        <td
                          colSpan={showActions ? 7 : 6}
                          className="py-3 pl-12 text-xs text-muted-foreground"
                        >
                          <div className="flex flex-wrap gap-4">
                            <span>
                              Trailing:{" "}
                              <span className="font-mono text-foreground">
                                {formatNumber(
                                  row.raw.trailingStop ?? row.raw.currentTrailingStop
                                )}
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
                              TP:{" "}
                              <span className="font-mono text-foreground">
                                {Number.isFinite(row.tp) ? formatNumber(row.tp) : "—"}
                              </span>
                            </span>
                            <span>
                              SL:{" "}
                              <span className="font-mono text-foreground">
                                {Number.isFinite(row.sl) ? formatNumber(row.sl) : "—"}
                              </span>
                            </span>
                            <span>
                              Aktualizace:{" "}
                              <span className="text-foreground">
                                {formatClock(row.raw.timestamp)}
                              </span>
                            </span>
                            <span className="text-muted-foreground">{row.updateLabel}</span>
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
