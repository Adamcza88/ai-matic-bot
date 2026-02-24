import { State, Trend, resampleCandles } from "./botEngine.js";
import { computeEma } from "./ta.js";
export const AMDPhase = {
    ACCUMULATION: "ACCUMULATION",
    MANIPULATION: "MANIPULATION",
    DISTRIBUTION: "DISTRIBUTION",
    NONE: "NONE",
};
const NY_TIMEZONE = "America/New_York";
const NY_FORMATTER = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TIMEZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
});
const toNum = (value) => Number.parseInt(value, 10);
const toDateKey = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const prevDateKey = (dateKey) => {
    const [yearRaw, monthRaw, dayRaw] = dateKey.split("-").map((v) => Number.parseInt(v, 10));
    if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || !Number.isFinite(dayRaw)) {
        return dateKey;
    }
    const utc = new Date(Date.UTC(yearRaw, monthRaw - 1, dayRaw));
    utc.setUTCDate(utc.getUTCDate() - 1);
    return toDateKey(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
};
const nyParts = (ts) => {
    const parts = NY_FORMATTER.formatToParts(new Date(ts));
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const year = toNum(map.get("year") ?? "0");
    const month = toNum(map.get("month") ?? "0");
    const day = toNum(map.get("day") ?? "0");
    const hour = toNum(map.get("hour") ?? "0");
    const minute = toNum(map.get("minute") ?? "0");
    return { year, month, day, hour, minute, dateKey: toDateKey(year, month, day) };
};
const resolveKillzoneName = (hourNy) => {
    if (hourNy >= 20 && hourNy < 24)
        return "ASIA";
    if (hourNy >= 2 && hourNy < 5)
        return "LONDON";
    if (hourNy >= 8 && hourNy < 11)
        return "NY_AM";
    return "NONE";
};
const isManipulationKillzone = (hourNy) => (hourNy >= 2 && hourNy < 5) || (hourNy >= 8 && hourNy < 11);
const resolveHtfBias = (candlesH1) => {
    if (candlesH1.length < 220)
        return "none";
    const closes = candlesH1.map((c) => c.close);
    const ema50 = computeEma(closes, 50);
    const ema200 = computeEma(closes, 200);
    const lastClose = closes[closes.length - 1];
    const e50 = ema50[ema50.length - 1];
    const e200 = ema200[ema200.length - 1];
    if (!Number.isFinite(lastClose) || !Number.isFinite(e50) || !Number.isFinite(e200)) {
        return "none";
    }
    if (lastClose > e50 && e50 > e200)
        return "bullish";
    if (lastClose < e50 && e50 < e200)
        return "bearish";
    return "none";
};
const findMidnightOpen = (candlesM15, sessionDate) => {
    const exact = candlesM15.find((candle) => {
        const ts = candle.openTime ?? candle.timestamp ?? 0;
        const parts = nyParts(ts);
        return parts.dateKey === sessionDate && parts.hour === 0 && parts.minute === 0;
    });
    if (exact && Number.isFinite(exact.open))
        return exact.open;
    const fallback = candlesM15.find((candle) => {
        const ts = candle.openTime ?? candle.timestamp ?? 0;
        const parts = nyParts(ts);
        return parts.dateKey === sessionDate && parts.hour === 0;
    });
    return fallback && Number.isFinite(fallback.open) ? fallback.open : null;
};
const resolveAccumulationRange = (candlesM15, asiaDate) => {
    const asia = candlesM15.filter((candle) => {
        const ts = candle.openTime ?? candle.timestamp ?? 0;
        const parts = nyParts(ts);
        return parts.dateKey === asiaDate && parts.hour >= 20;
    });
    if (!asia.length)
        return null;
    const high = Math.max(...asia.map((c) => c.high));
    const low = Math.min(...asia.map((c) => c.low));
    if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low)
        return null;
    return { high, low };
};
const calculateTarget = (n, manipLow, manipHigh, bias) => {
    if (!Number.isFinite(manipLow) || !Number.isFinite(manipHigh) || manipHigh <= manipLow) {
        return Number.NaN;
    }
    if (bias === "bullish")
        return manipLow + n * (manipHigh - manipLow);
    if (bias === "bearish")
        return manipHigh - n * (manipHigh - manipLow);
    return Number.NaN;
};
const detectFvgs = (candles) => {
    if (candles.length < 3)
        return [];
    const out = [];
    for (let i = 2; i < candles.length; i++) {
        const a = candles[i - 2];
        const c = candles[i];
        const createdAt = c.openTime ?? c.timestamp ?? Date.now();
        if (a.high < c.low) {
            const bottom = a.high;
            const top = c.low;
            out.push({
                top,
                bottom,
                direction: "bullish",
                createdAt,
                isMitigated: false,
            });
        }
        else if (a.low > c.high) {
            const bottom = c.high;
            const top = a.low;
            out.push({
                top,
                bottom,
                direction: "bearish",
                createdAt,
                isMitigated: false,
            });
        }
    }
    for (const fvg of out) {
        const start = candles.findIndex((c) => (c.openTime ?? c.timestamp ?? 0) >= fvg.createdAt);
        if (start < 0)
            continue;
        for (let i = start + 1; i < candles.length; i++) {
            const candle = candles[i];
            if (candle.low <= fvg.top && candle.high >= fvg.bottom) {
                fvg.isMitigated = true;
                break;
            }
        }
    }
    return out;
};
export function evaluateAiMaticAmdStrategyForSymbol(symbol, candles) {
    const h1 = resampleCandles(candles, 60);
    const m15 = resampleCandles(candles, 15);
    const m5 = resampleCandles(candles, 5);
    const m1 = resampleCandles(candles, 1);
    if (!h1.length || !m15.length || !m5.length || !m1.length) {
        return {
            state: State.Scan,
            trend: Trend.Range,
            trendH1: Trend.Range,
            trendScore: 0,
            trendAdx: Number.NaN,
            signal: null,
            halted: true,
            amdContext: {
                phase: AMDPhase.NONE,
                bias: "none",
                sessionNyDate: "",
                killzoneActive: false,
                killzoneName: "NONE",
                midnightOpen: null,
                accumulationRange: null,
                manipulation: { detected: false, low: null, high: null, timestamp: null },
                fvg: null,
                targets: null,
                gates: {
                    phaseSequence: false,
                    killzoneActive: false,
                    midnightOpenSet: false,
                    asiaRangeValid: false,
                    liquiditySweep: false,
                    inversionFvgConfirm: false,
                    targetModelValid: false,
                },
                details: ["insufficient_data"],
            },
        };
    }
    const bias = resolveHtfBias(h1);
    const lastM1 = m1[m1.length - 1];
    const nowNy = nyParts(lastM1.openTime ?? lastM1.timestamp ?? Date.now());
    const sessionNyDate = nowNy.dateKey;
    const asiaDate = nowNy.hour >= 20 ? sessionNyDate : prevDateKey(sessionNyDate);
    const killzoneName = resolveKillzoneName(nowNy.hour);
    const killzoneActive = killzoneName === "LONDON" || killzoneName === "NY_AM";
    const midnightOpen = findMidnightOpen(m15, sessionNyDate);
    const accumulationRange = resolveAccumulationRange(m15, asiaDate);
    const asiaRangeValid = Boolean(accumulationRange &&
        Number.isFinite(accumulationRange.high) &&
        Number.isFinite(accumulationRange.low) &&
        accumulationRange.high > accumulationRange.low);
    let manipulationDetected = false;
    let manipulationLow = null;
    let manipulationHigh = null;
    let manipulationTs = null;
    if (bias !== "none" && Number.isFinite(midnightOpen ?? Number.NaN) && accumulationRange) {
        const sessionManipCandles = m5.filter((candle) => {
            const ts = candle.openTime ?? candle.timestamp ?? 0;
            const parts = nyParts(ts);
            return parts.dateKey === sessionNyDate && isManipulationKillzone(parts.hour);
        });
        for (let i = sessionManipCandles.length - 1; i >= 0; i--) {
            const candle = sessionManipCandles[i];
            if (bias === "bullish") {
                if (candle.low < midnightOpen &&
                    candle.low < accumulationRange.low) {
                    manipulationDetected = true;
                    manipulationLow = candle.low;
                    manipulationHigh = Math.max(candle.high, accumulationRange.high);
                    manipulationTs = candle.openTime ?? candle.timestamp ?? Date.now();
                    break;
                }
            }
            else if (bias === "bearish") {
                if (candle.high > midnightOpen &&
                    candle.high > accumulationRange.high) {
                    manipulationDetected = true;
                    manipulationLow = Math.min(candle.low, accumulationRange.low);
                    manipulationHigh = candle.high;
                    manipulationTs = candle.openTime ?? candle.timestamp ?? Date.now();
                    break;
                }
            }
        }
    }
    const fvgs = detectFvgs(m1);
    const fvgCandidate = fvgs
        .slice()
        .reverse()
        .find((fvg) => {
        if (!Number.isFinite(manipulationTs ?? Number.NaN))
            return false;
        if (fvg.createdAt < manipulationTs)
            return false;
        if (fvg.isMitigated)
            return false;
        if (bias === "bullish")
            return fvg.direction === "bearish";
        if (bias === "bearish")
            return fvg.direction === "bullish";
        return false;
    });
    const currentPrice = lastM1.close;
    const inversionConfirm = Boolean(fvgCandidate &&
        ((bias === "bullish" && currentPrice > fvgCandidate.top) ||
            (bias === "bearish" && currentPrice < fvgCandidate.bottom)));
    const fvgContext = fvgCandidate
        ? ({ ...fvgCandidate, confirmed: inversionConfirm })
        : null;
    const tp1 = manipulationDetected && bias !== "none"
        ? calculateTarget(1, manipulationLow, manipulationHigh, bias)
        : Number.NaN;
    const tp2 = manipulationDetected && bias !== "none"
        ? calculateTarget(2, manipulationLow, manipulationHigh, bias)
        : Number.NaN;
    const targetModelValid = Number.isFinite(tp1) && Number.isFinite(tp2);
    let phase = AMDPhase.NONE;
    if (asiaRangeValid)
        phase = AMDPhase.ACCUMULATION;
    if (manipulationDetected)
        phase = AMDPhase.MANIPULATION;
    if (manipulationDetected && inversionConfirm && killzoneActive) {
        phase = AMDPhase.DISTRIBUTION;
    }
    const gates = {
        phaseSequence: phase === AMDPhase.DISTRIBUTION && asiaRangeValid && manipulationDetected,
        killzoneActive,
        midnightOpenSet: Number.isFinite(midnightOpen ?? Number.NaN),
        asiaRangeValid,
        liquiditySweep: manipulationDetected,
        inversionFvgConfirm: inversionConfirm,
        targetModelValid,
    };
    const details = [
        `bias ${bias}`,
        `session ${sessionNyDate}`,
        `killzone ${killzoneName}`,
        `phase ${phase}`,
    ];
    let signal = null;
    if (gates.phaseSequence &&
        gates.midnightOpenSet &&
        gates.asiaRangeValid &&
        gates.liquiditySweep &&
        gates.inversionFvgConfirm &&
        gates.targetModelValid) {
        const side = bias === "bullish" ? "buy" : "sell";
        const sl = bias === "bullish" ? manipulationLow : manipulationHigh;
        const stableKey = `${symbol}-amd-${sessionNyDate}-${bias}-${Math.round(manipulationTs)}`;
        signal = {
            id: stableKey,
            symbol,
            intent: {
                side,
                entry: currentPrice,
                sl,
                tp: tp2,
            },
            entryType: "LIMIT_MAKER_FIRST",
            kind: "MEAN_REVERSION",
            risk: 0.6,
            message: `AMD ${phase} ${bias} | KZ ${killzoneName} | TP1 ${tp1.toFixed(4)} TP2 ${tp2.toFixed(4)}`,
            createdAt: new Date().toISOString(),
        };
    }
    const trend = bias === "bullish"
        ? Trend.Bull
        : bias === "bearish"
            ? Trend.Bear
            : Trend.Range;
    const amdContext = {
        phase,
        bias,
        sessionNyDate,
        killzoneActive,
        killzoneName,
        midnightOpen,
        accumulationRange,
        manipulation: {
            detected: manipulationDetected,
            low: manipulationLow,
            high: manipulationHigh,
            timestamp: manipulationTs,
        },
        fvg: fvgContext,
        targets: targetModelValid ? { tp1, tp2 } : null,
        gates,
        details,
    };
    return {
        state: signal ? State.Manage : State.Scan,
        trend,
        trendH1: trend,
        trendScore: signal ? 1 : 0,
        trendAdx: Number.NaN,
        signal,
        halted: false,
        amdContext,
    };
}
export const __aiMaticAmdTest = {
    nyParts,
    resolveKillzoneName,
    resolveHtfBias,
    findMidnightOpen,
    resolveAccumulationRange,
    calculateTarget,
    detectFvgs,
};
