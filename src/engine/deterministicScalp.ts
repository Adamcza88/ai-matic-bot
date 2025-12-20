import { Ohlcv, computeAtr, computeEma, findLastPivotHigh, findLastPivotLow } from "./ta";

export { Ohlcv, computeEma, findLastPivotHigh, findLastPivotLow };

export function computeSma(values: number[], period: number): number[] {
  if (!values.length) return [];
  const out: number[] = new Array(values.length).fill(0);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    const denom = Math.min(period, i + 1);
    out[i] = sum / Math.max(1, denom);
  }
  return out;
}

export type SuperTrendDir = "UP" | "DOWN";

export type SuperTrendSeries = {
  dir: SuperTrendDir[];
  line: number[];
  upper: number[];
  lower: number[];
  atr: number[];
};

export function computeSuperTrend(
  candles: Ohlcv[],
  atrPeriod: number,
  multiplier: number
): SuperTrendSeries {
  const n = candles.length;
  const dir: SuperTrendDir[] = new Array(n).fill("DOWN");
  const line: number[] = new Array(n).fill(0);
  const upper: number[] = new Array(n).fill(0);
  const lower: number[] = new Array(n).fill(0);
  const atr = computeAtr(candles, atrPeriod);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + multiplier * (atr[i] || 0);
    const basicLower = hl2 - multiplier * (atr[i] || 0);

    if (i === 0) {
      upper[i] = basicUpper;
      lower[i] = basicLower;
      line[i] = basicUpper;
      dir[i] = "DOWN";
      continue;
    }

    const prevClose = candles[i - 1].close;
    upper[i] =
      basicUpper < upper[i - 1] || prevClose > upper[i - 1]
        ? basicUpper
        : upper[i - 1];
    lower[i] =
      basicLower > lower[i - 1] || prevClose < lower[i - 1]
        ? basicLower
        : lower[i - 1];

    const prevLine = line[i - 1];
    if (prevLine === upper[i - 1]) {
      line[i] = c.close <= upper[i] ? upper[i] : lower[i];
    } else {
      line[i] = c.close >= lower[i] ? lower[i] : upper[i];
    }

    dir[i] = line[i] === lower[i] ? "UP" : "DOWN";
  }

  return { dir, line, upper, lower, atr };
}

export function roundDownToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
  const precision = Math.round(1 / step);
  return Math.floor(value * precision) / precision;
}

export function roundToTick(value: number, tick: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(tick) || tick <= 0) return value;
  const precision = Math.round(1 / tick);
  return Math.round(value * precision) / precision;
}

