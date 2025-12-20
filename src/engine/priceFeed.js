// src/engine/priceFeed.ts
// Public realtime feed z Bybitu přes WebSocket s automatickým pingem
import { evaluateStrategyForSymbol, } from "@/engine/botEngine";
// Mainnet public WS feed (switch from testnet)
const FEED_URL = "wss://stream.bybit.com/v5/public/linear";
// WS ping interval (Bybit vyžaduje každých ~20s)
const PING_INTERVAL = 20000;
// Buffer svíček pro každý symbol
const candleBuffers = {};
function ensureBuffer(symbol) {
    if (!candleBuffers[symbol]) {
        candleBuffers[symbol] = [];
    }
    return candleBuffers[symbol];
}
// normalizace Bybit WS kline dat
function normalizeWsKline(row) {
    if (Array.isArray(row)) {
        return {
            openTime: Number(row[0]),
            open: parseFloat(row[1]),
            high: parseFloat(row[2]),
            low: parseFloat(row[3]),
            close: parseFloat(row[4]),
            volume: parseFloat(row[5]),
        };
    }
    else {
        return {
            openTime: Number(row.start ?? row.startTime),
            open: parseFloat(row.open),
            high: parseFloat(row.high),
            low: parseFloat(row.low),
            close: parseFloat(row.close),
            volume: parseFloat(row.volume),
        };
    }
}
export function startPriceFeed(symbols, onDecision) {
    const ws = new WebSocket(FEED_URL);
    let pingTimer = null;
    ws.addEventListener("open", () => {
        console.log("Bybit WS open → subscribing…");
        ws.send(JSON.stringify({
            op: "subscribe",
            args: symbols.map((s) => `kline.1.${s}`),
        }));
        // ping nutný pro udržení spojení
        pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ op: "ping" }));
            }
        }, PING_INTERVAL);
    });
    ws.addEventListener("message", (raw) => {
        try {
            const msg = JSON.parse(raw.data.toString());
            // ignore pongs & subscription acks
            if (msg.op === "pong")
                return;
            if (msg.success === true)
                return;
            if (!msg.topic || !msg.data)
                return;
            const [, , symbol] = msg.topic.split(".");
            if (!symbol)
                return;
            const list = msg.data;
            if (!Array.isArray(list) || list.length === 0)
                return;
            const row = list[list.length - 1];
            const { openTime, open, high, low, close, volume } = normalizeWsKline(row);
            const buffer = ensureBuffer(symbol);
            const candle = {
                openTime,
                open,
                high,
                low,
                close,
                volume,
            };
            buffer.push(candle);
            if (buffer.length > 500)
                buffer.shift();
            const decision = evaluateStrategyForSymbol(symbol, buffer);
            onDecision(symbol, decision);
        }
        catch (err) {
            console.error("priceFeed ws error:", err);
        }
    });
    ws.addEventListener("error", (ev) => {
        console.error("Bybit WS error", ev);
    });
    ws.addEventListener("close", () => {
        console.warn("Bybit WS closed");
        clearInterval(pingTimer);
    });
    return () => {
        try {
            clearInterval(pingTimer);
            ws.close();
        }
        catch {
            // ignore
        }
    };
}
