import type { Candle } from "./botEngine";

export type TradeTick = {
  ts: number;
  price: number;
  size: number;
};

export type MarketProfile = {
  poc: number;
  vah: number;
  val: number;
  vwap: number;
  hvn: number[];
  lvn: number[];
  valueAreaPct: number;
  buckets: { price: number; volume: number }[];
};

function bucketPrice(price: number, bucketSize: number) {
  const precision = Math.round(1 / bucketSize);
  return Math.round(price * precision) / precision;
}

export function computeMarketProfile(args: {
  candles: Candle[];
  trades?: TradeTick[];
  bucketPct?: number;
  valueAreaPct?: number;
}): MarketProfile | null {
  const candles = args.candles ?? [];
  if (!candles.length) return null;
  const lastClose = candles[candles.length - 1].close;
  const bucketPct = args.bucketPct ?? 0.001;
  const valueAreaPct = args.valueAreaPct ?? 0.7;
  const bucketSize = Math.max(lastClose * bucketPct, lastClose * 0.0002);
  const buckets = new Map<number, number>();
  const trades = args.trades ?? [];

  if (trades.length > 0) {
    for (const t of trades) {
      if (!Number.isFinite(t.price) || !Number.isFinite(t.size)) continue;
      const price = bucketPrice(t.price, bucketSize);
      buckets.set(price, (buckets.get(price) ?? 0) + t.size);
    }
  } else {
    for (const c of candles) {
      if (!Number.isFinite(c.close) || !Number.isFinite(c.volume)) continue;
      const price = bucketPrice(c.close, bucketSize);
      buckets.set(price, (buckets.get(price) ?? 0) + c.volume);
    }
  }
  const bucketArr = Array.from(buckets.entries())
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);
  if (!bucketArr.length) return null;

  const totalVol = bucketArr.reduce((s, b) => s + b.volume, 0);
  const poc = bucketArr.reduce(
    (max, b) => (b.volume > max.volume ? b : max),
    bucketArr[0]
  ).price;

  let vwapSum = 0;
  for (const b of bucketArr) vwapSum += b.price * b.volume;
  const vwap = totalVol > 0 ? vwapSum / totalVol : lastClose;

  const pocIndex = bucketArr.findIndex((b) => b.price === poc);
  let included = new Set<number>([pocIndex]);
  let volAcc = bucketArr[pocIndex]?.volume ?? 0;
  let left = pocIndex - 1;
  let right = pocIndex + 1;
  while (volAcc / totalVol < valueAreaPct && (left >= 0 || right < bucketArr.length)) {
    const leftVol = left >= 0 ? bucketArr[left].volume : -1;
    const rightVol = right < bucketArr.length ? bucketArr[right].volume : -1;
    if (rightVol >= leftVol) {
      if (right < bucketArr.length) {
        included.add(right);
        volAcc += rightVol;
        right += 1;
      } else if (left >= 0) {
        included.add(left);
        volAcc += leftVol;
        left -= 1;
      }
    } else {
      if (left >= 0) {
        included.add(left);
        volAcc += leftVol;
        left -= 1;
      } else if (right < bucketArr.length) {
        included.add(right);
        volAcc += rightVol;
        right += 1;
      }
    }
  }
  const includedPrices = Array.from(included).map((i) => bucketArr[i].price);
  const vah = Math.max(...includedPrices);
  const val = Math.min(...includedPrices);

  const hvn: number[] = [];
  const lvn: number[] = [];
  for (let i = 1; i < bucketArr.length - 1; i++) {
    const prev = bucketArr[i - 1];
    const cur = bucketArr[i];
    const next = bucketArr[i + 1];
    if (cur.volume > prev.volume && cur.volume > next.volume) {
      hvn.push(cur.price);
    }
    if (cur.volume < prev.volume && cur.volume < next.volume) {
      lvn.push(cur.price);
    }
  }

  return {
    poc,
    vah,
    val,
    vwap,
    hvn,
    lvn,
    valueAreaPct,
    buckets: bucketArr,
  };
}

