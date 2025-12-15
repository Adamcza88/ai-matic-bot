// src/engine/v2Contracts.ts
// Mechanické kontrakty pro strategii V2 „David Paul – 3 pravidla“
const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
export function createSignalV2(input) {
    if (!input.symbol)
        throw new Error("symbol required");
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
export function createOrderPlanV2(input) {
    if (!input.symbol)
        throw new Error("symbol required");
    if (!input.direction)
        throw new Error("direction required");
    if (!isFiniteNumber(input.entryPrice))
        throw new Error("entryPrice required");
    if (!isFiniteNumber(input.stopLoss))
        throw new Error("stopLoss required");
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
export function createPositionStateV2(input) {
    if (!input.symbol)
        throw new Error("symbol required");
    if (!input.side)
        throw new Error("side required");
    if (!isFiniteNumber(input.entryPrice))
        throw new Error("entryPrice required");
    if (!isFiniteNumber(input.size))
        throw new Error("size required");
    if (!isFiniteNumber(input.stopLoss))
        throw new Error("stopLoss required");
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
export function createRiskSnapshotV2(input) {
    if (!isFiniteNumber(input.balance))
        throw new Error("balance required");
    return {
        balance: input.balance,
        riskPerTradeUsd: input.riskPerTradeUsd ?? 4,
        totalOpenRiskUsd: input.totalOpenRiskUsd ?? 0,
        maxAllowedRiskUsd: input.maxAllowedRiskUsd ?? 8,
        maxPositions: input.maxPositions ?? 2,
        feeModel: input.feeModel ?? "taker",
        maxLeverage: input.maxLeverage ?? 100,
        minNotional: input.minNotional ?? 5,
        stopDistancePct: input.stopDistancePct ?? 0.0015,
    };
}
