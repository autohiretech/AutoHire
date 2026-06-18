import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { client } from '@/lib/client';
import { formatRwf } from '@/lib/format';
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Spinner } from '@/components/ui';

type Step = 'details' | 'payment';

function diffDays(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
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

  const [step, setStep] = useState<Step>('details');
  const [startDate, setStartDate] = useState('2026-06-25');
  const [endDate, setEndDate] = useState('2026-06-28');

  const { data: listing, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => client.getListing(id),
  });

  const mutation = useMutation({
    mutationFn: () => client.createBooking({ listingId: id, startDate, endDate }),
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
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

  const datesValid = new Date(endDate) > new Date(startDate);
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
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="end">Return</Label>
                    <Input
                      id="end"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                {!datesValid && (
                  <p className="text-sm text-red-600">Return date must be after pick-up.</p>
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
            <Card>
              <CardHeader>
                <h2 className="flex items-center gap-2 font-semibold text-ink-900">
                  <Lock size={16} className="text-brand-600" /> Payment details
                </h2>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-500">
                  Demo only — no real card is charged. Stage C wires Stripe collection with
                  MoMo / Airtel / bank payout.
                </p>
                <div>
                  <Label htmlFor="card">Card number</Label>
                  <Input id="card" placeholder="4242 4242 4242 4242" defaultValue="4242 4242 4242 4242" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="exp">Expiry</Label>
                    <Input id="exp" placeholder="MM/YY" defaultValue="12/28" />
                  </div>
                  <div>
                    <Label htmlFor="cvc">CVC</Label>
                    <Input id="cvc" placeholder="123" defaultValue="123" />
                  </div>
                </div>
                {mutation.isError && (
                  <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
                )}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setStep('details')}
                    disabled={mutation.isPending}
                  >
                    Back
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => mutation.mutate()}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending
                      ? 'Processing…'
                      : `Pay ${formatRwf(total)} & ${instant ? 'confirm' : 'request'}`}
                  </Button>
                </div>
              </CardBody>
            </Card>
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
