import {
  BotConfig,
  EngineDecision,
  EngineSignal,
  State,
  Trend,
  resampleCandles,
  type Candle as EngineCandle,
  computeADX,
} from "./botEngine";
import { CandlestickAnalyzer } from "./universal-candlestick-analyzer";
import { getCheatSheetSetup, getDefaultCheatSheetSetupId } from "./strategyCheatSheet";

type AnalyzerCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Bias = "long" | "short" | null;

const DISPLACEMENT_LOOKBACK = 10;
const DISPLACEMENT_BODY_MULT = 1.4;
const DISPLACEMENT_RANGE_MULT = 1.2;
const H4_MIN_BARS = 5;
const H1_MIN_BARS = 8;
const LTF_MIN_BARS = 20;
const LIQUIDITY_LOOKBACK = 60;
const LIQUIDITY_TOUCHES = 2;
const LIQUIDITY_TOLERANCE_MULT = 0.15;
const BOS_VOLUME_MULT = 1.1;
const BOS_VOLUME_LOOKBACK = 20;
const FVG_DISTANCE_PCT = 0.015;

function toAnalyzerCandles(candles: EngineCandle[]): AnalyzerCandle[] {
  return candles.map((c) => ({
    time: c.openTime ?? c.timestamp ?? Date.now(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
}

function averageRange(candles: EngineCandle[], lookback: number): number {
  const slice = candles.slice(-lookback);
  if (!slice.length) return Number.NaN;
  const sum = slice.reduce((acc, c) => acc + (c.high - c.low), 0);
  return sum / slice.length;
}

function averageVolume(candles: EngineCandle[], lookback: number): number {
  const slice = candles.slice(-lookback);
  if (!slice.length) return Number.NaN;
  const sum = slice.reduce((acc, c) => acc + (c.volume ?? 0), 0);
  return sum / slice.length;
}

function isDisplacement(
  candles: EngineCandle[],
  bias: Bias,
  lookback = DISPLACEMENT_LOOKBACK
): boolean {
  if (!bias) return false;
  if (candles.length < lookback + 1) return false;
  const prev = candles.slice(-lookback - 1, -1);
  const last = candles[candles.length - 1];
  const avgBody =
    prev.reduce((acc, c) => acc + Math.abs(c.close - c.open), 0) / prev.length;
  const avgRange = averageRange(prev, prev.length);
  const currBody = Math.abs(last.close - last.open);
  const currRange = last.high - last.low;
  const dirOk = bias === "long" ? last.close > last.open : last.close < last.open;
  return (
    dirOk &&
    currBody > avgBody * DISPLACEMENT_BODY_MULT &&
    currRange > avgRange * DISPLACEMENT_RANGE_MULT
  );
}

function resolveBias(h4Trend: string, h1Trend: string): Bias {
  if (h4Trend === "up" && h1Trend === "up") return "long";
  if (h4Trend === "down" && h1Trend === "down") return "short";
  return null;
}

function isPoiMitigated(poi: { high: number; low: number; time: number }, candles: AnalyzerCandle[]): boolean {
  for (const c of candles) {
    if (c.time <= poi.time) continue;
    if (c.low <= poi.high && c.high >= poi.low) return true;
  }
  return false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveBosLevel(structure: { lastHH: number | null; lastLL: number | null; lastLH: number | null; lastHL: number | null }, bias: Bias): number | null {
  if (!bias) return null;
  if (bias === "long") return structure.lastHH ?? structure.lastLH ?? null;
  return structure.lastLL ?? structure.lastHL ?? null;
}

function isNearFvg(
  price: number,
  fvg: { high: number; low: number },
  distancePct: number
): boolean {
  if (!Number.isFinite(price)) return false;
  if (price >= fvg.low && price <= fvg.high) return true;
  const mid = (fvg.high + fvg.low) / 2;
  return Math.abs(price - mid) / price <= distancePct;
}

function confirmBosAndFvg(args: {
  bias: Bias;
  ltf: EngineCandle[];
  h1Pois: { type: string; direction: string; high: number; low: number }[];
  ltfPois: { type: string; direction: string; high: number; low: number }[];
  ltfStructure: { lastHH: number | null; lastLL: number | null; lastLH: number | null; lastHL: number | null };
  h1Structure: { lastHH: number | null; lastLL: number | null; lastLH: number | null; lastHL: number | null };
  price: number;
  config: Partial<BotConfig>;
}): { ok: boolean; tags: string[] } {
  const tags: string[] = [];
  const { bias, ltf, ltfStructure, h1Structure, h1Pois, ltfPois, price, config } = args;
  if (!bias || !ltf.length) return { ok: false, tags: ["BOS_INVALID"] };

  const bosLevel = resolveBosLevel(ltfStructure, bias) ?? resolveBosLevel(h1Structure, bias);
  if (!Number.isFinite(bosLevel ?? Number.NaN)) {
    return { ok: false, tags: ["BOS_LEVEL_MISSING"] };
  }
  const last = ltf[ltf.length - 1];
  const broke = bias === "long" ? last.close > bosLevel : last.close < bosLevel;
  if (!broke) return { ok: false, tags: ["BOS_NOT_BROKEN"] };
  const falseBreakout =
    bias === "long"
      ? last.high > bosLevel && last.close <= bosLevel
      : last.low < bosLevel && last.close >= bosLevel;
  if (falseBreakout) return { ok: false, tags: ["BOS_FALSE_BREAKOUT"] };

  const volLookback = config.smcBosVolumePeriod ?? BOS_VOLUME_LOOKBACK;
  const volMult = config.smcBosVolumeMult ?? BOS_VOLUME_MULT;
  const avgVol = averageVolume(ltf, volLookback);
  if (
    Number.isFinite(last.volume) &&
    Number.isFinite(avgVol) &&
    avgVol > 0 &&
    last.volume < avgVol * volMult
  ) {
    return { ok: false, tags: ["BOS_LOW_VOLUME"] };
  }
  tags.push("BOS_OK");

  const desiredDirection = bias === "long" ? "bullish" : "bearish";
  const distancePct = config.smcFvgDistancePct ?? FVG_DISTANCE_PCT;
  const htfFvgOk = h1Pois
    .filter((p) => p.type === "FVG" && p.direction === desiredDirection)
    .some((p) => isNearFvg(price, p, distancePct));
  const ltfFvgOk = ltfPois
    .filter((p) => p.type === "FVG" && p.direction === desiredDirection)
    .some((p) => isNearFvg(price, p, distancePct));
  const requireFvg = config.smcFvgRequireHtf ?? true;
  if (requireFvg && !(htfFvgOk && ltfFvgOk)) {
    return { ok: false, tags: ["FVG_MISSING"] };
  }
  if (htfFvgOk) tags.push("FVG_HTF_OK");
  if (ltfFvgOk) tags.push("FVG_LTF_OK");

  return { ok: true, tags };
}

function detectLiquidityPools(
  candles: EngineCandle[],
  lookback: number,
  tolerance: number,
  minTouches: number
) {
  const slice = candles.slice(-lookback);
  const highClusters: { level: number; count: number }[] = [];
  const lowClusters: { level: number; count: number }[] = [];

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

function selectLiquidityTarget(
  pools: { highs: number[]; lows: number[] },
  bias: Bias,
  entry: number
): number | null {
  if (bias === "long") {
    const above = pools.highs.filter((h) => h > entry);
    if (!above.length) return null;
    return Math.min(...above);
  }
  if (bias === "short") {
    const below = pools.lows.filter((l) => l < entry);
    if (!below.length) return null;
    return Math.max(...below);
  }
  return null;
}

export function evaluateSmcStrategyForSymbol(
  symbol: string,
  candles: EngineCandle[],
  config: Partial<BotConfig> = {}
): EngineDecision {
  const ltf1 = resampleCandles(candles, 1);
  const ltf15 = resampleCandles(candles, 15);
  const h1 = resampleCandles(candles, 60);
  const h4 = resampleCandles(candles, 240);

  if (
    h4.length < H4_MIN_BARS ||
    h1.length < H1_MIN_BARS ||
    ltf15.length < H1_MIN_BARS ||
    ltf1.length < LTF_MIN_BARS
  ) {
    return {
      state: State.Scan,
      trend: Trend.Range,
      trendH1: Trend.Range,
      trendScore: 0,
      trendAdx: Number.NaN,
      halted: true,
    };
  }

  const h4Analyzer = new CandlestickAnalyzer(toAnalyzerCandles(h4));
  const h1Analyzer = new CandlestickAnalyzer(toAnalyzerCandles(h1));
  const ltfAnalyzer = new CandlestickAnalyzer(toAnalyzerCandles(ltf15));
  const h4Structure = h4Analyzer.getMarketStructure();
  const h1Structure = h1Analyzer.getMarketStructure();
  const ltfStructure = ltfAnalyzer.getMarketStructure();
  const bias = resolveBias(h4Structure.trend, h1Structure.trend);
  const trend =
    bias === "long" ? Trend.Bull : bias === "short" ? Trend.Bear : Trend.Range;
  const trendH1 =
    h1Structure.trend === "up"
      ? Trend.Bull
      : h1Structure.trend === "down"
        ? Trend.Bear
        : Trend.Range;
  const adxPeriod = config.adxPeriod ?? 14;
  const adxArr = computeADX(
    h1.map((c) => c.high),
    h1.map((c) => c.low),
    h1.map((c) => c.close),
    adxPeriod
  );
  const trendAdx = adxArr[adxArr.length - 1];
  const trendScore = bias
    ? [
        h4Structure.trend !== "range",
        h1Structure.trend !== "range",
        Boolean(bias),
        (bias === "long" && ltfStructure.trend === "up") ||
          (bias === "short" && ltfStructure.trend === "down"),
      ].filter(Boolean).length
    : 0;

  if (!bias) {
    return {
      state: State.Scan,
      trend,
      trendH1,
      trendScore,
      trendAdx,
      signal: null,
      halted: false,
    };
  }

  const ltfPois = ltfAnalyzer.getPointsOfInterest();
  const h1Pois = h1Analyzer.getPointsOfInterest();
  const ltfCandles = toAnalyzerCandles(ltf15);
  const desiredDirection = bias === "long" ? "bullish" : "bearish";

  const validPois = ltfPois
    .filter((p) => p.direction === desiredDirection)
    .filter((p) => !isPoiMitigated(p, ltfCandles))
    .sort((a, b) => {
      const prioA = a.priority ?? 0;
      const prioB = b.priority ?? 0;
      if (prioA !== prioB) return prioB - prioA;
      return (b.time ?? 0) - (a.time ?? 0);
    });

  const poi = validPois[0];
  if (!poi) {
    return {
      state: State.Scan,
      trend,
      trendH1,
      trendScore,
      trendAdx,
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
      trendH1,
      trendScore,
      trendAdx,
      signal: null,
      halted: false,
    };
  }

  const bosAndFvg = confirmBosAndFvg({
    bias,
    ltf: ltf15,
    ltfStructure,
    h1Structure,
    ltfPois,
    h1Pois,
    price: last1m.close,
    config,
  });
  if (!bosAndFvg.ok) {
    return {
      state: State.Scan,
      trend,
      trendH1,
      trendScore,
      trendAdx,
      signal: null,
      halted: false,
    };
  }

  const entry = clamp(last1m.close, poi.low, poi.high);
  const avgRange15 = averageRange(ltf15, 8);
  const buffer =
    Number.isFinite(avgRange15) && avgRange15 > 0 ? avgRange15 * 0.1 : 0;
  const stop = bias === "long" ? poi.low - buffer : poi.high + buffer;
  const r = Math.abs(entry - stop);
  if (!Number.isFinite(r) || r <= 0) {
    return {
      state: State.Scan,
      trend,
      trendH1,
      trendScore,
      trendAdx,
      signal: null,
      halted: false,
    };
  }

  const liquidityTolerance =
    Number.isFinite(avgRange15) && avgRange15 > 0
      ? avgRange15 * LIQUIDITY_TOLERANCE_MULT
      : 0;
  const liquidityPools = detectLiquidityPools(
    ltf15,
    LIQUIDITY_LOOKBACK,
    liquidityTolerance,
    LIQUIDITY_TOUCHES
  );
  const liquidityTp = selectLiquidityTarget(liquidityPools, bias, entry);
  let tp =
    liquidityTp ??
    (bias === "long"
      ? ltfStructure.lastHH ?? ltfStructure.lastLH
      : ltfStructure.lastLL ?? ltfStructure.lastHL);
  if (!Number.isFinite(tp) || (bias === "long" ? tp <= entry : tp >= entry)) {
    const dir = bias === "long" ? 1 : -1;
    tp = entry + dir * 1.6 * r;
  }

  const signal: EngineSignal = {
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
    const setupId =
      config.cheatSheetSetupId ?? getDefaultCheatSheetSetupId();
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
    trendH1,
    trendScore,
    trendAdx,
    signal,
    halted: false,
  };
}
