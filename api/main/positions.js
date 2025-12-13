import { getDemoPositions } from "../../server/bybitClient.js";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";

function setCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") {
        res.status(200).end();
        return;
    }
    if (req.method !== "GET") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
    }
    try {
        const useTestnet = req.query.net === "testnet";
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
        const key = useTestnet ? keys.bybitTestnetKey : keys.bybitMainnetKey;
        const secret = useTestnet ? keys.bybitTestnetSecret : keys.bybitMainnetSecret;

        if (!key || !secret) {
            res.status(400).json({
                ok: false,
                error: useTestnet
                    ? "Bybit TESTNET API key/secret not configured for this user"
                    : "Bybit MAINNET API key/secret not configured for this user",
            });
            return;
        }

        const data = await getDemoPositions({
            apiKey: key,
            apiSecret: secret,
        }, useTestnet);
        res.json({ ok: true, data });
    } catch (err) {
        console.error("GET /api/main/positions error:", err);
        res.status(500).json({
            ok: false,
            error: err?.response?.data || err.message || "Unknown error",
        });
    }
}
