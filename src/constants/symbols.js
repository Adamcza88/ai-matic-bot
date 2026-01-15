export const SUPPORTED_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "ADAUSDT",
];
export function filterSupportedSymbols(value) {
    if (!Array.isArray(value))
        return [];
    const allowed = new Set(SUPPORTED_SYMBOLS);
    return value
        .map((item) => String(item).toUpperCase())
        .filter((item) => allowed.has(item));
}
