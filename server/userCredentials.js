import { supabase } from "./supabaseClient.js";

const SERVICE_BYBIT_KEY = "bybit api key";
const SERVICE_BYBIT_SECRET = "bybit api secret";
const SERVICE_CRYPTOPANIC_KEY = "cryptopanic api key";

export async function getUserFromToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error) throw new Error(error.message || "Failed to validate user token");
  if (!data?.user) throw new Error("User not found for provided token");
  return data.user;
}

export async function getUserApiKeys(userId) {
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

  return {
    bybitKey: map.get(SERVICE_BYBIT_KEY),
    bybitSecret: map.get(SERVICE_BYBIT_SECRET),
    cryptopanicKey: map.get(SERVICE_CRYPTOPANIC_KEY),
  };
}
