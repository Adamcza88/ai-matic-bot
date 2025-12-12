import { evaluateStrategyForSymbol } from "./botEngine";
/**
 * Skeleton backtest runner; caller feeds sequential candles (e.g. 1m).
 * This logs trades with fees/slippage/funding impact; stats are computed post-run.
 */
export function runBacktest(candles, cfg) {
    const trades = [];
    let open = null;
    let equityPeak = 1;
    let equity = 1;
    let lossStreak = 0;
    let maxLossStreak = 0;
    let maxDrawdown = 0;
    for (const c of candles) {
        const decision = evaluateStrategyForSymbol(cfg.symbol, [c], cfg.configOverrides || {});
        const price = c.close;
        if (open) {
            // funding (approx daily proportionally)
            const fundingCost = open.size * price * (cfg.fundingDailyPct / 1440);
            open.fundingCost += fundingCost;
            const hitSl = (open.side === "buy" && price <= open.sl) || (open.side === "sell" && price >= open.sl);
            const hitTp = (open.side === "buy" && price >= open.tp) || (open.side === "sell" && price <= open.tp);
            if (hitSl || hitTp) {
                const exit = price * (1 - Math.sign(open.side === "buy" ? 1 : -1) * cfg.slippagePct / 100);
                const grossPnl = (open.side === "buy" ? exit - open.entry : open.entry - exit) * open.size;
                const fees = cfg.takerFeePct / 100 * open.size * (open.entry + exit);
                const pnl = grossPnl - fees - open.slippageCost - open.fundingCost;
                equity += pnl;
                equityPeak = Math.max(equityPeak, equity);
                const dd = (equityPeak - equity) / equityPeak;
                maxDrawdown = Math.max(maxDrawdown, dd);
                if (pnl < 0) {
                    lossStreak += 1;
                    maxLossStreak = Math.max(maxLossStreak, lossStreak);
                }
                else {
                    lossStreak = 0;
                }
                open.exit = exit;
                open.exitTime = c.openTime;
                open.pnl = pnl;
                open.pnlPct = pnl / Math.max(1e-8, open.entry * open.size);
                open.rMultiple = pnl / Math.max(1e-8, Math.abs(open.entry - open.sl) * open.size);
                open.fees = fees;
                trades.push(open);
                open = null;
            }
        }
        if (!open && decision.signal) {
            const s = decision.signal;
            const sl = s.intent.sl;
            const entry = s.intent.entry;
            const size = 1; // placeholder sizing (external risk model)
            const slippageCost = cfg.slippagePct / 100 * entry * size;
            open = {
                entryTime: c.openTime,
                exitTime: 0,
                side: s.intent.side,
                entry,
                exit: 0,
                sl,
                tp: s.intent.tp,
                size,
                pnl: 0,
                pnlPct: 0,
                rMultiple: 0,
                fees: 0,
                slippageCost,
                fundingCost: 0,
                trigger: s.message,
            };
        }
    }
    const wins = trades.filter((t) => t.pnl > 0).length;
    const losses = trades.filter((t) => t.pnl <= 0).length;
    const avgR = trades.reduce((s, t) => s + t.rMultiple, 0) / Math.max(1, trades.length);
    return {
        trades,
        stats: {
            count: trades.length,
            wins,
            losses,
            winrate: trades.length ? (wins / trades.length) * 100 : 0,
            maxDrawdownPct: maxDrawdown * 100,
            maxLossStreak,
            avgRMultiple: avgR,
        },
    };
}
