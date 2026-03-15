import { resampleCandles } from './botEngine.js';
import { computeATR, computeEma, computeRsi, findPivotsHigh, findPivotsLow } from './ta.js';
import { resolveAiMaticXTimeframes } from './aiMaticXStrategy.js';

const CORE_MIN_OHLCV_BARS = 250;
const CORE_MIN_EMA_BARS = 200;
const CORE_MIN_INDICATOR_BARS = 35;
const CORE_VOLUME_PERCENTILE_WINDOW = 120;
const CORE_VOLUME_STATS_WINDOW = 50;
const CORE_RANGE_SMA_WINDOW = 20;
const CORE_FAKE_BREAK_LOOKBACK = 5;
const CORE_EMA_BREAKOUT_ATR_MULT = 0.1;
const CORE_EMA_CONFIRM_ATR_MULT = 0.05;
const CORE_RANGE_EXPANSION_MULT = 1.25;
const CORE_TOD_LOOKBACK_DAYS = 20;
const CORE_TOD_MULTIPLIER = 1.2;
const CORE_TOD_FALLBACK_MULT = 1.1;
const CORE_TOD_MIN_SAMPLES = 10;
const CORE_RSI_NEUTRAL_LOW = 45;
const CORE_RSI_NEUTRAL_HIGH = 55;
const CORE_M15_EMA_COMPRESSION_HARD = 0.12;
const CORE_M15_EMA_COMPRESSION_SOFT = 0.2;
const CORE_M15_IMPULSE_WEAK_SPREAD_PCT = 0.25;

const DEFAULT_EMA_TREND_PERIOD = 200;

const clampEmaTrendPeriod = (value, fallback = DEFAULT_EMA_TREND_PERIOD) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(CORE_MIN_EMA_BARS, Math.round(next));
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
};

const average = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;

const percentile = (values, p) => {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[rank];
};

const highest = (values) => {
  if (!values.length) throw new Error('highest: empty input');
  let max = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > max) max = values[i];
  }
  return max;
};

const lowest = (values) => {
  if (!values.length) throw new Error('lowest: empty input');
  let min = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < min) min = values[i];
  }
  return min;
};

const median = (values) => {
  if (!values.length) throw new Error('median: empty input');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const sign = (n) => {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
};

const slotMinuteUtc = (startTime) => {
  const d = new Date(startTime);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

const sortByOpenTimeAsc = (candles) =>
  [...candles].sort((a, b) => toNumber(a?.openTime) - toNumber(b?.openTime));

const keepClosedCandles = (candles, tfMin, nowMs) => {
  const tfMs = tfMin * 60_000;
  return candles.filter((c) => {
    const openTime = toNumber(c?.openTime);
    return Number.isFinite(openTime) && openTime + tfMs <= nowMs;
  });
};

const resolveTimeframePair = (riskMode) => {
  const x = resolveAiMaticXTimeframes();
  const xLtf = Number.isFinite(x?.ltfMinutes) ? Number(x.ltfMinutes) : 5;
  const xHtf = Number.isFinite(x?.htfMinutes) ? Number(x.htfMinutes) : 60;
  switch (String(riskMode ?? 'ai-matic')) {
    case 'ai-matic-x':
      return { ltfMin: xLtf, htfMin: xHtf };
    case 'ai-matic-scalp':
      return { ltfMin: 3, htfMin: 60 };
    case 'ai-matic-olikella':
      return { ltfMin: 5, htfMin: 60 };
    case 'ai-matic-bbo':
      return { ltfMin: 5, htfMin: 60 };
    case 'ai-matic-pro':
      return { ltfMin: 5, htfMin: 60 };
    case 'ai-matic-amd':
    case 'ai-matic-tree':
    case 'ai-matic':
    default:
      return { ltfMin: 5, htfMin: 60 };
  }
};

export function resolveCoreV2Params(riskMode, overrides = {}) {
  const pair = resolveTimeframePair(riskMode);
  return {
    riskMode: String(riskMode ?? 'ai-matic'),
    ltfMin: pair.ltfMin,
    htfMin: pair.htfMin,
    m15Min: 15,
    emaTrendPeriod: clampEmaTrendPeriod(overrides?.emaTrendPeriod),
    lookbacks: {
      minOhlcvBars: CORE_MIN_OHLCV_BARS,
      minEmaBars: CORE_MIN_EMA_BARS,
      minIndicatorBars: CORE_MIN_INDICATOR_BARS,
      volumePercentileWindow: CORE_VOLUME_PERCENTILE_WINDOW,
      volumeStatsWindow: CORE_VOLUME_STATS_WINDOW,
      rangeSmaWindow: CORE_RANGE_SMA_WINDOW,
      fakeBreakLookback: CORE_FAKE_BREAK_LOOKBACK,
      todLookbackDays: CORE_TOD_LOOKBACK_DAYS,
      todMinSamples: CORE_TOD_MIN_SAMPLES,
    },
    thresholds: {
      emaBreakoutAtrMult: CORE_EMA_BREAKOUT_ATR_MULT,
      emaConfirmAtrMult: CORE_EMA_CONFIRM_ATR_MULT,
      rangeExpansionMult: CORE_RANGE_EXPANSION_MULT,
      todMultiplier: CORE_TOD_MULTIPLIER,
      todFallbackMult: CORE_TOD_FALLBACK_MULT,
      rsiNeutralLow: CORE_RSI_NEUTRAL_LOW,
      rsiNeutralHigh: CORE_RSI_NEUTRAL_HIGH,
      m15EmaCompressionHard: CORE_M15_EMA_COMPRESSION_HARD,
      m15EmaCompressionSoft: CORE_M15_EMA_COMPRESSION_SOFT,
      m15ImpulseWeakSpreadPct: CORE_M15_IMPULSE_WEAK_SPREAD_PCT,
    },
  };
}

const buildEmptyCore = (params) => ({
  ltfTimeframeMin: params.ltfMin,
  htfTimeframeMin: params.htfMin,
  m15TimeframeMin: params.m15Min,
  ltfOpenTime: Number.NaN,
  ltfClose: Number.NaN,
  ltfOpen: Number.NaN,
  ltfHigh: Number.NaN,
  ltfLow: Number.NaN,
  ltfVolume: Number.NaN,
  ltfPrevClose: Number.NaN,
  ltfPrevHigh: Number.NaN,
  ltfPrevLow: Number.NaN,
  ltfPrevVolume: Number.NaN,
  ema8: Number.NaN,
  ema12: Number.NaN,
  ema21: Number.NaN,
  ema26: Number.NaN,
  ema50: Number.NaN,
  ema200: Number.NaN,
  ema200BreakoutBull: false,
  ema200BreakoutBear: false,
  ema200ConfirmBull: false,
  ema200ConfirmBear: false,
  atr14: Number.NaN,
  atrPct: Number.NaN,
  sep1: Number.NaN,
  sep2: Number.NaN,
  volumeCurrent: Number.NaN,
  volumeP50: Number.NaN,
  volumeP60: Number.NaN,
  volumeP65: Number.NaN,
  volumeP70: Number.NaN,
  volumeTodBaseline: Number.NaN,
  volumeTodThreshold: Number.NaN,
  volumeTodRatio: Number.NaN,
  volumeTodSampleCount: 0,
  volumeTodSlotMinute: Number.NaN,
  volumeTodFallback: true,
  volumeSma: Number.NaN,
  volumeStd: Number.NaN,
  volumeZ: Number.NaN,
  volumeSpike: false,
  ltfRange: Number.NaN,
  ltfRangeSma: Number.NaN,
  ltfRangeExpansionSma: false,
  ltfUp3: false,
  ltfDown3: false,
  ltfVolDown3: false,
  ltfFakeBreakHigh: false,
  ltfFakeBreakLow: false,
  volumeSpikeCurrent: Number.NaN,
  volumeSpikePrev: Number.NaN,
  volumeSpikeFading: false,
  volumeFalling: false,
  volumeRising: false,
  ltfRangeExpansion: false,
  ltfRangeExpVolume: false,
  ltfSweepBackInside: false,
  ltfRsi: Number.NaN,
  ltfMacdHist: Number.NaN,
  ltfMacdSignal: Number.NaN,
  ltfRsiNeutral: false,
  ltfNoNewHigh: false,
  ltfNoNewLow: false,
  htfClose: Number.NaN,
  htfEma200: Number.NaN,
  htfBias: 'NONE',
  htfBreakoutBull: false,
  htfBreakoutBear: false,
  htfConfirmBull: false,
  htfConfirmBear: false,
  htfAtr14: Number.NaN,
  htfAtrPct: Number.NaN,
  htfPivotHigh: undefined,
  htfPivotLow: undefined,
  m15Close: Number.NaN,
  m15Sma20: Number.NaN,
  m15Sma50: Number.NaN,
  m15SmaTrend: 'NONE',
  m15Atr14: Number.NaN,
  m15AtrPct: Number.NaN,
  m15EmaSpreadPct: Number.NaN,
  m15OverlapWicky: false,
  m15TrendLongOk: false,
  m15TrendShortOk: false,
  m15DriftBlocked: false,
  m15EmaCompression: false,
  m15EmaCompressionSoft: false,
  m15MacdHist: Number.NaN,
  m15MacdHistPrev: Number.NaN,
  m15MacdHistPrev2: Number.NaN,
  m15MacdWeak3: false,
  m15MacdWeak2: false,
  m15ImpulseWeak: false,
  m15WickIndecision: false,
  m15WickIndecisionSoft: false,
  ema15m12: Number.NaN,
  ema15m26: Number.NaN,
  ema15mTrend: 'NONE',
  emaCrossDir: 'NONE',
  emaCrossBarsAgo: undefined,
  pullbackLong: false,
  pullbackShort: false,
  pivotHigh: undefined,
  pivotLow: undefined,
  lastPivotHigh: undefined,
  lastPivotLow: undefined,
  prevPivotHigh: undefined,
  prevPivotLow: undefined,
  microBreakLong: false,
  microBreakShort: false,
  rsiBullDiv: false,
  rsiBearDiv: false,
  ltfCrossRsiAgainst: false,
  scalpFib: undefined,
  scalpConfirm: undefined,
});

const buildTodMetrics = ({ ltf, volumeCurrent, volumeP50, volumeP60, params }) => {
  const latest = ltf.length ? ltf[ltf.length - 1] : undefined;
  if (!latest) {
    return {
      baseline: Number.NaN,
      threshold: Number.NaN,
      ratio: Number.NaN,
      sampleCount: 0,
      slot: Number.NaN,
      fallback: true,
    };
  }
  const latestStart = toNumber(latest?.openTime);
  const slot = slotMinuteUtc(latestStart);
  const lookbackStart = latestStart - params.lookbacks.todLookbackDays * 24 * 60 * 60 * 1000;
  const slotVolumes = ltf
    .slice(0, -1)
    .filter((bar) => {
      const ts = toNumber(bar?.openTime);
      return Number.isFinite(ts) && ts >= lookbackStart && slotMinuteUtc(ts) === slot;
    })
    .map((bar) => toNumber(bar?.volume))
    .filter((value) => Number.isFinite(value));
  const sampleCount = slotVolumes.length;
  const fallback = sampleCount < params.lookbacks.todMinSamples;
  const baseline = fallback ? volumeP50 : median(slotVolumes);
  const threshold = fallback
    ? Math.max(volumeP60, volumeP50 * params.thresholds.todFallbackMult)
    : baseline * params.thresholds.todMultiplier;
  const ratio = Number.isFinite(volumeCurrent)
    ? volumeCurrent / Math.max(baseline, 1e-9)
    : Number.NaN;
  return {
    baseline,
    threshold,
    ratio,
    sampleCount,
    slot,
    fallback,
  };
};

const buildScalpFibData = ({ pivotsHigh, pivotsLow, trend }) => {
  if ((trend !== 'BULL' && trend !== 'BEAR') || !pivotsHigh.length || !pivotsLow.length) {
    return undefined;
  }
  let swingHigh;
  let swingLow;
  if (trend === 'BULL') {
    const lastHigh = pivotsHigh[pivotsHigh.length - 1];
    const prevLow = [...pivotsLow].reverse().find((p) => p.idx < lastHigh.idx);
    if (!lastHigh || !prevLow) return undefined;
    swingHigh = lastHigh.price;
    swingLow = prevLow.price;
  } else {
    const lastLow = pivotsLow[pivotsLow.length - 1];
    const prevHigh = [...pivotsHigh].reverse().find((p) => p.idx < lastLow.idx);
    if (!lastLow || !prevHigh) return undefined;
    swingHigh = prevHigh.price;
    swingLow = lastLow.price;
  }
  const range = swingHigh - swingLow;
  if (!Number.isFinite(range) || range <= 0) return undefined;
  const fib236 = trend === 'BULL' ? swingHigh - 0.236 * range : swingLow + 0.236 * range;
  const fib382 = trend === 'BULL' ? swingHigh - 0.382 * range : swingLow + 0.382 * range;
  const fib500 = trend === 'BULL' ? swingHigh - 0.5 * range : swingLow + 0.5 * range;
  const fib618 = trend === 'BULL' ? swingHigh - 0.618 * range : swingLow + 0.618 * range;
  const fib705 = trend === 'BULL' ? swingHigh - 0.705 * range : swingLow + 0.705 * range;
  const fib786 = trend === 'BULL' ? swingHigh - 0.786 * range : swingLow + 0.786 * range;
  const zoneLow = Math.min(fib500, fib705);
  const zoneHigh = Math.max(fib500, fib705);
  return {
    swingHigh,
    swingLow,
    range,
    fib236,
    fib382,
    fib500,
    fib618,
    fib705,
    fib786,
    longEntryZoneLow: zoneLow,
    longEntryZoneHigh: zoneHigh,
    shortEntryZoneLow: zoneLow,
    shortEntryZoneHigh: zoneHigh,
    trend,
    valid: true,
  };
};

const buildScalpConfirm = ({
  htfBias,
  pullbackLong,
  pullbackShort,
  microBreakLong,
  microBreakShort,
  volumeSpike,
  volumeTodRatio,
  ltfRangeExpansionSma,
  ltfRangeExpVolume,
  ltfRsiNeutral,
  ltfMacdHist,
  m15EmaCompression,
  m15WickIndecision,
  m15OverlapWicky,
  ltfCrossRsiAgainst,
}) => {
  const trendAligned =
    (pullbackLong && htfBias === 'BULL') ||
    (pullbackShort && htfBias === 'BEAR');
  const pullbackValid = pullbackLong || pullbackShort;
  const microBreakValid = microBreakLong || microBreakShort;
  const volumeValid =
    volumeSpike ||
    (Number.isFinite(volumeTodRatio) && volumeTodRatio >= 1.1);
  const rangeValid = ltfRangeExpansionSma || ltfRangeExpVolume;
  const rsiValid = !ltfRsiNeutral;
  const macdValid = pullbackLong
    ? ltfMacdHist > 0
    : pullbackShort
      ? ltfMacdHist < 0
      : false;
  const noCompression = !m15EmaCompression;
  const noIndecision = !m15WickIndecision && !m15OverlapWicky;
  const noRsiAgainst = !ltfCrossRsiAgainst;
  const scoreFields = [
    pullbackValid,
    microBreakValid,
    volumeValid,
    rangeValid,
    rsiValid,
    macdValid,
    noCompression,
    noIndecision,
    noRsiAgainst,
  ];
  const score = scoreFields.filter(Boolean).length;
  const confirmed =
    score >= 7 && trendAligned && microBreakValid && volumeValid && noCompression;
  return {
    trendAligned,
    pullbackValid,
    microBreakValid,
    volumeValid,
    rangeValid,
    rsiValid,
    macdValid,
    noCompression,
    noIndecision,
    noRsiAgainst,
    score,
    confirmed,
  };
};

export function computeCoreV2(candles, opts = {}) {
  const params = resolveCoreV2Params(opts?.riskMode, {
    emaTrendPeriod: opts?.emaTrendPeriod,
  });
  const empty = buildEmptyCore(params);

  if (!Array.isArray(candles) || !candles.length) {
    return empty;
  }

  const resample =
    typeof opts?.resample === 'function'
      ? opts.resample
      : (tf) => resampleCandles(candles, tf);
  const nowMs = Number.isFinite(opts?.nowMs) ? Number(opts.nowMs) : Date.now();

  const ltf = keepClosedCandles(sortByOpenTimeAsc(resample(params.ltfMin) || []), params.ltfMin, nowMs);
  const htf = keepClosedCandles(sortByOpenTimeAsc(resample(params.htfMin) || []), params.htfMin, nowMs);
  const m15 = keepClosedCandles(sortByOpenTimeAsc(resample(params.m15Min) || []), params.m15Min, nowMs);

  const ltfReady = ltf.length >= params.lookbacks.minOhlcvBars;
  const htfReady = htf.length >= params.lookbacks.minOhlcvBars;
  const m15Ready = m15.length >= params.lookbacks.minOhlcvBars;

  const out = { ...empty };

  const ltfLast = ltf.length ? ltf[ltf.length - 1] : undefined;
  const ltfPrev = ltf.length > 1 ? ltf[ltf.length - 2] : undefined;
  const ltfOpenTime = toNumber(ltfLast?.openTime);
  const ltfClose = toNumber(ltfLast?.close);
  const ltfOpen = toNumber(ltfLast?.open);
  const ltfHigh = toNumber(ltfLast?.high);
  const ltfLow = toNumber(ltfLast?.low);
  const ltfVolume = toNumber(ltfLast?.volume);
  const ltfPrevClose = toNumber(ltfPrev?.close);
  const ltfPrevHigh = toNumber(ltfPrev?.high);
  const ltfPrevLow = toNumber(ltfPrev?.low);
  const ltfPrevVolume = toNumber(ltfPrev?.volume);

  Object.assign(out, {
    ltfOpenTime,
    ltfClose,
    ltfOpen,
    ltfHigh,
    ltfLow,
    ltfVolume,
    ltfPrevClose,
    ltfPrevHigh,
    ltfPrevLow,
    ltfPrevVolume,
  });

  const ltfCloses = ltf.map((c) => toNumber(c?.close));
  const ltfHighs = ltf.map((c) => toNumber(c?.high));
  const ltfLows = ltf.map((c) => toNumber(c?.low));
  const ltfVolumes = ltf.map((c) => toNumber(c?.volume));

  const hasLtfEma = ltfReady && ltfCloses.length >= params.lookbacks.minEmaBars;
  const hasLtfIndicators = ltfReady && ltfCloses.length >= params.lookbacks.minIndicatorBars;

  const ema8Arr = computeEma(ltfCloses, 8);
  const ema12Arr = computeEma(ltfCloses, 12);
  const ema21Arr = computeEma(ltfCloses, 21);
  const ema26Arr = computeEma(ltfCloses, 26);
  const ema50Arr = computeEma(ltfCloses, 50);
  const ema200Arr = computeEma(ltfCloses, params.emaTrendPeriod);

  const ema8 = hasLtfEma ? (ema8Arr[ema8Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const ema12 = hasLtfEma ? (ema12Arr[ema12Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const ema21 = hasLtfEma ? (ema21Arr[ema21Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const ema26 = hasLtfEma ? (ema26Arr[ema26Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const ema50 = hasLtfEma ? (ema50Arr[ema50Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const ema200 = hasLtfEma ? (ema200Arr[ema200Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const ema200Prev = hasLtfEma && ema200Arr.length > 1
    ? (ema200Arr[ema200Arr.length - 2] ?? Number.NaN)
    : Number.NaN;

  Object.assign(out, { ema8, ema12, ema21, ema26, ema50, ema200 });

  const atrArr = hasLtfIndicators ? computeATR(ltfHighs, ltfLows, ltfCloses, 14) : [];
  const atr14 = hasLtfIndicators ? (atrArr[atrArr.length - 1] ?? Number.NaN) : Number.NaN;
  const atrPct = Number.isFinite(atr14) && Number.isFinite(ltfClose) && ltfClose > 0
    ? atr14 / ltfClose
    : Number.NaN;

  const ema200BreakoutBull =
    ltfReady &&
    Number.isFinite(ltfPrevClose) &&
    Number.isFinite(ema200Prev) &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ema200) &&
    Number.isFinite(atr14) &&
    ltfPrevClose <= ema200Prev &&
    ltfClose >= ema200 + params.thresholds.emaBreakoutAtrMult * atr14;
  const ema200BreakoutBear =
    ltfReady &&
    Number.isFinite(ltfPrevClose) &&
    Number.isFinite(ema200Prev) &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ema200) &&
    Number.isFinite(atr14) &&
    ltfPrevClose >= ema200Prev &&
    ltfClose <= ema200 - params.thresholds.emaBreakoutAtrMult * atr14;
  const ema200ConfirmBull =
    ltfReady &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ema200) &&
    Number.isFinite(ltfLow) &&
    Number.isFinite(atr14) &&
    ltfClose >= ema200 + params.thresholds.emaConfirmAtrMult * atr14 &&
    ltfLow >= ema200 - params.thresholds.emaConfirmAtrMult * atr14;
  const ema200ConfirmBear =
    ltfReady &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ema200) &&
    Number.isFinite(ltfHigh) &&
    Number.isFinite(atr14) &&
    ltfClose <= ema200 - params.thresholds.emaConfirmAtrMult * atr14 &&
    ltfHigh <= ema200 + params.thresholds.emaConfirmAtrMult * atr14;

  const sep1 =
    Number.isFinite(ema8) &&
    Number.isFinite(ema21) &&
    Number.isFinite(ltfClose) &&
    ltfClose > 0
      ? (Math.abs(ema8 - ema21) / ltfClose) * 100
      : Number.NaN;
  const sep2 =
    Number.isFinite(ema21) &&
    Number.isFinite(ema50) &&
    Number.isFinite(ltfClose) &&
    ltfClose > 0
      ? (Math.abs(ema21 - ema50) / ltfClose) * 100
      : Number.NaN;

  Object.assign(out, {
    atr14,
    atrPct,
    ema200BreakoutBull,
    ema200BreakoutBear,
    ema200ConfirmBull,
    ema200ConfirmBear,
    sep1,
    sep2,
  });

  const volumeCurrent = Number.isFinite(ltfVolume) ? ltfVolume : Number.NaN;
  const percentileVolumes =
    ltfReady && ltfVolumes.length >= params.lookbacks.volumePercentileWindow
      ? ltfVolumes.slice(-params.lookbacks.volumePercentileWindow).filter(Number.isFinite)
      : [];
  const volumeP50 = percentile(percentileVolumes, 50);
  const volumeP60 = percentile(percentileVolumes, 60);
  const volumeP65 = percentile(percentileVolumes, 65);
  const volumeP70 = percentile(percentileVolumes, 70);

  const tod = ltfReady
    ? buildTodMetrics({
        ltf,
        volumeCurrent,
        volumeP50,
        volumeP60,
        params,
      })
    : {
        baseline: Number.NaN,
        threshold: Number.NaN,
        ratio: Number.NaN,
        sampleCount: 0,
        slot: Number.NaN,
        fallback: true,
      };

  const volSlice =
    ltfReady && ltfVolumes.length >= params.lookbacks.volumeStatsWindow
      ? ltfVolumes.slice(-params.lookbacks.volumeStatsWindow).filter(Number.isFinite)
      : [];
  const volumeSma =
    volSlice.length === params.lookbacks.volumeStatsWindow
      ? average(volSlice)
      : Number.NaN;
  const volumeStd =
    volSlice.length === params.lookbacks.volumeStatsWindow && Number.isFinite(volumeSma)
      ? Math.sqrt(
          volSlice.reduce((s, v) => s + Math.pow(v - volumeSma, 2), 0) /
            volSlice.length,
        )
      : Number.NaN;
  const prevVolSlice =
    ltfReady && ltfVolumes.length >= params.lookbacks.volumeStatsWindow + 1
      ? ltfVolumes
          .slice(-params.lookbacks.volumeStatsWindow - 1, -1)
          .filter(Number.isFinite)
      : [];
  const prevVolumeSma =
    prevVolSlice.length === params.lookbacks.volumeStatsWindow
      ? average(prevVolSlice)
      : Number.NaN;
  const volumeZ =
    Number.isFinite(volumeStd) && volumeStd > 0 && Number.isFinite(volumeCurrent)
      ? (volumeCurrent - volumeSma) / volumeStd
      : Number.NaN;

  const volumeThresholdCandidates = [
    volumeP70,
    Number.isFinite(volumeSma) && Number.isFinite(volumeStd) ? volumeSma + volumeStd : Number.NaN,
    tod.threshold,
  ].filter((value) => Number.isFinite(value));
  const volumeSpikeThreshold = volumeThresholdCandidates.length
    ? Math.max(...volumeThresholdCandidates)
    : Number.NaN;
  const volumeSpike =
    Number.isFinite(volumeCurrent) &&
    Number.isFinite(volumeSpikeThreshold) &&
    volumeCurrent >= volumeSpikeThreshold;

  const volumeSpikeCurrent =
    Number.isFinite(volumeCurrent) && Number.isFinite(volumeSma)
      ? volumeCurrent / Math.max(volumeSma, 1e-9)
      : Number.NaN;
  const volumeSpikePrev =
    Number.isFinite(ltfPrevVolume) && Number.isFinite(prevVolumeSma)
      ? ltfPrevVolume / Math.max(prevVolumeSma, 1e-9)
      : Number.NaN;
  const volumeSpikeFading =
    Number.isFinite(volumeSpikePrev) &&
    Number.isFinite(volumeSpikeCurrent) &&
    volumeSpikePrev > volumeSpikeCurrent;

  const vol0 = ltfVolumes[ltfVolumes.length - 1];
  const vol1 = ltfVolumes[ltfVolumes.length - 2];
  const vol2 = ltfVolumes[ltfVolumes.length - 3];
  const volumeFalling =
    Number.isFinite(vol0) && Number.isFinite(vol1) && Number.isFinite(vol2)
      ? vol0 < vol1 && vol1 < vol2
      : false;
  const volumeRising =
    Number.isFinite(vol0) && Number.isFinite(vol1) && Number.isFinite(vol2)
      ? vol0 > vol1 && vol1 > vol2
      : false;

  Object.assign(out, {
    volumeCurrent,
    volumeP50,
    volumeP60,
    volumeP65,
    volumeP70,
    volumeTodBaseline: tod.baseline,
    volumeTodThreshold: tod.threshold,
    volumeTodRatio: tod.ratio,
    volumeTodSampleCount: tod.sampleCount,
    volumeTodSlotMinute: tod.slot,
    volumeTodFallback: tod.fallback,
    volumeSma,
    volumeStd,
    volumeZ,
    volumeSpike,
    volumeSpikeCurrent,
    volumeSpikePrev,
    volumeSpikeFading,
    volumeFalling,
    volumeRising,
  });

  const ltfRange =
    Number.isFinite(ltfHigh) && Number.isFinite(ltfLow) ? ltfHigh - ltfLow : Number.NaN;
  const rangeSlice = ltf
    .slice(-params.lookbacks.rangeSmaWindow)
    .map((c) => toNumber(c?.high) - toNumber(c?.low))
    .filter((v) => Number.isFinite(v));
  const ltfRangeSma =
    rangeSlice.length === params.lookbacks.rangeSmaWindow
      ? average(rangeSlice)
      : Number.NaN;
  const ltfRangeExpansionSma =
    Number.isFinite(ltfRange) && Number.isFinite(ltfRangeSma) && ltfRange > ltfRangeSma;
  const ltfRangeExpansion =
    Number.isFinite(ltfRange) &&
    Number.isFinite(ltfRangeSma) &&
    ltfRange >= params.thresholds.rangeExpansionMult * ltfRangeSma;
  const ltfRangeExpVolume = ltfRangeExpansion && volumeSpike;

  const ltfUp3 =
    ltfReady &&
    ltfCloses.length >= 3 &&
    ltfCloses[ltfCloses.length - 1] > ltfCloses[ltfCloses.length - 2] &&
    ltfCloses[ltfCloses.length - 2] > ltfCloses[ltfCloses.length - 3];
  const ltfDown3 =
    ltfReady &&
    ltfCloses.length >= 3 &&
    ltfCloses[ltfCloses.length - 1] < ltfCloses[ltfCloses.length - 2] &&
    ltfCloses[ltfCloses.length - 2] < ltfCloses[ltfCloses.length - 3];
  const ltfVolDown3 =
    ltfReady &&
    ltfVolumes.length >= 3 &&
    ltfVolumes[ltfVolumes.length - 1] < ltfVolumes[ltfVolumes.length - 2] &&
    ltfVolumes[ltfVolumes.length - 2] < ltfVolumes[ltfVolumes.length - 3];

  const ltfFakeRefHigh =
    ltfReady && ltfHighs.length > params.lookbacks.fakeBreakLookback
      ? highest(ltfHighs.slice(-params.lookbacks.fakeBreakLookback - 1, -1))
      : Number.NaN;
  const ltfFakeRefLow =
    ltfReady && ltfLows.length > params.lookbacks.fakeBreakLookback
      ? lowest(ltfLows.slice(-params.lookbacks.fakeBreakLookback - 1, -1))
      : Number.NaN;
  const ltfFakeBreakHigh =
    Number.isFinite(ltfHigh) &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ltfFakeRefHigh) &&
    ltfHigh > ltfFakeRefHigh &&
    ltfClose < ltfFakeRefHigh;
  const ltfFakeBreakLow =
    Number.isFinite(ltfLow) &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ltfFakeRefLow) &&
    ltfLow < ltfFakeRefLow &&
    ltfClose > ltfFakeRefLow;
  const ltfSweepBackInside = ltfFakeBreakHigh || ltfFakeBreakLow;

  Object.assign(out, {
    ltfRange,
    ltfRangeSma,
    ltfRangeExpansionSma,
    ltfRangeExpansion,
    ltfRangeExpVolume,
    ltfUp3,
    ltfDown3,
    ltfVolDown3,
    ltfFakeBreakHigh,
    ltfFakeBreakLow,
    ltfSweepBackInside,
  });

  const htfLast = htf.length ? htf[htf.length - 1] : undefined;
  const htfPrev = htf.length > 1 ? htf[htf.length - 2] : undefined;
  const htfClose = toNumber(htfLast?.close);
  const prevHtfClose = toNumber(htfPrev?.close);
  const htfCloses = htf.map((c) => toNumber(c?.close));
  const htfHighs = htf.map((c) => toNumber(c?.high));
  const htfLows = htf.map((c) => toNumber(c?.low));

  const hasHtfEma = htfReady && htfCloses.length >= params.lookbacks.minEmaBars;
  const hasHtfIndicators = htfReady && htfCloses.length >= params.lookbacks.minIndicatorBars;

  const htfEma200Arr = computeEma(htfCloses, params.emaTrendPeriod);
  const htfEma200 = hasHtfEma
    ? (htfEma200Arr[htfEma200Arr.length - 1] ?? Number.NaN)
    : Number.NaN;
  const htfEma200Prev =
    hasHtfEma && htfEma200Arr.length > 1
      ? (htfEma200Arr[htfEma200Arr.length - 2] ?? Number.NaN)
      : Number.NaN;

  const htfAtrArr = hasHtfIndicators ? computeATR(htfHighs, htfLows, htfCloses, 14) : [];
  const htfAtr14 = hasHtfIndicators ? (htfAtrArr[htfAtrArr.length - 1] ?? Number.NaN) : Number.NaN;
  const htfAtrPct = Number.isFinite(htfAtr14) && Number.isFinite(htfClose) && htfClose > 0
    ? htfAtr14 / htfClose
    : Number.NaN;

  const htfBreakoutBull =
    htfReady &&
    Number.isFinite(prevHtfClose) &&
    Number.isFinite(htfEma200Prev) &&
    Number.isFinite(htfClose) &&
    Number.isFinite(htfEma200) &&
    Number.isFinite(htfAtr14) &&
    prevHtfClose <= htfEma200Prev &&
    htfClose >= htfEma200 + params.thresholds.emaBreakoutAtrMult * htfAtr14;
  const htfBreakoutBear =
    htfReady &&
    Number.isFinite(prevHtfClose) &&
    Number.isFinite(htfEma200Prev) &&
    Number.isFinite(htfClose) &&
    Number.isFinite(htfEma200) &&
    Number.isFinite(htfAtr14) &&
    prevHtfClose >= htfEma200Prev &&
    htfClose <= htfEma200 - params.thresholds.emaBreakoutAtrMult * htfAtr14;

  const htfLastLow = toNumber(htfLast?.low);
  const htfLastHigh = toNumber(htfLast?.high);
  const htfConfirmBull =
    htfReady &&
    Number.isFinite(htfClose) &&
    Number.isFinite(htfEma200) &&
    Number.isFinite(htfLastLow) &&
    Number.isFinite(htfAtr14) &&
    htfClose >= htfEma200 + params.thresholds.emaConfirmAtrMult * htfAtr14 &&
    htfLastLow >= htfEma200 - params.thresholds.emaConfirmAtrMult * htfAtr14;
  const htfConfirmBear =
    htfReady &&
    Number.isFinite(htfClose) &&
    Number.isFinite(htfEma200) &&
    Number.isFinite(htfLastHigh) &&
    Number.isFinite(htfAtr14) &&
    htfClose <= htfEma200 - params.thresholds.emaConfirmAtrMult * htfAtr14 &&
    htfLastHigh <= htfEma200 + params.thresholds.emaConfirmAtrMult * htfAtr14;

  const htfBias =
    Number.isFinite(htfClose) &&
    Number.isFinite(htfEma200) &&
    htfClose > htfEma200 &&
    htfConfirmBull
      ? 'BULL'
      : Number.isFinite(htfClose) &&
          Number.isFinite(htfEma200) &&
          htfClose < htfEma200 &&
          htfConfirmBear
        ? 'BEAR'
        : 'NONE';

  const htfPivotsHigh = htfReady ? findPivotsHigh(htf, 3, 3) : [];
  const htfPivotsLow = htfReady ? findPivotsLow(htf, 3, 3) : [];
  const htfPivotHigh = htfPivotsHigh[htfPivotsHigh.length - 1]?.price;
  const htfPivotLow = htfPivotsLow[htfPivotsLow.length - 1]?.price;

  Object.assign(out, {
    htfClose,
    htfEma200,
    htfBias,
    htfBreakoutBull,
    htfBreakoutBear,
    htfConfirmBull,
    htfConfirmBear,
    htfAtr14,
    htfAtrPct,
    htfPivotHigh,
    htfPivotLow,
  });

  const m15Last = m15.length ? m15[m15.length - 1] : undefined;
  const m15Closes = m15.map((c) => toNumber(c?.close));
  const m15Highs = m15.map((c) => toNumber(c?.high));
  const m15Lows = m15.map((c) => toNumber(c?.low));
  const m15PivotsHigh = m15Ready ? findPivotsHigh(m15, 2, 2) : [];
  const m15PivotsLow = m15Ready ? findPivotsLow(m15, 2, 2) : [];

  const ema15m12Arr = computeEma(m15Closes, 12);
  const ema15m26Arr = computeEma(m15Closes, 26);

  const hasM15Ema = m15Ready && m15Closes.length >= params.lookbacks.minEmaBars;
  const hasM15Indicators = m15Ready && m15Closes.length >= params.lookbacks.minIndicatorBars;

  const ema15m12 = hasM15Ema ? (ema15m12Arr[ema15m12Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const ema15m26 = hasM15Ema ? (ema15m26Arr[ema15m26Arr.length - 1] ?? Number.NaN) : Number.NaN;
  const m15Close = toNumber(m15Last?.close);

  const m15Sma20 =
    m15Ready && m15Closes.length >= 20
      ? m15Closes.slice(-20).reduce((sum, value) => sum + value, 0) / 20
      : Number.NaN;
  const m15Sma50 =
    m15Ready && m15Closes.length >= 50
      ? m15Closes.slice(-50).reduce((sum, value) => sum + value, 0) / 50
      : Number.NaN;
  const m15SmaTrend =
    Number.isFinite(m15Sma20) && Number.isFinite(m15Sma50)
      ? m15Sma20 > m15Sma50
        ? 'BULL'
        : m15Sma20 < m15Sma50
          ? 'BEAR'
          : 'NONE'
      : 'NONE';
  const ema15mTrend =
    Number.isFinite(ema15m12) && Number.isFinite(ema15m26)
      ? ema15m12 > ema15m26
        ? 'BULL'
        : ema15m12 < ema15m26
          ? 'BEAR'
          : 'NONE'
      : 'NONE';

  const m15AtrArr = hasM15Indicators ? computeATR(m15Highs, m15Lows, m15Closes, 14) : [];
  const m15Atr14 = hasM15Indicators ? (m15AtrArr[m15AtrArr.length - 1] ?? Number.NaN) : Number.NaN;
  const m15AtrPct = Number.isFinite(m15Atr14) && Number.isFinite(m15Close) && m15Close > 0
    ? m15Atr14 / m15Close
    : Number.NaN;

  const m15EmaSpreadPct =
    Number.isFinite(ema15m12) &&
    Number.isFinite(ema15m26) &&
    Number.isFinite(m15Close) &&
    m15Close > 0
      ? (Math.abs(ema15m12 - ema15m26) / m15Close) * 100
      : Number.NaN;
  const m15EmaCompression =
    Number.isFinite(m15EmaSpreadPct) && m15EmaSpreadPct <= params.thresholds.m15EmaCompressionHard;
  const m15EmaCompressionSoft =
    Number.isFinite(m15EmaSpreadPct) && m15EmaSpreadPct <= params.thresholds.m15EmaCompressionSoft;

  const m15TrendLongOk =
    m15SmaTrend === 'BULL' && ema15mTrend === 'BULL' && !m15EmaCompression;
  const m15TrendShortOk =
    m15SmaTrend === 'BEAR' && ema15mTrend === 'BEAR' && !m15EmaCompression;

  const m15Macd = ema15m12Arr.map((v, i) => v - (ema15m26Arr[i] ?? 0));
  const m15Signal = computeEma(m15Macd, 9);
  const m15Hist = m15Macd.map((v, i) => v - (m15Signal[i] ?? 0));
  const m15MacdHist = hasM15Indicators ? (m15Hist[m15Hist.length - 1] ?? Number.NaN) : Number.NaN;
  const m15MacdHistPrev = hasM15Indicators ? (m15Hist[m15Hist.length - 2] ?? Number.NaN) : Number.NaN;
  const m15MacdHistPrev2 = hasM15Indicators ? (m15Hist[m15Hist.length - 3] ?? Number.NaN) : Number.NaN;

  const m15MacdWeak2 =
    Number.isFinite(m15MacdHist) &&
    Number.isFinite(m15MacdHistPrev) &&
    Number.isFinite(m15MacdHistPrev2) &&
    Math.abs(m15MacdHist) < Math.abs(m15MacdHistPrev) &&
    Math.abs(m15MacdHistPrev) < Math.abs(m15MacdHistPrev2);
  const m15MacdWeak3 = m15MacdWeak2 && sign(m15MacdHist) === sign(m15MacdHistPrev);
  const m15ImpulseWeak =
    m15MacdWeak2 &&
    Number.isFinite(m15EmaSpreadPct) &&
    m15EmaSpreadPct < params.thresholds.m15ImpulseWeakSpreadPct;

  const m15Range =
    Number.isFinite(toNumber(m15Last?.high)) && Number.isFinite(toNumber(m15Last?.low))
      ? toNumber(m15Last?.high) - toNumber(m15Last?.low)
      : Number.NaN;
  const m15UpperWick =
    Number.isFinite(toNumber(m15Last?.high)) &&
    Number.isFinite(toNumber(m15Last?.open)) &&
    Number.isFinite(toNumber(m15Last?.close))
      ? Math.max(0, toNumber(m15Last?.high) - Math.max(toNumber(m15Last?.open), toNumber(m15Last?.close)))
      : Number.NaN;
  const m15LowerWick =
    Number.isFinite(toNumber(m15Last?.low)) &&
    Number.isFinite(toNumber(m15Last?.open)) &&
    Number.isFinite(toNumber(m15Last?.close))
      ? Math.max(0, Math.min(toNumber(m15Last?.open), toNumber(m15Last?.close)) - toNumber(m15Last?.low))
      : Number.NaN;
  const m15Body =
    Number.isFinite(toNumber(m15Last?.open)) && Number.isFinite(toNumber(m15Last?.close))
      ? Math.abs(toNumber(m15Last?.close) - toNumber(m15Last?.open))
      : Number.NaN;

  const upperWickPct = Number.isFinite(m15UpperWick) && Number.isFinite(m15Range) && m15Range > 0
    ? m15UpperWick / m15Range
    : Number.NaN;
  const lowerWickPct = Number.isFinite(m15LowerWick) && Number.isFinite(m15Range) && m15Range > 0
    ? m15LowerWick / m15Range
    : Number.NaN;
  const bodyPct = Number.isFinite(m15Body) && Number.isFinite(m15Range) && m15Range > 0
    ? m15Body / m15Range
    : Number.NaN;

  const m15WickIndecision =
    m15Ready &&
    Number.isFinite(upperWickPct) &&
    Number.isFinite(lowerWickPct) &&
    Number.isFinite(bodyPct) &&
    upperWickPct >= 0.35 &&
    lowerWickPct >= 0.35 &&
    bodyPct <= 0.3;
  const m15WickIndecisionSoft =
    m15Ready &&
    Number.isFinite(upperWickPct) &&
    Number.isFinite(lowerWickPct) &&
    Number.isFinite(bodyPct) &&
    upperWickPct >= 0.25 &&
    lowerWickPct >= 0.25 &&
    bodyPct <= 0.4;

  const last3M15 = m15.slice(-3);
  const m15OverlapWicky =
    m15Ready && last3M15.length === 3
      ? (() => {
          const highs = last3M15.map((c) => toNumber(c?.high));
          const lows = last3M15.map((c) => toNumber(c?.low));
          const ranges = last3M15.map((c) => toNumber(c?.high) - toNumber(c?.low));
          const overlap = Math.max(0, Math.min(...highs) - Math.max(...lows));
          const avgRange = average(ranges);
          const overlapPct3 = Number.isFinite(avgRange) && avgRange > 0 ? overlap / avgRange : Number.NaN;
          const wickRatios = last3M15
            .map((c) => {
              const range = toNumber(c?.high) - toNumber(c?.low);
              if (!Number.isFinite(range) || range <= 0) return Number.NaN;
              const upper = Math.max(0, toNumber(c?.high) - Math.max(toNumber(c?.open), toNumber(c?.close)));
              const lower = Math.max(0, Math.min(toNumber(c?.open), toNumber(c?.close)) - toNumber(c?.low));
              return (upper + lower) / range;
            })
            .filter(Number.isFinite);
          const wickAvgPct3 = average(wickRatios);
          return (
            Number.isFinite(overlapPct3) &&
            Number.isFinite(wickAvgPct3) &&
            overlapPct3 >= 0.6 &&
            wickAvgPct3 >= 0.3
          );
        })()
      : false;

  const m15DriftBlocked =
    m15EmaCompression &&
    Number.isFinite(m15MacdHist) &&
    Math.abs(m15MacdHist) <
      0.5 * Math.abs(Number.isFinite(m15MacdHistPrev) ? m15MacdHistPrev : 0);

  let emaCrossDir = 'NONE';
  let emaCrossBarsAgo;
  const emaCrossSize = Math.min(ema15m12Arr.length, ema15m26Arr.length);
  if (m15Ready && emaCrossSize >= 2) {
    for (let i = 1; i < emaCrossSize; i += 1) {
      const prevDiff = (ema15m12Arr[i - 1] ?? Number.NaN) - (ema15m26Arr[i - 1] ?? Number.NaN);
      const currDiff = (ema15m12Arr[i] ?? Number.NaN) - (ema15m26Arr[i] ?? Number.NaN);
      const prevSign = sign(prevDiff);
      const currSign = sign(currDiff);
      if (currSign !== 0 && prevSign !== 0 && currSign !== prevSign) {
        emaCrossDir = currSign > 0 ? 'BULL' : 'BEAR';
        emaCrossBarsAgo = emaCrossSize - 1 - i;
      }
    }
  }

  Object.assign(out, {
    m15Close,
    m15Sma20,
    m15Sma50,
    m15SmaTrend,
    m15Atr14,
    m15AtrPct,
    m15EmaSpreadPct,
    m15OverlapWicky,
    m15TrendLongOk,
    m15TrendShortOk,
    m15DriftBlocked,
    m15EmaCompression,
    m15EmaCompressionSoft,
    m15MacdHist,
    m15MacdHistPrev,
    m15MacdHistPrev2,
    m15MacdWeak3,
    m15MacdWeak2,
    m15ImpulseWeak,
    m15WickIndecision,
    m15WickIndecisionSoft,
    ema15m12,
    ema15m26,
    ema15mTrend,
    emaCrossDir,
    emaCrossBarsAgo,
  });

  const pivotsHigh = ltfReady ? findPivotsHigh(ltf, 2, 2) : [];
  const pivotsLow = ltfReady ? findPivotsLow(ltf, 2, 2) : [];
  const lastPivotHigh = pivotsHigh[pivotsHigh.length - 1]?.price;
  const lastPivotLow = pivotsLow[pivotsLow.length - 1]?.price;
  const prevPivotHigh = pivotsHigh[pivotsHigh.length - 2]?.price;
  const prevPivotLow = pivotsLow[pivotsLow.length - 2]?.price;

  const ltfNoNewHigh =
    Number.isFinite(lastPivotHigh) && Number.isFinite(ltfHigh) && ltfHigh <= lastPivotHigh;
  const ltfNoNewLow =
    Number.isFinite(lastPivotLow) && Number.isFinite(ltfLow) && ltfLow >= lastPivotLow;

  const microBreakLong =
    Number.isFinite(lastPivotHigh) && Number.isFinite(ltfClose) && ltfClose > lastPivotHigh;
  const microBreakShort =
    Number.isFinite(lastPivotLow) && Number.isFinite(ltfClose) && ltfClose < lastPivotLow;

  const rsiArr = hasLtfIndicators ? computeRsi(ltfCloses, 14) : [];
  const ltfRsi = hasLtfIndicators ? (rsiArr[rsiArr.length - 1] ?? Number.NaN) : Number.NaN;
  const ltfRsiNeutral =
    Number.isFinite(ltfRsi) &&
    ltfRsi >= params.thresholds.rsiNeutralLow &&
    ltfRsi <= params.thresholds.rsiNeutralHigh;

  const ltfMacd = ema12Arr.map((v, i) => v - (ema26Arr[i] ?? 0));
  const ltfSignal = computeEma(ltfMacd, 9);
  const ltfHist = ltfMacd.map((v, i) => v - (ltfSignal[i] ?? 0));
  const ltfMacdHist = hasLtfIndicators ? (ltfHist[ltfHist.length - 1] ?? Number.NaN) : Number.NaN;
  const ltfMacdSignal = hasLtfIndicators ? (ltfSignal[ltfSignal.length - 1] ?? Number.NaN) : Number.NaN;

  const recentLowPivots = pivotsLow.slice(-2);
  const recentHighPivots = pivotsHigh.slice(-2);
  const rsiBullDiv =
    recentLowPivots.length === 2 &&
    Number.isFinite(rsiArr[recentLowPivots[1].idx]) &&
    Number.isFinite(rsiArr[recentLowPivots[0].idx]) &&
    recentLowPivots[1].price < recentLowPivots[0].price &&
    rsiArr[recentLowPivots[1].idx] > rsiArr[recentLowPivots[0].idx];
  const rsiBearDiv =
    recentHighPivots.length === 2 &&
    Number.isFinite(rsiArr[recentHighPivots[1].idx]) &&
    Number.isFinite(rsiArr[recentHighPivots[0].idx]) &&
    recentHighPivots[1].price > recentHighPivots[0].price &&
    rsiArr[recentHighPivots[1].idx] < rsiArr[recentHighPivots[0].idx];

  const pullbackLong =
    ltfReady &&
    htfReady &&
    m15Ready &&
    htfBias === 'BULL' &&
    m15TrendLongOk &&
    Number.isFinite(ltfLow) &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ema21) &&
    ltfLow <= ema21 &&
    ltfClose >= ema21;
  const pullbackShort =
    ltfReady &&
    htfReady &&
    m15Ready &&
    htfBias === 'BEAR' &&
    m15TrendShortOk &&
    Number.isFinite(ltfHigh) &&
    Number.isFinite(ltfClose) &&
    Number.isFinite(ema21) &&
    ltfHigh >= ema21 &&
    ltfClose <= ema21;

  const ltfCrossRsiAgainst = pullbackLong
    ? Number.isFinite(ltfRsi) && ltfRsi < 50
    : pullbackShort
      ? Number.isFinite(ltfRsi) && ltfRsi > 50
      : false;

  Object.assign(out, {
    ltfRsi,
    ltfMacdHist,
    ltfMacdSignal,
    ltfRsiNeutral,
    ltfNoNewHigh,
    ltfNoNewLow,
    pullbackLong,
    pullbackShort,
    pivotHigh: prevPivotHigh,
    pivotLow: prevPivotLow,
    lastPivotHigh,
    lastPivotLow,
    prevPivotHigh,
    prevPivotLow,
    microBreakLong,
    microBreakShort,
    rsiBullDiv,
    rsiBearDiv,
    ltfCrossRsiAgainst,
  });

  if (params.riskMode === 'ai-matic-olikella' || params.riskMode === 'ai-matic-scalp') {
    const fibDirection = htfBias === 'BULL' ? 'BULL' : htfBias === 'BEAR' ? 'BEAR' : 'NONE';
    const scalpFib = fibDirection === 'NONE'
      ? undefined
      : buildScalpFibData({
          pivotsHigh: m15PivotsHigh,
          pivotsLow: m15PivotsLow,
          trend: fibDirection,
        });
    const scalpConfirm = buildScalpConfirm({
      htfBias,
      pullbackLong,
      pullbackShort,
      microBreakLong,
      microBreakShort,
      volumeSpike,
      volumeTodRatio: tod.ratio,
      ltfRangeExpansionSma,
      ltfRangeExpVolume,
      ltfRsiNeutral,
      ltfMacdHist,
      m15EmaCompression,
      m15WickIndecision,
      m15OverlapWicky,
      ltfCrossRsiAgainst,
    });
    Object.assign(out, { scalpFib, scalpConfirm });
  }

  return out;
}
