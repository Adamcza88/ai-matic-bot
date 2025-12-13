import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const missingSupabaseEnv = !supabaseUrl || !supabaseAnonKey;

if (missingSupabaseEnv) {
    console.error(
        "Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file."
    );
}

export const allowlistedEmails = (import.meta.env.VITE_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

export const supabase: SupabaseClient | null = missingSupabaseEnv
    ? null
    : createClient(supabaseUrl, supabaseAnonKey, {
          auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
          },
      });

export const supabaseReady = Boolean(supabase);

export function requireSupabaseClient(): SupabaseClient {
    if (!supabase) {
        throw new Error("Supabase client not configured. Check environment variables.");
    }
    return supabase;
}
