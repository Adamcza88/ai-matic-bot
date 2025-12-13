import crypto from "crypto";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";

// Helper to validate payload presence
function validatePayload(payload) {
    const required = ["symbol", "side", "qty"];
    for (const field of required) {
        if (!payload[field]) {
            throw new Error(`Missing required field: ${field}`);
        }
    }
}

// Helper to mimic signing (Dry Run)
function signRequest(payload, keys) {
    if (!keys.apiKey || !keys.apiSecret) {
        throw new Error("Missing API keys for signing");
    }
    // Mimic Bybit signature generation
    const timestamp = Date.now().toString();
    const recvWindow = "5000";
    const bodyStr = JSON.stringify(payload);
    const paramStr = timestamp + keys.apiKey + recvWindow + bodyStr;

    const signature = crypto
        .createHmac("sha256", keys.apiSecret)
        .update(paramStr)
        .digest("hex");

    return signature;
}

/**
 * DRY-RUN: Validates payload and keys, simulates signing.
 * Does NOT send to Bybit.
 */
export async function dryRunOrder(payload, keys) {
    // 1. Validate Payload structure
    validatePayload(payload);

    // 2. Validate Keys & Sign
    // This ensures we fail if keys are invalid format or missing, 
    // and we prove we CAN sign the request.
    const signature = signRequest(payload, keys);

    return {
        ok: true,
        data: {
            message: "Dry run successful",
            signatureGenerated: true,
            mockSignature: "***" + signature.slice(-6),
            payload
        }
    };
}

// API Handler Wrapper
export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.replace("Bearer ", "");

        if (!token) return res.status(401).json({ ok: false, error: "Missing auth" });

        // Force Mainnet for strictness check, or follow query?
        // User said "Mainnet Dry-Run".
        const env = "mainnet";

        const user = await getUserFromToken(token);
        const keys = await getUserApiKeys(user.id, env); // Strict fetch

        const result = await dryRunOrder(req.body, {
            apiKey: keys.apiKey,
            apiSecret: keys.apiSecret
        });

        return res.status(200).json({
            ok: true,
            data: result.data,
            meta: {
                ts: new Date().toISOString(),
                env,
                mode: "dry-run"
            }
        });

    } catch (err) {
        return res.status(400).json({
            ok: false,
            error: err.message,
            meta: { ts: new Date().toISOString() }
        });
    }
}
