import { placeLimitWithProtection } from "./bybitAdapterV2.js";
const BETA_BUCKET = new Set(["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
const LOSS_STREAK_SYMBOL_COOLDOWN_MS = 0;
const LOSS_STREAK_RISK_USD = 2;
export class V2Runtime {
    cfg;
    state = "SCAN";
    killSwitch = false;
    safeMode = false;
    logs = [];
    ordersTimestamps = [];
    openPositions = [];
    lossStreak = 0;
    symbolLossStreak = {};
    symbolCooldownUntil = {};
    riskCutActive = false;
    allowedTransitions = {
        SCAN: ["PLACE", "SCAN"],
        PLACE: ["MANAGE", "EXIT", "SCAN"],
        MANAGE: ["EXIT", "MANAGE"],
        EXIT: ["SCAN"],
    };
    constructor(cfg) {
        this.cfg = cfg;
    }
    log(event, data) {
        this.logs.unshift({ ts: new Date().toISOString(), event, data });
        this.logs = this.logs.slice(0, 200);
    }
    enforceState(expected) {
        const arr = Array.isArray(expected) ? expected : [expected];
        if (!arr.includes(this.state)) {
            throw new Error(`Invalid transition: state ${this.state} expected ${arr.join(",")}`);
        }
    }
    transition(next) {
        if (!this.allowedTransitions[this.state].includes(next)) {
            throw new Error(`Forbidden transition ${this.state} -> ${next}`);
        }
        this.state = next;
    }
    throttleOrders() {
        const now = Date.now();
        this.ordersTimestamps = this.ordersTimestamps.filter((t) => now - t <= 60_000);
        if (this.ordersTimestamps.length >= this.cfg.maxOrdersPerMin) {
            throw new Error("Max orders per minute exceeded");
        }
        this.ordersTimestamps.push(now);
    }
    openRisk() {
        return this.openPositions.reduce((sum, p) => sum + Math.abs(p.entry - p.stop) * p.qty, 0);
    }
    riskCheck(signal, stop, snapshot) {
        const now = Date.now();
        const cooldownUntil = this.symbolCooldownUntil[signal.symbol] ?? 0;
        if (now < cooldownUntil)
            throw new Error(`Symbol cooldown active (${Math.round((cooldownUntil - now) / 60000)}m)`);
        const openRisk = this.openRisk();
        let riskBudget = Math.min(snapshot.riskPerTradeUsd ?? 4, snapshot.maxAllowedRiskUsd - openRisk);
        if (this.riskCutActive) {
            riskBudget = Math.min(riskBudget, LOSS_STREAK_RISK_USD);
        }
        const sameSideBucket = BETA_BUCKET.has(signal.symbol) &&
            this.openPositions.some((p) => BETA_BUCKET.has(p.symbol) && p.side === signal.direction);
        if (sameSideBucket)
            riskBudget *= 0.5;
        if (riskBudget <= 0)
            throw new Error("Risk budget exhausted");
        const dist = Math.abs(signal.entryZone.low - stop);
        if (dist <= 0)
            throw new Error("Invalid stop distance");
        let qty = riskBudget / dist;
        qty = Math.floor(qty / this.cfg.lotStep) * this.cfg.lotStep;
        if (qty < this.cfg.minQty)
            throw new Error("Qty below minimum");
        const riskValue = dist * qty;
        const fees = signal.entryZone.low * qty * this.cfg.feeRate;
        const slippage = this.cfg.slippageBuffer;
        if (riskValue <= fees + slippage)
            throw new Error("1R insufficient vs fees+slippage");
        if (this.openPositions.length >= snapshot.maxPositions)
            throw new Error("Max positions reached");
        return { qty, riskValue, fees, slippage };
    }
    requestPlace(signal, snapshot, feeModel, stop) {
        this.enforceState("SCAN");
        if (this.killSwitch || this.safeMode)
            throw new Error("SAFE/KILL active");
        this.throttleOrders();
        const { qty } = this.riskCheck(signal, stop, snapshot);
        const dir = signal.direction === "long" ? "buy" : "sell";
        const entryPrice = signal.direction === "long" ? signal.entryZone.low : signal.entryZone.high;
        const plan = {
            symbol: signal.symbol,
            direction: dir,
            entryType: "limit",
            entryPrice,
            stopLoss: stop,
            takeProfits: [],
            size: qty,
            leverage: 1,
            timeInForce: "GTC",
            reduceOnly: false,
            clientOrderId: `v2-${Date.now()}`,
        };
        this.transition("PLACE");
        this.log("SIGNAL", { signal, feeModel, plan });
        this.logRisk(snapshot);
        return plan;
    }
    handleOrderAck(orderId) {
        this.enforceState("PLACE");
        this.log("ORDER_ACK", { orderId });
    }
    handleFill(orderId, symbol, side, entry, qty, stop) {
        this.enforceState(["PLACE", "MANAGE"]);
        this.openPositions.push({ symbol, side, entry, stop, qty, slActive: true });
        this.transition("MANAGE");
        this.log("FILL", { orderId, symbol, side, entry, qty, stop });
    }
    adjustStop(symbol, newStop) {
        const pos = this.openPositions.find((p) => p.symbol === symbol);
        if (!pos)
            throw new Error("Position not found");
        if (pos.side === "long" && newStop <= pos.stop)
            return;
        if (pos.side === "short" && newStop >= pos.stop)
            return;
        pos.stop = newStop;
        this.log("SL_MOVE", { symbol, newStop });
    }
    exitPosition(symbol) {
        this.enforceState("MANAGE");
        this.openPositions = this.openPositions.filter((p) => p.symbol !== symbol);
        this.state = this.openPositions.length ? "MANAGE" : "EXIT";
        this.log("EXIT", { symbol });
    }
    recordOutcome(symbol, pnl) {
        const win = pnl > 0;
        if (win) {
            this.lossStreak = 0;
            this.symbolLossStreak[symbol] = 0;
            return;
        }
        this.lossStreak += 1;
        this.symbolLossStreak[symbol] = (this.symbolLossStreak[symbol] ?? 0) + 1;
        if (this.symbolLossStreak[symbol] === 2 && LOSS_STREAK_SYMBOL_COOLDOWN_MS > 0) {
            this.symbolCooldownUntil[symbol] = Date.now() + LOSS_STREAK_SYMBOL_COOLDOWN_MS;
            this.log("COOLDOWN", { symbol, mins: Math.round(LOSS_STREAK_SYMBOL_COOLDOWN_MS / 60000) });
        }
        if (this.lossStreak >= 3 && !this.riskCutActive) {
            this.riskCutActive = true;
            this.log("RISK_CUT", { riskUsd: LOSS_STREAK_RISK_USD });
        }
    }
    reconcile(positions) {
        this.openPositions = positions;
        this.log("RECONCILE", { count: positions.length });
    }
    setKillSwitch(on) {
        this.killSwitch = on;
        this.log("KILL", { on });
    }
    setSafeMode(on) {
        this.safeMode = on;
        this.log("SAFE_MODE", { on });
    }
    async placeWithAdapter(client, signal, snapshot, stop) {
        const plan = this.requestPlace(signal, snapshot, "taker", stop);
        const res = await placeLimitWithProtection({
            client,
            symbol: plan.symbol,
            side: plan.direction === "buy" ? "Buy" : "Sell",
            price: plan.entryPrice,
            qty: plan.size,
            stopLoss: plan.stopLoss,
            idempotencyKey: plan.clientOrderId,
        });
        this.handleOrderAck(res.orderId);
        this.handleFill(res.orderId, plan.symbol, plan.direction === "buy" ? "long" : "short", res.avgPrice ?? plan.entryPrice, plan.size, plan.stopLoss);
        return res;
    }
    logRisk(snapshot) {
        this.log("RISK_SNAPSHOT", {
            balance: snapshot.balance,
            riskPerTradeUsd: snapshot.riskPerTradeUsd,
            totalOpenRiskUsd: snapshot.totalOpenRiskUsd,
            maxAllowedRiskUsd: snapshot.maxAllowedRiskUsd,
            maxPositions: snapshot.maxPositions,
        });
    }
}
