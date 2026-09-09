import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  Calendar,
  CalendarCheck,
  Cog,
  CreditCard,
  Fuel,
  Lock,
  MapPin,
  ShieldCheck,
  Smartphone,
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { client } from '@/lib/client';
import { useCanRent, useIsBusinessHost } from '@/lib/account';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useBackToBrowse } from '@/lib/useBackToBrowse';
import { useCountry } from '@/lib/country';
import { cn } from '@/lib/cn';
import { getSupabase } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { formatDate } from '@/lib/format';
import { formatMoney, isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import {
  PAYMENTS_EXTERNAL,
  PAYMENTS_LIVE,
  PAYMENTS_PAYHOLD,
  isAfricanMarket,
} from '@/lib/payments';
import {
  AcceptedCards,
  AirtelMark,
  AmexMark,
  DiscoverMark,
  MastercardMark,
  MomoMark,
  StripeWordmark,
  VisaMark,
} from '@/components/PaymentBrands';
import { PayholdPayment } from '@/components/PayholdPayment';
import { Img } from '@/components/Img';
import { Avatar, Badge, Button, Card, CardBody, Input, Label, Notice, Select, Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';

type Method = 'card' | 'momo';

function diffDays(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Add `n` days to an ISO date (yyyy-mm-dd) and return the ISO date. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A3 — "Confirm and pay" checkout. Dates arrive prefilled from the detail page's
 * calendar (router state); the renter picks a payment method on the left and
 * sees the order summary on the right. On pay it creates the booking via the
 * data client and routes to the new trip.
 */
export function BookingPage() {
  const t = useT();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const backToBrowse = useBackToBrowse();
  const location = useLocation();
  const queryClient = useQueryClient();
  const canRent = useCanRent();
  const isCompany = useIsBusinessHost();
  // `isLoading` matters as much as the data here. Every gate below this point
  // — canRent, isCompany, and the verification check — reads the same profile,
  // and each one defaults OPEN while it is in flight: `useCanRent` returns
  // true for a missing profile (lib/account.ts), and the verification guard is
  // `me && …`, so it simply does not fire yet. Rendering the checkout during
  // that window put a live Pay button in front of hosts, company accounts and
  // unverified renters for as long as the profile took to arrive, then yanked
  // it away. The server and PayHold both refuse those payments, so nothing
  // could actually be charged — but being offered a button that is about to
  // vanish is exactly the "click without anything" this page was reported for.
  const { data: me, isLoading: meLoading } = useCurrentUser();

  const picked = location.state as
    | { startDate?: string; endDate?: string; pickupTime?: string; estimatedHours?: number }
    | null;
  const [startDate] = useState(() => picked?.startDate ?? addDays(todayISO(), 1));
  const [endDate] = useState(() => picked?.endDate ?? addDays(todayISO(), 4));
  const [method, setMethod] = useState<Method>('card');

  // Every booking now carries a pickup time — it's what a late daily return is
  // measured against, and what an hourly booking's timer starts from. Seeded
  // from the car detail page's calendar when it set one, but still editable
  // here in case this page is reached directly.
  const [pickupTime, setPickupTime] = useState(picked?.pickupTime ?? '10:00');
  const [estimatedHours, setEstimatedHours] = useState(picked?.estimatedHours ?? 4);
  // A deal prices the hourly estimate once, at creation — nothing re-prices
  // it if this input keeps changing under an open (or just-paid) checkout,
  // so it's locked for as long as PayholdPayment reports one exists. Pickup
  // time is deliberately NOT locked here: it plays no part in what a deal
  // charges (only estimatedHours does), so changing it after checkout starts
  // is harmless and a renter correcting a typo shouldn't be blocked from it.
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const { data: listing, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => client.getListing(id),
  });
  // Deliberately not part of the page's loading gate: the host's name is not
  // something a renter needs before they can pay, and blocking the whole
  // checkout on a second round trip would be a worse trade. It reserves its
  // own space instead, so arriving late does not shove the price block down
  // the summary while someone is reading the total.
  const { data: host, isLoading: hostLoading } = useQuery({
    queryKey: ['host', listing?.hostId],
    queryFn: () => client.getHost(listing!.hostId),
    enabled: !!listing,
  });

  const mutation = useMutation({
    // A payment identifies itself differently per rail: a Stripe PaymentIntent
    // id, or a hold reference from the external system. Either way the server
    // re-reads it — this is only a pointer, never a claim that it succeeded.
    mutationFn: async (ref?: { paymentIntentId?: string; reference?: string }) => {
      const booking = await client.confirmBooking({ listingId: id, startDate, endDate, ...ref });
      try {
        const conv = await client.getOrCreateConversation(booking.listingId, booking.renterId, booking.hostId);
        await client.sendMessage(
          conv.id,
          `Hi! I just ${instant ? 'booked' : 'requested'} ${listing?.title ?? 'your car'} for ` +
            `${startDate} to ${endDate}.`,
        );
      } catch {
        /* messaging is best-effort — never block the booking on it */
      }
      return booking;
    },
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate(`/trips/${booking.id}`);
    },
  });

  // Back from a hosted payment page (Flutterwave, or the external system's) —
  // in both cases their webhook is what creates the trip, not this page.
  const params = new URLSearchParams(location.search);
  if (params.get('flw') || params.get('ext')) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <ShieldCheck size={22} />
        </span>
        <p className="mt-4 font-semibold text-[var(--color-content)]">Payment received</p>
        <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
          We're confirming your payment and creating your trip — it'll appear in My trips shortly.
        </p>
        <Link to="/trips" className="mt-5 inline-block">
          <Button size="lg">Go to My trips</Button>
        </Link>
      </div>
    );
  }

  // Wait for the car AND for who is asking. Splitting these let the page paint
  // a complete, interactive checkout against a profile that had not landed —
  // see the gates below, all of which are permissive until it does.
  if (isLoading || meLoading) {
    return <BookingSkeleton />;
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

  // Hosts and company accounts are host-only: they can view any car but never
  // check out. The Edge Functions and a DB trigger enforce the same rule, so a
  // direct link to this page can't turn into a booking.
  if (!canRent) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-[var(--color-content)]">
          {isCompany ? t('booking.companyCantRent') : t('booking.hostCantRent')}
        </p>
        <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
          {isCompany ? (
            t('booking.companyHostOnly')
          ) : (
            <>
              {t('booking.hostAccountBefore')}
              <Link to="/account" className="text-brand-600 hover:underline">
                {t('account.profile').toLowerCase()}
              </Link>
              {t('booking.hostAccountAfter')}
            </>
          )}
        </p>
        <Link to={`/cars/${id}`} className="mt-3 inline-block text-body-sm text-brand-600 hover:underline">
          {t('booking.backToCar')}
        </Link>
      </div>
    );
  }

  // Only identity-verified renters can rent. The car detail page blocks earlier,
  // but this guards a direct link to the checkout, and the server enforces it too.
  if (me && me.verification !== 'verified') {
    const underReview = me.verification === 'pending';
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <ShieldCheck size={22} />
        </span>
        <p className="mt-4 font-semibold text-[var(--color-content)]">
          {underReview ? t('booking.verificationInReview') : t('booking.verifyToRentTitle')}
        </p>
        <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
          {underReview
            ? t('booking.verificationInReviewBody')
            : me.verification === 'rejected'
              ? t('booking.verificationRejectedBody')
              : t('booking.verificationNeededBody')}
        </p>
        <Link to="/verification" className="mt-5 inline-block">
          <Button size="lg">
            <ShieldCheck size={16} /> {underReview ? t('booking.viewStatus') : t('booking.verifyNow')}
          </Button>
        </Link>
        <div>
          <Link to={`/cars/${id}`} className="mt-3 inline-block text-body-sm text-brand-600 hover:underline">
            {t('booking.backToCar')}
          </Link>
        </div>
      </div>
    );
  }

  const today = todayISO();
  const inMaintenance = listing.status === 'maintenance';
  const maintUntil = listing.maintenanceUntil ?? undefined;
  const afterMaintenance = !inMaintenance || (!!maintUntil && startDate >= maintUntil);
  // An hourly booking picks one pickup day, not a range — the detail page's
  // calendar sends startDate === endDate for it (see CarDetailPage.tsx's
  // navigate state). Requiring endDate > startDate unconditionally rejected
  // every hourly booking regardless of what the calendar showed.
  const datesValid = listing.pricingMode === 'hourly'
    ? startDate >= today && afterMaintenance
    : new Date(endDate) > new Date(startDate) && startDate >= today && afterMaintenance;

  const days = diffDays(startDate, endDate);
  // A car is priced by the day or by the hour, never both — fixed by the
  // listing, not a choice made on this page.
  const isHourly = listing.pricingMode === 'hourly';
  // For an hourly booking this is an ESTIMATE, charged in full now, same as
  // a daily booking's fixed total. Any time beyond it is settled against
  // actual pickup-to-return time once the trip completes — collected
  // automatically by PayHold on a card, or claimed by the host directly on a
  // method with no reusable credential (mobile money). Running short of the
  // estimate is refunded; PayHold's own overage collection can only add to
  // what was charged, never subtract.
  const estimatedTotal = isHourly
    ? estimatedHours * (listing.pricePerHourRwf ?? 0)
    : (listing.pricePerDayRwf ?? 0) * days;
  const subtotal = estimatedTotal;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee;
  // Amounts stay in the currency the host set the car in — never re-denominated
  // by the renter's nationality or their header market selection.
  const cur: CurrencyCode = isCurrencyCode(listing.priceCurrency) ? listing.priceCurrency : 'RWF';
  const money = (n: number) => formatMoney(n, cur);
  // What an extra hour costs on a daily booking, past the 2-hour grace. The
  // multiplier applies to an implied hourly price the host's own form defines
  // as day ÷ 24, and falls back to it here for listings that never stored one
  // — the same rule `payhold-create-deal` bills by, so the figure quoted here
  // is the figure charged. Quoted at all because it never was: this line used
  // to send renters to "the car's listing", which says nothing about it.
  const lateReturnRate = Math.round(
    (listing.pricePerHourRwf && listing.pricePerHourRwf > 0
      ? listing.pricePerHourRwf
      : (listing.pricePerDayRwf ?? 0) / 24) * (listing.overageMultiplier ?? 2),
  );
  const instant = true;
  const superhost = host?.ratingAvg !== undefined && host.ratingAvg >= 4.8 && (host.ratingCount ?? 0) >= 5;

  // African-market cars accept mobile money and route to Flutterwave; others are
  // card-only via Stripe. `africanLive` is the real hosted-Flutterwave checkout.
  const isAfrican = isAfricanMarket(listing.country);
  const africanLive = PAYMENTS_LIVE && isAfrican;

  const stripePromise = getStripe();
  const demo = !stripePromise;
  const payProps: PayProps = {
    listingId: id,
    startDate,
    endDate,
    totalRwf: total,
    currency: cur,
    instant,
    onPaid: (pi?: string) => mutation.mutateAsync(pi ? { paymentIntentId: pi } : undefined),
    onHeld: (reference: string) => mutation.mutateAsync({ reference }),
  };

  // Rails that hand the method choice to a modal or a provider page show no
  // method rows here — so the accepted-card tiles are the only thing telling a
  // renter their card is welcome before they commit. The picker rails already
  // carry the same marks row by row; a second strip there would just repeat it.
  const pickerless = PAYMENTS_PAYHOLD || PAYMENTS_EXTERNAL || africanLive;

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:py-9">
      <button
        type="button"
        onClick={() => navigate(`/cars/${id}`)}
        aria-label={t('common.back')}
        className="mb-5 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-content-muted)] transition hover:bg-[var(--color-surface-sunken)]"
      >
        <ArrowLeft size={18} />
      </button>

      <h1 className="text-h1 text-[var(--color-content)]">{t('booking.confirmAndPay')}</h1>
      <p className="mt-1.5 max-w-xl text-body-sm text-[var(--color-content-muted)]">
        {t('booking.confirmAndPaySubtitle')}
      </p>

      <div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-[1fr_minmax(0,400px)] lg:gap-9">
        {/* Left: payment methods */}
        <div className="min-w-0 space-y-5">
          <Card>
            <CardBody className="space-y-4 p-5 sm:p-6">
              <div>
                <h2 className="text-h3 text-[var(--color-content)]">
                  {t('booking.whenPickingUp')}
                </h2>
                <p className="mt-1 text-body-sm text-[var(--color-content-muted)]">
                  {isHourly
                    ? t('booking.lateReturnHourly')
                    : t('booking.lateReturnDaily', { date: formatDate(endDate), amount: money(lateReturnRate) })}
                </p>
              </div>
              <div>
                <Label htmlFor="pickup-time">{t('car.pickupTimeLabel')}</Label>
                <Input
                  id="pickup-time"
                  type="time"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                />
              </div>
              {PAYMENTS_PAYHOLD && isHourly && (
                <div>
                  <Label htmlFor="estimated-hours">{t('booking.howManyHours')}</Label>
                  <Input
                    id="estimated-hours"
                    type="number"
                    min={1}
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(Math.max(1, Number(e.target.value) || 1))}
                    disabled={checkoutOpen}
                  />
                  <p className="mt-1 text-caption text-[var(--color-content-subtle)]">
                    {checkoutOpen
                      ? t('booking.lockedForCheckout')
                      : t('booking.payEstimatedNow', { amount: money(estimatedTotal) })}
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-5 sm:p-6">
              <h2 className="text-h3 text-[var(--color-content)]">
                {t('booking.howToPay')}
              </h2>
              <p className="mb-4 mt-1 text-body-sm text-[var(--color-content-muted)]">
                {pickerless
                  ? t('booking.choosePayOnNextStep')
                  : 'Pick a method below and enter your details.'}
              </p>

              {!datesValid && (
                <Notice tone="danger" className="mb-4">
                  {t('booking.datesNotAvailable')}{' '}
                  <Link to={`/cars/${id}`} className="font-medium underline">
                    {t('booking.chooseDifferentDates')}
                  </Link>
                  .
                </Notice>
              )}

              {PAYMENTS_PAYHOLD ? (
                <PayholdPayment
                  listingId={id}
                  startDate={startDate}
                  endDate={endDate}
                  pickupTime={pickupTime}
                  rentalType={isHourly ? 'hourly' : 'daily'}
                  estimatedHours={isHourly ? estimatedHours : undefined}
                  listingCurrency={cur}
                  label={money(total)}
                  disabled={!datesValid}
                  onCheckoutOpenChange={setCheckoutOpen}
                />
              ) : PAYMENTS_EXTERNAL ? (
                <Elements stripe={stripePromise}>
                  <ExternalPay {...payProps} disabled={!datesValid} />
                </Elements>
              ) : africanLive ? (
                <FlutterwavePay
                  listingId={id}
                  startDate={startDate}
                  endDate={endDate}
                  label={money(total)}
                  disabled={!datesValid}
                  onDemoFallback={() => mutation.mutateAsync(undefined)}
                />
              ) : (
              <div>
                {/* Card */}
                <MethodRow
                  selected={method === 'card'}
                  onSelect={() => setMethod('card')}
                  icon={<CreditCard size={20} />}
                  label="Credit or debit card"
                  marks={
                    <>
                      <VisaMark />
                      <MastercardMark />
                      <AmexMark />
                      <DiscoverMark />
                    </>
                  }
                >
                  {demo ? (
                    <DemoPayForm {...payProps} method="card" disabled={!datesValid} />
                  ) : (
                    <Elements stripe={stripePromise}>
                      <CardForm {...payProps} disabled={!datesValid} />
                    </Elements>
                  )}
                </MethodRow>

                {/* Mobile money — only where it's actually settled (African markets). */}
                {isAfrican && (
                  <MethodRow
                    selected={method === 'momo'}
                    onSelect={() => setMethod('momo')}
                    icon={<Smartphone size={20} />}
                    label="Mobile Money"
                    marks={
                      <>
                        <MomoMark />
                        <AirtelMark />
                      </>
                    }
                  >
                    {demo ? (
                      <DemoPayForm {...payProps} method="momo" disabled={!datesValid} />
                    ) : (
                      <MomoForm totalRwf={total} currency={cur} />
                    )}
                  </MethodRow>
                )}
              </div>
              )}

              {/* The cards we take, drawn where the renter is deciding. On the
                  picker rails the method rows already carry these marks. */}
              {pickerless && (
                <div className="mt-5 border-t border-[var(--color-line)] pt-4">
                  <p className="text-caption font-semibold uppercase tracking-wider text-[var(--color-content-subtle)]">
                    {t('payment.cardsAccepted')}
                  </p>
                  <AcceptedCards className="mt-2.5" />
                </div>
              )}

              {/* Provider attribution — Flutterwave for African markets, Stripe
                  otherwise. Not on the PayHold rail: it names card, MTN and
                  Airtel whatever the renter's country is, and the marks above
                  now say the same thing truthfully. */}
              {!africanLive && !PAYMENTS_EXTERNAL && !PAYMENTS_PAYHOLD && (
                isAfrican ? (
                  <p className="mt-4 text-center text-caption text-[var(--color-content-subtle)]">
                    Payments secured — card, MTN MoMo &amp; Airtel Money.
                  </p>
                ) : (
                  <p className="mt-4 flex items-center justify-center gap-1.5 text-caption text-[var(--color-content-subtle)]">
                    Card payments secured by <StripeWordmark className="text-caption" />
                  </p>
                )
              )}
            </CardBody>
          </Card>

          {/* Why this is safe — the questions a renter asks themselves right
              before pressing Pay, answered on the page instead of in a help
              centre they would have to go looking for. */}
          <Card>
            <CardBody className="p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-body font-semibold text-[var(--color-content)]">
                <ShieldCheck size={18} className="text-brand-600" />
                {t('booking.yourPaymentProtected')}
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <SafetyPoint
                  icon={<Lock size={16} />}
                  title={t('booking.encryptedTitle')}
                  body={t('booking.encryptedBody')}
                />
                <SafetyPoint
                  icon={<Wallet size={16} />}
                  title={t('booking.heldTitle')}
                  body={t('booking.heldBody')}
                />
                <SafetyPoint
                  icon={<CalendarCheck size={16} />}
                  title={t('booking.freeCancellationTitle')}
                  body={t('booking.freeCancellationBody', { date: formatDate(startDate), amount: money(total) })}
                />
                <SafetyPoint
                  icon={<BadgeCheck size={16} />}
                  title={t('booking.verifiedPeopleTitle')}
                  body={t('booking.verifiedPeopleBody')}
                />
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Right: order summary. The car leads it — at a size where you can see
            which car you are about to spend on, with the title, the place and
            the specs spelled out rather than truncated into a hint. */}
        <div>
          <Card className="overflow-hidden lg:sticky lg:top-20">
            <div className="relative">
              <Img
                src={listing.photos[0]}
                alt={listing.title}
                className="aspect-[16/9] w-full object-cover"
              />
              {superhost && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--color-surface-raised)]/95 px-2.5 py-1 text-caption font-semibold text-[var(--color-content)] shadow-[var(--shadow-float)] backdrop-blur">
                  <Award size={13} className="text-brand-600" /> {t('booking.topRatedHostBadge')}
                </span>
              )}
            </div>

            <CardBody className="space-y-4 p-5 sm:p-5">
              <div>
                <h2 className="text-h4 leading-snug text-[var(--color-content)]">{listing.title}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-[var(--color-content-muted)]">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={13} className="text-[var(--color-content-subtle)]" />
                    {listing.location}
                  </span>
                  {listing.ratingCount ? (
                    <span className="inline-flex items-center gap-1 font-medium text-[var(--color-content)]">
                      <Star size={13} className="fill-[var(--color-content)] text-[var(--color-content)]" />
                      {listing.ratingAvg?.toFixed(2)}
                      <span className="font-normal text-[var(--color-content-muted)]">
                        (
                        {listing.ratingCount === 1
                          ? t('car.tripCount')
                          : t('car.tripsCount', { count: listing.ratingCount })}
                        )
                      </span>
                    </span>
                  ) : (
                    <span>{t('car.newListing')}</span>
                  )}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <SpecChip icon={<Users size={12} />} label={t('car.seats', { count: listing.seats })} />
                  <SpecChip icon={<Cog size={12} />} label={listing.transmission} />
                  <SpecChip icon={<Fuel size={12} />} label={listing.fuel} />
                  <SpecChip icon={<Calendar size={12} />} label={`${listing.year}`} />
                </div>
              </div>

              {hostLoading ? (
                <div className="flex items-center gap-2.5 border-t border-[var(--color-line)] pt-3.5">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ) : host ? (
                <div className="flex items-center gap-2.5 border-t border-[var(--color-line)] pt-3.5">
                  <Avatar name={host.businessName || host.fullName} src={host.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-[var(--color-content)]">
                      {t('car.hostedBy', { name: host.businessName || host.fullName })}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="flex items-start justify-between border-t border-[var(--color-line)] pt-3.5">
                <div>
                  <p className="text-body-sm font-semibold text-[var(--color-content)]">{t('booking.yourTrip')}</p>
                  <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
                    {formatDate(startDate)} – {formatDate(endDate)} at {pickupTime}
                  </p>
                  <p className="text-body-sm text-[var(--color-content-muted)]">
                    {isHourly
                      ? estimatedHours === 1
                        ? t('booking.hourlyBilledOnUseOne')
                        : t('booking.hourlyBilledOnUse', { hours: estimatedHours })
                      : days === 1
                        ? t('booking.dayFreeCancellation', { date: formatDate(startDate) })
                        : t('booking.daysFreeCancellation', { count: days, date: formatDate(startDate) })}
                  </p>
                </div>
                <Link
                  to={`/cars/${id}`}
                  className="shrink-0 text-body-sm font-medium text-brand-600 hover:underline"
                >
                  {t('booking.change')}
                </Link>
              </div>

              <div className="border-t border-[var(--color-line)] pt-3.5">
                <p className="text-body-sm font-semibold text-[var(--color-content)]">{t('booking.priceDetails')}</p>
                <div className="mt-2 space-y-1.5 text-body-sm">
                  {isHourly ? (
                    <div className="flex justify-between text-[var(--color-content-muted)]">
                      <span>
                        {money(listing.pricePerHourRwf ?? 0)} × {estimatedHours} hr
                        {estimatedHours === 1 ? '' : 's'} (estimated)
                      </span>
                      <span className="tabular">{money(subtotal)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between text-[var(--color-content-muted)]">
                      <span>
                        {money(listing.pricePerDayRwf ?? 0)} × {days} day{days === 1 ? '' : 's'}
                      </span>
                      <span className="tabular">{money(subtotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[var(--color-content-muted)]">
                    <span>{t('car.serviceFeeLabel')}</span>
                    <span className="tabular">{money(serviceFee)}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-[var(--color-line)] pt-2.5 font-bold text-[var(--color-content)]">
                    <span className="text-body">{isHourly ? t('car.dueNowLabel') : t('car.totalLabel')}</span>
                    <span className="text-h4 tabular">{money(total)}</span>
                  </div>
                  {isHourly && (
                    <p className="text-body-sm text-[var(--color-content-muted)]">
                      {t('booking.settledAfterTrip')}
                    </p>
                  )}
                </div>
                <Notice tone="brand" className="mt-3.5 leading-relaxed">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                  <span>
                    <span className="font-semibold">{t('booking.paymentHeldSecurelyTitle')}</span>{' '}
                    {t('booking.paymentHeldSecurelyBody')}
                  </span>
                </Notice>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
}

/**
 * Loaded-layout stand-in for the initial `getListing` fetch — the "Confirm
 * and pay" heading is static copy, so it's kept live; everything below it
 * needs the listing and is blocked out in the same three-card left column
 * plus sticky order-summary shape as the real page.
 */
function BookingSkeleton() {
  const t = useT();
  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:py-9" aria-busy="true" aria-label={t('common.loading')}>
      <div className="mb-5 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-content-muted)]">
        <ArrowLeft size={18} />
      </div>

      <h1 className="text-h1 text-[var(--color-content)]">{t('booking.confirmAndPay')}</h1>
      <p className="mt-1.5 max-w-xl text-body-sm text-[var(--color-content-muted)]">
        {t('booking.confirmAndPaySubtitle')}
      </p>

      <div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-[1fr_minmax(0,400px)] lg:gap-9">
        {/* Left: payment methods */}
        <div className="min-w-0 space-y-5">
          <Card>
            <CardBody className="space-y-4 p-5 sm:p-6">
              <Skeleton className="h-5 w-56" />
              <div>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-1.5 h-11 w-full" />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-5 sm:p-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-4 h-16 w-full" />
              <Skeleton className="mt-3 h-16 w-full" />
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-5 sm:p-6">
              <Skeleton className="h-5 w-64" />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            </CardBody>
          </Card>
        </div>

        {/* Right: order summary — photo, title/specs, then the price-details
            block, matching the sticky card's own breakpoint and structure. */}
        <div>
          <Card className="overflow-hidden lg:sticky lg:top-20">
            <Skeleton className="aspect-[16/9] w-full rounded-none" />
            <CardBody className="space-y-4 p-5 sm:p-5">
              <div>
                <Skeleton className="h-5 w-48" />
                <Skeleton className="mt-2 h-4 w-32" />
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Skeleton className="h-6 w-16 rounded-[var(--radius-pill)]" />
                  <Skeleton className="h-6 w-20 rounded-[var(--radius-pill)]" />
                  <Skeleton className="h-6 w-16 rounded-[var(--radius-pill)]" />
                  <Skeleton className="h-6 w-14 rounded-[var(--radius-pill)]" />
                </div>
              </div>
              <div className="space-y-2 border-t border-[var(--color-line)] pt-3.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
}

/** One reassurance in the "Your payment is protected" grid. */
function SafetyPoint({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-body-sm font-medium text-[var(--color-content)]">{title}</p>
        <p className="mt-0.5 text-body-sm leading-relaxed text-[var(--color-content-muted)]">{body}</p>
      </div>
    </div>
  );
}

/** A small fact about the car — seats, gearbox, fuel, year. */
function SpecChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-sunken)] px-2 py-0.5 text-caption font-medium capitalize text-[var(--color-content-muted)]">
      <span className="text-[var(--color-content-subtle)]">{icon}</span>
      {label}
    </span>
  );
}

/** A selectable payment-method row with a radio on the right and an expandable body. */
function MethodRow({
  selected = false,
  onSelect,
  disabled = false,
  icon,
  label,
  marks,
  children,
}: {
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  marks?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('border-b border-[var(--color-line)] last:border-0', disabled && 'opacity-60')}>
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        disabled={disabled}
        className="flex w-full items-center gap-3 py-4 text-left disabled:cursor-not-allowed"
      >
        <span className="text-[var(--color-content-muted)]">{icon}</span>
        <span className="flex-1">
          <span className="flex items-center gap-2 font-medium text-[var(--color-content)]">
            {label}
            {disabled && <Badge tone="neutral">Coming soon</Badge>}
          </span>
          {marks && <span className="mt-1 flex flex-wrap items-center gap-1.5">{marks}</span>}
        </span>
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
            selected ? 'border-[var(--color-surface-inverse)]' : 'border-[var(--color-line-strong)]',
          )}
        >
          {selected && <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-surface-inverse)]" />}
        </span>
      </button>
      {selected && !disabled && children && <div className="pb-5">{children}</div>}
    </div>
  );
}

interface PayProps {
  listingId: string;
  startDate: string;
  endDate: string;
  /** Total in the listing's native currency (whatever the host set). */
  totalRwf: number;
  /** The listing's currency — the amount is shown and charged in this. */
  currency: CurrencyCode;
  instant: boolean;
  /** Create the booking once payment succeeds. In demo mode the id is omitted. */
  onPaid: (paymentIntentId?: string) => Promise<unknown>;
  /** Create the booking from an external-system hold reference. */
  onHeld: (reference: string) => Promise<unknown>;
}

/** Country/region + postal-code billing fields shared by card forms. */
function BillingFields({
  country,
  setCountry,
  zip,
  setZip,
}: {
  country: string;
  setCountry: (c: string) => void;
  zip: string;
  setZip: (z: string) => void;
}) {
  const { countries } = useCountry();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="bill-country">Country / region</Label>
        <Select id="bill-country" value={country} onChange={(e) => setCountry(e.target.value)}>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="bill-zip">ZIP / postal code</Label>
        <Input id="bill-zip" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="Optional" />
      </div>
    </div>
  );
}

/**
 * Flutterwave checkout for African-market cars — one button that starts a hosted
 * card/mobile-money payment and redirects. If the server has no Flutterwave key,
 * it falls back to the demo confirm so the flow still completes.
 */
function FlutterwavePay({
  listingId,
  startDate,
  endDate,
  label,
  disabled,
  onDemoFallback,
}: {
  listingId: string;
  startDate: string;
  endDate: string;
  label: string;
  disabled: boolean;
  onDemoFallback: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await client.startFlutterwaveCollection({ listingId, startDate, endDate });
      if (res.link) {
        window.location.href = res.link;
        return;
      }
      await onDemoFallback(); // server in demo mode — no hosted link
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] p-3">
        <Smartphone size={20} className="text-brand-600" />
        <CreditCard size={20} className="text-brand-600" />
        <p className="text-body-sm text-[var(--color-content-muted)]">Pay with your card, MTN MoMo or Airtel Money.</p>
      </div>
      <p className="text-caption text-[var(--color-content-subtle)]">
        You'll be taken to our secure payment partner to complete payment, then brought back here.
      </p>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="w-full" size="lg" onClick={pay} disabled={busy || disabled}>
        {busy ? 'Redirecting…' : `Pay ${label}`}
      </Button>
    </div>
  );
}

/** Demo checkout — used when no payment provider is configured. No real charge. */
function DemoPayForm({ totalRwf, currency, onPaid, method, disabled }: PayProps & { method: Method; disabled: boolean }) {
  const { country: initial } = useCountry();
  const [country, setCountry] = useState(initial.code);
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      await onPaid();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not confirm the booking.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {method === 'card' && (
        <>
          <Input placeholder="Card number" disabled />
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Expiration" disabled />
            <Input placeholder="CVV" disabled />
          </div>
          <BillingFields country={country} setCountry={setCountry} zip={zip} setZip={setZip} />
        </>
      )}
      <Notice tone="warn">
        Demo mode — no real {method === 'card' ? 'card' : 'mobile money'} charge. Confirming creates the booking instantly.
      </Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="w-full" size="lg" onClick={pay} disabled={busy || disabled}>
        {busy ? 'Processing…' : `Confirm and pay ${formatMoney(totalRwf, currency)}`}
      </Button>
    </div>
  );
}

/**
 * Checkout on the EXTERNAL hold system. It owns the escrow and settles through
 * Stripe on its side, so it can finish in one of three ways and we handle all
 * of them:
 *
 *   • clientSecret — confirm the card here with Stripe.js, exactly as the direct
 *     rail does, then create the booking from the hold reference;
 *   • redirectUrl  — send the renter to their hosted page; their webhook creates
 *     the booking and the renter lands back on ?ext=1;
 *   • neither      — the hold is already authorised, so go straight to confirm.
 *
 * In every case the browser only ever passes a REFERENCE back: confirm-booking
 * re-reads the hold from the provider before a trip exists.
 */
/**
 * Checkout through PayHold.
 *
 * There is no card form here on purpose. PayHold owns payment orchestration and
 * hosts the page the renter pays on, so AutoHire never handles card data — the
 * renter picks their method there, across every rail PayHold has connected.
 *
 * Nothing is created here but the deal. The trip is written by
 * `payhold-webhook` when PayHold reports the money is actually held, so a
 * renter who abandons the hosted page leaves no half-made booking behind, and a
 * browser that never comes back cannot cost us a car.
 */
function ExternalPay({
  listingId,
  startDate,
  endDate,
  totalRwf,
  currency,
  onHeld,
  disabled,
}: PayProps & { disabled: boolean }) {
  const stripe = useStripe();
  const elements = useElements();
  const { country: initial } = useCountry();
  const [country, setCountry] = useState(initial.code);
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const hold = await client.createExternalHold({
        listingId,
        startDate,
        endDate,
        returnUrl: `${window.location.origin}/cars/${listingId}/book?ext=1`,
      });

      if (hold.redirectUrl) {
        window.location.assign(hold.redirectUrl);
        return; // the webhook creates the booking; we don't come back here
      }

      if (hold.clientSecret) {
        if (!stripe || !elements) throw new Error('Card entry is still loading — try again.');
        const card = elements.getElement(CardElement);
        if (!card) throw new Error('Enter your card details.');
        const result = await stripe.confirmCardPayment(hold.clientSecret, {
          payment_method: {
            card,
            billing_details: { address: { country, postal_code: zip || undefined } },
          },
        });
        if (result.error) throw new Error(result.error.message ?? 'Your card was declined.');
        // Manual capture leaves the intent in requires_capture — that IS the hold.
        const ok =
          result.paymentIntent?.status === 'requires_capture' ||
          result.paymentIntent?.status === 'succeeded';
        if (!ok) throw new Error('Payment was not completed.');
      }

      await onHeld(hold.reference);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Card details</Label>
        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-3">
          <CardElement options={{ style: { base: { fontSize: '15px', color: '#04141F' } } }} />
        </div>
      </div>
      <BillingFields country={country} setCountry={setCountry} zip={zip} setZip={setZip} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="w-full" size="lg" onClick={pay} disabled={busy || disabled}>
        {busy ? 'Processing…' : `Confirm and pay ${formatMoney(totalRwf, currency)}`}
      </Button>
      <p className="text-center text-caption text-[var(--color-content-subtle)]">
        You won't be charged yet — the amount is held until pickup.
      </p>
    </div>
  );
}

/** Stripe card form — creates a PaymentIntent server-side, then confirms it. */
function CardForm({ listingId, startDate, endDate, totalRwf, currency, onPaid, disabled }: PayProps & { disabled: boolean }) {
  const stripe = useStripe();
  const elements = useElements();
  const { country: initial } = useCountry();
  const [country, setCountry] = useState(initial.code);
  const [zip, setZip] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: fnErr } = await getSupabase().functions.invoke('create-payment-intent', {
        body: { listingId, startDate, endDate },
      });
      if (fnErr) {
        throw new Error(
          fnErr.name === 'FunctionsFetchError'
            ? "Card payments aren't deployed yet — deploy the create-payment-intent Edge Function."
            : fnErr.message,
        );
      }
      const clientSecret = (data as { clientSecret?: string; error?: string })?.clientSecret;
      if (!clientSecret) {
        throw new Error((data as { error?: string })?.error ?? 'Could not start the payment.');
      }

      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card,
          billing_details: { address: { country, postal_code: zip || undefined } },
        },
      });
      if (result.error) throw new Error(result.error.message ?? 'Your card was declined.');
      if (result.paymentIntent?.status !== 'succeeded') throw new Error('Payment was not completed.');

      await onPaid(result.paymentIntent.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Card details</Label>
        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-3">
          <CardElement options={{ style: { base: { fontSize: '15px', color: '#04141F' } } }} />
        </div>
        <p className="mt-1 text-caption text-[var(--color-content-subtle)]">Test card: 4242 4242 4242 4242 · any future expiry · any CVC.</p>
      </div>
      <BillingFields country={country} setCountry={setCountry} zip={zip} setZip={setZip} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="w-full" size="lg" onClick={pay} disabled={busy || !stripe || disabled}>
        {busy ? 'Processing…' : `Confirm and pay ${formatMoney(totalRwf, currency)}`}
      </Button>
    </div>
  );
}

/** MTN MoMo — branded UI. Real collection needs a mobile-money PSP (see docs/payments-plan.md). */
function MomoForm({ totalRwf, currency }: { totalRwf: number; currency: CurrencyCode }) {
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="momo-phone">MTN MoMo / Airtel number</Label>
        <Input
          id="momo-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+250 788 123 456"
        />
      </div>
      <p className="text-caption text-[var(--color-content-subtle)]">You'll get a prompt on your phone to approve the payment.</p>
      {note && <Notice tone="warn">{note}</Notice>}
      <Button
        className="w-full"
        size="lg"
        onClick={() =>
          setNote(
            "Mobile Money isn't connected yet — it needs a mobile-money provider (see docs/payments-plan.md). Use Card for now.",
          )
        }
      >
        Pay {formatMoney(totalRwf, currency)} with Mobile Money
      </Button>
    </div>
  );
}
