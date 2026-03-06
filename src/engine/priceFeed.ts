// src/engine/priceFeed.ts
// Public realtime feed z Bybitu přes WebSocket s automatickým pingem

import {
  Candle,
  evaluateStrategyForSymbol,
} from "@/engine/botEngine";
import type { BotConfig } from "@/engine/botEngine";
import { updateOpenInterest, updateOrderbook, updateTrades } from "./orderflow";
import { startLiquidationFeed } from "./liquidationFeed";

const FEED_URL_MAINNET = "wss://stream.bybit.com/v5/public/linear";
const FEED_URL_TESTNET = "wss://stream.bybit.com/v5/public/linear";
const REST_URL_MAINNET = "https://api.bybit.com";
const REST_URL_TESTNET = "https://api-demo.bybit.com";

// WS ping interval (Bybit vyžaduje každých ~20s)
const PING_INTERVAL = 20000;

// Engine decision – bereme přímo návrat evaluateStrategyForSymbol
export type PriceFeedDecision = ReturnType<typeof evaluateStrategyForSymbol>;
export type PriceFeedDecisionExtras = {
  preloadedCandlesByInterval?: Record<string, Candle[]>;
};

export type PriceFeedCallback = {
  symbol: string;
  decision: PriceFeedDecision;
} | ((symbol: string, decision: PriceFeedDecision) => void);

// Buffer svíček pro každý symbol
const candleBuffers: Record<string, Candle[]> = {};

type BybitWsKlineRow =
  | {
      start?: number | string;
      startTime?: number | string;
      open?: number | string;
      high?: number | string;
      low?: number | string;
      close?: number | string;
      volume?: number | string;
    }
  | (string | number)[];

type BybitRestKlineRow = (string | number)[];

function ensureBuffer(symbol: string): Candle[] {
  if (!candleBuffers[symbol]) {
    candleBuffers[symbol] = [];
  }
  return candleBuffers[symbol];
}

// normalizace Bybit WS kline dat
function normalizeWsKline(row: BybitWsKlineRow) {
  if (Array.isArray(row)) {
    return {
      openTime: Number(row[0]),
      open: parseFloat(row[1] as string),
      high: parseFloat(row[2] as string),
      low: parseFloat(row[3] as string),
      close: parseFloat(row[4] as string),
      volume: parseFloat(row[5] as string),
    };
  } else {
    return {
      openTime: Number(row.start ?? row.startTime),
      open: parseFloat(row.open as string),
      high: parseFloat(row.high as string),
      low: parseFloat(row.low as string),
      close: parseFloat(row.close as string),
      volume: parseFloat(row.volume as string),
    };
  }
}

function normalizeRestKline(row: BybitRestKlineRow): Candle | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const openTime = Number(row[0]);
  const open = parseFloat(row[1] as string);
  const high = parseFloat(row[2] as string);
  const low = parseFloat(row[3] as string);
  const close = parseFloat(row[4] as string);
  const volume = parseFloat(row[5] as string);
  if (!Number.isFinite(openTime)) return null;
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return { openTime, open, high, low, close, volume };
}

function mergeCandles(existing: Candle[], incoming: Candle[], maxCandles: number): Candle[] {
  const merged = new Map<number, Candle>();
  for (const c of existing) {
    if (!Number.isFinite(c.openTime)) continue;
    merged.set(c.openTime, c);
  }
  for (const c of incoming) {
    if (!Number.isFinite(c.openTime)) continue;
    merged.set(c.openTime, c);
  }
  const sorted = Array.from(merged.values()).sort((a, b) => a.openTime - b.openTime);
  if (sorted.length <= maxCandles) return sorted;
  return sorted.slice(-maxCandles);
}

async function fetchBackfillCandles(args: {
  symbol: string;
  interval: string;
  lookbackMinutes: number;
  useTestnet?: boolean;
  limit?: number;
}): Promise<Candle[]> {
  const intervalMinutes = Number(args.interval) || 1;
  const totalBars = Math.max(1, Math.ceil(args.lookbackMinutes / intervalMinutes));
  const limitPerRequest = Math.min(Math.max(args.limit ?? 1000, 1), 1000);
  const base = args.useTestnet ? REST_URL_TESTNET : REST_URL_MAINNET;
  const out: Candle[] = [];
  let end = Date.now();
  let lastEnd = end;
  const maxAttemptsPerPage = 3;

  while (out.length < totalBars) {
    const limit = Math.min(limitPerRequest, totalBars - out.length);
    const url = `${base}/v5/market/kline?category=linear&symbol=${args.symbol}&interval=${args.interval}&limit=${limit}&end=${end}`;
    let json: any = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttemptsPerPage; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`backfill_failed_http:${res.status}`);
        }
        json = await res.json();
        const retCode = Number(json?.retCode ?? 0);
        if (Number.isFinite(retCode) && retCode !== 0) {
          throw new Error(`backfill_failed_retcode:${retCode}`);
        }
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError) {
      if (out.length > 0) {
        console.warn(
          `backfill partial for ${args.symbol}: loaded ${out.length}/${totalBars} bars (${String(
            (lastError as Error)?.message ?? lastError
          )})`
        );
        break;
      }
      throw lastError instanceof Error ? lastError : new Error("backfill_failed");
    }
    const list = json?.result?.list ?? [];
    if (!Array.isArray(list) || list.length === 0) break;
    const parsed = list
      .map((row: BybitRestKlineRow) => normalizeRestKline(row))
      .filter((c: Candle | null): c is Candle => Boolean(c));
    if (!parsed.length) break;
    out.push(...parsed);
    const oldest = parsed.reduce((min, c) => Math.min(min, c.openTime), Infinity);
    if (!Number.isFinite(oldest)) break;
    end = oldest - 1;
    if (end >= lastEnd) break;
    lastEnd = end;
  }

  return out.sort((a, b) => a.openTime - b.openTime);
}

interface BybitWsMessage {
  op?: "pong" | "ping" | "subscribe";
  success?: boolean;
  topic?: string;
  type?: "snapshot" | "delta";
  data?: BybitWsKlineRow[] | any;
}

export interface PriceFeedOptions {
  useTestnet?: boolean;
  timeframe?: string;
  configOverrides?:
    | Partial<BotConfig>
    | ((symbol: string) => Partial<BotConfig>);
  decisionFn?: (
    symbol: string,
    candles: Candle[],
    config?: Partial<BotConfig>,
    extras?: PriceFeedDecisionExtras
  ) => PriceFeedDecision;
  maxCandles?: number;
  backfill?: {
    enabled?: boolean;
    interval?: string;
    lookbackMinutes?: number;
    limit?: number;
  };
  preloadHigherTimeframes?: {
    enabled?: boolean;
    intervals?: string[];
    lookbackMinutes?: number;
    lookbackMinutesByInterval?: Record<string, number>;
    limit?: number;
  };
  orderflow?: {
    enabled?: boolean;
    depth?: number;
  };
}

export function startPriceFeed(
  symbols: string[],
  onDecision: (symbol: string, decision: PriceFeedDecision) => void,
  opts?: PriceFeedOptions
): () => void {
  const ws = new WebSocket(opts?.useTestnet ? FEED_URL_TESTNET : FEED_URL_MAINNET);
  const timeframe = opts?.timeframe ?? "1";
  const maxCandles = opts?.maxCandles ?? 500;
  const decisionFn = opts?.decisionFn ?? evaluateStrategyForSymbol;
  const backfill = opts?.backfill;
  const preloadedBySymbol: Record<string, Record<string, Candle[]>> = {};

  // Start Liquidation Feed alongside Price Feed
  const stopLiquidationFeed = startLiquidationFeed(symbols, opts?.useTestnet);

  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const resolveOverrides = (symbol: string) =>
    typeof opts?.configOverrides === "function"
      ? opts.configOverrides(symbol)
      : opts?.configOverrides;
  const resolveExtras = (symbol: string): PriceFeedDecisionExtras | undefined => {
    const preloaded = preloadedBySymbol[symbol];
    if (!preloaded || !Object.keys(preloaded).length) return undefined;
    return { preloadedCandlesByInterval: preloaded };
  };
  const emitDecision = (symbol: string, candles: Candle[]) => {
    const decision = decisionFn(
      symbol,
      candles,
      resolveOverrides(symbol) ?? {},
      resolveExtras(symbol)
    );
    onDecision(symbol, decision);
  };

  if (backfill?.enabled) {
    const interval = backfill.interval ?? timeframe;
    const lookbackMinutes = backfill.lookbackMinutes ?? 1440;
    const limit = backfill.limit ?? 1000;
    for (const symbol of symbols) {
      fetchBackfillCandles({
        symbol,
        interval,
        lookbackMinutes,
        useTestnet: opts?.useTestnet,
        limit,
      })
        .then((candles) => {
          if (!candles.length) return;
          const buffer = ensureBuffer(symbol);
          const merged = mergeCandles(buffer, candles, maxCandles);
          candleBuffers[symbol] = merged;
          emitDecision(symbol, merged);
        })
        .catch((err) => {
          console.warn(`backfill failed for ${symbol}:`, err);
        });
    }
  }
  const preloadHtf = opts?.preloadHigherTimeframes;
  if (preloadHtf?.enabled) {
    const intervals = (preloadHtf.intervals ?? [])
      .map((value) => String(value).trim())
      .filter((value) => value.length > 0 && value !== timeframe);
    const fallbackLookback = preloadHtf.lookbackMinutes ?? backfill?.lookbackMinutes ?? 1440;
    const lookbackByInterval = preloadHtf.lookbackMinutesByInterval ?? {};
    const limit = preloadHtf.limit ?? 1000;
    for (const symbol of symbols) {
      const tasks = intervals.map(async (interval) => {
        const lookbackMinutes = Math.max(
          1,
          Number(lookbackByInterval[interval] ?? fallbackLookback)
        );
        const candles = await fetchBackfillCandles({
          symbol,
          interval,
          lookbackMinutes,
          useTestnet: opts?.useTestnet,
          limit,
        });
        return { interval, candles };
      });
      Promise.all(tasks)
        .then((results) => {
          const current = preloadedBySymbol[symbol] ?? {};
          const next: Record<string, Candle[]> = { ...current };
          for (const { interval, candles } of results) {
            if (candles.length) next[interval] = candles;
          }
          preloadedBySymbol[symbol] = next;
          const buffer = ensureBuffer(symbol);
          if (buffer.length > 0) {
            emitDecision(symbol, buffer);
          }
        })
        .catch((err) => {
          console.warn(`htf preload failed for ${symbol}:`, err);
        });
    }
  }

  ws.addEventListener("open", () => {
    console.log("Bybit WS open → subscribing…");

    const args = [
      ...symbols.map((s) => `kline.${timeframe}.${s}`),
      ...symbols.map((s) => `tickers.${s}`),
    ];

    if (opts?.orderflow?.enabled) {
      const depth = opts.orderflow.depth ?? 50;
      args.push(...symbols.map((s) => `publicTrade.${s}`));
      args.push(...symbols.map((s) => `orderbook.${depth}.${s}`));
    }

    console.log(`[PriceFeed] Subscribing to: ${args.length} topics for ${symbols.length} symbols`);

    ws.send(
      JSON.stringify({
        op: "subscribe",
        args,
      })
    );

    // ping nutný pro udržení spojení
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: "ping" }));
      }
    }, PING_INTERVAL);
  });

  ws.addEventListener("message", (raw) => {
    try {
      const msg: BybitWsMessage = JSON.parse(
        (raw as MessageEvent).data.toString()
      );

      // ignore pongs & subscription acks
      if (msg.op === "pong") return;
      if (msg.success === true) return;

      if (!msg.topic || !msg.data) return;

      if (msg.topic.startsWith("tickers.")) {
        const data = msg.data;
        const symbol = data?.symbol;
        const oi = data?.openInterest;
        if (symbol && oi) {
          updateOpenInterest(symbol, parseFloat(oi));
        }
        return;
      }

      if (msg.topic.startsWith("publicTrade.")) {
        const data = msg.data;
        if (Array.isArray(data) && data.length > 0) {
          const symbol = data[0].s;
          updateTrades(symbol, data);
        }
        return;
      }

      if (msg.topic.startsWith("orderbook.")) {
        const data = msg.data;
        const symbol = data?.s;
        if (symbol) {
          updateOrderbook(symbol, data.b, data.a, msg.type === "snapshot");
        }
        return;
      }

      const [, , symbol] = msg.topic.split(".");
      if (!symbol) return;

      const list = msg.data;
      if (!Array.isArray(list) || list.length === 0) return;

      const row = list[list.length - 1];
      const { openTime, open, high, low, close, volume } =
        normalizeWsKline(row);

      const buffer = ensureBuffer(symbol);

      const candle: Candle = {
        openTime,
        open,
        high,
        low,
        close,
        volume,
      };

      buffer.push(candle);
      if (buffer.length > maxCandles) buffer.shift();

      emitDecision(symbol, buffer);
    } catch (err) {
      console.error("priceFeed ws error:", err);
    }
  });

  ws.addEventListener("error", (ev) => {
    console.error("[PriceFeed] Bybit WS error", ev);
  });

  ws.addEventListener("close", () => {
    console.warn("[PriceFeed] Bybit WS closed");
    clearInterval(pingTimer);
  });

  return () => {
    try {
      stopLiquidationFeed();
      clearInterval(pingTimer);
      ws.close();
    } catch {
      // ignore
    }
  };
}
