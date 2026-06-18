import { mockClient, type MockClient } from '@/mocks/client';
import { supabaseClient } from '@/lib/supabaseClient';

/**
 * The single data-access contract every screen uses.
 *
 * Stage A: this resolves to `mockClient` (hardcoded data, no network).
 * Stage B: a Supabase-backed implementation with these same method signatures
 * is added, and `VITE_USE_MOCK` selects which one runs. The mock stays
 * selectable for offline/demo/dev for as long as we want — see ROADMAP Stage B.
 *
 * Screens import `client` (never `mockClient` directly), so swapping the
 * implementation is a change to this one module.
 */
export type Client = MockClient;

/** Default to mock; only an explicit `VITE_USE_MOCK=false` opts into the real client. */
const useMock = import.meta.env.VITE_USE_MOCK !== 'false';

function resolveClient(): Client {
  if (useMock) return mockClient;
  // Lazily required so the mock-only bundle never needs Supabase env.
  return supabaseClient;
}

export const client: Client = resolveClient();
