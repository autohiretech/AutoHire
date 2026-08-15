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
import { Avatar, Badge, Button, Card, CardBody, Input, Label, Select, Spinner } from '@/components/ui';

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
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const backToBrowse = useBackToBrowse();
  const location = useLocation();
  const queryClient = useQueryClient();
  const canRent = useCanRent();
  const isCompany = useIsBusinessHost();
  const { data: me } = useCurrentUser();

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

  const { data: listing, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => client.getListing(id),
  });
  const { data: host } = useQuery({
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
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <ShieldCheck size={22} />
        </span>
        <p className="mt-4 font-semibold text-ink-900">Payment received</p>
        <p className="mt-1 text-sm text-ink-500">
          We're confirming your payment and creating your trip — it'll appear in My trips shortly.
        </p>
        <Link to="/trips" className="mt-5 inline-block">
          <Button size="lg">Go to My trips</Button>
        </Link>
      </div>
    );
  }

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
        <p className="font-medium text-ink-900">Listing not found</p>
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

  // Hosts and company accounts are host-only: they can view any car but never
  // check out. The Edge Functions and a DB trigger enforce the same rule, so a
  // direct link to this page can't turn into a booking.
  if (!canRent) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">
          {isCompany ? "Company accounts can't rent" : "Host accounts can't rent"}
        </p>
        <p className="mt-1 text-sm text-ink-500">
          {isCompany ? (
            'Companies host only — you can view any car, but booking is off for this account.'
          ) : (
            <>
              You're on a host account. To rent a car, switch back to renting from your{' '}
              <Link to="/account" className="text-brand-600 hover:underline">
                profile
              </Link>
              .
            </>
          )}
        </p>
        <Link to={`/cars/${id}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to the car
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
        <p className="mt-4 font-semibold text-ink-900">
          {underReview ? 'Verification in review' : 'Verify your identity to rent'}
        </p>
        <p className="mt-1 text-sm text-ink-500">
          {underReview
            ? "We're checking your details. You can book as soon as your identity is approved."
            : me.verification === 'rejected'
              ? 'Your verification was declined. Please resubmit your documents to rent.'
              : 'For everyone’s safety, renters complete a quick one-time identity check before their first booking.'}
        </p>
        <Link to="/verification" className="mt-5 inline-block">
          <Button size="lg">
            <ShieldCheck size={16} /> {underReview ? 'View status' : 'Verify now'}
          </Button>
        </Link>
        <div>
          <Link to={`/cars/${id}`} className="mt-3 inline-block text-sm text-brand-600 hover:underline">
            Back to the car
          </Link>
        </div>
      </div>
    );
  }

  const today = todayISO();
  const inMaintenance = listing.status === 'maintenance';
  const maintUntil = listing.maintenanceUntil ?? undefined;
  const afterMaintenance = !inMaintenance || (!!maintUntil && startDate >= maintUntil);
  const datesValid = new Date(endDate) > new Date(startDate) && startDate >= today && afterMaintenance;

  const days = diffDays(startDate, endDate);
  // A car is priced by the day or by the hour, never both — fixed by the
  // listing, not a choice made on this page.
  const isHourly = listing.pricingMode === 'hourly';
  // For an hourly booking this is an ESTIMATE — what's actually charged now is
  // 50% of it, and the rest is settled against actual pickup-to-return time
  // once the trip completes (see docs/payhold.md — PayHold has no way to add
  // money to a deal already funded, so the balance is display-only, not
  // auto-charged).
  const estimatedTotal = isHourly
    ? estimatedHours * (listing.pricePerHourRwf ?? 0)
    : (listing.pricePerDayRwf ?? 0) * days;
  const depositAmount = isHourly ? Math.round(estimatedTotal / 2) : estimatedTotal;
  const subtotal = depositAmount;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee;
  // Amounts stay in the currency the host set the car in — never re-denominated
  // by the renter's nationality or their header market selection.
  const cur: CurrencyCode = isCurrencyCode(listing.priceCurrency) ? listing.priceCurrency : 'RWF';
  const money = (n: number) => formatMoney(n, cur);
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
        aria-label="Back"
        className="mb-5 flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 text-ink-700 transition hover:bg-ink-50"
      >
        <ArrowLeft size={18} />
      </button>

      <h1 className="text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">Confirm and pay</h1>
      <p className="mt-1.5 max-w-xl text-sm text-ink-500">
        Check the car and the dates, then pay. Nothing reaches the host until the trip is over.
      </p>

      <div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-[1fr_minmax(0,400px)] lg:gap-9">
        {/* Left: payment methods */}
        <div className="min-w-0 space-y-5">
          <Card>
            <CardBody className="space-y-4 p-5 sm:p-6">
              <div>
                <h2 className="text-lg font-semibold text-ink-900 sm:text-xl">
                  When are you picking it up?
                </h2>
                <p className="mt-1 text-sm text-ink-500">
                  {isHourly
                    ? 'A late return past your estimate is settled against the actual time used.'
                    : `Coming back more than 2 hours after ${formatDate(endDate)} at this time bills an overage — see the car's listing.`}
                </p>
              </div>
              <div>
                <Label htmlFor="pickup-time">Pickup time</Label>
                <Input
                  id="pickup-time"
                  type="time"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                />
              </div>
              {PAYMENTS_PAYHOLD && isHourly && (
                <div>
                  <Label htmlFor="estimated-hours">How many hours?</Label>
                  <Input
                    id="estimated-hours"
                    type="number"
                    min={1}
                    value={estimatedHours}
                    onChange={(e) => setEstimatedHours(Math.max(1, Number(e.target.value) || 1))}
                  />
                  <p className="mt-1 text-xs text-ink-400">
                    You pay 50% now ({money(depositAmount)} of an estimated {money(estimatedTotal)}).
                    The rest is settled from the actual time between pickup and return.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-ink-900 sm:text-xl">
                How do you want to pay?
              </h2>
              <p className="mb-4 mt-1 text-sm text-ink-500">
                {pickerless
                  ? 'Choose your method on the next step — you stay right here on AutoHire.'
                  : 'Pick a method below and enter your details.'}
              </p>

              {!datesValid && (
                <p className="mb-4 rounded-xl bg-red-50 p-3.5 text-sm text-red-700">
                  These dates aren't available.{' '}
                  <Link to={`/cars/${id}`} className="font-medium underline">
                    Choose different dates
                  </Link>
                  .
                </p>
              )}

              {PAYMENTS_PAYHOLD ? (
                <PayholdPayment
                  listingId={id}
                  startDate={startDate}
                  endDate={endDate}
                  pickupTime={pickupTime}
                  rentalType={isHourly ? 'hourly' : 'daily'}
                  estimatedHours={isHourly ? estimatedHours : undefined}
                  label={money(total)}
                  disabled={!datesValid}
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
                <div className="mt-5 border-t border-ink-100 pt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    Cards accepted
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
                  <p className="mt-4 text-center text-xs text-ink-400">
                    Payments secured — card, MTN MoMo &amp; Airtel Money.
                  </p>
                ) : (
                  <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400">
                    Card payments secured by <StripeWordmark className="text-xs" />
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
              <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
                <ShieldCheck size={18} className="text-brand-600" />
                Your payment is protected
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <SafetyPoint
                  icon={<Lock size={16} />}
                  title="Encrypted, and never stored here"
                  body="Your card details travel over an encrypted connection straight to our payment provider. AutoHire never keeps your card number."
                />
                <SafetyPoint
                  icon={<Wallet size={16} />}
                  title="Held, not handed over"
                  body="We hold the full amount from the moment you book. The host is paid only after you both confirm the car came back."
                />
                <SafetyPoint
                  icon={<CalendarCheck size={16} />}
                  title="Free cancellation"
                  body={`Cancel before ${formatDate(startDate)} and the full ${money(total)} comes back to you, automatically.`}
                />
                <SafetyPoint
                  icon={<BadgeCheck size={16} />}
                  title="Verified people only"
                  body="Every renter passes an identity check before they can book, and hosts are reviewed after each trip."
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
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-ink-800 shadow-sm backdrop-blur">
                  <Award size={13} className="text-brand-600" /> Top-rated host
                </span>
              )}
            </div>

            <CardBody className="space-y-4 p-5 sm:p-5">
              <div>
                <h2 className="text-lg font-semibold leading-snug text-ink-900">{listing.title}</h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-500">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={13} className="text-ink-400" />
                    {listing.location}
                  </span>
                  {listing.ratingCount ? (
                    <span className="inline-flex items-center gap-1 font-medium text-ink-800">
                      <Star size={13} className="fill-ink-900 text-ink-900" />
                      {listing.ratingAvg?.toFixed(2)}
                      <span className="font-normal text-ink-500">({listing.ratingCount} trips)</span>
                    </span>
                  ) : (
                    <span>New listing</span>
                  )}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <SpecChip icon={<Users size={12} />} label={`${listing.seats} seats`} />
                  <SpecChip icon={<Cog size={12} />} label={listing.transmission} />
                  <SpecChip icon={<Fuel size={12} />} label={listing.fuel} />
                  <SpecChip icon={<Calendar size={12} />} label={`${listing.year}`} />
                </div>
              </div>

              {host && (
                <div className="flex items-center gap-2.5 border-t border-ink-100 pt-3.5">
                  <Avatar name={host.businessName || host.fullName} src={host.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      Hosted by {host.businessName || host.fullName}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between border-t border-ink-100 pt-3.5">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Your trip</p>
                  <p className="mt-0.5 text-sm text-ink-700">
                    {formatDate(startDate)} – {formatDate(endDate)} at {pickupTime}
                  </p>
                  <p className="text-[13px] text-ink-500">
                    {isHourly
                      ? `~${estimatedHours} hour${estimatedHours === 1 ? '' : 's'} · billed on actual time used`
                      : `${days} day${days === 1 ? '' : 's'} · free cancellation until ${formatDate(startDate)}`}
                  </p>
                </div>
                <Link
                  to={`/cars/${id}`}
                  className="shrink-0 text-sm font-medium text-brand-600 hover:underline"
                >
                  Change
                </Link>
              </div>

              <div className="border-t border-ink-100 pt-3.5">
                <p className="text-sm font-semibold text-ink-900">Price details</p>
                <div className="mt-2 space-y-1.5 text-sm">
                  {isHourly ? (
                    <>
                      <div className="flex justify-between text-ink-600">
                        <span>
                          {money(listing.pricePerHourRwf ?? 0)} × {estimatedHours} hr
                          {estimatedHours === 1 ? '' : 's'} (estimated)
                        </span>
                        <span>{money(estimatedTotal)}</span>
                      </div>
                      <div className="flex justify-between text-ink-600">
                        <span>Deposit due now (50%)</span>
                        <span>{money(depositAmount)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-ink-600">
                      <span>
                        {money(listing.pricePerDayRwf ?? 0)} × {days} day{days === 1 ? '' : 's'}
                      </span>
                      <span>{money(subtotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-ink-600">
                    <span>Service fee</span>
                    <span>{money(serviceFee)}</span>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-ink-100 pt-2.5 font-bold text-ink-900">
                    <span className="text-base">{isHourly ? 'Due now' : 'Total'}</span>
                    <span className="text-xl">{money(total)}</span>
                  </div>
                  {isHourly && (
                    <p className="text-[13px] text-ink-500">
                      The rest is settled after your trip, based on actual pickup-to-return time.
                    </p>
                  )}
                </div>
                <div className="mt-3.5 flex items-start gap-2 rounded-xl bg-brand-50/70 p-3 text-[13px] leading-relaxed text-ink-600">
                  <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand-600" />
                  <span>
                    <span className="font-semibold text-ink-800">Payment held securely.</span> Your
                    payment is held from the moment you book and only released to the host once you
                    both confirm the car came back — so your money is protected for the whole trip,
                    not just until pickup.
                  </span>
                </div>
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
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">{body}</p>
      </div>
    </div>
  );
}

/** A small fact about the car — seats, gearbox, fuel, year. */
function SpecChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-2 py-0.5 text-[11px] font-medium capitalize text-ink-700">
      <span className="text-ink-400">{icon}</span>
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
    <div className={cn('border-b border-ink-100 last:border-0', disabled && 'opacity-60')}>
      <button
        type="button"
        onClick={disabled ? undefined : onSelect}
        disabled={disabled}
        className="flex w-full items-center gap-3 py-4 text-left disabled:cursor-not-allowed"
      >
        <span className="text-ink-600">{icon}</span>
        <span className="flex-1">
          <span className="flex items-center gap-2 font-medium text-ink-900">
            {label}
            {disabled && <Badge tone="neutral">Coming soon</Badge>}
          </span>
          {marks && <span className="mt-1 flex flex-wrap items-center gap-1.5">{marks}</span>}
        </span>
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
            selected ? 'border-ink-900' : 'border-ink-300',
          )}
        >
          {selected && <span className="h-2.5 w-2.5 rounded-full bg-ink-900" />}
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
      <div className="flex items-center gap-2 rounded-lg border border-ink-200 p-3">
        <Smartphone size={20} className="text-brand-600" />
        <CreditCard size={20} className="text-brand-600" />
        <p className="text-sm text-ink-600">Pay with your card, MTN MoMo or Airtel Money.</p>
      </div>
      <p className="text-xs text-ink-400">
        You'll be taken to our secure payment partner to complete payment, then brought back here.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
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
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        Demo mode — no real {method === 'card' ? 'card' : 'mobile money'} charge. Confirming creates the booking instantly.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
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
        <div className="rounded-lg border border-ink-200 px-3 py-3">
          <CardElement options={{ style: { base: { fontSize: '15px', color: '#04141F' } } }} />
        </div>
      </div>
      <BillingFields country={country} setCountry={setCountry} zip={zip} setZip={setZip} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button className="w-full" size="lg" onClick={pay} disabled={busy || disabled}>
        {busy ? 'Processing…' : `Confirm and pay ${formatMoney(totalRwf, currency)}`}
      </Button>
      <p className="text-center text-xs text-ink-400">
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
        <div className="rounded-lg border border-ink-200 px-3 py-3">
          <CardElement options={{ style: { base: { fontSize: '15px', color: '#04141F' } } }} />
        </div>
        <p className="mt-1 text-xs text-ink-400">Test card: 4242 4242 4242 4242 · any future expiry · any CVC.</p>
      </div>
      <BillingFields country={country} setCountry={setCountry} zip={zip} setZip={setZip} />
      {error && <p className="text-sm text-red-600">{error}</p>}
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
      <p className="text-xs text-ink-400">You'll get a prompt on your phone to approve the payment.</p>
      {note && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{note}</p>}
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
