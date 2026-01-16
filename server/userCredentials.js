import { ensureSupabase } from "./supabaseClient.js";

const SERVICE_BYBIT_KEY = "bybit api key"; // legacy fallback (testnet)
const SERVICE_BYBIT_SECRET = "bybit api secret"; // legacy fallback (testnet)
const SERVICE_BYBIT_DEMO_KEY = "bybit demo api key";
const SERVICE_BYBIT_DEMO_SECRET = "bybit demo api secret";
const SERVICE_BYBIT_TESTNET_KEY = "bybit testnet api key";
const SERVICE_BYBIT_TESTNET_SECRET = "bybit testnet api secret";
const SERVICE_BYBIT_MAINNET_KEY = "bybit mainnet api key";
const SERVICE_BYBIT_MAINNET_SECRET = "bybit mainnet api secret";
const SERVICE_CRYPTOPANIC_KEY = "cryptopanic api key";

export async function getUserFromToken(token) {
  const supabase = ensureSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error) throw new Error(error.message || "Failed to validate user token");
  if (!data?.user) throw new Error("User not found for provided token");
  return data.user;
}

const requireKeys = (keys, env) => {
  if (!keys?.apiKey || !keys?.apiSecret) {
    throw new Error(`Missing ${env} API keys for user. Please configure them in Settings.`);
  }
  return keys;
};

export async function getUserApiKeys(userId, env = "testnet") {
  // Normalize / validate env
  if (env !== "mainnet" && env !== "testnet") {
    throw new Error(`Invalid env for keys: ${env}`);
  }

  const supabase = ensureSupabase();
  const { data, error } = await supabase
    .from("user_api_keys")
    .select("service, api_key")
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  const map = new Map();
  (data || []).forEach((row) => {
    if (row?.service) {
      map.set(row.service.toLowerCase(), row.api_key);
    }
  });

  const envBybitMainnetKey = process.env.BYBIT_MAINNET_API_KEY || process.env.BYBIT_API_KEY;
  const envBybitMainnetSecret = process.env.BYBIT_MAINNET_API_SECRET || process.env.BYBIT_API_SECRET;
  const envBybitTestnetKey = process.env.BYBIT_TESTNET_API_KEY || envBybitMainnetKey;
  const envBybitTestnetSecret = process.env.BYBIT_TESTNET_API_SECRET || envBybitMainnetSecret;

  // STRICT SELECTION
  if (env === "mainnet") {
    const mainnetKeys = {
      apiKey: map.get(SERVICE_BYBIT_MAINNET_KEY) ?? map.get(SERVICE_BYBIT_KEY) ?? envBybitMainnetKey,
      apiSecret: map.get(SERVICE_BYBIT_MAINNET_SECRET) ?? map.get(SERVICE_BYBIT_SECRET) ?? envBybitMainnetSecret
    };

    console.log(`[getUserApiKeys] Resolved MAINNET for ${userId}: ${mainnetKeys.apiKey ? "***" : "MISSING"}`);
    return requireKeys(mainnetKeys, "mainnet");
  }

  if (env === "testnet") {
    const testnetKeys = {
      apiKey: map.get(SERVICE_BYBIT_DEMO_KEY) ?? map.get(SERVICE_BYBIT_TESTNET_KEY) ?? map.get(SERVICE_BYBIT_KEY) ?? envBybitTestnetKey,
      apiSecret: map.get(SERVICE_BYBIT_DEMO_SECRET) ?? map.get(SERVICE_BYBIT_TESTNET_SECRET) ?? map.get(SERVICE_BYBIT_SECRET) ?? envBybitTestnetSecret
    };

    console.log(`[getUserApiKeys] Resolved DEMO for ${userId}: ${testnetKeys.apiKey ? "Explicit/Env" : "MISSING"}`);
    return requireKeys(testnetKeys, "testnet");
  }
}
