import { getCheatSheetSetup, getDefaultCheatSheetSetupId } from "./strategyCheatSheet";

export enum Trend {
  Bull = "bull",
  Bear = "bear",
  Range = "range", // Formerly Neutral
}

interface Exchange {
  fetchOHLCV(
    symbol: string,
    timeframe: string,
    since: undefined,
    limit: number,
  ): Promise<number[][]>;
}

/**
 * Helper: position sizing based on balance, risk %, and SL distance.
 * Updated to be Fee & Slippage Aware.
 */
export function computePositionSize(
  balance: number,
  riskPct: number,
  entry: number,
  sl: number,
  feeRate = 0.0006, // 0.06% taker
  slippagePct = 0.0005 // 0.05% slippage estimate
): number {
  const riskAmount = balance * riskPct;
  const rawSlDist = Math.abs(entry - sl);

  // Realized Loss = Size * (SL Dist + EntryFee + ExitFee + Slippage)
  // We want Realized Less <= RiskAmount
  // Fees are based on notional (Entry + Exit). Exit price is SL.
  // Fee = Size * Entry * Rate + Size * SL * Rate
  // Slippage = Size * Entry * SlippagePct (approx on entry) and maybe on exit too? Let's just create a buffer.

  // Per-unit loss:
  const perUnitLoss = rawSlDist
    + (entry * feeRate)
    + (sl * feeRate)
    + (entry * slippagePct)
    + (sl * slippagePct); // slippage potentially on both sides

  if (perUnitLoss <= 0) return 0;

  return riskAmount / perUnitLoss;
}

/**
 * FIX 6: Quantity Normalization for Mainnet
 * Rounds down to nearest step size to avoid "Invalid Qty" errors.
 */
export function normalizeQty(qty: number, step = 0.001): number {
  if (qty <= 0) return 0;
  const precision = Math.round(1 / step);
  return Math.floor(qty * precision) / precision;
}

/**
 * PURE CALC: Compute R-based Risk
 */
export function computeRisk(entry: number, stopLoss: number): number {
  return Math.abs(entry - stopLoss);
}

/**
 * PURE CALC: Compute Quantity based on Risk %
 * Now includes Fee & Slippage Awareness
 */
export function computeQty(
  balance: number,
  riskPct: number,
  entry: number,
  stopLoss: number,
  stepSize = 0.001
): number {
  // Use the detailed sizing function
  const rawSize = computePositionSize(balance, riskPct, entry, stopLoss);
  return normalizeQty(rawSize, stepSize);
}

/**
 * PURE CALC: Compute Entry Signal (Validation Only)
 * Validates if the proposed signal meets basic criteria.
 */
export function computeEntry(
  trend: Trend,
  atr: number,
  price: number,
  candidates: { side: "long" | "short"; entry: number; stopLoss: number }[]
): { side: "long" | "short"; entry: number; stopLoss: number } | null {
  // Return the first valid candidate
  return candidates.length > 0 ? candidates[0] : null;
}


export enum State {
  Scan = "SCAN",
  Manage = "MANAGE",
}

/**
 * Candle represents a single OHLCV bar.
 */
export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp?: number; // optional Unix ms if provided by feed
}

/**
 * Position represents an open trade being managed.
 */
export interface Position {
  entryPrice: number;
  size: number;
  baseSize: number;
  side: "long" | "short";
  stopLoss: number;
  takeProfit: number;
  initialTakeProfit: number;
  trailingStop: number;
  highWaterMark: number;
  lowWaterMark: number;
  opened: number;
  entryKind?: EntryKind;
  partialTaken: boolean;
  slDistance: number;
  pyramidLevel: number;
  partialIndex: number;
  closed?: number;
  exitCount: number;
}

/**
 * Configuration parameters for the trading bot.
 */
export interface BotConfig {
  symbol: string;
  baseTimeframe: string;
  signalTimeframe: string;
  targetTradesPerDay: number;
  riskPerTrade: number;
  strategyProfile: "trend" | "scalp" | "swing" | "intraday";
  entryStrictness: "base" | "relaxed" | "ultra" | "test";
  useStrategyCheatSheet?: boolean;
  cheatSheetSetupId?: string;
  accountBalance: number;
  atrPeriod: number;
  adxPeriod: number;
  adxThreshold: number;
  aggressiveAdxThreshold: number;
  atrEntryMultiplier: number;
  entryStopMode?: "atr" | "swing";
  atrTrailMultiplier: number;
  minAtrFractionOfPrice: number;
  swingBackoffAtr: number;
  partialExitRatio: number;
  partialTakeProfitR: number;
  breakevenBufferAtr: number;
  lookbackZones: number;
  cooldownBars: number;
  maxPortfolioRiskPercent: number;
  maxRiskPerTradeCap: number;
  tradingHours: { start: number; end: number; days: number[] };
  enforceSessionHours?: boolean;
  maxOpenPositions: number;
  maxExitChunks: number;
  trailingActivationR: number;
  minStopPercent: number;
  pyramidAddScale: number;
  pyramidLevels: { triggerR: number; stopToR: number }[];
  partialSteps: { r: number; exitFraction: number }[];
  // Liquidity sweep / volatility expansion params
  liquiditySweepAtrMult: number;
  liquiditySweepLookback: number;
  liquiditySweepVolumeMult: number;
  volExpansionAtrMult: number;
  volExpansionVolMult: number;
}

export type EntryKind =
  | "BREAKOUT"
  | "PULLBACK"
  | "MOMENTUM"
  | "MEAN_REVERSION"
  | "OTHER";

type EntrySignal = {
  side: "long" | "short";
  entry: number;
  stopLoss: number;
  kind: EntryKind;
};

function applyProfileOverrides(cfg: BotConfig): BotConfig {
  if (cfg.strategyProfile !== "scalp") {
    return { ...cfg, maxOpenPositions: Math.min(cfg.maxOpenPositions, 3) };
  }
  const scalpRisk = Math.min(Math.max(cfg.riskPerTrade, 0.01), 0.02);
  const base = {
    ...cfg,
    riskPerTrade: scalpRisk,
    maxRiskPerTradeCap: Math.min(cfg.maxRiskPerTradeCap, 0.02),
    maxPortfolioRiskPercent: Math.max(Math.min(cfg.maxPortfolioRiskPercent, 0.12), 0.08),
    maxOpenPositions: 3,
    enforceSessionHours: false,
    trailingActivationR: 1,
    minStopPercent: Math.min(cfg.minStopPercent, 0.0012),
    partialSteps: [{ r: 1, exitFraction: 0.5 }],
    maxExitChunks: 2,
    pyramidAddScale: 0.5,
    pyramidLevels: [
      { triggerR: 1, stopToR: 0 },
      { triggerR: 2, stopToR: 1 },
    ],
  };
  return { ...base, maxOpenPositions: Math.min(base.maxOpenPositions, 3) };
}

/**
 * Default configuration values.
 */
export const defaultConfig: BotConfig = {
  symbol: "BTCUSDT",
  baseTimeframe: "1h",
  signalTimeframe: "5m",
  targetTradesPerDay: 100,
  riskPerTrade: 0.04,
  strategyProfile: "trend",
  entryStrictness: "ultra",
  useStrategyCheatSheet: false,
  accountBalance: 200000,
  atrPeriod: 14,
  adxPeriod: 14,
  adxThreshold: 25,
  aggressiveAdxThreshold: 35,
  atrEntryMultiplier: 2,
  entryStopMode: "atr",
  atrTrailMultiplier: 2,
  minAtrFractionOfPrice: 0.0006,
  swingBackoffAtr: 0.7,
  partialExitRatio: 0.5,
  partialTakeProfitR: 1.5,
  breakevenBufferAtr: 0.2,
  lookbackZones: 50,
  cooldownBars: 1,
  maxPortfolioRiskPercent: 0.15,
  maxRiskPerTradeCap: 0.07,
  tradingHours: { start: 0, end: 23, days: [0, 1, 2, 3, 4, 5, 6] },
  enforceSessionHours: false,
  maxOpenPositions: 3,
  maxExitChunks: 3,
  trailingActivationR: 2,
  minStopPercent: 0.0035,
  pyramidAddScale: 0.5,
  pyramidLevels: [
    { triggerR: 1, stopToR: 0 },
    { triggerR: 2, stopToR: 1 },
  ],
  partialSteps: [
    { r: 1, exitFraction: 0.3 },
    { r: 2, exitFraction: 0.3 },
  ],
  liquiditySweepAtrMult: 0.5,
  liquiditySweepLookback: 5,
  liquiditySweepVolumeMult: 1.05,
  volExpansionAtrMult: 1.3,
  volExpansionVolMult: 1.2,
};

/**
 * Utility function: Compute Average True Range (ATR).
 * Returns an array of ATR values of the same length as input arrays.
 */
export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const result: number[] = [];
  for (let i = 0; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = i > 0 ? Math.abs(highs[i] - closes[i - 1]) : hl;
    const lc = i > 0 ? Math.abs(lows[i] - closes[i - 1]) : hl;
    const tr = Math.max(hl, hc, lc);
    if (i === 0) {
      result.push(tr);
    } else {
      // Wilder's smoothing: simple moving average for clarity
      const prev = result[i - 1] * (period - 1);
      result.push((prev + tr) / period);
    }
  }
  return result;
}

/**
 * Utility function: Compute Average Directional Index (ADX).
 * Returns an array of ADX values aligned to the input length.
 */
export function computeADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
): number[] {
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const tr = computeATR(highs, lows, closes, 1);
  // Smoothed TR over period
  const smoothedTR: number[] = [];
  for (let i = 0; i < tr.length; i++) {
    if (i === 0) smoothedTR.push(tr[0]);
    else smoothedTR.push((smoothedTR[i - 1] * (period - 1) + tr[i]) / period);
  }
  // Smoothed plus and minus DM
  const smoothedPlus: number[] = [];
  const smoothedMinus: number[] = [];
  for (let i = 0; i < plusDM.length; i++) {
    if (i === 0) {
      smoothedPlus.push(plusDM[0]);
      smoothedMinus.push(minusDM[0]);
    } else {
      smoothedPlus.push(
        (smoothedPlus[i - 1] * (period - 1) + plusDM[i]) / period,
      );
      smoothedMinus.push(
        (smoothedMinus[i - 1] * (period - 1) + minusDM[i]) / period,
      );
    }
  }
  // Calculate DI and DX
  const plusDI: number[] = [];
  const minusDI: number[] = [];
  const dx: number[] = [];
  for (let i = 0; i < smoothedPlus.length; i++) {
    const trVal = smoothedTR[i + 1] || smoothedTR[i];
    const pdi = (smoothedPlus[i] / trVal) * 100;
    const mdi = (smoothedMinus[i] / trVal) * 100;
    plusDI.push(pdi);
    minusDI.push(mdi);
    dx.push(((Math.abs(pdi - mdi) / (pdi + mdi || 1)) || 0) * 100);
  }
  // Smooth DX to get ADX
  const adx: number[] = [];
  for (let i = 0; i < dx.length; i++) {
    if (i < period) {
      adx.push(0);
    } else if (i === period) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += dx[j];
      adx.push(sum / period);
    } else {
      adx.push(((adx[i - 1] * (period - 1)) + dx[i]) / period);
    }
  }
  // Align the length: pad initial zeros for first period elements
  const padding = new Array(period).fill(0);
  return padding.concat(adx).slice(0, highs.length);
}

/**
 * DataFrame type alias for readability: array of candles.
 */
export type DataFrame = Candle[];

/**
 * TradingBot class encapsulates scanning and trade management logic.
 */
export class TradingBot {
  private config: BotConfig;
  private state: State;
  private position: Position | null;
  private cooldownUntil: Date | null;
  private dailyPnl: number;
  private tradingDay: number | null;
  private closedToday: number;
  private equityPeak: number;
  private currentDrawdown: number;
  // History of OHLCV by timeframe
  private history: Record<string, DataFrame>;
  // Exchange client interface (optional)
  private exchange?: Exchange;

  constructor(config: Partial<BotConfig> = {}, exchange?: Exchange) {
    this.config = applyProfileOverrides({ ...defaultConfig, ...config });
    this.state = State.Scan;
    this.position = null;
    this.cooldownUntil = null;
    this.dailyPnl = 0;
    this.closedToday = 0;
    this.tradingDay = null;
    this.equityPeak = this.config.accountBalance;
    this.currentDrawdown = 0;
    this.history = {};
    this.exchange = exchange;
  }

  updateConfig(config: Partial<BotConfig>): void {
    this.config = applyProfileOverrides({ ...this.config, ...config });
    this.equityPeak = Math.max(this.equityPeak, this.config.accountBalance);
  }

  /**
   * Fetch OHLCV data. In a live system this would call the exchange API;
   * here it relies on preloaded history for offline testing.
   */
  async fetchOHLCV(timeframe: string, limit: number = 200): Promise<DataFrame> {
    if (this.history[timeframe]) {
      // return the last `limit` candles
      const data = this.history[timeframe];
      return data.slice(Math.max(0, data.length - limit));
    }
    if (!this.exchange) {
      throw new Error("No exchange client or history available for timeframe " + timeframe);
    }
    // Example ccxt call; adapt as needed
    const ohlcv = await this.exchange.fetchOHLCV(
      this.config.symbol,
      timeframe,
      undefined,
      limit,
    );
    const result: DataFrame = ohlcv.map((c: number[]) => ({
      openTime: Number(c[0]),
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
    this.history[timeframe] = result;
    return result;
  }

  /**
   * Preload historical data for offline operation.
   */
  loadHistory(timeframe: string, data: DataFrame): void {
    this.history[timeframe] = data;
  }

  private computeTrendMetrics(df: DataFrame): {
    trend: Trend;
    score: number;
    adx: number;
  } {
    if (df.length < 20) {
      return { trend: Trend.Range, score: 0, adx: Number.NaN };
    }
    const closes = df.map((c) => c.close);
    const highs = df.map((c) => c.high);
    const lows = df.map((c) => c.low);
    const adxArray = computeADX(highs, lows, closes, this.config.adxPeriod);
    const currentAdx = adxArray[adxArray.length - 1];

    const ema = (series: number[], period: number): number[] => {
      const out: number[] = [];
      const k = 2 / (period + 1);
      series.forEach((p, i) => {
        if (i === 0) out.push(p);
        else out.push(out[i - 1] + k * (p - out[i - 1]));
      });
      return out;
    };
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const price = closes[closes.length - 1];
    const e50 = ema50[ema50.length - 1];
    const e200 = ema200[ema200.length - 1];
    const ePrev = ema50[Math.max(0, ema50.length - 6)];
    const slope = e50 - ePrev;
    const atrArr = computeATR(highs, lows, closes, this.config.atrPeriod);
    const atrNow = atrArr[atrArr.length - 1] || 0;
    const slopeThreshold = Math.max(e50 * 0.0003, atrNow * 0.15);

    const swingWindow = 2;
    const swingHighs: number[] = [];
    const swingLows: number[] = [];
    for (let i = swingWindow; i < highs.length - swingWindow; i++) {
      const h = highs[i];
      const l = lows[i];
      let isHigh = true;
      let isLow = true;
      for (let j = i - swingWindow; j <= i + swingWindow; j++) {
        if (j === i) continue;
        if (highs[j] > h) isHigh = false;
        if (lows[j] < l) isLow = false;
        if (!isHigh && !isLow) break;
      }
      if (isHigh) swingHighs.push(h);
      if (isLow) swingLows.push(l);
    }
    const lastHighs = swingHighs.slice(-2);
    const lastLows = swingLows.slice(-2);
    const structureBull =
      lastHighs.length === 2 &&
      lastLows.length === 2 &&
      lastHighs[1] > lastHighs[0] &&
      lastLows[1] > lastLows[0];
    const structureBear =
      lastHighs.length === 2 &&
      lastLows.length === 2 &&
      lastHighs[1] < lastHighs[0] &&
      lastLows[1] < lastLows[0];

    let bullScore = 0;
    let bearScore = 0;
    if (price > e50) bullScore += 1;
    else bearScore += 1;
    if (e50 > e200) bullScore += 1;
    else if (e50 < e200) bearScore += 1;
    if (slope > slopeThreshold) bullScore += 1;
    else if (slope < -slopeThreshold) bearScore += 1;
    if (structureBull) bullScore += 1;
    if (structureBear) bearScore += 1;

    const score = Math.max(bullScore, bearScore);
    let trend = Trend.Range;
    if (bullScore >= 3 && bullScore > bearScore) trend = Trend.Bull;
    else if (bearScore >= 3 && bearScore > bullScore) trend = Trend.Bear;
    else if (currentAdx < this.config.adxThreshold) trend = Trend.Range;

    return { trend, score, adx: currentAdx };
  }

  /**
   * Determine the prevailing trend using EMA alignment + structure.
   */
  determineTrend(df: DataFrame): Trend {
    return this.computeTrendMetrics(df).trend;
  }

  getTrendMetrics(df: DataFrame): { trend: Trend; score: number; adx: number } {
    return this.computeTrendMetrics(df);
  }

  private isVolatileChaos(df: DataFrame): boolean {
    // Check if current ATR is > 2.5x Average ATR (Extreme expansion)
    const closes = df.map((c) => c.close);
    const highs = df.map((c) => c.high);
    const lows = df.map((c) => c.low);
    const atr = computeATR(highs, lows, closes, 14);
    if (atr.length < 50) return false;

    const currentAtr = atr[atr.length - 1];
    // Exclude recent spikes from "average" baseline by looking further back or using median
    // Simple SMA of ATR for last 50
    const avgAtr = atr.slice(-50).reduce((a, b) => a + b, 0) / 50;

    return currentAtr > avgAtr * 2.5;
  }

  private enforceMinimumStop(
    entry: number,
    stop: number,
    side: "long" | "short",
    atr: number,
  ): number {
    const minDistance = Math.max(this.config.minStopPercent * entry, atr);
    const currentDistance = Math.abs(entry - stop);
    if (currentDistance >= minDistance) return stop;
    return side === "long" ? entry - minDistance : entry + minDistance;
  }

  private openPositionsCount(): number {
    return Object.values(botRegistry).filter((b) => b.getPosition()).length;
  }

  private aggregateOpenRisk(): number {
    return Object.values(botRegistry).reduce((sum, bot) => {
      const pos = bot.getPosition();
      if (!pos) return sum;
      const protectiveStop =
        pos.side === "long"
          ? Math.max(pos.stopLoss, pos.trailingStop)
          : Math.min(pos.stopLoss, pos.trailingStop);
      const dist = Math.abs(pos.entryPrice - protectiveStop);
      return sum + dist * pos.size;
    }, 0);
  }

  private moveStopToR(targetR: number): void {
    if (!this.position) return;
    const target =
      this.position.side === "long"
        ? this.position.entryPrice + targetR * this.position.slDistance
        : this.position.entryPrice - targetR * this.position.slDistance;
    if (this.position.side === "long") {
      this.position.stopLoss = Math.max(this.position.stopLoss, target);
      this.position.trailingStop = Math.max(this.position.trailingStop, target);
    } else {
      this.position.stopLoss = Math.min(this.position.stopLoss, target);
      this.position.trailingStop = Math.min(this.position.trailingStop, target);
    }
  }

  private applyPyramiding(rMultiple: number): void {
    if (!this.position) return;
    const steps = this.config.pyramidLevels || [];
    while (this.position.pyramidLevel < steps.length && rMultiple >= steps[this.position.pyramidLevel].triggerR) {
      const addSize = this.position.baseSize * this.config.pyramidAddScale;
      this.position.size += addSize;
      const step = steps[this.position.pyramidLevel];
      this.position.pyramidLevel += 1;
      this.moveStopToR(step.stopToR);
    }
  }

  private applyPartialExits(rMultiple: number): void {
    if (!this.position) return;
    const steps = this.config.partialSteps || [];
    while (this.position.partialIndex < steps.length && rMultiple >= steps[this.position.partialIndex].r) {
      const step = steps[this.position.partialIndex];
      const reduceBy = this.position.size * step.exitFraction;
      this.position.size = Math.max(0, this.position.size - reduceBy);
      this.position.partialIndex += 1;
      this.position.exitCount = this.position.partialIndex;
      this.moveStopToR(step.r >= 2 ? 1 : 0);
    }
    if (this.position.partialIndex >= steps.length) {
      this.position.takeProfit = this.position.side === "long" ? Infinity : -Infinity;
    }
  }

  /**
   * Strategy-specific R-based trailing stop staging.
   * Kicks in at a profile-dependent R multiple and locks a retracement band around entry.
   */
  private applyStrategyTrailing(rMultiple: number): void {
    if (!this.position) return;
    const tpMap: Record<BotConfig["strategyProfile"], number> = {
      trend: 2.2,
      swing: 1.8,
      intraday: 1.6,
      scalp: 1.4,
    };
    const widthMap: Record<BotConfig["strategyProfile"], number> = {
      trend: 1.1,
      swing: 0.8,
      intraday: 0.6,
      scalp: 0.4,
    };
    const profile = this.config.strategyProfile;
    const tpR = tpMap[profile] ?? 1.4;
    const widthR = widthMap[profile] ?? 0.4;
    // Trigger těsně pod TP: blízko cíle (např. scalp 1.4R -> trigger 1.35R)
    const triggerR = tpR - 0.05;
    if (rMultiple < triggerR || this.position.slDistance <= 0) return;
    const widthAbs = widthR * this.position.slDistance;
    const target = this.position.side === "long"
      ? this.position.entryPrice + widthAbs
      : this.position.entryPrice - widthAbs;
    if (this.position.side === "long") {
      this.position.trailingStop = Math.max(this.position.trailingStop, target);
    } else {
      this.position.trailingStop = Math.min(this.position.trailingStop, target);
    }
  }

  private handleManage(ht: DataFrame, lt: DataFrame): void {
    if (!this.position) return;
    const currentPrice = lt[lt.length - 1].close;
    this.updateWaterMarks(currentPrice);
    const rMultiple = this.position.slDistance > 0
      ? (this.position.side === "long"
        ? (currentPrice - this.position.entryPrice) / this.position.slDistance
        : (this.position.entryPrice - currentPrice) / this.position.slDistance)
      : 0;
    if (rMultiple >= this.config.trailingActivationR) {
      this.updateTrailingStop(lt);
    }
    this.applyStrategyTrailing(rMultiple);
    this.updateTakeProfit(ht, lt);
    this.applyPyramiding(rMultiple);
    this.applyPartialExits(rMultiple);

    if (this.position.size <= 0) {
      this.exitPosition(currentPrice);
      return;
    }

    const stopHit =
      (this.position.side === "long" && (currentPrice <= this.position.stopLoss || currentPrice <= this.position.trailingStop)) ||
      (this.position.side === "short" && (currentPrice >= this.position.stopLoss || currentPrice >= this.position.trailingStop));
    if (stopHit) {
      this.exitPosition(currentPrice);
      return;
    }

    const tpHit = Number.isFinite(this.position.takeProfit)
      ? (this.position.side === "long" ? currentPrice >= this.position.takeProfit : currentPrice <= this.position.takeProfit)
      : false;
    if (tpHit) {
      this.exitPosition(currentPrice);
    }
  }

  private resetDaily(now: number): void {
    const day = new Date(now).getUTCDate();
    if (this.tradingDay === null || this.tradingDay !== day) {
      this.tradingDay = day;
      this.dailyPnl = 0;
      this.closedToday = 0;
      this.equityPeak = Math.max(this.equityPeak, this.config.accountBalance);
    }
  }

  private withinSession(now: number): boolean {
    if (this.config.entryStrictness === "test" || this.config.enforceSessionHours === false) return true;
    const d = new Date(now);
    const hour = d.getUTCHours();
    const day = d.getUTCDay();
    const { start, end, days } = this.config.tradingHours;
    if (!days.includes(day)) return false;
    if (hour < start || hour > end) return false;
    return true;
  }

  private riskHalted(): boolean {
    if (this.config.entryStrictness === "test") return false;
    return false;
  }

  /**
   * Scan for entry signals on the configured timeframes. Returns a signal
   * description or null.
   */
  async scanForEntry(): Promise<EntrySignal | null> {
    const now = Date.now();
    this.resetDaily(now);
    if (!this.withinSession(now)) return null;
    if (this.riskHalted()) return null;
    if (this.cooldownUntil && new Date() < this.cooldownUntil) return null;

    // Fetch data
    const ht = await this.fetchOHLCV(this.config.baseTimeframe);
    const lt = await this.fetchOHLCV(this.config.signalTimeframe);

    // Delegate to the frame-based logic
    return this.scanForEntryFromFrames(ht, lt);
  }

  /**
   * Open a new position and switch to MANAGE state. Calculates position
   * size based on risk management settings.
   */
  enterPosition(
    side: "long" | "short",
    entry: number,
    stopLoss: number,
    kind: EntryKind = "OTHER"
  ): void {
    const profileRisk =
      this.config.strategyProfile === "trend"
        ? 0.05
        : this.config.strategyProfile === "scalp"
          ? 0.015
          : this.config.strategyProfile === "intraday"
            ? 0.03
            : 0.04;
    const riskPct = Math.min(
      this.config.maxRiskPerTradeCap,
      Math.max(profileRisk, this.config.riskPerTrade),
    );
    const slDistance = computeRisk(entry, stopLoss);
    // Calculate size using PURE function
    const size = computeQty(this.config.accountBalance, riskPct, entry, stopLoss, 0.001);

    // FIX 6: Normalize size logic (Moved to computeQty)

    const riskAmount = Math.abs(slDistance * size);
    const openRisk = this.aggregateOpenRisk();
    const openCount = this.openPositionsCount();
    if (openCount >= this.config.maxOpenPositions) {
      return;
    }
    if (openRisk + riskAmount > this.config.accountBalance * this.config.maxPortfolioRiskPercent) {
      return;
    }
    const rrMap: Record<BotConfig["strategyProfile"], number> = {
      trend: 2.2,
      scalp: 1.4,
      swing: 1.8,
      intraday: 1.6,
    };
    const tp = side === "long" ? entry + rrMap[this.config.strategyProfile] * slDistance : entry - rrMap[this.config.strategyProfile] * slDistance;
    this.position = {
      entryPrice: entry,
      size: size,
      baseSize: size,
      side: side,
      stopLoss: stopLoss,
      takeProfit: tp,
      initialTakeProfit: tp,
      trailingStop: stopLoss,
      highWaterMark: entry,
      lowWaterMark: entry,
      opened: Date.now(),
      entryKind: kind,
      partialTaken: false,
      slDistance,
      pyramidLevel: 0,
      partialIndex: 0,
      exitCount: 0,
    };
    this.state = State.Manage;
  }

  /**
   * CHECK: Can we enter a new position?
   * Enforces strict "One Position" rule for Mainnet safety.
   */
  canEnter(): boolean {
    if (this.state !== State.Scan) return false;
    if (this.position !== null) return false;
    // Double check global registry if needed, but instance isolation is preferred.
    return true;
  }

  /**
   * SAFE ENTRY: Wrapper to prevent Race Conditions
   */
  safeEnterPosition(
    side: "long" | "short",
    entry: number,
    stopLoss: number,
    kind: EntryKind = "OTHER"
  ): boolean {
    if (!this.canEnter()) {
      console.warn("[BotEngine] Entry Blocked: State is not SCAN or Position exists.");
      return false;
    }
    this.enterPosition(side, entry, stopLoss, kind);
    return true;
  }

  /**
   * Reset position and return to SCAN state.
   */
  exitPosition(exitPrice?: number): void {
    if (this.position && typeof exitPrice === "number") {
      const dir = this.position.side === "long" ? 1 : -1;
      const pnl = (exitPrice - this.position.entryPrice) * dir * this.position.size;
      this.dailyPnl += pnl;
      this.closedToday += 1;
      this.config.accountBalance += pnl;
      this.position.closed = Date.now();
      // update equity peak / drawdown
      this.equityPeak = Math.max(this.equityPeak, this.config.accountBalance);
      const dd = (this.equityPeak - this.config.accountBalance) / Math.max(this.equityPeak, 1e-8);
      this.currentDrawdown = dd;
    }
    this.position = null;
    this.state = State.Scan;
    if (this.config.cooldownBars > 0) {
      const now = new Date();
      this.cooldownUntil = new Date(now.getTime() + this.config.cooldownBars * 60 * 1000);
    }
  }

  /**
   * Update water marks (highest and lowest price reached since entry).
   */
  updateWaterMarks(price: number): void {
    if (!this.position) return;
    if (this.position.side === "long") {
      this.position.highWaterMark = Math.max(this.position.highWaterMark, price);
    } else {
      this.position.lowWaterMark = Math.min(this.position.lowWaterMark, price);
    }
  }

  /**
   * Compute a swing‑structure stop. For longs it returns the last swing low
   * minus a buffer; for shorts the last swing high plus a buffer.
   */
  computeSwingStop(df: DataFrame, side: "long" | "short"): number {
    const highs = df.map((c) => c.high);
    const lows = df.map((c) => c.low);
    const closes = df.map((c) => c.close);
    const atrArray = computeATR(highs, lows, closes, this.config.atrPeriod);
    const atr = atrArray[atrArray.length - 1];
    if (side === "long") {
      // find latest local minimum: price lower than its neighbours
      for (let i = lows.length - 2; i > 0; i--) {
        if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) {
          return lows[i] - this.config.swingBackoffAtr * atr;
        }
      }
      // fallback: last low
      return lows[lows.length - 1] - this.config.swingBackoffAtr * atr;
    } else {
      // find latest local maximum
      for (let i = highs.length - 2; i > 0; i--) {
        if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) {
          return highs[i] + this.config.swingBackoffAtr * atr;
        }
      }
      return highs[highs.length - 1] + this.config.swingBackoffAtr * atr;
    }
  }

  /**
   * Update trailing stop of the current position. Chooses the tighter of
   * ATR‑based trailing and swing‑structure trailing.
   */
  updateTrailingStop(df: DataFrame): void {
    if (!this.position) return;
    const highs = df.map((c) => c.high);
    const lows = df.map((c) => c.low);
    const closes = df.map((c) => c.close);
    const atrArray = computeATR(highs, lows, closes, this.config.atrPeriod);
    const atr = atrArray[atrArray.length - 1];
    if (this.position.side === "long") {
      const atrStop = this.position.highWaterMark - this.config.atrTrailMultiplier * atr;
      const swingStop = this.computeSwingStop(df, "long");
      const candidate = Math.max(atrStop, swingStop);
      if (candidate > this.position.trailingStop) {
        this.position.trailingStop = candidate;
      }
    } else {
      const atrStop = this.position.lowWaterMark + this.config.atrTrailMultiplier * atr;
      const swingStop = this.computeSwingStop(df, "short");
      const candidate = Math.min(atrStop, swingStop);
      if (candidate < this.position.trailingStop) {
        this.position.trailingStop = candidate;
      }
    }
  }

  /**
   * Compute simple institutional zones from a higher timeframe.
   * Returns a sorted array of price levels.
   */
  computeInstitutionalZones(df: DataFrame): { price: number; type: string; weight: number }[] {
    const lookback = df.slice(-this.config.lookbackZones);
    const highs = lookback.map((c) => c.high);
    const lows = lookback.map((c) => c.low);
    const closes = lookback.map((c) => c.close);
    const volumes = lookback.map((c) => c.volume);
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const midpoint = (high + low) / 2;
    const fib618 = low + 0.618 * (high - low);
    const fib382 = low + 0.382 * (high - low);
    // Volume profile approximation: weight by volume*close
    const weightedLevels: Record<string, { sum: number; vol: number }> = {};
    closes.forEach((c, i) => {
      const bucket = Math.round(c); // simple bucketing to nearest unit
      if (!weightedLevels[bucket]) weightedLevels[bucket] = { sum: 0, vol: 0 };
      weightedLevels[bucket].sum += volumes[i];
      weightedLevels[bucket].vol += 1;
    });
    const buckets = Object.keys(weightedLevels).map((k) => ({
      price: Number(k),
      vol: weightedLevels[k].sum,
    }));
    buckets.sort((a, b) => b.vol - a.vol);
    const poc = buckets.length ? buckets[0].price : midpoint;
    const hvn = buckets.slice(0, 3).map((b) => b.price);
    const lvn = buckets.slice(-3).map((b) => b.price);
    // Recent swings as liquidity clusters
    const swings: number[] = [];
    for (let i = 1; i < highs.length - 1; i++) {
      if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1]) swings.push(highs[i]);
      if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1]) swings.push(lows[i]);
    }
    const zones: { price: number; type: string; weight: number }[] = [
      { price: low, type: "rangeLow", weight: 0.5 },
      { price: fib382, type: "fib382", weight: 0.6 },
      { price: midpoint, type: "mid", weight: 0.7 },
      { price: fib618, type: "fib618", weight: 0.6 },
      { price: high, type: "rangeHigh", weight: 0.5 },
      { price: poc, type: "poc", weight: 1 },
      ...hvn.map((p) => ({ price: p, type: "hvn", weight: 0.9 })),
      ...lvn.map((p) => ({ price: p, type: "lvn", weight: 0.7 })),
      ...swings.map((p) => ({ price: p, type: "swing", weight: 0.8 })),
    ];
    // Deduplicate similar levels
    const dedup: { price: number; type: string; weight: number }[] = [];
    zones.forEach((z) => {
      const existing = dedup.find((d) => Math.abs(d.price - z.price) < (z.price * 0.001));
      if (existing) {
        existing.weight = Math.max(existing.weight, z.weight);
      } else {
        dedup.push(z);
      }
    });
    return dedup.sort((a, b) => a.price - b.price);
  }

  /**
   * Update dynamic take‑profit based on trend strength and institutional zones.
   */
  updateTakeProfit(ht: DataFrame, lt: DataFrame): void {
    if (!this.position) return;
    const currentPrice = lt[lt.length - 1].close;
    // Only adjust if price has moved beyond original TP
    if (this.position.side === "long" && currentPrice <= this.position.takeProfit) return;
    if (this.position.side === "short" && currentPrice >= this.position.takeProfit) return;
    // Determine trend on higher timeframe
    const trend = this.determineTrend(ht);
    if (trend === Trend.Range) return;
    const adxVal = computeADX(
      ht.map((c) => c.high),
      ht.map((c) => c.low),
      ht.map((c) => c.close),
      this.config.adxPeriod,
    );
    const currentAdx = adxVal[adxVal.length - 1];
    if (currentAdx < this.config.adxThreshold) return;
    const zones = this.computeInstitutionalZones(ht);
    if (this.position.side === "long") {
      const higher = zones.filter((z) => z.price > this.position.takeProfit);
      if (higher.length > 0) {
        const best = higher.sort((a, b) => b.weight - a.weight || a.price - b.price)[0];
        this.position.takeProfit = best.price;
      } else {
        // No higher zone -> rely on trailing stop
        this.position.takeProfit = Infinity;
      }
    } else {
      const lower = zones.filter((z) => z.price < this.position.takeProfit);
      if (lower.length > 0) {
        const best = lower.sort((a, b) => b.weight - a.weight || b.price - a.price)[0];
        this.position.takeProfit = best.price;
      } else {
        this.position.takeProfit = -Infinity;
      }
    }
  }

  private computeConfluence(ht: DataFrame, lt: DataFrame, trend: Trend): { score: number; liquiditySweep: boolean; volExpansion: boolean } {
    const liquiditySweep = this.isLiquiditySweep(ht);
    const volExpansion = this.isVolatilityExpansion(lt);
    let score = 0;
    if (trend !== Trend.Range) score += 2;
    if (liquiditySweep) score += 2;
    if (volExpansion) score += 1;
    const adxArray = computeADX(
      lt.map((c) => c.high),
      lt.map((c) => c.low),
      lt.map((c) => c.close),
      this.config.adxPeriod,
    );
    const adxNow = adxArray[adxArray.length - 1];
    if (adxNow >= this.config.aggressiveAdxThreshold) score += 1;
    return { score, liquiditySweep, volExpansion };
  }

  private isLiquiditySweep(df: DataFrame): boolean {
    if (df.length < this.config.liquiditySweepLookback + 2) return false;
    const highs = df.map((c) => c.high);
    const lows = df.map((c) => c.low);
    const closes = df.map((c) => c.close);
    const vols = df.map((c) => c.volume);
    const atrArr = computeATR(highs, lows, closes, this.config.atrPeriod);
    const atr = atrArr[atrArr.length - 1] || 0;
    const lb = this.config.liquiditySweepLookback;
    const swingHigh = Math.max(...highs.slice(-lb - 1, -1));
    const swingLow = Math.min(...lows.slice(-lb - 1, -1));
    const last = df[df.length - 1];
    const volSmaWindow = Math.min(vols.length, 50);
    const volSma = vols.slice(-volSmaWindow).reduce((a, b) => a + b, 0) / Math.max(1, volSmaWindow);
    const volOk = last.volume > this.config.liquiditySweepVolumeMult * volSma;
    const sweptHigh = last.high > swingHigh + this.config.liquiditySweepAtrMult * atr && last.close < swingHigh;
    const sweptLow = last.low < swingLow - this.config.liquiditySweepAtrMult * atr && last.close > swingLow;
    return volOk && (sweptHigh || sweptLow);
  }

  private isVolatilityExpansion(df: DataFrame): boolean {
    if (df.length < 20) return false;
    const highs = df.map((c) => c.high);
    const lows = df.map((c) => c.low);
    const closes = df.map((c) => c.close);
    const vols = df.map((c) => c.volume);
    const atrArr = computeATR(highs, lows, closes, this.config.atrPeriod);
    const atrNow = atrArr[atrArr.length - 1] || 0;
    const atrWindow = Math.min(atrArr.length, 20);
    const atrSma = atrArr.slice(-atrWindow).reduce((a, b) => a + b, 0) / Math.max(1, atrWindow);
    const volWindow = Math.min(vols.length, 50);
    const volSma = vols.slice(-volWindow).reduce((a, b) => a + b, 0) / Math.max(1, volWindow);
    const volNow = vols[vols.length - 1] || 0;
    return atrNow > this.config.volExpansionAtrMult * atrSma && volNow > this.config.volExpansionVolMult * volSma;
  }

  /**
   * Manage an open position: update trailing stop, dynamic TP and exit if needed.
   */
  async managePosition(): Promise<void> {
    if (!this.position) return;
    const ht = await this.fetchOHLCV(this.config.baseTimeframe);
    const lt = await this.fetchOHLCV(this.config.signalTimeframe);
    this.handleManage(ht, lt);
  }

  /**
   * Main loop step. In SCAN state it looks for new entries; in MANAGE
   * state it manages the current trade. Should be called at regular
   * intervals (e.g. on each new candle).
   */
  async step(): Promise<void> {
    if (this.state === State.Scan) {
      const signal = await this.scanForEntry();
      if (signal) {
        this.enterPosition(signal.side, signal.entry, signal.stopLoss, signal.kind);
      }
    } else if (this.state === State.Manage) {
      await this.managePosition();
    }
  }

  /**
   * Deterministická varianta – používá již připravené higher/low TF rámce.
   */
  stepWithFrames(ht: DataFrame, lt: DataFrame): void {
    const now = lt[lt.length - 1]?.openTime ?? Date.now();
    this.resetDaily(now);
    if (!this.withinSession(now) || this.riskHalted()) {
      return;
    }
    if (this.state === State.Scan) {
      const signal = this.scanForEntryFromFrames(ht, lt);
      if (signal) {
        this.enterPosition(signal.side, signal.entry, signal.stopLoss, signal.kind);
      }
    } else if (this.state === State.Manage) {
      this.managePositionWithFrames(ht, lt);
    }
  }

  scanForEntryFromFrames(
    ht: DataFrame,
    lt: DataFrame,
  ): EntrySignal | null {
    if (this.cooldownUntil && new Date() < this.cooldownUntil) return null;

    // 0. ABSOLUTE CHAOS GATE
    if (this.isVolatileChaos(ht)) {
      return null; // Too volatile, skip
    }

    let trend = this.determineTrend(ht);
    if (lt.length < 3) return null;
    const closes = lt.map((c) => c.close);
    const highs = lt.map((c) => c.high);
    const lows = lt.map((c) => c.low);
    const atrArray = computeATR(highs, lows, closes, this.config.atrPeriod);
    const latestATR = atrArray[atrArray.length - 1];
    const price = closes[closes.length - 1];
    const ensureStop = (side: "long" | "short", entry: number, stop: number) =>
      this.enforceMinimumStop(entry, stop, side, latestATR);
    const entryStopMode = this.config.entryStopMode ?? "atr";
    const swingStops =
      entryStopMode === "swing"
        ? {
            long: this.computeSwingStop(lt, "long"),
            short: this.computeSwingStop(lt, "short"),
          }
        : null;
    const resolveEntryStop = (
      side: "long" | "short",
      entry: number,
      fallback: number,
    ) => ensureStop(side, entry, swingStops ? swingStops[side] : fallback);
    const conf = this.computeConfluence(ht, lt, trend);
    if (this.config.strategyProfile === "scalp" && conf.score < 3 && !conf.liquiditySweep) return null;
    const strictness =
      this.config.entryStrictness ??
      (this.config.strategyProfile === "intraday"
        ? "ultra"
        : this.config.strategyProfile === "scalp"
          ? "relaxed"
          : "base");
    const isTest = strictness === "test";

    // REGIME GATE: Trend vs Range logic
    // Range Mode: Low ADX from determineTrend
    if (trend === Trend.Range && !isTest) {
      // Logic for Range: Mean Reversion ONLY

      const ema = (period: number): number[] => {
        const out: number[] = [];
        const k = 2 / (period + 1);
        closes.forEach((p, i) => {
          if (i === 0) out.push(p);
          else out.push(out[i - 1] + k * (p - out[i - 1]));
        });
        return out;
      };
      const ema50 = ema(50);

      // Strict ATR filter for Range to avoid noise
      const minAtrThreshold = this.config.minAtrFractionOfPrice * 1.5;
      if (latestATR < price * minAtrThreshold) return null;

      const zCut = strictness === "ultra" ? 0.8 : strictness === "relaxed" ? 1.0 : 1.5;
      const zScore = (price - ema50[ema50.length - 1]) / (latestATR || 1e-8);

      if (zScore <= -zCut) {
        const entry = price;
        const stop = resolveEntryStop("long", entry, price - this.config.atrEntryMultiplier * latestATR);
        return { side: "long", entry, stopLoss: stop, kind: "MEAN_REVERSION" };
      }
      if (zScore >= zCut) {
        const entry = price;
        const stop = resolveEntryStop("short", entry, price + this.config.atrEntryMultiplier * latestATR);
        return { side: "short", entry, stopLoss: stop, kind: "MEAN_REVERSION" };
      }
      return null;
    }

    // Trend Mode (or Test Mode Fallback)

    // Fallback for Test Mode if Range
    if (trend === Trend.Range && isTest) {
      // Force a trend based on simple momentum
      const last = closes.slice(-3);
      const net = (last[last.length - 1] ?? 0) - (last[0] ?? 0);
      trend = net >= 0 ? Trend.Bull : Trend.Bear;
    } else if (trend === Trend.Range) {
      // Should be caught above, but doubly ensure we don't apply Trend logic to Range
      return null;
    }

    const minAtrThreshold =
      this.config.minAtrFractionOfPrice *
      (isTest ? 0 : strictness === "ultra" ? 0.25 : strictness === "relaxed" ? 0.5 : 1);
    if (!isTest && latestATR < price * minAtrThreshold) return null;
    const ema = (period: number): number[] => {
      const out: number[] = [];
      const k = 2 / (period + 1);
      closes.forEach((p, i) => {
        if (i === 0) out.push(p);
        else out.push(out[i - 1] + k * (p - out[i - 1]));
      });
      return out;
    };
    const ema20 = ema(20);
    const momentumLen = strictness === "base" ? 3 : 2;
    const lastN = closes.slice(-momentumLen);
    const diffs = lastN.slice(1).map((v, i) => v - lastN[i]);
    if (trend === Trend.Bull && diffs.every((d) => d > 0)) {
      const entry = lastN[lastN.length - 1];
      const stop = resolveEntryStop("long", entry, entry - this.config.atrEntryMultiplier * latestATR);
      return { side: "long", entry, stopLoss: stop, kind: "MOMENTUM" };
    }
    if (trend === Trend.Bear && diffs.every((d) => d < 0)) {
      const entry = lastN[lastN.length - 1];
      const stop = resolveEntryStop("short", entry, entry + this.config.atrEntryMultiplier * latestATR);
      return { side: "short", entry, stopLoss: stop, kind: "MOMENTUM" };
    }
    const c0 = closes[closes.length - 1];
    const c1 = closes[closes.length - 2];
    const emaNow = ema20[ema20.length - 1];
    const emaPrev = ema20[ema20.length - 2];
    if (trend === Trend.Bull && c1 < emaPrev && c0 > emaNow) {
      const entry = c0;
      const stop = resolveEntryStop(
        "long",
        entry,
        Math.min(c1, lows[lows.length - 2]) - this.config.swingBackoffAtr * latestATR,
      );
      return { side: "long", entry, stopLoss: stop, kind: "PULLBACK" };
    }
    if (trend === Trend.Bear && c1 > emaPrev && c0 < emaNow) {
      const entry = c0;
      const stop = resolveEntryStop(
        "short",
        entry,
        Math.max(c1, highs[highs.length - 2]) + this.config.swingBackoffAtr * latestATR,
      );
      return { side: "short", entry, stopLoss: stop, kind: "PULLBACK" };
    }
    const lookback = strictness === "ultra" ? 5 : strictness === "relaxed" ? 8 : strictness === "test" ? 3 : 12;
    const recentHigh = Math.max(...highs.slice(-lookback));
    const recentLow = Math.min(...lows.slice(-lookback));
    if (trend === Trend.Bull && price > recentHigh) {
      const entry = price;
      const stop = resolveEntryStop("long", entry, recentLow - this.config.swingBackoffAtr * latestATR);
      return { side: "long", entry, stopLoss: stop, kind: "BREAKOUT" };
    }
    if (trend === Trend.Bear && price < recentLow) {
      const entry = price;
      const stop = resolveEntryStop("short", entry, recentHigh + this.config.swingBackoffAtr * latestATR);
      return { side: "short", entry, stopLoss: stop, kind: "BREAKOUT" };
    }

    // Note: Mean Reversion for Trend mode is REMOVED as requested.
    // Logic below is only optional permissive triggers for Test/Ultra modes

    if (strictness === "ultra" || isTest) {
      const emaBias = trend === Trend.Bull ? price > ema20[ema20.length - 1] : price < ema20[ema20.length - 1];
      if (emaBias) {
        const entry = price;
        const stop =
          trend === Trend.Bull
            ? resolveEntryStop("long", price, price - this.config.atrEntryMultiplier * latestATR)
            : resolveEntryStop("short", price, price + this.config.atrEntryMultiplier * latestATR);
        return { side: trend === Trend.Bull ? "long" : "short", entry, stopLoss: stop, kind: "MOMENTUM" };
      }
    }
    if (isTest) {
      // Final permissive trigger: allow either momentum or EMA bias alone
      const last = closes.slice(-2);
      const dir = (last[last.length - 1] ?? 0) - (last[0] ?? 0) >= 0 ? "long" : "short";
      const entry = price;
      const stop =
        dir === "long"
          ? resolveEntryStop("long", price, price - this.config.atrEntryMultiplier * latestATR)
          : resolveEntryStop("short", price, price + this.config.atrEntryMultiplier * latestATR);
      return { side: dir as "long" | "short", entry, stopLoss: stop, kind: "OTHER" };
    }
    return null;
  }

  private managePositionWithFrames(ht: DataFrame, lt: DataFrame): void {
    if (!this.position) return;
    this.handleManage(ht, lt);

    // TIME STOP + STAGNATION CHECK
    const pos = this.position;
    const now = lt[lt.length - 1]?.openTime || Date.now();
    const durationMs = now - pos.opened;

    // Estimate bars passed (assuming base timeframe approx)
    // Roughly check if duration > X minutes
    // Let's rely on candle counts if we had them linked, but time diff is robust.

    // If held for 12 bars (approx 1h on 5m chart) and profit < 0.5R => Exit
    // We'll calculate current PnL R
    const currentPrice = lt[lt.length - 1].close;
    const dist = currentPrice - pos.entryPrice;
    const pnlR = (pos.side === "long" ? dist : -dist) / (Math.abs(pos.entryPrice - pos.stopLoss) || 1);

    // Hardcoded 2 hours for now as "Time Stop"
    if (durationMs > 2 * 3600 * 1000 && pnlR < 0.5) {
      // Stagnant trade
      this.exitPosition(currentPrice);
    }
  }

  getState(): State {
    return this.state;
  }

  getConfig(): BotConfig {
    return this.config;
  }

  getPosition(): Position | null {
    return this.position;
  }

  isHalted(): boolean {
    return this.riskHalted();
  }

  getDrawdown(): number {
    return this.currentDrawdown;
  }
}

/**
 * Resample lower timeframe candles (e.g. 1m) to target resolution in minutes.
 */
export function resampleCandles(candles: Candle[], targetMinutes: number): Candle[] {
  if (!candles.length) return [];
  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  const result: Candle[] = [];
  const ms = targetMinutes * 60 * 1000;
  let bucketStart = Math.floor(sorted[0].openTime / ms) * ms;
  let bucket: Candle[] = [];
  for (const c of sorted) {
    const bucketKey = Math.floor(c.openTime / ms) * ms;
    if (bucketKey !== bucketStart) {
      if (bucket.length) {
        const first = bucket[0];
        const high = Math.max(...bucket.map((x) => x.high));
        const low = Math.min(...bucket.map((x) => x.low));
        const close = bucket[bucket.length - 1].close;
        const volume = bucket.reduce((s, x) => s + x.volume, 0);
        result.push({ openTime: bucketStart, open: first.open, high, low, close, volume });
      }
      bucketStart = bucketKey;
      bucket = [];
    }
    bucket.push(c);
  }
  if (bucket.length) {
    const first = bucket[0];
    const high = Math.max(...bucket.map((x) => x.high));
    const low = Math.min(...bucket.map((x) => x.low));
    const close = bucket[bucket.length - 1].close;
    const volume = bucket.reduce((s, x) => s + x.volume, 0);
    result.push({ openTime: bucketStart, open: first.open, high, low, close, volume });
  }
  return result;
}

function timeframeToMinutes(tf: string): number {
  const num = parseInt(tf, 10);
  if (tf.endsWith("h")) return num * 60;
  if (tf.endsWith("d")) return num * 60 * 24;
  return num; // assume minutes
}

export type EngineSignal = {
  id: string;
  symbol: string;
  intent: { side: "buy" | "sell"; entry: number; sl: number; tp: number };
  setupId?: string;
  entryType?: "LIMIT_MAKER_FIRST" | "LIMIT" | "CONDITIONAL";
  triggerPrice?: number;
  kind?: EntryKind;
  risk: number;
  message: string;
  createdAt: string;
};

export type EngineDecision = {
  state: State;
  trend: Trend;
  trendScore?: number;
  trendAdx?: number;
  signal?: EngineSignal | null;
  position?: Position | null;
  halted?: boolean;
};

const botRegistry: Record<string, TradingBot> = {};

function ensureBot(symbol: string, config?: Partial<BotConfig>): TradingBot {
  if (!botRegistry[symbol]) {
    botRegistry[symbol] = new TradingBot({ symbol, ...config });
  } else if (config) {
    botRegistry[symbol].updateConfig({ symbol, ...config });
  }
  return botRegistry[symbol];
}

/**
 * Hlavní vstup pro UI / feed: z nižšího TF (např. 1m) resampluje na
 * baseTimeframe/signalTimeframe, spustí stavový automat a vrátí signál.
 */
export function evaluateStrategyForSymbol(
  symbol: string,
  candles: Candle[],
  config: Partial<BotConfig> = {},
): EngineDecision {
  const bot = ensureBot(symbol, config);
  const botConfig = bot.getConfig();
  const tfBaseMin = timeframeToMinutes(botConfig.baseTimeframe);
  const tfSigMin = timeframeToMinutes(botConfig.signalTimeframe);
  const ht = resampleCandles(candles, tfBaseMin);
  const lt = resampleCandles(candles, tfSigMin);
  if (!ht.length || !lt.length) {
    return {
      state: bot.getState(),
      trend: Trend.Range,
      trendScore: 0,
      trendAdx: Number.NaN,
      halted: true,
    };
  }
  const prevState = bot.getState();
  const prevOpened = bot.getPosition()?.opened;
  bot.stepWithFrames(ht, lt);
  const trendMetrics = bot.getTrendMetrics(ht);
  const trend = trendMetrics.trend;
  let signal: EngineSignal | null = null;
  const position = bot.getPosition();
  if (
    prevState === State.Scan &&
    bot.getState() === State.Manage &&
    position &&
    position.opened !== prevOpened
  ) {
    signal = {
      id: `${symbol}-${Date.now()}`,
      symbol,
      intent: {
        side: position.side === "long" ? "buy" : "sell",
        entry: position.entryPrice,
        sl: position.stopLoss,
        tp: position.initialTakeProfit,
      },
      kind: position.entryKind ?? "OTHER",
      risk: 0.7,
      message: `Entered ${position.side} with SL ${position.stopLoss.toFixed(2)} | TP ${position.initialTakeProfit.toFixed(2)}`,
      createdAt: new Date().toISOString(),
    };
  }
  if (signal && botConfig.useStrategyCheatSheet) {
    const setupId =
      botConfig.cheatSheetSetupId ?? getDefaultCheatSheetSetupId();
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
    state: bot.getState(),
    trend,
    trendScore: trendMetrics.score,
    trendAdx: trendMetrics.adx,
    signal,
    position,
    halted: bot.isHalted(),
  };
}
