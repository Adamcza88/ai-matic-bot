// src/engine/botEngine.ts

import type { TradeIntent, PendingSignal } from "../types";

// ===== ZÁKLADNÍ TYPY ===

export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Trend = "up" | "down" | "sideways";

export type EngineDecision = {
  symbol: string;
  timeframe: string;
  trend: Trend;
  atr: number;
  ema8: number;
  ema21: number;
  ema50: number;
  signal: PendingSignal | null;
  debug?: Record<string, any>;
};

// ===== POMOCNÉ FUNKCE =====

function ema(values: number[], length: number): number {
  if (values.length === 0) return NaN;
  const k = 2 / (length + 1);
  let emaVal = values[0];
  for (let i = 1; i < values.length; i++) {
    emaVal = values[i] * k + emaVal * (1 - k);
  }
  return emaVal;
}

function calcATR(candles: Candle[], length = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const highLow = cur.high - cur.low;
    const highClose = Math.abs(cur.high - prev.close);
    const lowClose = Math.abs(cur.low - prev.close);
    trs.push(Math.max(highLow, highClose, lowClose));
  }
  if (!trs.length) return 0;
  const take = trs.slice(-length);
  const sum = take.reduce((a, b) => a + b, 0);
  return sum / take.length;
}

function detectTrend(ema21: number, ema50: number): Trend {
  const diff = ema21 - ema50;
  const tol = Math.abs(ema50) * 0.001;
  if (diff > tol) return "up";
  if (diff < -tol) return "down";
  return "sideways";
}

function bodySize(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function isBull(c: Candle) {
  return c.close > c.open;
}

function isBear(c: Candle) {
  return c.close < c.open;
}

// ===== HLAVNÍ ENGINE – S TESTOVACÍM REŽIMEM =====

export function evaluateStrategyForSymbol(
  symbol: string,
  candles: Candle[]
): EngineDecision {
  const tf = "1m";

  if (!candles.length) {
    return {
      symbol,
      timeframe: tf,
      trend: "sideways",
      atr: 0,
      ema8: NaN,
      ema21: NaN,
      ema50: NaN,
      signal: null,
    };
  }

  const closes = candles.map((c) => c.close);
  const ema8 = ema(closes, 8);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const atr = calcATR(candles, 14);
  const last = candles[candles.length - 1];

  const trend = detectTrend(ema21, ema50);

  // ===== STANDARDNÍ VÝPOČET ZŮSTÁVÁ, ALE BUDE IGNOROVÁN =====

  let signal: PendingSignal | null = null;

  // ===== TESTOVACÍ REŽIM – VŽDY GENERUJ SIGNÁL =====

  const entry = last.close;
  const sl = entry * 0.995;
  const tp = entry * 1.01;

  const intentTest: TradeIntent = {
    side: isBull(last) ? "buy" : "sell",
    entry,
    sl,
    tp,
  };

  signal = {
    id: `${symbol}-TEST-${Date.now()}`,
    symbol,
    intent: intentTest,
    risk: 0.90,
    message: "TEST MODE: forced signal",
    createdAt: new Date().toISOString(),
  };

  return {
    symbol,
    timeframe: tf,
    trend,
    atr,
    ema8,
    ema21,
    ema50,
    signal,
    debug: {
      forcedTestMode: true,
      lastClose: last.close,
      ema21,
      ema50,
      atr,
    },
  };
}
