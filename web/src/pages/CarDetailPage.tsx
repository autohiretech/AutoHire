import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Car,
  Award,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Cog,
  Fuel,
  Grid3x3,
  MapPin,
  MessageSquare,
  Share2,
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
import { useCanRent, useIsBusinessHost, useIsHost } from '@/lib/account';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useBackToBrowse } from '@/lib/useBackToBrowse';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { bookingCurrency, formatAmount } from '@/lib/money';
import { formatMoney, isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import { isMachine } from '@/lib/categories';
import { listingHeadlinePrice } from '@/lib/pricing';
import { SocialProofBadge } from '@/components/SocialProofBadge';
import { AddToBoardButton } from '@/components/AddToBoardButton';
import { WatchButton } from '@/components/WatchButton';
import { Img } from '@/components/Img';
import { Price } from '@/components/Price';
import { PhotoCarousel } from '@/components/PhotoCarousel';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  Label,
  Notice,
  Rating,
  Skeleton,
  toast,
} from '@/components/ui';
import { LocationMap } from '@/components/map/LocationMap';
import { LocationLinks } from '@/components/map/LocationLinks';
import { useAiAssistantSource } from '@/lib/aiAssistantContext';
import { RequesterModal, VERIF_TONE } from '@/components/RequesterModal';
import { DateRangeCalendar, type DateRange } from '@/components/marketplace/DateRangeCalendar';
import { useT } from '@/lib/i18n';

/** Best-effort icon for a free-text feature; falls back to a check. */
function featureIcon(feature: string): LucideIcon {
  const f = feature.toLowerCase();
  if (f.includes('air') || f.includes('a/c') || f.includes('cond')) return Snowflake;
  if (f.includes('wifi') || f.includes('wi-fi') || f.includes('bluetooth') || f.includes('usb')) return Wifi;
  return Check;
}

/** Human "X months/years hosting" from a join date. */
function hostingDuration(joinedAt: string, t: ReturnType<typeof useT>): string {
  const months = Math.max(0, Math.round((Date.now() - new Date(joinedAt).getTime()) / (30 * 86_400_000)));
  if (months < 1) return t('car.newHost');
  if (months < 12) return months === 1 ? t('car.monthHosting') : t('car.monthsHosting', { count: months });
  const years = Math.floor(months / 12);
  return years === 1 ? t('car.yearHosting') : t('car.yearsHosting', { count: years });
}

/**
 * The calendar date an hourly booking returns on, derived from the hours
 * chosen rather than fixed to the pickup day. Every blocked-date and clash
 * check in this codebase treats `endDate` as exclusive (a booking from Aug 20
 * to Aug 22 holds the 20th and 21st, not the 22nd) — so `startDate === endDate`
 * made a same-day hourly pickup invisible to both checks, on top of failing
 * the "return after pick-up" validation on the server. One rolled-over block
 * of 24 hours is one extra day, minimum one, so even a 2-hour booking holds
 * its one pickup day rather than holding none.
 */
function hourlyReturnDate(pickupDate: string, hours: number): string {
  const days = Math.max(1, Math.ceil(hours / 24));
  const d = new Date(pickupDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function CarDetailPage() {
  const t = useT();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const backToBrowse = useBackToBrowse();
  const [messaging, setMessaging] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // Pre-filled from ?start=&end=&pickup=&hours= when the assistant's own
  // "Open car page to continue" link sent the renter here — set for both
  // the range and single-day fields since which one actually applies
  // depends on the listing's pricingMode, not known yet at this point.
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState<DateRange>({
    start: searchParams.get('start'),
    end: searchParams.get('end'),
  });
  // Only used for an hourly-only car — a single pickup day, not a range.
  const [pickupDate, setPickupDate] = useState<string | null>(searchParams.get('start'));
  const [pickupTime, setPickupTime] = useState(searchParams.get('pickup') ?? '10:00');
  const [estimatedHours, setEstimatedHours] = useState(() => {
    const hours = Number(searchParams.get('hours'));
    return Number.isFinite(hours) && hours > 0 ? hours : 4;
  });
  const calendarRef = useRef<HTMLDivElement>(null);
  const isHost = useIsHost();
  // Hosts and company accounts are view-only on a listing — no booking.
  const canRent = useCanRent();
  const isCompany = useIsBusinessHost();
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
  // Same query the "Trusted by your circle" badge below already makes for a
  // signed-in renter — sharing the key means this doesn't cost a second round
  // trip when both are on the page. `totalTrips` is the completed-trip count
  // the meta row wants; guests simply don't get a trip count (no more able to
  // see it than the RPC is able to answer for them without a follow list).
  const socialProofQuery = useQuery({
    queryKey: ['socialProof', listing?.id],
    queryFn: () => client.socialProof(listing!.id),
    enabled: !!listing && !!me,
  });

  // Tells the global AI assistant which car this page is showing, so "book
  // this one" or "message the host" resolve against it directly — no need
  // to search first just to give the assistant something to point at.
  // Memoized on listing?.id, not just left as an inline `[listing]` literal
  // — a fresh array every render used to feed straight back into the
  // registration effect below it and loop (see aiAssistantContext.tsx).
  const aiListings = useMemo(() => (listing ? [listing] : []), [listing]);
  useAiAssistantSource(aiListings, { loading: isLoading });

  if (isLoading) {
    return <CarDetailSkeleton />;
  }

  if (!listing) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-[var(--color-content)]">{t('car.listingNotFound')}</p>
        <button
          type="button"
          onClick={backToBrowse}
          className="mt-3 inline-block text-body-sm text-brand-600 hover:underline"
        >
          {t('car.backToBrowse')}
        </button>
      </div>
    );
  }

  const host = hostQuery.data;
  const reviews = reviewsQuery.data ?? [];
  const totalTrips = socialProofQuery.data?.totalTrips ?? 0;
  const instant = true;
  const photos = listing.photos;
  // You can message the host unless you ARE the host or you're in host mode.
  const canMessage = !isHost && !!me && me.id !== listing.hostId;
  // The owner (individual or company) viewing their own car — show who's requesting.
  const isOwner = !!me && me.id === listing.hostId;
  const topRatedHost =
    host?.ratingAvg !== undefined && host.ratingAvg >= 4.8 && (host.ratingCount ?? 0) >= 5;

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
  // A car is priced by the day OR the hour, never both — the two pickers
  // below are mutually exclusive, not a choice the renter makes here.
  const isHourlyListing = listing.pricingMode === 'hourly';
  const datesChosen = isHourlyListing ? !!pickupDate : !!(range.start && range.end);
  const nights =
    !isHourlyListing && datesChosen
      ? Math.max(1, Math.round((new Date(range.end!).getTime() - new Date(range.start!).getTime()) / 86_400_000))
      : 0;
  // For an hourly car this is an ESTIMATE — what's actually due now is 50% of
  // it (subtotal below), settled against actual pickup-to-return time after
  // the trip. See docs/payhold.md: PayHold can't add money to a funded deal.
  const estimatedTotal = isHourlyListing
    ? estimatedHours * (listing.pricePerHourRwf ?? 0)
    : nights * (listing.pricePerDayRwf ?? 0);
  const subtotal = isHourlyListing ? Math.round(estimatedTotal / 2) : estimatedTotal;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee; // what's due now
  // The price breakdown stays in the car's own currency (the one the host set),
  // regardless of the renter's market. The headline above still shows a converted
  // estimate for convenience via <Price>.
  const cur: CurrencyCode = isCurrencyCode(listing.priceCurrency) ? listing.priceCurrency : 'RWF';
  const money = (n: number) => formatMoney(n, cur);

  const goToCalendar = () => calendarRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const reserve = () => {
    if (!canRent) return;
    if (!datesChosen) return goToCalendar();
    navigate(`/cars/${listing.id}/book`, {
      state: isHourlyListing
        ? {
            startDate: pickupDate,
            endDate: hourlyReturnDate(pickupDate!, estimatedHours),
            pickupTime,
            estimatedHours,
          }
        : { startDate: range.start, endDate: range.end },
    });
  };

  // Identity verification is not a condition of renting — see BookingPage for
  // the whole story — so nothing about the renter's own verification state
  // reaches this button any more.
  const reserveLabel = datesChosen
    ? instant
      ? t('car.reserve')
      : t('car.requestToBook')
    : t('car.chooseDates');

  const subtitle = [`${listing.year} ${listing.make}`, listing.model].filter(Boolean).join(' ');

  const highlights: { icon: LucideIcon; title: string; body: string }[] = [];
  if (topRatedHost) {
    highlights.push({
      icon: Award,
      title: t('car.topRatedHostName', { name: host!.businessName ?? host!.fullName }),
      body: t('car.topRatedHostBody'),
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
    <section className="mx-auto max-w-7xl px-4 py-5 pb-[calc(7rem+var(--tab-bar-height))] md:pb-28 lg:pb-8">
      <button
        type="button"
        onClick={backToBrowse}
        className="mb-3 inline-flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
      >
        <ArrowLeft size={16} /> {t('car.backToBrowse')}
      </button>

      {/* Gallery grid — one large photo left, two stacked right on desktop, a
          single swipeable photo on mobile. Comes before the title, per the
          reference pattern: the car sells itself before you read a word. */}
      <PhotoGallery photos={photos} title={listing.title} onOpen={(i) => setLightbox(i)} />

      {/* Title block — h1, then a meta row (year · rating · trips · host badge). */}
      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-h1 text-[var(--color-content)]">{listing.title}</h1>
          <p className="mt-1 text-body-sm capitalize text-[var(--color-content-muted)]">{subtitle}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-body-sm text-[var(--color-content-muted)]">
            <span>{listing.year}</span>
            <span aria-hidden="true">·</span>
            {listing.ratingCount ? (
              <span className="tabular inline-flex items-center gap-1 font-medium text-[var(--color-content)]">
                <Star size={14} className="fill-[var(--color-content)]" /> {listing.ratingAvg?.toFixed(2)}
                <span className="font-normal text-[var(--color-content-muted)]">
                  (
                  {listing.ratingCount === 1
                    ? t('car.reviewCount')
                    : t('car.reviewsCount', { count: listing.ratingCount })}
                  )
                </span>
              </span>
            ) : (
              <span>{t('car.newListing')}</span>
            )}
            {totalTrips > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>{totalTrips === 1 ? t('car.tripCount') : t('car.tripsCount', { count: totalTrips })}</span>
              </>
            )}
            {topRatedHost && (
              <>
                <span aria-hidden="true">·</span>
                <Badge tone="brand">
                  <Award size={11} /> {t('car.topHost')}
                </Badge>
              </>
            )}
          </div>
          <p className="mt-1.5 inline-flex items-center gap-1 text-body-sm text-[var(--color-content-muted)]">
            <MapPin size={14} /> {listing.location}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Watching is a renter's tool — it says "tell me when I can book
              this", which a host or company account can never act on. */}
          {canRent && <WatchButton id={listing.id} />}
          <AddToBoardButton listingId={listing.id} />
          <ShareButton title={listing.title} />
        </div>
      </div>

      <div className="mt-3">
        <SocialProofBadge listingId={listing.id} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left: content */}
        <div className="min-w-0">
          {isOwner && <OwnerRequests listingId={listing.id} priceCurrency={listing.priceCurrency} />}

          {/* Overview + host */}
          <div className="flex items-start justify-between gap-4 pb-5">
            <div>
              <h2 className="text-h3 text-[var(--color-content)]">
                {host ? t('car.hostedBy', { name: host.businessName ?? host.fullName }) : t('car.hostedBy', { name: '…' })}
              </h2>
            </div>
            {host && (
              <Link to={`/hosts/${host.id}`} className="shrink-0">
                <Avatar name={host.businessName ?? host.fullName} src={host.avatarUrl} size="lg" />
              </Link>
            )}
          </div>

          {/* Spec chips — the vehicle's own facts, as bordered pills rather
              than a table. No MPG field exists in this marketplace's listing
              model (host-owned cars, not a spec sheet), so the category takes
              its place as the fourth chip. */}
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-line)] py-5">
            <SpecChip icon={Users} label={t('car.seats', { count: listing.seats })} />
            <SpecChip icon={Fuel} label={listing.fuel} />
            <SpecChip icon={Cog} label={listing.transmission} />
            <SpecChip icon={Car} label={listing.category} />
          </div>

          {/* Highlights */}
          {highlights.length > 0 && (
            <ul className="space-y-4 border-t border-[var(--color-line)] py-5">
              {highlights.map((h) => (
                <li key={h.title} className="flex items-start gap-4">
                  <h.icon size={22} className="mt-0.5 shrink-0 text-[var(--color-content-muted)]" />
                  <div>
                    <p className="font-medium text-[var(--color-content)]">{h.title}</p>
                    <p className="text-body-sm text-[var(--color-content-muted)]">{h.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* What this car offers */}
          {listing.features.length > 0 && (
            <div className="border-t border-[var(--color-line)] py-5">
              <h2 className="mb-4 text-h3 text-[var(--color-content)]">
                {t(isMachine(listing.category) ? 'car.whatMachineOffers' : 'car.whatCarOffers')}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {listing.features.map((f) => {
                  const Icon = featureIcon(f);
                  return (
                    <li key={f} className="flex items-center gap-3 text-[var(--color-content-muted)]">
                      <Icon size={18} className="shrink-0 text-[var(--color-content-subtle)]" /> {f}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Pickup location */}
          {(listing.lat != null && listing.lng != null) || listing.locationUrl ? (
            <div className="border-t border-[var(--color-line)] py-5">
              <h2 className="mb-3 text-h3 text-[var(--color-content)]">{t('car.pickupLocationTitle')}</h2>
              <p className="mb-3 flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)]">
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
            <div className="border-t border-[var(--color-line)] py-5">
              <h2 className="mb-4 text-h3 text-[var(--color-content)]">{t('car.meetYourHost')}</h2>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-[260px_1fr]">
                {/* Host profile card */}
                <Card className="p-5">
                  <div className="flex items-center gap-4">
                    <Avatar name={host.businessName ?? host.fullName} src={host.avatarUrl} size="lg" />
                    <div className="min-w-0">
                      <p className="truncate text-body-lg font-semibold text-[var(--color-content)]">
                        {host.businessName ?? host.fullName}
                      </p>
                      <p className="flex items-center gap-1 text-caption text-[var(--color-content-muted)]">
                        {host.ownerType === 'business' ? t('car.businessHost') : t('car.individualHost')}
                        {host.verification === 'verified' && (
                          <span className="inline-flex items-center gap-0.5 text-brand-600">
                            · <ShieldCheck size={12} /> {t('car.verified')}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 divide-x divide-[var(--color-line)] text-center">
                    <div className="px-1">
                      <p className="text-body-lg font-bold tabular text-[var(--color-content)]">
                        {host.ratingCount ?? 0}
                      </p>
                      <p className="text-caption text-[var(--color-content-muted)]">{t('car.reviewsStat')}</p>
                    </div>
                    <div className="px-1">
                      <p className="inline-flex items-center gap-0.5 text-body-lg font-bold tabular text-[var(--color-content)]">
                        {host.ratingCount ? host.ratingAvg?.toFixed(2) : '—'}
                        <Star size={12} className="fill-[var(--color-content)]" />
                      </p>
                      <p className="text-caption text-[var(--color-content-muted)]">{t('car.ratingStat')}</p>
                    </div>
                    <div className="px-1">
                      <p className="text-body-lg font-bold tabular text-[var(--color-content)]">
                        {host.vehicleCount}
                      </p>
                      <p className="text-caption text-[var(--color-content-muted)]">{t('car.listingsStat')}</p>
                    </div>
                  </div>
                  <Link to={`/hosts/${host.id}`} className="mt-4 block">
                    <Button variant="outline" className="w-full">
                      {t('car.viewProfileAllCars')}
                    </Button>
                  </Link>
                </Card>

                {/* Host details + safety */}
                <div>
                  <p className="font-semibold text-[var(--color-content)]">
                    {topRatedHost
                      ? t('car.topRatedHostName', { name: host.businessName ?? host.fullName })
                      : t('car.hostingWith', { name: host.businessName ?? host.fullName })}
                  </p>
                  <ul className="mt-3 space-y-2 text-body-sm text-[var(--color-content-muted)]">
                    <li className="flex items-center gap-2">
                      <Award size={16} className="text-[var(--color-content-subtle)]" /> {hostingDuration(host.joinedAt, t)}
                    </li>
                    <li className="flex items-center gap-2">
                      <ShieldCheck size={16} className="text-[var(--color-content-subtle)]" />
                      {host.verification === 'verified' ? t('car.identityVerified') : t('car.identityOnFile')}
                    </li>
                    <li className="flex items-center gap-2">
                      <Car size={16} className="text-[var(--color-content-subtle)]" />{' '}
                      {host.vehicleCount === 1 ? t('car.carOnAutoHire') : t('car.carsOnAutoHire', { count: host.vehicleCount })}
                    </li>
                  </ul>

                  {canMessage && (
                    <Button
                      variant="outline"
                      className="mt-4"
                      disabled={messaging}
                      onClick={messageHost}
                    >
                      <MessageSquare size={16} /> {messaging ? t('car.opening') : t('car.messageHost')}
                    </Button>
                  )}

                  <p className="mt-4 flex items-start gap-2 border-t border-[var(--color-line)] pt-4 text-caption text-[var(--color-content-muted)]">
                    <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand-600" />
                    {t('car.payThroughPlatform')}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Reviews */}
          <div className="border-t border-[var(--color-line)] py-5">
            <h2 className="flex items-center gap-2 text-h3 text-[var(--color-content)]">
              {listing.ratingCount ? (
                <span className="tabular flex items-center gap-2">
                  <Star size={18} className="fill-[var(--color-content)]" />
                  {listing.ratingAvg?.toFixed(2)} ·{' '}
                  {reviews.length === 1 ? t('car.reviewCount') : t('car.reviewsCount', { count: reviews.length })}
                </span>
              ) : (
                t('car.reviewsStat')
              )}
            </h2>
            {reviewsQuery.isLoading ? (
              <ul className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2" aria-busy="true" aria-label="Loading reviews">
                {[0, 1].map((i) => (
                  <li key={i}>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-1.5 h-4 w-full" />
                    <Skeleton className="mt-1 h-3 w-20" />
                  </li>
                ))}
              </ul>
            ) : reviews.length === 0 ? (
              <p className="mt-3 text-body-sm text-[var(--color-content-muted)]">{t('car.noReviewsYet')}</p>
            ) : (
              <ul className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
                {reviews.map((r) => (
                  <li key={r.id}>
                    <Rating value={r.rating} />
                    <p className="mt-1.5 text-body-sm text-[var(--color-content-muted)]">{r.body}</p>
                    <p className="mt-1 text-caption text-[var(--color-content-subtle)]">{formatDate(r.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Choose when — a single pickup day + hours for an hourly car, a
              date range for a daily one. Never both. */}
          <div ref={calendarRef} className="border-t border-[var(--color-line)] py-5">
            {isHourlyListing ? (
              <>
                <h2 className="text-h3 text-[var(--color-content)]">
                  {datesChosen
                    ? estimatedHours === 1
                      ? t('car.hourInLocation', { location: listing.location })
                      : t('car.hoursInLocation', { hours: estimatedHours, location: listing.location })
                    : t('car.choosePickup')}
                </h2>
                <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
                  {datesChosen
                    ? t('car.dateAtTime', { date: formatDate(pickupDate!), time: pickupTime })
                    : t('car.pickADayHint')}
                </p>
                {listing.status === 'maintenance' && maintUntil && (
                  <Notice tone="warn" className="mt-3">
                    {t('car.inMaintenance', { date: formatDate(maintUntil) })}
                  </Notice>
                )}
                <div className="mt-4">
                  <DateRangeCalendar
                    single
                    months={1}
                    value={{ start: pickupDate, end: pickupDate }}
                    onChange={(r) => setPickupDate(r.start)}
                    minDate={pickupMin}
                    isUnavailable={isUnavailable}
                  />
                </div>
                <div className="mt-4 grid max-w-sm grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="pickup-time-detail">{t('car.pickupTimeLabel')}</Label>
                    <Input
                      id="pickup-time-detail"
                      type="time"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="estimated-hours-detail">{t('car.hoursLabel')}</Label>
                    <Input
                      id="estimated-hours-detail"
                      type="number"
                      min={1}
                      value={estimatedHours}
                      onChange={(e) => setEstimatedHours(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                </div>
                {datesChosen && (
                  <div className="mt-5 max-w-sm space-y-2 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-4 text-body-sm">
                    <div className="flex justify-between text-[var(--color-content-muted)]">
                      <span>
                        {money(listing.pricePerHourRwf ?? 0)} × {estimatedHours} hr
                        {estimatedHours === 1 ? '' : 's'}
                      </span>
                      <span className="tabular">{money(estimatedTotal)}</span>
                    </div>
                    <div className="flex justify-between border-t border-[var(--color-line)] pt-2 font-semibold text-[var(--color-content)]">
                      <span>{t('car.fullPriceEstimated')}</span>
                      <span className="tabular">{money(estimatedTotal)}</span>
                    </div>
                    <p className="pt-1 text-caption text-[var(--color-content-subtle)]">
                      {t('car.payNowHint', { amount: money(total) })}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="text-h3 text-[var(--color-content)]">
                  {datesChosen
                    ? nights === 1
                      ? t('car.nightInLocation', { location: listing.location })
                      : t('car.nightsInLocation', { count: nights, location: listing.location })
                    : t('car.chooseDates')}
                </h2>
                <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
                  {datesChosen
                    ? `${formatDate(range.start!)} – ${formatDate(range.end!)}`
                    : t('car.addDatesHint')}
                </p>
                {listing.status === 'maintenance' && maintUntil && (
                  <Notice tone="warn" className="mt-3">
                    {t('car.inMaintenance', { date: formatDate(maintUntil) })}
                  </Notice>
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
                    className="mt-3 text-body-sm font-medium text-brand-600 hover:underline"
                  >
                    {t('car.clearDates')}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: sticky booking panel (desktop). Price, trip dates, location,
            the one primary CTA — then cancellation policy and payment info
            below it, never above or beside it. */}
        <div>
          <Card className="hidden lg:sticky lg:top-20 lg:block">
            <CardBody className="space-y-4">
              <div className="flex items-baseline gap-1.5">
                <span className="text-h2 tabular text-[var(--color-content)]">
                  <Price amount={listingHeadlinePrice(listing).amount} currency={listing.priceCurrency} showNative />
                </span>
                <span className="text-body text-[var(--color-content-muted)]">
                  / {listingHeadlinePrice(listing).unit === 'day' ? t('car.unitDay') : t('car.unitHour')}
                </span>
              </div>
              {listing.status === 'maintenance' && (
                <Badge tone="warn">
                  {t('car.inMaintenanceBadge')}
                  {listing.maintenanceUntil
                    ? ` ${t('car.backOn', { date: formatDate(listing.maintenanceUntil) })}`
                    : ''}
                </Badge>
              )}
              {!canRent ? (
                <Notice tone="info">
                  {isCompany ? (
                    t('car.companyViewOnly')
                  ) : (
                    <>
                      {t('car.hostViewOnlyBefore')}
                      <Link to="/account" className="font-medium underline">
                        {t('account.profile').toLowerCase()}
                      </Link>
                      {t('car.hostViewOnlyAfter')}
                    </>
                  )}
                </Notice>
              ) : (
                <>
                  {/* Date fields — open the calendar below */}
                  {isHourlyListing ? (
                    <button
                      type="button"
                      onClick={goToCalendar}
                      className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] p-2.5 text-left text-body-sm hover:bg-[var(--color-surface-sunken)]"
                    >
                      <span className="block text-caption font-semibold uppercase tracking-wide text-[var(--color-content-muted)]">
                        {t('car.pickupField')}
                      </span>
                      <span className="text-[var(--color-content)]">
                        {pickupDate
                          ? `${formatDate(pickupDate)} at ${pickupTime} · ${estimatedHours}h`
                          : t('car.addPickupDetails')}
                      </span>
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line-strong)] text-body-sm">
                      <button
                        type="button"
                        onClick={goToCalendar}
                        className="border-r border-[var(--color-line-strong)] p-2.5 text-left hover:bg-[var(--color-surface-sunken)]"
                      >
                        <span className="block text-caption font-semibold uppercase tracking-wide text-[var(--color-content-muted)]">
                          {t('car.pickUpField')}
                        </span>
                        <span className="text-[var(--color-content)]">
                          {range.start ? formatDate(range.start) : t('car.addDate')}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={goToCalendar}
                        className="p-2.5 text-left hover:bg-[var(--color-surface-sunken)]"
                      >
                        <span className="block text-caption font-semibold uppercase tracking-wide text-[var(--color-content-muted)]">
                          {t('car.returnField')}
                        </span>
                        <span className="text-[var(--color-content)]">
                          {range.end ? formatDate(range.end) : t('car.addDate')}
                        </span>
                      </button>
                    </div>
                  )}

                  <p className="flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)]">
                    <MapPin size={14} /> {listing.location}
                  </p>

                  {/* The one accent on this screen — everything else on the
                      page is neutral or a tonal badge so this is the only
                      thing that reads as "act now". */}
                  <Button className="w-full" size="lg" onClick={reserve}>
                    {reserveLabel}
                  </Button>
                  <p className="text-center text-caption text-[var(--color-content-subtle)]">
                    {t('car.wontBeChargedYet')}
                  </p>

                  {datesChosen && isHourlyListing && (
                    <div className="space-y-2 border-t border-[var(--color-line)] pt-3 text-body-sm">
                      <div className="flex justify-between text-[var(--color-content-muted)]">
                        <span>
                          {money(listing.pricePerHourRwf ?? 0)} × {estimatedHours} hr
                          {estimatedHours === 1 ? '' : 's'} (full price)
                        </span>
                        <span className="tabular">{money(estimatedTotal)}</span>
                      </div>
                      <div className="flex justify-between text-[var(--color-content-muted)]">
                        <span>{t('car.depositPlusFee')}</span>
                        <span className="tabular">{money(total)}</span>
                      </div>
                      <div className="flex justify-between border-t border-[var(--color-line)] pt-2 font-semibold text-[var(--color-content)]">
                        <span>{t('car.dueNowLabel')}</span>
                        <span className="tabular">{money(total)}</span>
                      </div>
                    </div>
                  )}
                  {datesChosen && !isHourlyListing && (
                    <div className="space-y-2 border-t border-[var(--color-line)] pt-3 text-body-sm">
                      <div className="flex justify-between text-[var(--color-content-muted)]">
                        <span>
                          {money(listing.pricePerDayRwf ?? 0)} × {nights} night{nights === 1 ? '' : 's'}
                        </span>
                        <span className="tabular">{money(subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-[var(--color-content-muted)]">
                        <span>{t('car.serviceFeeLabel')}</span>
                        <span className="tabular">{money(serviceFee)}</span>
                      </div>
                      <div className="flex justify-between border-t border-[var(--color-line)] pt-2 font-semibold text-[var(--color-content)]">
                        <span>{t('car.totalLabel')}</span>
                        <span className="tabular">{money(total)}</span>
                      </div>
                    </div>
                  )}

                  {/* Cancellation policy + payment info — always below the
                      CTA, never competing with it. */}
                  <Notice tone="info" className="text-caption">
                    {t('car.freeCancellation')}
                  </Notice>
                  <Notice tone="info" className="text-caption">
                    <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                    {t('car.paymentHeldSecurely')}
                  </Notice>
                </>
              )}
              {canMessage && (
                <Button variant="outline" className="w-full" disabled={messaging} onClick={messageHost}>
                  <MessageSquare size={16} />
                  {messaging ? t('car.opening') : t('car.messageHost')}
                </Button>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Continue browsing — jump back to the list without losing your place. */}
      <div className="mt-6 flex flex-col items-center gap-2 border-t border-[var(--color-line)] pt-5 text-center">
        <p className="text-body-sm text-[var(--color-content-muted)]">{t('car.notTheOne')}</p>
        <Button variant="outline" pill onClick={backToBrowse}>
          <ArrowLeft size={16} /> {t('car.continueBrowsing')}
        </Button>
      </div>

      {/* Mobile sticky booking bar — the standard mobile booking pattern:
          price on the left, the one CTA on the right, fixed to the bottom so
          it's reachable without scrolling back up to the (hidden-on-mobile)
          sidebar card. */}
      {canRent && (
        <div className="fixed inset-x-0 bottom-[calc(var(--tab-bar-height)+env(safe-area-inset-bottom))] z-20 border-t border-[var(--color-line)] bg-[var(--color-surface-raised)]/95 px-4 py-3 shadow-[var(--shadow-float)] backdrop-blur md:bottom-0 lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="min-w-0">
              {datesChosen ? (
                <>
                  <p className="truncate text-body font-bold tabular text-[var(--color-content)]">
                    {money(total)}
                  </p>
                  <p className="text-caption text-[var(--color-content-muted)]">
                    {isHourlyListing
                      ? t('car.dueNowEstimated', { hours: estimatedHours, amount: money(estimatedTotal) })
                      : nights === 1
                        ? t('car.totalNight')
                        : t('car.totalNights', { count: nights })}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-body font-bold tabular text-[var(--color-content)]">
                    <Price amount={listingHeadlinePrice(listing).amount} currency={listing.priceCurrency} />
                  </p>
                  <p className="text-caption text-[var(--color-content-muted)]">
                    {listingHeadlinePrice(listing).unit === 'day' ? t('car.perDay') : t('car.perHour')}
                  </p>
                </>
              )}
            </div>
            <Button size="lg" className="shrink-0" onClick={reserve}>
              {reserveLabel}
            </Button>
          </div>
        </div>
      )}

      {lightbox !== null && (
        <Lightbox photos={photos} index={lightbox} onClose={() => setLightbox(null)} title={listing.title} />
      )}
    </section>
  );
}

/**
 * Turo-style gallery: one large hero photo on the left and two stacked tiles
 * on the right, with a single "View all N photos" pill over the whole block
 * (bottom-right) rather than a caption stamped on one arbitrary tile — it
 * reads as a gallery action, not a label on a random photo. Collapses to a
 * single swipeable photo on mobile via `PhotoCarousel`, the standard mobile
 * gallery pattern.
 */
function PhotoGallery({
  photos,
  title,
  onOpen,
}: {
  photos: string[];
  title: string;
  onOpen: (index: number) => void;
}) {
  const t = useT();
  if (photos.length === 0) return null;

  const [hero, ...rest] = photos;
  const tiles = rest.slice(0, 2);

  return (
    <div className="mt-4">
      {/* Mobile — single swipeable photo */}
      <div className="sm:hidden">
        <PhotoCarousel photos={photos} alt={title} heightClass="h-64" className="rounded-[var(--radius-card)]" />
      </div>

      {/* Desktop — one large photo left, two stacked right. Each photo is
          absolutely positioned inside its tile: an in-flow <img> with `h-full`
          has no definite height to resolve against in a grid row, so it falls
          back to its natural aspect ratio — an 800×600 photo at 827px wide
          grew the row to 628px, spilling out of the 420px block and over the
          title and the booking card. Taken out of flow, the photo can only
          fill the tile, never size it. */}
      <div className="relative hidden sm:block">
        <div className="grid h-[420px] grid-cols-[2fr_1fr] grid-rows-1 gap-2">
          <button
            type="button"
            onClick={() => onOpen(0)}
            className="group relative min-h-0 overflow-hidden rounded-[var(--radius-card)]"
          >
            <Img
              src={hero}
              alt={title}
              loading="eager"
              className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            />
          </button>
          <div className="grid min-h-0 grid-rows-2 gap-2">
            {[0, 1].map((i) => {
              const p = tiles[i];
              return p ? (
                <button
                  key={p}
                  type="button"
                  onClick={() => onOpen(i + 1)}
                  className="group relative min-h-0 overflow-hidden rounded-[var(--radius-card)]"
                >
                  <Img
                    src={p}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                </button>
              ) : (
                <div key={i} className="rounded-[var(--radius-card)] bg-[var(--color-surface-sunken)]" />
              );
            })}
          </div>
        </div>
        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => onOpen(0)}
            className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-raised)]/95 px-3.5 py-2 text-body-sm font-semibold text-[var(--color-content)] shadow-[var(--shadow-float)] backdrop-blur transition-colors hover:bg-[var(--color-surface-raised)]"
          >
            <Grid3x3 size={15} /> {t('car.viewAllPhotos', { count: photos.length })}
          </button>
        )}
      </div>
    </div>
  );
}

/** Share the listing via the Web Share sheet, falling back to copying the link. */
function ShareButton({ title }: { title: string }) {
  const t = useT();
  const share = async () => {
    const url = window.location.href;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        /* user dismissed the share sheet */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('car.linkCopied'));
    } catch {
      toast.error(t('car.linkCopyFailed'));
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-line-strong)] px-3 py-2 text-body-sm font-medium text-[var(--color-content-muted)] transition-colors hover:bg-[var(--color-surface-sunken)]"
    >
      <Share2 size={16} /> <span className="hidden sm:inline">{t('car.share')}</span>
    </button>
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
  const t = useT();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label={t('common.close')}
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
          aria-label={t('car.previousPhoto')}
        >
          <ChevronLeft size={26} />
        </button>
      )}
      <Img
        src={photos[i]}
        alt={title}
        loading="eager"
        className="max-h-[85vh] max-w-[90vw] rounded-[var(--radius-card)] object-contain"
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
          aria-label={t('car.nextPhoto')}
        >
          <ChevronRight size={26} />
        </button>
      )}
      <span className="tabular absolute bottom-4 text-body-sm text-white/80">
        {i + 1} / {photos.length}
      </span>
    </div>
  );
}

/** A vehicle fact — seats, fuel, transmission, category — as a bordered pill. */
/**
 * Loaded-layout stand-in for the initial `getListing` fetch — same gallery
 * grid, title block and sticky reserve panel shapes as the real page, so
 * nothing jumps once the listing arrives. Only the data-dependent content is
 * blocked out; the back-to-browse affordance above it needs no listing data,
 * so it isn't duplicated here.
 */
function CarDetailSkeleton() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-5 pb-[calc(7rem+var(--tab-bar-height))] md:pb-28 lg:pb-8" aria-busy="true" aria-label="Loading">
      {/* Gallery — hero + two stacked tiles on desktop, one block on mobile */}
      <div className="mt-4">
        <div className="sm:hidden">
          <Skeleton className="h-64 w-full rounded-[var(--radius-card)]" />
        </div>
        <div className="hidden h-[420px] grid-cols-[2fr_1fr] gap-2 sm:grid">
          <Skeleton className="h-full w-full rounded-[var(--radius-card)]" />
          <div className="grid grid-rows-2 gap-2">
            <Skeleton className="h-full w-full rounded-[var(--radius-card)]" />
            <Skeleton className="h-full w-full rounded-[var(--radius-card)]" />
          </div>
        </div>
      </div>

      {/* Title block — h1-height line, subtitle line, meta line */}
      <div className="mt-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-7 w-2/3 max-w-sm" />
          <Skeleton className="mt-2 h-4 w-44" />
          <Skeleton className="mt-2.5 h-4 w-56" />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left: overview + spec chips + a paragraph block */}
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-4 pb-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-11 w-11 rounded-[var(--radius-pill)]" />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-line)] py-5">
            <Skeleton className="h-9 w-24 rounded-[var(--radius-pill)]" />
            <Skeleton className="h-9 w-24 rounded-[var(--radius-pill)]" />
            <Skeleton className="h-9 w-28 rounded-[var(--radius-pill)]" />
            <Skeleton className="h-9 w-24 rounded-[var(--radius-pill)]" />
          </div>
          <div className="space-y-3 border-t border-[var(--color-line)] py-5">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>

        {/* Right: the sticky reserve panel's shape — price line, two field
            blocks, a button-height block. Same `hidden lg:block` breakpoint
            as the loaded panel so it doesn't flash on mobile. */}
        <div>
          <Card className="hidden lg:sticky lg:top-20 lg:block">
            <CardBody className="space-y-4">
              <Skeleton className="h-8 w-32" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
              <Skeleton className="h-11 w-full" />
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
}

function SpecChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] px-3.5 text-body-sm font-medium capitalize text-[var(--color-content-muted)]">
      <Icon size={15} className="text-[var(--color-content-subtle)]" />
      {label}
    </span>
  );
}

/**
 * Owner-only: who has requested this car. Shown to the host — individual or
 * company — right on the listing, so they can see and vet each requester
 * (profile + verification documents) before approving.
 */
function OwnerRequests({ listingId, priceCurrency }: { listingId: string; priceCurrency: string }) {
  const t = useT();
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
      toast.success(action === 'approve' ? t('car.requestApproved') : t('car.requestDeclined'));
    },
    onError: () => toast.error(t('car.requestUpdateFailed')),
  });

  if (isLoading) return null;

  return (
    <div className="border-b border-[var(--color-line)] pb-6">
      <h2 className="text-h3 text-[var(--color-content)]">
        {t('car.requestsForThisCar')}
        {requests.length > 0 && <span className="text-[var(--color-content-subtle)]"> ({requests.length})</span>}
      </h2>
      {requests.length === 0 ? (
        <p className="mt-2 text-body-sm text-[var(--color-content-muted)]">{t('car.noPendingRequests')}</p>
      ) : (
        <>
          <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">{t('car.reviewRequestsHint')}</p>
          <div className="mt-4 space-y-3">
            {requests.map((b) => (
              <RequesterRow
                key={b.id}
                booking={b}
                currency={bookingCurrency(b, { priceCurrency })}
                onReview={() => setActiveBooking(b)}
              />
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
function RequesterRow({
  booking,
  currency,
  onReview,
}: {
  booking: Booking;
  /** The car's currency — the booking total is in it, not RWF. */
  currency: string;
  onReview: () => void;
}) {
  const t = useT();
  const { data: p } = useQuery({
    queryKey: ['profile', booking.renterId],
    queryFn: () => client.getProfile(booking.renterId),
  });
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-line)] p-3 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <Avatar name={p?.fullName ?? t('car.renterFallback')} src={p?.avatarUrl} size="md" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--color-content)]">
            {p?.fullName ?? t('car.renterFallback')}
            {p && (
              <Badge tone={VERIF_TONE[p.verification] ?? 'neutral'}>
                <ShieldCheck size={11} /> {p.verification}
              </Badge>
            )}
          </p>
          <p className="text-body-sm text-[var(--color-content-muted)]">
            {formatDate(booking.startDate)} – {formatDate(booking.endDate)} ·{' '}
            <span className="tabular">{formatAmount(booking.totalRwf, currency)}</span>
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onReview}>
        <UserRound size={15} /> {t('car.reviewAndDecide')}
      </Button>
    </div>
  );
}
