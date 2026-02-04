export const SUPPORTED_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "ADAUSDT",
    "XRPUSDT",
    "SUIUSDT",
    "DOGEUSDT",
    "LINKUSDT",
    "ZILUSDT",
    "AVAXUSDT",
    "HYPEUSDT",
    "OPUSDT",
];
export function filterSupportedSymbols(value) {
    if (!Array.isArray(value))
        return [];
    const allowed = new Set(SUPPORTED_SYMBOLS);
    return value
        .map((item) => String(item).toUpperCase())
        .map((item) => (item === "OP" ? "OPUSDT" : item))
        .filter((item) => allowed.has(item));
}
