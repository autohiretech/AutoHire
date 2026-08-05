/**
 * Guest watchlist — the cars someone starred before they had an account.
 *
 * A signed-in watch lives in the `watchlist` table, which is what makes it more
 * than a bookmark: DB triggers notify every watcher when the car frees up.
 * Guests have no account to notify, so theirs stay in this browser until they
 * sign in. Shared by the Watch button and the Watching page so both read and
 * write the same key.
 */
const WATCH_KEY = 'autohire.watchlist';

export function readLocalWatchlist(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeLocalWatchlist(ids: string[]): void {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify(ids));
  } catch {
    /* storage disabled (private mode, quota) — the UI still reflects the click */
  }
}
