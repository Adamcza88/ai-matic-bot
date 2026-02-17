import { computeATR } from "./botEngine.js";
import { findPivotsHigh, findPivotsLow } from "./ta.js";
import { computeMarketProfile } from "./marketProfile.js";
import { getOrderFlowSnapshot } from "./orderflow.js";
import { analyzeRegimePro } from "./regimePro.js";

const proStateBySymbol = new Map();

function resolveFlowSignal(args) {
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

function findNearestLVN(lvn, entry, side) {
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

function resolveTimeframeMs(candles) {
  if (candles.length < 2) return 60_000;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const diff = Number(last.openTime) - Number(prev.openTime);
  return Number.isFinite(diff) && diff > 0 ? diff : 60_000;
}

function findLastPivot(candles, side, lookback = 30) {
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

function isSfpBodyConfirmed(trigger, confirm, side) {
  if (side === "Sell") {
    return Math.max(confirm.open, confirm.close) < trigger.low;
  }
  return Math.min(confirm.open, confirm.close) > trigger.high;
}

function isGapMitigated(candles, startIdx, gapLow, gapHigh) {
  for (let i = startIdx + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.low <= gapHigh && c.high >= gapLow) {
      return true;
    }
  }
  return false;
}

function detectFvgMid(candles, side) {
  if (candles.length < 3) return null;
  for (let i = candles.length - 1; i >= 2; i--) {
    const a = candles[i - 2];
    const c = candles[i];
    if (side === "Buy") {
      if (!(a.high < c.low)) continue;
      const gapLow = a.high;
      const gapHigh = c.low;
      if (isGapMitigated(candles, i, gapLow, gapHigh)) continue;
      return (gapLow + gapHigh) / 2;
    }
    if (!(a.low > c.high)) continue;
    const gapLow = c.high;
    const gapHigh = a.low;
    if (isGapMitigated(candles, i, gapLow, gapHigh)) continue;
    return (gapLow + gapHigh) / 2;
  }
  return null;
}

function resolveTrendSide(candles, orderflow) {
  if (candles.length < 6) return null;
  const last = candles[candles.length - 1];
  const anchor = candles[candles.length - 6];
  const momentum = last.close - anchor.close;
  const ofi = orderflow?.ofi ?? 0;
  const delta = orderflow?.delta ?? 0;
  if (momentum > 0 && (ofi >= 0 || delta >= 0)) return "Buy";
  if (momentum < 0 && (ofi <= 0 || delta <= 0)) return "Sell";
  if (momentum > 0) return "Buy";
  if (momentum < 0) return "Sell";
  return null;
}

function resolveTrendEntryAnchor(profile, side, price) {
  const strongPoc =
    Number.isFinite(profile.poc) &&
    (profile.hvn ?? []).some((h) => Math.abs(h - profile.poc) <= (profile.bucketSize ?? 0) * 1.5);
  const candidates = [
    Number.isFinite(profile.vwap) ? { level: profile.vwap, source: "VWAP" } : null,
    strongPoc && Number.isFinite(profile.poc) ? { level: profile.poc, source: "POC" } : null,
  ].filter(Boolean);
  if (!candidates.length) return null;

  if (side === "Buy") {
    const below = candidates.filter((c) => c.level <= price);
    if (below.length) {
      return below.reduce((best, c) => (c.level > best.level ? c : best), below[0]);
    }
  } else {
    const above = candidates.filter((c) => c.level >= price);
    if (above.length) {
      return above.reduce((best, c) => (c.level < best.level ? c : best), above[0]);
    }
  }
  return candidates.reduce(
    (best, c) =>
      Math.abs(c.level - price) < Math.abs(best.level - price) ? c : best,
    candidates[0]
  );
}

function volumeOutsideSwingRatio(args) {
  const inCandle = (args.trades ?? []).filter(
    (t) =>
      t.ts >= args.candleOpenTime &&
      t.ts < args.candleOpenTime + args.timeframeMs
  );
  const total = inCandle.reduce((sum, t) => sum + t.size, 0);
  if (total <= 0) return 0;
  const outside = inCandle.reduce((sum, t) => {
    if (args.side === "Sell") {
      return t.price > args.swingLevel ? sum + t.size : sum;
    }
    return t.price < args.swingLevel ? sum + t.size : sum;
  }, 0);
  return outside / total;
}

function detectCvdDivergence(candles, cvdSeries, side) {
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

function detectOiDivergence(candles, oiTrend, side) {
  if (!oiTrend || oiTrend === "flat" || candles.length < 12) return false;
  const last = candles[candles.length - 1].close;
  const prev = candles[candles.length - 12].close;
  const priceUp = last > prev;
  const priceDown = last < prev;
  if (side === "Sell") return priceUp && oiTrend === "falling";
  return priceDown && oiTrend === "rising";
}

export function evaluateAiMaticProStrategyForSymbol(symbol, candles, config) {
  if (!candles.length) {
    return {
      state: "SCAN",
      trend: "range",
      halted: true,
    };
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
    trades: orderflow.trades?.map((t) => ({
      ts: t.ts,
      price: t.price,
      size: t.size,
    })),
    atrDivisor: 20,
    kdeSigma: 1.2,
    valueAreaPct: 0.8,
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
  const trigger = candles[candles.length - 2] ?? null;
  const confirm = last;
  const triggerOpenTime = Number(trigger?.openTime);
  const volumeOutsideBear = Number.isFinite(triggerOpenTime)
    ? volumeOutsideSwingRatio({
        trades: orderflow.trades ?? [],
        candleOpenTime: triggerOpenTime,
        timeframeMs,
        swingLevel: swingHigh,
        side: "Sell",
      })
    : 0;
  const volumeOutsideBull = Number.isFinite(triggerOpenTime)
    ? volumeOutsideSwingRatio({
        trades: orderflow.trades ?? [],
        candleOpenTime: triggerOpenTime,
        timeframeMs,
        swingLevel: swingLow,
        side: "Buy",
      })
    : 0;
  const bearishSfpTrigger = Boolean(
    trigger &&
      trigger.high > swingHigh &&
      trigger.close < swingHigh &&
      volumeOutsideBear >= 0.1
  );
  const bullishSfpTrigger = Boolean(
    trigger &&
      trigger.low < swingLow &&
      trigger.close > swingLow &&
      volumeOutsideBull >= 0.1
  );
  const bearishSfp = Boolean(
    trigger &&
      bearishSfpTrigger &&
      isSfpBodyConfirmed(trigger, confirm, "Sell")
  );
  const bullishSfp = Boolean(
    trigger &&
      bullishSfpTrigger &&
      isSfpBodyConfirmed(trigger, confirm, "Buy")
  );

  const cvdBear = detectCvdDivergence(candles, orderflow.cvdSeries ?? [], "Sell");
  const cvdBull = detectCvdDivergence(candles, orderflow.cvdSeries ?? [], "Buy");
  const oiBear = detectOiDivergence(candles, orderflow.openInterestTrend, "Sell");
  const oiBull = detectOiDivergence(candles, orderflow.openInterestTrend, "Buy");
  const iceberg = Boolean(orderflow.icebergDetected);
  const absorption = Number.isFinite(absorptionScore) && absorptionScore >= 2;
  const liqProximity = orderflow.liqProximityPct ?? null;

  const proSignals = {
    sfpBear: bearishSfp,
    sfpBull: bullishSfp,
    sfpBearTrigger: bearishSfpTrigger,
    sfpBullTrigger: bullishSfpTrigger,
    cvdBear,
    cvdBull,
    oiBear,
    oiBull,
    iceberg,
    absorptionScore,
    liqProximityPct: liqProximity,
  };

  const isTrending =
    regime.hurst > 0.55 &&
    regime.chop < 38.2 &&
    regime.trendProb >= 0.7 &&
    orderflow.vpin < 0.8;
  const isManipulation =
    regime.manipProb >= 0.7 ||
    (Number.isFinite(orderflow.vpin) && orderflow.vpin > 0.8);
  const manipActive =
    regime.manipActive || (liqProximity != null && liqProximity <= 1);
  const prevState = proStateBySymbol.get(symbol) ?? "RANGE_TRADING";
  let proState = prevState;
  if (prevState === "RANGE_TRADING") {
    if (isTrending) {
      proState = "TRENDING";
    } else if (isManipulation || manipActive) {
      proState = "MANIPULATION_WATCH";
    }
  } else if (prevState === "TRENDING") {
    if (!isTrending) {
      proState = isManipulation || manipActive ? "MANIPULATION_WATCH" : "RANGE_TRADING";
    }
  } else if (prevState === "MANIPULATION_WATCH") {
    const invalidation =
      (last.close > prev.close && orderflow.openInterestTrend === "rising") ||
      (last.close < prev.close && orderflow.openInterestTrend === "falling");
    if (isTrending) {
      proState = "TRENDING";
    } else if (bearishSfp && (cvdBear || iceberg || absorption)) {
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
    };
  }

  if (proState === "TRENDING") {
    const side = resolveTrendSide(candles, orderflow);
    const anchor = side ? resolveTrendEntryAnchor(profile, side, price) : null;
    const deltaOk =
      side === "Buy"
        ? Number.isFinite(orderflow.delta) && orderflow.delta > 0
        : side === "Sell"
          ? Number.isFinite(orderflow.delta) && orderflow.delta < 0
          : false;
    const absorptionOk =
      Number.isFinite(absorptionScore) && absorptionScore >= 2;
    const flowConfirmed = deltaOk || absorptionOk;
    const anchorDistance = anchor ? Math.abs(price - anchor.level) : Number.NaN;
    const maxDistance = Math.max(
      Number.isFinite(atr) ? 2 * atr : price * 0.004,
      price * 0.01
    );
    const pullbackReady =
      anchor &&
      anchorDistance > 0 &&
      anchorDistance <= maxDistance &&
      ((side === "Buy" && anchor.level <= price) ||
        (side === "Sell" && anchor.level >= price));

    if (!side || !anchor || !pullbackReady || !flowConfirmed) {
      return {
        state: "SCAN",
        trend: side === "Buy" ? "bull" : side === "Sell" ? "bear" : "range",
        signal: null,
        proRegime: { ...regime, rfSignal },
        proState,
        proSignals,
        marketProfile: profile,
        orderflow,
      };
    }

    const stopBuffer = Number.isFinite(atr) ? 1.5 * atr : price * 0.003;
    const entry = anchor.level;
    const sl =
      side === "Buy"
        ? Math.min(swingLow, entry - stopBuffer)
        : Math.max(swingHigh, entry + stopBuffer);
    const t2 =
      side === "Buy"
        ? Math.max(profile.vah, price + (Number.isFinite(atr) ? 2 * atr : price * 0.004))
        : Math.min(profile.val, price - (Number.isFinite(atr) ? 2 * atr : price * 0.004));

    const signal = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      intent: {
        side: side === "Buy" ? "buy" : "sell",
        entry,
        sl,
        tp: t2,
      },
      entryType: "LIMIT_MAKER_FIRST",
      kind: "PULLBACK",
      risk: 0.8,
      message: `PRO trend ${side} | anchor ${anchor.source} ${entry.toFixed(
        2
      )} | Δ ${Number(orderflow.delta ?? 0).toFixed(2)} | Abs ${Number(
        absorptionScore
      ).toFixed(2)}`,
      createdAt: new Date().toISOString(),
    };

    signal.proTargets = {
      t1: Number.isFinite(profile.poc) ? profile.poc : profile.vwap,
      t2,
      timeStopMinutes,
      entryTfMin,
    };

    return {
      state: "MANAGE",
      trend: side === "Buy" ? "bull" : "bear",
      signal,
      proRegime: { ...regime, rfSignal },
      proState,
      proSignals,
      marketProfile: profile,
      orderflow,
    };
  }

  if (useRangeLogic) {
    const longZone = price <= profile.val;
    const shortZone = price >= profile.vah;
    const longTrigger = flowSignal === "BUY";
    const shortTrigger = flowSignal === "SELL";

    let side = null;
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
      };
    }

    const lvnSl = findNearestLVN(profile.lvn ?? [], price, side);
    let sl =
      side === "Buy"
        ? Number.isFinite(lvnSl)
          ? lvnSl
          : price - (Number.isFinite(atr) ? 2 * atr : price * 0.002)
        : Number.isFinite(lvnSl)
          ? lvnSl
          : price + (Number.isFinite(atr) ? 2 * atr : price * 0.002);

    const midRange = (profile.vah + profile.val) / 2;
    const t1 = Number.isFinite(profile.vwap) ? profile.vwap : midRange;
    const t2 =
      Number.isFinite(profile.poc) && profile.poc > 0
        ? profile.poc
        : side === "Buy"
          ? profile.vah
          : profile.val;

    const signal = {
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

    signal.proTargets = {
      t1,
      t2,
      timeStopMinutes,
      entryTfMin,
    };

    return {
      state: "MANAGE",
      trend: "range",
      signal,
      proRegime: { ...regime, rfSignal },
      proState,
      proSignals,
      marketProfile: profile,
      orderflow,
    };
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
    };
  }

  const side = bearishSfp ? "Sell" : bullishSfp ? "Buy" : null;
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
    };
  }

  const fvgMid = detectFvgMid(candles, side);
  const entry = Number.isFinite(fvgMid)
    ? fvgMid
    : side === "Buy"
      ? swingLow
      : swingHigh;
  const sl =
    side === "Buy"
      ? Math.min(
          swingLow,
          entry - (Number.isFinite(atr) ? 2 * atr : entry * 0.003)
        )
      : Math.max(
          swingHigh,
          entry + (Number.isFinite(atr) ? 2 * atr : entry * 0.003)
        );
  const midRange = (profile.vah + profile.val) / 2;
  const t1 = Number.isFinite(profile.vwap) ? profile.vwap : midRange;
  const t2 =
    Number.isFinite(profile.poc) && profile.poc > 0
      ? profile.poc
      : side === "Buy"
        ? profile.vah
        : profile.val;

  const signal = {
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
    message: `PRO SFP ${side} | swing ${
      side === "Buy" ? swingLow : swingHigh
    } | ice ${iceberg ? "Y" : "N"}`,
    createdAt: new Date().toISOString(),
  };

  signal.proTargets = {
    t1,
    t2,
    timeStopMinutes,
    entryTfMin,
  };

  return {
    state: "MANAGE",
    trend: "range",
    signal,
    proRegime: { ...regime, rfSignal },
    proState: "MANAGEMENT",
    proSignals,
    marketProfile: profile,
    orderflow,
  };
}

export const __aiMaticProTest = {
  detectFvgMid,
  isSfpBodyConfirmed,
  resolveTrendSide,
  resolveTrendEntryAnchor,
  volumeOutsideSwingRatio,
};
