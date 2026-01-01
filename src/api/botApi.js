import { getApiBase } from "../engine/networkConfig";
function requireAuth(opts) {
    if (!opts.authToken) {
        throw new Error("missing_auth_token");
    }
}
export async function sendIntent(intent, opts) {
    requireAuth(opts);
    if (intent.entryType === "MARKET_DISABLED") {
        throw new Error("market_disabled");
    }
    if (!intent.entryPrice) {
        throw new Error("missing_entry_price");
    }
    const qty = intent.qtyMode === "BASE_QTY"
        ? intent.qtyValue
        : intent.qtyValue / intent.entryPrice;
    if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("invalid_qty");
    }
    const isConditional = intent.entryType === "CONDITIONAL";
    const triggerPrice = isConditional ? intent.triggerPrice ?? intent.entryPrice : undefined;
    const timeInForce = intent.entryType === "LIMIT_MAKER_FIRST" ? "PostOnly" : "GTC";
    const payload = {
        symbol: intent.symbol,
        side: intent.side,
        qty,
        orderType: "Limit",
        price: intent.entryPrice,
        triggerPrice,
        trailingStop: intent.trailingStop,
        trailingActivePrice: intent.trailingActivePrice,
        timeInForce,
        orderLinkId: intent.intentId,
        sl: intent.slPrice,
        tp: intent.tpPrices?.[0],
        reduceOnly: false,
    };
    const base = getApiBase(opts.useTestnet);
    const r = await fetch(`${base}/order`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.authToken}`,
        },
        body: JSON.stringify(payload),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok || json?.ok === false) {
        throw new Error(json?.error || `intent_failed:${r.status}`);
    }
    return json;
}
export async function kill(symbol, opts) {
    requireAuth(opts);
    const base = getApiBase(opts.useTestnet);
    const listRes = await fetch(`${base}/orders?symbol=${symbol}`, {
        headers: { Authorization: `Bearer ${opts.authToken}` },
    });
    const listJson = await listRes.json().catch(() => ({}));
    if (!listRes.ok || listJson?.ok === false) {
        throw new Error(listJson?.error || `orders_failed:${listRes.status}`);
    }
    const list = listJson?.data?.result?.list ?? listJson?.data?.list ?? [];
    const cancelled = [];
    for (const o of list) {
        const orderId = o?.orderId ?? o?.orderID ?? o?.id;
        if (!orderId)
            continue;
        const r = await fetch(`${base}/cancel`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${opts.authToken}`,
            },
            body: JSON.stringify({ symbol, orderId }),
        });
        const json = await r.json().catch(() => ({}));
        if (!r.ok || json?.ok === false) {
            throw new Error(json?.error || `cancel_failed:${r.status}`);
        }
        cancelled.push(String(orderId));
    }
    return { ok: true, cancelled };
}
