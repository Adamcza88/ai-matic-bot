// src/engine/v2Runtime.ts
import { OrderPlanV2, RiskSnapshotV2, SignalV2, TradeDirection } from "./v2Contracts";
import { placeLimitWithProtection, BybitClient, PlaceOrderResult } from "./bybitAdapterV2.js";

type State = "SCAN" | "PLACE" | "MANAGE" | "EXIT";
type FeeModel = "maker" | "taker";

type RuntimeConfig = {
  maxOrdersPerMin: number;
  slippageBuffer: number;
  feeRate: number; // round-trip %
  lotStep: number;
  minQty: number;
};

type RuntimeLog = { ts: string; event: string; data?: Record<string, unknown> };

type Position = {
  symbol: string;
  side: TradeDirection;
  entry: number;
  stop: number;
  qty: number;
  slActive: boolean;
};

export class V2Runtime {
  state: State = "SCAN";
  killSwitch = false;
  safeMode = false;
  logs: RuntimeLog[] = [];
  ordersTimestamps: number[] = [];
  openPositions: Position[] = [];
  allowedTransitions: Record<State, State[]> = {
    SCAN: ["PLACE", "SCAN"],
    PLACE: ["MANAGE", "EXIT", "SCAN"],
    MANAGE: ["EXIT", "MANAGE"],
    EXIT: ["SCAN"],
  };

  constructor(private cfg: RuntimeConfig) {}

  private log(event: string, data?: Record<string, unknown>) {
    this.logs.unshift({ ts: new Date().toISOString(), event, data });
    this.logs = this.logs.slice(0, 200);
  }

  private enforceState(expected: State | State[]) {
    const arr = Array.isArray(expected) ? expected : [expected];
    if (!arr.includes(this.state)) {
      throw new Error(`Invalid transition: state ${this.state} expected ${arr.join(",")}`);
    }
  }

  private transition(next: State) {
    if (!this.allowedTransitions[this.state].includes(next)) {
      throw new Error(`Forbidden transition ${this.state} -> ${next}`);
    }
    this.state = next;
  }

  private throttleOrders() {
    const now = Date.now();
    this.ordersTimestamps = this.ordersTimestamps.filter((t) => now - t <= 60_000);
    if (this.ordersTimestamps.length >= this.cfg.maxOrdersPerMin) {
      throw new Error("Max orders per minute exceeded");
    }
    this.ordersTimestamps.push(now);
  }

  private openRisk(): number {
    return this.openPositions.reduce((sum, p) => sum + Math.abs(p.entry - p.stop) * p.qty, 0);
  }

  private riskCheck(signal: SignalV2, stop: number, snapshot: RiskSnapshotV2) {
    const riskBudget = Math.min(4, snapshot.maxAllowedRiskUsd - this.openRisk());
    if (riskBudget <= 0) throw new Error("Risk budget exhausted");
    const dist = Math.abs(signal.entryZone.low - stop);
    if (dist <= 0) throw new Error("Invalid stop distance");
    let qty = riskBudget / dist;
    qty = Math.floor(qty / this.cfg.lotStep) * this.cfg.lotStep;
    if (qty < this.cfg.minQty) throw new Error("Qty below minimum");
    const riskValue = dist * qty;
    const fees = signal.entryZone.low * qty * this.cfg.feeRate;
    const slippage = this.cfg.slippageBuffer;
    if (riskValue <= fees + slippage) throw new Error("1R insufficient vs fees+slippage");
    if (this.openPositions.length >= snapshot.maxPositions) throw new Error("Max positions reached");
    return { qty, riskValue, fees, slippage };
  }

  requestPlace(
    signal: SignalV2,
    snapshot: RiskSnapshotV2,
    feeModel: FeeModel,
    stop: number
  ): OrderPlanV2 {
    this.enforceState("SCAN");
    if (this.killSwitch || this.safeMode) throw new Error("SAFE/KILL active");
    this.throttleOrders();
    const { qty } = this.riskCheck(signal, stop, snapshot);
    const dir: "buy" | "sell" = signal.direction === "long" ? "buy" : "sell";
    const entryPrice =
      signal.direction === "long" ? signal.entryZone.low : signal.entryZone.high;
    const plan: OrderPlanV2 = {
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

  handleOrderAck(orderId: string) {
    this.enforceState("PLACE");
    this.log("ORDER_ACK", { orderId });
  }

  handleFill(orderId: string, symbol: string, side: TradeDirection, entry: number, qty: number, stop: number) {
    this.enforceState(["PLACE", "MANAGE"]);
    this.openPositions.push({ symbol, side, entry, stop, qty, slActive: true });
    this.transition("MANAGE");
    this.log("FILL", { orderId, symbol, side, entry, qty, stop });
  }

  adjustStop(symbol: string, newStop: number) {
    const pos = this.openPositions.find((p) => p.symbol === symbol);
    if (!pos) throw new Error("Position not found");
    if (pos.side === "long" && newStop <= pos.stop) return;
    if (pos.side === "short" && newStop >= pos.stop) return;
    pos.stop = newStop;
    this.log("SL_MOVE", { symbol, newStop });
  }

  exitPosition(symbol: string) {
    this.enforceState("MANAGE");
    this.openPositions = this.openPositions.filter((p) => p.symbol !== symbol);
    this.state = this.openPositions.length ? "MANAGE" : "EXIT";
    this.log("EXIT", { symbol });
  }

  reconcile(positions: Position[]) {
    this.openPositions = positions;
    this.log("RECONCILE", { count: positions.length });
  }

  setKillSwitch(on: boolean) {
    this.killSwitch = on;
    this.log("KILL", { on });
  }

  setSafeMode(on: boolean) {
    this.safeMode = on;
    this.log("SAFE_MODE", { on });
  }

  async placeWithAdapter(
    client: BybitClient,
    signal: SignalV2,
    snapshot: RiskSnapshotV2,
    stop: number
  ): Promise<PlaceOrderResult> {
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
    this.handleFill(
      res.orderId,
      plan.symbol,
      plan.direction === "buy" ? "long" : "short",
      res.avgPrice ?? plan.entryPrice,
      plan.size,
      plan.stopLoss
    );
    return res;
  }

  logRisk(snapshot: RiskSnapshotV2) {
    this.log("RISK_SNAPSHOT", {
      balance: snapshot.balance,
      riskPerTradeUsd: snapshot.riskPerTradeUsd,
      totalOpenRiskUsd: snapshot.totalOpenRiskUsd,
      maxAllowedRiskUsd: snapshot.maxAllowedRiskUsd,
      maxPositions: snapshot.maxPositions,
    });
  }
}
