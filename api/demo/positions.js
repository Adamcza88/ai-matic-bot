import { getDemoPositions } from "../../bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "../../userCredentials.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.split(" ")[1]
            : null;

        if (!token) {
            res.status(401).json({ ok: false, error: "Missing auth token" });
            return;
        }

        const user = await getUserFromToken(token);
        const keys = await getUserApiKeys(user.id);

        if (!keys.bybitKey || !keys.bybitSecret) {
            res.status(400).json({
                ok: false,
                error: "Bybit API key/secret not configured for this user",
            });
            return;
        }

        const data = await getDemoPositions({
            apiKey: keys.bybitKey,
            apiSecret: keys.bybitSecret,
        });
        res.json({ ok: true, data });
    } catch (err) {
        console.error("GET /api/demo/positions error:", err);
        res.status(500).json({
            ok: false,
            error: err?.response?.data || err.message || "Unknown error",
        });
    }
}
