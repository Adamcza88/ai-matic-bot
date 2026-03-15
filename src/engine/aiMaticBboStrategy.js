import { State, Trend, resampleCandles, } from "./botEngine.js";
import { computeADX, computeATR, computeEma, findPivotsHigh, findPivotsLow, } from "./ta.js";
import { computeCoreV2 } from "./coreV2.js";
const H1_OVERLAP_MAX = 0.35;
const H4_ATR_HARD_MIN_PCT = 0.008;
const BBO_QUALITY_THRESHOLD = 60;
const BBO_PREEXEC_THRESHOLD = 45;
const VOLUME_SPIKE_MIN = 1.3;
const ATR_EXPANSION_MIN = 1.1;
const MIN_STOP_PCT = 0.002;
function last(values) {
    return values.length ? values[values.length - 1] : undefined;
}
function mean(values) {
    const finite = values.filter((value) => Number.isFinite(value));
    if (!finite.length)
        return Number.NaN;
    return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}
function overlapRatio(candles, lookback = 12) {
    if (candles.length < 3)
        return Number.NaN;
    const slice = candles.slice(-lookback);
    if (slice.length < 2)
        return Number.NaN;
    let overlapSum = 0;
    let rangeSum = 0;
    for (let i = 1; i < slice.length; i++) {
        const curr = slice[i];
        const prev = slice[i - 1];
        const overlap = Math.max(0, Math.min(curr.high, prev.high) - Math.max(curr.low, prev.low));
        const range = Math.max(curr.high - curr.low, 1e-9);
        overlapSum += overlap;
        rangeSum += range;
    }
    return rangeSum > 0 ? overlapSum / rangeSum : Number.NaN;
}
function resolveStructureDirection(highs, lows) {
    const lastTwoHighs = highs.slice(-2);
    const lastTwoLows = lows.slice(-2);
    const bull = lastTwoHighs.length === 2 &&
        lastTwoLows.length === 2 &&
        lastTwoHighs[1].price > lastTwoHighs[0].price &&
        lastTwoLows[1].price > lastTwoLows[0].price;
    const bear = lastTwoHighs.length === 2 &&
        lastTwoLows.length === 2 &&
        lastTwoHighs[1].price < lastTwoHighs[0].price &&
        lastTwoLows[1].price < lastTwoLows[0].price;
    if (bull)
        return "BULL";
    if (bear)
        return "BEAR";
    return "NONE";
}
function resolveSlopeDirection(candles, lookback = 8) {
    if (candles.length < lookback + 1)
        return "NONE";
    const first = candles[candles.length - lookback - 1]?.close;
    const lastClose = candles[candles.length - 1]?.close;
    const recent = candles.slice(-lookback).map((candle) => candle.close);
    const avg = mean(recent);
    if (!Number.isFinite(first) || !Number.isFinite(lastClose) || !Number.isFinite(avg)) {
        return "NONE";
    }
    if (lastClose > first && lastClose >= avg)
        return "BULL";
    if (lastClose < first && lastClose <= avg)
        return "BEAR";
    return "NONE";
}
function resolveH1Context(h1) {
    const highs = findPivotsHigh(h1, 2, 2);
    const lows = findPivotsLow(h1, 2, 2);
    const structure = resolveStructureDirection(highs, lows);
    const slopeDirection = resolveSlopeDirection(h1, 8);
    const overlap = overlapRatio(h1, 10);
    const direction = structure === "NONE" ? slopeDirection : structure;
    if (direction === "BULL" && Number.isFinite(overlap) && overlap < H1_OVERLAP_MAX) {
        return { direction: "BULL", overlap };
    }
    if (direction === "BEAR" && Number.isFinite(overlap) && overlap < H1_OVERLAP_MAX) {
        return { direction: "BEAR", overlap };
    }
    return { direction: "RANGE", overlap };
}
function resolve4HBias(h4) {
    const closes = h4.map((candle) => candle.close);
    const ema50 = computeEma(closes, 50);
    const ema200 = computeEma(closes, 200);
    const lastClose = last(closes) ?? Number.NaN;
    const lastEma50 = last(ema50) ?? Number.NaN;
    const lastEma200 = last(ema200) ?? Number.NaN;
    const highs = findPivotsHigh(h4, 2, 2);
    const lows = findPivotsLow(h4, 2, 2);
    const structure = resolveStructureDirection(highs, lows);
    const slopeDirection = resolveSlopeDirection(h4, 6);
    const direction = structure === "NONE" ? slopeDirection : structure;
    if (direction === "BULL" &&
        Number.isFinite(lastClose) &&
        Number.isFinite(lastEma50) &&
        Number.isFinite(lastEma200) &&
        lastEma50 > lastEma200 &&
        lastClose > lastEma50) {
        return {
            bias: "LONG",
            ema50: lastEma50,
            ema200: lastEma200,
            structure: direction,
        };
    }
    if (direction === "BEAR" &&
        Number.isFinite(lastClose) &&
        Number.isFinite(lastEma50) &&
        Number.isFinite(lastEma200) &&
        lastEma50 < lastEma200 &&
        lastClose < lastEma50) {
        return {
            bias: "SHORT",
            ema50: lastEma50,
            ema200: lastEma200,
            structure: direction,
        };
    }
    return {
        bias: "NEUTRAL",
        ema50: lastEma50,
        ema200: lastEma200,
        structure: direction,
    };
}
function resolveMtfTrendDirection(candles, fastPeriod, slowPeriod) {
    const closes = candles.map((candle) => candle.close);
    const fast = computeEma(closes, fastPeriod);
    const slow = computeEma(closes, slowPeriod);
    const fastNow = last(fast) ?? Number.NaN;
    const slowNow = last(slow) ?? Number.NaN;
    const highs = findPivotsHigh(candles, 2, 2);
    const lows = findPivotsLow(candles, 2, 2);
    const structure = resolveStructureDirection(highs, lows);
    const slopeDirection = resolveSlopeDirection(candles, 6);
    const direction = structure === "NONE" ? slopeDirection : structure;
    if (direction === "BULL" && Number.isFinite(fastNow) && Number.isFinite(slowNow) && fastNow > slowNow) {
        return { direction: "BULL", fastNow, slowNow };
    }
    if (direction === "BEAR" && Number.isFinite(fastNow) && Number.isFinite(slowNow) && fastNow < slowNow) {
        return { direction: "BEAR", fastNow, slowNow };
    }
    return { direction: "NONE", fastNow, slowNow };
}
function resolvePullback(m5, direction, ema20Arr, ema50Arr) {
    const lookback = Math.min(20, m5.length);
    let touched = false;
    let correctionLow = Number.NaN;
    let correctionHigh = Number.NaN;
    for (let i = Math.max(0, m5.length - lookback); i < m5.length; i++) {
        const candle = m5[i];
        const ema20 = ema20Arr[i];
        const ema50 = ema50Arr[i];
        if (!candle || !Number.isFinite(ema20) || !Number.isFinite(ema50))
            continue;
        const zoneLow = Math.min(ema20, ema50);
        const zoneHigh = Math.max(ema20, ema50);
        const touchesZone = candle.low <= zoneHigh && candle.high >= zoneLow;
        if (!touchesZone)
            continue;
        if (direction === "BULL" && candle.close >= zoneLow) {
            touched = true;
            correctionLow = Number.isFinite(correctionLow)
                ? Math.min(correctionLow, candle.low)
                : candle.low;
            correctionHigh = Number.isFinite(correctionHigh)
                ? Math.max(correctionHigh, candle.high)
                : candle.high;
        }
        if (direction === "BEAR" && candle.close <= zoneHigh) {
            touched = true;
            correctionLow = Number.isFinite(correctionLow)
                ? Math.min(correctionLow, candle.low)
                : candle.low;
            correctionHigh = Number.isFinite(correctionHigh)
                ? Math.max(correctionHigh, candle.high)
                : candle.high;
        }
    }
    return { touched, correctionLow, correctionHigh };
}
function resolveMicroBreak(m5, direction) {
    const highs = findPivotsHigh(m5, 2, 2);
    const lows = findPivotsLow(m5, 2, 2);
    const lastClose = last(m5)?.close ?? Number.NaN;
    const lastLow = last(lows);
    const lastHigh = last(highs);
    const prevHigh = lastLow != null ? highs.filter((pivot) => pivot.idx < lastLow.idx).pop() : undefined;
    const prevLow = lastHigh != null ? lows.filter((pivot) => pivot.idx < lastHigh.idx).pop() : undefined;
    if (direction === "BULL") {
        const fallbackSlice = m5.slice(-12, -1);
        const fallbackHigh = fallbackSlice.length
            ? Math.max(...fallbackSlice.map((candle) => candle.high))
            : Number.NaN;
        const fallbackLow = fallbackSlice.length
            ? Math.min(...fallbackSlice.map((candle) => candle.low))
            : Number.NaN;
        const pivotOk = Boolean(prevHigh && lastLow) || Number.isFinite(fallbackHigh);
        const correctionHigh = Number.isFinite(prevHigh?.price)
            ? prevHigh.price
            : fallbackHigh;
        const correctionLow = Number.isFinite(lastLow?.price)
            ? lastLow.price
            : fallbackLow;
        return {
            pivotOk,
            breakOk: pivotOk &&
                Number.isFinite(lastClose) &&
                lastClose > correctionHigh,
            correctionHigh,
            correctionLow,
        };
    }
    if (direction === "BEAR") {
        const fallbackSlice = m5.slice(-12, -1);
        const fallbackHigh = fallbackSlice.length
            ? Math.max(...fallbackSlice.map((candle) => candle.high))
            : Number.NaN;
        const fallbackLow = fallbackSlice.length
            ? Math.min(...fallbackSlice.map((candle) => candle.low))
            : Number.NaN;
        const pivotOk = Boolean(prevLow && lastHigh) || Number.isFinite(fallbackLow);
        const correctionHigh = Number.isFinite(lastHigh?.price)
            ? lastHigh.price
            : fallbackHigh;
        const correctionLow = Number.isFinite(prevLow?.price)
            ? prevLow.price
            : fallbackLow;
        return {
            pivotOk,
            breakOk: pivotOk &&
                Number.isFinite(lastClose) &&
                lastClose < correctionLow,
            correctionHigh,
            correctionLow,
        };
    }
    return {
        pivotOk: false,
        breakOk: false,
        correctionHigh: Number.NaN,
        correctionLow: Number.NaN,
    };
}
function toTrend(direction) {
    if (direction === "BULL")
        return Trend.Bull;
    if (direction === "BEAR")
        return Trend.Bear;
    return Trend.Range;
}
export function evaluateAiMaticBboStrategyForSymbol(symbol, candles) {
    if (!candles.length) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            trendH1: Trend.Range,
            trendScore: 0,
            trendAdx: Number.NaN,
            signal: null,
            halted: true,
            bboContext: {
                h1Context: "RANGE",
                bias4h: "NEUTRAL",
                direction: "NONE",
                family: "NO_TRADE",
                baseScore: 0,
                qualityThreshold: BBO_QUALITY_THRESHOLD,
                hardGatePass: false,
                setupValid: false,
                triggerValid: false,
                gates: [],
                metrics: {
                    h1Overlap: Number.NaN,
                    h1Adx: Number.NaN,
                    h4AtrPct: Number.NaN,
                    m5AtrExpansionRatio: Number.NaN,
                    m5VolumeRatio: Number.NaN,
                    ema20: Number.NaN,
                    ema50: Number.NaN,
                    correctionHigh: Number.NaN,
                    correctionLow: Number.NaN,
                },
            },
        };
    }
    const h4 = resampleCandles(candles, 240);
    const h1 = resampleCandles(candles, 60);
    const m15 = resampleCandles(candles, 15);
    const m5 = resampleCandles(candles, 5);
    if (!h4.length || !h1.length || !m15.length || !m5.length) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            trendH1: Trend.Range,
            trendScore: 0,
            trendAdx: Number.NaN,
            signal: null,
            halted: true,
        };
    }
    const h1Context = resolveH1Context(h1);
    const bias4h = resolve4HBias(h4);
    const direction = h1Context.direction === "BULL" && bias4h.bias === "LONG"
        ? "BULL"
        : h1Context.direction === "BEAR" && bias4h.bias === "SHORT"
            ? "BEAR"
            : "NONE";
    const family = direction === "NONE" ? "NO_TRADE" : "TREND_PULLBACK";
    const m15Trend = resolveMtfTrendDirection(m15, 20, 50);
    const m5Trend = resolveMtfTrendDirection(m5, 20, 50);
    const trendAligned = direction !== "NONE" &&
        m15Trend.direction === direction &&
        m5Trend.direction === direction;
    const m5Closes = m5.map((candle) => candle.close);
    const m5Highs = m5.map((candle) => candle.high);
    const m5Lows = m5.map((candle) => candle.low);
    const m5Volumes = m5.map((candle) => candle.volume);
    const ema12Arr = computeEma(m5Closes, 12);
    const ema26Arr = computeEma(m5Closes, 26);
    const ema20Arr = computeEma(m5Closes, 20);
    const ema50Arr = computeEma(m5Closes, 50);
    const ema200Arr = computeEma(m5Closes, 200);
    const ema12 = last(ema12Arr) ?? Number.NaN;
    const ema26 = last(ema26Arr) ?? Number.NaN;
    const ema20 = last(ema20Arr) ?? Number.NaN;
    const ema50 = last(ema50Arr) ?? Number.NaN;
    const ema200 = last(ema200Arr) ?? Number.NaN;
    const pullback = resolvePullback(m5, direction, ema20Arr, ema50Arr);
    const microBreak = resolveMicroBreak(m5, direction);
    const atr5Arr = computeATR(m5Highs, m5Lows, m5Closes, 14);
    const atr5 = last(atr5Arr) ?? Number.NaN;
    const atr5Avg = mean(atr5Arr.slice(-20));
    const atrExpansionRatio = Number.isFinite(atr5) && Number.isFinite(atr5Avg) && atr5Avg > 0
        ? atr5 / atr5Avg
        : Number.NaN;
    const atrExpansionOk = Number.isFinite(atrExpansionRatio) && atrExpansionRatio >= ATR_EXPANSION_MIN;
    const h4Closes = h4.map((candle) => candle.close);
    const h4Highs = h4.map((candle) => candle.high);
    const h4Lows = h4.map((candle) => candle.low);
    const atr4Arr = computeATR(h4Highs, h4Lows, h4Closes, 14);
    const atr4 = last(atr4Arr) ?? Number.NaN;
    const h4Close = last(h4Closes) ?? Number.NaN;
    const h4AtrPct = Number.isFinite(atr4) && Number.isFinite(h4Close) && h4Close > 0
        ? atr4 / h4Close
        : Number.NaN;
    const hardGatePass = Number.isFinite(h4AtrPct) && h4AtrPct >= H4_ATR_HARD_MIN_PCT;
    const recentVolumeAvg = mean(m5Volumes.slice(-20, -1));
    const volumeCurrent = last(m5Volumes) ?? Number.NaN;
    const volumeRatio = Number.isFinite(volumeCurrent) &&
        Number.isFinite(recentVolumeAvg) &&
        recentVolumeAvg > 0
        ? volumeCurrent / recentVolumeAvg
        : Number.NaN;
    const volumeSpikeOk = Number.isFinite(volumeRatio) && volumeRatio >= VOLUME_SPIKE_MIN;
    const h1AdxArr = computeADX(h1.map((candle) => candle.high), h1.map((candle) => candle.low), h1.map((candle) => candle.close), 14);
    const h1Adx = last(h1AdxArr) ?? Number.NaN;
    let baseScore = 0;
    if (direction !== "NONE")
        baseScore += 25;
    if (pullback.touched)
        baseScore += 20;
    if (microBreak.breakOk)
        baseScore += 20;
    if (volumeSpikeOk)
        baseScore += 10;
    if (atrExpansionOk)
        baseScore += 10;
    const setupValid = direction !== "NONE" &&
        family === "TREND_PULLBACK" &&
        trendAligned &&
        pullback.touched;
    const triggerValid = microBreak.pivotOk && microBreak.breakOk;
    const latestM5 = last(m5);
    const previousM5 = m5.length > 1 ? m5[m5.length - 2] : undefined;
    const entry = latestM5?.close ?? Number.NaN;
    const stopBuffer = Number.isFinite(atr5) && atr5 > 0 ? atr5 * 0.2 : entry * MIN_STOP_PCT;
    let sl = Number.NaN;
    if (direction === "BULL") {
        const structureLow = microBreak.correctionLow;
        sl = Number.isFinite(structureLow)
            ? Math.min(structureLow - stopBuffer, entry - entry * MIN_STOP_PCT)
            : entry - Math.max(stopBuffer, entry * MIN_STOP_PCT);
    }
    else if (direction === "BEAR") {
        const structureHigh = microBreak.correctionHigh;
        sl = Number.isFinite(structureHigh)
            ? Math.max(structureHigh + stopBuffer, entry + entry * MIN_STOP_PCT)
            : entry + Math.max(stopBuffer, entry * MIN_STOP_PCT);
    }
    const risk = Math.abs(entry - sl);
    const tp = Number.isFinite(risk) && risk > 0
        ? direction === "BULL"
            ? entry + risk * 2
            : direction === "BEAR"
                ? entry - risk * 2
                : Number.NaN
        : Number.NaN;
    const gates = [
        {
            name: "1H market regime",
            ok: h1Context.direction !== "RANGE",
            detail: `context ${h1Context.direction} | overlap ${Number.isFinite(h1Context.overlap) ? h1Context.overlap.toFixed(2) : "NaN"} | ADX ${Number.isFinite(h1Adx) ? h1Adx.toFixed(1) : "NaN"}`,
            hard: true,
        },
        {
            name: "4H bias",
            ok: bias4h.bias !== "NEUTRAL" && direction !== "NONE",
            detail: `bias ${bias4h.bias} | EMA50 ${Number.isFinite(bias4h.ema50) ? bias4h.ema50.toFixed(4) : "NaN"} | EMA200 ${Number.isFinite(bias4h.ema200) ? bias4h.ema200.toFixed(4) : "NaN"} | structure ${bias4h.structure}`,
            hard: true,
        },
        {
            name: "Trend family",
            ok: family === "TREND_PULLBACK",
            detail: family === "TREND_PULLBACK" ? "Trend Pullback" : "No trade",
            hard: true,
        },
        {
            name: "5m trend alignment",
            ok: trendAligned,
            detail: `15m ${m15Trend.direction} | 5m ${m5Trend.direction} | target ${direction}`,
            hard: true,
        },
        {
            name: "EMA pullback",
            ok: pullback.touched,
            detail: pullback.touched
                ? `EMA20 ${Number.isFinite(ema20) ? ema20.toFixed(4) : "NaN"} | EMA50 ${Number.isFinite(ema50) ? ema50.toFixed(4) : "NaN"}`
                : "zone untouched",
            hard: true,
        },
        {
            name: "Micro pivot",
            ok: microBreak.pivotOk,
            detail: Number.isFinite(microBreak.correctionHigh) || Number.isFinite(microBreak.correctionLow)
                ? `corrHi ${Number.isFinite(microBreak.correctionHigh) ? microBreak.correctionHigh.toFixed(4) : "NaN"} | corrLo ${Number.isFinite(microBreak.correctionLow) ? microBreak.correctionLow.toFixed(4) : "NaN"}`
                : "missing",
            hard: true,
        },
        {
            name: "Micro break",
            ok: microBreak.breakOk,
            detail: microBreak.breakOk ? "break confirmed" : "break missing",
            hard: true,
        },
        {
            name: "Volume spike",
            ok: volumeSpikeOk,
            detail: Number.isFinite(volumeRatio)
                ? `ratio ${volumeRatio.toFixed(2)}x`
                : "missing",
        },
        {
            name: "ATR expansion",
            ok: atrExpansionOk,
            detail: Number.isFinite(atrExpansionRatio)
                ? `ratio ${atrExpansionRatio.toFixed(2)}x | 4H ATR ${(h4AtrPct * 100).toFixed(2)}%`
                : "missing",
        },
    ];
    const preExecutionReady = hardGatePass &&
        setupValid &&
        triggerValid &&
        baseScore >= BBO_PREEXEC_THRESHOLD &&
        Number.isFinite(entry) &&
        Number.isFinite(sl) &&
        Number.isFinite(tp);
    let signal = null;
    if (preExecutionReady) {
        const side = direction === "BULL" ? "buy" : "sell";
        signal = {
            id: `${symbol}-bbo-${side}-${latestM5?.openTime ?? Date.now()}`,
            symbol,
            intent: {
                side,
                entry,
                sl,
                tp,
            },
            entryType: "LIMIT_MAKER_FIRST",
            kind: "PULLBACK",
            risk: 0.6,
            message: `BBO ${side.toUpperCase()} | base score ${baseScore}/${BBO_QUALITY_THRESHOLD} | RR 2.0`,
            createdAt: new Date().toISOString(),
        };
    }
    const baseCoreV2 = computeCoreV2(candles, {
        riskMode: "ai-matic-bbo",
    });
    const coreV2 = {
        ...baseCoreV2,
        pullbackLong: direction === "BULL" && pullback.touched,
        pullbackShort: direction === "BEAR" && pullback.touched,
        microBreakLong: direction === "BULL" && microBreak.breakOk,
        microBreakShort: direction === "BEAR" && microBreak.breakOk,
        pivotHigh: Number.isFinite(microBreak.correctionHigh)
            ? microBreak.correctionHigh
            : baseCoreV2.pivotHigh,
        pivotLow: Number.isFinite(microBreak.correctionLow)
            ? microBreak.correctionLow
            : baseCoreV2.pivotLow,
        lastPivotHigh: Number.isFinite(microBreak.correctionHigh)
            ? microBreak.correctionHigh
            : baseCoreV2.lastPivotHigh,
        lastPivotLow: Number.isFinite(microBreak.correctionLow)
            ? microBreak.correctionLow
            : baseCoreV2.lastPivotLow,
    };
    const bboContext = {
        h1Context: h1Context.direction,
        bias4h: bias4h.bias,
        direction,
        family,
        baseScore,
        qualityThreshold: BBO_QUALITY_THRESHOLD,
        hardGatePass,
        setupValid,
        triggerValid,
        gates,
        metrics: {
            h1Overlap: h1Context.overlap,
            h1Adx,
            h4AtrPct,
            m5AtrExpansionRatio: atrExpansionRatio,
            m5VolumeRatio: volumeRatio,
            ema20,
            ema50,
            correctionHigh: microBreak.correctionHigh,
            correctionLow: microBreak.correctionLow,
        },
    };
    return {
        state: signal ? State.Manage : State.Scan,
        trend: toTrend(direction === "NONE" ? h1Context.direction : direction),
        trendH1: toTrend(h1Context.direction),
        trendScore: baseScore,
        trendAdx: h1Adx,
        signal,
        halted: false,
        coreV2,
        bboContext,
    };
}
