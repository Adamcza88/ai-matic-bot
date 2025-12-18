// src/components/Dashboard.tsx
import { TradingMode } from "../types";
import type { TradingBotApi } from "../hooks/useTradingBot";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, TrendingUp, Zap } from "lucide-react";

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
    activePositions,
    logEntries,
    testnetOrders,
    testnetTrades,
    ordersError,
    refreshTestnetOrders,
    assetPnlHistory,
    resetPnlHistory,
  } = bot;
  const modeOptions: TradingMode[] = [TradingMode.OFF, TradingMode.AUTO_ON];
  const allowedSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
  const exchangeOrders = testnetOrders;
  const exchangeTrades = testnetTrades;
  const refreshOrders = refreshTestnetOrders;

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Dashboard
          </h2>
          <p className="text-slate-400 hidden lg:block">
            Deterministic Scalp Profile 1 (15m/1m)
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
            {modeOptions.map((m) => (
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
            </div>
          </CardContent>
        </Card>

        {/* === STRATEGY PROFILE === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Strategy Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Profile</span>
                <Badge variant="secondary" className="bg-emerald-600/80 text-white">
                  Deterministic Scalp v1
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Symbols</span>
                <span className="font-mono">{allowedSymbols.join(", ")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Timeframes</span>
                <span className="font-mono">HTF 15m · LTF 1m</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Session</span>
                <span className="font-mono">London + NY (UTC)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Risk</span>
                <span className="font-mono">4 USDT / trade · 8 USDT total · max 2 pos</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Entry</span>
                <span className="font-mono">ST15 bias + ST1 flip + EMA21 pullback + RVOL≥1.2</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Execution</span>
                <span className="font-mono">PostOnly LIMIT · timeout 1×1m</span>
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
                {activePositions.map((p) => {
                  const size = Number(p.size ?? p.qty ?? 0);
                  const sideLower = String(p.side ?? "").toLowerCase();
                  const isBuy = sideLower === "buy";
                  const sl = Number(p.currentTrailingStop ?? p.sl ?? 0) || undefined;
                  const tp = Number(p.tp ?? 0) || undefined;
                  const upnl = Number(p.unrealizedPnl ?? 0) || 0;

                  return (
                    <div
                      key={p.positionId || p.id || p.symbol}
                      className="flex items-center justify-between p-4 border border-white/5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                    >
                      <div>
                        <div className="font-bold flex items-center gap-2 text-lg">
                          {p.symbol}
                          <Badge
                            variant="outline"
                            className={
                              isBuy
                                ? "border-emerald-500/50 text-emerald-500 bg-emerald-500/10"
                                : "border-red-500/50 text-red-500 bg-red-500/10"
                            }
                          >
                            {sideLower.toUpperCase()}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-mono">
                          Entry: {p.entryPrice} | Size: {Number.isFinite(size) ? size.toFixed(4) : "-"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`font-mono font-bold text-lg ${upnl >= 0 ? "text-emerald-500" : "text-red-500"
                            }`}
                        >
                          {upnl > 0 ? "+" : ""}
                          {upnl.toFixed(2)} USD
                        </div>
                        <div className="text-xs text-slate-400 mt-1 font-mono">
                          TP: {tp ?? "-"} | SL: {sl ?? "-"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* === LIVE FEED === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-400">
              Live Feed {useTestnet ? "(hidden on Testnet)" : "(Mainnet)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[360px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {useTestnet ? (
                <div className="text-sm text-slate-500 italic">
                  Live feed je z bezpečnostních důvodů skrytý na Testnetu. Přepni na MAINNET pro zobrazení.
                </div>
              ) : logEntries.length === 0 ? (
                  <div className="text-sm text-slate-500 italic">
                    No activity yet.
                  </div>
                ) : (
                  logEntries
                    .filter((l) => {
                      const msg = l.message || "";
                      return allowedSymbols.some((s) => msg.includes(s));
                    })
                    .slice(0, 10)
                    .map((l) => (
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

        {/* === BOT LOG === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-slate-400">
              Bot Log (posledních {Math.min(logEntries.length, 20)})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {logEntries.length === 0 ? (
                <div className="text-sm text-slate-500 italic">Žádné logy.</div>
              ) : (
                logEntries.slice(0, 20).map((l) => {
                  const human = (() => {
                    switch (l.action) {
                      case "STATUS":
                        return `Stav: ${l.message}`;
                      case "SIGNAL":
                        return `Signál: ${l.message}`;
                      case "OPEN":
                        return `Otevřeno: ${l.message}`;
                      case "CLOSE":
                      case "AUTO_CLOSE":
                        return `Uzavřeno: ${l.message}`;
                      case "ERROR":
                        return `Chyba: ${l.message}`;
                      case "RISK_HALT":
                      case "RISK_BLOCK":
                        return `Risk stop: ${l.message}`;
                      case "REJECT":
                        return `Zamítnuto: ${l.message}`;
                      case "SYSTEM":
                        return `Systém: ${l.message}`;
                      case "RESET":
                        return `Reset: ${l.message}`;
                      default:
                        return l.message;
                    }
                  })();
                  return (
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
                      <span className="font-medium text-amber-300 w-24 text-xs uppercase tracking-wider">
                        {l.action}
                      </span>
                      <span className="text-slate-300 break-words">{human}</span>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* === EXCHANGE ORDERS (TESTNET/MAINNET) === */}
        <Card className="bg-slate-900/50 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              {useTestnet ? "Testnet Orders" : "Mainnet Orders"}
            </CardTitle>
            <div className="flex items-center gap-2">
              {ordersError && (
                <span className="text-xs text-red-400 truncate max-w-[160px]" title={ordersError}>
                  {ordersError}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshOrders()}
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
            ) : exchangeOrders.length === 0 ? (
              <div className="text-sm text-slate-500 italic py-6 text-center border border-dashed border-slate-800 rounded-lg">
                {useTestnet ? "Žádné otevřené testnet orders." : "Žádné otevřené mainnet orders."}
              </div>
            ) : (
              <div className="space-y-3">
                {exchangeOrders.slice(0, 8).map((o) => (
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
            {exchangeTrades.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/10">
                <div className="text-xs text-slate-400 mb-2">Latest fills</div>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                  {exchangeTrades.slice(0, 10).map((t) => (
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
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                {Object.keys(assetPnlHistory).length} assets
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetPnlHistory()}
                className="h-7 text-xs border-white/10 hover:bg-white/10 hover:text-white"
              >
                Reset
              </Button>
            </div>
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
