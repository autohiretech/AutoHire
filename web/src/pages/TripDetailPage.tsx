import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarDays, Check, Clock, MapPin, Upload } from 'lucide-react';
import type { Booking, CheckPhoto, Host, Review, ReviewDirection } from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf } from '@/lib/format';
import { TRIP_STATE_META, TRIP_TIMELINE } from '@/lib/trips';
import { StarRatingInput } from '@/components/StarRatingInput';
import { LocationMap } from '@/components/map/LocationMap';
import { LocationLinks } from '@/components/map/LocationLinks';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Rating, Spinner } from '@/components/ui';

export function TripDetailPage() {
  const { id = '' } = useParams();
  const { data: me } = useCurrentUser();

  const bookingQuery = useQuery({
    queryKey: ['booking', id],
    queryFn: () => client.getBooking(id),
  });
  const booking = bookingQuery.data;

  const listingQuery = useQuery({
    queryKey: ['listing', booking?.listingId],
    queryFn: () => client.getListing(booking!.listingId),
    enabled: !!booking,
  });
  const hostQuery = useQuery({
    queryKey: ['host', booking?.hostId],
    queryFn: () => client.getHost(booking!.hostId),
    enabled: !!booking,
  });

  if (bookingQuery.isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={28} />
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Trip not found</p>
        <Link to="/trips" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to my trips
        </Link>
      </div>
    );
  }

  const listing = listingQuery.data;
  const host = hostQuery.data;
  const state = TRIP_STATE_META[booking.state];
  const isCancelled = booking.state === 'cancelled' || booking.state === 'declined';
  const currentStep = TRIP_TIMELINE.indexOf(booking.state);

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/trips"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> My trips
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink-900">{listing?.title ?? 'Trip'}</h1>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
        {listing && (
          <span className="flex items-center gap-1.5">
            <MapPin size={15} /> {listing.location}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <CalendarDays size={15} /> {formatDate(booking.startDate)} – {formatDate(booking.endDate)}
          <span className="text-ink-400">· {booking.days} day{booking.days === 1 ? '' : 's'}</span>
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {listing && (
            <img
              src={listing.photos[0]}
              alt={listing.title}
              className="h-56 w-full rounded-[var(--radius-card)] object-cover"
            />
          )}

          {/* Timeline */}
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">Trip progress</h2>
            </CardHeader>
            <CardBody>
              {isCancelled ? (
                <p className="text-sm text-ink-500">
                  This trip was {state.label.toLowerCase()}.
                </p>
              ) : (
                <ol className="space-y-4">
                  {TRIP_TIMELINE.map((step, i) => {
                    const done = i < currentStep;
                    const current = i === currentStep;
                    return (
                      <li key={step} className="flex items-center gap-3">
                        <span
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs',
                            done && 'border-brand-600 bg-brand-600 text-white',
                            current && 'border-brand-600 text-brand-700',
                            !done && !current && 'border-ink-200 text-ink-400',
                          )}
                        >
                          {done ? <Check size={14} /> : i + 1}
                        </span>
                        <span
                          className={cn(
                            'text-sm',
                            current ? 'font-medium text-ink-900' : 'text-ink-600',
                          )}
                        >
                          {TRIP_STATE_META[step].label}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardBody>
          </Card>

          {/* Two-sided handoff — both renter and host sign off with proof. */}
          {!isCancelled && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <HandoffPanel booking={booking} phase="pickup" meId={me?.id} />
              <HandoffPanel booking={booking} phase="return" meId={me?.id} />
            </div>
          )}

          {/* Pickup location */}
          {listing && ((listing.lat != null && listing.lng != null) || listing.locationUrl) && (
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
                <LocationLinks url={listing.locationUrl} lat={listing.lat} lng={listing.lng} />
              </CardBody>
            </Card>
          )}

          <TripReviews booking={booking} host={host} />
        </div>

        {/* Summary sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">Price details</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <Row label={`${formatRwf(listing?.pricePerDayRwf ?? 0)} × ${booking.days} days`} value={formatRwf(booking.subtotalRwf)} />
              <Row label="Service fee" value={formatRwf(booking.serviceFeeRwf)} />
              <div className="border-t border-ink-100 pt-2">
                <Row label="Total" value={formatRwf(booking.totalRwf)} strong />
              </div>
            </CardBody>
          </Card>

          {host && (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-ink-900">Your host</h2>
              </CardHeader>
              <CardBody className="flex items-center gap-3">
                <Avatar name={host.businessName ?? host.fullName} src={host.avatarUrl} />
                <div>
                  <p className="font-medium text-ink-900">{host.businessName ?? host.fullName}</p>
                  <p className="text-sm text-ink-500">
                    {host.ownerType === 'business' ? 'Business host' : 'Individual host'}
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between', strong ? 'font-semibold text-ink-900' : 'text-ink-600')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** A small confirmed/pending row for one party's handoff sign-off. */
function SignOffRow({ who, at }: { who: string; at?: string | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-600">{who}</span>
      {at ? (
        <span className="flex items-center gap-1 font-medium text-emerald-700">
          <Check size={14} /> Confirmed {formatDate(at)}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-ink-400">
          <Clock size={14} /> Pending
        </span>
      )}
    </div>
  );
}

/**
 * One handoff phase (pickup or return). Both the renter and host must confirm
 * with proof photos; the trip only advances when both have signed off. The
 * current user can confirm their own side while the phase is open.
 */
function HandoffPanel({
  booking,
  phase,
  meId,
}: {
  booking: Booking;
  phase: 'pickup' | 'return';
  meId?: string;
}) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRenter = meId === booking.renterId;
  const isHost = meId === booking.hostId;
  const renterAt = phase === 'pickup' ? booking.pickupRenterAt : booking.returnRenterAt;
  const hostAt = phase === 'pickup' ? booking.pickupHostAt : booking.returnHostAt;
  const photos: CheckPhoto[] = (phase === 'pickup' ? booking.checkIn : booking.checkOut) ?? [];
  const title = phase === 'pickup' ? 'Pickup handoff' : 'Return handoff';

  const phaseOpen =
    phase === 'pickup'
      ? booking.state === 'confirmed' || booking.state === 'pickup'
      : booking.state === 'active' || booking.state === 'return';
  const notYet = phase === 'pickup' ? booking.state === 'requested' : !phaseOpen && !renterAt && !hostAt;
  const myDone = (isRenter && !!renterAt) || (isHost && !!hostAt);
  const bothDone = !!renterAt && !!hostAt;
  const canConfirm = phaseOpen && (isRenter || isHost) && !myDone;

  async function confirm() {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const urls = await client.uploadPhotos(files);
      await client.confirmHandoff(booking.id, phase, urls);
      queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      queryClient.invalidateQueries({ queryKey: ['ownerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm the handoff.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {bothDone && (
          <Badge tone="success">
            <Check size={12} /> Both confirmed
          </Badge>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="space-y-1.5">
          <SignOffRow who="Renter" at={renterAt} />
          <SignOffRow who="Host" at={hostAt} />
        </div>

        {photos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <img
                key={p.url}
                src={p.url}
                alt={p.label}
                className="h-16 w-full rounded-lg border border-ink-100 object-cover"
              />
            ))}
          </div>
        )}

        {notYet && (
          <p className="text-xs text-ink-500">
            {phase === 'pickup'
              ? 'Available once the host confirms the booking.'
              : 'Available once the trip is active.'}
          </p>
        )}

        {myDone && !bothDone && (
          <p className="text-xs text-ink-500">
            You've confirmed — waiting for the other party.
          </p>
        )}

        {canConfirm && (
          <div className="space-y-2 rounded-lg bg-ink-50 p-3">
            <p className="text-xs font-medium text-ink-700">
              Confirm your side with proof photos:
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="block w-full text-xs text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-brand-700"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              size="sm"
              className="w-full"
              disabled={busy || files.length === 0}
              onClick={confirm}
            >
              <Upload size={14} />
              {busy ? 'Confirming…' : `Confirm ${phase} (${files.length} photo${files.length === 1 ? '' : 's'})`}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Two-way reviews for a completed trip. The form direction follows the current
 * app mode: in Renting mode you review the host, in Hosting mode you review the
 * renter. Shows both submitted reviews once they exist.
 */
function TripReviews({ booking, host }: { booking: Booking; host?: Host }) {
  const { data: me } = useCurrentUser();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');

  // Eligibility follows actual participation in THIS booking, not the app mode:
  // the renter reviews the host, the host reviews the renter, nobody else.
  const myId = me?.id;
  const isRenter = !!myId && myId === booking.renterId;
  const isHost = !!myId && myId === booking.hostId;
  const canReview = isRenter || isHost;
  const direction: ReviewDirection = isHost ? 'host_to_renter' : 'renter_to_host';
  const hostName = host?.businessName ?? host?.fullName ?? 'Host';
  const renterName = isRenter ? me?.fullName ?? 'You' : 'the renter';
  const subjectName = direction === 'renter_to_host' ? hostName : renterName;

  const { data: reviews } = useQuery({
    queryKey: ['bookingReviews', booking.id],
    queryFn: () => client.listReviewsForBooking(booking.id),
  });

  const mine = reviews?.find((r) => r.direction === direction);
  const completed = booking.state === 'completed';

  const mutation = useMutation({
    mutationFn: () => client.createReview({ bookingId: booking.id, direction, rating, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookingReviews', booking.id] });
      queryClient.invalidateQueries({ queryKey: ['reviews'] });
      setRating(0);
      setBody('');
    },
  });

  function authorName(review: Review): string {
    if (review.authorId === myId) return 'You';
    return review.direction === 'renter_to_host' ? renterName : hostName;
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-ink-900">Reviews</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* Existing reviews */}
        {reviews && reviews.length > 0 && (
          <ul className="space-y-4">
            {reviews.map((r) => (
              <li key={r.id} className="border-b border-ink-100 pb-4 last:border-0 last:pb-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink-900">{authorName(r)}</span>
                  <Rating value={r.rating} />
                </div>
                <p className="mt-1 text-sm text-ink-700">{r.body}</p>
                <p className="mt-1 text-xs text-ink-400">{formatDate(r.createdAt)}</p>
              </li>
            ))}
          </ul>
        )}

        {/* Compose / status — only the renter or host of this trip can review. */}
        {!canReview ? (
          reviews && reviews.length > 0 ? null : (
            <p className="text-sm text-ink-500">No reviews yet.</p>
          )
        ) : !completed ? (
          <p className="text-sm text-ink-500">
            You can leave a review once the trip is completed.
          </p>
        ) : mine ? (
          reviews && reviews.length === 1 ? (
            <p className="text-sm text-ink-500">Thanks for your review.</p>
          ) : null
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rating > 0 && body.trim()) mutation.mutate();
            }}
            className="space-y-3 rounded-lg bg-ink-50 p-3"
          >
            <p className="text-sm font-medium text-ink-700">Review {subjectName}</p>
            <StarRatingInput value={rating} onChange={setRating} />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="How was the experience?"
              className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
            <Button type="submit" size="sm" disabled={rating === 0 || !body.trim() || mutation.isPending}>
              {mutation.isPending ? 'Submitting…' : 'Submit review'}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
