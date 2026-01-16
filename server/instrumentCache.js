import axios from "axios";
import crypto from "crypto";

const CACHE = new Map();
const TTL_MS = 60_000 * 5; // 5 minutes cache

// Minimal signature needed for public endpoints? 
// Actually instruments-info is Public, no signature required usually.
// But we might want to use the signed client base URL logic?
// For simplicity, we'll use a direct fetch or reuse basic helpers if exported.
// We'll reimplement basic fetch here to avoid circular dependency with bybitClient if it imports this.

const BASE_URL_MAINNUM = "https://api.bybit.com";
const BASE_URL_TESTNET = "https://api-demo.bybit.com";

function resolveBase(useTestnet) {
    return useTestnet ? BASE_URL_TESTNET : BASE_URL_MAINNUM;
}

export async function getInstrumentInfo(symbol, useTestnet = true) {
    const envKey = useTestnet ? "testnet" : "mainnet";
    const key = `${envKey}:${symbol}`;

    const now = Date.now();
    const cached = CACHE.get(key);
    if (cached && (now - cached.ts < TTL_MS)) {
        return cached.data;
    }

    // Fetch from API
    try {
        const url = `${resolveBase(useTestnet)}/v5/market/instruments-info?category=linear&symbol=${symbol}`;
        const res = await axios.get(url);

        if (res.data.retCode !== 0) {
            throw new Error(`Bybit Info Error: ${res.data.retMsg}`);
        }

        const item = res.data.result.list[0];
        if (!item) {
            throw new Error(`Instrument ${symbol} not found`);
        }

        const info = {
            minQty: Number(item.lotSizeFilter.minOrderQty),
            maxQty: Number(item.lotSizeFilter.maxOrderQty),
            stepSize: Number(item.lotSizeFilter.qtyStep),
            minNotional: Number(item.lotSizeFilter.minNotionalValue || 0),
            tickSize: Number(item.priceFilter?.tickSize ?? 0),
            contractValue: Number(item.contractSize ?? 1),
        };

        CACHE.set(key, { ts: now, data: info });
        return info;
    } catch (err) {
        console.error(`[InstrumentCache] Failed to fetch ${symbol}:`, err.message);
        // Return cached data if available; otherwise surface error.
        if (cached) return cached.data;
        throw err;
    }
}
