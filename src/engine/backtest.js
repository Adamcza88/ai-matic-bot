import { evaluateStrategyForSymbol } from "./botEngine";
function createRng(seed = Date.now()) {
    let state = seed % 2147483647;
    if (state <= 0)
        state += 2147483646;
    return () => {
        state = (state * 16807) % 2147483647;
        return (state - 1) / 2147483646;
    };
}
function percentile(values, pct) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(pct * (sorted.length - 1))));
    return sorted[idx];
}
function mean(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}
function shuffle(arr, rng) {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}
function sampleWithReplacement(arr, rng) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
        out.push(arr[Math.floor(rng() * arr.length)]);
    }
    return out;
}
export function runMonteCarlo(trades, cfg = {}) {
    const iterations = Math.max(1, Math.round(cfg.iterations ?? 500));
    const startingEquity = cfg.startingEquity ?? 1;
    const mode = cfg.mode ?? "shuffle";
    const rng = createRng(cfg.seed ?? Date.now());
    const pnls = trades.map((t) => t.pnl);
    const endEquities = [];
    const maxDrawdowns = [];
    for (let i = 0; i < iterations; i++) {
        const sequence = mode === "bootstrap" ? sampleWithReplacement(pnls, rng) : shuffle(pnls, rng);
        let equity = startingEquity;
        let peak = startingEquity;
        let maxDd = 0;
        for (const pnl of sequence) {
            equity += pnl;
            if (equity > peak)
                peak = equity;
            const dd = peak > 0 ? (peak - equity) / peak : 0;
            if (dd > maxDd)
                maxDd = dd;
        }
        endEquities.push(equity);
        maxDrawdowns.push(maxDd * 100);
    }
    return {
        iterations,
        startingEquity,
        endingEquity: {
            p5: percentile(endEquities, 0.05),
            p50: percentile(endEquities, 0.5),
            p95: percentile(endEquities, 0.95),
            mean: mean(endEquities),
        },
        maxDrawdownPct: {
            p5: percentile(maxDrawdowns, 0.05),
            p50: percentile(maxDrawdowns, 0.5),
            p95: percentile(maxDrawdowns, 0.95),
            mean: mean(maxDrawdowns),
        },
    };
}
function expandGrid(grid) {
    const entries = Object.entries(grid);
    const results = [];
    const walk = (idx, acc) => {
        if (idx >= entries.length) {
            results.push({ ...acc });
            return;
        }
        const [key, values] = entries[idx];
        for (const value of values) {
            acc[key] = value;
            walk(idx + 1, acc);
        }
    };
    walk(0, {});
    return results;
}
export function runGridSearch(candles, baseCfg, gridCfg) {
    const combos = expandGrid(gridCfg.grid);
    const minTrades = gridCfg.minTrades ?? 5;
    return combos.map((params) => {
        const result = runBacktest(candles, {
            ...baseCfg,
            configOverrides: { ...(baseCfg.configOverrides ?? {}), ...params },
        });
        const eligible = result.trades.length >= minTrades;
        const mc = gridCfg.monteCarlo?.enabled === false
            ? undefined
            : runMonteCarlo(result.trades, gridCfg.monteCarlo);
        const totalPnl = result.trades.reduce((sum, t) => sum + t.pnl, 0);
        const ddPct = mc?.maxDrawdownPct.p95 ?? result.stats.maxDrawdownPct;
        const baseScore = totalPnl / Math.max(1e-6, 1 + ddPct / 100);
        const score = gridCfg.objective ? gridCfg.objective(result, mc) : baseScore;
        return { params, result, score: eligible ? score : Number.NEGATIVE_INFINITY, eligible, monteCarlo: mc };
    });
}
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
