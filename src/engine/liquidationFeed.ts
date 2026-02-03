import { updateLiquidations } from "./orderflow";

const FEED_URL_MAINNET = "wss://stream.bybit.com/v5/public/linear";
const FEED_URL_TESTNET = "wss://stream.bybit.com/v5/public/linear";
const PING_INTERVAL = 20000;

type LiquidationEvent = {
  price: number;
  size: number;
  side: string;
  time: number;
};

const liquidationBuffers: Record<string, LiquidationEvent[]> = {};
const MAX_STORED_LIQUIDATIONS = 50;
const LIQUIDATION_TTL = 5 * 60 * 1000; // 5 minutes

export function startLiquidationFeed(
  symbols: string[],
  useTestnet: boolean = false
): () => void {
  const ws = new WebSocket(useTestnet ? FEED_URL_TESTNET : FEED_URL_MAINNET);
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  ws.addEventListener("open", () => {
    console.log("Liquidation Feed WS open");
    const args = symbols.map((s) => `liquidation.${s}`);
    ws.send(JSON.stringify({ op: "subscribe", args }));

    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: "ping" }));
      }
    }, PING_INTERVAL);
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data.toString());
      // Bybit V5 liquidation topic: liquidation.{symbol}
      // data: { symbol, side, price, size, updatedTime }
      if (msg.topic && msg.topic.startsWith("liquidation.")) {
        const data = msg.data;
        if (!data) return;

        const symbol = data.symbol;
        const price = parseFloat(data.price);
        const size = parseFloat(data.size);
        const side = data.side;
        const time = Number(data.updatedTime) || Date.now();

        if (!liquidationBuffers[symbol]) {
          liquidationBuffers[symbol] = [];
        }

        const buffer = liquidationBuffers[symbol];
        buffer.push({ price, size, side, time });

        // Cleanup old
        const now = Date.now();
        const valid = buffer.filter((l) => now - l.time < LIQUIDATION_TTL);
        // Keep max N
        if (valid.length > MAX_STORED_LIQUIDATIONS) {
          valid.splice(0, valid.length - MAX_STORED_LIQUIDATIONS);
        }
        liquidationBuffers[symbol] = valid;

        // Update orderflow
        updateLiquidations(
          symbol,
          valid.map((l) => ({ price: l.price, size: l.size }))
        );
      }
    } catch (e) {
      console.error("Liquidation feed error", e);
    }
  });

  ws.addEventListener("close", () => {
    if (pingTimer) clearInterval(pingTimer);
  });

  return () => {
    if (pingTimer) clearInterval(pingTimer);
    ws.close();
  };
}