import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { ArrowLeft, CreditCard, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { client } from '@/lib/client';
import { useIsHost } from '@/lib/account';
import { cn } from '@/lib/cn';
import { getSupabase } from '@/lib/supabase';
import { getStripe } from '@/lib/stripe';
import { formatDate, formatRwf } from '@/lib/format';
import {
  MastercardMark,
  MomoMark,
  StripeWordmark,
  VisaMark,
} from '@/components/PaymentBrands';
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Spinner } from '@/components/ui';

type Step = 'details' | 'payment';

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
 * A3 — booking flow for a listing: pick dates → mock payment → confirmation.
 * Reached at /cars/:id/book (the A2 detail page's CTA will link here). On
 * confirm it creates the booking via the data client and routes to the new trip.
 */
export function BookingPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isHost = useIsHost();

  const [step, setStep] = useState<Step>('details');
  const [startDate, setStartDate] = useState(() => addDays(todayISO(), 1));
  const [endDate, setEndDate] = useState(() => addDays(todayISO(), 4));

  const { data: listing, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => client.getListing(id),
  });
  const { data: bookedRanges = [] } = useQuery({
    queryKey: ['bookedRanges', id],
    queryFn: () => client.getBookedRanges(id),
  });

  const mutation = useMutation({
    mutationFn: async (paymentIntentId?: string) => {
      const booking = await client.confirmBooking({ listingId: id, startDate, endDate, paymentIntentId });
      // Auto-text the owner so the renter and host have a thread from the start.
      try {
        const conv = await client.getOrCreateConversation(
          booking.listingId,
          booking.renterId,
          booking.hostId,
        );
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

  // Host accounts are host-only — they can't rent while in Hosting mode.
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
  // Pick-up can't be in the past, or before the car is back from maintenance.
  const pickupMin = inMaintenance && maintUntil && maintUntil > today ? maintUntil : today;
  const afterMaintenance = !inMaintenance || (!!maintUntil && startDate >= maintUntil);
  // Dates already taken by other live bookings.
  const overlapsBooked = bookedRanges.some((r) => startDate < r.endDate && endDate > r.startDate);
  const datesValid =
    new Date(endDate) > new Date(startDate) &&
    startDate >= today &&
    afterMaintenance &&
    !overlapsBooked;
  const days = diffDays(startDate, endDate);
  const subtotal = listing.pricePerDayRwf * days;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee;
  const instant = listing.bookingMode === 'instant';

  return (
    <section className="mx-auto max-w-4xl px-4 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back to browse
      </Link>

      <h1 className="text-2xl font-bold text-ink-900">
        {step === 'details' ? 'Request to book' : 'Payment'}
      </h1>
      <p className="mt-1 text-sm text-ink-500">{listing.title}</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {step === 'details' ? (
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-ink-900">Trip dates</h2>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="start">Pick-up</Label>
                    <Input
                      id="start"
                      type="date"
                      min={pickupMin}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="end">Return</Label>
                    <Input
                      id="end"
                      type="date"
                      min={addDays(startDate, 1)}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                {inMaintenance && maintUntil && (
                  <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    This car is in maintenance — available from {formatDate(maintUntil)}.
                  </p>
                )}
                {bookedRanges.length > 0 && (
                  <div className="text-xs text-ink-500">
                    <span className="font-medium text-ink-600">Already booked:</span>{' '}
                    {bookedRanges
                      .map((r) => `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`)
                      .join(', ')}
                  </div>
                )}
                {!datesValid && (
                  <p className="text-sm text-red-600">
                    {startDate < today
                      ? 'Pick-up date cannot be in the past.'
                      : !afterMaintenance
                        ? `This car is in maintenance until ${formatDate(maintUntil ?? '')}.`
                        : overlapsBooked
                          ? 'Those dates are already booked — pick different dates.'
                          : 'Return date must be after pick-up.'}
                  </p>
                )}
                <Badge tone={instant ? 'success' : 'neutral'}>
                  {instant ? 'Instant book — confirmed immediately' : 'Request — host must approve'}
                </Badge>
                <Button
                  className="w-full"
                  disabled={!datesValid}
                  onClick={() => setStep('payment')}
                >
                  Continue to payment
                </Button>
              </CardBody>
            </Card>
          ) : (
            <PaymentSection
              listingId={id}
              startDate={startDate}
              endDate={endDate}
              totalRwf={total}
              instant={instant}
              onBack={() => setStep('details')}
              onPaid={(paymentIntentId) => mutation.mutateAsync(paymentIntentId)}
            />
          )}
        </div>

        {/* Price summary */}
        <div>
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-ink-900">Price summary</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
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
              <div className="flex justify-between border-t border-ink-100 pt-2 font-semibold text-ink-900">
                <span>Total</span>
                <span>{formatRwf(total)}</span>
              </div>
              <p className="flex items-center gap-1.5 pt-2 text-xs text-ink-400">
                <ShieldCheck size={14} className="text-brand-600" /> Protected by AutoHire
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
}

interface PayProps {
  listingId: string;
  startDate: string;
  endDate: string;
  totalRwf: number;
  instant: boolean;
  onBack: () => void;
  /**
   * Create the booking once payment succeeds; resolves when done. In demo mode
   * there's no PaymentIntent, so the id is omitted.
   */
  onPaid: (paymentIntentId?: string) => Promise<unknown>;
}

/** Checkout: pick a payment method (card via Stripe, or MTN MoMo). */
function PaymentSection(props: PayProps) {
  const [method, setMethod] = useState<'card' | 'momo'>('card');
  const stripePromise = getStripe();
  // No Stripe publishable key configured → demo checkout (no real charge).
  const demo = !stripePromise;

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 font-semibold text-ink-900">
          <Lock size={16} className="text-brand-600" /> Payment
        </h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <MethodButton
            active={method === 'card'}
            onClick={() => setMethod('card')}
            icon={<CreditCard size={16} />}
            label="Card"
          >
            <VisaMark />
            <MastercardMark />
          </MethodButton>
          <MethodButton
            active={method === 'momo'}
            onClick={() => setMethod('momo')}
            icon={<Smartphone size={16} />}
            label="Mobile Money"
          >
            <MomoMark />
          </MethodButton>
        </div>

        {demo ? (
          <DemoPayForm {...props} method={method} />
        ) : method === 'card' ? (
          <Elements stripe={stripePromise}>
            <CardForm {...props} />
          </Elements>
        ) : (
          <MomoForm totalRwf={props.totalRwf} onBack={props.onBack} />
        )}

        <p className="flex items-center justify-center gap-1.5 pt-1 text-xs text-ink-400">
          Card payments secured by <StripeWordmark className="text-xs" />
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Demo checkout — used when no payment provider is configured. No real card or
 * mobile-money charge: clicking pay confirms the booking instantly via the
 * server (which still owns the price and availability).
 */
function DemoPayForm({ totalRwf, instant, onBack, onPaid, method }: PayProps & { method: 'card' | 'momo' }) {
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
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
        Demo mode — no real {method === 'card' ? 'card' : 'mobile money'} charge. Clicking pay
        confirms the booking instantly.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button className="flex-1" onClick={pay} disabled={busy}>
          {busy ? 'Processing…' : `Pay ${formatRwf(totalRwf)} & ${instant ? 'confirm' : 'request'}`}
        </Button>
      </div>
    </div>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
        active ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-200' : 'border-ink-200 hover:border-ink-300',
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
        {icon} {label}
      </span>
      <span className="flex items-center gap-1.5">{children}</span>
    </button>
  );
}

/** Stripe card form — creates a PaymentIntent server-side, then confirms it. */
function CardForm({ listingId, startDate, endDate, totalRwf, instant, onBack, onPaid }: PayProps) {
  const stripe = useStripe();
  const elements = useElements();
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

      const result = await stripe.confirmCardPayment(clientSecret, { payment_method: { card } });
      if (result.error) throw new Error(result.error.message ?? 'Your card was declined.');
      if (result.paymentIntent?.status !== 'succeeded') throw new Error('Payment was not completed.');

      // Paid — hand the PaymentIntent to the server, which verifies it and
      // creates the booking (navigates on success).
      await onPaid(result.paymentIntent.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed.');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-ink-200 px-3 py-3">
        <CardElement options={{ style: { base: { fontSize: '15px', color: '#04141F' } } } } />
      </div>
      <p className="text-xs text-ink-400">
        Test card: 4242 4242 4242 4242 · any future expiry · any CVC.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button className="flex-1" onClick={pay} disabled={busy || !stripe}>
          {busy ? 'Processing…' : `Pay ${formatRwf(totalRwf)} & ${instant ? 'confirm' : 'request'}`}
        </Button>
      </div>
    </div>
  );
}

/** MTN MoMo — branded UI. Real collection needs a mobile-money PSP (see docs/payments-plan.md). */
function MomoForm({ totalRwf, onBack }: { totalRwf: number; onBack: () => void }) {
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="momo-phone">MTN MoMo number</Label>
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
      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          className="flex-1"
          onClick={() =>
            setNote(
              "MTN MoMo isn't connected yet — it needs a mobile-money provider (see docs/payments-plan.md). Use Card for now.",
            )
          }
        >
          Pay {formatRwf(totalRwf)} with MoMo
        </Button>
      </div>
    </div>
  );
}
