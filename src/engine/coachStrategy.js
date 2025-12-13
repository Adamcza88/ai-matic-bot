// JS runtime mirror of coachStrategy.ts for node --test without ts-node
export const coachDefaults = {
    baseWindow: 10,
    volumeMultiplier: 1.5,
    breakoutBufferPct: 0.0015,
    tpRiskMultiple: 2.2,
    minTpPct: 0.003,
};

function ema(values, period) {
    const k = 2 / (period + 1);
    const res = [];
    values.forEach((v, i) => {
        if (i === 0) {
            res.push(v);
        } else {
            res.push(v * k + res[i - 1] * (1 - k));
        }
    });
    return res;
}

export function detectCoachBreakout(candles, params = coachDefaults) {
    if (!Array.isArray(candles) || candles.length < Math.max(30, params.baseWindow + 5)) return null;
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
    const breakout = lastClose > breakoutThreshold && lastClose > ema10 && lastClose > ema20;
    const emaAligned = ema10 > ema20;

    if (!breakout || !volStrong || !emaAligned) return null;
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

function lastMatchingDay(days, targetWeekday) {
    for (let i = days.length - 1; i >= 0; i--) {
        const d = new Date(days[i].time).getUTCDay();
        if (d === targetWeekday) {
            return { idx: i, day: days[i] };
        }
    }
    return null;
}

export function detectSituationalEdges(daily, currentPrice) {
    if (!Array.isArray(daily) || daily.length < 3) return null;
    const days = daily.map((d) => ({ time: d.openTime, high: d.high, low: d.low }));

    const friday = lastMatchingDay(days, 5);
    const thursday = friday && friday.idx > 0 ? { idx: friday.idx - 1, day: days[friday.idx - 1] } : null;
    if (friday && thursday) {
        if (friday.day.high < thursday.day.high && currentPrice > friday.day.low) {
            const sl = Math.max(friday.day.high, thursday.day.high);
            return {
                intent: { side: "sell", entry: currentPrice, sl, tp: friday.day.low },
                message: "Situational edge: Friday High < Thursday High → target Friday Low on Monday",
            };
        }
    }

    const wednesday = lastMatchingDay(days, 3);
    let monday = null;
    if (wednesday) {
        for (let i = wednesday.idx - 1; i >= 0; i--) {
            const dow = new Date(days[i].time).getUTCDay();
            if (dow === 1) {
                monday = { idx: i, day: days[i] };
                break;
            }
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
    }

    return null;
}
