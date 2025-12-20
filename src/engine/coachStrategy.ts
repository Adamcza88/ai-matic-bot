import { Candle } from "./botEngine";

export type CoachSignal = {
    intent: { side: "buy" | "sell"; entry: number; sl: number; tp: number };
    message: string;
};

export type CoachParams = {
    baseWindow: number;
    volumeMultiplier: number;
    breakoutBufferPct: number;
    tpRiskMultiple: number;
    minTpPct: number;
};

const DEFAULT_COACH_PARAMS: CoachParams = {
    baseWindow: 10,
    volumeMultiplier: 1.5,
    breakoutBufferPct: 0.0015, // 0.15% above base high
    tpRiskMultiple: 2.2,
    minTpPct: 0.003, // 0.3%
};

function ema(values: number[], period: number): number[] {
    const k = 2 / (period + 1);
    const res: number[] = [];
    values.forEach((v, i) => {
        if (i === 0) {
            res.push(v);
        } else {
            res.push(v * k + res[i - 1] * (1 - k));
        }
    });
    return res;
}

export function detectCoachBreakout(
    candles: Candle[],
    params: CoachParams = DEFAULT_COACH_PARAMS
): CoachSignal | null {
    if (candles.length < Math.max(30, params.baseWindow + 5)) return null;
    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume || 0);

    const ema10Arr = ema(closes, 10);
    const ema20Arr = ema(closes, 20);
    const lastIdx = candles.length - 1;
    const lastClose = closes[lastIdx];
    const lastVolume = volumes[lastIdx];
    const ema10 = ema10Arr[lastIdx];
    const ema20 = ema20Arr[lastIdx];

    const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volStrong = avgVol > 0 && lastVolume >= params.volumeMultiplier * avgVol;

    const priorHigh = Math.max(...highs.slice(-(params.baseWindow + 1), -1));
    const baseLow = Math.min(...lows.slice(-(params.baseWindow + 1), -1));
    const breakoutThreshold = priorHigh * (1 + params.breakoutBufferPct);
    const breakout =
        lastClose > breakoutThreshold && lastClose > ema10 && lastClose > ema20;
    const breakdownThreshold = baseLow * (1 - params.breakoutBufferPct);
    const breakdown = lastClose < breakdownThreshold && lastClose < ema10 && lastClose < ema20;
    const emaAlignedUp = ema10 > ema20;
    const emaAlignedDown = ema10 < ema20;

    if (breakout && volStrong && emaAlignedUp) {
        if (!Number.isFinite(baseLow) || baseLow <= 0 || lastClose <= baseLow) return null;
        const entry = lastClose;
        const sl = baseLow;
        const riskPerUnit = entry - sl;
        const tp = entry + Math.max(riskPerUnit * params.tpRiskMultiple, entry * params.minTpPct);
        return {
            intent: { side: "buy", entry, sl, tp },
            message: `Coach breakout @ ${entry.toFixed(4)} | vol x${(lastVolume / Math.max(avgVol, 1e-8)).toFixed(2)}`,
        };
    }

    if (breakdown && volStrong && emaAlignedDown) {
        if (!Number.isFinite(priorHigh) || priorHigh <= 0 || lastClose >= priorHigh) return null;
        const entry = lastClose;
        const sl = priorHigh;
        const riskPerUnit = sl - entry;
        const tp = entry - Math.max(riskPerUnit * params.tpRiskMultiple, entry * params.minTpPct);
        return {
            intent: { side: "sell", entry, sl, tp },
            message: `Coach breakdown @ ${entry.toFixed(4)} | vol x${(lastVolume / Math.max(avgVol, 1e-8)).toFixed(2)}`,
        };
    }

    return null;
}

export const coachDefaults = DEFAULT_COACH_PARAMS;

// ========== Situational Analysis (daily highs/lows rules) ==========
export type SituationalSignal = {
    intent: { side: "sell" | "buy"; entry: number; sl: number; tp: number };
    message: string;
};

type DayOHLC = {
    time: number;
    high: number;
    low: number;
};

function lastMatchingDay(
    days: DayOHLC[],
    targetWeekday: number
): { idx: number; day: DayOHLC } | null {
    for (let i = days.length - 1; i >= 0; i--) {
        const d = new Date(days[i].time).getUTCDay();
        if (d === targetWeekday) {
            return { idx: i, day: days[i] };
        }
    }
    return null;
}

export function detectSituationalEdges(
    daily: { openTime: number; high: number; low: number; close?: number }[],
    currentPrice: number,
    currentDate: Date
): SituationalSignal | null {
    if (!Array.isArray(daily) || daily.length < 3) return null;

    const currentDay = currentDate.getUTCDay(); // Sunday = 0, Monday = 1, etc.

    const days: DayOHLC[] = daily.map((d) => ({
        time: d.openTime,
        high: d.high,
        low: d.low,
    }));

    // Rule 1: Friday-Thursday setup, traded on Monday
    if (currentDay === 1) { // Monday
        const friday = lastMatchingDay(days, 5);
        const thursday =
            friday && friday.idx > 0
                ? { idx: friday.idx - 1, day: days[friday.idx - 1] }
                : null;

        if (friday && thursday) {
            if (friday.day.high < thursday.day.high && currentPrice > friday.day.low) {
                const sl = Math.max(friday.day.high, thursday.day.high);
                return {
                    intent: { side: "sell", entry: currentPrice, sl, tp: friday.day.low },
                    message: "Situational edge: Friday High < Thursday High → target Friday Low on Monday",
                };
            }

            if (friday.day.low > thursday.day.low && currentPrice < friday.day.high) {
                const sl = Math.min(friday.day.low, thursday.day.low);
                return {
                    intent: { side: "buy", entry: currentPrice, sl, tp: friday.day.high },
                    message: "Situational edge: Friday Low > Thursday Low → target Friday High on Monday",
                };
            }
        }
    }

    // Rule 2: Wednesday-Monday setup, traded on Thursday
    if (currentDay === 4) { // Thursday
        const wednesday = lastMatchingDay(days, 3);
        let monday: { idx: number; day: DayOHLC } | null = null;
        if (wednesday) {
            for (let i = wednesday.idx - 1; i >= 0; i--) {
                const dow = new Date(days[i].time).getUTCDay();
                if (dow === 1) {
                    monday = { idx: i, day: days[i] };
                    break;
                }
                // stop if we passed further back than a week
                if (wednesday.idx - i > 6) break;
            }
        }

        if (wednesday && monday) {
            if (wednesday.day.high < monday.day.high && currentPrice > wednesday.day.low) {
                const sl = Math.max(wednesday.day.high, monday.day.high);
                return {
                    intent: { side: "sell", entry: currentPrice, sl, tp: wednesday.day.low },
                    message: "Situational edge: Wednesday High < Monday High → target Wednesday Low on Thursday",
                };
            }

            if (wednesday.day.low > monday.day.low && currentPrice < wednesday.day.high) {
                const sl = Math.min(wednesday.day.low, monday.day.low);
                return {
                    intent: { side: "buy", entry: currentPrice, sl, tp: wednesday.day.high },
                    message: "Situational edge: Wednesday Low > Monday Low → target Wednesday High on Thursday",
                };
            }
        }
    }

    return null;
}
