import {
  EngineDecision,
  EngineSignal,
  State,
  Trend,
  resampleCandles,
  type Candle,
} from "./botEngine";
import { computeRsi } from "./ta";

type Swing = {
  index: number;
  time: number;
  type: "high" | "low";
  high: number;
  low: number;
  bodyHigh: number;
  bodyLow: number;
  close: number;
};

type TrendLabel = "BULL" | "BEAR" | "RANGE";

type TrendInfo = {
  trend: TrendLabel;
  reason: string;
  strong: boolean;
  swings: Swing[];
  impulse?: { start: Swing; end: Swing; range: number; mid: number };
  correction?: { end: Swing; retrace: number };
};

type RangeInfo = {
  ok: boolean;
  high: number;
  low: number;
  mid: number;
  lookback: number;
  touchesHigh: number;
  touchesLow: number;
};

export type AiMaticXContext = {
  htfTrend: TrendLabel;
  ltfTrend: TrendLabel;
  mode: "TREND" | "RANGE" | "CHAOS";
  setup:
    | "TREND_PULLBACK"
    | "TREND_CONTINUATION"
    | "RANGE_FADE"
    | "RANGE_BREAK_FLIP"
    | "REVERSAL"
    | "NO_TRADE";
  strongTrendExpanse: boolean;
  riskOff: boolean;
  acceptanceCloses: number;
  details: string[];
};

const OVERLAP_BODY_PCT = 0.002;
const SIMILAR_HILO_PCT = 0.003;
const IMPULSE_LOOKBACK = 20;
const IMPULSE_MULT = 1.2;
const STRONG_IMPULSE_MULT = 1.5;
const RETRACE_MAX = 0.6;
const RANGE_LOOKBACK_BASE = 30;
const RANGE_LOOKBACK_MIN = 20;
const RANGE_LOOKBACK_MAX = 50;
const RANGE_TOUCHES_MIN = 2;
const TRAIL_OFFSET_BASE = 0.002;
const TRAIL_OFFSET_STRONG = 0.0025;
const BREAK_ACCEPT_BPS = 0.0003;

function candleBody(c: Candle) {
  const bodyHigh = Math.max(c.open, c.close);
  const bodyLow = Math.min(c.open, c.close);
  return { bodyHigh, bodyLow };
}

function isBodyOverlap(
  close: number,
  prevBodyLow: number,
  prevBodyHigh: number,
  thresholdPct = OVERLAP_BODY_PCT
) {
  if (!Number.isFinite(close)) return false;
  if (close >= prevBodyLow && close <= prevBodyHigh) return true;
  if (close < prevBodyLow) {
    return (prevBodyLow - close) / close <= thresholdPct;
  }
  return (close - prevBodyHigh) / close <= thresholdPct;
}

function averageRange(candles: Candle[], lookback: number): number {
  const slice = candles.slice(-lookback);
  if (!slice.length) return Number.NaN;
  const sum = slice.reduce((acc, c) => acc + (c.high - c.low), 0);
  return sum / slice.length;
}

function median(values: number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function medianRange(candles: Candle[], lookback: number): number {
  const slice = candles.slice(-lookback);
  if (!slice.length) return Number.NaN;
  return median(slice.map((c) => c.high - c.low));
}

function findSwings(candles: Candle[], left: number, right: number): Swing[] {
  const swings: Swing[] = [];
  for (let i = left; i < candles.length - right; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= left; j++) {
      if (candles[i - j].high >= c.high) isHigh = false;
      if (candles[i - j].low <= c.low) isLow = false;
    }
    for (let j = 1; j <= right; j++) {
      if (candles[i + j].high > c.high) isHigh = false;
      if (candles[i + j].low < c.low) isLow = false;
    }
    if (!isHigh && !isLow) continue;
    const { bodyHigh, bodyLow } = candleBody(c);
    swings.push({
      index: i,
      time: c.openTime ?? c.timestamp ?? Date.now(),
      type: isHigh ? "high" : "low",
      high: c.high,
      low: c.low,
      bodyHigh,
      bodyLow,
      close: c.close,
    });
  }
  return swings;
}

function lastAlternating(swings: Swing[], count: number): Swing[] | null {
  const out: Swing[] = [];
  for (let i = swings.length - 1; i >= 0 && out.length < count; i--) {
    const s = swings[i];
    if (!out.length || out[out.length - 1].type !== s.type) {
      out.push(s);
    }
  }
  if (out.length < count) return null;
  return out.reverse();
}

function hasSimilarHighLow(
  candles: Candle[],
  minCount: number,
  maxCount: number,
  tolerancePct: number
) {
  const slice = candles.slice(-maxCount);
  if (slice.length < minCount) return false;
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const highMax = Math.max(...highs);
  const highMin = Math.min(...highs);
  const lowMax = Math.max(...lows);
  const lowMin = Math.min(...lows);
  const highOk = (highMax - highMin) / highMax <= tolerancePct;
  const lowOk = (lowMax - lowMin) / lowMax <= tolerancePct;
  return highOk || lowOk;
}

function overlapRatio(
  candles: Candle[],
  lookback: number,
  thresholdPct: number
) {
  const start = Math.max(1, candles.length - lookback);
  let overlapCount = 0;
  let total = 0;
  for (let i = start; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (!prev || !cur) continue;
    const prevBody = candleBody(prev);
    if (isBodyOverlap(cur.close, prevBody.bodyLow, prevBody.bodyHigh, thresholdPct)) {
      overlapCount += 1;
    }
    total += 1;
  }
  return total > 0 ? overlapCount / total : 1;
}

function resolveHtfTrend(candles: Candle[], swings: Swing[]): TrendInfo {
  const seq = lastAlternating(swings, 3);
  if (!seq) {
    return { trend: "RANGE", reason: "insufficient_swings", strong: false, swings };
  }
  const [a, b, c] = seq;
  const prevHigh = [...swings]
    .reverse()
    .find((s) => s.type === "high" && s.index < b.index);
  const prevLow = [...swings]
    .reverse()
    .find((s) => s.type === "low" && s.index < b.index);

  const recentOverlap =
    seq.length >= 3 &&
    seq.slice(1).filter((s, idx) => {
      const prev = seq[idx];
      return isBodyOverlap(s.close, prev.bodyLow, prev.bodyHigh, OVERLAP_BODY_PCT);
    }).length >= 2;

  const similarHilo = hasSimilarHighLow(candles, 3, 5, SIMILAR_HILO_PCT);

  if (a.type === "low" && b.type === "high" && c.type === "low" && prevLow && prevHigh) {
    const impulse = b.high - a.low;
    const correction = b.high - c.low;
    const mid = (a.low + b.high) / 2;
    const retrace = impulse > 0 ? correction / impulse : 1;
    const hh = b.high > prevHigh.high;
    const hl = c.low > prevLow.low;
    const rangeHit =
      retrace > 0.7 || c.low <= mid || recentOverlap || similarHilo;
    if (hh && hl && !rangeHit) {
      return {
        trend: "BULL",
        reason: "hh_hl",
        strong: swings.length >= 5,
        swings,
        impulse: { start: a, end: b, range: impulse, mid },
        correction: { end: c, retrace },
      };
    }
  }

  if (a.type === "high" && b.type === "low" && c.type === "high" && prevLow && prevHigh) {
    const impulse = a.high - b.low;
    const correction = c.high - b.low;
    const mid = (a.high + b.low) / 2;
    const retrace = impulse > 0 ? correction / impulse : 1;
    const ll = b.low < prevLow.low;
    const lh = c.high < prevHigh.high;
    const rangeHit =
      retrace > 0.7 || c.high >= mid || recentOverlap || similarHilo;
    if (ll && lh && !rangeHit) {
      return {
        trend: "BEAR",
        reason: "ll_lh",
        strong: swings.length >= 5,
        swings,
        impulse: { start: a, end: b, range: impulse, mid },
        correction: { end: c, retrace },
      };
    }
  }

  return { trend: "RANGE", reason: "overlap_or_range", strong: false, swings };
}

function resolveLtfTrend(
  candles: Candle[],
  swings: Swing[],
  htfTrend: TrendLabel
): TrendInfo {
  const seq = lastAlternating(swings, 3);
  if (!seq) {
    return { trend: "RANGE", reason: "insufficient_swings", strong: false, swings };
  }
  const [a, b, c] = seq;
  const avgRange = averageRange(candles, IMPULSE_LOOKBACK);
  const similarHilo = hasSimilarHighLow(candles, 3, 5, SIMILAR_HILO_PCT);

  if (a.type === "low" && b.type === "high" && c.type === "low") {
    const impulse = b.high - a.low;
    const correction = b.high - c.low;
    const mid = (a.low + b.high) / 2;
    const retrace = impulse > 0 ? correction / impulse : 1;
    const impulseBars = b.index - a.index;
    const impulseOk =
      Number.isFinite(avgRange) &&
      impulse >= avgRange * IMPULSE_MULT &&
      impulseBars >= 3;
    const hl = c.low > a.low;
    const midOk = c.low > mid;
    const rangeHit = similarHilo || retrace > RETRACE_MAX || !hl || !midOk;
    if (impulseOk && !rangeHit && htfTrend !== "RANGE") {
      return {
        trend: "BULL",
        reason: "impulse_pullback",
        strong: swings.length >= 5,
        swings,
        impulse: { start: a, end: b, range: impulse, mid },
        correction: { end: c, retrace },
      };
    }
  }

  if (a.type === "high" && b.type === "low" && c.type === "high") {
    const impulse = a.high - b.low;
    const correction = c.high - b.low;
    const mid = (a.high + b.low) / 2;
    const retrace = impulse > 0 ? correction / impulse : 1;
    const impulseBars = c.index - b.index;
    const impulseOk =
      Number.isFinite(avgRange) &&
      impulse >= avgRange * IMPULSE_MULT &&
      impulseBars >= 3;
    const lh = c.high < a.high;
    const midOk = c.high < mid;
    const rangeHit = similarHilo || retrace > RETRACE_MAX || !lh || !midOk;
    if (impulseOk && !rangeHit && htfTrend !== "RANGE") {
      return {
        trend: "BEAR",
        reason: "impulse_pullback",
        strong: swings.length >= 5,
        swings,
        impulse: { start: a, end: b, range: impulse, mid },
        correction: { end: c, retrace },
      };
    }
  }

  return { trend: "RANGE", reason: "overlap_or_range", strong: false, swings };
}

function resolveRangeInfo(candles: Candle[]): RangeInfo {
  const avgRange10 = averageRange(candles, 10);
  const avgRange20 = averageRange(candles, 20);
  let lookback = RANGE_LOOKBACK_BASE;
  if (Number.isFinite(avgRange10) && Number.isFinite(avgRange20)) {
    if (avgRange10 > avgRange20 * 1.2) lookback = RANGE_LOOKBACK_MIN;
    else if (avgRange10 < avgRange20 * 0.8) lookback = RANGE_LOOKBACK_MAX;
  }
  const slice = candles.slice(-lookback);
  if (slice.length < lookback / 2) {
    return { ok: false, high: Number.NaN, low: Number.NaN, mid: Number.NaN, lookback, touchesHigh: 0, touchesLow: 0 };
  }
  const high = Math.max(...slice.map((c) => c.high));
  const low = Math.min(...slice.map((c) => c.low));
  const mid = (high + low) / 2;
  const touchesHigh = slice.filter((c) => (high - c.high) / high <= SIMILAR_HILO_PCT).length;
  const touchesLow = slice.filter((c) => (c.low - low) / low <= SIMILAR_HILO_PCT).length;
  const ok = touchesHigh >= RANGE_TOUCHES_MIN && touchesLow >= RANGE_TOUCHES_MIN;
  return { ok, high, low, mid, lookback, touchesHigh, touchesLow };
}

function detectLowVol(candles: Candle[]): boolean {
  const avg = averageRange(candles, IMPULSE_LOOKBACK);
  const med = medianRange(candles, IMPULSE_LOOKBACK);
  if (!Number.isFinite(avg) || !Number.isFinite(med) || avg <= 0) return false;
  const noImpulse = candles
    .slice(-IMPULSE_LOOKBACK)
    .every((c) => c.high - c.low < avg * IMPULSE_MULT);
  const stable = med <= avg * 0.9;
  return noImpulse && stable;
}

function detectStrongTrendExpanse(candles: Candle[], swings: Swing[], dir: TrendLabel): boolean {
  if (dir === "RANGE") return false;
  const avgRange = averageRange(candles, IMPULSE_LOOKBACK);
  const recentImpulse = candles
    .slice(-IMPULSE_LOOKBACK)
    .some((c) => c.high - c.low >= avgRange * STRONG_IMPULSE_MULT);
  const minIndex = Math.max(0, candles.length - 12);
  const dirType = dir === "BULL" ? "high" : "low";
  let bosCount = 0;
  let lastSwing: Swing | null = null;
  for (const swing of swings) {
    if (swing.index < minIndex || swing.type !== dirType) continue;
    if (lastSwing) {
      const isBos = dir === "BULL" ? swing.high > lastSwing.high : swing.low < lastSwing.low;
      if (isBos) bosCount += 1;
    }
    lastSwing = swing;
  }
  const overlap = overlapRatio(candles, 10, OVERLAP_BODY_PCT);
  return recentImpulse && bosCount >= 2 && overlap <= 0.4;
}

function detectRiskOffByStructure(candles: Candle[]): boolean {
  const overlap = overlapRatio(candles, 10, OVERLAP_BODY_PCT);
  if (overlap > 0.7) return true;
  const avg = averageRange(candles, IMPULSE_LOOKBACK);
  if (Number.isFinite(avg)) {
    const noImpulse = candles
      .slice(-IMPULSE_LOOKBACK)
      .every((c) => c.high - c.low < avg * IMPULSE_MULT);
    if (noImpulse) return true;
  }
  const recent = candles.slice(-8);
  const avgRecent = averageRange(candles, IMPULSE_LOOKBACK);
  const impulseUp = recent.some(
    (c) => c.close > c.open && c.high - c.low >= avgRecent * IMPULSE_MULT
  );
  const impulseDown = recent.some(
    (c) => c.close < c.open && c.high - c.low >= avgRecent * IMPULSE_MULT
  );
  return impulseUp && impulseDown;
}

function buildTp(entry: number, stop: number, rr = 2): number {
  const r = Math.abs(entry - stop);
  if (!Number.isFinite(r) || r <= 0) return Number.NaN;
  return entry + (entry > stop ? 1 : -1) * rr * r;
}

function clampBps(value: number, minBps: number, maxBps: number) {
  return Math.min(Math.max(value, minBps), maxBps);
}

export function evaluateAiMaticXStrategyForSymbol(
  symbol: string,
  candles: Candle[]
): EngineDecision {
  const ltf = resampleCandles(candles, 5);
  const htf = resampleCandles(candles, 60);
  if (ltf.length < 30 || htf.length < 10) {
    return {
      state: State.Scan,
      trend: Trend.Range,
      trendH1: Trend.Range,
      trendScore: 0,
      trendAdx: Number.NaN,
      halted: true,
      xContext: {
        htfTrend: "RANGE",
        ltfTrend: "RANGE",
        mode: "CHAOS",
        setup: "NO_TRADE",
        strongTrendExpanse: false,
        riskOff: true,
        acceptanceCloses: 0,
        details: ["insufficient_data"],
      } satisfies AiMaticXContext,
    } as EngineDecision;
  }

  const htfSwings = findSwings(htf, 2, 2);
  const ltfSwings = findSwings(ltf, 1, 1);
  const htfTrend = resolveHtfTrend(htf, htfSwings);
  const ltfTrend = resolveLtfTrend(ltf, ltfSwings, htfTrend.trend);
  const rangeInfo = resolveRangeInfo(ltf);
  const lowVol = detectLowVol(ltf);
  const strongTrendExpanse = detectStrongTrendExpanse(ltf, ltfSwings, ltfTrend.trend);
  const riskOff = detectRiskOffByStructure(ltf);

  const details: string[] = [
    `1h ${htfTrend.trend}`,
    `5m ${ltfTrend.trend}`,
    rangeInfo.ok ? `range ${rangeInfo.lookback}` : "no range",
  ];

  let signal: EngineSignal | null = null;
  let setup: AiMaticXContext["setup"] = "NO_TRADE";
  let acceptanceCloses = 0;

  const last = ltf[ltf.length - 1];
  const prev = ltf[ltf.length - 2];
  const dir = htfTrend.trend === "BEAR" ? -1 : 1;
  const isBull = htfTrend.trend === "BULL";
  const isBear = htfTrend.trend === "BEAR";

  if (riskOff) {
    setup = "NO_TRADE";
  } else if ((isBull || isBear) && ltfTrend.trend === htfTrend.trend) {
    // #1 Trend Pullback
    if (ltfTrend.impulse && ltfTrend.correction) {
      const impulse = ltfTrend.impulse;
      const correction = ltfTrend.correction;
      const retraceOk = correction.retrace <= RETRACE_MAX;
      const confirm =
        (isBull && last.close > prev.high) ||
        (isBear && last.close < prev.low) ||
        (isBull && last.close > impulse.end.high) ||
        (isBear && last.close < impulse.end.low);
      if (retraceOk && confirm) {
        const targetNotional = impulse.start.low + (impulse.end.high - impulse.start.low) * 0.55;
        const entry = isBull
          ? Math.min(last.close, targetNotional)
          : Math.max(last.close, targetNotional);
        const stop = isBull ? correction.end.low : correction.end.high;
        const tp = buildTp(entry, stop, 2);
        if (Number.isFinite(tp)) {
          signal = {
            id: `${symbol}-${Date.now()}`,
            symbol,
            intent: {
              side: isBull ? "buy" : "sell",
              entry,
              sl: stop,
              tp,
            },
            kind: "PULLBACK",
            entryType: "LIMIT",
            risk: 0.8,
            message: `X1 Trend pullback ${htfTrend.trend} | retrace ${(correction.retrace * 100).toFixed(1)}%`,
            createdAt: new Date().toISOString(),
          };
          setup = "TREND_PULLBACK";
        }
      }
    }

    // #2 Trend Continuation / Break + Acceptance
    if (!signal && ltfSwings.length >= 2) {
      const level = isBull
        ? ltfSwings.filter((s) => s.type === "high").slice(-1)[0]?.high
        : ltfSwings.filter((s) => s.type === "low").slice(-1)[0]?.low;
      if (Number.isFinite(level ?? Number.NaN)) {
        const closes = ltf
          .slice(-3)
          .filter((c) => (isBull ? c.close > level : c.close < level));
        acceptanceCloses = closes.length;
        if (acceptanceCloses >= 1) {
          const offset = clampBps(BREAK_ACCEPT_BPS, 0.0002, 0.0005);
          const entry = isBull ? last.close * (1 + offset) : last.close * (1 - offset);
          const stop = isBull ? level * (1 - TRAIL_OFFSET_BASE) : level * (1 + TRAIL_OFFSET_BASE);
          const tp = buildTp(entry, stop, 2);
          if (Number.isFinite(tp)) {
            signal = {
              id: `${symbol}-${Date.now()}`,
              symbol,
              intent: {
                side: isBull ? "buy" : "sell",
                entry,
                sl: stop,
                tp,
              },
              kind: "BREAKOUT",
              entryType: "LIMIT",
              risk: 0.9,
              message: `X2 Break+Acceptance ${acceptanceCloses} close`,
              createdAt: new Date().toISOString(),
            };
            setup = "TREND_CONTINUATION";
          }
        }
      }
    }
  } else if (htfTrend.trend === "RANGE" && rangeInfo.ok) {
    const nearHigh = Math.abs(rangeInfo.high - last.high) / rangeInfo.high <= SIMILAR_HILO_PCT;
    const nearLow = Math.abs(last.low - rangeInfo.low) / rangeInfo.low <= SIMILAR_HILO_PCT;
    const rejectionHigh = nearHigh && last.close < rangeInfo.high;
    const rejectionLow = nearLow && last.close > rangeInfo.low;

    // #4 Range -> Trend (break & flip)
    if (
      (last.close > rangeInfo.high && prev.close > rangeInfo.high) ||
      (last.close < rangeInfo.low && prev.close < rangeInfo.low)
    ) {
      const bullBreak = last.close > rangeInfo.high;
      const retestOk = ltf.slice(-5).some((c) =>
        bullBreak ? c.low <= rangeInfo.high && c.close >= rangeInfo.high : c.high >= rangeInfo.low && c.close <= rangeInfo.low
      );
      if (retestOk) {
        const entry = last.close;
        const stop = bullBreak
          ? rangeInfo.high * (1 - TRAIL_OFFSET_BASE)
          : rangeInfo.low * (1 + TRAIL_OFFSET_BASE);
        const tp = buildTp(entry, stop, 2);
        if (Number.isFinite(tp)) {
          signal = {
            id: `${symbol}-${Date.now()}`,
            symbol,
            intent: {
              side: bullBreak ? "buy" : "sell",
              entry,
              sl: stop,
              tp,
            },
            kind: "BREAKOUT",
            entryType: "LIMIT",
            risk: 0.8,
            message: "X4 Range->Trend break+retest",
            createdAt: new Date().toISOString(),
          };
          setup = "RANGE_BREAK_FLIP";
        }
      }
    }

    // #3 Range Fade
    if (!signal && (rejectionHigh || rejectionLow)) {
      const entry = last.close;
      const stop = rejectionHigh
        ? rangeInfo.high * (1 + TRAIL_OFFSET_BASE)
        : rangeInfo.low * (1 - TRAIL_OFFSET_BASE);
      const midTp = rangeInfo.mid;
      const edgeTp = rejectionHigh ? rangeInfo.low : rangeInfo.high;
      const r = Math.abs(entry - stop);
      const tpCandidate = Math.abs(edgeTp - entry) >= r ? edgeTp : midTp;
      signal = {
        id: `${symbol}-${Date.now()}`,
        symbol,
        intent: {
          side: rejectionHigh ? "sell" : "buy",
          entry,
          sl: stop,
          tp: tpCandidate,
        },
        kind: "MEAN_REVERSION",
        entryType: lowVol ? "LIMIT_MAKER_FIRST" : "LIMIT",
        risk: 0.5,
        message: "X3 Range fade",
        createdAt: new Date().toISOString(),
      };
      setup = "RANGE_FADE";
    }
  }

  // #5 Reversal (limited)
  if (!signal) {
    const rsi = computeRsi(ltf.map((c) => c.close), 14);
    const lastIdx = ltf.length - 1;
    const highs = ltfSwings.filter((s) => s.type === "high");
    const lows = ltfSwings.filter((s) => s.type === "low");
    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    const bearishDiv =
      lastHigh &&
      prevHigh &&
      lastHigh.high > prevHigh.high &&
      rsi[lastHigh.index] < rsi[prevHigh.index];
    const bullishDiv =
      lastLow &&
      prevLow &&
      lastLow.low < prevLow.low &&
      rsi[lastLow.index] > rsi[prevLow.index];
    const chochBear = lastHigh && last.close < lastHigh.low;
    const chochBull = lastLow && last.close > lastLow.high;
    if (bearishDiv && chochBear) {
      const entry = last.close;
      const stop = lastHigh.high * (1 + TRAIL_OFFSET_BASE);
      const tp = buildTp(entry, stop, 0.5);
      if (Number.isFinite(tp)) {
        signal = {
          id: `${symbol}-${Date.now()}`,
          symbol,
          intent: { side: "sell", entry, sl: stop, tp },
          kind: "MEAN_REVERSION",
          entryType: "LIMIT",
          risk: 0.25,
          message: "X5 Reversal bearish divergence",
          createdAt: new Date().toISOString(),
        };
        setup = "REVERSAL";
      }
    }
    if (!signal && bullishDiv && chochBull) {
      const entry = last.close;
      const stop = lastLow.low * (1 - TRAIL_OFFSET_BASE);
      const tp = buildTp(entry, stop, 0.5);
      if (Number.isFinite(tp)) {
        signal = {
          id: `${symbol}-${Date.now()}`,
          symbol,
          intent: { side: "buy", entry, sl: stop, tp },
          kind: "MEAN_REVERSION",
          entryType: "LIMIT",
          risk: 0.25,
          message: "X5 Reversal bullish divergence",
          createdAt: new Date().toISOString(),
        };
        setup = "REVERSAL";
      }
    }
  }

  const trend = htfTrend.trend === "BULL" ? Trend.Bull : htfTrend.trend === "BEAR" ? Trend.Bear : Trend.Range;
  const trendH1 = trend;
  const context: AiMaticXContext = {
    htfTrend: htfTrend.trend,
    ltfTrend: ltfTrend.trend,
    mode:
      riskOff || htfTrend.trend === "RANGE"
        ? "RANGE"
        : "TREND",
    setup,
    strongTrendExpanse,
    riskOff,
    acceptanceCloses,
    details,
  };

  return {
    state: State.Scan,
    trend,
    trendH1,
    trendScore: 0,
    trendAdx: Number.NaN,
    signal,
    halted: false,
    xContext: context,
    trailOffsetPct: strongTrendExpanse ? TRAIL_OFFSET_STRONG : TRAIL_OFFSET_BASE,
  } as EngineDecision;
}
