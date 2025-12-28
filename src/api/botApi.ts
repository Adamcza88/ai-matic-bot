import { TradeIntent, ExecutionState } from "./types";

const BASE = import.meta.env.VITE_BOT_API_BASE ?? "http://localhost:3001/api";

export async function sendIntent(intent: TradeIntent) {
  const r = await fetch(`${BASE}/intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
  });
  if (!r.ok) throw new Error(`intent_failed:${r.status}`);
  return r.json();
}

export async function fetchState(): Promise<ExecutionState> {
  const r = await fetch(`${BASE}/state`);
  if (!r.ok) throw new Error(`state_failed:${r.status}`);
  return r.json();
}

export async function kill(symbol: string) {
  const r = await fetch(`${BASE}/kill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol }),
  });
  if (!r.ok) throw new Error(`kill_failed:${r.status}`);
  return r.json();
}
