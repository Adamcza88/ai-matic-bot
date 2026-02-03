import type { Candle, EngineDecision, EngineSignal } from "./botEngine";
import { computeATR } from "./botEngine";
import { findPivotsHigh, findPivotsLow } from "./ta";
import { computeMarketProfile } from "./marketProfile";
import { getOrderFlowSnapshot } from "./orderflow";
import { analyzeRegimePro } from "./regimePro";

type ProTargets = {
  t1: number;
  t2: number;
  timeStopMinutes: number;
  entryTfMin: number;
};

type ProState =
  | "RANGE_TRADING"
  | "MANIPULATION_WATCH"
  | "PRE_ENTRY"
  | "EXECUTION"
  | "MANAGEMENT";

const proStateBySymbol = new Map<string, ProState>();

function resolveFlowSignal(args: {
  ofi: number;
  ofiPrev: number;
  delta: number;
  deltaPrev: number;
  absorptionScore: number;
  lastClose: number;
  prevClose: number;
}) {
  const absorptionOk =
    Number.isFinite(args.absorptionScore) && args.absorptionScore >= 2;
  if (!absorptionOk) return "WAIT";
  const ofiUp = Number.isFinite(args.ofi) && args.ofi > 0;
  const ofiDown = Number.isFinite(args.ofi) && args.ofi < 0;
  const deltaUp = Number.isFinite(args.delta) && args.delta > 0;
  const deltaDown = Number.isFinite(args.delta) && args.delta < 0;
  const ofiFlipUp = ofiUp && args.ofiPrev <= 0;
  const ofiFlipDown = ofiDown && args.ofiPrev >= 0;
  const deltaFlipUp = deltaUp && args.deltaPrev <= 0;
  const deltaFlipDown = deltaDown && args.deltaPrev >= 0;
  const priceDownOrFlat =
    Number.isFinite(args.lastClose) &&
    Number.isFinite(args.prevClose) &&
    args.lastClose <= args.prevClose;
  const priceUpOrFlat =
    Number.isFinite(args.lastClose) &&
    Number.isFinite(args.prevClose) &&
    args.lastClose >= args.prevClose;

  if (ofiUp && deltaUp && (ofiFlipUp || deltaFlipUp) && priceDownOrFlat) {
    return "BUY";
  }
  if (ofiDown && deltaDown && (ofiFlipDown || deltaFlipDown) && priceUpOrFlat) {
    return "SELL";
  }
  return "WAIT";
}

function findNearestLVN(lvn: number[], entry: number, side: "Buy" | "Sell") {
  if (!lvn.length) return null;
  if (side === "Buy") {
    const below = lvn.filter((x) => x < entry);
    if (!below.length) return null;
    return Math.max(...below);
  }
  const above = lvn.filter((x) => x > entry);
  if (!above.length) return null;
  return Math.min(...above);
}

function resolveTimeframeMs(candles: Candle[]) {
  if (candles.length < 2) return 60_000;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const diff = Number(last.openTime) - Number(prev.openTime);
  return Number.isFinite(diff) && diff > 0 ? diff : 60_000;
}

function findLastPivot(
  candles: Candle[],
  side: "high" | "low",
  lookback = 30
) {
  const left = 3;
  const right = 3;
  const pivots =
    side === "high"
      ? findPivotsHigh(candles, left, right)
      : findPivotsLow(candles, left, right);
  const cutoff = Math.max(0, candles.length - lookback);
  const filtered = pivots.filter((p) => p.idx >= cutoff);
  return filtered.length ? filtered[filtered.length - 1] : null;
}

function detectFvgMid(candles: Candle[], side: "Buy" | "Sell") {
  if (candles.length < 3) return null;
  const a = candles[candles.length - 3];
  const c = candles[candles.length - 1];
  if (side === "Buy") {
    if (a.high < c.low) {
      return (a.high + c.low) / 2;
    }
  } else {
    if (a.low > c.high) {
      return (a.low + c.high) / 2;
    }
  }
  return null;
}

function detectCvdDivergence(
  candles: Candle[],
  cvdSeries: { ts: number; value: number }[],
  side: "Buy" | "Sell"
) {
  if (candles.length < 10 || cvdSeries.length < 5) return false;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const recentHigh = Math.max(...highs.slice(-30));
  const recentLow = Math.min(...lows.slice(-30));
  const cvdCurrent = cvdSeries[cvdSeries.length - 1]?.value ?? 0;
  const cvdPrevSlice = cvdSeries.slice(0, -5);
  const cvdPrevMax = cvdPrevSlice.reduce(
    (max, p) => Math.max(max, p.value),
    Number.NEGATIVE_INFINITY
  );
  const cvdPrevMin = cvdPrevSlice.reduce(
    (min, p) => Math.min(min, p.value),
    Number.POSITIVE_INFINITY
  );
  const lastClose = candles[candles.length - 1].close;
  if (side === "Sell") {
    return lastClose >= recentHigh && cvdCurrent < cvdPrevMax * 0.98;
  }
  return lastClose <= recentLow && cvdCurrent > cvdPrevMin * 0.98;
}

function detectOiDivergence(
  candles: Candle[],
  oiTrend: "rising" | "falling" | "flat" | undefined,
  side: "Buy" | "Sell"
) {
  if (!oiTrend || oiTrend === "flat" || candles.length < 12) return false;
  const last = candles[candles.length - 1].close;
  const prev = candles[candles.length - 12].close;
  const priceUp = last > prev;
  const priceDown = last < prev;
  if (side === "Sell") return priceUp && oiTrend === "falling";
  return priceDown && oiTrend === "rising";
}

export function evaluateAiMaticProStrategyForSymbol(
  symbol: string,
  candles: Candle[],
  config?: { entryTfMin?: number }
): EngineDecision {
  if (!candles.length) {
    return {
      state: "SCAN",
      trend: "range",
      halted: true,
    } as EngineDecision;
  }
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  const price = last.close;

  const orderflow = getOrderFlowSnapshot(symbol);
  const profile = computeMarketProfile({
    candles,
    trades: orderflow.trades?.map((t: any) => ({
      ts: t.ts,
      price: t.price,
      size: t.size,
    })),
    bucketPct: 0.001,
    valueAreaPct: 0.7,
  });

  const regime = analyzeRegimePro({
    symbol,
    closes,
    highs,
    lows,
    volumes,
    vpin: orderflow.vpin,
    ofi: orderflow.ofi,
    delta: orderflow.delta,
  });

  const absorptionScore = orderflow.absorptionScore ?? 0;
  const flowSignal = resolveFlowSignal({
    ofi: orderflow.ofi,
    ofiPrev: orderflow.ofiPrev,
    delta: orderflow.delta,
    deltaPrev: orderflow.deltaPrev,
    absorptionScore,
    lastClose: last.close,
    prevClose: prev.close,
  });
  const rfSignal = flowSignal;

  const entryTfMin = config?.entryTfMin ?? 5;
  const timeStopMinutes = Math.max(entryTfMin * 10, 60);
  const timeframeMs = resolveTimeframeMs(candles);

  const lastSwingHigh = findLastPivot(candles, "high", 30);
  const lastSwingLow = findLastPivot(candles, "low", 30);
  const swingHigh = lastSwingHigh?.price ?? Math.max(...highs.slice(-30));
  const swingLow = lastSwingLow?.price ?? Math.min(...lows.slice(-30));
  const lastOpenTime = Number(last.openTime);
  const tradesInCandle = (orderflow.trades ?? []).filter(
    (t: any) =>
      t.ts >= lastOpenTime && t.ts < lastOpenTime + timeframeMs
  );
  const totalTradeVol = tradesInCandle.reduce(
    (sum: number, t: any) => sum + t.size,
    0
  );
  const volAboveSwing = tradesInCandle.reduce(
    (sum: number, t: any) => (t.price > swingHigh ? sum + t.size : sum),
    0
  );
  const volBelowSwing = tradesInCandle.reduce(
    (sum: number, t: any) => (t.price < swingLow ? sum + t.size : sum),
    0
  );
  const volumeOutsideBear =
    totalTradeVol > 0 ? volAboveSwing / totalTradeVol : 0;
  const volumeOutsideBull =
    totalTradeVol > 0 ? volBelowSwing / totalTradeVol : 0;

  const bearishSfp =
    last.high > swingHigh && last.close < swingHigh && volumeOutsideBear >= 0.3;
  const bullishSfp =
    last.low < swingLow && last.close > swingLow && volumeOutsideBull >= 0.3;

  const cvdBear = detectCvdDivergence(candles, orderflow.cvdSeries ?? [], "Sell");
  const cvdBull = detectCvdDivergence(candles, orderflow.cvdSeries ?? [], "Buy");
  const oiBear = detectOiDivergence(
    candles,
    orderflow.openInterestTrend as "rising" | "falling" | "flat" | undefined,
    "Sell"
  );
  const oiBull = detectOiDivergence(
    candles,
    orderflow.openInterestTrend as "rising" | "falling" | "flat" | undefined,
    "Buy"
  );
  const iceberg = Boolean(orderflow.icebergDetected);
  const absorption = Number.isFinite(absorptionScore) && absorptionScore >= 2;
  const liqProximity = orderflow.liqProximityPct ?? null;

  const proSignals = {
    sfpBear: bearishSfp,
    sfpBull: bullishSfp,
    cvdBear,
    cvdBull,
    oiBear,
    oiBull,
    iceberg,
    absorptionScore,
    liqProximityPct: liqProximity,
  };

  const manipActive =
    regime.manipActive || (liqProximity != null && liqProximity <= 1);
  const prevState = proStateBySymbol.get(symbol) ?? "RANGE_TRADING";
  let proState: ProState = prevState;
  if (prevState === "RANGE_TRADING" && manipActive) {
    proState = "MANIPULATION_WATCH";
  } else if (prevState === "MANIPULATION_WATCH") {
    const invalidation =
      (last.close > prev.close && orderflow.openInterestTrend === "rising") ||
      (last.close < prev.close && orderflow.openInterestTrend === "falling");
    if (bearishSfp && (cvdBear || iceberg || absorption)) {
      proState = "EXECUTION";
    } else if (bullishSfp && (cvdBull || iceberg || absorption)) {
      proState = "EXECUTION";
    } else if (invalidation && !bearishSfp && !bullishSfp) {
      proState = "RANGE_TRADING";
    }
  } else if (prevState === "EXECUTION") {
    proState = "MANAGEMENT";
  } else if (prevState === "MANAGEMENT" && !manipActive) {
    proState = "RANGE_TRADING";
  }
  proStateBySymbol.set(symbol, proState);

  const regimeOk = regime.regimeOk;
  const useRangeLogic = regimeOk && !manipActive;

  const atrArr = computeATR(highs, lows, closes, 14);
  const atr = atrArr.length ? atrArr[atrArr.length - 1] : Number.NaN;
  if (!profile) {
    return {
      state: "SCAN",
      trend: "range",
      signal: null,
      proRegime: { ...regime, rfSignal },
      proState,
      proSignals,
      marketProfile: null,
      orderflow,
    } as EngineDecision;
  }

  if (useRangeLogic) {
    const longZone = price <= profile.val;
    const shortZone = price >= profile.vah;
    const longTrigger = flowSignal === "BUY";
    const shortTrigger = flowSignal === "SELL";

    let side: "Buy" | "Sell" | null = null;
    if (longZone && longTrigger) side = "Buy";
    if (shortZone && shortTrigger) side = "Sell";

    if (!side) {
      return {
        state: "SCAN",
        trend: "range",
        signal: null,
        proRegime: { ...regime, rfSignal },
        proState,
        proSignals,
        marketProfile: profile,
        orderflow,
      } as EngineDecision;
    }

    const lvnSl = findNearestLVN(profile.lvn ?? [], price, side);
    let sl =
      side === "Buy"
        ? Number.isFinite(lvnSl)
          ? (lvnSl as number)
          : price - (Number.isFinite(atr) ? 2 * atr : price * 0.002)
        : Number.isFinite(lvnSl)
          ? (lvnSl as number)
          : price + (Number.isFinite(atr) ? 2 * atr : price * 0.002);

    const midRange = (profile.vah + profile.val) / 2;
    const t1 = Number.isFinite(profile.vwap) ? profile.vwap : midRange;
    const t2 =
      Number.isFinite(profile.poc) && profile.poc > 0
        ? profile.poc
        : side === "Buy"
          ? profile.vah
          : profile.val;

    const signal: EngineSignal = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      intent: {
        side: side === "Buy" ? "buy" : "sell",
        entry: price,
        sl,
        tp: t2,
      },
      entryType: "LIMIT_MAKER_FIRST",
      kind: "MEAN_REVERSION",
      risk: 0.6,
      message: `PRO sideways ${side} | VA ${profile.val.toFixed(
        2
      )}-${profile.vah.toFixed(2)} | POC ${profile.poc.toFixed(2)}`,
      createdAt: new Date().toISOString(),
    };

    (signal as any).proTargets = {
      t1,
      t2,
      timeStopMinutes,
      entryTfMin,
    } satisfies ProTargets;

    return {
      state: "MANAGE",
      trend: "range",
      signal,
      proRegime: { ...regime, rfSignal },
      proState,
      proSignals,
      marketProfile: profile,
      orderflow,
    } as EngineDecision;
  }

  if (proState !== "EXECUTION") {
    return {
      state: "SCAN",
      trend: "range",
      signal: null,
      proRegime: { ...regime, rfSignal },
      proState,
      proSignals,
      marketProfile: profile,
      orderflow,
    } as EngineDecision;
  }

  const side: "Buy" | "Sell" | null = bearishSfp ? "Sell" : bullishSfp ? "Buy" : null;
  if (!side) {
    return {
      state: "SCAN",
      trend: "range",
      signal: null,
      proRegime: { ...regime, rfSignal },
      proState,
      proSignals,
      marketProfile: profile,
      orderflow,
    } as EngineDecision;
  }

  const fvgMid = detectFvgMid(candles, side);
  const entry = Number.isFinite(fvgMid)
    ? (fvgMid as number)
    : side === "Buy"
      ? swingLow
      : swingHigh;
  const sl =
    side === "Buy"
      ? Math.min(swingLow, entry - (Number.isFinite(atr) ? 2 * atr : entry * 0.003))
      : Math.max(swingHigh, entry + (Number.isFinite(atr) ? 2 * atr : entry * 0.003));
  const midRange = (profile.vah + profile.val) / 2;
  const t1 = Number.isFinite(profile.vwap) ? profile.vwap : midRange;
  const t2 =
    Number.isFinite(profile.poc) && profile.poc > 0
      ? profile.poc
      : side === "Buy"
        ? profile.vah
        : profile.val;

  const signal: EngineSignal = {
    id: `${symbol}-${Date.now()}`,
    symbol,
    intent: {
      side: side === "Buy" ? "buy" : "sell",
      entry,
      sl,
      tp: t2,
    },
    entryType: "LIMIT_MAKER_FIRST",
    kind: "MEAN_REVERSION",
    risk: 0.7,
    message: `PRO SFP ${side} | swing ${side === "Buy" ? swingLow : swingHigh} | ice ${iceberg ? "Y" : "N"}`,
    createdAt: new Date().toISOString(),
  };

  (signal as any).proTargets = {
    t1,
    t2,
    timeStopMinutes,
    entryTfMin,
  } satisfies ProTargets;

  return {
    state: "MANAGE",
    trend: "range",
    signal,
    proRegime: { ...regime, rfSignal },
    proState: "MANAGEMENT",
    proSignals,
    marketProfile: profile,
    orderflow,
  } as EngineDecision;
}
