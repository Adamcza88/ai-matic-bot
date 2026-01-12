import { State, Trend, resampleCandles, computeADX, } from "./botEngine";
import { CandlestickAnalyzer } from "./universal-candlestick-analyzer";
import { getCheatSheetSetup, getDefaultCheatSheetSetupId } from "./strategyCheatSheet";
const DISPLACEMENT_LOOKBACK = 10;
const DISPLACEMENT_BODY_MULT = 1.4;
const DISPLACEMENT_RANGE_MULT = 1.2;
const H4_MIN_BARS = 5;
const H12_MIN_BARS = 5;
const D1_MIN_BARS = 5;
const H1_MIN_BARS = 8;
const LTF_MIN_BARS = 20;
const LIQUIDITY_LOOKBACK = 60;
const LIQUIDITY_TOUCHES = 2;
const LIQUIDITY_TOLERANCE_MULT = 0.15;
const BOS_VOLUME_MULT = 1.1;
const BOS_VOLUME_LOOKBACK = 20;
const FVG_DISTANCE_PCT = 0.015;
function toAnalyzerCandles(candles) {
    return candles.map((c) => ({
        time: c.openTime ?? c.timestamp ?? Date.now(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));
}
function averageRange(candles, lookback) {
    const slice = candles.slice(-lookback);
    if (!slice.length)
        return Number.NaN;
    const sum = slice.reduce((acc, c) => acc + (c.high - c.low), 0);
    return sum / slice.length;
}
function averageVolume(candles, lookback) {
    const slice = candles.slice(-lookback);
    if (!slice.length)
        return Number.NaN;
    const sum = slice.reduce((acc, c) => acc + (c.volume ?? 0), 0);
    return sum / slice.length;
}
function isDisplacement(candles, bias, lookback = DISPLACEMENT_LOOKBACK) {
    if (!bias)
        return false;
    if (candles.length < lookback + 1)
        return false;
    const prev = candles.slice(-lookback - 1, -1);
    const last = candles[candles.length - 1];
    const avgBody = prev.reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / prev.length;
    const avgRange = averageRange(prev, prev.length);
    const currBody = Math.abs(last.close - last.open);
    const currRange = last.high - last.low;
    const dirOk = bias === "long" ? last.close > last.open : last.close < last.open;
    return (dirOk &&
        currBody > avgBody * DISPLACEMENT_BODY_MULT &&
        currRange > avgRange * DISPLACEMENT_RANGE_MULT);
}
function resolveBias(h4Trend, h1Trend) {
    if (h4Trend === "up" && h1Trend === "up")
        return "long";
    if (h4Trend === "down" && h1Trend === "down")
        return "short";
    return null;
}
function isPoiMitigated(poi, candles) {
    for (const c of candles) {
        if (c.time <= poi.time)
            continue;
        if (c.low <= poi.high && c.high >= poi.low)
            return true;
    }
    return false;
}
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
function resolveBosLevel(structure, bias) {
    if (!bias)
        return null;
    if (bias === "long")
        return structure.lastHH ?? structure.lastLH ?? null;
    return structure.lastLL ?? structure.lastHL ?? null;
}
function isNearFvg(price, fvg, distancePct) {
    if (!Number.isFinite(price))
        return false;
    if (price >= fvg.low && price <= fvg.high)
        return true;
    const mid = (fvg.high + fvg.low) / 2;
    return Math.abs(price - mid) / price <= distancePct;
}
function confirmBosAndFvg(args) {
    const tags = [];
    const { bias, ltf, ltfStructure, htfStructure, htfPois, ltfPois, price, config } = args;
    if (!bias || !ltf.length)
        return { ok: false, tags: ["BOS_INVALID"] };
    const bosLevel = resolveBosLevel(ltfStructure, bias) ?? resolveBosLevel(htfStructure, bias);
    if (!Number.isFinite(bosLevel ?? Number.NaN)) {
        return { ok: false, tags: ["BOS_LEVEL_MISSING"] };
    }
    const last = ltf[ltf.length - 1];
    const broke = bias === "long" ? last.close > bosLevel : last.close < bosLevel;
    if (!broke)
        return { ok: false, tags: ["BOS_NOT_BROKEN"] };
    const falseBreakout = bias === "long"
        ? last.high > bosLevel && last.close <= bosLevel
        : last.low < bosLevel && last.close >= bosLevel;
    if (falseBreakout)
        return { ok: false, tags: ["BOS_FALSE_BREAKOUT"] };
    const volLookback = config.smcBosVolumePeriod ?? BOS_VOLUME_LOOKBACK;
    const volMult = config.smcBosVolumeMult ?? BOS_VOLUME_MULT;
    const avgVol = averageVolume(ltf, volLookback);
    if (Number.isFinite(last.volume) &&
        Number.isFinite(avgVol) &&
        avgVol > 0 &&
        last.volume < avgVol * volMult) {
        return { ok: false, tags: ["BOS_LOW_VOLUME"] };
    }
    tags.push("BOS_OK");
    const desiredDirection = bias === "long" ? "bullish" : "bearish";
    const distancePct = config.smcFvgDistancePct ?? FVG_DISTANCE_PCT;
    const htfFvgOk = htfPois
        .filter((p) => p.type === "FVG" && p.direction === desiredDirection)
        .some((p) => isNearFvg(price, p, distancePct));
    const ltfFvgOk = ltfPois
        .filter((p) => p.type === "FVG" && p.direction === desiredDirection)
        .some((p) => isNearFvg(price, p, distancePct));
    const requireFvg = config.smcFvgRequireHtf ?? true;
    if (requireFvg && !(htfFvgOk && ltfFvgOk)) {
        return { ok: false, tags: ["FVG_MISSING"] };
    }
    if (htfFvgOk)
        tags.push("FVG_HTF_OK");
    if (ltfFvgOk)
        tags.push("FVG_LTF_OK");
    return { ok: true, tags };
}
function detectLiquidityPools(candles, lookback, tolerance, minTouches) {
    const slice = candles.slice(-lookback);
    const highClusters = [];
    const lowClusters = [];
    for (const candle of slice) {
        const high = candle.high;
        const low = candle.low;
        let matched = false;
        for (const cluster of highClusters) {
            if (Math.abs(high - cluster.level) <= tolerance) {
                cluster.level = (cluster.level * cluster.count + high) / (cluster.count + 1);
                cluster.count += 1;
                matched = true;
                break;
            }
        }
        if (!matched) {
            highClusters.push({ level: high, count: 1 });
        }
        matched = false;
        for (const cluster of lowClusters) {
            if (Math.abs(low - cluster.level) <= tolerance) {
                cluster.level = (cluster.level * cluster.count + low) / (cluster.count + 1);
                cluster.count += 1;
                matched = true;
                break;
            }
        }
        if (!matched) {
            lowClusters.push({ level: low, count: 1 });
        }
    }
    return {
        highs: highClusters.filter((c) => c.count >= minTouches).map((c) => c.level),
        lows: lowClusters.filter((c) => c.count >= minTouches).map((c) => c.level),
    };
}
function selectLiquidityTarget(pools, bias, entry) {
    if (bias === "long") {
        const above = pools.highs.filter((h) => h > entry);
        if (!above.length)
            return null;
        return Math.min(...above);
    }
    if (bias === "short") {
        const below = pools.lows.filter((l) => l < entry);
        if (!below.length)
            return null;
        return Math.max(...below);
    }
    return null;
}
export function evaluateSmcStrategyForSymbol(symbol, candles, config = {}) {
    const ltf5 = resampleCandles(candles, 5);
    const ltf15 = resampleCandles(candles, 15);
    const h1 = resampleCandles(candles, 60);
    const h4 = resampleCandles(candles, 240);
    const h12 = resampleCandles(candles, 720);
    const d1 = resampleCandles(candles, 1440);
    const hasCoreFrames = h4.length >= H4_MIN_BARS && h1.length >= H1_MIN_BARS;
    const hasBullishFrames = hasCoreFrames && h12.length >= H12_MIN_BARS && ltf5.length >= LTF_MIN_BARS;
    const hasBearishFrames = hasCoreFrames && d1.length >= D1_MIN_BARS && ltf15.length >= LTF_MIN_BARS;
    if (!hasBullishFrames && !hasBearishFrames) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            trendH1: Trend.Range,
            trendScore: 0,
            trendAdx: Number.NaN,
            halted: true,
        };
    }
    const h4Analyzer = new CandlestickAnalyzer(toAnalyzerCandles(h4));
    const h1Analyzer = new CandlestickAnalyzer(toAnalyzerCandles(h1));
    const h4Structure = h4Analyzer.getMarketStructure();
    const h1Structure = h1Analyzer.getMarketStructure();
    const h12Structure = hasBullishFrames
        ? new CandlestickAnalyzer(toAnalyzerCandles(h12)).getMarketStructure()
        : null;
    const d1Structure = hasBearishFrames
        ? new CandlestickAnalyzer(toAnalyzerCandles(d1)).getMarketStructure()
        : null;
    const bullishBias = h12Structure
        ? resolveBias(h12Structure.trend, h4Structure.trend)
        : null;
    const bearishBias = d1Structure
        ? resolveBias(d1Structure.trend, h4Structure.trend)
        : null;
    const scenario = bullishBias === "long"
        ? "bullish"
        : bearishBias === "short"
            ? "bearish"
            : null;
    const bias = scenario === "bullish" ? "long" : scenario === "bearish" ? "short" : null;
    const htfHighStructure = scenario === "bullish"
        ? h12Structure
        : scenario === "bearish"
            ? d1Structure
            : null;
    if (!bias || !scenario || !htfHighStructure) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            trendH1: Trend.Range,
            trendScore: 0,
            trendAdx: Number.NaN,
            signal: null,
            halted: false,
        };
    }
    const ltfContext = h1;
    const ltfEntry = scenario === "bullish" ? ltf5 : ltf15;
    const ltfAnalyzer = new CandlestickAnalyzer(toAnalyzerCandles(ltfContext));
    const ltfStructure = ltfAnalyzer.getMarketStructure();
    const trend = bias === "long" ? Trend.Bull : bias === "short" ? Trend.Bear : Trend.Range;
    const trendH1 = h1Structure.trend === "up"
        ? Trend.Bull
        : h1Structure.trend === "down"
            ? Trend.Bear
            : Trend.Range;
    const adxPeriod = config.adxPeriod ?? 14;
    const adxArr = computeADX(h1.map((c) => c.high), h1.map((c) => c.low), h1.map((c) => c.close), adxPeriod);
    const trendAdx = adxArr[adxArr.length - 1];
    const trendScore = bias
        ? [
            htfHighStructure.trend !== "range",
            h4Structure.trend !== "range",
            h1Structure.trend !== "range",
            (bias === "long" && ltfStructure.trend === "up") ||
                (bias === "short" && ltfStructure.trend === "down"),
        ].filter(Boolean).length
        : 0;
    if (!bias) {
        return {
            state: State.Scan,
            trend,
            trendH1,
            trendScore,
            trendAdx,
            signal: null,
            halted: false,
        };
    }
    const ltfPois = ltfAnalyzer.getPointsOfInterest();
    const h4Pois = h4Analyzer.getPointsOfInterest();
    const ltfCandles = toAnalyzerCandles(ltfContext);
    const desiredDirection = bias === "long" ? "bullish" : "bearish";
    const validPois = ltfPois
        .filter((p) => p.direction === desiredDirection)
        .filter((p) => !isPoiMitigated(p, ltfCandles))
        .sort((a, b) => {
        const prioA = a.priority ?? 0;
        const prioB = b.priority ?? 0;
        if (prioA !== prioB)
            return prioB - prioA;
        return (b.time ?? 0) - (a.time ?? 0);
    });
    const poi = validPois[0];
    if (!poi) {
        return {
            state: State.Scan,
            trend,
            trendH1,
            trendScore,
            trendAdx,
            signal: null,
            halted: false,
        };
    }
    const lastEntry = ltfEntry[ltfEntry.length - 1];
    const inPoiZone = lastEntry.low <= poi.high && lastEntry.high >= poi.low;
    const displacementOk = isDisplacement(ltfEntry, bias);
    if (!inPoiZone || !displacementOk) {
        return {
            state: State.Scan,
            trend,
            trendH1,
            trendScore,
            trendAdx,
            signal: null,
            halted: false,
        };
    }
    const bosAndFvg = confirmBosAndFvg({
        bias,
        ltf: ltfContext,
        ltfStructure,
        htfStructure: h4Structure,
        ltfPois,
        htfPois: h4Pois,
        price: lastEntry.close,
        config,
    });
    if (!bosAndFvg.ok) {
        return {
            state: State.Scan,
            trend,
            trendH1,
            trendScore,
            trendAdx,
            signal: null,
            halted: false,
        };
    }
    const entry = clamp(lastEntry.close, poi.low, poi.high);
    const avgRangeLtf = averageRange(ltfContext, 8);
    const buffer = Number.isFinite(avgRangeLtf) && avgRangeLtf > 0 ? avgRangeLtf * 0.1 : 0;
    const stop = bias === "long" ? poi.low - buffer : poi.high + buffer;
    const r = Math.abs(entry - stop);
    if (!Number.isFinite(r) || r <= 0) {
        return {
            state: State.Scan,
            trend,
            trendH1,
            trendScore,
            trendAdx,
            signal: null,
            halted: false,
        };
    }
    const liquidityTolerance = Number.isFinite(avgRangeLtf) && avgRangeLtf > 0
        ? avgRangeLtf * LIQUIDITY_TOLERANCE_MULT
        : 0;
    const liquidityPools = detectLiquidityPools(ltfContext, LIQUIDITY_LOOKBACK, liquidityTolerance, LIQUIDITY_TOUCHES);
    const liquidityTp = selectLiquidityTarget(liquidityPools, bias, entry);
    let tp = liquidityTp ??
        (bias === "long"
            ? ltfStructure.lastHH ?? ltfStructure.lastLH
            : ltfStructure.lastLL ?? ltfStructure.lastHL);
    if (!Number.isFinite(tp) || (bias === "long" ? tp <= entry : tp >= entry)) {
        const dir = bias === "long" ? 1 : -1;
        tp = entry + dir * 1.6 * r;
    }
    const signal = {
        id: `${symbol}-${Date.now()}`,
        symbol,
        intent: {
            side: bias === "long" ? "buy" : "sell",
            entry,
            sl: stop,
            tp,
        },
        kind: "PULLBACK",
        risk: 0.7,
        message: `SMC ${bias} pullback into ${poi.type} | HTF ${scenario === "bullish" ? "12h/4h" : "1d/4h"} (${htfHighStructure.trend}/${h4Structure.trend}) · LTF ${scenario === "bullish" ? "1h/5m" : "1h/15m"}`,
        createdAt: new Date().toISOString(),
    };
    if (config.useStrategyCheatSheet) {
        const setupId = config.cheatSheetSetupId ?? getDefaultCheatSheetSetupId();
        const setup = setupId ? getCheatSheetSetup(setupId) : null;
        if (setup) {
            signal.setupId = setup.id;
            signal.entryType = setup.entryType;
            if (setup.entryType === "CONDITIONAL") {
                const dir = signal.intent.side === "buy" ? 1 : -1;
                const offsetBps = setup.triggerOffsetBps ?? 0;
                signal.triggerPrice =
                    signal.intent.entry * (1 + (dir * offsetBps) / 10000);
            }
        }
    }
    return {
        state: State.Scan,
        trend,
        trendH1,
        trendScore,
        trendAdx,
        signal,
        halted: false,
    };
}
