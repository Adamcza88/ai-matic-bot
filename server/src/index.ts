import express from "express";
import cors from "cors";
import { AuditLog } from "./infra/audit";
import { IdempotencyStore } from "./infra/idempotency";
import { WsHealth } from "./infra/wsHealth";
import { makeRoutes } from "./http/routes";
import { reconcile } from "./execution/reconciler";
import { ExecutionState, Symbol } from "./domain/types";
import { BybitV5Client } from "./bybit/bybitV5Client";
import { BybitV5AdapterImpl } from "./bybit/bybitV5AdapterImpl";

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));

const audit = new AuditLog();
const idem = new IdempotencyStore(10 * 60_000);
const wsHealth = new WsHealth();

const symbols: Symbol[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "ADAUSDT",
  "XRPUSDT",
  "XMRUSDT",
  "DOGEUSDT",
  "LINKUSDT",
  "MELANIAUSDT",
  "XPLUSDT",
  "HYPEUSDT",
  "FARTCOINUSDT",
];

const v5 = new BybitV5Client({
  env: (process.env.BYBIT_ENV as any) ?? "mainnet",
  apiKey: process.env.BYBIT_API_KEY ?? "",
  apiSecret: process.env.BYBIT_API_SECRET ?? "",
  audit,
  health: wsHealth,
});

v5.startPrivateStreams();
v5.startMarketStreams(symbols);

const bybit = new BybitV5AdapterImpl(v5);

let state: ExecutionState = {
  ts: Date.now(),
  status: "IDLE",
  orders: [],
  position: { symbol: "BTCUSDT", side: "FLAT", size: 0 },
  ws: { market: "DOWN", private: "DOWN" },
};

const setState = (s: ExecutionState) => (state = s);

const ctx = {
  bybit,
  audit,
  idem,
  get state() {
    return state;
  },
  setState,
  isMarketStale: () => wsHealth.isMarketStale(3000),
  isPrivateStale: () => wsHealth.isPrivateStale(3000),
};

app.use(
  "/api",
  (_req, _res, next) => {
    state = {
      ...state,
      ws: {
        market: ctx.isMarketStale() ? "STALE" : "UP",
        private: ctx.isPrivateStale() ? "STALE" : "UP",
        lastMarketTs: wsHealth.lastMarketTs || undefined,
        lastPrivateTs: wsHealth.lastPrivateTs || undefined,
      },
    };
    next();
  },
  makeRoutes(ctx)
);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API on :${port}`));

// Reconcile loop
setInterval(async () => {
  try {
    idem.sweep();
    for (const sym of symbols) {
      await reconcile(bybit as any, audit, state, setState, sym);
    }
  } catch (e) {
    audit.write("reconcile_error", { e: String(e) });
  }
}, 2000);
