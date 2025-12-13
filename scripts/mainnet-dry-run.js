import { validatePayload, signOnly } from "../server/bybitClient.js";

// Mock credentials for CI environment (if not present)
// In real usage, these would come from env. For CI dry-run, we might need dummy keys 
// just to prove the signing algorithm works, OR we require secrets in GitHub Actions.
// Per user request "B1) Script", it checks payload + signing.

const MOCK_CREDS = {
    apiKey: process.env.BYBIT_API_KEY || "ci_dummy_key",
    apiSecret: process.env.BYBIT_API_SECRET || "ci_dummy_secret",
};

const payload = {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Market",
    qty: 0.001
};

console.log("Starting Mainnet Dry-Run Check...");

try {
    // 1. Validate Payload Structure
    console.log("[-] Validating payload structure...");
    validatePayload(payload);
    console.log("[+] Payload Valid.");

    // 2. Test Signing (Crypto check)
    console.log("[-] Testing signature generation...");
    const signed = signOnly(payload, MOCK_CREDS);

    if (!signed.headers["X-BAPI-SIGN"]) {
        throw new Error("Signature generation failed (empty signature)");
    }
    console.log("[+] Signature Generated:", signed.headers["X-BAPI-SIGN"].slice(0, 10) + "...");

    console.log("MAINNET DRY-RUN OK");
    process.exit(0);
} catch (e) {
    console.error("MAINNET DRY-RUN FAILED:", e.message);
    process.exit(1);
}
