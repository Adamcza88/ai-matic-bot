export class V2Runtime {
    cfg;
    state = "SCAN";
    killSwitch = false;
    safeMode = false;
    logs = [];
    ordersTimestamps = [];
    openPositions = [];
    constructor(cfg) {
        this.cfg = cfg;
    }
    log(event, data) {
        this.logs.unshift({ ts: new Date().toISOString(), event, data });
        this.logs = this.logs.slice(0, 200);
    }
    enforceState(expected) {
        if (this.state !== expected) {
            throw new Error(`Invalid transition: state ${this.state} expected ${expected}`);
        }
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
        const riskBudget = Math.min(4, snapshot.maxAllowedRiskUsd - this.openRisk());
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
        this.state = "PLACE";
        this.log("SIGNAL", { signal, feeModel, plan });
        return plan;
    }
    handleOrderAck(orderId) {
        this.enforceState("PLACE");
        this.log("ORDER_ACK", { orderId });
    }
    handleFill(orderId, symbol, side, entry, qty, stop) {
        this.enforceState("PLACE");
        this.openPositions.push({ symbol, side, entry, stop, qty, slActive: true });
        this.state = "MANAGE";
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
}
