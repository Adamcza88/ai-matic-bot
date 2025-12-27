// src/engine/profile2.ts
// Profile AI-MATIC-X orchestration (Profile 2)
import { V2Runtime } from "./v2Runtime";
import { createRiskSnapshotV2, createSignalV2 } from "./v2Contracts";
import { placeLimitWithProtection } from "./bybitAdapterV2";
export class Profile2Engine {
    client;
    guard;
    runtime;
    lastPriceBySymbol = {};
    lastClosedPnlFetchAt = 0;
    lastClosedPnlTs = 0;
    closedPnlSeen = new Set();
    constructor(client, guard) {
        this.client = client;
        this.guard = guard;
        this.runtime = new V2Runtime({
            maxOrdersPerMin: 5,
            slippageBuffer: 0.1,
            feeRate: 0.0012,
            lotStep: 0.001,
            minQty: 0.001,
        });
    }
    guardrails(s) {
        if (s.dataAgeMs > this.guard.maxDataAgeMs) {
            this.runtime.setSafeMode(true);
            return false;
        }
        if (s.book.spreadPct > this.guard.maxSpreadPct)
            return false;
        if (s.volatilityPct > this.guard.maxVolatilityPct)
            return false;
        return true;
    }
    computeOffset(book) {
        return Math.max(2 * book.tickSize, 0.05 * book.atr14_1m);
    }
    makerPrice(dir, book) {
        const off = this.computeOffset(book);
        if (dir === "LONG") {
            const p = Math.min(book.bestAsk - book.tickSize, book.bestBid + off);
            return Math.max(p, book.bestBid); // never cross below bid
        }
        const p = Math.max(book.bestBid + book.tickSize, book.bestAsk - off);
        return Math.min(p, book.bestAsk);
    }
    stopFromSwing(dir, snap) {
        const pad = Math.max(snap.book.tickSize, 0.02 * snap.book.atr14_1m);
        if (dir === "LONG")
            return snap.microSwing.low - pad;
        return snap.microSwing.high + pad;
    }
    tpFromEntry(dir, entry, stop) {
        const r = Math.abs(entry - stop);
        return dir === "LONG" ? entry + 1.4 * r : entry - 1.4 * r;
    }
    trailingTrigger(dir, snap, entry, stop) {
        const r = Math.abs(entry - stop);
        const phaseTight = (dir === "LONG" && snap.phase === "DISTRIBUTION") || (dir === "SHORT" && snap.phase === "ACCUMULATION");
        const activateAt = phaseTight ? 0.8 * r : 1.0 * r;
        const level = dir === "LONG" ? entry + 0.6 * r : entry - 0.6 * r;
        return { trigger: activateAt, level };
    }
    async refreshClosedPnl(now) {
        const fetcher = this.client.fetchClosedPnl;
        if (typeof fetcher !== "function")
            return false;
        if (now - this.lastClosedPnlFetchAt < 15000)
            return true;
        this.lastClosedPnlFetchAt = now;
        const startTime = this.lastClosedPnlTs > 0 ? this.lastClosedPnlTs - 60000 : now - 6 * 60 * 60_000;
        try {
            const res = await fetcher(startTime, now, 200);
            if (!res?.ok || !Array.isArray(res.list))
                return false;
            res.list.forEach((rec) => {
                const tsMs = Number(rec.execTime ?? 0);
                const pnl = Number(rec.closedPnl ?? 0);
                if (!Number.isFinite(tsMs) || !Number.isFinite(pnl))
                    return;
                this.lastClosedPnlTs = Math.max(this.lastClosedPnlTs, tsMs);
                const key = `${rec.symbol}-${tsMs}-${pnl}`;
                if (this.closedPnlSeen.has(key))
                    return;
                this.closedPnlSeen.add(key);
                this.runtime.recordOutcome(rec.symbol, pnl);
            });
            if (this.closedPnlSeen.size > 1500) {
                this.closedPnlSeen = new Set(Array.from(this.closedPnlSeen).slice(-1000));
            }
            return true;
        }
        catch (_a) {
            return false;
        }
    }
    async process(snap, decision, openPositions, riskTotals) {
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
        if (!this.guardrails(snap))
            return null;
        if (decision.bias === "NO_TRADE" || !decision.entryValid)
            return null;
        if (openPositions.length >= 2)
            return null;
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
        const plan = this.runtime.requestPlace(signal, snapshot, "taker", stop);
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
