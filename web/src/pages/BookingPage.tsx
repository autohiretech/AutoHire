import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { ArrowLeft, Award, CreditCard, ShieldCheck, Smartphone, Star } from 'lucide-react';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { client } from '@/lib/client';
import { useIsHost } from '@/lib/account';
import { useCountry, COUNTRIES } from '@/lib/country';
import { cn } from '@/lib/cn';
import { getSupabase } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { formatDate, formatRwf } from '@/lib/format';
import {
  AirtelMark,
  AmexMark,
  DiscoverMark,
  GooglePayMark,
  MastercardMark,
  MomoMark,
  PayPalMark,
  StripeWordmark,
  VisaMark,
} from '@/components/PaymentBrands';
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
  const isHost = useIsHost();

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
    mutationFn: async (paymentIntentId?: string) => {
      const booking = await client.confirmBooking({ listingId: id, startDate, endDate, paymentIntentId });
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

  if (isHost) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <p className="font-medium text-ink-900">Host accounts can't rent</p>
        <p className="mt-1 text-sm text-ink-500">
          You're on a host account. To rent a car, switch back to renting from your{' '}
          <Link to="/account" className="text-brand-600 hover:underline">
            profile
          </Link>
          . Companies host only.
        </p>
        <Link to="/" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          Back to browse
        </Link>
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
  const instant = listing.bookingMode === 'instant';
  const superhost = host?.ratingAvg !== undefined && host.ratingAvg >= 4.8 && (host.ratingCount ?? 0) >= 5;

  const stripePromise = getStripe();
  const demo = !stripePromise;
  const payProps: PayProps = {
    listingId: id,
    startDate,
    endDate,
    totalRwf: total,
    instant,
    onPaid: (pi?: string) => mutation.mutateAsync(pi),
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

                {/* Mobile money */}
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
                    <MomoForm totalRwf={total} />
                  )}
                </MethodRow>

                {/* Not connected yet — shown for parity, disabled */}
                <MethodRow disabled icon={<PayPalMark />} label="PayPal" />
                <MethodRow disabled icon={<GooglePayMark />} label="Google Pay" />
              </div>

              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400">
                Card payments secured by <StripeWordmark className="text-xs" />
              </p>
            </CardBody>
          </Card>
        </div>

        {/* Right: order summary */}
        <div>
          <Card className="lg:sticky lg:top-20">
            <CardBody className="space-y-4">
              <div className="flex gap-3">
                <img
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
                      {formatRwf(listing.pricePerDayRwf)} × {days} day{days === 1 ? '' : 's'}
                    </span>
                    <span>{formatRwf(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-ink-600">
                    <span>Service fee</span>
                    <span>{formatRwf(serviceFee)}</span>
                  </div>
                  <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-900">
                    <span>Total</span>
                    <span>{formatRwf(total)}</span>
                  </div>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-400">
                  <ShieldCheck size={14} className="text-brand-600" /> Protected by AutoHire
                </p>
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
  totalRwf: number;
  instant: boolean;
  /** Create the booking once payment succeeds. In demo mode the id is omitted. */
  onPaid: (paymentIntentId?: string) => Promise<unknown>;
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

/** Demo checkout — used when no payment provider is configured. No real charge. */
function DemoPayForm({ totalRwf, onPaid, method, disabled }: PayProps & { method: Method; disabled: boolean }) {
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
        {busy ? 'Processing…' : `Confirm and pay ${formatRwf(totalRwf)}`}
      </Button>
    </div>
  );
}

/** Stripe card form — creates a PaymentIntent server-side, then confirms it. */
function CardForm({ listingId, startDate, endDate, totalRwf, onPaid, disabled }: PayProps & { disabled: boolean }) {
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
        {busy ? 'Processing…' : `Confirm and pay ${formatRwf(totalRwf)}`}
      </Button>
    </div>
  );
}

/** MTN MoMo — branded UI. Real collection needs a mobile-money PSP (see docs/payments-plan.md). */
function MomoForm({ totalRwf }: { totalRwf: number }) {
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
        Pay {formatRwf(totalRwf)} with Mobile Money
      </Button>
    </div>
  );
}
