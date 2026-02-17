import { computeAtr } from "./ta.js";

function bucketPrice(price, bucketSize) {
  if (!Number.isFinite(bucketSize) || bucketSize <= 0) return price;
  const snapped = Math.round(price / bucketSize) * bucketSize;
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(bucketSize)) + 2));
  return Number(snapped.toFixed(decimals));
}

function resolveGaussianKernel(sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  return {
    kernel: kernel.map((w) => w / Math.max(sum, 1e-8)),
    radius,
  };
}

function gaussianSmooth(values, sigma) {
  if (!values.length || !Number.isFinite(sigma) || sigma <= 0) {
    return values.slice();
  }
  if (values.length < 3) return values.slice();
  const { kernel, radius } = resolveGaussianKernel(sigma);
  const out = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    let weighted = 0;
    let norm = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = i + k;
      if (idx < 0 || idx >= values.length) continue;
      const w = kernel[k + radius];
      weighted += values[idx] * w;
      norm += w;
    }
    out[i] = norm > 0 ? weighted / norm : values[i];
  }
  return out;
}

export function computeMarketProfile(args) {
  const candles = args.candles ?? [];
  if (!candles.length) return null;
  const lastClose = candles[candles.length - 1].close;
  const bucketPct = args.bucketPct ?? 0.001;
  const atrPeriod = args.atrPeriod ?? 14;
  const atrDivisor = args.atrDivisor ?? 20;
  const kdeSigma = args.kdeSigma ?? 1.2;
  const valueAreaPct = args.valueAreaPct ?? 0.7;
  const atrSeries = computeAtr(candles, atrPeriod);
  const currentAtr = atrSeries[atrSeries.length - 1];
  const atrBucket =
    Number.isFinite(currentAtr) && currentAtr > 0
      ? currentAtr / Math.max(1, atrDivisor)
      : Number.NaN;
  const fallbackBucket = Math.max(lastClose * bucketPct, lastClose * 0.0002);
  const bucketSize =
    Number.isFinite(atrBucket) && atrBucket > 0 ? atrBucket : fallbackBucket;
  const buckets = new Map();
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

  const smoothedVolumes = gaussianSmooth(
    bucketArr.map((b) => b.volume),
    kdeSigma
  );
  const smoothedBuckets = bucketArr.map((b, idx) => ({
    price: b.price,
    volume: smoothedVolumes[idx],
  }));

  const totalVol = smoothedBuckets.reduce((s, b) => s + b.volume, 0);
  const poc = smoothedBuckets.reduce(
    (max, b) => (b.volume > max.volume ? b : max),
    smoothedBuckets[0]
  ).price;

  let vwapSum = 0;
  for (const b of smoothedBuckets) vwapSum += b.price * b.volume;
  const vwap = totalVol > 0 ? vwapSum / totalVol : lastClose;

  const pocIndex = smoothedBuckets.findIndex((b) => b.price === poc);
  let included = new Set([pocIndex]);
  let volAcc = smoothedBuckets[pocIndex]?.volume ?? 0;
  let left = pocIndex - 1;
  let right = pocIndex + 1;
  while (
    totalVol > 0 &&
    volAcc / totalVol < valueAreaPct &&
    (left >= 0 || right < smoothedBuckets.length)
  ) {
    const leftVol = left >= 0 ? smoothedBuckets[left].volume : -1;
    const rightVol = right < smoothedBuckets.length ? smoothedBuckets[right].volume : -1;
    if (rightVol >= leftVol) {
      if (right < smoothedBuckets.length) {
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
  const includedPrices = Array.from(included).map((i) => smoothedBuckets[i].price);
  const vah = Math.max(...includedPrices);
  const val = Math.min(...includedPrices);

  const hvn = [];
  const lvn = [];
  for (let i = 1; i < smoothedBuckets.length - 1; i++) {
    const prev = smoothedBuckets[i - 1];
    const cur = smoothedBuckets[i];
    const next = smoothedBuckets[i + 1];
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
    bucketSize,
    buckets: smoothedBuckets,
  };
}
