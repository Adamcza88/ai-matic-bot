import { State, Trend, resampleCandles, } from "./botEngine.js";
import { computeAtr, computeEma } from "./ta.js";
const H4_MINUTES = 240;
const BREAKOUT_PCT = 0.004;
const BREAKOUT_VOLUME_MULT = 1.3;
const EXHAUSTION_DISTANCE_PCT = 0.09;
const EXHAUSTION_VOLUME_MULT = 1.5;
const BASE_MIN = 4;
const BASE_MAX = 12;
function toTrend(direction) {
    if (direction === "BUY")
        return Trend.Bull;
    if (direction === "SELL")
        return Trend.Bear;
    return Trend.Range;
}
function mean(values) {
    if (!values.length)
        return Number.NaN;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function safeRatio(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return Number.NaN;
    }
    return numerator / denominator;
}
function buildSma(values, period) {
    return values.map((_, index) => {
        const start = Math.max(0, index - period + 1);
        const slice = values.slice(start, index + 1);
        return mean(slice);
    });
}
function detectDirection(closes, ema10, ema20) {
    const last = closes.length - 1;
    if (last < 3)
        return "NONE";
    const slope10 = safeRatio(ema10[last] - ema10[last - 3], ema10[last - 3]);
    const slope20 = safeRatio(ema20[last] - ema20[last - 3], ema20[last - 3]);
    const close = closes[last];
    const longOk = close > ema10[last] &&
        ema10[last] > ema20[last] &&
        Number.isFinite(slope10) &&
        Number.isFinite(slope20) &&
        slope10 > 0 &&
        slope20 > 0;
    const shortOk = close < ema10[last] &&
        ema10[last] < ema20[last] &&
        Number.isFinite(slope10) &&
        Number.isFinite(slope20) &&
        slope10 < 0 &&
        slope20 < 0;
    if (longOk)
        return "BUY";
    if (shortOk)
        return "SELL";
    return "NONE";
}
function detectBaseNBreak(args) {
    const { bars, ema10, ema20, volumeSma20, side } = args;
    const last = bars.length - 1;
    if (last < BASE_MAX + 1)
        return null;
    const signal = bars[last];
    for (let baseSize = BASE_MAX; baseSize >= BASE_MIN; baseSize -= 1) {
        const baseStart = last - baseSize;
        const baseEnd = last - 1;
        if (baseStart < 1)
            continue;
        const base = bars.slice(baseStart, baseEnd + 1);
        const baseEma10 = ema10.slice(baseStart, baseEnd + 1);
        const baseEma20 = ema20.slice(baseStart, baseEnd + 1);
        const highs = base.map((bar) => bar.high);
        const lows = base.map((bar) => bar.low);
        const closes = base.map((bar) => bar.close);
        const pivot = side === "buy" ? Math.max(...highs) : Math.min(...lows);
        const baseLow = Math.min(...lows);
        const baseHigh = Math.max(...highs);
        const rangePct = safeRatio(baseHigh - baseLow, mean(closes));
        if (!Number.isFinite(rangePct) || rangePct > 0.08)
            continue;
        const nearEma = base.every((bar, idx) => {
            const zoneLow = Math.min(baseEma10[idx], baseEma20[idx]) * 0.99;
            const zoneHigh = Math.max(baseEma10[idx], baseEma20[idx]) * 1.01;
            return bar.close >= zoneLow && bar.close <= zoneHigh * 1.015;
        });
        if (!nearEma)
            continue;
        const breakoutOk = side === "buy"
            ? signal.close >= pivot * (1 + BREAKOUT_PCT)
            : signal.close <= pivot * (1 - BREAKOUT_PCT);
        if (!breakoutOk)
            continue;
        const volSma = volumeSma20[last];
        const volOk = Number.isFinite(volSma) &&
            volSma > 0 &&
            signal.volume >= volSma * BREAKOUT_VOLUME_MULT;
        if (!volOk)
            continue;
        const stop = side === "buy" ? baseLow : baseHigh;
        return {
            ok: true,
            pattern: "BASE_N_BREAK",
            side,
            stop,
            pivot,
            detail: `size ${baseSize} | breakout 0.4% | vol>=1.3x`,
        };
    }
    return null;
}
function detectWedgePop(args) {
    const { bars, ema10, ema20, volumeSma20, side } = args;
    const last = bars.length - 1;
    if (last < 8)
        return null;
    const setup = bars.slice(last - 6, last);
    const highs = setup.map((bar) => bar.high);
    const lows = setup.map((bar) => bar.low);
    const ranges = setup.map((bar) => bar.high - bar.low);
    const firstHalfRange = mean(ranges.slice(0, 3));
    const secondHalfRange = mean(ranges.slice(-3));
    if (!Number.isFinite(firstHalfRange) || !Number.isFinite(secondHalfRange)) {
        return null;
    }
    if (secondHalfRange > firstHalfRange * 0.85)
        return null;
    const firstHigh = Math.max(...highs.slice(0, 3));
    const secondHigh = Math.max(...highs.slice(-3));
    const firstLow = Math.min(...lows.slice(0, 3));
    const secondLow = Math.min(...lows.slice(-3));
    const narrowing = side === "buy"
        ? secondHigh <= firstHigh && secondLow >= firstLow
        : secondLow >= firstLow && secondHigh <= firstHigh;
    if (!narrowing)
        return null;
    const emaNear = setup.every((bar, idx) => {
        const sourceIdx = last - 6 + idx;
        const zoneLow = Math.min(ema10[sourceIdx], ema20[sourceIdx]) * 0.988;
        const zoneHigh = Math.max(ema10[sourceIdx], ema20[sourceIdx]) * 1.012;
        return bar.close >= zoneLow && bar.close <= zoneHigh;
    });
    if (!emaNear)
        return null;
    const signal = bars[last];
    const pivot = side === "buy" ? Math.max(...highs) : Math.min(...lows);
    const breakoutOk = side === "buy"
        ? signal.close >= pivot * (1 + BREAKOUT_PCT)
        : signal.close <= pivot * (1 - BREAKOUT_PCT);
    if (!breakoutOk)
        return null;
    const volSma = volumeSma20[last];
    const volOk = Number.isFinite(volSma) &&
        volSma > 0 &&
        signal.volume >= volSma * BREAKOUT_VOLUME_MULT;
    if (!volOk)
        return null;
    return {
        ok: true,
        pattern: "WEDGE_POP",
        side,
        stop: side === "buy" ? Math.min(...lows) : Math.max(...highs),
        pivot,
        detail: `narrowing wedge | breakout 0.4% | vol>=1.3x`,
    };
}
function detectEmaCrossback(args) {
    const { bars, ema10, ema20, side } = args;
    const last = bars.length - 1;
    if (last < 12)
        return null;
    const signal = bars[last];
    const lookback = bars.slice(last - 8, last);
    const zoneTouches = lookback
        .map((bar, idx) => {
        const sourceIdx = last - 8 + idx;
        const zoneLow = Math.min(ema10[sourceIdx], ema20[sourceIdx]) * 0.997;
        const zoneHigh = Math.max(ema10[sourceIdx], ema20[sourceIdx]) * 1.003;
        const touched = bar.low <= zoneHigh && bar.high >= zoneLow;
        return { touched, bar };
    })
        .filter((item) => item.touched);
    if (zoneTouches.length < 2 || zoneTouches.length > 8)
        return null;
    const rejectionOk = side === "buy"
        ? signal.close > signal.open && signal.close > ema10[last]
        : signal.close < signal.open && signal.close < ema10[last];
    if (!rejectionOk)
        return null;
    const stop = side === "buy"
        ? Math.min(...zoneTouches.map((item) => item.bar.low))
        : Math.max(...zoneTouches.map((item) => item.bar.high));
    return {
        ok: true,
        pattern: "EMA_CROSSBACK",
        side,
        stop,
        pivot: signal.close,
        detail: `pullback 2-8 bars into EMA10/20`,
    };
}
function detectExhaustion(args) {
    const { close, ema10, volume, volumeSma20 } = args;
    const distancePct = safeRatio(Math.abs(close - ema10), ema10);
    const volumeRatio = safeRatio(volume, volumeSma20);
    const active = Number.isFinite(distancePct) &&
        distancePct >= EXHAUSTION_DISTANCE_PCT &&
        Number.isFinite(volumeRatio) &&
        volumeRatio >= EXHAUSTION_VOLUME_MULT;
    const direction = close > ema10 ? "BUY" : close < ema10 ? "SELL" : "NONE";
    return { active, direction: active ? direction : "NONE", distancePct, volumeRatio };
}
function detectWedgeDrop(args) {
    const { bars, ema20, volumeSma20 } = args;
    const last = bars.length - 1;
    if (last < 8)
        return { againstLong: false, againstShort: false };
    const setup = bars.slice(last - 6, last);
    const ranges = setup.map((bar) => bar.high - bar.low);
    const narrowing = mean(ranges.slice(-3)) <= mean(ranges.slice(0, 3)) * 0.8;
    if (!narrowing)
        return { againstLong: false, againstShort: false };
    const signal = bars[last];
    const volSma = volumeSma20[last];
    const volOk = Number.isFinite(volSma) &&
        volSma > 0 &&
        signal.volume >= volSma * BREAKOUT_VOLUME_MULT;
    if (!volOk)
        return { againstLong: false, againstShort: false };
    const setupLow = Math.min(...setup.map((bar) => bar.low));
    const setupHigh = Math.max(...setup.map((bar) => bar.high));
    const ema = ema20[last];
    return {
        againstLong: signal.close < setupLow &&
            Number.isFinite(ema) &&
            signal.close < ema,
        againstShort: signal.close > setupHigh &&
            Number.isFinite(ema) &&
            signal.close > ema,
    };
}
function toSignal(args) {
    const { symbol, side, pattern, entry, atr } = args;
    const atrBuffer = Number.isFinite(atr) && atr > 0 ? atr * 0.2 : 0;
    const stopRaw = side === "buy" ? pattern.stop - atrBuffer : pattern.stop + atrBuffer;
    const risk = Math.abs(entry - stopRaw);
    if (!Number.isFinite(risk) || risk <= 0)
        return null;
    const tp = side === "buy" ? entry + risk * 2 : entry - risk * 2;
    const kind = pattern.pattern === "EMA_CROSSBACK" ? "PULLBACK" : "BREAKOUT";
    return {
        id: `${symbol}:olikella:${Date.now()}`,
        symbol,
        intent: { side, entry, sl: stopRaw, tp },
        kind,
        entryType: pattern.pattern === "EMA_CROSSBACK" ? "LIMIT_MAKER_FIRST" : "CONDITIONAL",
        risk: 1.5,
        message: `OLIkella ${pattern.pattern} ${side.toUpperCase()} | ${pattern.detail}`,
        createdAt: new Date().toISOString(),
    };
}
export function evaluateAiMaticOliKellaStrategyForSymbol(symbol, candles) {
    const h4 = resampleCandles(candles, H4_MINUTES);
    if (h4.length < 40) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            trendH1: Trend.Range,
            trendScore: 0,
            trendAdx: Number.NaN,
            signal: null,
            halted: true,
            oliKella: {
                timeframe: "4h",
                direction: "NONE",
                trendOk: false,
                trendLegId: "NONE",
                ema10: Number.NaN,
                atr14: Number.NaN,
                selectedPattern: null,
                baseBreak: null,
                wedgePop: null,
                emaCrossback: null,
                oppositeCrossbackLong: false,
                oppositeCrossbackShort: false,
                exhaustion: {
                    active: false,
                    direction: "NONE",
                    distancePct: Number.NaN,
                    volumeRatio: Number.NaN,
                },
                wedgeDrop: {
                    againstLong: false,
                    againstShort: false,
                },
                gates: {
                    signalChecklistOk: false,
                    signalChecklistDetail: "need >=40 bars",
                    entryConditionsOk: false,
                    entryConditionsDetail: "insufficient 4h history",
                    exitConditionsOk: false,
                    exitConditionsDetail: "insufficient 4h history",
                    riskRulesOk: true,
                    riskRulesDetail: "1.5% risk | max positions 5 | max orders 20",
                },
                canScaleIn: false,
            },
        };
    }
    const closes = h4.map((bar) => bar.close);
    const highs = h4.map((bar) => bar.high);
    const lows = h4.map((bar) => bar.low);
    const volumes = h4.map((bar) => bar.volume);
    const ema10 = computeEma(closes, 10);
    const ema20 = computeEma(closes, 20);
    const atr = computeAtr(h4, 14);
    const volumeSma20 = buildSma(volumes, 20);
    const last = h4.length - 1;
    const direction = detectDirection(closes, ema10, ema20);
    const trendOk = direction !== "NONE";
    const baseBreakLong = detectBaseNBreak({
        bars: h4,
        ema10,
        ema20,
        volumeSma20,
        side: "buy",
    });
    const baseBreakShort = detectBaseNBreak({
        bars: h4,
        ema10,
        ema20,
        volumeSma20,
        side: "sell",
    });
    const wedgePopLong = detectWedgePop({
        bars: h4,
        ema10,
        ema20,
        volumeSma20,
        side: "buy",
    });
    const wedgePopShort = detectWedgePop({
        bars: h4,
        ema10,
        ema20,
        volumeSma20,
        side: "sell",
    });
    const crossbackLong = detectEmaCrossback({
        bars: h4,
        ema10,
        ema20,
        side: "buy",
    });
    const crossbackShort = detectEmaCrossback({
        bars: h4,
        ema10,
        ema20,
        side: "sell",
    });
    const exhaustion = detectExhaustion({
        close: closes[last],
        ema10: ema10[last],
        volume: volumes[last],
        volumeSma20: volumeSma20[last],
    });
    const wedgeDrop = detectWedgeDrop({
        bars: h4,
        ema20,
        volumeSma20,
    });
    const priorityLong = [wedgePopLong, baseBreakLong, crossbackLong].filter((item) => Boolean(item?.ok));
    const priorityShort = [wedgePopShort, baseBreakShort, crossbackShort].filter((item) => Boolean(item?.ok));
    const selected = direction === "BUY"
        ? priorityLong[0] ?? null
        : direction === "SELL"
            ? priorityShort[0] ?? null
            : null;
    const entry = closes[last];
    const signal = selected && Number.isFinite(entry)
        ? toSignal({
            symbol,
            side: selected.side,
            pattern: selected,
            entry,
            atr: atr[last],
        })
        : null;
    const trendAnchor = direction === "BUY"
        ? Math.min(...lows.slice(-20))
        : direction === "SELL"
            ? Math.max(...highs.slice(-20))
            : Number.NaN;
    const trendLegId = Number.isFinite(trendAnchor)
        ? `${direction}:${trendAnchor.toFixed(2)}`
        : "NONE";
    const checklistDetail = selected
        ? `${selected.pattern} selected (priority Wedge Pop > Base 'n Break > EMA Crossback)`
        : "no valid pattern on latest 4h candle";
    const entryDetail = trendOk
        ? `${direction} trend aligned EMA10/20 | breakout 0.4% | volume >=1.3x`
        : "EMA10/20 trend alignment missing";
    const exitReady = Number.isFinite(ema10[last]) && Number.isFinite(atr[last]);
    const exitDetail = exhaustion.active
        ? `exhaustion ${Math.round(exhaustion.distancePct * 100)}% from EMA10 | vol ${exhaustion.volumeRatio.toFixed(2)}x`
        : "watch exhaustion >=9% + vol>=1.5x, opposite crossback, wedge drop";
    const context = {
        timeframe: "4h",
        direction,
        trendOk,
        trendLegId,
        ema10: ema10[last],
        atr14: atr[last],
        selectedPattern: selected?.pattern ?? null,
        baseBreak: direction === "BUY"
            ? baseBreakLong
            : direction === "SELL"
                ? baseBreakShort
                : null,
        wedgePop: direction === "BUY"
            ? wedgePopLong
            : direction === "SELL"
                ? wedgePopShort
                : null,
        emaCrossback: direction === "BUY"
            ? crossbackLong
            : direction === "SELL"
                ? crossbackShort
                : null,
        oppositeCrossbackLong: Boolean(crossbackShort?.ok),
        oppositeCrossbackShort: Boolean(crossbackLong?.ok),
        exhaustion: {
            active: exhaustion.active,
            direction: exhaustion.direction,
            distancePct: exhaustion.distancePct,
            volumeRatio: exhaustion.volumeRatio,
        },
        wedgeDrop,
        gates: {
            signalChecklistOk: Boolean(selected),
            signalChecklistDetail: checklistDetail,
            entryConditionsOk: trendOk && Boolean(selected),
            entryConditionsDetail: entryDetail,
            exitConditionsOk: exitReady,
            exitConditionsDetail: exitDetail,
            riskRulesOk: true,
            riskRulesDetail: "risk 1.5% | max positions 5 | max orders 20",
        },
        canScaleIn: trendOk && Boolean(selected),
    };
    return {
        state: signal ? State.Manage : State.Scan,
        trend: toTrend(direction),
        trendH1: toTrend(direction),
        trendScore: signal ? 1 : 0,
        trendAdx: Number.NaN,
        signal,
        halted: false,
        oliKella: context,
    };
}
export const __aiMaticOliKellaTest = {
    detectBaseNBreak,
    detectWedgePop,
    detectEmaCrossback,
    detectExhaustion,
    detectWedgeDrop,
};
