// src/engine/bybitAdapterV2.ts
// Maker-first limit adapter s idempotencí, retry a ochranou SL po fill
const isRetryable = (err) => {
    if (!err)
        return false;
    return /timeout|temporar|rate|again/i.test(err);
};
export function attachClosedPnlFetcher(client, cfg) {
    const apiPrefix = cfg.apiPrefix ?? "/api";
    return {
        ...client,
        fetchClosedPnl: async (startTimeMs, endTimeMs, limit = 200) => {
            if (!cfg.authToken)
                return { ok: false, error: "Missing auth token" };
            const params = new URLSearchParams({
                net: cfg.net,
                startTime: String(startTimeMs),
                endTime: String(endTimeMs),
                limit: String(limit),
            });
            try {
                const res = await fetch(`${cfg.apiBase}${apiPrefix}/closed-pnl?${params.toString()}`, {
                    headers: { Authorization: `Bearer ${cfg.authToken}` },
                });
                if (!res.ok) {
                    const text = await res.text();
                    return { ok: false, error: text || `HTTP ${res.status}` };
                }
                const json = await res.json();
                const list = json?.data?.result?.list || json?.result?.list || json?.data?.list || [];
                const mapped = Array.isArray(list)
                    ? list.map((r) => ({
                        symbol: String(r.symbol || ""),
                        closedPnl: Number(r.closedPnl ?? r.realisedPnl ?? 0),
                        execTime: Number(r.execTime ?? r.updatedTime ?? r.createdTime ?? 0),
                    }))
                    : [];
                return { ok: true, list: mapped };
            }
            catch (err) {
                return { ok: false, error: String(err || "fetch failed") };
            }
        },
    };
}
export async function placeLimitWithProtection(input) {
    const { client, symbol, side, price, qty, stopLoss, timeInForce = "GTC", timeoutMs = 30_000, idempotencyKey = `v2-${Date.now()}`, } = input;
    const payload = {
        symbol,
        side,
        qty,
        price,
        orderType: "Limit",
        timeInForce,
        orderLinkId: idempotencyKey,
        reduceOnly: false,
    };
    let created;
    for (let attempt = 1; attempt <= 2; attempt++) {
        created = await client.createOrder(payload);
        if (created.ok)
            break;
        if (!isRetryable(created.error) || attempt === 2) {
            throw new Error(`Order create failed: ${created.error || "unknown"}`);
        }
        await new Promise((r) => setTimeout(r, attempt * 500));
    }
    const orderId = created?.orderId;
    if (!orderId)
        throw new Error("Missing orderId after create");
    const fill = await client.waitForFill(orderId, timeoutMs);
    if (!fill.filled && !fill.partialQty) {
        await client.cancelOrder(orderId);
        throw new Error("Fill timeout");
    }
    const prot = await client.setProtection(orderId, { stopLoss });
    if (!prot.ok)
        throw new Error(`Protection failed: ${prot.error || "unknown"}`);
    return {
        orderId,
        filled: fill.filled,
        avgPrice: fill.avgPrice,
        stopSet: prot.ok,
        filledQty: fill.partialQty,
    };
}
