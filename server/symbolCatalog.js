import axios from "axios";
import {
  DEFAULT_SELECTED_SYMBOLS,
  RECOMMENDED_SYMBOLS,
  SUPPORTED_SYMBOLS,
  filterSupportedSymbols,
} from "../src/constants/symbols.js";

const BASE_URL_TESTNET = "https://api-demo.bybit.com";
const BASE_URL_MAINNET = "https://api.bybit.com";
const CACHE_TTL_MS = 5 * 60_000;
const MAX_PAGES = 20;
const PAGE_LIMIT = 1000;

const cacheByEnv = new Map();

function resolveBase(useTestnet = true) {
  return useTestnet ? BASE_URL_TESTNET : BASE_URL_MAINNET;
}

function buildCatalog(availableSymbols, updatedAtIso) {
  const normalizedAvailable = filterSupportedSymbols(
    availableSymbols,
    availableSymbols
  );
  const available =
    normalizedAvailable.length > 0 ? normalizedAvailable : [...SUPPORTED_SYMBOLS];
  const recommended = filterSupportedSymbols(RECOMMENDED_SYMBOLS, available);
  const defaults = filterSupportedSymbols(DEFAULT_SELECTED_SYMBOLS, available);
  const defaultSelectedSymbols =
    defaults.length > 0
      ? defaults
      : recommended.length > 0
        ? recommended
        : available.slice(0, 10);

  return {
    availableSymbols: available,
    recommendedSymbols: recommended,
    defaultSelectedSymbols,
    updatedAt: updatedAtIso,
  };
}

function buildFallbackCatalog() {
  return buildCatalog(SUPPORTED_SYMBOLS, new Date().toISOString());
}

async function fetchBybitLinearUsdtSymbols(useTestnet = true) {
  const base = resolveBase(useTestnet);
  const symbols = [];
  let cursor = "";
  for (let i = 0; i < MAX_PAGES; i++) {
    const params = new URLSearchParams({
      category: "linear",
      limit: String(PAGE_LIMIT),
    });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const url = `${base}/v5/market/instruments-info?${params.toString()}`;
    const res = await axios.get(url, { timeout: 10_000 });
    if (res.data?.retCode !== 0) {
      throw new Error(res.data?.retMsg || "failed_to_load_symbols");
    }
    const list = res.data?.result?.list ?? [];
    for (const item of list) {
      const symbol = String(item?.symbol ?? "").toUpperCase();
      const status = String(item?.status ?? "").toUpperCase();
      if (!symbol.endsWith("USDT")) continue;
      if (status && status !== "TRADING") continue;
      symbols.push(symbol);
    }
    cursor = String(res.data?.result?.nextPageCursor ?? "");
    if (!cursor) break;
  }
  const unique = Array.from(new Set(symbols));
  if (!unique.length) {
    throw new Error("empty_symbol_catalog");
  }
  return unique;
}

export async function getSymbolCatalog(useTestnet = true) {
  const env = useTestnet ? "testnet" : "mainnet";
  const now = Date.now();
  const cached = cacheByEnv.get(env);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const availableSymbols = await fetchBybitLinearUsdtSymbols(useTestnet);
    const catalog = buildCatalog(availableSymbols, new Date(now).toISOString());
    cacheByEnv.set(env, { ts: now, data: catalog });
    return catalog;
  } catch (err) {
    if (cached) {
      return cached.data;
    }
    const fallback = buildFallbackCatalog();
    cacheByEnv.set(env, { ts: now, data: fallback });
    return fallback;
  }
}

export function clearSymbolCatalogCache() {
  cacheByEnv.clear();
}
