import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Star } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { readLocalWatchlist, writeLocalWatchlist } from '@/lib/watchlist';
import { toast } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * "Watch" (follow) a car — BaT-style. For a signed-in renter the watch lives
 * in the `watchlist` table, which is what makes it more than a bookmark: DB
 * triggers notify every watcher when the car comes back into service or the
 * trip on it ends, so you find out it's free without checking back. Renters
 * only — callers hide this for hosts and companies, and RLS refuses their
 * insert.
 *
 * Guests fall back to the old localStorage list (no account to notify), and
 * are told that signing in is what turns it into an alert.
 *
 * Two shapes, one piece of state: `variant="button"` is the labelled pill on
 * the car detail page; `variant="icon"` is the round bookmark overlay on a
 * ListingCard's photo — same toggle, same source of truth, so watching from
 * a grid card and un-watching from the detail page never disagree.
 */
export function WatchButton({
  id,
  variant = 'button',
  className,
}: {
  id: string;
  variant?: 'button' | 'icon';
  className?: string;
}) {
  const queryClient = useQueryClient();
  // Wait for the profile before deciding where the watch lives, so a fast
  // click doesn't get written to localStorage for someone who is in fact
  // signed in.
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const signedIn = !!me;

  const { data: watchedIds } = useQuery({
    queryKey: ['watchlist'],
    queryFn: () => client.listWatchlist(),
    enabled: signedIn,
  });

  const [localWatched, setLocalWatched] = useState(() => readLocalWatchlist().includes(id));
  const watched = signedIn ? (watchedIds ?? []).includes(id) : localWatched;

  const toggle = useMutation({
    mutationFn: async (next: boolean) => {
      if (!signedIn) {
        const list = new Set(readLocalWatchlist());
        if (next) list.add(id);
        else list.delete(id);
        writeLocalWatchlist([...list]);
        setLocalWatched(next);
        return;
      }
      if (next) await client.watchListing(id);
      else await client.unwatchListing(id);
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      await queryClient.invalidateQueries({ queryKey: ['watchedListings'] });
    },
    onSuccess: (_data, next) => {
      if (!next) return toast.success('Removed from your watchlist');
      toast.success(
        signedIn
          ? "Watching — we'll notify you when it's available"
          : 'Saved to your watchlist — sign in to be notified when it frees up',
      );
    },
    onError: () => toast.error('Could not update your watchlist'),
  });

  const title = watched ? "We'll tell you when this car is available" : 'Get told when this car frees up';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        // A card's photo is a <Link>'s child — without this the click bubbles
        // up and navigates to the car page instead of just toggling the save.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle.mutate(!watched);
        }}
        disabled={toggle.isPending || meLoading}
        aria-pressed={watched}
        title={title}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-ink-900 shadow-[var(--shadow-float)] backdrop-blur-sm transition-transform active:scale-95 disabled:opacity-60',
          className,
        )}
      >
        <Bookmark size={16} className={watched ? 'fill-current' : ''} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => toggle.mutate(!watched)}
      disabled={toggle.isPending || meLoading}
      aria-pressed={watched}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-2 text-body-sm font-medium transition-colors disabled:opacity-60',
        watched
          ? 'border-brand-300 bg-brand-50 text-brand-700'
          : 'border-[var(--color-line-strong)] text-[var(--color-content-muted)] hover:bg-[var(--color-surface-sunken)]',
        className,
      )}
    >
      <Star size={16} className={watched ? 'fill-brand-500 text-brand-500' : ''} />
      <span className="hidden sm:inline">{watched ? 'Watching' : 'Watch'}</span>
    </button>
  );
}
