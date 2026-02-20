export type GuardResult = {
  ok: boolean;
  code: string;
  reason: string;
  ttlMs?: number;
};

type Side = "Buy" | "Sell" | "buy" | "sell" | "LONG" | "SHORT" | string;

function isShortSide(side: Side) {
  const value = String(side ?? "").trim().toLowerCase();
  return value === "sell" || value === "short";
}

function isLongSide(side: Side) {
  const value = String(side ?? "").trim().toLowerCase();
  return value === "buy" || value === "long";
}

export function treeTrendGate5m(input: {
  side: Side;
  price: number;
  ema200_5m: number;
  macdHist_5m: number;
  rsi14_5m: number;
  ttlMs?: number;
}): GuardResult {
  const ttlMs = Number.isFinite(input.ttlMs) ? Number(input.ttlMs) : 60_000;
  if (!isShortSide(input.side)) {
    return { ok: true, code: "OK", reason: "trend ok" };
  }
  const aboveEma200 =
    Number.isFinite(input.price) &&
    Number.isFinite(input.ema200_5m) &&
    input.price > input.ema200_5m;
  const macdBull = Number.isFinite(input.macdHist_5m) && input.macdHist_5m > 0;
  const rsiBull = Number.isFinite(input.rsi14_5m) && input.rsi14_5m >= 55;
  if (aboveEma200 || macdBull || rsiBull) {
    return {
      ok: false,
      code: "TREND_FILTER",
      reason: "short vs 5m uptrend",
      ttlMs,
    };
  }
  return { ok: true, code: "OK", reason: "trend ok" };
}

export function stopValidityGate(
  entry: number,
  stop: number,
  side: Side,
  minDist: number,
  ttlMs = 60_000
): GuardResult {
  const dist = Math.abs(entry - stop);
  const minDistance = Number.isFinite(minDist) && minDist > 0 ? minDist : 0;
  const correctSide =
    (isLongSide(side) && stop < entry) || (isShortSide(side) && stop > entry);
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(stop) ||
    !correctSide ||
    !Number.isFinite(dist) ||
    dist < minDistance
  ) {
    return { ok: false, code: "INVALID_SL", reason: "bad SL", ttlMs };
  }
  return { ok: true, code: "OK", reason: "SL ok" };
}

export function resolveOrderPriceFields(
  rawPrice: number,
  rawTriggerPrice: number
): {
  price: number | null;
  triggerPrice: number | null;
  shownPrice: number | null;
} {
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice : null;
  const triggerPrice =
    Number.isFinite(rawTriggerPrice) && rawTriggerPrice > 0
      ? rawTriggerPrice
      : null;
  const shownPrice = price ?? triggerPrice;
  return { price, triggerPrice, shownPrice };
}

export function resolveTrailingFields(input: {
  side: Side;
  trailingStop?: number;
  trailingStopDistance?: number;
  trailingStopPrice?: number;
  trailPrice?: number;
  highWatermark?: number;
  lowWatermark?: number;
}): {
  trailingDistance?: number;
  trailStopPrice?: number;
} {
  const trailingDistanceRaw = Number.isFinite(input.trailingStop)
    ? (input.trailingStop as number)
    : Number.isFinite(input.trailingStopDistance)
      ? (input.trailingStopDistance as number)
      : Number.NaN;
  const trailingDistance =
    Number.isFinite(trailingDistanceRaw) && trailingDistanceRaw > 0
      ? trailingDistanceRaw
      : undefined;
  const explicitStopPriceRaw = Number.isFinite(input.trailingStopPrice)
    ? (input.trailingStopPrice as number)
    : Number.isFinite(input.trailPrice)
      ? (input.trailPrice as number)
      : Number.NaN;
  const explicitStopPrice =
    Number.isFinite(explicitStopPriceRaw) && explicitStopPriceRaw > 0
      ? explicitStopPriceRaw
      : undefined;
  if (explicitStopPrice) {
    return { trailingDistance, trailStopPrice: explicitStopPrice };
  }
  if (!trailingDistance) {
    return { trailingDistance, trailStopPrice: undefined };
  }
  const isBuy = String(input.side ?? "").trim().toLowerCase() === "buy";
  const computed =
    isBuy &&
    Number.isFinite(input.highWatermark) &&
    (input.highWatermark as number) > 0
      ? (input.highWatermark as number) - trailingDistance
      : !isBuy &&
          Number.isFinite(input.lowWatermark) &&
          (input.lowWatermark as number) > 0
        ? (input.lowWatermark as number) + trailingDistance
        : Number.NaN;
  return {
    trailingDistance,
    trailStopPrice:
      Number.isFinite(computed) && computed > 0 ? computed : undefined,
  };
}
