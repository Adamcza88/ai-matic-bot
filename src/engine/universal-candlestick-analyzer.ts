// universal-candlestick-analyzer.ts (s liquidity pools a prioritou POI)

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface PointOfInterest {
  type: 'OB' | 'FVG' | 'Breaker' | 'Liquidity';
  direction: 'bullish' | 'bearish';
  high: number;
  low: number;
  time: number;
  mitigated: boolean;
  mitigatedAt?: number;
  priority: number; // 3 pro Breaker, 2 pro OB, 1 pro FVG, 0 pro Liquidity
  touches?: number; // pocet dotyku pro Liquidity
}

interface MarketStructure {
  trend: 'up' | 'down' | 'range';
  lastHH: number | null;
  lastLL: number | null;
  lastLH: number | null;
  lastHL: number | null;
}

export class CandlestickAnalyzer {
  private candles: Candle[] = [];

  constructor(candles: Candle[]) {
    this.candles = candles.sort((a, b) => a.time - b.time);
  }

  private detectFVG(index: number): PointOfInterest | null {
    if (index < 2) return null;
    const prev2 = this.candles[index - 2];
    const prev1 = this.candles[index - 1];
    const current = this.candles[index];

    if (prev2.high < prev1.low && prev1.low > current.high) {
      return {
        type: 'FVG',
        direction: 'bullish',
        high: prev1.low,
        low: prev2.high,
        time: prev1.time,
        mitigated: false,
        priority: 1
      };
    }

    if (prev2.low > prev1.high && prev1.high < current.low) {
      return {
        type: 'FVG',
        direction: 'bearish',
        high: prev2.low,
        low: prev1.high,
        time: prev1.time,
        mitigated: false,
        priority: 1
      };
    }

    return null;
  }

  private detectOrderBlock(index: number, impulseStrength: number = 1.5): PointOfInterest | null {
    if (index < 2) return null;
    const prev = this.candles[index - 1];
    const current = this.candles[index];

    const bodyPrev = Math.abs(prev.close - prev.open);
    const bodyCurr = Math.abs(current.close - current.open);
    const rangePrev = prev.high - prev.low;
    const rangeCurr = current.high - current.low;

    if (current.close > current.open &&
        bodyCurr > impulseStrength * bodyPrev &&
        rangeCurr > impulseStrength * rangePrev &&
        prev.close < prev.open) {
      return {
        type: 'OB',
        direction: 'bullish',
        high: Math.max(prev.open, prev.close),
        low: Math.min(prev.open, prev.close),
        time: prev.time,
        mitigated: false,
        priority: 2
      };
    }

    if (current.close < current.open &&
        bodyCurr > impulseStrength * bodyPrev &&
        rangeCurr > impulseStrength * rangePrev &&
        prev.close > prev.open) {
      return {
        type: 'OB',
        direction: 'bearish',
        high: Math.max(prev.open, prev.close),
        low: Math.min(prev.open, prev.close),
        time: prev.time,
        mitigated: false,
        priority: 2
      };
    }

    return null;
  }

  private detectBreakerFromOB(ob: PointOfInterest, index: number): PointOfInterest | null {
    if (ob.type !== 'OB' || ob.mitigated) return null;

    const candle = this.candles[index];

    const inZone = candle.low <= ob.high && candle.high >= ob.low;

    if (!inZone) return null;

    if (ob.direction === 'bearish' && candle.close > ob.high) {
      return {
        type: 'Breaker',
        direction: 'bullish',
        high: ob.high,
        low: ob.low,
        time: candle.time,
        mitigated: false,
        mitigatedAt: index,
        priority: 3
      };
    }

    if (ob.direction === 'bullish' && candle.close < ob.low) {
      return {
        type: 'Breaker',
        direction: 'bearish',
        high: ob.high,
        low: ob.low,
        time: candle.time,
        mitigated: false,
        mitigatedAt: index,
        priority: 3
      };
    }

    return null;
  }

  private collectSwingPoints(window: number = 7): { highs: number[]; lows: number[] } {
    const highs: number[] = [];
    const lows: number[] = [];

    for (let i = window; i < this.candles.length - window; i++) {
      const isHigh = this.candles.slice(i - window, i + window + 1)
        .every((c, idx) => idx === window || c.high <= this.candles[i].high);

      const isLow = this.candles.slice(i - window, i + window + 1)
        .every((c, idx) => idx === window || c.low >= this.candles[i].low);

      if (isHigh) highs.push(this.candles[i].high);
      if (isLow) lows.push(this.candles[i].low);
    }

    return { highs, lows };
  }

  // Nova detekce Liquidity Pool (equal highs/lows s toleranci a min touches)
  private detectLiquidityPool(
    swingPoints: { highs: number[]; lows: number[] },
    tolerance: number = 0.002,
    minTouches: number = 3
  ): PointOfInterest[] {
    const pools: PointOfInterest[] = [];
    const lastTime = this.candles[this.candles.length - 1]?.time ?? Date.now();

    const highLevels = this.groupLevels(swingPoints.highs, tolerance);
    for (const [level, count] of Object.entries(highLevels)) {
      if (count >= minTouches) {
        const price = parseFloat(level);
        const band = price * tolerance;
        pools.push({
          type: 'Liquidity',
          direction: 'bearish',
          high: price + band,
          low: price - band,
          time: lastTime,
          mitigated: false,
          priority: 0,
          touches: count
        });
      }
    }

    const lowLevels = this.groupLevels(swingPoints.lows, tolerance);
    for (const [level, count] of Object.entries(lowLevels)) {
      if (count >= minTouches) {
        const price = parseFloat(level);
        const band = price * tolerance;
        pools.push({
          type: 'Liquidity',
          direction: 'bullish',
          high: price + band,
          low: price - band,
          time: lastTime,
          mitigated: false,
          priority: 0,
          touches: count
        });
      }
    }

    return pools;
  }

  private groupLevels(levels: number[], tolerance: number): { [key: string]: number } {
    if (!levels.length) return {};
    const sorted = [...levels].sort((a, b) => a - b);
    const groups: { [key: string]: number } = {};
    let currentGroup = sorted[0];
    groups[currentGroup] = 1;

    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i] - currentGroup) <= tolerance * currentGroup) {
        groups[currentGroup] = (groups[currentGroup] || 1) + 1;
      } else {
        currentGroup = sorted[i];
        groups[currentGroup] = 1;
      }
    }

    return groups;
  }

  getPointsOfInterest(): PointOfInterest[] {
    const pois: PointOfInterest[] = [];
    const activeOBs: PointOfInterest[] = [];

    const swingPoints = this.collectSwingPoints();
    const liquidityPools = this.detectLiquidityPool(swingPoints);
    pois.push(...liquidityPools);

    for (let i = 1; i < this.candles.length; i++) {
      const fvg = this.detectFVG(i);
      if (fvg) pois.push(fvg);

      const ob = this.detectOrderBlock(i);
      if (ob) {
        activeOBs.push(ob);
        pois.push(ob);
      }

      for (let j = activeOBs.length - 1; j >= 0; j--) {
        const existingOB = activeOBs[j];
        const breaker = this.detectBreakerFromOB(existingOB, i);

        if (breaker) {
          pois.push(breaker);
          existingOB.mitigated = true;
          existingOB.mitigatedAt = i;
          activeOBs.splice(j, 1);
        }
      }
    }

    return pois.sort((a, b) => b.priority - a.priority);
  }

  getMarketStructure(window: number = 7): MarketStructure {
    let lastHH: number | null = null;
    let lastLL: number | null = null;
    let lastLH: number | null = null;
    let lastHL: number | null = null;

    for (let i = window; i < this.candles.length - window; i++) {
      const isHigh = this.candles.slice(i - window, i + window + 1)
        .every((c, idx) => idx === window || c.high <= this.candles[i].high);

      const isLow = this.candles.slice(i - window, i + window + 1)
        .every((c, idx) => idx === window || c.low >= this.candles[i].low);

      if (isHigh) {
        if (lastHH === null || this.candles[i].high > lastHH) {
          lastHH = this.candles[i].high;
          lastLH = lastHH;
        } else {
          lastLH = this.candles[i].high;
        }
      }

      if (isLow) {
        if (lastLL === null || this.candles[i].low < lastLL) {
          lastLL = this.candles[i].low;
          lastHL = lastLL;
        } else {
          lastHL = this.candles[i].low;
        }
      }
    }

    let trend: 'up' | 'down' | 'range' = 'range';
    if (lastHH && lastLL && lastLH && lastHL) {
      if (lastHH > lastLH && lastLL < lastHL) trend = 'up';
      else if (lastHH < lastLH && lastLL > lastHL) trend = 'down';
    }

    return { trend, lastHH, lastLL, lastLH, lastHL };
  }

  updateMitigation(pois: PointOfInterest[]): PointOfInterest[] {
    return pois.map(poi => {
      const touched = this.candles.some(c =>
        c.low <= poi.high && c.high >= poi.low
      );
      return { ...poi, mitigated: poi.mitigated || touched };
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CandlestickAnalyzer };
}
