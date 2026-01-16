import type { Symbol } from "../api/types";

export const SUPPORTED_SYMBOLS: Symbol[] = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "ADAUSDT",
  "XRPUSDT",
  "XMRUSDT",
  "DOGEUSDT",
  "LINKUSDT",
  "MELANIAUSDT",
  "XPLUSDT",
  "HYPEUSDT",
  "FARTCOINUSDT",
];

export function filterSupportedSymbols(value: unknown): Symbol[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(SUPPORTED_SYMBOLS);
  return value
    .map((item) => String(item).toUpperCase())
    .filter((item): item is Symbol => allowed.has(item));
}
