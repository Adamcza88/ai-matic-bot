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
export var Trend;
(function (Trend) {
    Trend["Bull"] = "bull";
    Trend["Bear"] = "bear";
    Trend["Neutral"] = "neutral";
})(Trend || (Trend = {}));
/**
 * Helper: position sizing based on balance, risk %, and SL distance.
 */
export function computePositionSize(balance, riskPct, entry, sl) {
    const riskAmount = balance * riskPct;
    const slDistance = Math.abs(entry - sl);
    if (slDistance <= 0)
        return 0;
    return riskAmount / slDistance;
}
export var State;
(function (State) {
    State["Scan"] = "SCAN";
    State["Manage"] = "MANAGE";
})(State || (State = {}));
/**
 * Default configuration values.
 */
export const defaultConfig = {
    symbol: "BTCUSDT",
    baseTimeframe: "1h",
    signalTimeframe: "5m",
    targetTradesPerDay: 100,
    riskPerTrade: 0.01,
    strategyProfile: "scalp",
    entryStrictness: "ultra",
    accountBalance: 200000,
    atrPeriod: 14,
    adxPeriod: 14,
    adxThreshold: 25,
    aggressiveAdxThreshold: 35,
    atrEntryMultiplier: 2,
    atrTrailMultiplier: 2,
    minAtrFractionOfPrice: 0.0006,
    swingBackoffAtr: 0.7,
    partialExitRatio: 0.5,
    partialTakeProfitR: 1.5,
    breakevenBufferAtr: 0.2,
    lookbackZones: 50,
    cooldownBars: 1,
    maxDailyLossPercent: 0.07,
    maxDailyProfitPercent: 0.5,
    maxDrawdownPercent: 0.1,
    tradingHours: { start: 0, end: 23, days: [0, 1, 2, 3, 4, 5, 6] },
    maxOpenPositions: 1,
    maxExitChunks: 2,
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
export function computeATR(highs, lows, closes, period) {
    const result = [];
    for (let i = 0; i < highs.length; i++) {
        const hl = highs[i] - lows[i];
        const hc = i > 0 ? Math.abs(highs[i] - closes[i - 1]) : hl;
        const lc = i > 0 ? Math.abs(lows[i] - closes[i - 1]) : hl;
        const tr = Math.max(hl, hc, lc);
        if (i === 0) {
            result.push(tr);
        }
        else {
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
export function computeADX(highs, lows, closes, period) {
    const plusDM = [];
    const minusDM = [];
    for (let i = 1; i < highs.length; i++) {
        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }
    const tr = computeATR(highs, lows, closes, 1);
    // Smoothed TR over period
    const smoothedTR = [];
    for (let i = 0; i < tr.length; i++) {
        if (i === 0)
            smoothedTR.push(tr[0]);
        else
            smoothedTR.push((smoothedTR[i - 1] * (period - 1) + tr[i]) / period);
    }
    // Smoothed plus and minus DM
    const smoothedPlus = [];
    const smoothedMinus = [];
    for (let i = 0; i < plusDM.length; i++) {
        if (i === 0) {
            smoothedPlus.push(plusDM[0]);
            smoothedMinus.push(minusDM[0]);
        }
        else {
            smoothedPlus.push((smoothedPlus[i - 1] * (period - 1) + plusDM[i]) / period);
            smoothedMinus.push((smoothedMinus[i - 1] * (period - 1) + minusDM[i]) / period);
        }
    }
    // Calculate DI and DX
    const plusDI = [];
    const minusDI = [];
    const dx = [];
    for (let i = 0; i < smoothedPlus.length; i++) {
        const trVal = smoothedTR[i + 1] || smoothedTR[i];
        const pdi = (smoothedPlus[i] / trVal) * 100;
        const mdi = (smoothedMinus[i] / trVal) * 100;
        plusDI.push(pdi);
        minusDI.push(mdi);
        dx.push(((Math.abs(pdi - mdi) / (pdi + mdi || 1)) || 0) * 100);
    }
    // Smooth DX to get ADX
    const adx = [];
    for (let i = 0; i < dx.length; i++) {
        if (i < period) {
            adx.push(0);
        }
        else if (i === period) {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++)
                sum += dx[j];
            adx.push(sum / period);
        }
        else {
            adx.push(((adx[i - 1] * (period - 1)) + dx[i]) / period);
        }
    }
    // Align the length: pad initial zeros for first period elements
    const padding = new Array(period).fill(0);
    return padding.concat(adx).slice(0, highs.length);
}
/**
 * TradingBot class encapsulates scanning and trade management logic.
 */
export class TradingBot {
    config;
    state;
    position;
    cooldownUntil;
    dailyPnl;
    tradingDay;
    closedToday;
    equityPeak;
    currentDrawdown;
    // History of OHLCV by timeframe
    history;
    // Exchange client interface (optional)
    exchange;
    constructor(config = {}, exchange) {
        this.config = { ...defaultConfig, ...config };
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
    /**
     * Fetch OHLCV data. In a live system this would call the exchange API;
     * here it relies on preloaded history for offline testing.
     */
    async fetchOHLCV(timeframe, limit = 200) {
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
        const result = ohlcv.map((c) => ({
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
    loadHistory(timeframe, data) {
        this.history[timeframe] = data;
    }
    /**
     * Determine the prevailing trend on the given timeframe using
     * exponential moving averages and ADX.
     */
    determineTrend(df) {
        const closes = df.map((c) => c.close);
        // Compute EMAs
        const emaShort = [];
        const emaLong = [];
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
            }
            else {
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
    resetDaily(now) {
        const day = new Date(now).getUTCDate();
        if (this.tradingDay === null || this.tradingDay !== day) {
            this.tradingDay = day;
            this.dailyPnl = 0;
            this.closedToday = 0;
            this.equityPeak = Math.max(this.equityPeak, this.config.accountBalance);
        }
    }
    withinSession(now) {
        if (this.config.entryStrictness === "test")
            return true;
        const d = new Date(now);
        const hour = d.getUTCHours();
        const day = d.getUTCDay();
        const { start, end, days } = this.config.tradingHours;
        if (!days.includes(day))
            return false;
        if (hour < start || hour > end)
            return false;
        return true;
    }
    riskHalted() {
        if (this.config.entryStrictness === "test")
            return false;
        const lossLimit = -this.config.accountBalance * this.config.maxDailyLossPercent;
        const profitLimit = this.config.accountBalance * this.config.maxDailyProfitPercent;
        if (this.dailyPnl <= lossLimit)
            return true;
        if (this.dailyPnl >= profitLimit)
            return true;
        if (this.currentDrawdown >= this.config.maxDrawdownPercent)
            return true;
        return false;
    }
    /**
     * Scan for entry signals on the configured timeframes. Returns a signal
     * description or null.
     */
    async scanForEntry() {
        const now = Date.now();
        this.resetDaily(now);
        if (!this.withinSession(now))
            return null;
        if (this.riskHalted())
            return null;
        if (this.cooldownUntil && new Date() < this.cooldownUntil)
            return null;
        // Determine trend from the base timeframe
        const ht = await this.fetchOHLCV(this.config.baseTimeframe);
        const trend = this.determineTrend(ht);
        if (trend === Trend.Neutral)
            return null;
        // Use signal timeframe for entry timing
        const lt = await this.fetchOHLCV(this.config.signalTimeframe);
        if (lt.length < 3)
            return null;
        const closes = lt.map((c) => c.close);
        const highs = lt.map((c) => c.high);
        const lows = lt.map((c) => c.low);
        const atrArray = computeATR(highs, lows, closes, this.config.atrPeriod);
        const latestATR = atrArray[atrArray.length - 1];
        const price = closes[closes.length - 1];
        // Skip illiquid/flat conditions
        if (latestATR < price * this.config.minAtrFractionOfPrice)
            return null;
        // Helper EMAs for pullback/bounce entries
        const ema = (period) => {
            const out = [];
            const k = 2 / (period + 1);
            closes.forEach((p, i) => {
                if (i === 0)
                    out.push(p);
                else
                    out.push(out[i - 1] + k * (p - out[i - 1]));
            });
            return out;
        };
        const ema20 = ema(20);
        const ema50 = ema(50);
        // Simple momentum filter: two consecutive closes in trend direction
        const last3 = closes.slice(-3);
        const diff1 = last3[1] - last3[0];
        const diff2 = last3[2] - last3[1];
        // Pattern 1: trend-following momentum
        if (trend === Trend.Bull && diff1 > 0 && diff2 > 0) {
            const entry = last3[2];
            const stop = entry - this.config.atrEntryMultiplier * latestATR;
            return { side: "long", entry, stopLoss: stop };
        }
        if (trend === Trend.Bear && diff1 < 0 && diff2 < 0) {
            const entry = last3[2];
            const stop = entry + this.config.atrEntryMultiplier * latestATR;
            return { side: "short", entry, stopLoss: stop };
        }
        // Pattern 2: pullback to EMA20 with bounce confirmation
        const c0 = closes[closes.length - 1];
        const c1 = closes[closes.length - 2];
        const emaNow = ema20[ema20.length - 1];
        const emaPrev = ema20[ema20.length - 2];
        if (trend === Trend.Bull && c1 < emaPrev && c0 > emaNow) {
            const entry = c0;
            const stop = Math.min(c1, lows[lows.length - 2]) - this.config.swingBackoffAtr * latestATR;
            return { side: "long", entry, stopLoss: stop };
        }
        if (trend === Trend.Bear && c1 > emaPrev && c0 < emaNow) {
            const entry = c0;
            const stop = Math.max(c1, highs[highs.length - 2]) + this.config.swingBackoffAtr * latestATR;
            return { side: "short", entry, stopLoss: stop };
        }
        // Pattern 3: breakout of recent range (last N bars)
        const lookback = 8;
        const recentHigh = Math.max(...highs.slice(-lookback));
        const recentLow = Math.min(...lows.slice(-lookback));
        if (trend === Trend.Bull && price > recentHigh) {
            const entry = price;
            const stop = recentLow - this.config.swingBackoffAtr * latestATR;
            return { side: "long", entry, stopLoss: stop };
        }
        if (trend === Trend.Bear && price < recentLow) {
            const entry = price;
            const stop = recentHigh + this.config.swingBackoffAtr * latestATR;
            return { side: "short", entry, stopLoss: stop };
        }
        // Pattern 4: mean-reversion in low ADX regime with confluence
        const adxLt = computeADX(highs, lows, closes, this.config.adxPeriod);
        const latestAdx = adxLt[adxLt.length - 1];
        const { score } = this.computeConfluence(ht, lt, trend);
        if (latestAdx < this.config.adxThreshold) {
            const zScore = (price - ema50[ema50.length - 1]) / (latestATR || 1e-8);
            if (zScore <= -1.2 && score >= 2) {
                const entry = price;
                const stop = price - this.config.atrEntryMultiplier * latestATR;
                return { side: "long", entry, stopLoss: stop };
            }
            if (zScore >= 1.2 && score >= 2) {
                const entry = price;
                const stop = price + this.config.atrEntryMultiplier * latestATR;
                return { side: "short", entry, stopLoss: stop };
            }
        }
        return null;
    }
    /**
     * Open a new position and switch to MANAGE state. Calculates position
     * size based on risk management settings.
     */
    enterPosition(side, entry, stopLoss) {
        const profileRisk = this.config.strategyProfile === "trend"
            ? 0.015
            : this.config.strategyProfile === "scalp"
                ? 0.005
                : this.config.strategyProfile === "intraday"
                    ? 0.008
                    : 0.01;
        const riskPct = Math.min(profileRisk, this.config.riskPerTrade);
        const slDistance = side === "long" ? entry - stopLoss : stopLoss - entry;
        const size = computePositionSize(this.config.accountBalance, riskPct, entry, stopLoss);
        const rrMap = {
            trend: 3,
            scalp: 1,
            swing: 2,
            intraday: 1.5,
        };
        const tp = side === "long" ? entry + rrMap[this.config.strategyProfile] * slDistance : entry - rrMap[this.config.strategyProfile] * slDistance;
        this.position = {
            entryPrice: entry,
            size: size,
            side: side,
            stopLoss: stopLoss,
            takeProfit: tp,
            initialTakeProfit: tp,
            trailingStop: stopLoss,
            highWaterMark: entry,
            lowWaterMark: entry,
            opened: Date.now(),
            partialTaken: false,
            slDistance,
            exitCount: 0,
        };
        this.state = State.Manage;
    }
    /**
     * Reset position and return to SCAN state.
     */
    exitPosition(exitPrice) {
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
    updateWaterMarks(price) {
        if (!this.position)
            return;
        if (this.position.side === "long") {
            this.position.highWaterMark = Math.max(this.position.highWaterMark, price);
        }
        else {
            this.position.lowWaterMark = Math.min(this.position.lowWaterMark, price);
        }
    }
    /**
     * Compute a swing‑structure stop. For longs it returns the last swing low
     * minus a buffer; for shorts the last swing high plus a buffer.
     */
    computeSwingStop(df, side) {
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
        }
        else {
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
    updateTrailingStop(df) {
        if (!this.position)
            return;
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
        }
        else {
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
    computeInstitutionalZones(df) {
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
        const weightedLevels = {};
        closes.forEach((c, i) => {
            const bucket = Math.round(c); // simple bucketing to nearest unit
            if (!weightedLevels[bucket])
                weightedLevels[bucket] = { sum: 0, vol: 0 };
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
        const swings = [];
        for (let i = 1; i < highs.length - 1; i++) {
            if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1])
                swings.push(highs[i]);
            if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1])
                swings.push(lows[i]);
        }
        const zones = [
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
        const dedup = [];
        zones.forEach((z) => {
            const existing = dedup.find((d) => Math.abs(d.price - z.price) < (z.price * 0.001));
            if (existing) {
                existing.weight = Math.max(existing.weight, z.weight);
            }
            else {
                dedup.push(z);
            }
        });
        return dedup.sort((a, b) => a.price - b.price);
    }
    /**
     * Update dynamic take‑profit based on trend strength and institutional zones.
     */
    updateTakeProfit(ht, lt) {
        if (!this.position)
            return;
        const currentPrice = lt[lt.length - 1].close;
        // Only adjust if price has moved beyond original TP
        if (this.position.side === "long" && currentPrice <= this.position.takeProfit)
            return;
        if (this.position.side === "short" && currentPrice >= this.position.takeProfit)
            return;
        // Determine trend on higher timeframe
        const trend = this.determineTrend(ht);
        if (trend === Trend.Neutral)
            return;
        const adxVal = computeADX(ht.map((c) => c.high), ht.map((c) => c.low), ht.map((c) => c.close), this.config.adxPeriod);
        const currentAdx = adxVal[adxVal.length - 1];
        if (currentAdx < this.config.adxThreshold)
            return;
        const zones = this.computeInstitutionalZones(ht);
        if (this.position.side === "long") {
            const higher = zones.filter((z) => z.price > this.position.takeProfit);
            if (higher.length > 0) {
                const best = higher.sort((a, b) => b.weight - a.weight || a.price - b.price)[0];
                this.position.takeProfit = best.price;
            }
            else {
                // No higher zone -> rely on trailing stop
                this.position.takeProfit = Infinity;
            }
        }
        else {
            const lower = zones.filter((z) => z.price < this.position.takeProfit);
            if (lower.length > 0) {
                const best = lower.sort((a, b) => b.weight - a.weight || b.price - a.price)[0];
                this.position.takeProfit = best.price;
            }
            else {
                this.position.takeProfit = -Infinity;
            }
        }
    }
    computeConfluence(ht, lt, trend) {
        const liquiditySweep = this.isLiquiditySweep(ht);
        const volExpansion = this.isVolatilityExpansion(lt);
        let score = 0;
        if (trend !== Trend.Neutral)
            score += 2;
        if (liquiditySweep)
            score += 2;
        if (volExpansion)
            score += 1;
        const adxArray = computeADX(lt.map((c) => c.high), lt.map((c) => c.low), lt.map((c) => c.close), this.config.adxPeriod);
        const adxNow = adxArray[adxArray.length - 1];
        if (adxNow >= this.config.aggressiveAdxThreshold)
            score += 1;
        return { score, liquiditySweep, volExpansion };
    }
    isLiquiditySweep(df) {
        if (df.length < this.config.liquiditySweepLookback + 2)
            return false;
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
    isVolatilityExpansion(df) {
        if (df.length < 20)
            return false;
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
    async managePosition() {
        if (!this.position)
            return;
        const ht = await this.fetchOHLCV(this.config.baseTimeframe);
        const lt = await this.fetchOHLCV(this.config.signalTimeframe);
        const currentPrice = lt[lt.length - 1].close;
        // Update water marks
        this.updateWaterMarks(currentPrice);
        // Update trailing stop and take profit
        this.updateTrailingStop(lt);
        this.updateTakeProfit(ht, lt);
        const atrArray = computeATR(lt.map((c) => c.high), lt.map((c) => c.low), lt.map((c) => c.close), this.config.atrPeriod);
        const atr = atrArray[atrArray.length - 1];
        const rMultiple = this.position.slDistance > 0 ? (this.position.side === "long"
            ? (currentPrice - this.position.entryPrice) / this.position.slDistance
            : (this.position.entryPrice - currentPrice) / this.position.slDistance) : 0;
        // Exit conditions
        if (this.position.side === "long") {
            if (currentPrice <= this.position.stopLoss || currentPrice <= this.position.trailingStop) {
                this.exitPosition(currentPrice);
                return;
            }
            if (currentPrice >= this.position.takeProfit || rMultiple >= this.config.partialTakeProfitR) {
                if (!this.position.partialTaken && this.position.exitCount < this.config.maxExitChunks - 1) {
                    this.position.size *= 1 - this.config.partialExitRatio;
                    this.position.partialTaken = true;
                    this.position.exitCount += 1;
                    // move SL to break even + small buffer
                    this.position.stopLoss = this.position.entryPrice + this.config.breakevenBufferAtr * atr;
                    this.position.takeProfit = Infinity;
                }
                else {
                    this.exitPosition(currentPrice);
                    return;
                }
            }
        }
        else {
            if (currentPrice >= this.position.stopLoss || currentPrice >= this.position.trailingStop) {
                this.exitPosition(currentPrice);
                return;
            }
            if (currentPrice <= this.position.takeProfit || rMultiple >= this.config.partialTakeProfitR) {
                if (!this.position.partialTaken && this.position.exitCount < this.config.maxExitChunks - 1) {
                    this.position.size *= 1 - this.config.partialExitRatio;
                    this.position.partialTaken = true;
                    this.position.exitCount += 1;
                    this.position.stopLoss = this.position.entryPrice - this.config.breakevenBufferAtr * atr;
                    this.position.takeProfit = -Infinity;
                }
                else {
                    this.exitPosition(currentPrice);
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
    async step() {
        if (this.state === State.Scan) {
            const signal = await this.scanForEntry();
            if (signal) {
                this.enterPosition(signal.side, signal.entry, signal.stopLoss);
            }
        }
        else if (this.state === State.Manage) {
            await this.managePosition();
        }
    }
    /**
     * Deterministická varianta – používá již připravené higher/low TF rámce.
     */
    stepWithFrames(ht, lt) {
        const now = lt[lt.length - 1]?.openTime ?? Date.now();
        this.resetDaily(now);
        if (!this.withinSession(now) || this.riskHalted()) {
            return;
        }
        if (this.state === State.Scan) {
            const signal = this.scanForEntryFromFrames(ht, lt);
            if (signal) {
                this.enterPosition(signal.side, signal.entry, signal.stopLoss);
            }
        }
        else if (this.state === State.Manage) {
            this.managePositionWithFrames(ht, lt);
        }
    }
    scanForEntryFromFrames(ht, lt) {
        if (this.cooldownUntil && new Date() < this.cooldownUntil)
            return null;
        let trend = this.determineTrend(ht);
        if (lt.length < 3)
            return null;
        const closes = lt.map((c) => c.close);
        const highs = lt.map((c) => c.high);
        const lows = lt.map((c) => c.low);
        const atrArray = computeATR(highs, lows, closes, this.config.atrPeriod);
        const latestATR = atrArray[atrArray.length - 1];
        const price = closes[closes.length - 1];
        const strictness = this.config.entryStrictness ??
            (this.config.strategyProfile === "intraday"
                ? "ultra"
                : this.config.strategyProfile === "scalp"
                    ? "relaxed"
                    : "base");
        const isTest = strictness === "test";
        if (trend === Trend.Neutral && isTest) {
            // fallback trend by short-term momentum
            const last = closes.slice(-3);
            const net = (last[last.length - 1] ?? 0) - (last[0] ?? 0);
            trend = net >= 0 ? Trend.Bull : Trend.Bear;
        }
        else if (trend === Trend.Neutral) {
            return null;
        }
        const minAtrThreshold = this.config.minAtrFractionOfPrice *
            (isTest ? 0 : strictness === "ultra" ? 0.25 : strictness === "relaxed" ? 0.5 : 1);
        if (!isTest && latestATR < price * minAtrThreshold)
            return null;
        const ema = (period) => {
            const out = [];
            const k = 2 / (period + 1);
            closes.forEach((p, i) => {
                if (i === 0)
                    out.push(p);
                else
                    out.push(out[i - 1] + k * (p - out[i - 1]));
            });
            return out;
        };
        const ema20 = ema(20);
        const ema50 = ema(50);
        const momentumLen = strictness === "base" ? 3 : 2;
        const lastN = closes.slice(-momentumLen);
        const diffs = lastN.slice(1).map((v, i) => v - lastN[i]);
        if (trend === Trend.Bull && diffs.every((d) => d > 0)) {
            const entry = lastN[lastN.length - 1];
            const stop = entry - this.config.atrEntryMultiplier * latestATR;
            return { side: "long", entry, stopLoss: stop };
        }
        if (trend === Trend.Bear && diffs.every((d) => d < 0)) {
            const entry = lastN[lastN.length - 1];
            const stop = entry + this.config.atrEntryMultiplier * latestATR;
            return { side: "short", entry, stopLoss: stop };
        }
        const c0 = closes[closes.length - 1];
        const c1 = closes[closes.length - 2];
        const emaNow = ema20[ema20.length - 1];
        const emaPrev = ema20[ema20.length - 2];
        if (trend === Trend.Bull && c1 < emaPrev && c0 > emaNow) {
            const entry = c0;
            const stop = Math.min(c1, lows[lows.length - 2]) - this.config.swingBackoffAtr * latestATR;
            return { side: "long", entry, stopLoss: stop };
        }
        if (trend === Trend.Bear && c1 > emaPrev && c0 < emaNow) {
            const entry = c0;
            const stop = Math.max(c1, highs[highs.length - 2]) + this.config.swingBackoffAtr * latestATR;
            return { side: "short", entry, stopLoss: stop };
        }
        const lookback = strictness === "ultra" ? 5 : strictness === "relaxed" ? 8 : strictness === "test" ? 3 : 12;
        const recentHigh = Math.max(...highs.slice(-lookback));
        const recentLow = Math.min(...lows.slice(-lookback));
        if (trend === Trend.Bull && price > recentHigh) {
            const entry = price;
            const stop = recentLow - this.config.swingBackoffAtr * latestATR;
            return { side: "long", entry, stopLoss: stop };
        }
        if (trend === Trend.Bear && price < recentLow) {
            const entry = price;
            const stop = recentHigh + this.config.swingBackoffAtr * latestATR;
            return { side: "short", entry, stopLoss: stop };
        }
        const adxLt = computeADX(highs, lows, closes, this.config.adxPeriod);
        const latestAdx = adxLt[adxLt.length - 1];
        const zCut = strictness === "ultra" ? 0.8 : strictness === "relaxed" ? 1.0 : strictness === "test" ? 0.5 : 1.5;
        const adxLimit = strictness === "ultra"
            ? this.config.adxThreshold * 1.3
            : strictness === "test"
                ? this.config.adxThreshold * 2
                : this.config.adxThreshold;
        if (isTest || latestAdx < adxLimit) {
            const zScore = (price - ema50[ema50.length - 1]) / (latestATR || 1e-8);
            if (zScore <= -zCut) {
                const entry = price;
                const stop = price - this.config.atrEntryMultiplier * latestATR;
                return { side: "long", entry, stopLoss: stop };
            }
            if (zScore >= zCut) {
                const entry = price;
                const stop = price + this.config.atrEntryMultiplier * latestATR;
                return { side: "short", entry, stopLoss: stop };
            }
        }
        if (strictness === "ultra" || isTest) {
            const emaBias = trend === Trend.Bull ? price > ema20[ema20.length - 1] : price < ema20[ema20.length - 1];
            if (emaBias) {
                const entry = price;
                const stop = trend === Trend.Bull
                    ? price - this.config.atrEntryMultiplier * latestATR
                    : price + this.config.atrEntryMultiplier * latestATR;
                return { side: trend === Trend.Bull ? "long" : "short", entry, stopLoss: stop };
            }
        }
        if (isTest) {
            // Final permissive trigger: allow either momentum or EMA bias alone
            const last = closes.slice(-2);
            const dir = (last[last.length - 1] ?? 0) - (last[0] ?? 0) >= 0 ? "long" : "short";
            const entry = price;
            const stop = dir === "long"
                ? price - this.config.atrEntryMultiplier * latestATR
                : price + this.config.atrEntryMultiplier * latestATR;
            return { side: dir, entry, stopLoss: stop };
        }
        return null;
    }
    managePositionWithFrames(ht, lt) {
        if (!this.position)
            return;
        const currentPrice = lt[lt.length - 1].close;
        this.updateWaterMarks(currentPrice);
        this.updateTrailingStop(lt);
        this.updateTakeProfit(ht, lt);
        const atrArray = computeATR(lt.map((c) => c.high), lt.map((c) => c.low), lt.map((c) => c.close), this.config.atrPeriod);
        const atr = atrArray[atrArray.length - 1];
        const rMultiple = this.position.slDistance > 0
            ? (this.position.side === "long"
                ? (currentPrice - this.position.entryPrice) / this.position.slDistance
                : (this.position.entryPrice - currentPrice) / this.position.slDistance)
            : 0;
        if (this.position.side === "long") {
            if (currentPrice <= this.position.stopLoss || currentPrice <= this.position.trailingStop) {
                this.exitPosition(currentPrice);
                return;
            }
            if (currentPrice >= this.position.takeProfit || rMultiple >= this.config.partialTakeProfitR) {
                if (!this.position.partialTaken && this.position.exitCount < this.config.maxExitChunks - 1) {
                    this.position.size *= 1 - this.config.partialExitRatio;
                    this.position.partialTaken = true;
                    this.position.exitCount += 1;
                    this.position.stopLoss = this.position.entryPrice + this.config.breakevenBufferAtr * atr;
                    this.position.takeProfit = Infinity;
                }
                else {
                    this.exitPosition(currentPrice);
                    return;
                }
            }
        }
        else {
            if (currentPrice >= this.position.stopLoss || currentPrice >= this.position.trailingStop) {
                this.exitPosition(currentPrice);
                return;
            }
            if (currentPrice <= this.position.takeProfit || rMultiple >= this.config.partialTakeProfitR) {
                if (!this.position.partialTaken && this.position.exitCount < this.config.maxExitChunks - 1) {
                    this.position.size *= 1 - this.config.partialExitRatio;
                    this.position.partialTaken = true;
                    this.position.exitCount += 1;
                    this.position.stopLoss = this.position.entryPrice - this.config.breakevenBufferAtr * atr;
                    this.position.takeProfit = -Infinity;
                }
                else {
                    this.exitPosition(currentPrice);
                    return;
                }
            }
        }
    }
    getState() {
        return this.state;
    }
    getConfig() {
        return this.config;
    }
    getPosition() {
        return this.position;
    }
    isHalted() {
        return this.riskHalted();
    }
    getDrawdown() {
        return this.currentDrawdown;
    }
}
/**
 * Resample lower timeframe candles (e.g. 1m) to target resolution in minutes.
 */
export function resampleCandles(candles, targetMinutes) {
    if (!candles.length)
        return [];
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const result = [];
    const ms = targetMinutes * 60 * 1000;
    let bucketStart = Math.floor(sorted[0].openTime / ms) * ms;
    let bucket = [];
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
function timeframeToMinutes(tf) {
    const num = parseInt(tf, 10);
    if (tf.endsWith("h"))
        return num * 60;
    if (tf.endsWith("d"))
        return num * 60 * 24;
    return num; // assume minutes
}
const botRegistry = {};
function ensureBot(symbol, config) {
    if (!botRegistry[symbol]) {
        botRegistry[symbol] = new TradingBot({ symbol, ...config });
    }
    return botRegistry[symbol];
}
/**
 * Hlavní vstup pro UI / feed: z nižšího TF (např. 1m) resampluje na
 * baseTimeframe/signalTimeframe, spustí stavový automat a vrátí signál.
 */
export function evaluateStrategyForSymbol(symbol, candles, config = {}) {
    const bot = ensureBot(symbol, config);
    const botConfig = bot.getConfig();
    const tfBaseMin = timeframeToMinutes(botConfig.baseTimeframe);
    const tfSigMin = timeframeToMinutes(botConfig.signalTimeframe);
    const ht = resampleCandles(candles, tfBaseMin);
    const lt = resampleCandles(candles, tfSigMin);
    if (!ht.length || !lt.length) {
        return { state: bot.getState(), trend: Trend.Neutral, halted: true };
    }
    const prevState = bot.getState();
    const prevOpened = bot.getPosition()?.opened;
    bot.stepWithFrames(ht, lt);
    const trend = bot.determineTrend(ht);
    let signal = null;
    const position = bot.getPosition();
    if (prevState === State.Scan &&
        bot.getState() === State.Manage &&
        position &&
        position.opened !== prevOpened) {
        const slDistance = position.side === "long"
            ? position.entryPrice - position.stopLoss
            : position.stopLoss - position.entryPrice;
        signal = {
            id: `${symbol}-${Date.now()}`,
            symbol,
            intent: {
                side: position.side === "long" ? "buy" : "sell",
                entry: position.entryPrice,
                sl: position.stopLoss,
                tp: position.initialTakeProfit,
            },
            risk: 0.7,
            message: `Entered ${position.side} with SL ${position.stopLoss.toFixed(2)} | TP ${position.initialTakeProfit.toFixed(2)}`,
            createdAt: new Date().toISOString(),
        };
    }
    return {
        state: bot.getState(),
        trend,
        signal,
        position,
        halted: bot.isHalted(),
    };
}
