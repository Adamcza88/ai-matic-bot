// hooks/useTradingBot.ts
import { useEffect, useState } from "react";
import { fetchState, sendIntent } from "../api/botApi";
import { Symbol } from "../api/types";

export function useTradingBot(
  _mode?: unknown,
  _useTestnet?: boolean,
  _authToken?: string
) {
  const [exec, setExec] = useState<any>(null);

  // Poll state (throttled)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await fetchState();
        if (alive) setExec(s);
      } catch {
        // ignore transient errors
      }
    };
    const id = setInterval(tick, 500);
    tick();
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function autoTrade(signal: {
    symbol: Symbol;
    side: "Buy" | "Sell";
    entryPrice: number;
    slPrice: number;
    tpPrices: number[];
    notionalUSDT: number;
  }) {
    const intent = {
      intentId: crypto.randomUUID(),
      createdAt: Date.now(),
      profile: "AI-MATIC",
      symbol: signal.symbol,
      side: signal.side,
      entryType: "LIMIT_MAKER_FIRST",
      entryPrice: signal.entryPrice,
      qtyMode: "USDT_NOTIONAL",
      qtyValue: signal.notionalUSDT,
      slPrice: signal.slPrice,
      tpPrices: signal.tpPrices ?? [],
      expireAfterMs: 30_000,
      tags: { env: "mainnet", account: "UTA", mode: "oneway" },
    } as const;

    await sendIntent(intent);
  }

  return { exec, autoTrade };
}

export type TradingBotApi = ReturnType<typeof useTradingBot>;
