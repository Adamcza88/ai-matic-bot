// src/components/Dashboard.tsx
import React from "react";
import { TradingMode } from "../types";
import type { TradingBotApi } from "../hooks/useTradingBot";

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
    closedPositions,
    logEntries,
    priceAlerts,
    addPriceAlert,
    removePriceAlert,
  } = bot;

  return (
    <div style={{ padding: "20px", color: "white" }}>
      <h2>Now it's controlled by AI</h2>

      {/* === SYSTEM STATUS === */}
      <section>
        <h3>System Status</h3>
        <div>Bybit: {systemState.bybitStatus}</div>
        <div>Latency: {systemState.latency} ms</div>
        <div>Last Error: {systemState.lastError ?? "None"}</div>

        <div style={{ marginTop: "10px" }}>
          Trading Mode:&nbsp;
          {Object.values(TradingMode).map((m) => (
            <button
              key={m}
              style={{
                marginLeft: "6px",
                padding: "4px 8px",
                border: "1px solid white",
                background: m === mode ? "#22c55e" : "transparent",
              }}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div style={{ marginTop: "10px" }}>
          Network:&nbsp;
          <button
            style={{
              marginRight: "6px",
              padding: "4px 8px",
              border: "1px solid white",
              background: useTestnet ? "#22c55e" : "transparent",
            }}
            onClick={() => setUseTestnet(true)}
          >
            TESTNET
          </button>
          <button
            style={{
              padding: "4px 8px",
              border: "1px solid white",
              background: !useTestnet ? "#22c55e" : "transparent",
            }}
            onClick={() => setUseTestnet(false)}
          >
            MAINNET
          </button>
        </div>
      </section>

      {/* === PORTFOLIO & RISK === */}
      <section style={{ marginTop: "20px" }}>
        <h3>Portfolio &amp; Risk</h3>
        <div>Total Capital: ${portfolioState.totalCapital.toFixed(2)}</div>
        <div>Allocated: ${portfolioState.allocatedCapital.toFixed(2)}</div>
        <div>Daily PnL: {portfolioState.dailyPnl.toFixed(2)} USD</div>
        <div>
          Drawdown: {(portfolioState.currentDrawdown * 100).toFixed(2)}%
        </div>
      </section>

      {/* === PRICE ALERTS === */}
      <section style={{ marginTop: "20px" }}>
        <h3>Price Alerts</h3>
        <button
          onClick={() => addPriceAlert("BTCUSDT", 100000)}
          style={{ padding: "4px 8px", border: "1px solid white" }}
        >
          + Add BTC 100k Alert
        </button>
        <ul>
          {priceAlerts.map((a) => (
            <li key={a.id}>
              {a.symbol} @ {a.price}{" "}
              <button onClick={() => removePriceAlert(a.id)}>x</button>
            </li>
          ))}
        </ul>
      </section>

      {/* === PENDING SIGNALS === */}
      <section style={{ marginTop: "20px" }}>
        <h3>Pending Signals</h3>
        {pendingSignals.length === 0 && <div>No signals detected.</div>}
        {pendingSignals.map((s) => (
          <div key={s.id} style={{ borderTop: "1px solid gray", paddingTop: 4 }}>
            <div>
              {s.symbol} — {s.intent.side.toUpperCase()}
            </div>
            <div>
              Entry: {s.intent.entry} | SL: {s.intent.sl} | TP: {s.intent.tp}
            </div>
            <div>Risk Score: {(s.risk * 100).toFixed(1)}%</div>
            <div>{s.message}</div>
            <button onClick={() => bot.executeTrade(s.id)}>Execute</button>
            <button onClick={() => bot.rejectSignal(s.id)}>Reject</button>
          </div>
        ))}
      </section>

      {/* === ACTIVE POSITIONS === */}
      <section style={{ marginTop: "20px" }}>
        <h3>Active Positions</h3>
        {activePositions.length === 0 && <div>No open positions.</div>}
        {activePositions.map((p) => (
          <div key={p.id} style={{ borderTop: "1px solid gray", paddingTop: 4 }}>
            <div>
              {p.symbol} {p.side.toUpperCase()} @ {p.entryPrice}
            </div>
            <div>
              Size: {p.size.toFixed(4)} | PnL: {p.unrealizedPnl.toFixed(2)} USD
            </div>
            <div>
              SL: {p.sl} | TP: {p.tp} | Trailing SL:{" "}
              {p.currentTrailingStop ?? p.sl}
            </div>
          </div>
        ))}
      </section>

      {/* === CLOSED POSITIONS === */}
      <section style={{ marginTop: "20px" }}>
        <h3>Closed Positions</h3>
        {closedPositions.length === 0 && <div>No closed trades yet.</div>}
        {closedPositions.slice(0, 10).map((p) => (
          <div key={p.id} style={{ borderTop: "1px solid gray", paddingTop: 4 }}>
            <div>
              {p.symbol} {p.side.toUpperCase()} — PnL:{" "}
              {p.pnlValue.toFixed(2)} USD
            </div>
            <div>Closed at: {p.closedAt}</div>
          </div>
        ))}
      </section>

      {/* === AI STRATEGY SETTINGS === */}
      <section style={{ marginTop: "20px" }}>
        <h3>AI Strategy Settings</h3>
        <div>Base Risk %: {(settings.baseRiskPerTrade * 100).toFixed(2)}</div>
        <div>
          Max Drawdown %: {(settings.maxDrawdownPercent * 100).toFixed(2)}
        </div>
      </section>

      {/* === LIVE FEED === */}
      <section style={{ marginTop: "20px" }}>
        <h3>Live Feed</h3>
        {logEntries.length === 0 && <div>No activity yet.</div>}
        {logEntries.slice(0, 10).map((l) => (
          <div key={l.id}>
            <strong>{l.action}</strong> [{l.timestamp}] {l.message}
          </div>
        ))}
      </section>
    </div>
  );
}