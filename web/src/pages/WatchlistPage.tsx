import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Star, Wrench } from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useCanRent } from '@/lib/account';
import { formatDate } from '@/lib/format';
import { readLocalWatchlist, writeLocalWatchlist } from '@/lib/watchlist';
import { ListingCard } from '@/components/ListingCard';
import { Badge, Button, Card, CardBody, Spinner, toast } from '@/components/ui';

/**
 * "Watching" — the cars this renter has starred. A watch subscribes you to a
 * notification when the car comes back into service or the trip on it ends, so
 * this page is the standing view of what you're waiting on.
 *
 * Renters only: a watch says "tell me when I can book this", which host and
 * company accounts can never act on. Guests get here too — they're prospective
 * renters — but have no account to notify, so their watches stay in
 * localStorage and this page renders those with a prompt to sign in.
 */
export function WatchlistPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const canRent = useCanRent();
  const signedIn = !!me;

  const serverQuery = useQuery({
    queryKey: ['watchedListings'],
    queryFn: () => client.listWatchedListings(),
    enabled: signedIn && canRent,
  });

  // Guests: resolve the ids they saved in the browser, one listing each.
  const localIds = signedIn ? [] : readLocalWatchlist();
  const localQueries = useQueries({
    queries: localIds.map((id) => ({
      queryKey: ['listing', id],
      queryFn: () => client.getListing(id),
    })),
  });

  const listings: Listing[] = signedIn
    ? serverQuery.data ?? []
    : localQueries.map((q) => q.data).filter((l): l is Listing => !!l);
  const isLoading = meLoading || (signedIn ? serverQuery.isLoading : localQueries.some((q) => q.isLoading));

  const unwatch = useMutation({
    mutationFn: async (id: string) => {
      if (!signedIn) {
        writeLocalWatchlist(readLocalWatchlist().filter((x) => x !== id));
        return;
      }
      await client.unwatchListing(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['watchedListings'] });
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      toast.success('Removed from your watchlist');
    },
    onError: () => toast.error('Could not update your watchlist'),
  });

  // Hosts and companies can't book, so there is nothing for a watch to tell
  // them. Their old watches (from before they became a host) are left in the
  // table; they simply have no page for them.
  if (!canRent && !meLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Watching is for renter accounts</p>
        <p className="mt-1 text-sm text-ink-500">
          A watch tells you when a car is free to book, which host and company accounts can't do.
        </p>
        <Link to="/" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to browse
        </Link>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">Watching</h1>
          <p className="mt-1 text-sm text-ink-500">
            {signedIn
              ? "We'll notify you the moment one of these frees up."
              : 'Saved in this browser. Sign in to be notified when one frees up.'}
          </p>
        </div>
        {listings.length > 0 && (
          <span className="text-sm text-ink-500">
            {listings.length} car{listings.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {!signedIn && !meLoading && listings.length > 0 && (
        <Card className="mb-6 border-brand-200 bg-brand-50">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="flex items-center gap-2 text-sm text-ink-700">
              <Bell size={16} className="shrink-0 text-brand-600" />
              Alerts need an account — these watches only live in this browser.
            </p>
            <Link to="/login">
              <Button size="sm">Sign in</Button>
            </Link>
          </CardBody>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : listings.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <Star size={32} className="text-ink-300" />
            <div>
              <p className="font-medium text-ink-900">You're not watching any cars</p>
              <p className="mt-1 text-sm text-ink-500">
                Hit <span className="font-medium text-ink-700">Watch</span> on a car and we'll tell
                you when it's available.
              </p>
            </div>
            <Link to="/">
              <Button size="sm">Explore listings</Button>
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => (
            <div key={listing.id} className="flex flex-col gap-2">
              <ListingCard listing={listing} />
              <div className="flex items-center justify-between gap-2 px-1">
                {listing.status === 'maintenance' ? (
                  <Badge tone="warning">
                    <Wrench size={12} /> In maintenance
                    {listing.maintenanceUntil ? ` · back ${formatDate(listing.maintenanceUntil)}` : ''}
                  </Badge>
                ) : (
                  <Badge tone="success">Available</Badge>
                )}
                <button
                  type="button"
                  onClick={() => unwatch.mutate(listing.id)}
                  disabled={unwatch.isPending}
                  className="text-sm font-medium text-ink-500 hover:text-ink-800 disabled:opacity-50"
                >
                  Unwatch
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
