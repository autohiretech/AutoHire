import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  CalendarDays,
  Check,
  Clock,
  Globe,
  Lock,
  MapPin,
  MessageSquare,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { Booking, CheckPhoto, Host, PostVisibility, Review, ReviewDirection } from '@autohire/shared';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { cn } from '@/lib/cn';
import { formatDate, formatRwf, formatTime } from '@/lib/format';
import { TRIP_STATE_META, TRIP_TIMELINE } from '@/lib/trips';
import { StarRatingInput } from '@/components/StarRatingInput';
import { CameraCapture } from '@/components/CameraCapture';
import { Img } from '@/components/Img';
import { LocationMap } from '@/components/map/LocationMap';
import { LocationLinks } from '@/components/map/LocationLinks';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, Input, Rating, Spinner, toast } from '@/components/ui';

export function TripDetailPage() {
  const { id = '' } = useParams();
  const { data: me } = useCurrentUser();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);
  // A PayHold refund isn't instant — booking.state only flips to 'cancelled'
  // once the refund.succeeded webhook lands, which can be seconds away. Without
  // this, the button stays up and a second tap lands on "This booking cannot be
  // cancelled" from the server, which reads as a failure when the first click
  // actually worked. Reset on navigating to a different trip, since this
  // component can be reused across route changes.
  const [cancelRequested, setCancelRequested] = useState(false);
  useEffect(() => setCancelRequested(false), [id]);

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

  const queryClient = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: () => client.cancelBooking(booking!.id),
    onSuccess: (result) => {
      // A PayHold refund isn't instant — the booking's own state only moves
      // to `cancelled` once the `refund.succeeded` webhook lands, so a
      // pending result is not the same thing as "nothing happened here" and
      // gets said as such rather than looking identical to a no-op.
      toast.success(
        result.pending
          ? (result.message ?? "Refund on its way — this trip updates once it lands.")
          : 'Booking cancelled.',
      );
      setCancelRequested(true);
      queryClient.invalidateQueries({ queryKey: ['booking', booking!.id] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['ownerBookings'] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Could not cancel this booking.');
    },
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
  const isActuallyCancelled = booking.state === 'cancelled' || booking.state === 'declined';
  // Requested but the server hasn't caught up yet — PayHold's webhook is what
  // actually flips booking.state, a moment after the request that started it.
  const isCancelling = cancelRequested && !isActuallyCancelled;
  const isCancelled = isActuallyCancelled || isCancelling;
  const state = isCancelling ? { label: 'Cancelling…', tone: 'danger' as const } : TRIP_STATE_META[booking.state];
  const currentStep = TRIP_TIMELINE.indexOf(booking.state);
  const amHost = me?.id === booking.hostId;
  const isParticipant = me?.id === booking.renterId || amHost;
  // Renter cancels before the trip starts; host cancels a confirmed/pickup trip.
  const canCancel =
    !cancelRequested &&
    (amHost
      ? ['confirmed', 'pickup'].includes(booking.state)
      : me?.id === booking.renterId && ['requested', 'confirmed'].includes(booking.state));

  function onCancel() {
    if (window.confirm('Cancel this booking? The renter will be refunded and the dates freed.')) {
      cancelMutation.mutate();
    }
  }

  async function messageOther() {
    setMessaging(true);
    try {
      const conv = await client.getOrCreateConversation(
        booking!.listingId,
        booking!.renterId,
        booking!.hostId,
      );
      navigate(`/messages/${conv.id}`);
    } finally {
      setMessaging(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-8">
      <Link
        to={amHost ? '/dashboard' : '/trips'}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> {amHost ? 'Dashboard' : 'My trips'}
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-ink-900">{listing?.title ?? 'Trip'}</h1>
        <div className="flex items-center gap-2">
          {isParticipant && (
            <Button variant="outline" size="sm" disabled={messaging} onClick={messageOther}>
              <MessageSquare size={15} />
              {messaging ? 'Opening…' : amHost ? 'Message renter' : 'Message host'}
            </Button>
          )}
          {canCancel && (
            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-700 hover:bg-red-50"
              disabled={cancelMutation.isPending}
              onClick={onCancel}
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel & refund'}
            </Button>
          )}
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
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
            <Img
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
              {isCancelling ? (
                <p className="text-sm text-ink-500">
                  Cancellation requested — the refund is on its way. This page updates once
                  PayHold confirms it landed.
                </p>
              ) : isCancelled ? (
                <p className="text-sm text-ink-500">
                  This trip was {TRIP_STATE_META[booking.state].label.toLowerCase()}.
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

          {/* The timer starts the moment both sides confirm pickup — shows
              when, and the limit before a late-return charge (daily) or just
              the estimate (hourly, which bills actual time regardless). */}
          {!isCancelled && <TripTimer booking={booking} />}

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
          <TripPostComposer booking={booking} />
        </div>

        {/* Summary sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">Price details</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              {booking.rentalType === 'hourly' ? (
                <Row
                  label={`${formatRwf(booking.pricePerHourRwf ?? 0)} × ${booking.estimatedHours ?? '?'} hrs (estimate)`}
                  value={formatRwf(booking.subtotalRwf)}
                />
              ) : (
                <Row label={`${formatRwf(listing?.pricePerDayRwf ?? 0)} × ${booking.days} days`} value={formatRwf(booking.subtotalRwf)} />
              )}
              <Row label="Service fee" value={formatRwf(booking.serviceFeeRwf)} />
              <div className="border-t border-ink-100 pt-2">
                <Row label={booking.rentalType === 'hourly' ? 'Deposit paid' : 'Total'} value={formatRwf(booking.totalRwf)} strong />
              </div>
              {booking.rentalType === 'hourly' && booking.actualHours != null && (
                <div className="border-t border-ink-100 pt-2">
                  <Row
                    label={`Actual usage — ${booking.actualHours} hr${booking.actualHours === 1 ? '' : 's'}`}
                    value={formatRwf(booking.finalAmountRwf ?? 0)}
                  />
                </div>
              )}
              {!!booking.amountExceededRwf && booking.amountExceededRwf > 0 && (
                <div className="mt-1 space-y-1.5 rounded-lg bg-amber-50 p-2.5 text-[13px] leading-relaxed text-amber-800">
                  <p>
                    {booking.rentalType === 'hourly'
                      ? 'Actual time used came in over the deposit.'
                      : 'Returned more than 2 hours late.'}{' '}
                    This isn't charged automatically — the host follows up directly.
                  </p>
                  <Row label="Exceeded by" value={formatRwf(booking.amountExceededRwf)} />
                  <Row
                    label="Still to pay"
                    value={booking.amountOwedRwf > 0 ? formatRwf(booking.amountOwedRwf) : 'Resolved'}
                    strong={booking.amountOwedRwf === 0}
                  />
                  {amHost && booking.amountOwedRwf > 0 && <AmountOwedResolver booking={booking} />}
                </div>
              )}
              {booking.overageCollectionFailed && (
                <div className="mt-1 space-y-1.5 rounded-lg bg-amber-50 p-2.5 text-[13px] leading-relaxed text-amber-800">
                  <p>
                    PayHold couldn't charge the overage automatically —
                    {booking.overageCollectionFailedReason
                      ? ` ${booking.overageCollectionFailedReason}`
                      : ' the renter paid by a method with no saved card.'}{' '}
                    {amHost
                      ? 'Collect it from the renter directly, then confirm below.'
                      : 'Your host will follow up with you directly to collect it.'}
                  </p>
                  {amHost && <OverageCollectionResolver booking={booking} />}
                </div>
              )}
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

/**
 * Host-only: record what actually happened with an outstanding amount —
 * collected it themselves outside PayHold (Mark fully collected), or waive
 * some or all of it (type a lower number and Save). Never a charge — there
 * is no way to charge a renter again once their deal has funded.
 */
function AmountOwedResolver({ booking }: { booking: Booking }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(booking.amountOwedRwf));

  const mutation = useMutation({
    mutationFn: (newAmount: number) => client.adjustAmountOwed(booking.id, newAmount),
    onSuccess: () => {
      toast.success('Saved.');
      queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that."),
  });

  const parsed = Number(amount);
  const validAmount = Number.isFinite(parsed) && parsed >= 0 && parsed <= booking.amountOwedRwf;

  return (
    <div className="mt-2 space-y-2 border-t border-amber-200 pt-2">
      <p className="text-xs text-amber-800">
        Collected it yourself, or waiving some of it? This only updates the record here — nothing
        is charged.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          min={0}
          max={booking.amountOwedRwf}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="h-8 max-w-28 text-sm"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!validAmount || parsed === booking.amountOwedRwf || mutation.isPending}
          onClick={() => mutation.mutate(parsed)}
        >
          Save
        </Button>
        <Button
          size="sm"
          disabled={mutation.isPending}
          onClick={() => {
            setAmount('0');
            mutation.mutate(0);
          }}
        >
          Mark fully collected
        </Button>
      </div>
    </div>
  );
}

/**
 * Host-only: acknowledge an overage charge PayHold couldn't collect
 * automatically was collected in person. Never a charge — PayHold has no way
 * to bill this renter again, this only clears the flag `payhold-webhook` set
 * on `order.balance_charge_failed`.
 */
function OverageCollectionResolver({ booking }: { booking: Booking }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => client.acknowledgeOverageCollected(booking.id),
    onSuccess: () => {
      toast.success('Saved.');
      queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save that."),
  });

  return (
    <div className="mt-2 border-t border-amber-200 pt-2">
      <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        Mark collected
      </Button>
    </div>
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

/** The later of two handoff timestamps, or null if neither side has signed yet. */
function latestIso(a?: string | null, b?: string | null): string | null {
  if (!a && !b) return null;
  if (!a) return b!;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/**
 * Shows the moment the trip actually started (both sides confirmed pickup)
 * and, alongside it, the limit that matters for how this booking is priced:
 * for a daily car, the exact instant a late-return charge starts (the agreed
 * time plus the 2-hour grace payhold-settle-usage checks); for an hourly car,
 * just the estimate — going past it isn't a penalty, it's simply billed at
 * actual time used once the trip ends.
 */
/** "1d 02h 05m 30s" — days only once there are any, everything else always two digits. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${days > 0 ? `${days}d ` : ''}${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

function TripTimer({ booking }: { booking: Booking }) {
  const pickupIso = latestIso(booking.pickupRenterAt, booking.pickupHostAt);

  // Ticks once a second so the countdown/count-up actually counts, rather
  // than freezing at whatever moment this component happened to render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  let limitAt: Date | null = null;
  let limitLabel = '';
  if (pickupIso && booking.rentalType === 'hourly') {
    if (booking.estimatedHours != null) {
      limitAt = new Date(new Date(pickupIso).getTime() + booking.estimatedHours * 3_600_000);
      limitLabel = 'Estimated return';
    }
  } else if (pickupIso && booking.expectedReturnTime) {
    const hhmm = booking.expectedReturnTime.slice(0, 5);
    const agreedAt = new Date(`${booking.endDate}T${hhmm}:00Z`);
    limitAt = new Date(agreedAt.getTime() + 2 * 3_600_000); // the same 2hr grace payhold-settle-usage applies
    limitLabel = 'Return by (incl. 2hr grace)';
  }

  const stillRunning = booking.state !== 'completed' && !['cancelled', 'declined'].includes(booking.state);
  const pastLimit = !!limitAt && now > limitAt.getTime();

  // Fires once per crossing, not once per second — the ref is what tells
  // "still exceeded" apart from "just became exceeded". Also fires on a
  // fresh page load that lands on an already-exceeded trip, which is the
  // common case for whoever opens this after the fact rather than watching
  // it tick over live.
  const notified = useRef(false);
  useEffect(() => {
    if (pastLimit && stillRunning && !notified.current) {
      notified.current = true;
      toast.error(
        booking.rentalType === 'hourly'
          ? 'This trip has gone past its estimated time.'
          : 'This trip has gone past its return grace period — a late-return amount will apply.',
      );
    }
    if (!pastLimit) notified.current = false;
  }, [pastLimit, stillRunning, booking.rentalType]);

  if (!pickupIso) return null;

  return (
    <Card>
      <CardBody className="space-y-2 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-ink-900">
          <Clock size={15} className="text-brand-600" /> Trip timer
        </p>
        <Row label="Picked up" value={`${formatDate(pickupIso)} at ${formatTime(pickupIso)}`} />
        {limitAt && (
          <Row label={limitLabel} value={`${formatDate(limitAt.toISOString())} at ${formatTime(limitAt.toISOString())}`} />
        )}
        {limitAt && stillRunning && (
          <div className={cn('rounded-lg p-2.5', pastLimit ? 'bg-red-50' : 'bg-ink-50')}>
            <p
              className={cn(
                'font-mono text-lg font-semibold tabular-nums',
                pastLimit ? 'text-red-600' : 'text-ink-900',
              )}
            >
              {pastLimit ? '+' : '-'}
              {formatDuration(Math.abs(now - limitAt.getTime()))}
            </p>
            <p className={cn('text-xs', pastLimit ? 'text-red-600' : 'text-ink-500')}>
              {booking.rentalType === 'hourly'
                ? pastLimit
                  ? 'Exceeded — that’s fine, the final bill is based on actual time used.'
                  : 'remaining in the estimate'
                : pastLimit
                  ? 'Exceeded the grace period — a late-return amount will apply once returned.'
                  : 'remaining in the free return window'}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * One handoff phase (pickup or return). Proof photos are optional — a party
 * can just tap Confirm — but if they want a record, a dedicated camera button
 * opens the device camera directly rather than a generic file chooser, plus a
 * gallery option for photos already taken. The trip only advances once both
 * renter and host have signed off; the current user can confirm their own
 * side while the phase is open.
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
  const [cameraOpen, setCameraOpen] = useState(false);
  const [overageOverride, setOverageOverride] = useState('');

  // Local previews for the not-yet-uploaded files — revoked as soon as the
  // selection changes so we don't leak blob URLs.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

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

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFiles((fs) => [...fs, ...Array.from(list)]);
  }

  function removeFile(index: number) {
    setFiles((fs) => fs.filter((_, i) => i !== index));
  }

  // The host's own lever on a late charge — reduce or waive it before
  // PayHold collects it. Only meaningful on the host's own return
  // confirmation; PayHold refuses it from the renter's side outright (see
  // `confirmDeal` in payhold's own _shared/payhold.ts). A plain RWF integer,
  // same units the listing itself is priced in — no currency conversion,
  // since `overage_override` is checked against the deal's own overage rate
  // before it is ever converted to what the renter was actually charged in.
  const overrideValue = overageOverride.trim();
  const overrideParsed = overrideValue === '' ? undefined : Number(overrideValue);
  const overrideValid =
    overrideParsed === undefined ||
    (Number.isInteger(overrideParsed) && overrideParsed >= 0);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const urls = files.length > 0 ? await client.uploadPhotos(files) : [];
      await client.confirmHandoff(
        booking.id,
        phase,
        urls,
        isHost && phase === 'return' ? overrideParsed : undefined,
      );
      queryClient.invalidateQueries({ queryKey: ['booking', booking.id] });
      queryClient.invalidateQueries({ queryKey: ['ownerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setFiles([]);
      setOverageOverride('');
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
          <div className="space-y-2.5 rounded-lg bg-ink-50 p-3">
            <p className="text-xs font-medium text-ink-700">
              Confirm your side — proof photos are optional.
            </p>

            {files.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {previews.map((url, i) => (
                  <div key={url} className="relative">
                    <img src={url} alt="" className="h-14 w-full rounded-md border border-ink-200 object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label="Remove photo"
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 text-white"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
              >
                <Camera size={14} /> Take photo
              </button>
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50">
                <Upload size={14} /> From gallery
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={busy}
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="sr-only"
                />
              </label>
            </div>

            {isHost && phase === 'return' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-ink-700" htmlFor="overage-override">
                  Reduce or waive the overage charge (optional)
                </label>
                <Input
                  id="overage-override"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  placeholder="Leave blank to charge the full calculated amount"
                  value={overageOverride}
                  onChange={(e) => setOverageOverride(e.target.value)}
                  disabled={busy}
                  className="h-8 text-sm"
                />
                <p className="text-[11px] text-ink-500">
                  In RWF. PayHold caps this at whatever the overage actually comes to — this can
                  only lower it, never raise it.
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button
              size="sm"
              className="w-full"
              disabled={busy || !overrideValid}
              onClick={confirm}
            >
              {busy
                ? 'Confirming…'
                : files.length > 0
                  ? `Confirm ${phase} (${files.length} photo${files.length === 1 ? '' : 's'})`
                  : `Confirm ${phase}`}
            </Button>
          </div>
        )}
      </CardBody>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => setFiles((fs) => [...fs, file])}
      />
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

const VISIBILITY_META: Record<PostVisibility, { label: string; icon: typeof Globe; hint: string }> = {
  public: { label: 'Public', icon: Globe, hint: 'Anyone browsing AutoHire can see it' },
  circles: { label: 'Circles', icon: Users, hint: 'Only people who share a circle with you' },
  private: { label: 'Private', icon: Lock, hint: "Just you — it won't appear in any feed" },
};

/**
 * "Share this trip" — the only way a post can ever be created (migration
 * 064's trigger is the actual gate; this form just can't render before it
 * would pass). Same eligibility shape as TripReviews: the renter or host on
 * THIS booking, and only once it's completed and paid — which for a renter
 * and a host are the same two roles, just posting about different halves of
 * the same trip.
 */
function TripPostComposer({ booking }: { booking: Booking }) {
  const { data: me } = useCurrentUser();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('circles');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const myId = me?.id;
  const canPost = !!myId && (myId === booking.renterId || myId === booking.hostId);
  const eligible = booking.state === 'completed' && booking.paymentStatus === 'paid';

  const { data: existing, isLoading } = useQuery({
    queryKey: ['tripPost', booking.id, myId],
    // bookingId filters out broadcasts entirely, so every item is a trip post.
    queryFn: async () =>
      (await client.listFeed({ bookingId: booking.id })).filter(
        (i): i is Extract<typeof i, { kind: 'trip' }> => i.kind === 'trip',
      ),
    enabled: canPost && eligible,
  });
  const mine = existing?.find((p) => p.author.id === myId);

  const mutation = useMutation({
    mutationFn: async () => {
      const id = client.newTripPostId();
      const photos = await Promise.all(files.map((f) => client.uploadTripPostPhoto(id, f)));
      return client.createTripPost({ id, bookingId: booking.id, body, photos, visibility });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tripPost', booking.id, myId] });
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      setBody('');
      setFiles([]);
      toast.success('Posted');
    },
    onError: () => toast.error('Could not post — try again'),
  });

  if (!canPost || !eligible) return null;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-ink-900">Share this trip</h2>
      </CardHeader>
      <CardBody>
        {isLoading ? (
          <Spinner size={18} />
        ) : mine ? (
          <p className="text-sm text-ink-500">
            Posted to your {VISIBILITY_META[mine.visibility].label.toLowerCase()} feed.
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim()) mutation.mutate();
            }}
            className="space-y-3"
          >
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Where did you go, and what did you do?"
              className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />

            {previews.length > 0 && (
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                {previews.map((url, i) => (
                  <div key={url} className="relative">
                    <img src={url} alt="" className="h-14 w-full rounded-lg border border-ink-100 object-cover" />
                    <button
                      type="button"
                      onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-white"
                      aria-label="Remove photo"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-800"
            >
              <Camera size={13} /> Add photos
            </button>

            <div className="flex flex-wrap gap-2">
              {(Object.keys(VISIBILITY_META) as PostVisibility[]).map((v) => {
                const meta = VISIBILITY_META[v];
                const active = visibility === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVisibility(v)}
                    title={meta.hint}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : 'border-ink-200 text-ink-600 hover:bg-ink-50',
                    )}
                  >
                    <meta.icon size={13} /> {meta.label}
                  </button>
                );
              })}
            </div>
            <Button type="submit" size="sm" disabled={!body.trim() || mutation.isPending}>
              {mutation.isPending ? 'Posting…' : 'Post'}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
