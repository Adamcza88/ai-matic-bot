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

        if (path === "/api/demo/positions") {
            const { default: positionsHandler } = await import(
                "./demo/positions.js"
            );
            return positionsHandler(req, res);
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
