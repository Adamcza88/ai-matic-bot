import {
    getDemoPositions,
    listDemoOpenOrders,
    listDemoTrades,
    getWalletBalance
} from "./bybitClient.js"; // Reuse existing helpers
import { getInstrumentInfo } from "./instrumentCache.js";

/**
 * Normalizes Bybit Position into application ActivePosition format.
 */
function normalizePosition(bPos, orders, instrument) {
    // bPos example fields: symbol, side (Buy/Sell), size, avgPrice, stopLoss, takeProfit, positionIdx
    // Realtime orders might contain dynamic SL/TP if not yet filled? 
    // Bybit v5: position object usually has 'stopLoss', 'takeProfit' field.

    const side = bPos.side.toLowerCase() === "buy" ? "buy" : "sell";
    const entryPrice = parseFloat(bPos.avgPrice);
    const size = parseFloat(bPos.size);
    const pnl = parseFloat(bPos.unrealisedPnl);

    // Determine effective SL/TP from Position fields FIRST.
    // If 0 or missing, check if there are open Stop orders? 
    // For V5, SL/TP are usually on the position itself.
    let sl = parseFloat(bPos.stopLoss) || 0;
    let tp = parseFloat(bPos.takeProfit) || 0;
    const ts = parseFloat(bPos.trailingStop) || 0;

    const entry = Number.isFinite(entryPrice) ? entryPrice : 0;
    const sideLower = String(bPos.side || "").toLowerCase();
    const oppSide = sideLower === "buy" ? "sell" : "buy";
    const parsePrice = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
    };
    const orderList = Array.isArray(orders) ? orders : [];
    const reduceOnlyOrders = orderList.filter((o) => {
        if (o.symbol !== bPos.symbol) return false;
        if (String(o.side || "").toLowerCase() !== oppSide) return false;
        const ro = o.reduceOnly ?? o.reduce_only ?? o.reduce;
        return ro === true || ro === "true";
    });
    const stopOrders = reduceOnlyOrders.filter((o) => {
        const filter = String(o.orderFilter || "").toLowerCase();
        const stopType = String(o.stopOrderType || "").toLowerCase();
        return filter === "stoporder" || stopType.length > 0 || o.triggerPrice != null;
    });
    const pickPrice = (ordersArr, dir) => {
        let best = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const o of ordersArr) {
            const px = parsePrice(o.triggerPrice ?? o.price);
            if (!px || !entry) continue;
            if (dir === "below" && px >= entry) continue;
            if (dir === "above" && px <= entry) continue;
            const dist = Math.abs(px - entry);
            if (dist < bestDist) {
                best = px;
                bestDist = dist;
            }
        }
        return best;
    };

    if (sl <= 0 && entry > 0) {
        const dir = sideLower === "buy" ? "below" : "above";
        sl = pickPrice(stopOrders, dir) || 0;
    }
    if (tp <= 0 && entry > 0) {
        const limitOrders = reduceOnlyOrders.filter((o) => String(o.orderType || "").toLowerCase() === "limit");
        const dir = sideLower === "buy" ? "above" : "below";
        tp = pickPrice(limitOrders, dir) || 0;
    }

    // Synthesize ID
    const positionId = `${bPos.symbol}-${bPos.createdTime || Date.now()}`;

    return {
        id: positionId,
        positionId: positionId, // Duplicate for type compat
        symbol: bPos.symbol,
        side,
        qty: size,
        size: size, // Duplicate
        entryPrice,
        sl,
        tp,
        currentTrailingStop: ts,
        unrealizedPnl: pnl,
        pnl: pnl,
        pnlValue: pnl,
        env: "mainnet", // This code runs in /api/main so it implies mainnet (or testnet if configured so)
        updatedAt: new Date(parseInt(bPos.updatedTime)).toISOString(),
        timestamp: new Date().toISOString(),

        // Calculated fields
        rrr: (Math.abs(tp - entryPrice) / Math.abs(entryPrice - sl)) || 0,
        peakPrice: 0, // Cannot determine from API easily without history tracking
    };
}

export async function reconcileState(creds, useTestnet = true) {
    const result = {
        positions: [],
        orders: [],
        diffs: [],
        meta: {
            ts: Date.now(),
            env: useTestnet ? "testnet" : "mainnet"
        }
    };

    try {
        // 1. Fetch World State in parallel
        const [posRes, ordRes] = await Promise.all([
            getDemoPositions(creds, useTestnet),
            listDemoOpenOrders(creds, { limit: 50 }, useTestnet)
        ]);

        const bybitPositions = posRes?.result?.list || [];
        const bybitOrders = ordRes?.result?.list || [];

        // 2. Normalize Positions
        const activePositions = [];

        for (const bPos of bybitPositions) {
            if (parseFloat(bPos.size) <= 0) continue; // Ignore zero size

            const norm = normalizePosition(bPos, bybitOrders, null);
            norm.env = useTestnet ? "testnet" : "mainnet";
            activePositions.push(norm);

            // 3. Intrinsic Consistency Detectors
            // A) Missing SL
            if (norm.sl <= 0) {
                result.diffs.push({
                    type: "PARAM_MISMATCH",
                    symbol: norm.symbol,
                    message: "Position has no Stop Loss",
                    severity: "HIGH",
                    field: "sl",
                    value: 0
                });
            }
        }

        result.positions = activePositions;
        result.orders = bybitOrders; // Raw orders for UI to process if needed

    } catch (err) {
        console.error(`[Reconcile] Error: ${err.message}`);
        // Return empty state or throw? 
        // Throwing 500 allows frontend to show error state.
        throw err;
    }

    return result;
}
