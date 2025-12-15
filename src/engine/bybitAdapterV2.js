// src/engine/bybitAdapterV2.ts
// Maker-first limit adapter s idempotencí, retry a ochranou SL po fill
const isRetryable = (err) => {
    if (!err)
        return false;
    return /timeout|temporar|rate|again/i.test(err);
};
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
