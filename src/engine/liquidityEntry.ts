// src/engine/liquidityEntry.ts
// Liquidity entry a SL/offset logika (LIMIT, maker-first)

import { TradeDirection } from "./v2Contracts";
import { PullbackResult } from "./ltFPullback";

export type LiquidityPlan = {
  direction: TradeDirection;
  entry: number;
  stop: number;
  offset: number;
  valid: boolean;
  reason?: string;
  tags: string[];
};

export function computeOffset(tickSize: number, atr14?: number): number {
  const base = tickSize * 2;
  if (atr14 == null || !Number.isFinite(atr14)) return base;
  return Math.max(base, 0.05 * atr14);
}

export function buildLiquidityPlan(
  pullback: PullbackResult,
  tickSize: number,
  atr14?: number
): LiquidityPlan {
  const tags: string[] = [];
  const offset = computeOffset(tickSize, atr14);

  if (!pullback.valid || pullback.direction === "none") {
    return { direction: "none", entry: 0, stop: 0, offset, valid: false, reason: "PULLBACK_INVALID", tags };
  }

  if (pullback.direction === "long") {
    if (pullback.swingLow == null) {
      return { direction: "none", entry: 0, stop: 0, offset, valid: false, reason: "MISSING_SWING_LOW", tags };
    }
    const entry = pullback.swingLow - offset;
    const stop = pullback.swingLow - offset;
    tags.push("ENTRY_LONG");
    return { direction: "long", entry, stop, offset, valid: true, tags };
  }

  if (pullback.direction === "short") {
    if (pullback.swingHigh == null) {
      return { direction: "none", entry: 0, stop: 0, offset, valid: false, reason: "MISSING_SWING_HIGH", tags };
    }
    const entry = pullback.swingHigh + offset;
    const stop = pullback.swingHigh + offset;
    tags.push("ENTRY_SHORT");
    return { direction: "short", entry, stop, offset, valid: true, tags };
  }

  return { direction: "none", entry: 0, stop: 0, offset, valid: false, reason: "UNKNOWN_DIR", tags };
}
