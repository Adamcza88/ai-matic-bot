/*
 * Trading bot engine for Bybit USDT‑perpetual futures.
 *
 * This TypeScript module implements the core logic described in
 * the document “Návrh úprav algoritmického trading bota (USDT‑perpetual
 * Bybit)”. It is designed to be self‑contained and easily integrated
 * into a Node.js or browser‑based trading system. No external
 * indicator libraries are required; ATR and ADX computations are
 * implemented directly.
 *
 * Key features:
 *  - Multi‑timeframe scanning with relaxed entry filters to increase
 *    trade frequency (~20 trades per day).
 *  - State machine (SCAN vs MANAGE) with full‑focus behaviour: only
 *    one active trade at a time.
 *  - Trailing stop strategies (ATR‑based and swing‑structure) and
 *    one‑way ratcheting to protect profits.
 *  - Dynamic take‑profit repositioning based on trend strength and
 *    institutional zones (support/resistance, liquidity clusters, etc.).
 *  - Partial exits (scale‑out) and break‑even stop after initial target.
 *  - Simple heuristics for institutional zone identification.
 */

export enum Trend {
  Bull = "bull",
  Bear = "bear",
  Neutral = "neutral",
}

export enum State {
  Scan = "SCAN",
  Manage = "MANAGE",
}

/**
 * Candle represents a single OHLCV bar.
 */
export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Position represents an open trade being managed.
 */
export interface Position {
  entryPrice: number;
  size: number;
  side: "long" | "short";
  stopLoss: number;
  takeProfit: number;
  trailingStop: number;
  highWaterMark: number;
  lowWaterMark: number;
  opened: Date;
  partialTaken: boolean;
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
  atrPeriod: number;
  adxPeriod: number;
  adxThreshold: number;
  swingBackoffAtr: number;
  fixedTrailingPercent: number;
  partialExitRatio: number;
  lookbackZones: number;
}

/**
 * Default configuration values.
 */
export const defaultConfig: BotConfig = {
  symbol: "BTC/USDT",
  baseTimeframe: "1h",
  signalTimeframe: "5m",
  targetTradesPerDay: 20,
  riskPerTrade: 0.01,
  atrPeriod: 14,
  adxPeriod: 14,
  adxThreshold: 25,
  swingBackoffAtr: 1,
  fixedTrailingPercent: 0.01,
  partialExitRatio: 0.5,
  lookbackZones: 50,
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
  // History of OHLCV by timeframe
  private history: Record<string, DataFrame>;
  // Exchange client interface (optional)
  private exchange?: any;

  constructor(config: Partial<BotConfig> = {}, exchange?: any) {
    this.config = { ...defaultConfig, ...config };
    this.state = State.Scan;
    this.position = null;
    this.history = {};
    this.exchange = exchange;
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
    const ohlcv = await this.exchange.fetchOHLCV(this.config.symbol, timeframe, undefined, limit);
    const result: DataFrame = ohlcv.map((c: any[]) => ({
      timestamp: new Date(c[0]),
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

  /**
   * Determine the prevailing trend on the given timeframe using
   * exponential moving averages and ADX.
   */
  determineTrend(df: DataFrame): Trend {
    const closes = df.map((c) => c.close);
    // Compute EMAs
    const emaShort: number[] = [];
    const emaLong: number[] = [];
    const spanShort = 20;
    const spanLong = 50;
    let emaShortVal = 0;
    let emaLongVal = 0;
    const multiplierShort = 2 / (spanShort + 1);
    const multiplierLong = 2 / (spanLong + 1);
    closes.forEach((price, i) => {
      if (i === 0) {
        emaShortVal = price;
        emaLongVal = price;
      } else {
        emaShortVal = (price - emaShortVal) * multiplierShort + emaShortVal;
        emaLongVal = (price - emaLongVal) * multiplierLong + emaLongVal;
      }
      emaShort.push(emaShortVal);
      emaLong.push(emaLongVal);
    });
    const highs = df.map((c) => c.high);
    const lows = df.map((c) => c.low);
    const adxArray = computeADX(highs, lows, closes, this.config.adxPeriod);
    const currentAdx = adxArray[adxArray.length - 1];
    if (emaShort[emaShort.length - 1] > emaLong[emaLong.length - 1] && currentAdx >= this.config.adxThreshold) {
      return Trend.Bull;
    }
    if (emaShort[emaShort.length - 1] < emaLong[emaLong.length - 1] && currentAdx >= this.config.adxThreshold) {
      return Trend.Bear;
    }
    return Trend.Neutral;
  }

  /**
   * Scan for entry signals on the configured timeframes. Returns a signal
   * description or null.
   */
  async scanForEntry(): Promise<{ side: "long" | "short"; entry: number; stopLoss: number } | null> {
    // Determine trend from the base timeframe
    const ht = await this.fetchOHLCV(this.config.baseTimeframe);
    const trend = this.determineTrend(ht);
    if (trend === Trend.Neutral) return null;
    // Use signal timeframe for entry timing
    const lt = await this.fetchOHLCV(this.config.signalTimeframe);
    if (lt.length < 3) return null;
    const closes = lt.map((c) => c.close);
    const highs = lt.map((c) => c.high);
    const lows = lt.map((c) => c.low);
    const atrArray = computeATR(highs, lows, closes, this.config.atrPeriod);
    const latestATR = atrArray[atrArray.length - 1];
    // Simple momentum filter: two consecutive closes in trend direction
    const last3 = closes.slice(-3);
    const diff1 = last3[1] - last3[0];
    const diff2 = last3[2] - last3[1];
    if (trend === Trend.Bull && diff1 > 0 && diff2 > 0) {
      const entry = last3[2];
      const stop = entry - 2 * latestATR;
      return { side: "long", entry, stopLoss: stop };
    }
    if (trend === Trend.Bear && diff1 < 0 && diff2 < 0) {
      const entry = last3[2];
      const stop = entry + 2 * latestATR;
      return { side: "short", entry, stopLoss: stop };
    }
    return null;
  }

  /**
   * Open a new position and switch to MANAGE state. Calculates position
   * size based on risk management settings.
   */
  enterPosition(side: "long" | "short", entry: number, stopLoss: number): void {
    // Compute risk per trade
    const balance = 1; // placeholder; supply real account balance
    const riskAmount = this.config.riskPerTrade * balance;
    const slDistance = side === "long" ? entry - stopLoss : stopLoss - entry;
    const size = riskAmount / Math.max(slDistance, 1e-8);
    const tp = side === "long" ? entry + 2 * slDistance : entry - 2 * slDistance;
    this.position = {
      entryPrice: entry,
      size: size,
      side: side,
      stopLoss: stopLoss,
      takeProfit: tp,
      trailingStop: stopLoss,
      highWaterMark: entry,
      lowWaterMark: entry,
      opened: new Date(),
      partialTaken: false,
    };
    this.state = State.Manage;
  }

  /**
   * Reset position and return to SCAN state.
   */
  exitPosition(): void {
    this.position = null;
    this.state = State.Scan;
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
      const atrStop = this.position.highWaterMark - 2 * atr;
      const swingStop = this.computeSwingStop(df, "long");
      const candidate = Math.max(atrStop, swingStop);
      if (candidate > this.position.trailingStop) {
        this.position.trailingStop = candidate;
      }
    } else {
      const atrStop = this.position.lowWaterMark + 2 * atr;
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
  computeInstitutionalZones(df: DataFrame): number[] {
    const lookback = df.slice(-this.config.lookbackZones);
    const highs = lookback.map((c) => c.high);
    const lows = lookback.map((c) => c.low);
    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const midpoint = (high + low) / 2;
    const fib618 = low + 0.618 * (high - low);
    const fib382 = low + 0.382 * (high - low);
    const zones = [low, fib382, midpoint, fib618, high];
    return zones.sort((a, b) => a - b);
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
    if (trend === Trend.Neutral) return;
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
      const higher = zones.filter((z) => z > this.position.takeProfit);
      if (higher.length > 0) {
        this.position.takeProfit = Math.min(...higher);
      }
    } else {
      const lower = zones.filter((z) => z < this.position.takeProfit);
      if (lower.length > 0) {
        this.position.takeProfit = Math.max(...lower);
      }
    }
  }

  /**
   * Manage an open position: update trailing stop, dynamic TP and exit if needed.
   */
  async managePosition(): Promise<void> {
    if (!this.position) return;
    const ht = await this.fetchOHLCV(this.config.baseTimeframe);
    const lt = await this.fetchOHLCV(this.config.signalTimeframe);
    const currentPrice = lt[lt.length - 1].close;
    // Update water marks
    this.updateWaterMarks(currentPrice);
    // Update trailing stop and take profit
    this.updateTrailingStop(lt);
    this.updateTakeProfit(ht, lt);
    // Exit conditions
    if (this.position.side === "long") {
      if (currentPrice <= this.position.stopLoss || currentPrice <= this.position.trailingStop) {
        this.exitPosition();
        return;
      }
      if (currentPrice >= this.position.takeProfit) {
        // partial exit
        if (!this.position.partialTaken) {
          this.position.size *= 1 - this.config.partialExitRatio;
          this.position.partialTaken = true;
          // move SL to break even
          this.position.stopLoss = this.position.entryPrice;
          // reset TP so it can be moved again
          this.position.takeProfit = Infinity;
        } else {
          this.exitPosition();
          return;
        }
      }
    } else {
      if (currentPrice >= this.position.stopLoss || currentPrice >= this.position.trailingStop) {
        this.exitPosition();
        return;
      }
      if (currentPrice <= this.position.takeProfit) {
        if (!this.position.partialTaken) {
          this.position.size *= 1 - this.config.partialExitRatio;
          this.position.partialTaken = true;
          this.position.stopLoss = this.position.entryPrice;
          this.position.takeProfit = -Infinity;
        } else {
          this.exitPosition();
          return;
        }
      }
    }
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
        this.enterPosition(signal.side, signal.entry, signal.stopLoss);
      }
    } else if (this.state === State.Manage) {
      await this.managePosition();
    }
  }
}