// Execution router: maps strategy signals to concrete order instructions
// (Market vs Limit vs Stop-Limit) with TP/SL/trailing derived from profile.

export type StrategyProfile =
  | "ai-matic"
  | "ai-matic-x"
  | "ai-matic-scalp"
  | "ai-matic-tree";
export type Side = "Buy" | "Sell";
export type SignalKind = "BREAKOUT" | "PULLBACK" | "MOMENTUM" | "MEAN_REVERSION" | "OTHER";
export type ExecMode = "MARKET" | "LIMIT" | "STOP_LIMIT";

export interface EntrySignal {
  symbol: string;
  side: Side;
  kind: SignalKind;
  entry: number;
  stopLoss: number;
  takeProfit?: number;
  confidence?: number;
}

export interface MarketSnapshot {
  last: number;
  atrPct: number; // percent, e.g. 0.8 = 0.8%
  spreadBps?: number;
}

export interface ProfileConfig {
  tpR: number;
  trailLockR: number;
  trailActivateR: number;
  stopLimitBufferBps: number;
  marketDistanceBps: number;
  limitChaseMaxBps: number;
}

export const PROFILE: Record<StrategyProfile, ProfileConfig> = {
  "ai-matic-scalp": {
    tpR: 1.5,
    trailLockR: 0.4,
    trailActivateR: 1.2,
    stopLimitBufferBps: 6,
    marketDistanceBps: 10,
    limitChaseMaxBps: 25,
  },
  "ai-matic-x": {
    tpR: 1.5,
    trailLockR: 0.3,
    trailActivateR: 0.9,
    stopLimitBufferBps: 8,
    marketDistanceBps: 12,
    limitChaseMaxBps: 35,
  },
  "ai-matic": {
    tpR: 1.5,
    trailLockR: 0.3,
    trailActivateR: 0.9,
    stopLimitBufferBps: 12,
    marketDistanceBps: 18,
    limitChaseMaxBps: 70,
  },
  "ai-matic-tree": {
    tpR: 1.5,
    trailLockR: 0.3,
    trailActivateR: 0.9,
    stopLimitBufferBps: 12,
    marketDistanceBps: 18,
    limitChaseMaxBps: 70,
  },
};

const MIN_PROTECTION_DISTANCE_PCT = 0.5;
const TRAIL_ACTIVATION_R_MULTIPLIER = 0.3;

export interface TrailingPlan {
  activationPrice: number;
  lockedStopPrice: number;
}

export interface OrderPlan {
  symbol: string;
  side: Side;
  mode: ExecMode;
  qty: number;
  entryPrice?: number;
  triggerPrice?: number;
  limitPrice?: number;
  timeInForce: "GTC" | "IOC" | "FOK" | "PostOnly";
  stopLoss: number;
  takeProfit: number;
  trailing?: TrailingPlan;
  reason: string;
}

function bpsDistance(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(b, 1e-8) * 10_000;
}

function dir(side: Side): 1 | -1 {
  return side === "Buy" ? 1 : -1;
}

function resolveMinDistance(entry: number) {
  return entry * MIN_PROTECTION_DISTANCE_PCT;
}

function normalizeProtection(
  sig: EntrySignal,
  takeProfit: number
): { stopLoss: number; takeProfit: number; minDistance: number } {
  const minDistance = resolveMinDistance(sig.entry);
  let stopLoss = sig.stopLoss;
  let tp = takeProfit;
  if (sig.side === "Buy") {
    if (stopLoss >= sig.entry - minDistance) {
      stopLoss = sig.entry - minDistance;
    }
    if (tp <= sig.entry + minDistance) {
      tp = sig.entry + minDistance;
    }
  } else {
    if (stopLoss <= sig.entry + minDistance) {
      stopLoss = sig.entry + minDistance;
    }
    if (tp >= sig.entry - minDistance) {
      tp = sig.entry - minDistance;
    }
  }
  return { stopLoss, takeProfit: tp, minDistance };
}

export function buildTrailing(
  sig: EntrySignal,
  cfg: ProfileConfig,
  r: number,
  minDistance = 0
): TrailingPlan {
  const activationDelta = Math.max(
    cfg.trailActivateR * TRAIL_ACTIVATION_R_MULTIPLIER * r,
    minDistance
  );
  const activationPrice = sig.entry + dir(sig.side) * activationDelta;
  const lockedStopPrice = sig.entry + dir(sig.side) * cfg.trailLockR * r;
  return { activationPrice, lockedStopPrice };
}

export function decideExecutionPlan(
  sig: EntrySignal,
  market: MarketSnapshot,
  profile: StrategyProfile,
  qty: number
): OrderPlan {
  const cfg = PROFILE[profile];
  const rawR = Math.abs(sig.entry - sig.stopLoss);
  const computedTp = Number.isFinite(sig.takeProfit)
    ? (sig.takeProfit as number)
    : sig.entry + dir(sig.side) * cfg.tpR * rawR;
  const normalized = normalizeProtection(sig, computedTp);
  const r = Math.abs(sig.entry - normalized.stopLoss);
  const trailing = buildTrailing(
    { ...sig, stopLoss: normalized.stopLoss },
    cfg,
    r,
    normalized.minDistance
  );
  const distBps = bpsDistance(market.last, sig.entry);
  const spreadOk = market.spreadBps == null ? true : market.spreadBps <= 12;

  const marketPlan = (reason: string): OrderPlan => ({
    symbol: sig.symbol,
    side: sig.side,
    mode: "MARKET",
    qty,
    timeInForce: "IOC",
    stopLoss: normalized.stopLoss,
    takeProfit: normalized.takeProfit,
    trailing,
    reason,
  });

  const limitPlan = (reason: string, tif: OrderPlan["timeInForce"] = "GTC"): OrderPlan => ({
    symbol: sig.symbol,
    side: sig.side,
    mode: "LIMIT",
    qty,
    entryPrice: sig.entry,
    timeInForce: tif,
    stopLoss: normalized.stopLoss,
    takeProfit: normalized.takeProfit,
    trailing,
    reason,
  });

  const stopLimitPlan = (reason: string): OrderPlan => {
    const buffer = (cfg.stopLimitBufferBps / 10_000) * sig.entry;
    const limitPrice = sig.entry + dir(sig.side) * buffer;
    return {
      symbol: sig.symbol,
      side: sig.side,
      mode: "STOP_LIMIT",
      qty,
      triggerPrice: sig.entry,
      limitPrice,
      timeInForce: "GTC",
      stopLoss: normalized.stopLoss,
      takeProfit: normalized.takeProfit,
      trailing,
      reason,
    };
  };

  if (sig.kind === "PULLBACK" || sig.kind === "MEAN_REVERSION") {
    if (distBps <= cfg.marketDistanceBps && spreadOk) {
      return marketPlan(`MARKET: ${sig.kind} dist ${distBps.toFixed(1)}bps`);
    }
    return limitPlan(`LIMIT(PostOnly): ${sig.kind}`, "PostOnly");
  }

  if (sig.kind === "BREAKOUT") {
    if (distBps <= cfg.marketDistanceBps && spreadOk) {
      return marketPlan(`MARKET: BREAKOUT dist ${distBps.toFixed(1)}bps`);
    }
    return stopLimitPlan(`STOP_LIMIT: BREAKOUT trigger@entry buffer ${cfg.stopLimitBufferBps}bps`);
  }

  if (sig.kind === "MOMENTUM") {
    if (distBps <= cfg.marketDistanceBps && spreadOk) {
      return marketPlan(`MARKET: MOMENTUM dist ${distBps.toFixed(1)}bps`);
    }
    if (distBps <= cfg.limitChaseMaxBps) {
      return limitPlan(`LIMIT: MOMENTUM dist ${distBps.toFixed(1)}bps`);
    }
    return limitPlan(`LIMIT(PostOnly): MOMENTUM avoid chase (${distBps.toFixed(1)}bps)`, "PostOnly");
  }

  return limitPlan("DEFAULT: LIMIT(PostOnly)", "PostOnly");
}
