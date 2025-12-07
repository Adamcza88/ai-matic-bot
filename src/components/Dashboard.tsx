// src/components/Dashboard.tsx
import { AISettings, TradingMode } from "../types";
import type { TradingBotApi } from "../hooks/useTradingBot";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, AlertTriangle, TrendingUp, Wallet, Zap } from "lucide-react";

const QTY_LIMITS: Record<string, { min: number; max: number }> = {
  BTCUSDT: { min: 0.001, max: 0.01 },
  ETHUSDT: { min: 0.01, max: 5 },
  SOLUSDT: { min: 0.1, max: 100 },
  ADAUSDT: { min: 1, max: 10000 },
};

type DashboardProps = {
  mode: TradingMode;
  setMode: (m: TradingMode) => void;
  useTestnet: boolean;
  setUseTestnet: (v: boolean) => void;
  bot: TradingBotApi;
};

export default function Dashboard({
  mode,
  setMode,
  useTestnet,
  setUseTestnet,
  bot,
}: DashboardProps) {
  const {
    systemState,
    portfolioState,
    settings,
  pendingSignals,
  activePositions,
  logEntries,
  updateSettings,
  closePosition,
  entryHistory,
  testnetOrders,
  testnetTrades,
    ordersError,
    refreshTestnetOrders,
    assetPnlHistory,
    removeEntryHistoryItem,
  } = bot;

  const setProfile = (profile: AISettings["strategyProfile"]) => {
    updateSettings({ ...settings, strategyProfile: profile });
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Dashboard
          </h2>
          <p className="text-slate-400 hidden lg:block">
            Autonomous trading system control center
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-white/10">
            <Button
              variant={useTestnet ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setUseTestnet(true)}
              className={useTestnet ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}
            >
              TESTNET
            </Button>
            <Button
              variant={!useTestnet ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setUseTestnet(false)}
              className={!useTestnet ? "bg-emerald-600 text-white hover:bg-emerald-700" : "text-slate-400 hover:text-white"}
            >
              MAINNET
            </Button>
          </div>

          <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-white/10">
            {Object.values(TradingMode).map((m) => (
              <Button
                key={m}
                variant={mode === m ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setMode(m)}
                className={
                  mode === m
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "text-slate-400 hover:text-white"
                }
              >
                {m}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* === SYSTEM + PORTFOLIO === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              System & Portfolio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Bybit Connection</span>
                  <Badge
                    variant="outline"
                    className={
                      systemState.bybitStatus === "Connected"
                        ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                        : "border-red-500/50 text-red-500 bg-red-500/10"
                    }
                  >
                    {systemState.bybitStatus}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Latency</span>
                  <span className="font-mono">{systemState.latency} ms</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Last Error</span>
                  <span className="text-red-400 truncate max-w-[200px]" title={systemState.lastError ?? ""}>
                    {systemState.lastError ?? "None"}
                  </span>
                </div>
              </div>
              <div className="space-y-2 pt-3 border-t border-white/10">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Capital</span>
                  <span className="font-mono font-medium text-lg">
                    ${portfolioState.totalCapital.toFixed(2)}
                  </span>
                </div>
                {settings.entryStrictness !== "test" ? (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Allocated</span>
                    <span className="font-mono text-slate-300">
                      ${portfolioState.allocatedCapital.toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Allocated</span>
                    <span className="font-mono text-slate-500">Disabled in TEST</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-400">Daily PnL</span>
                  <span
                    className={`font-mono ${portfolioState.dailyPnl >= 0
                      ? "text-emerald-500"
                      : "text-red-500"
                      }`}
                  >
                    {portfolioState.dailyPnl > 0 ? "+" : ""}
                    {portfolioState.dailyPnl.toFixed(2)} USD
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* === AI STRATEGY SETTINGS === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              AI Strategy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Profile</span>
                <Badge variant="secondary" className="capitalize bg-slate-800 text-slate-300 hover:bg-slate-700">
                  {settings.strategyProfile}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                  {[
                    { key: "off", label: "Off" },
                    { key: "auto", label: "Auto" },
                    { key: "coach", label: "Coach" },
                    { key: "scalp", label: "Scalp" },
                    { key: "intraday", label: "Intraday" },
                    { key: "swing", label: "Swing" },
                    { key: "trend", label: "Trend" },
                  ].map((opt) => (
                  <Button
                    key={opt.key}
                    size="sm"
                    variant={settings.strategyProfile === opt.key ? "secondary" : "ghost"}
                    className={
                      settings.strategyProfile === opt.key
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "text-slate-300 hover:text-white"
                    }
                    onClick={() => setProfile(opt.key as any)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Entry Strictness</span>
                <Badge variant="outline" className="capitalize border-slate-700 text-slate-300 bg-slate-800">
                  {settings.entryStrictness}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {[
                  { key: "base", label: "Base" },
                  { key: "relaxed", label: "Relaxed" },
                  { key: "ultra", label: "Ultra" },
                  { key: "test", label: "Test" },
                ].map((opt) => (
                  <Button
                    key={opt.key}
                    size="sm"
                    variant={settings.entryStrictness === opt.key ? "secondary" : "ghost"}
                    className={
                      settings.entryStrictness === opt.key
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "text-slate-300 hover:text-white"
                    }
                    onClick={() => updateSettings({ ...settings, entryStrictness: opt.key as any })}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-slate-400">Enforce Trading Hours</span>
                <Button
                  size="sm"
                  variant={settings.enforceSessionHours ? "secondary" : "ghost"}
                  className={
                    settings.enforceSessionHours
                      ? "bg-amber-500 text-black hover:bg-amber-600"
                      : "text-slate-300 hover:text-white"
                  }
                  onClick={() =>
                    updateSettings({
                      ...settings,
                      enforceSessionHours: !settings.enforceSessionHours,
                    })
                  }
                >
                  {settings.enforceSessionHours ? "On" : "Off"}
                </Button>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Base Risk</span>
                <span className="font-mono">{(settings.baseRiskPerTrade * 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Max Drawdown</span>
                <span className="font-mono">{(settings.maxDrawdownPercent * 100).toFixed(2)}%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* === ACTIVE POSITIONS === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              Active Positions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activePositions.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-8 text-center border border-dashed border-slate-800 rounded-lg">
                No open positions.
              </div>
            ) : (
              <div className="space-y-3">
                {activePositions.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-4 border border-white/5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div>
                      <div className="font-bold flex items-center gap-2 text-lg">
                        {p.symbol}
                        <Badge
                          variant="outline"
                          className={
                            p.side === "buy"
                              ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                              : "border-red-500/50 text-red-500 bg-red-500/10"
                          }
                        >
                          {p.side.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 font-mono">
                        Entry: {p.entryPrice} | Size: {p.size.toFixed(4)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-mono font-bold text-lg ${p.unrealizedPnl >= 0
                          ? "text-emerald-500"
                          : "text-red-500"
                          }`}
                      >
                        {p.unrealizedPnl > 0 ? "+" : ""}
                        {p.unrealizedPnl.toFixed(2)} USD
                      </div>
                      <div className="text-xs text-slate-400 mt-1 font-mono">
                        TP: {p.tp} | SL: {p.currentTrailingStop ?? p.sl}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 text-red-400 hover:text-white hover:bg-red-500/10"
                        onClick={() => closePosition(p.id)}
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 text-xs text-slate-500">
              Limits per asset (qty):{" "}
              {Object.entries(QTY_LIMITS)
                .map(([sym, lim]) => `${sym} ${lim.min}–${lim.max}`)
                .join(" · ")}
            </div>
          </CardContent>
        </Card>

        {/* === PENDING SIGNALS === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Pending Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingSignals.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-8 text-center border border-dashed border-slate-800 rounded-lg">
                No signals detected.
              </div>
            ) : (
              <div className="space-y-3">
                {pendingSignals.map((s) => (
                  <div
                    key={s.id}
                    className="p-4 border border-white/5 rounded-lg bg-white/5 space-y-3"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold">{s.symbol}</span>
                      <Badge
                        variant="outline"
                        className={
                          s.intent.side === "buy"
                            ? "border-emerald-500/50 text-emerald-500"
                            : "border-red-500/50 text-red-500"
                        }
                      >
                        {s.intent.side.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-400 font-mono">
                      Entry: {s.intent.entry} | Risk: {(s.risk * 100).toFixed(1)}%
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => bot.executeTrade(s.id)}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Execute
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => bot.rejectSignal(s.id)}
                        className="flex-1"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === LIVE FEED === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-400">Live Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {logEntries.length === 0 ? (
                <div className="text-sm text-slate-500 italic">
                  No activity yet.
                </div>
              ) : (
                logEntries.slice(0, 50).map((l) => (
                  <div
                    key={l.id}
                    className="text-sm flex gap-3 py-2 border-b border-white/5 last:border-0"
                  >
                    <span className="text-slate-500 text-xs whitespace-nowrap font-mono w-20">
                      {new Date(l.timestamp).toLocaleTimeString([], {
                        hour12: false,
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span className="font-medium text-blue-400 w-24 text-xs uppercase tracking-wider">
                      {l.action}
                    </span>
                    <span className="text-slate-300">{l.message}</span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* === ENTRY HISTORY === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Entry History</CardTitle>
            <span className="text-xs text-slate-500">
              {entryHistory.length} uložených vstupů
            </span>
          </CardHeader>
          <CardContent>
            {entryHistory.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg">
                Zatím žádné uložené vstupy.
              </div>
            ) : (
              <div className="space-y-3">
                {entryHistory.slice(0, 8).map((h) => (
                  <div
                    key={h.id}
                    className="p-3 rounded-lg border border-white/5 bg-white/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold">{h.symbol}</span>
                        <Badge
                          variant="outline"
                          className={h.side === "buy" ? "border-emerald-500/50 text-emerald-500" : "border-red-500/50 text-red-500"}
                        >
                          {h.side.toUpperCase()}
                        </Badge>
                      </div>
                      <button
                        onClick={() => removeEntryHistoryItem(h.id)}
                        className="text-xs text-slate-500 hover:text-red-400"
                        title="Odstranit uložený signál"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-1">
                      Entry {h.entryPrice} | SL {h.sl ?? "-"} | TP {h.tp ?? "-"} | Size {h.size.toFixed(3)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {new Date(h.createdAt).toLocaleString()} · {h.settingsNote}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === TESTNET ORDERS === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Testnet Orders</CardTitle>
            <div className="flex items-center gap-2">
              {ordersError && (
                <span className="text-xs text-red-400 truncate max-w-[160px]" title={ordersError}>
                  {ordersError}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshTestnetOrders()}
                className="h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white"
              >
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {ordersError ? (
              <div className="text-sm text-red-400 italic py-6 text-center border border-red-500/30 bg-red-500/5 rounded-lg">
                Orders API failed: {ordersError}
              </div>
            ) : testnetOrders.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg">
                Žádné otevřené testnet orders.
              </div>
            ) : (
              <div className="space-y-3">
                {testnetOrders.slice(0, 8).map((o) => (
                  <div
                    key={o.orderId}
                    className="p-3 rounded-lg border border-white/5 bg-white/5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold">{o.symbol}</span>
                      <Badge
                        variant="outline"
                        className={o.side === "Buy" ? "border-emerald-500/50 text-emerald-500" : "border-red-500/50 text-red-500"}
                      >
                        {o.side}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-1">
                      Qty {o.qty} @ {o.price ?? "mkt"} | {o.status}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {new Date(o.createdTime).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {testnetTrades.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="text-xs text-slate-400 mb-2">Latest fills</div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                  {testnetTrades.slice(0, 10).map((t) => (
                    <div key={t.id} className="text-xs font-mono text-slate-300 flex justify-between">
                      <span className="flex-1 truncate">{t.symbol}</span>
                      <span className={t.side === "Buy" ? "text-emerald-400" : "text-red-400"}>{t.side}</span>
                      <span>{t.qty}</span>
                      <span>@{t.price}</span>
                      <span>{new Date(t.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* === ASSET PnL HISTORY === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Asset PnL History</CardTitle>
            <span className="text-xs text-slate-500">
              {Object.keys(assetPnlHistory).length} assets
            </span>
          </CardHeader>
          <CardContent>
            {Object.keys(assetPnlHistory).length === 0 ? (
              <div className="text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg">
                Žádný historický PnL zatím uložen.
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(assetPnlHistory).map(([symbol, records]) => {
                  const latest = records[0];
                  const sum = records.reduce((acc, r) => acc + (r.pnl ?? 0), 0);
                  return (
                    <div
                      key={symbol}
                      className="p-3 rounded-lg border border-white/5 bg-white/5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold">{symbol}</span>
                        <span
                          className={`font-mono text-sm ${sum >= 0 ? "text-emerald-400" : "text-red-400"}`}
                        >
                          Σ {sum >= 0 ? "+" : ""}
                          {sum.toFixed(2)} USD
                        </span>
                      </div>
                      {latest && (
                        <div className="text-xs text-slate-400 font-mono mt-1">
                          Poslední: {latest.pnl >= 0 ? "+" : ""}
                          {latest.pnl.toFixed(2)} · {new Date(latest.timestamp).toLocaleString()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
