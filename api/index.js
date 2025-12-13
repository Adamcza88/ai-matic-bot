// Vercel směruje všechny /api/* požadavky sem (viz vercel.json), takže
// musíme ručně rozdistribuovat na konkrétní handlery.

export default async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    try {
        if (path === "/api/health") {
            const { default: healthHandler } = await import("./health.js");
            return healthHandler(req, res);
        }

        if (path === "/api/demo/order") {
            const { default: orderHandler } = await import("./demo/order.js");
            return orderHandler(req, res);
        }

        if (path === "/api/demo/orders") {
            const { default: ordersHandler } = await import("./demo/orders.js");
            return ordersHandler(req, res);
        }

        if (path === "/api/demo/positions") {
            const { default: positionsHandler } = await import(
                "./demo/positions.js"
            );
            return positionsHandler(req, res);
        }

        if (path === "/api/demo/trades") {
            const { default: tradesHandler } = await import("./demo/trades.js");
            return tradesHandler(req, res);
        }

        if (path === "/api/demo/protection") {
            const { default: protectionHandler } = await import("./demo/protection.js");
            return protectionHandler(req, res);
        }

        if (path === "/api/demo/wallet") {
            const { default: walletHandler } = await import("./demo/wallet.js");
            return walletHandler(req, res);
        }

        if (path === "/api/demo/closed-pnl") {
            const { default: closedPnlHandler } = await import("./demo/closed-pnl.js");
            return closedPnlHandler(req, res);
        }

        if (path === "/api/demo/executions") {
            const { default: executionsHandler } = await import("./demo/executions.js");
            return executionsHandler(req, res);
        }

        if (path === "/api/main/order") {
            const { default: orderHandler } = await import("./main/order.js");
            return orderHandler(req, res);
        }

        if (path === "/api/main/orders") {
            const { default: ordersHandler } = await import("./main/orders.js");
            return ordersHandler(req, res);
        }

        if (path === "/api/main/positions") {
            const { default: positionsHandler } = await import(
                "./main/positions.js"
            );
            return positionsHandler(req, res);
        }

        if (path === "/api/main/trades") {
            const { default: tradesHandler } = await import("./main/trades.js");
            return tradesHandler(req, res);
        }

        if (path === "/api/main/protection") {
            const { default: protectionHandler } = await import("./main/protection.js");
            return protectionHandler(req, res);
        }

        if (path === "/api/main/wallet") {
            const { default: walletHandler } = await import("./main/wallet.js");
            return walletHandler(req, res);
        }

        if (path === "/api/main/closed-pnl") {
            const { default: closedPnlHandler } = await import("./main/closed-pnl.js");
            return closedPnlHandler(req, res);
        }

        if (path === "/api/main/executions") {
            const { default: executionsHandler } = await import("./main/executions.js");
            return executionsHandler(req, res);
        }

        res.status(404).json({ ok: false, error: "Not found" });
    } catch (err) {
        console.error("API router error:", err);
        res.status(500).json({
            ok: false,
            error: err?.message || "Internal Server Error",
        });
    }
}
