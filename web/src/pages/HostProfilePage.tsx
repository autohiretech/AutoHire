import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, CarFront, Megaphone, ShieldCheck, Star, User } from 'lucide-react';
import { client } from '@/lib/client';
import { useBackToBrowse } from '@/lib/useBackToBrowse';
import { formatDate } from '@/lib/format';
import { CarAvailabilityCard } from '@/components/CarAvailabilityCard';
import { FollowButton } from '@/components/FollowButton';
import { Img } from '@/components/Img';
import { Avatar, Badge, Card, CardBody, Spinner } from '@/components/ui';

/** "Member since May 2025" from the ISO join date. */
function memberSince(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Public host profile: who they are, the cars they list, and each car's live
 * availability. Reached from the Hosts tab and from a car's "hosted by" line.
 */
export function HostProfilePage() {
  const { id = '' } = useParams();
  const backToBrowse = useBackToBrowse();

  const hostQuery = useQuery({ queryKey: ['host', id], queryFn: () => client.getHost(id) });
  const listingsQuery = useQuery({
    queryKey: ['hostListings', id],
    queryFn: () => client.listUserListings(id),
  });
  const broadcastsQuery = useQuery({
    queryKey: ['hostBroadcasts', id],
    queryFn: () => client.listHostBroadcasts(id),
    enabled: !!id,
  });
  const followersQuery = useQuery({
    queryKey: ['followers', id],
    queryFn: () => client.listFollowers(id),
    enabled: !!id,
  });

  const host = hostQuery.data;
  const listings = listingsQuery.data ?? [];

  if (hostQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  if (!host) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Host not found</p>
        <button
          type="button"
          onClick={backToBrowse}
          className="mt-3 inline-block text-sm text-brand-600 hover:underline"
        >
          Back to browse
        </button>
      </div>
    );
  }

  const isBusiness = host.ownerType === 'business';
  const name = host.businessName || host.fullName;
  const since = memberSince(host.joinedAt);
  const verified = host.verification === 'verified';

  return (
    <section className="mx-auto max-w-6xl px-4 py-6">
      <button
        type="button"
        onClick={backToBrowse}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back to browse
      </button>

      {/* Header */}
      <Card>
        <CardBody className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Avatar name={name} src={host.avatarUrl} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-ink-900">{name}</h1>
              {verified && (
                <Badge tone="brand">
                  <ShieldCheck size={12} /> Verified
                </Badge>
              )}
            </div>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-500">
              {isBusiness ? <Building2 size={14} /> : <User size={14} />}
              {isBusiness ? 'Business host' : 'Individual host'}
              {since && <span className="text-ink-300">·</span>}
              {since && <span>Since {since}</span>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-600">
              <span className="inline-flex items-center gap-1">
                <Star size={14} className="fill-accent-500 text-accent-500" />
                {host.ratingCount ? (
                  <>
                    <span className="font-semibold text-ink-900">{host.ratingAvg?.toFixed(1)}</span>
                    <span className="text-ink-400">({host.ratingCount})</span>
                  </>
                ) : (
                  <span className="text-ink-500">New host</span>
                )}
              </span>
              <span className="inline-flex items-center gap-1">
                <CarFront size={14} className="text-ink-400" />
                {host.vehicleCount} {host.vehicleCount === 1 ? 'vehicle' : 'vehicles'}
              </span>
              {!followersQuery.isLoading && (
                <span className="text-ink-500">
                  <span className="font-semibold text-ink-900">{followersQuery.data?.length ?? 0}</span>{' '}
                  {followersQuery.data?.length === 1 ? 'follower' : 'followers'}
                </span>
              )}
            </div>
          </div>
          <FollowButton profileId={host.id} />
        </CardBody>
      </Card>

      {/* Updates — un-anchored broadcasts (migration 067), never styled like a
          verified trip post: nothing here is checked against a real booking. */}
      {!broadcastsQuery.isLoading && (broadcastsQuery.data ?? []).length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 flex items-center gap-1.5 text-lg font-semibold text-ink-900">
            <Megaphone size={17} className="text-accent-600" /> Updates
          </h2>
          <div className="flex flex-col gap-3">
            {(broadcastsQuery.data ?? []).map((b) => (
              <Card key={b.id} className="border-accent-200 bg-accent-50/30">
                <CardBody className="flex items-center gap-3">
                  {b.listing && (
                    <Img
                      src={b.listing.photos[0]}
                      alt={b.listing.title}
                      className="h-12 w-16 shrink-0 rounded-md object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-700">{b.body}</p>
                    <p className="mt-0.5 text-xs text-ink-400">{formatDate(b.createdAt)}</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Cars + availability */}
      <div className="mt-6">
        <h2 className="mb-3 text-lg font-semibold text-ink-900">
          {isBusiness ? 'Fleet' : 'Cars'}{' '}
          <span className="font-normal text-ink-400">
            {listingsQuery.isLoading ? '' : `· ${listings.length}`}
          </span>
        </h2>

        {listingsQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size={24} />
          </div>
        ) : listings.length === 0 ? (
          <Card>
            <CardBody className="flex flex-col items-center gap-2 py-14 text-center text-ink-500">
              <CarFront size={26} className="text-ink-300" />
              <p className="text-sm">This host has no cars listed right now.</p>
            </CardBody>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {listings.map((l) => (
              <CarAvailabilityCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
