// src/engine/botEngine.ts

import type { TradeIntent, PendingSignal } from "../types";

// ===== ZÁKLADNÍ TYPY =====

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
  const tol = Math.abs(ema50) * 0.001; // 0.1 %
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

// ===== HLAVNÍ STRATEGIE =====
//
// Cíl: víc signálů, ale pořád rozumný filtr.
// - Trend podle EMA21 vs EMA50
// - Vstup po pullbacku k EMA21 (s tolerancí)
// - ATR > malá minimální hodnota (ne příliš mrtvý trh)
// - Risk score ~ kombinace: trend, pullback, velikost těla, ATR

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

  // základní ATR práh – dost nízký, aby chodilo víc signálů
  const minAtr = last.close * 0.001; // 0.1 %
  const atrOk = atr > minAtr;

  // vzdálenost od EMA21 v % – čím blíž, tím lepší pullback
  const distFromEma21 = Math.abs(last.close - ema21);
  const distPct = ema21 !== 0 ? distFromEma21 / ema21 : 0;

  // tolerance pullbacku zvětšená, aby bylo víc signálů
  const pullbackOk = distPct < 0.008; // 0.8 %

  const lastBody = bodySize(last);
  const avgBody =
    candles.length > 10
      ? candles
          .slice(-10)
          .reduce((s, c) => s + bodySize(c), 0) / Math.min(10, candles.length)
      : lastBody;

  const bodyBoost = avgBody > 0 ? Math.min(lastBody / avgBody, 2) : 1;

  // ===== Long / Short kandidáti =====
  let intent: TradeIntent | null = null;
  let baseRiskScore = 0;

  if (trend === "up" && atrOk && pullbackOk && isBull(last)) {
    // LONG
    const entry = last.close;
    const sl = Math.min(last.low, ema50 - atr * 0.3);
    const tp = entry + (entry - sl) * 2.0; // RRR ~2:1

    baseRiskScore =
      0.4 + // trend
      0.25 * (1 - distPct / 0.008) + // kvalita pullbacku
      0.2 * Math.min(atr / (minAtr * 2), 1) + // volatilita
      0.15 * Math.min(bodyBoost / 1.5, 1); // momentum svíčky

    intent = {
      side: "buy",
      entry,
      sl,
      tp,
    } as TradeIntent;
  } else if (trend === "down" && atrOk && pullbackOk && isBear(last)) {
    // SHORT
    const entry = last.close;
    const sl = Math.max(last.high, ema50 + atr * 0.3);
    const tp = entry - (sl - entry) * 2.0;

    baseRiskScore =
      0.4 +
      0.25 * (1 - distPct / 0.008) +
      0.2 * Math.min(atr / (minAtr * 2), 1) +
      0.15 * Math.min(bodyBoost / 1.5, 1);

    intent = {
      side: "sell",
      entry,
      sl,
      tp,
    } as TradeIntent;
  }

  // lehké “rozvolnění” – posuneme dolní hranici na 0.55,
  // ale typicky bude signál kolem 0.60–0.85.
  const riskScore = Math.max(0, Math.min(baseRiskScore, 0.95));

  let signal: PendingSignal | null = null;

  if (intent && riskScore >= 0.55) {
    const rr =
      intent.side === "buy"
        ? Math.abs(intent.tp - intent.entry) /
          Math.abs(intent.entry - intent.sl || intent.entry - intent.tp)
        : Math.abs(intent.entry - intent.tp) /
          Math.abs(intent.sl - intent.entry || intent.entry - intent.tp);

    const msgParts: string[] = [];
    msgParts.push(
      `${trend.toUpperCase()} trend (+) EMA21/EMA50 stack | recent pullback to EMA21`
    );
    msgParts.push(`ATR=${atr.toFixed(4)}, distEMA21=${(distPct * 100).toFixed(2)}%`);
    msgParts.push(`RRR≈${rr.toFixed(2)}`);

    const now = new Date().toISOString();

signal = {
  id: `${symbol}-${Date.now()}`,
  symbol,
  intent,
  risk: riskScore,
  message: msgParts.join(" | "),
  createdAt: now,        // nyní string
} as PendingSignal;
  }

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
      distPct,
      bodyBoost, 
      atrOk,
      pullbackOk,
      lastClose: last.close,
    },
  };
}