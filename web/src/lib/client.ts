import { supabaseClient } from '@/lib/supabaseClient';

/**
 * The single data-access contract every screen uses. The app is Supabase-only:
 * `supabaseClient` is the canonical implementation, and `Client` is its shape.
 * Screens import `client` (never `supabaseClient` directly), so the backing
 * implementation stays swappable behind one module.
 */
export type Client = typeof supabaseClient;

export const client: Client = supabaseClient;
