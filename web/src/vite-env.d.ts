/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase anon/public key (browser-safe, guarded by RLS). */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Stripe publishable key (pk_test_… / pk_live_…). */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
