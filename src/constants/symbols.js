export const SUPPORTED_SYMBOLS = [
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
export function filterSupportedSymbols(value) {
    if (!Array.isArray(value))
        return [];
    const allowed = new Set(SUPPORTED_SYMBOLS);
    return value
        .map((item) => String(item).toUpperCase())
        .filter((item) => allowed.has(item));
}
