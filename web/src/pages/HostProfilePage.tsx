import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, CarFront, ShieldCheck, Star, User } from 'lucide-react';
import { client } from '@/lib/client';
import { useBackToBrowse } from '@/lib/useBackToBrowse';
import { CarAvailabilityCard } from '@/components/CarAvailabilityCard';
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
            </div>
          </div>
        </CardBody>
      </Card>

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
