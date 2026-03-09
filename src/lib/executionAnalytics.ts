import type { TestnetTrade } from "@/types";

export type LifecycleStage =
  | "ENTRY"
  | "PARTIAL"
  | "EXIT"
  | "REDUCE"
  | "REVERSE"
  | "UNKNOWN";

export type AnalyzedFill = TestnetTrade & {
  lifecycle: LifecycleStage;
  realizedPnlDelta: number;
  cumulativeRealizedPnl: number;
  netPositionAfter: number;
  feePaid: number;
};

export type FillSequence = {
  key: string;
  symbol: string;
  secondBucketMs: number;
  price: number;
  fillCount: number;
  totalQty: number;
  avgFillSize: number;
  targetPositionSize: number;
  totalFee: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  slippageBps: number;
};

export type ChurnCluster = FillSequence;

export type SymbolExecutionAudit = {
  symbol: string;
  trades: number;
  totalFee: number;
  feePerTrade: number;
  netResult: number;
  entryCount: number;
  partialCount: number;
  exitCount: number;
  reduceCount: number;
  reverseCount: number;
  unknownCount: number;
};

export type ExecutionHeatBucket = {
  minuteBucketMs: number;
  label: string;
  tradeCount: number;
  intensity: number;
};

export type ExecutionModuleDiagnostic = {
  symbol: string;
  fillCount: number;
  burstCount: number;
  avgBurstFillCount: number;
  avgLatencyMs: number;
  avgSlippageBps: number;
  maxBurstFillCount: number;
};

export type ExecutionAnalytics = {
  fills: AnalyzedFill[];
  feeRows: SymbolExecutionAudit[];
  auditRows: SymbolExecutionAudit[];
  sliceSequences: FillSequence[];
  churnClusters: ChurnCluster[];
  heatmap: ExecutionHeatBucket[];
  diagnosticsRows: ExecutionModuleDiagnostic[];
  totals: {
    trades: number;
    totalFee: number;
    netResult: number;
  };
};

type TradeWithMeta = {
  trade: TestnetTrade;
  index: number;
  symbol: string;
  sideSign: 1 | -1;
  qty: number;
  price: number;
  fee: number;
  timeMs: number;
  key: string;
};

type PositionState = {
  positionQty: number;
  avgEntryPrice: number;
  cumulativeRealized: number;
};

type LifecycleCounter = Record<LifecycleStage, number>;

const EMPTY_COUNTER: LifecycleCounter = {
  ENTRY: 0,
  PARTIAL: 0,
  EXIT: 0,
  REDUCE: 0,
  REVERSE: 0,
  UNKNOWN: 0,
};

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function normalizeSymbol(value: string) {
  const symbol = String(value ?? "").trim().toUpperCase();
  return symbol || "UNKNOWN";
}

function toEpochMs(trade: TestnetTrade) {
  if (Number.isFinite(trade.execTimeMs)) return Number(trade.execTimeMs);
  const parsed = Date.parse(String(trade.time ?? ""));
  if (Number.isFinite(parsed)) return parsed;
  return Number.NaN;
}

function makeTradeKey(trade: TestnetTrade, index: number) {
  const id = String(trade.id ?? "").trim();
  const tradeId = String(trade.tradeId ?? "").trim();
  const orderId = String(trade.orderId ?? "").trim();
  const time = String(trade.time ?? "").trim();
  return `${id || tradeId || orderId || "fill"}:${time || "na"}:${index}`;
}

function sum(values: number[]) {
  return values.reduce((acc, value) => (Number.isFinite(value) ? acc + value : acc), 0);
}

function safeDivide(value: number, by: number) {
  if (!Number.isFinite(value) || !Number.isFinite(by) || by === 0) return Number.NaN;
  return value / by;
}

function inferLifecycle({
  trade,
  qty,
  sideSign,
  prevPosition,
  nextPosition,
}: {
  trade: TestnetTrade;
  qty: number;
  sideSign: 1 | -1;
  prevPosition: number;
  nextPosition: number;
}): LifecycleStage {
  if (!Number.isFinite(qty) || qty <= 0) return "UNKNOWN";
  if (!Number.isFinite(prevPosition) || !Number.isFinite(nextPosition)) return "UNKNOWN";

  if (Math.abs(prevPosition) < 1e-12) {
    if (trade.reduceOnly) return "REDUCE";
    return "ENTRY";
  }

  const prevSign = Math.sign(prevPosition);
  const nextSign = Math.sign(nextPosition);

  if (prevSign === sideSign) {
    if (trade.reduceOnly) return "REDUCE";
    return "ENTRY";
  }

  if (Math.abs(nextPosition) < 1e-12) return "EXIT";
  if (nextSign === prevSign) {
    if (trade.reduceOnly) return "REDUCE";
    return "PARTIAL";
  }
  if (nextSign === sideSign) return "REVERSE";
  return "UNKNOWN";
}

function toMinuteLabel(minuteBucketMs: number) {
  return new Date(minuteBucketMs).toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function computeExecutionAnalytics(trades: TestnetTrade[]): ExecutionAnalytics {
  const mapped: TradeWithMeta[] = trades.map((trade, index) => {
    const symbol = normalizeSymbol(trade.symbol);
    const sideSign =
      String(trade.side ?? "").toLowerCase() === "sell" ? -1 : 1;
    const qty = Math.abs(toNumber(trade.qty));
    const price = toNumber(trade.price);
    const feeRaw = toNumber(trade.fee);
    const fee = Number.isFinite(feeRaw) ? Math.abs(feeRaw) : 0;
    const timeMs = toEpochMs(trade);
    const key = makeTradeKey(trade, index);
    return {
      trade,
      index,
      symbol,
      sideSign,
      qty,
      price,
      fee,
      timeMs,
      key,
    };
  });

  const chronological = [...mapped].sort((a, b) => {
    const aValid = Number.isFinite(a.timeMs);
    const bValid = Number.isFinite(b.timeMs);
    if (aValid && bValid && a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    if (aValid && !bValid) return -1;
    if (!aValid && bValid) return 1;
    return a.index - b.index;
  });

  const stateBySymbol = new Map<string, PositionState>();
  const auditBySymbol = new Map<
    string,
    {
      trades: number;
      totalFee: number;
      netResult: number;
      lifecycle: LifecycleCounter;
    }
  >();
  const analyzedByKey = new Map<string, AnalyzedFill>();
  const minuteBuckets = new Map<number, number>();
  const sequenceBuckets = new Map<string, TradeWithMeta[]>();

  for (const row of chronological) {
    const symbolState = stateBySymbol.get(row.symbol) ?? {
      positionQty: 0,
      avgEntryPrice: 0,
      cumulativeRealized: 0,
    };
    const auditState = auditBySymbol.get(row.symbol) ?? {
      trades: 0,
      totalFee: 0,
      netResult: 0,
      lifecycle: { ...EMPTY_COUNTER },
    };

    const prevPosition = symbolState.positionQty;
    let nextPosition = prevPosition;
    let nextAvgEntry = symbolState.avgEntryPrice;
    let realizedDelta = Number.NaN;

    if (Number.isFinite(row.fee)) {
      realizedDelta = -row.fee;
    }

    if (Number.isFinite(row.qty) && row.qty > 0 && Number.isFinite(row.price) && row.price > 0) {
      if (Math.abs(prevPosition) < 1e-12) {
        nextPosition = row.sideSign * row.qty;
        nextAvgEntry = row.price;
      } else {
        const prevSign = Math.sign(prevPosition);
        if (prevSign === row.sideSign) {
          nextPosition = prevPosition + row.sideSign * row.qty;
          const prevAbs = Math.abs(prevPosition);
          const nextAbs = Math.abs(nextPosition);
          nextAvgEntry =
            nextAbs > 0
              ? (prevAbs * symbolState.avgEntryPrice + row.qty * row.price) / nextAbs
              : 0;
        } else {
          const closeQty = Math.min(Math.abs(prevPosition), row.qty);
          const closePnl =
            prevSign > 0
              ? (row.price - symbolState.avgEntryPrice) * closeQty
              : (symbolState.avgEntryPrice - row.price) * closeQty;
          realizedDelta = (Number.isFinite(realizedDelta) ? realizedDelta : 0) + closePnl;

          const remainingOpenQty = Math.abs(prevPosition) - closeQty;
          const remainingFillQty = row.qty - closeQty;
          if (remainingOpenQty > 0) {
            nextPosition = prevSign * remainingOpenQty;
            nextAvgEntry = symbolState.avgEntryPrice;
          } else if (remainingFillQty > 0) {
            nextPosition = row.sideSign * remainingFillQty;
            nextAvgEntry = row.price;
          } else {
            nextPosition = 0;
            nextAvgEntry = 0;
          }
        }
      }
    }

    const lifecycle = inferLifecycle({
      trade: row.trade,
      qty: row.qty,
      sideSign: row.sideSign,
      prevPosition,
      nextPosition,
    });

    const realizedDeltaSafe = Number.isFinite(realizedDelta) ? realizedDelta : Number.NaN;
    const nextCumulativeRealized =
      symbolState.cumulativeRealized + (Number.isFinite(realizedDeltaSafe) ? realizedDeltaSafe : 0);

    stateBySymbol.set(row.symbol, {
      positionQty: nextPosition,
      avgEntryPrice: nextAvgEntry,
      cumulativeRealized: nextCumulativeRealized,
    });

    auditState.trades += 1;
    if (Number.isFinite(row.fee)) auditState.totalFee += row.fee;
    if (Number.isFinite(realizedDeltaSafe)) auditState.netResult += realizedDeltaSafe;
    auditState.lifecycle[lifecycle] += 1;
    auditBySymbol.set(row.symbol, auditState);

    if (Number.isFinite(row.timeMs)) {
      const minuteBucket = Math.floor(row.timeMs / 60_000) * 60_000;
      minuteBuckets.set(minuteBucket, (minuteBuckets.get(minuteBucket) ?? 0) + 1);

      if (Number.isFinite(row.price) && row.price > 0) {
        const secondBucket = Math.floor(row.timeMs / 1000) * 1000;
        const sequenceKey = `${row.symbol}|${secondBucket}|${row.price.toFixed(8)}`;
        const bucket = sequenceBuckets.get(sequenceKey) ?? [];
        bucket.push(row);
        sequenceBuckets.set(sequenceKey, bucket);
      }
    }

    analyzedByKey.set(row.key, {
      ...row.trade,
      lifecycle,
      realizedPnlDelta: realizedDeltaSafe,
      cumulativeRealizedPnl: nextCumulativeRealized,
      netPositionAfter: nextPosition,
      feePaid: row.fee,
    });
  }

  const fills = mapped.map((row) => {
    const existing = analyzedByKey.get(row.key);
    if (existing) return existing;
    return {
      ...row.trade,
      lifecycle: "UNKNOWN" as LifecycleStage,
      realizedPnlDelta: Number.NaN,
      cumulativeRealizedPnl: Number.NaN,
      netPositionAfter: Number.NaN,
      feePaid: row.fee,
    } satisfies AnalyzedFill;
  });

  const sequenceRows: FillSequence[] = Array.from(sequenceBuckets.entries())
    .map(([key, bucket]) => {
      const sorted = [...bucket].sort((a, b) => a.timeMs - b.timeMs);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const totalQty = sum(sorted.map((row) => row.qty));
      const totalFee = sum(sorted.map((row) => row.fee));
      const fillCount = sorted.length;
      const startTimeMs = Number.isFinite(first?.timeMs) ? first.timeMs : Number.NaN;
      const endTimeMs = Number.isFinite(last?.timeMs) ? last.timeMs : Number.NaN;
      const durationMs =
        Number.isFinite(startTimeMs) && Number.isFinite(endTimeMs)
          ? Math.max(0, endTimeMs - startTimeMs)
          : Number.NaN;
      const basePrice = toNumber(first?.price);
      const slippageBps =
        Number.isFinite(basePrice) && basePrice > 0
          ? safeDivide(
              sum(
                sorted.map((row) =>
                  Math.abs(((row.price - basePrice) / basePrice) * 10_000)
                )
              ),
              fillCount
            )
          : Number.NaN;

      return {
        key,
        symbol: first?.symbol ?? "UNKNOWN",
        secondBucketMs: Number.isFinite(startTimeMs)
          ? Math.floor(startTimeMs / 1000) * 1000
          : Number.NaN,
        price: Number.isFinite(basePrice) ? basePrice : Number.NaN,
        fillCount,
        totalQty,
        avgFillSize: safeDivide(totalQty, fillCount),
        targetPositionSize: totalQty,
        totalFee,
        startTimeMs,
        endTimeMs,
        durationMs,
        slippageBps,
      } as FillSequence;
    })
    .sort((a, b) => {
      const aTs = Number.isFinite(a.secondBucketMs) ? a.secondBucketMs : 0;
      const bTs = Number.isFinite(b.secondBucketMs) ? b.secondBucketMs : 0;
      if (aTs !== bTs) return bTs - aTs;
      if (a.fillCount !== b.fillCount) return b.fillCount - a.fillCount;
      return a.symbol.localeCompare(b.symbol);
    });

  const churnClusters = sequenceRows.filter((row) => row.fillCount > 3);

  const heatRaw = Array.from(minuteBuckets.entries())
    .map(([minuteBucketMs, tradeCount]) => ({ minuteBucketMs, tradeCount }))
    .sort((a, b) => a.minuteBucketMs - b.minuteBucketMs);
  const maxHeat = Math.max(0, ...heatRaw.map((row) => row.tradeCount));
  const heatmap: ExecutionHeatBucket[] = heatRaw.map((row) => ({
    ...row,
    label: toMinuteLabel(row.minuteBucketMs),
    intensity: maxHeat > 0 ? row.tradeCount / maxHeat : 0,
  }));

  const feeRows: SymbolExecutionAudit[] = Array.from(auditBySymbol.entries())
    .map(([symbol, row]) => ({
      symbol,
      trades: row.trades,
      totalFee: row.totalFee,
      feePerTrade: safeDivide(row.totalFee, row.trades),
      netResult: row.netResult,
      entryCount: row.lifecycle.ENTRY,
      partialCount: row.lifecycle.PARTIAL,
      exitCount: row.lifecycle.EXIT,
      reduceCount: row.lifecycle.REDUCE,
      reverseCount: row.lifecycle.REVERSE,
      unknownCount: row.lifecycle.UNKNOWN,
    }))
    .sort((a, b) => {
      if (a.netResult !== b.netResult) return a.netResult - b.netResult;
      return a.symbol.localeCompare(b.symbol);
    });

  const burstRows = sequenceRows.filter((row) => row.fillCount > 1);
  const diagnosticsRows: ExecutionModuleDiagnostic[] = feeRows.map((feeRow) => {
    const symbolBursts = burstRows.filter((row) => row.symbol === feeRow.symbol);
    const latencySamples = symbolBursts
      .map((row) =>
        row.fillCount > 1 && Number.isFinite(row.durationMs)
          ? row.durationMs / (row.fillCount - 1)
          : Number.NaN
      )
      .filter((value) => Number.isFinite(value));
    const slippageSamples = symbolBursts
      .map((row) => row.slippageBps)
      .filter((value) => Number.isFinite(value));
    return {
      symbol: feeRow.symbol,
      fillCount: feeRow.trades,
      burstCount: symbolBursts.length,
      avgBurstFillCount: safeDivide(
        sum(symbolBursts.map((row) => row.fillCount)),
        symbolBursts.length
      ),
      avgLatencyMs: safeDivide(sum(latencySamples), latencySamples.length),
      avgSlippageBps: safeDivide(sum(slippageSamples), slippageSamples.length),
      maxBurstFillCount: symbolBursts.length
        ? Math.max(...symbolBursts.map((row) => row.fillCount))
        : 0,
    };
  });

  const totals = {
    trades: feeRows.reduce((acc, row) => acc + row.trades, 0),
    totalFee: sum(feeRows.map((row) => row.totalFee)),
    netResult: sum(feeRows.map((row) => row.netResult)),
  };

  return {
    fills,
    feeRows,
    auditRows: feeRows,
    sliceSequences: sequenceRows,
    churnClusters,
    heatmap,
    diagnosticsRows,
    totals,
  };
}
