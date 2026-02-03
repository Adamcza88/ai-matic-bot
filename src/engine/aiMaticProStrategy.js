import { computeATR } from "./botEngine";
import { computeRsi } from "./ta";
import { computeMarketProfile } from "./marketProfile";
import { getOrderFlowSnapshot } from "./orderflow";
import { analyzeRegimePro } from "./regimePro";

function buildRfPredictor() {
  let seed = 1337;
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const trees = Array.from({ length: 20 }, () => {
    const hurst = 0.45 + (nextRand() - 0.5) * 0.04;
    const chop = 60 + (nextRand() - 0.5) * 6;
    const hmm = 0.7 + (nextRand() - 0.5) * 0.1;
    const rsiBuy = 50 - nextRand() * 8;
    const rsiSell = 50 + nextRand() * 8;
    return { hurst, chop, hmm, rsiBuy, rsiSell };
  });
  return (features) => {
    const votes = { BUY: 0, SELL: 0, WAIT: 0 };
    for (const t of trees) {
      if (
        features.hurst < t.hurst &&
        features.chop > t.chop &&
        features.hmmProb >= t.hmm &&
        features.vpin < 0.8
      ) {
        if (features.ofi > 0 && features.delta > 0 && features.rsi <= t.rsiBuy) {
          votes.BUY += 1;
        } else if (
          features.ofi < 0 &&
          features.delta < 0 &&
          features.rsi >= t.rsiSell
        ) {
          votes.SELL += 1;
        } else {
          votes.WAIT += 1;
        }
      } else {
        votes.WAIT += 1;
      }
    }
    if (votes.BUY > votes.SELL && votes.BUY > votes.WAIT) return "BUY";
    if (votes.SELL > votes.BUY && votes.SELL > votes.WAIT) return "SELL";
    return "WAIT";
  };
}

const rfPredict = buildRfPredictor();

function findNearestLVN(lvn, entry, side) {
  if (!lvn.length) return null;
  if (side === "Buy") {
    const below = lvn.filter((x) => x < entry);
    if (!below.length) return null;
    return Math.max(...below);
  }
  const above = lvn.filter((x) => x > entry);
  if (!above.length) return null;
  return Math.min(...above);
}

export function evaluateAiMaticProStrategyForSymbol(symbol, candles, config) {
  if (!candles.length) {
    return {
      state: "SCAN",
      trend: "range",
      halted: true,
    };
  }
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  const price = last.close;

  const orderflow = getOrderFlowSnapshot(symbol);
  const profile = computeMarketProfile({
    candles,
    trades: orderflow.trades?.map((t) => ({
      ts: t.ts,
      price: t.price,
      size: t.size,
    })),
    bucketPct: 0.001,
    valueAreaPct: 0.7,
  });

  const regime = analyzeRegimePro({
    symbol,
    closes,
    highs,
    lows,
    volumes,
    vpin: orderflow.vpin,
    ofi: orderflow.ofi,
    delta: orderflow.delta,
  });

  const rsiArr = computeRsi(closes, 14);
  const rsi = rsiArr.length ? rsiArr[rsiArr.length - 1] : 50;
  const rfSignal = rfPredict({
    hurst: regime.hurst,
    chop: regime.chop,
    hmmProb: regime.hmmProb,
    vpin: regime.vpin,
    ofi: regime.ofi,
    delta: regime.delta,
    rsi,
  });

  const entryTfMin = config?.entryTfMin ?? 5;
  const timeStopMinutes = Math.max(entryTfMin * 10, 60);

  const regimeOk = regime.regimeOk && rfSignal !== "WAIT";
  if (!regimeOk || !profile) {
    return {
      state: "SCAN",
      trend: "range",
      signal: null,
      proRegime: { ...regime, rfSignal },
      marketProfile: profile ?? null,
      orderflow,
    };
  }

  const longZone = price <= profile.val;
  const shortZone = price >= profile.vah;
  const ofiLong = orderflow.ofi > 0 && orderflow.ofiPrev <= 0;
  const ofiShort = orderflow.ofi < 0 && orderflow.ofiPrev >= 0;
  const deltaLong = prev.close > price && orderflow.delta > 0;
  const deltaShort = prev.close < price && orderflow.delta < 0;
  const longTrigger = ofiLong || deltaLong;
  const shortTrigger = ofiShort || deltaShort;

  let side = null;
  if (longZone && longTrigger && rfSignal === "BUY") side = "Buy";
  if (shortZone && shortTrigger && rfSignal === "SELL") side = "Sell";

  if (!side) {
    return {
      state: "SCAN",
      trend: "range",
      signal: null,
      proRegime: { ...regime, rfSignal },
      marketProfile: profile,
      orderflow,
    };
  }

  const atrArr = computeATR(highs, lows, closes, 14);
  const atr = atrArr.length ? atrArr[atrArr.length - 1] : Number.NaN;
  const lvnSl = findNearestLVN(profile.lvn ?? [], price, side);
  let sl =
    side === "Buy"
      ? Number.isFinite(lvnSl)
        ? lvnSl
        : price - (Number.isFinite(atr) ? 2 * atr : price * 0.002)
      : Number.isFinite(lvnSl)
        ? lvnSl
        : price + (Number.isFinite(atr) ? 2 * atr : price * 0.002);

  const midRange = (profile.vah + profile.val) / 2;
  const t1 = Number.isFinite(profile.vwap) ? profile.vwap : midRange;
  const t2 =
    Number.isFinite(profile.poc) && profile.poc > 0
      ? profile.poc
      : side === "Buy"
        ? profile.vah
        : profile.val;

  const signal = {
    id: `${symbol}-${Date.now()}`,
    symbol,
    intent: {
      side: side === "Buy" ? "buy" : "sell",
      entry: price,
      sl,
      tp: t2,
    },
    entryType: "LIMIT_MAKER_FIRST",
    kind: "MEAN_REVERSION",
    risk: 0.6,
    message: `PRO sideways ${side} | VA ${profile.val.toFixed(
      2
    )}-${profile.vah.toFixed(2)} | POC ${profile.poc.toFixed(2)}`,
    createdAt: new Date().toISOString(),
  };
  signal.proTargets = { t1, t2, timeStopMinutes, entryTfMin };

  return {
    state: "MANAGE",
    trend: "range",
    signal,
    proRegime: { ...regime, rfSignal },
    marketProfile: profile,
    orderflow,
  };
}

