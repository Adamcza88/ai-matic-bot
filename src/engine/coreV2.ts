import type { Candle } from './botEngine';
import type { AISettings } from '../types';
import {
  computeCoreV2 as computeCoreV2Js,
  resolveCoreV2Params as resolveCoreV2ParamsJs,
} from './coreV2Engine.js';

export type CoreV2RiskMode = AISettings['riskMode'] | 'ai-matic-scalp';

export type CoreV2ResampleFn = (timeframeMin: number) => Candle[];

export type CoreV2ParamSet = {
  riskMode: string;
  ltfMin: number;
  htfMin: number;
  m15Min: number;
  emaTrendPeriod: number;
  lookbacks: {
    minOhlcvBars: number;
    minEmaBars: number;
    minIndicatorBars: number;
    volumePercentileWindow: number;
    volumeStatsWindow: number;
    rangeSmaWindow: number;
    fakeBreakLookback: number;
    todLookbackDays: number;
    todMinSamples: number;
  };
  thresholds: {
    emaBreakoutAtrMult: number;
    emaConfirmAtrMult: number;
    rangeExpansionMult: number;
    todMultiplier: number;
    todFallbackMult: number;
    rsiNeutralLow: number;
    rsiNeutralHigh: number;
    m15EmaCompressionHard: number;
    m15EmaCompressionSoft: number;
    m15ImpulseWeakSpreadPct: number;
  };
};

export type ComputeCoreV2Options = {
  riskMode?: CoreV2RiskMode;
  resample?: CoreV2ResampleFn;
  emaTrendPeriod?: number;
  nowMs?: number;
};

export type CoreV2Metrics = ReturnType<typeof computeCoreV2Js>;

export const resolveCoreV2Params = (
  riskMode?: CoreV2RiskMode,
  overrides?: { emaTrendPeriod?: number }
): CoreV2ParamSet =>
  resolveCoreV2ParamsJs(riskMode, overrides) as CoreV2ParamSet;

export const computeCoreV2 = (
  candles: Candle[],
  options?: ComputeCoreV2Options
): CoreV2Metrics =>
  computeCoreV2Js(candles, options) as CoreV2Metrics;
