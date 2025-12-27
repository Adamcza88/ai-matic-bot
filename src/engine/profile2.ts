// src/engine/profile2.ts
// Profile AI-MATIC-X orchestration (Profile 2)
import { V2Runtime } from "./v2Runtime";
import { createRiskSnapshotV2, createSignalV2, OrderPlanV2 } from "./v2Contracts";
import { placeLimitWithProtection, BybitClient } from "./bybitAdapterV2";

export type ExtendedOrderPlanV2 = OrderPlanV2 & {
  tp?: number;
  trailing?: {
    activate: number;
    level: number;
    step: number;
  };
};

export type PriceBook = {
  bestBid: number;
  bestAsk: number;
  tickSize: number;
  atr14_1m: number;
  spreadPct: number;
};

export type MicroSwing = { low: number; high: number };

export type MarketSnapshot = {
  symbol: string;
  price: number;
  timeMs: number;
  vwap: number;
  ema20: number;
  ema50: number;
  rvol: number;
  phase: "ACCUMULATION" | "DISTRIBUTION" | "NEUTRAL";
  book: PriceBook;
  microSwing: MicroSwing;
  dataAgeMs: number;
  volatilityPct: number;
};

export type BiasDecision = "LONG" | "SHORT" | "NO_TRADE";

export type EntryDecision = {
  bias: BiasDecision;
  entryValid: boolean;
};

export type GuardrailConfig = {
  maxSpreadPct: number;
  maxVolatilityPct: number;
  maxDataAgeMs: number;
};

export class Profile2Engine {
  private runtime: V2Runtime;
  private lastPriceBySymbol: Record<string, number> = {};
  private lastClosedPnlFetchAt = 0;
  private lastClosedPnlTs = 0;
  private closedPnlSeen = new Set<string>();
  constructor(private client: BybitClient, private guard: GuardrailConfig) {
    this.runtime = new V2Runtime({
      maxOrdersPerMin: 5,
      slippageBuffer: 0.1,
      feeRate: 0.0012,
      lotStep: 0.001,
      minQty: 0.001,
    });
  }

  private guardrails(s: MarketSnapshot): boolean {
    if (s.dataAgeMs > this.guard.maxDataAgeMs) {
      this.runtime.setSafeMode(true);
      return false;
    }
    if (s.book.spreadPct > this.guard.maxSpreadPct) return false;
    if (s.volatilityPct > this.guard.maxVolatilityPct) return false;
    return true;
  }

  private computeOffset(book: PriceBook) {
    return Math.max(2 * book.tickSize, 0.05 * book.atr14_1m);
  }

  private makerPrice(dir: BiasDecision, book: PriceBook): number {
    const off = this.computeOffset(book);
    if (dir === "LONG") {
      const p = Math.min(book.bestAsk - book.tickSize, book.bestBid + off);
      return Math.max(p, book.bestBid); // never cross below bid
    }
    const p = Math.max(book.bestBid + book.tickSize, book.bestAsk - off);
    return Math.min(p, book.bestAsk);
  }

  private stopFromSwing(dir: BiasDecision, snap: MarketSnapshot): number {
    const pad = Math.max(snap.book.tickSize, 0.02 * snap.book.atr14_1m);
    if (dir === "LONG") return snap.microSwing.low - pad;
    return snap.microSwing.high + pad;
  }

  private tpFromEntry(dir: BiasDecision, entry: number, stop: number): number {
    const r = Math.abs(entry - stop);
    return dir === "LONG" ? entry + 1.4 * r : entry - 1.4 * r;
  }

  private trailingTrigger(dir: BiasDecision, snap: MarketSnapshot, entry: number, stop: number): { trigger: number; level: number } {
    const r = Math.abs(entry - stop);
    const phaseTight = (dir === "LONG" && snap.phase === "DISTRIBUTION") || (dir === "SHORT" && snap.phase === "ACCUMULATION");
    const activateAt = phaseTight ? 0.8 * r : 1.0 * r;
    const level = dir === "LONG" ? entry + 0.6 * r : entry - 0.6 * r;
    return { trigger: activateAt, level };
  }

  private async refreshClosedPnl(now: number): Promise<boolean> {
    const fetcher = this.client.fetchClosedPnl;
    if (typeof fetcher !== "function") return false;
    if (now - this.lastClosedPnlFetchAt < 15_000) return true;
    this.lastClosedPnlFetchAt = now;
    const startTime = this.lastClosedPnlTs > 0 ? this.lastClosedPnlTs - 60_000 : now - 6 * 60 * 60_000;
    try {
      const res = await fetcher(startTime, now, 200);
      if (!res?.ok || !Array.isArray(res.list)) return false;
      res.list.forEach((rec) => {
        const tsMs = Number(rec.execTime ?? 0);
        const pnl = Number(rec.closedPnl ?? 0);
        if (!Number.isFinite(tsMs) || !Number.isFinite(pnl)) return;
        this.lastClosedPnlTs = Math.max(this.lastClosedPnlTs, tsMs);
        const key = `${rec.symbol}-${tsMs}-${pnl}`;
        if (this.closedPnlSeen.has(key)) return;
        this.closedPnlSeen.add(key);
        this.runtime.recordOutcome(rec.symbol, pnl);
      });
      if (this.closedPnlSeen.size > 1500) {
        this.closedPnlSeen = new Set(Array.from(this.closedPnlSeen).slice(-1000));
      }
      return true;
    } catch {
      return false;
    }
  }

  async process(
    snap: MarketSnapshot,
    decision: EntryDecision,
    openPositions: { symbol: string; side: "long" | "short"; entry: number; stop: number; qty: number }[],
    riskTotals: { totalOpenRiskUsd: number }
  ): Promise<OrderPlanV2 | null> {
    this.lastPriceBySymbol[snap.symbol] = snap.price;
    const now = Date.now();
    const closedPnlEnabled = await this.refreshClosedPnl(now);
    const prevPositions = [...this.runtime.openPositions];
    const nextPositions = openPositions.map((p) => ({
      symbol: p.symbol,
      side: p.side,
      entry: p.entry,
      stop: p.stop,
      qty: p.qty,
      slActive: true,
    }));
    const nextSymbols = new Set(nextPositions.map((p) => p.symbol));
    if (!closedPnlEnabled) {
      for (const prev of prevPositions) {
        if (!nextSymbols.has(prev.symbol)) {
          const lastPx = this.lastPriceBySymbol[prev.symbol];
          if (Number.isFinite(lastPx)) {
            const dir = prev.side === "long" ? 1 : -1;
            const pnl = (lastPx - prev.entry) * dir * prev.qty;
            this.runtime.recordOutcome(prev.symbol, pnl);
          }
        }
      }
    }
    this.runtime.reconcile(nextPositions);

    if (!this.guardrails(snap)) return null;
    if (decision.bias === "NO_TRADE" || !decision.entryValid) return null;
    if (openPositions.length >= 2) return null;

    const dir = decision.bias === "LONG" ? "long" : "short";
    const entryPrice = this.makerPrice(decision.bias, snap.book);
    const stop = this.stopFromSwing(decision.bias, snap);
    const tp = this.tpFromEntry(decision.bias, entryPrice, stop);
    const trail = this.trailingTrigger(decision.bias, snap, entryPrice, stop);

    const signal = createSignalV2({
      symbol: snap.symbol,
      direction: dir,
      htfTrend: "bull",
      entryZone: { high: entryPrice, low: entryPrice },
      invalidate: stop,
      tags: ["profile2"],
    });

    const snapshot = createRiskSnapshotV2({
      balance: 100,
      totalOpenRiskUsd: riskTotals.totalOpenRiskUsd,
      maxAllowedRiskUsd: 8,
      riskPerTradeUsd: 4,
      maxPositions: 2,
    });

    const plan = this.runtime.requestPlace(signal, snapshot, "taker", stop) as ExtendedOrderPlanV2;
    // attach TP/Trailing info for caller
    const r = Math.abs(entryPrice - stop);
    const trailCfg = { activate: trail.trigger, level: trail.level, step: 0.1 * r };
    plan.tp = tp;
    plan.trailing = trailCfg;

    // Execute via adapter
    await placeLimitWithProtection({
      client: this.client,
      symbol: plan.symbol,
      side: plan.direction === "buy" ? "Buy" : "Sell",
      price: plan.entryPrice,
      qty: plan.size,
      stopLoss: plan.stopLoss,
      idempotencyKey: plan.clientOrderId,
      timeoutMs: 3 * 60_000,
    });
    return plan;
  }
}
