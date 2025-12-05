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
    priceAlerts,
    addPriceAlert,
    removePriceAlert,
    updateSettings,
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
        {/* === SYSTEM STATUS === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
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
                <span className="text-red-400 truncate max-w-[150px]" title={systemState.lastError ?? ""}>
                  {systemState.lastError ?? "None"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* === PORTFOLIO & RISK === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
              <Wallet className="w-4 h-4" />
              Portfolio & Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Capital</span>
                <span className="font-mono font-medium text-lg">
                  ${portfolioState.totalCapital.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Allocated</span>
                <span className="font-mono text-slate-300">
                  ${portfolioState.allocatedCapital.toFixed(2)}
                </span>
              </div>
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
                  { key: "scalp", label: "Scalp" },
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
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                      {l.timestamp.split("T")[1].split(".")[0]}
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

        {/* === PRICE ALERTS === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Price Alerts</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => addPriceAlert("BTCUSDT", 100000)}
              className="h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white"
            >
              + Add BTC 100k
            </Button>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 mt-2">
              {priceAlerts.map((a) => (
                <li
                  key={a.id}
                  className="flex justify-between items-center text-sm p-2 bg-white/5 rounded border border-white/5"
                >
                  <span className="font-mono">
                    {a.symbol} @ {a.price}
                  </span>
                  <button
                    onClick={() => removePriceAlert(a.id)}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                  >
                    ×
                  </button>
                </li>
              ))}
              {priceAlerts.length === 0 && (
                <li className="text-sm text-slate-500 italic">
                  No alerts set.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
