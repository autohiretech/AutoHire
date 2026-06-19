import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  CalendarX,
  Check,
  Cog,
  Fuel,
  MapPin,
  MessageSquare,
  Star,
  User,
  Users,
} from 'lucide-react';
import type { Listing } from '@autohire/shared';
import { client } from '@/lib/client';
import { useIsHost } from '@/lib/account';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { formatDate, formatRwf } from '@/lib/format';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Rating, Spinner } from '@/components/ui';
import { LocationMap } from '@/components/map/LocationMap';
import { LocationLinks } from '@/components/map/LocationLinks';

export function CarDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [activePhoto, setActivePhoto] = useState(0);
  const [messaging, setMessaging] = useState(false);
  const isHost = useIsHost();
  const { data: me } = useCurrentUser();

  const { data: listing, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => client.getListing(id),
  });

  const hostQuery = useQuery({
    queryKey: ['host', listing?.hostId],
    queryFn: () => client.getHost(listing!.hostId),
    enabled: !!listing,
  });
  const reviewsQuery = useQuery({
    queryKey: ['reviews', listing?.hostId],
    queryFn: () => client.listReviews(listing!.hostId),
    enabled: !!listing,
  });
  const bookedQuery = useQuery({
    queryKey: ['bookedRanges', id],
    queryFn: () => client.getBookedRanges(id),
    enabled: !!listing,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Car not found</p>
        <Link to="/" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to browse
        </Link>
      </div>
    );
  }

  const host = hostQuery.data;
  const reviews = reviewsQuery.data ?? [];
  const instant = listing.bookingMode === 'instant';
  // You can message the host unless you ARE the host or you're in host mode.
  const canMessage = !isHost && !!me && me.id !== listing.hostId;

  async function messageHost() {
    if (!listing) return;
    setMessaging(true);
    try {
      const conv = await client.getOrCreateConversation(listing.id, me!.id, listing.hostId);
      navigate(`/messages/${conv.id}`);
    } finally {
      setMessaging(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back to browse
      </Link>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">{listing.title}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
            <MapPin size={15} /> {listing.location}
          </p>
        </div>
        <Rating value={listing.ratingAvg} count={listing.ratingCount} size={16} />
      </div>

      {/* Gallery */}
      <div className="mt-5">
        <img
          src={listing.photos[activePhoto]}
          alt={listing.title}
          className="h-64 w-full rounded-[var(--radius-card)] object-cover sm:h-96"
        />
        {listing.photos.length > 1 && (
          <div className="mt-3 flex gap-3">
            {listing.photos.map((photo, i) => (
              <button
                key={photo}
                type="button"
                onClick={() => setActivePhoto(i)}
                className={
                  'h-16 w-24 overflow-hidden rounded-lg border-2 transition-colors ' +
                  (i === activePhoto ? 'border-brand-600' : 'border-transparent hover:border-ink-300')
                }
              >
                <img src={photo} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Specs */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">Vehicle details</h2>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Spec icon={<Users size={18} />} label="Seats" value={`${listing.seats}`} />
                <Spec
                  icon={<Cog size={18} />}
                  label="Transmission"
                  value={listing.transmission}
                />
                <Spec icon={<Fuel size={18} />} label="Fuel" value={listing.fuel} />
                <Spec icon={<Star size={18} />} label="Type" value={listing.category} />
              </div>
              <p className="mt-4 text-sm text-ink-600">
                {listing.year} {listing.make} {listing.model}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {listing.features.map((f) => (
                  <span
                    key={f}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-ink-50 px-2.5 py-1 text-sm text-ink-700"
                  >
                    <Check size={14} className="text-brand-600" /> {f}
                  </span>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Pickup location */}
          {(listing.lat != null && listing.lng != null) || listing.locationUrl ? (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-ink-900">Pickup location</h2>
              </CardHeader>
              <CardBody className="space-y-3">
                <p className="flex items-center gap-1.5 text-sm text-ink-600">
                  <MapPin size={15} className="text-brand-600" /> {listing.location}
                </p>
                {listing.lat != null && listing.lng != null && (
                  <LocationMap lat={listing.lat} lng={listing.lng} />
                )}
                <LocationLinks
                  url={listing.locationUrl}
                  lat={listing.lat}
                  lng={listing.lng}
                />
              </CardBody>
            </Card>
          ) : null}

          {/* Host */}
          {host && (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-ink-900">Hosted by</h2>
              </CardHeader>
              <CardBody className="flex items-center gap-4">
                <Avatar name={host.businessName ?? host.fullName} src={host.avatarUrl} size="lg" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink-900">{host.businessName ?? host.fullName}</p>
                    <Badge tone={host.ownerType === 'business' ? 'accent' : 'brand'}>
                      {host.ownerType === 'business' ? (
                        <>
                          <Building2 size={12} /> Business
                        </>
                      ) : (
                        <>
                          <User size={12} /> Individual
                        </>
                      )}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-ink-500">
                    {host.vehicleCount} vehicle{host.vehicleCount === 1 ? '' : 's'} · joined{' '}
                    {formatDate(host.joinedAt)}
                  </p>
                </div>
                {host.ratingAvg !== undefined && (
                  <Rating value={host.ratingAvg} count={host.ratingCount} />
                )}
              </CardBody>
            </Card>
          )}

          {/* Reviews */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">
                Reviews {reviews.length > 0 && <span className="text-ink-400">({reviews.length})</span>}
              </h2>
            </CardHeader>
            <CardBody>
              {reviewsQuery.isLoading ? (
                <Spinner size={20} />
              ) : reviews.length === 0 ? (
                <p className="text-sm text-ink-500">No reviews yet.</p>
              ) : (
                <ul className="space-y-4">
                  {reviews.map((r) => (
                    <li key={r.id} className="border-b border-ink-100 pb-4 last:border-0 last:pb-0">
                      <Rating value={r.rating} />
                      <p className="mt-1 text-sm text-ink-700">{r.body}</p>
                      <p className="mt-1 text-xs text-ink-400">{formatDate(r.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Booking sidebar */}
        <div className="space-y-6">
          <Card className="lg:sticky lg:top-20">
            <CardBody className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-ink-900">
                  {formatRwf(listing.pricePerDayRwf)}
                </span>
                <span className="text-sm text-ink-500">/ day</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={instant ? 'success' : 'neutral'}>
                  {instant ? 'Instant book' : 'Request to book'}
                </Badge>
                {listing.status === 'maintenance' && (
                  <Badge tone="warning">
                    In maintenance
                    {listing.maintenanceUntil ? ` · back ${formatDate(listing.maintenanceUntil)}` : ''}
                  </Badge>
                )}
              </div>
              {isHost ? (
                <p className="rounded-lg bg-ink-50 p-3 text-center text-sm text-ink-500">
                  You're viewing as a host — booking is off. Switch to renting in your{' '}
                  <Link to="/account" className="text-brand-600 hover:underline">
                    profile
                  </Link>{' '}
                  to book.
                </p>
              ) : (
                <>
                  <Link to={`/cars/${listing.id}/book`} className="block">
                    <Button className="w-full" size="lg">
                      {instant ? 'Book now' : 'Request to book'}
                    </Button>
                  </Link>
                  <p className="text-center text-xs text-ink-400">You won't be charged yet</p>
                </>
              )}
              {canMessage && (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={messaging}
                  onClick={messageHost}
                >
                  <MessageSquare size={16} />
                  {messaging ? 'Opening…' : 'Message host'}
                </Button>
              )}
            </CardBody>
          </Card>

          <Availability listing={listing} bookedRanges={bookedQuery.data ?? []} />
        </div>
      </div>
    </section>
  );
}

function Spec({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <span className="text-ink-400">{icon}</span>
      <p className="mt-1 text-xs text-ink-500">{label}</p>
      <p className="font-medium capitalize text-ink-900">{value}</p>
    </div>
  );
}

function Availability({
  listing,
  bookedRanges,
}: {
  listing: Listing;
  bookedRanges: { startDate: string; endDate: string }[];
}) {
  const { blockedDates } = listing;
  const maintenance = listing.status === 'maintenance';
  const allClear = !maintenance && blockedDates.length === 0 && bookedRanges.length === 0;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-ink-900">Availability</h2>
      </CardHeader>
      <CardBody className="space-y-3">
        {maintenance && (
          <p className="flex items-center gap-1.5 text-sm text-orange-700">
            <CalendarX size={15} /> In maintenance
            {listing.maintenanceUntil ? ` — available from ${formatDate(listing.maintenanceUntil)}` : ''}.
          </p>
        )}

        {allClear && (
          <p className="flex items-center gap-1.5 text-sm text-ink-600">
            <Check size={15} className="text-brand-600" /> Available on all upcoming dates.
          </p>
        )}

        {bookedRanges.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm text-ink-600">
              <CalendarX size={15} className="text-ink-400" /> Booked:
            </p>
            <div className="flex flex-wrap gap-2">
              {bookedRanges.map((r) => (
                <Badge key={`${r.startDate}-${r.endDate}`} tone="neutral">
                  {formatDate(r.startDate)} – {formatDate(r.endDate)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {blockedDates.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm text-ink-600">
              <CalendarX size={15} className="text-ink-400" /> Unavailable on:
            </p>
            <div className="flex flex-wrap gap-2">
              {blockedDates.map((d) => (
                <Badge key={d} tone="neutral">
                  {formatDate(d)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
