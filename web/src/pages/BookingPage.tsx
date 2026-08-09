import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { ArrowLeft, Award, CreditCard, ShieldCheck, Smartphone, Star } from 'lucide-react';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { client } from '@/lib/client';
import { useCanRent, useIsBusinessHost } from '@/lib/account';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useCountry, COUNTRIES } from '@/lib/country';
import { cn } from '@/lib/cn';
import { getSupabase } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { formatDate } from '@/lib/format';
import { formatMoney, isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import {
  PAYHOLD_EMBED,
  PAYMENTS_EXTERNAL,
  PAYMENTS_LIVE,
  PAYMENTS_PAYHOLD,
  isAfricanMarket,
} from '@/lib/payments';
import {
  AirtelMark,
  AmexMark,
  DiscoverMark,
  MastercardMark,
  MomoMark,
  StripeWordmark,
  VisaMark,
} from '@/components/PaymentBrands';
import { Img } from '@/components/Img';
import { Badge, Button, Card, CardBody, Input, Label, Select, Spinner } from '@/components/ui';

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
  const location = useLocation();
  const queryClient = useQueryClient();
  const canRent = useCanRent();
  const isCompany = useIsBusinessHost();
  const { data: me } = useCurrentUser();

  const picked = location.state as { startDate?: string; endDate?: string } | null;
  const [startDate] = useState(() => picked?.startDate ?? addDays(todayISO(), 1));
  const [endDate] = useState(() => picked?.endDate ?? addDays(todayISO(), 4));
  const [method, setMethod] = useState<Method>('card');

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
        <Link to="/" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to browse
        </Link>
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
  const subtotal = listing.pricePerDayRwf * days;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee;
  // Amounts stay in the currency the host set the car in — never re-denominated
  // by the renter's nationality or their header market selection.
  const cur: CurrencyCode = isCurrencyCode(listing.priceCurrency) ? listing.priceCurrency : 'RWF';
  const money = (n: number) => formatMoney(n, cur);
  const instant = listing.bookingMode === 'instant';
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

  return (
    <section className="mx-auto max-w-5xl px-4 py-8">
      <button
        type="button"
        onClick={() => navigate(`/cars/${id}`)}
        aria-label="Back"
        className="mb-5 flex h-9 w-9 items-center justify-center rounded-full border border-ink-200 text-ink-700 hover:bg-ink-50"
      >
        <ArrowLeft size={18} />
      </button>

      <h1 className="text-2xl font-bold text-ink-900">Confirm and pay</h1>

      <div className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_minmax(0,380px)]">
        {/* Left: payment methods */}
        <div className="min-w-0">
          <Card>
            <CardBody>
              <h2 className="mb-2 text-lg font-semibold text-ink-900">1. Add a payment method</h2>

              {!datesValid && (
                <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  These dates aren't available.{' '}
                  <Link to={`/cars/${id}`} className="font-medium underline">
                    Choose different dates
                  </Link>
                  .
                </p>
              )}

              {PAYMENTS_PAYHOLD ? (
                <PayholdPay
                  listingId={id}
                  startDate={startDate}
                  endDate={endDate}
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

              {/* Provider attribution — Flutterwave for African markets, Stripe otherwise. */}
              {!africanLive && !PAYMENTS_EXTERNAL && (
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
        </div>

        {/* Right: order summary */}
        <div>
          <Card className="lg:sticky lg:top-20">
            <CardBody className="space-y-4">
              <div className="flex gap-3">
                <Img
                  src={listing.photos[0]}
                  alt={listing.title}
                  className="h-16 w-24 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-900">{listing.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-500">
                    {listing.ratingCount ? (
                      <span className="inline-flex items-center gap-1 text-ink-700">
                        <Star size={12} className="fill-ink-900 text-ink-900" />
                        {listing.ratingAvg?.toFixed(2)} ({listing.ratingCount})
                      </span>
                    ) : (
                      <span>New listing</span>
                    )}
                    {superhost && (
                      <span className="inline-flex items-center gap-1 text-ink-700">
                        <Award size={12} /> Top-rated host
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="border-t border-ink-100 pt-3">
                <p className="font-medium text-ink-900">Free cancellation</p>
                <p className="text-sm text-ink-500">
                  Cancel before {formatDate(startDate)} for a full refund.
                </p>
              </div>

              <div className="flex items-start justify-between border-t border-ink-100 pt-3">
                <div>
                  <p className="font-medium text-ink-900">Dates</p>
                  <p className="text-sm text-ink-600">
                    {formatDate(startDate)} – {formatDate(endDate)}
                  </p>
                </div>
                <Link to={`/cars/${id}`} className="text-sm font-medium text-brand-600 hover:underline">
                  Change
                </Link>
              </div>

              <div className="border-t border-ink-100 pt-3">
                <p className="font-medium text-ink-900">Price details</p>
                <div className="mt-1.5 space-y-1.5 text-sm">
                  <div className="flex justify-between text-ink-600">
                    <span>
                      {money(listing.pricePerDayRwf)} × {days} day{days === 1 ? '' : 's'}
                    </span>
                    <span>{money(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-ink-600">
                    <span>Service fee</span>
                    <span>{money(serviceFee)}</span>
                  </div>
                  <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-900">
                    <span>Total</span>
                    <span>{money(total)}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-brand-50/60 p-2.5 text-xs text-ink-600">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-600" />
                  <span>
                    <span className="font-medium text-ink-800">Payment held securely.</span> AutoHire holds your
                    payment and only releases it to the host after your trip starts — so your money is protected
                    until pickup.
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
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="bill-country">Country / region</Label>
        <Select id="bill-country" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => (
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
function PayholdPay({
  listingId,
  startDate,
  endDate,
  label,
  disabled,
}: {
  listingId: string;
  startDate: string;
  endDate: string;
  label: string;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const { paymentLink } = await client.createPayholdDeal({ listingId, startDate, endDate });
      if (PAYHOLD_EMBED) {
        // Keep the renter here and let the frame take over. It redirects itself
        // if PayHold — or the provider it hands off to — refuses to be framed.
        setLink(paymentLink);
        return;
      }
      // A full navigation, not a new tab: the renter is leaving AutoHire for
      // the payment and PayHold brings them back itself. A popup here is the
      // thing a blocker eats.
      window.location.assign(paymentLink);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
      setBusy(false);
    }
  }

  if (link) return <PayholdCheckout paymentLink={link} />;

  return (
    <div>
      <Button className="w-full" disabled={disabled || busy} onClick={pay}>
        {busy ? 'Opening secure checkout…' : `Pay ${label}`}
      </Button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <p className="mt-3 text-center text-xs text-ink-500">
        You'll pay on our secure checkout page and choose your method there. Your money is held
        until the trip is done — the host is paid after you both confirm the car came back.
      </p>
    </div>
  );
}

/**
 * PayHold's checkout, running inside the booking page.
 *
 * Framing a payment page is a privilege the page grants, and it can be withdrawn
 * mid-flow. Three things can refuse us, and only the first is predictable:
 *
 *  1. PayHold itself, if its `frame-ancestors` does not name our origin — the
 *     state before its header change ships.
 *  2. **The provider it hands off to.** PayHold collects on Flutterwave or
 *     Stripe, and Stripe Checkout refuses framing outright. So a frame that
 *     loaded perfectly well goes blank at the exact moment the renter is sent
 *     to pay. The redirect is not a fallback for old browsers here; on that rail
 *     it is the only path that completes.
 *  3. A browser blocking third-party frames wholesale.
 *
 * So this never assumes the frame is working. It watches for PayHold saying
 * hello, and treats silence as refusal.
 *
 * Whether a refusal is recoverable depends on when it happens. Before the renter
 * has touched anything, leaving is free and we go without asking. Once the frame
 * has spoken — a method chosen, a handoff begun — an unannounced navigation
 * could interrupt a payment in progress, so we stop and offer the link instead.
 */
function PayholdCheckout({ paymentLink }: { paymentLink: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(620);
  const [stage, setStage] = useState<'loading' | 'live' | 'stranded' | 'paid' | 'failed'>(
    'loading',
  );
  const [failure, setFailure] = useState<string | null>(null);

  // Has PayHold said anything at all? This is what separates "the frame never
  // worked" from "the frame was working and then the provider refused", and the
  // two want opposite handling.
  const spoke = useRef(false);

  const origin = useMemo(() => {
    try {
      return new URL(paymentLink).origin;
    } catch {
      return null;
    }
  }, [paymentLink]);

  const leave = useCallback(() => window.location.assign(paymentLink), [paymentLink]);

  /** Give up on framing. Silent if nothing is in flight, asked if something is. */
  const refused = useCallback(() => {
    if (spoke.current) setStage('stranded');
    else leave();
  }, [leave]);

  useEffect(() => {
    if (!origin) return;

    function onMessage(e: MessageEvent) {
      // The frame is a payment page; anything else claiming to be one is not
      // something to take instructions from.
      if (e.origin !== origin) return;
      const data = e.data as { source?: string; event?: string; height?: number } | null;
      if (!data || data.source !== 'payhold') return;

      spoke.current = true;
      setStage((s) => (s === 'loading' ? 'live' : s));

      switch (data.event) {
        case 'resize':
          // Bounded: a bad number here would either clip the card form or
          // stretch the page to nothing.
          if (typeof data.height === 'number' && Number.isFinite(data.height)) {
            setHeight(Math.min(Math.max(Math.round(data.height), 320), 1400));
          }
          break;
        case 'payment_succeeded':
          // Only a screen change. The booking is created by the signed
          // `order.funded_held` webhook, never by a message from a frame —
          // anything that can post one could otherwise mint itself a trip.
          setStage('paid');
          break;
        case 'payment_failed':
          setFailure('That payment did not go through.');
          setStage('failed');
          break;
        case 'payment_cancelled':
          setFailure(null);
          setStage('failed');
          break;
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin]);

  /**
   * Did the frame actually render, or is it the blank document a refusal leaves?
   *
   * A refused frame still fires `load`, so the event alone proves nothing. What
   * distinguishes them is reachability: a frame that really loaded PayHold is
   * cross-origin and touching its location throws, while a blocked one sits on
   * `about:blank`, same-origin and readable. The throw is the success signal.
   */
  const onLoad = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return refused();
    try {
      const href = win.location.href;
      if (href === 'about:blank' || href === '') refused();
    } catch {
      setStage((s) => (s === 'loading' ? 'live' : s));
    }
  }, [refused]);

  // Nothing at all after a beat means the frame is not coming up — a blocker
  // that suppresses `load`, or a PayHold that has not shipped its headers yet.
  useEffect(() => {
    if (stage !== 'loading') return;
    const t = setTimeout(() => {
      if (!spoke.current) leave();
    }, 6000);
    return () => clearTimeout(t);
  }, [stage, leave]);

  if (stage === 'paid') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
        <p className="font-semibold text-ink-900">Payment received</p>
        <p className="mt-1 text-sm text-ink-600">
          We're setting up your trip now. It'll appear in your trips in a moment — you don't
          need to stay on this page.
        </p>
        <Link
          to="/trips"
          className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
        >
          Go to my trips
        </Link>
      </div>
    );
  }

  if (stage === 'failed') {
    return (
      <div className="rounded-xl border border-ink-200 p-5 text-center">
        <p className="font-medium text-ink-900">{failure ?? 'Payment cancelled'}</p>
        <p className="mt-1 text-sm text-ink-600">
          Nothing has been charged and the car is still available.
        </p>
        <Button className="mt-4" onClick={leave}>
          Try again
        </Button>
      </div>
    );
  }

  if (stage === 'stranded') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 text-center">
        <p className="font-medium text-ink-900">Finish paying on our secure page</p>
        <p className="mt-1 text-sm text-ink-600">
          Your bank's page can't open inside AutoHire, so the last step happens on our checkout
          page. Your booking details are saved.
        </p>
        <Button className="mt-4" onClick={leave}>
          Continue to payment
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-ink-200">
        <iframe
          ref={frame}
          src={paymentLink}
          onLoad={onLoad}
          title="Secure checkout"
          className="block w-full"
          style={{ height }}
          // Card fields and the provider handoff both need these. No
          // `allow-top-navigation`: the frame must not be able to move the page
          // out from under the renter.
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          allow="payment *"
        />
      </div>
      {stage === 'loading' && (
        <p className="mt-3 text-center text-xs text-ink-500">Opening secure checkout…</p>
      )}
      <p className="mt-3 text-center text-xs text-ink-500">
        Your money is held until the trip is done — the host is paid after you both confirm the
        car came back.{' '}
        <button type="button" onClick={leave} className="font-medium text-brand-600 underline">
          Having trouble? Open the checkout page
        </button>
      </p>
    </div>
  );
}

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
