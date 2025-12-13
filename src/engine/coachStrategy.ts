import { Candle } from "./botEngine";

export type CoachSignal = {
    intent: { side: "buy"; entry: number; sl: number; tp: number };
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

export const coachDefaults = DEFAULT_COACH_PARAMS;
