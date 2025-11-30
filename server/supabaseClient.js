import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const missingSupabaseEnv = !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY;
if (missingSupabaseEnv) {
  console.error(
    "Supabase env missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
  );
}

export const supabase = missingSupabaseEnv
  ? null
  : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export function ensureSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase client not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return supabase;
}
