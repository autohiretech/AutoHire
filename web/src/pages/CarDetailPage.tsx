import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Award,
  CalendarCheck,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Cog,
  Fuel,
  Grid3x3,
  MapPin,
  MessageSquare,
  ShieldCheck,
  Snowflake,
  Star,
  UserRound,
  Users,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Booking } from '@autohire/shared';
import { client } from '@/lib/client';
import { useIsHost } from '@/lib/account';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { formatDate, formatRwf } from '@/lib/format';
import { Avatar, Badge, Button, Card, CardBody, Rating, Spinner, toast } from '@/components/ui';
import { LocationMap } from '@/components/map/LocationMap';
import { LocationLinks } from '@/components/map/LocationLinks';
import { RequesterModal, VERIF_TONE } from '@/components/RequesterModal';
import { DateRangeCalendar, type DateRange } from '@/components/marketplace/DateRangeCalendar';

/** Best-effort icon for a free-text feature; falls back to a check. */
function featureIcon(feature: string): LucideIcon {
  const f = feature.toLowerCase();
  if (f.includes('air') || f.includes('a/c') || f.includes('cond')) return Snowflake;
  if (f.includes('wifi') || f.includes('wi-fi') || f.includes('bluetooth') || f.includes('usb')) return Wifi;
  return Check;
}

/** Human "X months/years hosting" from a join date. */
function hostingDuration(joinedAt: string): string {
  const months = Math.max(0, Math.round((Date.now() - new Date(joinedAt).getTime()) / (30 * 86_400_000)));
  if (months < 1) return 'New host';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} hosting`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} hosting`;
}

export function CarDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [messaging, setMessaging] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const calendarRef = useRef<HTMLDivElement>(null);
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
  const photos = listing.photos;
  // You can message the host unless you ARE the host or you're in host mode.
  const canMessage = !isHost && !!me && me.id !== listing.hostId;
  // The owner (individual or company) viewing their own car — show who's requesting.
  const isOwner = !!me && me.id === listing.hostId;

  // --- Date selection (calendar + reserve card) -------------------------
  const bookedRanges = bookedQuery.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const maintUntil = listing.maintenanceUntil ?? undefined;
  const pickupMin =
    listing.status === 'maintenance' && maintUntil && maintUntil > today ? maintUntil : today;
  // A day is unavailable if it's personally blocked or inside a live booking.
  const isUnavailable = (d: string) =>
    listing.blockedDates.includes(d) ||
    bookedRanges.some((r) => r.startDate <= d && d < r.endDate);
  const datesChosen = !!(range.start && range.end);
  const nights = datesChosen
    ? Math.max(1, Math.round((new Date(range.end!).getTime() - new Date(range.start!).getTime()) / 86_400_000))
    : 0;
  const subtotal = nights * listing.pricePerDayRwf;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee;

  const goToCalendar = () => calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const reserve = () => {
    if (!datesChosen) return goToCalendar();
    navigate(`/cars/${listing.id}/book`, { state: { startDate: range.start, endDate: range.end } });
  };

  const subtitle = [
    `${listing.seats} seats`,
    listing.transmission,
    listing.fuel,
    `${listing.year} ${listing.make}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const highlights: { icon: LucideIcon; title: string; body: string }[] = [];
  if (instant) {
    highlights.push({
      icon: CalendarCheck,
      title: 'Instant booking',
      body: 'Your trip is confirmed right away — no waiting on approval.',
    });
  }
  if (host?.ratingAvg !== undefined && host.ratingAvg >= 4.8 && (host.ratingCount ?? 0) >= 5) {
    highlights.push({
      icon: Award,
      title: `${host.businessName ?? host.fullName} is a top-rated host`,
      body: 'Highly rated by recent renters for a smooth handover.',
    });
  }

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
    <section className="mx-auto max-w-5xl px-4 py-6">
      <Link
        to="/"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back to browse
      </Link>

      {/* Title + summary line */}
      <h1 className="text-2xl font-bold text-ink-900">{listing.title}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-600">
        {listing.ratingCount ? (
          <span className="inline-flex items-center gap-1 font-medium text-ink-900">
            <Star size={14} className="fill-ink-900" /> {listing.ratingAvg?.toFixed(2)}
            <span className="font-normal text-ink-500">· {listing.ratingCount} reviews</span>
          </span>
        ) : (
          <span className="text-ink-500">New listing</span>
        )}
        <span className="text-ink-300">·</span>
        <span className="inline-flex items-center gap-1 text-ink-600">
          <MapPin size={14} /> {listing.location}
        </span>
      </div>

      {/* Photo mosaic */}
      <PhotoMosaic photos={photos} title={listing.title} onOpen={(i) => setLightbox(i)} />

      <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_360px]">
        {/* Left: content */}
        <div className="min-w-0">
          {isOwner && <OwnerRequests listingId={listing.id} />}

          {/* Overview + host */}
          <div className="flex items-start justify-between gap-4 pb-6">
            <div>
              <h2 className="text-lg font-semibold text-ink-900">
                Hosted by {host ? host.businessName ?? host.fullName : '…'}
              </h2>
              <p className="mt-0.5 capitalize text-ink-600">{subtitle}</p>
            </div>
            {host && (
              <Link to={`/cars/${listing.id}`} className="shrink-0">
                <Avatar name={host.businessName ?? host.fullName} src={host.avatarUrl} size="lg" />
              </Link>
            )}
          </div>

          {/* Highlights */}
          {highlights.length > 0 && (
            <ul className="space-y-4 border-t border-ink-200 py-6">
              {highlights.map((h) => (
                <li key={h.title} className="flex items-start gap-4">
                  <h.icon size={22} className="mt-0.5 shrink-0 text-ink-700" />
                  <div>
                    <p className="font-medium text-ink-900">{h.title}</p>
                    <p className="text-sm text-ink-500">{h.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Specs */}
          <div className="grid grid-cols-2 gap-4 border-t border-ink-200 py-6 sm:grid-cols-4">
            <Spec icon={Users} label="Seats" value={`${listing.seats}`} />
            <Spec icon={Cog} label="Transmission" value={listing.transmission} />
            <Spec icon={Fuel} label="Fuel" value={listing.fuel} />
            <Spec icon={Star} label="Type" value={listing.category} />
          </div>

          {/* What this car offers */}
          {listing.features.length > 0 && (
            <div className="border-t border-ink-200 py-6">
              <h2 className="mb-4 text-lg font-semibold text-ink-900">What this car offers</h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {listing.features.map((f) => {
                  const Icon = featureIcon(f);
                  return (
                    <li key={f} className="flex items-center gap-3 text-ink-700">
                      <Icon size={18} className="shrink-0 text-ink-500" /> {f}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Pickup location */}
          {(listing.lat != null && listing.lng != null) || listing.locationUrl ? (
            <div className="border-t border-ink-200 py-6">
              <h2 className="mb-3 text-lg font-semibold text-ink-900">Where you'll pick it up</h2>
              <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-600">
                <MapPin size={15} className="text-brand-600" /> {listing.location}
              </p>
              {listing.lat != null && listing.lng != null && (
                <LocationMap lat={listing.lat} lng={listing.lng} />
              )}
              <div className="mt-3">
                <LocationLinks url={listing.locationUrl} lat={listing.lat} lng={listing.lng} />
              </div>
            </div>
          ) : null}

          {/* Meet your host */}
          {host && (
            <div className="border-t border-ink-200 py-6">
              <h2 className="mb-4 text-lg font-semibold text-ink-900">Meet your host</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-[260px_1fr]">
                {/* Host profile card */}
                <div className="rounded-2xl border border-ink-200 p-5 shadow-sm">
                  <div className="flex items-center gap-4">
                    <Avatar name={host.businessName ?? host.fullName} src={host.avatarUrl} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold text-ink-900">
                        {host.businessName ?? host.fullName}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-ink-500">
                        {host.ownerType === 'business' ? 'Business host' : 'Individual host'}
                        {host.verification === 'verified' && (
                          <span className="inline-flex items-center gap-0.5 text-emerald-600">
                            · <ShieldCheck size={12} /> Verified
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 divide-x divide-ink-100 text-center">
                    <div className="px-1">
                      <p className="text-lg font-bold text-ink-900">{host.ratingCount ?? 0}</p>
                      <p className="text-[11px] text-ink-500">Reviews</p>
                    </div>
                    <div className="px-1">
                      <p className="inline-flex items-center gap-0.5 text-lg font-bold text-ink-900">
                        {host.ratingCount ? host.ratingAvg?.toFixed(2) : '—'}
                        <Star size={12} className="fill-ink-900" />
                      </p>
                      <p className="text-[11px] text-ink-500">Rating</p>
                    </div>
                    <div className="px-1">
                      <p className="text-lg font-bold text-ink-900">{host.vehicleCount}</p>
                      <p className="text-[11px] text-ink-500">Cars</p>
                    </div>
                  </div>
                </div>

                {/* Host details + safety */}
                <div>
                  <p className="font-semibold text-ink-900">
                    {host.ratingAvg !== undefined && host.ratingAvg >= 4.8 && (host.ratingCount ?? 0) >= 5
                      ? `${host.businessName ?? host.fullName} is a top-rated host`
                      : `Hosting with ${host.businessName ?? host.fullName}`}
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-ink-700">
                    <li className="flex items-center gap-2">
                      <Award size={16} className="text-ink-500" /> {hostingDuration(host.joinedAt)}
                    </li>
                    <li className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-ink-500" />
                      {host.verification === 'verified' ? 'Identity verified' : 'Identity on file'}
                    </li>
                    <li className="flex items-center gap-2">
                      <Car size={16} className="text-ink-500" /> {host.vehicleCount} car
                      {host.vehicleCount === 1 ? '' : 's'} on AutoHire
                    </li>
                  </ul>

                  {canMessage && (
                    <Button
                      variant="outline"
                      className="mt-4"
                      disabled={messaging}
                      onClick={messageHost}
                    >
                      <MessageSquare size={16} /> {messaging ? 'Opening…' : 'Message host'}
                    </Button>
                  )}

                  <p className="mt-4 flex items-start gap-2 border-t border-ink-100 pt-4 text-xs text-ink-500">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand-600" />
                    To help protect your payment, always message and pay through AutoHire — never off-platform.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Reviews */}
          <div className="border-t border-ink-200 py-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-ink-900">
              {listing.ratingCount ? (
                <>
                  <Star size={18} className="fill-ink-900" />
                  {listing.ratingAvg?.toFixed(2)} · {reviews.length} review{reviews.length === 1 ? '' : 's'}
                </>
              ) : (
                'Reviews'
              )}
            </h2>
            {reviewsQuery.isLoading ? (
              <div className="py-4">
                <Spinner size={20} />
              </div>
            ) : reviews.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">No reviews yet.</p>
            ) : (
              <ul className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <Rating value={r.rating} />
                    <p className="mt-1.5 text-sm text-ink-700">{r.body}</p>
                    <p className="mt-1 text-xs text-ink-400">{formatDate(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Choose dates */}
          <div ref={calendarRef} className="border-t border-ink-200 py-6">
            <h2 className="text-lg font-semibold text-ink-900">
              {datesChosen ? `${nights} night${nights === 1 ? '' : 's'} in ${listing.location}` : 'Choose your dates'}
            </h2>
            <p className="mt-0.5 text-sm text-ink-500">
              {datesChosen
                ? `${formatDate(range.start!)} – ${formatDate(range.end!)}`
                : 'Add your trip dates to see the total and reserve.'}
            </p>
            {listing.status === 'maintenance' && maintUntil && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                This car is in maintenance — available from {formatDate(maintUntil)}.
              </p>
            )}
            <div className="mt-4">
              <DateRangeCalendar
                value={range}
                onChange={setRange}
                minDate={pickupMin}
                isUnavailable={isUnavailable}
              />
            </div>
            {datesChosen && (
              <button
                type="button"
                onClick={() => setRange({ start: null, end: null })}
                className="mt-3 text-sm font-medium text-brand-600 hover:underline"
              >
                Clear dates
              </button>
            )}
          </div>
        </div>

        {/* Right: reserve card */}
        <div>
          <Card className="lg:sticky lg:top-20">
            <CardBody className="space-y-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-ink-900">{formatRwf(listing.pricePerDayRwf)}</span>
                <span className="text-ink-500">/ day</span>
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
                  {/* Date fields — open the calendar below */}
                  <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-ink-300 text-sm">
                    <button
                      type="button"
                      onClick={goToCalendar}
                      className="border-r border-ink-300 p-2.5 text-left hover:bg-ink-50"
                    >
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                        Pick-up
                      </span>
                      <span className="text-ink-900">{range.start ? formatDate(range.start) : 'Add date'}</span>
                    </button>
                    <button type="button" onClick={goToCalendar} className="p-2.5 text-left hover:bg-ink-50">
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                        Return
                      </span>
                      <span className="text-ink-900">{range.end ? formatDate(range.end) : 'Add date'}</span>
                    </button>
                  </div>

                  <Button className="w-full" size="lg" onClick={reserve}>
                    {datesChosen ? (instant ? 'Reserve' : 'Request to book') : 'Choose dates'}
                  </Button>
                  <p className="text-center text-xs text-ink-400">You won't be charged yet</p>

                  {datesChosen && (
                    <div className="space-y-2 border-t border-ink-100 pt-3 text-sm">
                      <div className="flex justify-between text-ink-600">
                        <span>
                          {formatRwf(listing.pricePerDayRwf)} × {nights} night{nights === 1 ? '' : 's'}
                        </span>
                        <span>{formatRwf(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-ink-600">
                        <span>Service fee</span>
                        <span>{formatRwf(serviceFee)}</span>
                      </div>
                      <div className="flex justify-between border-t border-ink-100 pt-2 font-semibold text-ink-900">
                        <span>Total</span>
                        <span>{formatRwf(total)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
              {canMessage && (
                <Button variant="outline" className="w-full" disabled={messaging} onClick={messageHost}>
                  <MessageSquare size={16} />
                  {messaging ? 'Opening…' : 'Message host'}
                </Button>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {lightbox !== null && (
        <Lightbox photos={photos} index={lightbox} onClose={() => setLightbox(null)} title={listing.title} />
      )}
    </section>
  );
}

/** Airbnb-style photo grid: one big photo + up to four small ones, with a "show all" button. */
function PhotoMosaic({
  photos,
  title,
  onOpen,
}: {
  photos: string[];
  title: string;
  onOpen: (index: number) => void;
}) {
  if (photos.length === 0) return null;

  if (photos.length < 5) {
    // Not enough for the mosaic — big image + a thumbnail strip.
    return (
      <div className="mt-5">
        <button type="button" onClick={() => onOpen(0)} className="block w-full">
          <img
            src={photos[0]}
            alt={title}
            className="h-64 w-full rounded-2xl object-cover sm:h-96"
          />
        </button>
        {photos.length > 1 && (
          <div className="mt-3 flex gap-3">
            {photos.slice(1).map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => onOpen(i + 1)}
                className="h-16 w-24 overflow-hidden rounded-lg border border-ink-200 hover:opacity-90"
              >
                <img src={p} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const [big, ...rest] = photos;
  return (
    <div className="relative mt-5">
      <div className="grid h-[260px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-2xl sm:h-[420px]">
        {/* On mobile the hero image fills the frame; the thumbnail collage shows from sm up. */}
        <button type="button" onClick={() => onOpen(0)} className="col-span-4 row-span-2 sm:col-span-2">
          <img src={big} alt={title} className="h-full w-full object-cover transition hover:brightness-95" />
        </button>
        {rest.slice(0, 4).map((p, i) => (
          <button key={p} type="button" onClick={() => onOpen(i + 1)} className="hidden sm:block">
            <img src={p} alt="" className="h-full w-full object-cover transition hover:brightness-95" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onOpen(0)}
        className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg border border-ink-900/20 bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-sm hover:bg-ink-50"
      >
        <Grid3x3 size={15} /> Show all photos
      </button>
    </div>
  );
}

/** Full-screen photo viewer with prev/next. */
function Lightbox({
  photos,
  index,
  onClose,
  title,
}: {
  photos: string[];
  index: number;
  onClose: () => void;
  title: string;
}) {
  const [i, setI] = useState(index);
  const prev = () => setI((v) => (v - 1 + photos.length) % photos.length);
  const next = () => setI((v) => (v + 1) % photos.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/90 p-4" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Close"
      >
        <X size={22} />
      </button>
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Previous"
        >
          <ChevronLeft size={26} />
        </button>
      )}
      <img
        src={photos[i]}
        alt={title}
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Next"
        >
          <ChevronRight size={26} />
        </button>
      )}
      <span className="absolute bottom-4 text-sm text-white/80">
        {i + 1} / {photos.length}
      </span>
    </div>
  );
}

function Spec({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div>
      <Icon size={20} className="text-ink-500" />
      <p className="mt-1 text-xs text-ink-500">{label}</p>
      <p className="font-medium capitalize text-ink-900">{value}</p>
    </div>
  );
}

/**
 * Owner-only: who has requested this car. Shown to the host — individual or
 * company — right on the listing, so they can see and vet each requester
 * (profile + verification documents) before approving.
 */
function OwnerRequests({ listingId }: { listingId: string }) {
  const queryClient = useQueryClient();
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['ownerBookings'],
    queryFn: () => client.listOwnerBookings(),
  });
  const requests = bookings.filter((b) => b.listingId === listingId && b.state === 'requested');

  const mutation = useMutation({
    mutationFn: (action: 'approve' | 'decline') => client.respondToBooking(activeBooking!.id, action),
    onSuccess: (_data, action) => {
      queryClient.invalidateQueries({ queryKey: ['ownerBookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      setActiveBooking(null);
      toast.success(action === 'approve' ? 'Request approved — the renter has been notified.' : 'Request declined.');
    },
    onError: () => toast.error("Couldn't update the request. Please try again."),
  });

  if (isLoading) return null;

  return (
    <div className="border-b border-ink-200 pb-6">
      <h2 className="text-lg font-semibold text-ink-900">
        Requests for this car{requests.length > 0 && <span className="text-ink-400"> ({requests.length})</span>}
      </h2>
      {requests.length === 0 ? (
        <p className="mt-2 text-sm text-ink-500">No pending requests right now.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-500">
            See who's requesting and check their verification before you approve.
          </p>
          <div className="mt-4 space-y-3">
            {requests.map((b) => (
              <RequesterRow key={b.id} booking={b} onReview={() => setActiveBooking(b)} />
            ))}
          </div>
        </>
      )}

      <RequesterModal
        open={!!activeBooking}
        onClose={() => setActiveBooking(null)}
        renterId={activeBooking?.renterId ?? ''}
        onDecide={(action) => mutation.mutate(action)}
        deciding={mutation.isPending}
      />
    </div>
  );
}

/** One requester preview row — name, verification, dates — with a review action. */
function RequesterRow({ booking, onReview }: { booking: Booking; onReview: () => void }) {
  const { data: p } = useQuery({
    queryKey: ['profile', booking.renterId],
    queryFn: () => client.getProfile(booking.renterId),
  });
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink-200 p-3 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <Avatar name={p?.fullName ?? 'Renter'} src={p?.avatarUrl} size="md" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900">
            {p?.fullName ?? 'Renter'}
            {p && (
              <Badge tone={VERIF_TONE[p.verification] ?? 'neutral'}>
                <ShieldCheck size={11} /> {p.verification}
              </Badge>
            )}
          </p>
          <p className="text-sm text-ink-500">
            {formatDate(booking.startDate)} – {formatDate(booking.endDate)} · {formatRwf(booking.totalRwf)}
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onReview}>
        <UserRound size={15} /> Review &amp; decide
      </Button>
    </div>
  );
}
