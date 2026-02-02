// src/engine/v2Contracts.ts
// Mechanické kontrakty pro strategii V2 „David Paul – 3 pravidla“

export type TrendDirection = "bull" | "bear" | "none";
export type TradeDirection = "long" | "short" | "none";
export type ExecDirection = "buy" | "sell";

export type SignalV2 = {
  symbol: string;
  direction: TradeDirection;
  htfTrend: TrendDirection;
  ltfPattern: string;
  entryZone: { high: number; low: number };
  invalidate: number;
  tags: string[];
  quality: number; // 0–1
  generatedAt: string;
  reason?: string;
};

export type OrderPlanV2 = {
  symbol: string;
  direction: ExecDirection;
  entryType: "limit" | "market";
  entryPrice: number;
  stopLoss: number;
  takeProfits: { price: number; sizePct: number }[];
  size: number;
  leverage: number;
  timeInForce: "GTC" | "IOC" | "FOK";
  reduceOnly: boolean;
  clientOrderId: string;
};

export type PositionStateV2 = {
  symbol: string;
  side: TradeDirection;
  entryPrice: number;
  size: number;
  stopLoss: number;
  takeProfits: { price: number; filledPct: number }[];
  trailing?: { active: boolean; trigger: number; offset: number };
  unrealizedPnl?: number;
  status: "open" | "closed";
  lastUpdate: string;
};

export type RiskSnapshotV2 = {
  balance: number;
  riskPerTradeUsd: number;
  totalOpenRiskUsd: number;
  maxAllowedRiskUsd: number;
  maxPositions: number;
  feeModel: "taker" | "maker";
  maxLeverage: number;
  minNotional: number;
  stopDistancePct: number;
};

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function createSignalV2(input: Partial<SignalV2>): SignalV2 {
  if (!input.symbol) throw new Error("symbol required");
  if (!input.entryZone || !isFiniteNumber(input.entryZone.high) || !isFiniteNumber(input.entryZone.low)) {
    throw new Error("entryZone required");
  }
  const dir = input.direction ?? "none";
  const htf = input.htfTrend ?? "none";
  const quality = input.quality ?? 0;
  return {
    symbol: input.symbol,
    direction: dir,
    htfTrend: htf,
    ltfPattern: input.ltfPattern ?? "",
    entryZone: input.entryZone,
    invalidate: input.invalidate ?? input.entryZone.low,
    tags: input.tags ?? [],
    quality,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    reason: input.reason,
  };
}

export function createOrderPlanV2(input: Partial<OrderPlanV2>): OrderPlanV2 {
  if (!input.symbol) throw new Error("symbol required");
  if (!input.direction) throw new Error("direction required");
  if (!isFiniteNumber(input.entryPrice)) throw new Error("entryPrice required");
  if (!isFiniteNumber(input.stopLoss)) throw new Error("stopLoss required");
  const tp = input.takeProfits ?? [];
  return {
    symbol: input.symbol,
    direction: input.direction,
    entryType: input.entryType ?? "limit",
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    takeProfits: tp,
    size: input.size ?? 0,
    leverage: input.leverage ?? 1,
    timeInForce: input.timeInForce ?? "GTC",
    reduceOnly: input.reduceOnly ?? false,
    clientOrderId: input.clientOrderId ?? `op-${Date.now()}`,
  };
}

export function createPositionStateV2(input: Partial<PositionStateV2>): PositionStateV2 {
  if (!input.symbol) throw new Error("symbol required");
  if (!input.side) throw new Error("side required");
  if (!isFiniteNumber(input.entryPrice)) throw new Error("entryPrice required");
  if (!isFiniteNumber(input.size)) throw new Error("size required");
  if (!isFiniteNumber(input.stopLoss)) throw new Error("stopLoss required");
  return {
    symbol: input.symbol,
    side: input.side,
    entryPrice: input.entryPrice,
    size: input.size,
    stopLoss: input.stopLoss,
    takeProfits: input.takeProfits ?? [],
    trailing: input.trailing,
    unrealizedPnl: input.unrealizedPnl ?? 0,
    status: input.status ?? "open",
    lastUpdate: input.lastUpdate ?? new Date().toISOString(),
  };
}

export function createRiskSnapshotV2(input: Partial<RiskSnapshotV2>): RiskSnapshotV2 {
  if (!isFiniteNumber(input.balance)) throw new Error("balance required");
  return {
    balance: input.balance,
    riskPerTradeUsd: input.riskPerTradeUsd ?? 4,
    totalOpenRiskUsd: input.totalOpenRiskUsd ?? 0,
    maxAllowedRiskUsd: input.maxAllowedRiskUsd ?? 8,
    maxPositions: input.maxPositions ?? 2,
    feeModel: input.feeModel ?? "taker",
    maxLeverage: input.maxLeverage ?? 100,
    minNotional: input.minNotional ?? 5,
    stopDistancePct: input.stopDistancePct ?? 0.015,
  };
}
