// Execution router: maps strategy signals to concrete order instructions
// (Market vs Limit vs Stop-Limit) with TP/SL/trailing derived from profile.
export const PROFILE = {
    "ai-matic-scalp": {
        tpR: 1.4,
        trailLockR: 0.4,
        trailActivateR: 1.2,
        stopLimitBufferBps: 6,
        marketDistanceBps: 10,
        limitChaseMaxBps: 25,
    },
    "ai-matic-x": {
        tpR: 1.6,
        trailLockR: 0.6,
        trailActivateR: 1.4,
        stopLimitBufferBps: 8,
        marketDistanceBps: 12,
        limitChaseMaxBps: 35,
    },
    "ai-matic": {
        tpR: 2.2,
        trailLockR: 1.1,
        trailActivateR: 2.0,
        stopLimitBufferBps: 12,
        marketDistanceBps: 18,
        limitChaseMaxBps: 70,
    },
    "ai-matic-tree": {
        tpR: 2.2,
        trailLockR: 1.1,
        trailActivateR: 2.0,
        stopLimitBufferBps: 12,
        marketDistanceBps: 18,
        limitChaseMaxBps: 70,
    },
};
function bpsDistance(a, b) {
    return Math.abs(a - b) / Math.max(b, 1e-8) * 10_000;
}
function dir(side) {
    return side === "Buy" ? 1 : -1;
}
export function buildTpFromR(sig, tpR) {
    const r = Math.abs(sig.entry - sig.stopLoss);
    if (Number.isFinite(sig.takeProfit)) {
        return { tp: sig.takeProfit, r };
    }
    const tp = sig.entry + dir(sig.side) * tpR * r;
    return { tp, r };
}
export function buildTrailing(sig, cfg, r) {
    const activationPrice = sig.entry + dir(sig.side) * cfg.trailActivateR * r;
    const lockedStopPrice = sig.entry + dir(sig.side) * cfg.trailLockR * r;
    return { activationPrice, lockedStopPrice };
}
export function decideExecutionPlan(sig, market, profile, qty) {
    const cfg = PROFILE[profile];
    const { tp, r } = buildTpFromR(sig, cfg.tpR);
    const trailing = buildTrailing(sig, cfg, r);
    const distBps = bpsDistance(market.last, sig.entry);
    const spreadOk = market.spreadBps == null ? true : market.spreadBps <= 12;
    const marketPlan = (reason) => ({
        symbol: sig.symbol,
        side: sig.side,
        mode: "MARKET",
        qty,
        timeInForce: "IOC",
        stopLoss: sig.stopLoss,
        takeProfit: tp,
        trailing,
        reason,
    });
    const limitPlan = (reason, tif = "GTC") => ({
        symbol: sig.symbol,
        side: sig.side,
        mode: "LIMIT",
        qty,
        entryPrice: sig.entry,
        timeInForce: tif,
        stopLoss: sig.stopLoss,
        takeProfit: tp,
        trailing,
        reason,
    });
    const stopLimitPlan = (reason) => {
        const buffer = (cfg.stopLimitBufferBps / 10_000) * sig.entry;
        const limitPrice = sig.entry + dir(sig.side) * buffer;
        return {
            symbol: sig.symbol,
            side: sig.side,
            mode: "STOP_LIMIT",
            qty,
            triggerPrice: sig.entry,
            limitPrice,
            timeInForce: "GTC",
            stopLoss: sig.stopLoss,
            takeProfit: tp,
            trailing,
            reason,
        };
    };
    if (sig.kind === "PULLBACK" || sig.kind === "MEAN_REVERSION") {
        if (distBps <= cfg.marketDistanceBps && spreadOk) {
            return marketPlan(`MARKET: ${sig.kind} dist ${distBps.toFixed(1)}bps`);
        }
        return limitPlan(`LIMIT(PostOnly): ${sig.kind}`, "PostOnly");
    }
    if (sig.kind === "BREAKOUT") {
        if (distBps <= cfg.marketDistanceBps && spreadOk) {
            return marketPlan(`MARKET: BREAKOUT dist ${distBps.toFixed(1)}bps`);
        }
        return stopLimitPlan(`STOP_LIMIT: BREAKOUT trigger@entry buffer ${cfg.stopLimitBufferBps}bps`);
    }
    if (sig.kind === "MOMENTUM") {
        if (distBps <= cfg.marketDistanceBps && spreadOk) {
            return marketPlan(`MARKET: MOMENTUM dist ${distBps.toFixed(1)}bps`);
        }
        if (distBps <= cfg.limitChaseMaxBps) {
            return limitPlan(`LIMIT: MOMENTUM dist ${distBps.toFixed(1)}bps`);
        }
        return limitPlan(`LIMIT(PostOnly): MOMENTUM avoid chase (${distBps.toFixed(1)}bps)`, "PostOnly");
    }
    return limitPlan("DEFAULT: LIMIT(PostOnly)", "PostOnly");
}
