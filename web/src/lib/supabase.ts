import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazily-created Supabase client (anon key, RLS-guarded — browser-safe).
 *
 * Created on first use (so env is only required when something actually talks to
 * the backend). The `supabaseClient` data layer and `AuthProvider` call
 * `getSupabase()` to reach the project.
 */
let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env missing: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env',
    );
  }

  cached = createClient(url, anonKey);
  return cached;
}
