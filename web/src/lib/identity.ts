/**
 * Current logged-in identity for the Supabase client.
 *
 * The data client (`supabaseClient`) needs the acting user's id synchronously
 * inside its methods, but Supabase only exposes the session asynchronously.
 * `AuthProvider` pushes the auth `uid` here whenever the session changes, and
 * the client reads it back. In mock/offline mode this is never set (the mock
 * client carries its own demo identity).
 *
 * Under the "fresh signups start empty" model the logged-in user is a single
 * identity that acts as renter or host depending on app mode — so the same
 * `uid` backs both the renter and host views (no separate host constant).
 */
let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

/** The acting user's id, or throw if no session is established. */
export function getCurrentUserId(): string {
  if (!currentUserId) {
    throw new Error('No authenticated user — sign in before accessing data.');
  }
  return currentUserId;
}
