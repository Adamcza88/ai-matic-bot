import type { Candle } from "./botEngine";

export const highest = (values: number[]): number => {
  if (!values.length) throw new Error("highest: empty input");
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > max) max = values[i];
  }
  return max;
};

export const lowest = (values: number[]): number => {
  if (!values.length) throw new Error("lowest: empty input");
  let min = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) min = values[i];
  }
  return min;
};

export const median = (values: number[]): number => {
  if (!values.length) throw new Error("median: empty input");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

export const sign = (n: number): -1 | 0 | 1 => {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
};

export type BybitKline = {
  startTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
};

export type BybitKlineRaw = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export const parseBybitKlines = (rows: BybitKlineRaw[]): BybitKline[] => {
  return rows.map((r) => ({
    startTime: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
    turnover: Number(r[6]),
  }));
};

export const tfMinToBybitInterval = (tfMin: number): string => {
  const map: Record<number, string> = {
    1: "1",
    3: "3",
    5: "5",
    15: "15",
    30: "30",
    60: "60",
    120: "120",
    240: "240",
    360: "360",
    720: "720",
  };
  const v = map[tfMin];
  if (!v) throw new Error(`Unsupported tfMin: ${tfMin}`);
  return v;
};

export const tfMinToMs = (tfMin: number): number => tfMin * 60_000;

export const keepClosedKlines = (
  klines: BybitKline[],
  tfMin: number,
  nowMs: number = Date.now(),
): BybitKline[] => {
  const tfMs = tfMinToMs(tfMin);
  return klines.filter((k) => k.startTime + tfMs <= nowMs);
};

type GetKlinePageArgs = {
  baseUrl: string;
  category: "linear" | "inverse" | "spot";
  symbol: string;
  interval: string;
  start?: number;
  end?: number;
  limit?: number;
};

type BybitKlinePageResponse = {
  retCode: number;
  retMsg: string;
  result: {
    category: string;
    symbol: string;
    list: BybitKlineRaw[];
  };
};

export async function getKlinePage(args: GetKlinePageArgs): Promise<BybitKline[]> {
  const qs = new URLSearchParams({
    category: args.category,
    symbol: args.symbol,
    interval: args.interval,
    limit: String(args.limit ?? 1000),
  });

  if (args.start !== undefined) qs.set("start", String(args.start));
  if (args.end !== undefined) qs.set("end", String(args.end));

  const url = `${args.baseUrl}/v5/market/kline?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = (await res.json()) as BybitKlinePageResponse;
  if (json.retCode !== 0) throw new Error(`Bybit retCode=${json.retCode} ${json.retMsg}`);

  return parseBybitKlines(json.result.list);
}

type FetchClosedWindowArgs = {
  baseUrl: string;
  category: "linear" | "inverse" | "spot";
  symbol: string;
  tfMin: number;
  barsNeeded: number;
  nowMs?: number;
};

export async function fetchClosedWindow(args: FetchClosedWindowArgs): Promise<BybitKline[]> {
  const nowMs = args.nowMs ?? Date.now();
  const interval = tfMinToBybitInterval(args.tfMin);
  let collected: BybitKline[] = [];
  let end = nowMs;
  const pageLimit = 1000;

  while (collected.length < args.barsNeeded) {
    const page = await getKlinePage({
      baseUrl: args.baseUrl,
      category: args.category,
      symbol: args.symbol,
      interval,
      end,
      limit: pageLimit,
    });

    if (!page.length) break;

    const asc = [...page].sort((a, b) => a.startTime - b.startTime);
    const closed = keepClosedKlines(asc, args.tfMin, nowMs);
    collected = [...closed, ...collected];

    const oldestStart = asc[0].startTime;
    end = oldestStart - 1;

    if (page.length < pageLimit) break;
  }

  const dedup = new Map<number, BybitKline>();
  for (const k of collected) dedup.set(k.startTime, k);

  return [...dedup.values()]
    .sort((a, b) => a.startTime - b.startTime)
    .slice(-args.barsNeeded);
}

export const slotMinuteUtc = (startTime: number): number => {
  const d = new Date(startTime);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

type TodBaselineResult = {
  volumeTodBaseline: number;
  volumeTodThreshold: number;
  volumeTodRatio: number;
  volumeTodSampleCount: number;
  volumeTodSlotMinute: number;
  volumeTodFallback: boolean;
};

type BuildTodArgs = {
  currentBar: BybitKline;
  history: BybitKline[];
  volumeCurrent: number;
  volumeP50: number;
  volumeP60: number;
  multiplier?: number;
  minSamples?: number;
};

export function buildTodBaseline(args: BuildTodArgs): TodBaselineResult {
  const slot = slotMinuteUtc(args.currentBar.startTime);
  const multiplier = args.multiplier ?? 1.2;
  const minSamples = args.minSamples ?? 10;

  const slotVolumes = args.history
    .filter((k) => slotMinuteUtc(k.startTime) === slot)
    .map((k) => k.volume);

  const sampleCount = slotVolumes.length;
  const fallback = sampleCount < minSamples;

  const baseline = fallback ? args.volumeP50 : median(slotVolumes);
  const threshold = fallback
    ? Math.max(args.volumeP60, args.volumeP50 * 1.1)
    : baseline * multiplier;

  return {
    volumeTodBaseline: baseline,
    volumeTodThreshold: threshold,
    volumeTodRatio: args.volumeCurrent / Math.max(baseline, 1e-9),
    volumeTodSampleCount: sampleCount,
    volumeTodSlotMinute: slot,
    volumeTodFallback: fallback,
  };
}

type PrepareTodArgs = {
  baseUrl: string;
  category: "linear" | "inverse" | "spot";
  symbol: string;
  tfMin: number;
  currentBar: BybitKline;
  volumeCurrent: number;
  volumeP50: number;
  volumeP60: number;
  nowMs?: number;
};

export async function prepareTodMetrics(args: PrepareTodArgs): Promise<TodBaselineResult> {
  const days = 20;
  const barsNeeded = Math.ceil((days * 1440) / args.tfMin);
  const history = await fetchClosedWindow({
    baseUrl: args.baseUrl,
    category: args.category,
    symbol: args.symbol,
    tfMin: args.tfMin,
    barsNeeded,
    nowMs: args.nowMs,
  });

  return buildTodBaseline({
    currentBar: args.currentBar,
    history,
    volumeCurrent: args.volumeCurrent,
    volumeP50: args.volumeP50,
    volumeP60: args.volumeP60,
  });
}

export const candleToBybitKline = (candle: Candle): BybitKline => ({
  startTime: Number(candle.openTime ?? Number.NaN),
  open: Number(candle.open ?? Number.NaN),
  high: Number(candle.high ?? Number.NaN),
  low: Number(candle.low ?? Number.NaN),
  close: Number(candle.close ?? Number.NaN),
  volume: Number(candle.volume ?? Number.NaN),
  turnover: Number.NaN,
});
