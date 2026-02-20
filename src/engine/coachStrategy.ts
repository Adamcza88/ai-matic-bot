export type Candle = {
  openTime?: number;
  open?: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type DailyBar = {
  openTime: number;
  high: number;
  low: number;
};

export type Signal = {
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  message: string;
};

type CoachBreakoutParams = {
  baseWindow: number;
  volumeMultiplier: number;
  breakoutBufferPct: number;
  tpRiskMultiple: number;
  minTpPct: number;
};

type EdgeCandidate = {
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  message: string;
  anchorTime: number;
};

const DEFAULT_PARAMS: CoachBreakoutParams = {
  baseWindow: 10,
  volumeMultiplier: 1.5,
  breakoutBufferPct: 0.0015,
  tpRiskMultiple: 2.2,
  minTpPct: 0.003,
};

const DAY_MONDAY = 1;
const DAY_WEDNESDAY = 3;
const DAY_THURSDAY = 4;
const DAY_FRIDAY = 5;

function mean(values: number[]): number {
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeEma(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (i === 0) out.push(v);
    else out.push(v * k + out[i - 1] * (1 - k));
  }
  return out;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function areValidBreakoutParams(config: CoachBreakoutParams): boolean {
  if (!Number.isInteger(config.baseWindow) || config.baseWindow < 1) return false;
  if (!isFiniteNumber(config.volumeMultiplier) || config.volumeMultiplier <= 0) return false;
  if (!isFiniteNumber(config.breakoutBufferPct) || config.breakoutBufferPct < 0) return false;
  if (!isFiniteNumber(config.tpRiskMultiple) || config.tpRiskMultiple <= 0) return false;
  if (!isFiniteNumber(config.minTpPct) || config.minTpPct < 0) return false;
  return true;
}

function isSortedByOpenTimeOptional(candles: Candle[]): boolean {
  const hasAnyTime = candles.some((c) => c.openTime !== undefined);
  if (!hasAnyTime) return true;
  for (let i = 0; i < candles.length; i += 1) {
    const time = candles[i].openTime;
    if (!isFiniteNumber(time)) return false;
    if (i > 0 && time < (candles[i - 1].openTime as number)) return false;
  }
  return true;
}

function isSortedByOpenTimeStrict(daily: DailyBar[]): boolean {
  for (let i = 0; i < daily.length; i += 1) {
    if (!isFiniteNumber(daily[i].openTime)) return false;
    if (i > 0 && daily[i].openTime < daily[i - 1].openTime) return false;
  }
  return true;
}

function isValidCandle(candle: Candle): boolean {
  if (
    !isFiniteNumber(candle.high) ||
    !isFiniteNumber(candle.low) ||
    !isFiniteNumber(candle.close) ||
    !isFiniteNumber(candle.volume)
  ) {
    return false;
  }
  if (candle.high < candle.low) return false;
  if (candle.close <= 0 || candle.high <= 0 || candle.low <= 0) return false;
  return true;
}

function isValidDailyBar(bar: DailyBar): boolean {
  if (
    !isFiniteNumber(bar.openTime) ||
    !isFiniteNumber(bar.high) ||
    !isFiniteNumber(bar.low)
  ) {
    return false;
  }
  if (bar.high < bar.low) return false;
  if (bar.high <= 0 || bar.low <= 0) return false;
  return true;
}

function weekdayUtc(timestamp: number): number {
  return new Date(timestamp).getUTCDay();
}

function buildEdgeCandidate(args: {
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  message: string;
  anchorTime: number;
}): EdgeCandidate | null {
  const { side, entry, sl, tp, message, anchorTime } = args;
  if (!isFiniteNumber(entry) || !isFiniteNumber(sl) || !isFiniteNumber(tp)) {
    return null;
  }
  if (side === "BUY" && !(sl < entry && tp > entry)) return null;
  if (side === "SELL" && !(sl > entry && tp < entry)) return null;
  return { side, entry, sl, tp, message, anchorTime };
}

function candidateScore(candidate: EdgeCandidate): number {
  const reward = Math.abs(candidate.tp - candidate.entry);
  const risk = Math.abs(candidate.entry - candidate.sl);
  if (!Number.isFinite(reward) || !Number.isFinite(risk) || risk <= 0) {
    return 0;
  }
  return reward / risk;
}

function toSignal(candidate: EdgeCandidate): Signal {
  return {
    side: candidate.side,
    entry: candidate.entry,
    sl: candidate.sl,
    tp: candidate.tp,
    message: candidate.message,
  };
}

function detectThuFriEdge(
  daily: DailyBar[],
  currentPrice: number
): EdgeCandidate | "CONFLICT" | null {
  let fridayIndex = -1;
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (weekdayUtc(daily[i].openTime) === DAY_FRIDAY) {
      fridayIndex = i;
      break;
    }
  }
  if (fridayIndex <= 0) return null;
  const friday = daily[fridayIndex];
  const thursday = daily[fridayIndex - 1];
  if (weekdayUtc(thursday.openTime) !== DAY_THURSDAY) return null;

  let sellCandidate: EdgeCandidate | null = null;
  if (friday.high < thursday.high && currentPrice > friday.low) {
    sellCandidate = buildEdgeCandidate({
      side: "SELL",
      entry: currentPrice,
      tp: friday.low,
      sl: Math.max(friday.high, thursday.high),
      message: "Friday High < Thursday High -> target Friday Low on Monday",
      anchorTime: friday.openTime,
    });
  }

  let buyCandidate: EdgeCandidate | null = null;
  if (friday.low > thursday.low && currentPrice < friday.high) {
    buyCandidate = buildEdgeCandidate({
      side: "BUY",
      entry: currentPrice,
      tp: friday.high,
      sl: Math.min(friday.low, thursday.low),
      message: "Friday Low > Thursday Low -> target Friday High on Monday",
      anchorTime: friday.openTime,
    });
  }

  if (sellCandidate && buyCandidate) return "CONFLICT";
  return sellCandidate ?? buyCandidate;
}

function detectMonWedEdge(
  daily: DailyBar[],
  currentPrice: number
): EdgeCandidate | "CONFLICT" | null {
  let wednesdayIndex = -1;
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    if (weekdayUtc(daily[i].openTime) === DAY_WEDNESDAY) {
      wednesdayIndex = i;
      break;
    }
  }
  if (wednesdayIndex < 0) return null;
  const searchStart = Math.max(0, wednesdayIndex - 7);
  let mondayIndex = -1;
  for (let i = wednesdayIndex - 1; i >= searchStart; i -= 1) {
    if (weekdayUtc(daily[i].openTime) === DAY_MONDAY) {
      mondayIndex = i;
      break;
    }
  }
  if (mondayIndex < 0) return null;

  const wednesday = daily[wednesdayIndex];
  const monday = daily[mondayIndex];

  let sellCandidate: EdgeCandidate | null = null;
  if (wednesday.high < monday.high && currentPrice > wednesday.low) {
    sellCandidate = buildEdgeCandidate({
      side: "SELL",
      entry: currentPrice,
      tp: wednesday.low,
      sl: Math.max(wednesday.high, monday.high),
      message: "Wednesday High < Monday High -> target Wednesday Low on Thursday",
      anchorTime: wednesday.openTime,
    });
  }

  let buyCandidate: EdgeCandidate | null = null;
  if (wednesday.low > monday.low && currentPrice < wednesday.high) {
    buyCandidate = buildEdgeCandidate({
      side: "BUY",
      entry: currentPrice,
      tp: wednesday.high,
      sl: Math.min(wednesday.low, monday.low),
      message: "Wednesday Low > Monday Low -> target Wednesday High on Thursday",
      anchorTime: wednesday.openTime,
    });
  }

  if (sellCandidate && buyCandidate) return "CONFLICT";
  return sellCandidate ?? buyCandidate;
}

export function detectCoachBreakout(
  candles: Candle[],
  params?: Partial<CoachBreakoutParams>
): Signal | null {
  if (!Array.isArray(candles)) return null;
  const config: CoachBreakoutParams = {
    ...DEFAULT_PARAMS,
    ...(params ?? {}),
  };
  if (!areValidBreakoutParams(config)) return null;
  const minRequired = Math.max(30, config.baseWindow + 5);
  if (candles.length < minRequired) return null;
  if (!isSortedByOpenTimeOptional(candles)) return null;
  if (!candles.every(isValidCandle)) return null;

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ema10Series = computeEma(closes, 10);
  const ema20Series = computeEma(closes, 20);
  const lastIndex = candles.length - 1;
  const last = candles[lastIndex];
  const lastClose = last.close;
  const avgVol = mean(volumes.slice(-20));
  const strongVolume = last.volume >= config.volumeMultiplier * avgVol;

  const baseCandles = candles.slice(lastIndex - config.baseWindow, lastIndex);
  if (baseCandles.length !== config.baseWindow) return null;
  const priorHigh = Math.max(...baseCandles.map((c) => c.high));
  const baseLow = Math.min(...baseCandles.map((c) => c.low));

  const ema10 = ema10Series[lastIndex];
  const ema20 = ema20Series[lastIndex];
  if (!isFiniteNumber(ema10) || !isFiniteNumber(ema20) || !isFiniteNumber(avgVol)) {
    return null;
  }

  const buyOk =
    lastClose > priorHigh * (1 + config.breakoutBufferPct) &&
    lastClose > ema10 &&
    lastClose > ema20 &&
    ema10 > ema20 &&
    strongVolume;

  if (buyOk) {
    const entry = lastClose;
    const sl = baseLow;
    const risk = entry - sl;
    if (!(risk > 0)) return null;
    const tp = entry + Math.max(risk * config.tpRiskMultiple, entry * config.minTpPct);
    if (!(tp > entry)) return null;
    return {
      side: "BUY",
      entry,
      sl,
      tp,
      message: "Breakout above base high + EMA alignment + volume confirmation",
    };
  }

  const sellOk =
    lastClose < baseLow * (1 - config.breakoutBufferPct) &&
    lastClose < ema10 &&
    lastClose < ema20 &&
    ema10 < ema20 &&
    strongVolume;

  if (sellOk) {
    const entry = lastClose;
    const sl = priorHigh;
    const risk = sl - entry;
    if (!(risk > 0)) return null;
    const tp = entry - Math.max(risk * config.tpRiskMultiple, entry * config.minTpPct);
    if (!(tp < entry)) return null;
    return {
      side: "SELL",
      entry,
      sl,
      tp,
      message: "Breakdown below base low + EMA alignment + volume confirmation",
    };
  }

  return null;
}

export function detectSituationalEdges(
  daily: DailyBar[],
  currentPrice: number
): Signal | null {
  if (!Array.isArray(daily)) return null;
  if (daily.length < 2) return null;
  if (!isFiniteNumber(currentPrice) || currentPrice <= 0) return null;
  if (!isSortedByOpenTimeStrict(daily)) return null;
  if (!daily.every(isValidDailyBar)) return null;

  const thuFri = detectThuFriEdge(daily, currentPrice);
  const monWed = detectMonWedEdge(daily, currentPrice);
  if (thuFri === "CONFLICT" || monWed === "CONFLICT") return null;

  if (!thuFri && !monWed) return null;
  if (thuFri && monWed) {
    if (thuFri.side !== monWed.side) return null;
    const scoreThuFri = candidateScore(thuFri);
    const scoreMonWed = candidateScore(monWed);
    if (Math.abs(scoreThuFri - scoreMonWed) >= 0.05) {
      return toSignal(scoreThuFri > scoreMonWed ? thuFri : monWed);
    }
    if (thuFri.anchorTime !== monWed.anchorTime) {
      return toSignal(thuFri.anchorTime > monWed.anchorTime ? thuFri : monWed);
    }
    const riskThuFri = Math.abs(thuFri.entry - thuFri.sl);
    const riskMonWed = Math.abs(monWed.entry - monWed.sl);
    return toSignal(riskThuFri <= riskMonWed ? thuFri : monWed);
  }

  return toSignal(thuFri ?? monWed!);
}
