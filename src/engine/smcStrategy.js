import { State, Trend, resampleCandles, } from "./botEngine";
import { CandlestickAnalyzer } from "./universal-candlestick-analyzer";
import { getCheatSheetSetup, getDefaultCheatSheetSetupId } from "./strategyCheatSheet";
const DISPLACEMENT_LOOKBACK = 10;
const DISPLACEMENT_BODY_MULT = 1.4;
const DISPLACEMENT_RANGE_MULT = 1.2;
const H4_MIN_BARS = 5;
const H1_MIN_BARS = 8;
const LTF_MIN_BARS = 20;
const LIQUIDITY_LOOKBACK = 60;
const LIQUIDITY_TOUCHES = 2;
const LIQUIDITY_TOLERANCE_MULT = 0.15;
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
    const ltf1 = resampleCandles(candles, 1);
    const ltf15 = resampleCandles(candles, 15);
    const h1 = resampleCandles(candles, 60);
    const h4 = resampleCandles(candles, 240);
    if (h4.length < H4_MIN_BARS ||
        h1.length < H1_MIN_BARS ||
        ltf15.length < H1_MIN_BARS ||
        ltf1.length < LTF_MIN_BARS) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            halted: true,
        };
    }
    const h4Analyzer = new CandlestickAnalyzer(toAnalyzerCandles(h4));
    const h1Analyzer = new CandlestickAnalyzer(toAnalyzerCandles(h1));
    const h4Structure = h4Analyzer.getMarketStructure();
    const h1Structure = h1Analyzer.getMarketStructure();
    const bias = resolveBias(h4Structure.trend, h1Structure.trend);
    const trend = bias === "long" ? Trend.Bull : bias === "short" ? Trend.Bear : Trend.Range;
    if (!bias) {
        return {
            state: State.Scan,
            trend,
            signal: null,
            halted: false,
        };
    }
    const ltfAnalyzer = new CandlestickAnalyzer(toAnalyzerCandles(ltf15));
    const ltfStructure = ltfAnalyzer.getMarketStructure();
    const ltfPois = ltfAnalyzer.getPointsOfInterest();
    const ltfCandles = toAnalyzerCandles(ltf15);
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
            signal: null,
            halted: false,
        };
    }
    const last1m = ltf1[ltf1.length - 1];
    const inPoiZone = last1m.low <= poi.high && last1m.high >= poi.low;
    const displacementOk = isDisplacement(ltf1, bias);
    if (!inPoiZone || !displacementOk) {
        return {
            state: State.Scan,
            trend,
            signal: null,
            halted: false,
        };
    }
    const entry = clamp(last1m.close, poi.low, poi.high);
    const avgRange15 = averageRange(ltf15, 8);
    const buffer = Number.isFinite(avgRange15) && avgRange15 > 0 ? avgRange15 * 0.1 : 0;
    const stop = bias === "long" ? poi.low - buffer : poi.high + buffer;
    const r = Math.abs(entry - stop);
    if (!Number.isFinite(r) || r <= 0) {
        return {
            state: State.Scan,
            trend,
            signal: null,
            halted: false,
        };
    }
    const liquidityTolerance = Number.isFinite(avgRange15) && avgRange15 > 0
        ? avgRange15 * LIQUIDITY_TOLERANCE_MULT
        : 0;
    const liquidityPools = detectLiquidityPools(ltf15, LIQUIDITY_LOOKBACK, liquidityTolerance, LIQUIDITY_TOUCHES);
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
        message: `SMC ${bias} pullback into ${poi.type} | HTF ${h4Structure.trend}/${h1Structure.trend}`,
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
        signal,
        halted: false,
    };
}
