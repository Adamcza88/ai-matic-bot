const LEGACY_SUPPORTED_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "ADAUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
    "XAUTUSDT",
    "OPUSDT",
];
export const RECOMMENDED_SYMBOLS = [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
    "LINKUSDT",
    "DOTUSDT",
    "LTCUSDT",
];
export const DEFAULT_SELECTED_SYMBOLS = Array.from(new Set([
    ...LEGACY_SUPPORTED_SYMBOLS,
    "LINKUSDT",
    "DOTUSDT",
    "LTCUSDT",
]));
// Fallback list used when dynamic catalog is unavailable.
export const SUPPORTED_SYMBOLS = [...DEFAULT_SELECTED_SYMBOLS];
function buildAllowedSet(allowedSymbols) {
    const out = new Set();
    const source = allowedSymbols ?? SUPPORTED_SYMBOLS;
    for (const item of source) {
        const normalized = normalizeSymbolInput(item);
        if (normalized)
            out.add(normalized);
    }
    return out;
}
export function normalizeSymbolInput(value) {
    const raw = String(value ?? "").trim().toUpperCase();
    if (!raw)
        return null;
    if (!/^[A-Z0-9]+$/.test(raw))
        return null;
    if (raw === "OP")
        return "OPUSDT";
    if (raw.endsWith("USDT"))
        return raw;
    if (raw.endsWith("USDC") || raw.endsWith("USD"))
        return null;
    return `${raw}USDT`;
}
export function filterSupportedSymbols(value, allowedSymbols) {
    const input = Array.isArray(value)
        ? value
        : typeof value === "string"
            ? value.split(",")
            : [];
    const allowed = buildAllowedSet(allowedSymbols);
    const out = [];
    const seen = new Set();
    for (const item of input) {
        const normalized = normalizeSymbolInput(item);
        if (!normalized)
            continue;
        if (!allowed.has(normalized))
            continue;
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
export function resolveSelectedSymbols(value, options) {
    const allowed = options?.allowedSymbols ?? SUPPORTED_SYMBOLS;
    const selected = filterSupportedSymbols(value, allowed);
    if (selected.length > 0)
        return selected;
    const fallback = options?.fallbackSymbols ?? SUPPORTED_SYMBOLS;
    return filterSupportedSymbols(Array.from(fallback), allowed);
}
