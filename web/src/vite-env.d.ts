/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "false" to run against the real (Supabase) client instead of the mock. */
  readonly VITE_USE_MOCK?: string;
  /** Supabase project URL. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key (browser-safe, guarded by RLS). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
