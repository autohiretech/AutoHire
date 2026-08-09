import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Landmark,
  Lock,
  QrCode,
  ShieldCheck,
  Smartphone,
  Wallet,
} from 'lucide-react';
import type { PaymentMethodType } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { SERVICE_FEE_RATE } from '@/lib/types';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { formatMoney, isCurrencyCode, type CurrencyCode } from '@/lib/currency';
import {
  PAYMENT_METHOD_META,
  PAYMENTS_PAYHOLD,
  paymentMethodsFor,
} from '@/lib/payments';
import { PayholdCheckout } from '@/components/PayholdCheckout';
import { MethodMarks } from '@/components/PaymentBrands';
import { Button, Card, CardBody, Spinner } from '@/components/ui';

const METHOD_ICON: Record<PaymentMethodType, typeof Smartphone> = {
  card: CreditCard,
  momo: Smartphone,
  bank: Landmark,
  paypal: Wallet,
  alipay: QrCode,
  wechat_pay: QrCode,
};

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

/**
 * "How do you want to pay" — its own step, before any money moves.
 *
 * This replaces the payment method a renter used to save on their profile. That
 * card was never read by checkout: PayHold collects the method itself, per
 * booking, so a stored one only implied a promise nothing kept. Paying is a
 * per-trip decision — a different card for work, mobile money because the phone
 * is to hand — and it belongs next to the trip, not in settings.
 *
 * What is on offer comes from PayHold's own `can_collect` table rather than a
 * list of ours, so a market it cannot charge never shows a method that would
 * fail at the end.
 */
export function PaymentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me } = useCurrentUser();

  const picked = location.state as { startDate?: string; endDate?: string } | null;
  const params = new URLSearchParams(location.search);
  const startDate = picked?.startDate ?? params.get('start') ?? '';
  const endDate = picked?.endDate ?? params.get('end') ?? '';

  const [method, setMethod] = useState<PaymentMethodType | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: listing, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => client.getListing(id),
  });

  // Where the renter pays FROM decides what they can pay with — not the car's
  // market. Someone in Kigali renting in Dubai still pays the way Rwanda can.
  const payerCountry = me?.country ?? '';

  const { data: countries } = useQuery({
    queryKey: ['payholdPaymentCountries'],
    queryFn: () => client.payholdPayoutCountries(),
    enabled: PAYMENTS_PAYHOLD && !!payerCountry,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const known = countries?.find((c) => c.code === payerCountry) ?? null;
  const methods = useMemo(
    () => paymentMethodsFor(payerCountry, PAYMENTS_PAYHOLD ? known : undefined),
    [payerCountry, known],
  );

  const cur: CurrencyCode = isCurrencyCode(listing?.priceCurrency ?? '')
    ? (listing!.priceCurrency as CurrencyCode)
    : 'RWF';
  const days = startDate && endDate ? diffDays(startDate, endDate) : 0;
  const subtotal = (listing?.pricePerDayRwf ?? 0) * days;
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
  const total = subtotal + serviceFee;
  const money = (n: number) => formatMoney(n, cur, { decimals: 0 });

  async function pay() {
    if (!method) return;
    setBusy(true);
    setError(null);
    try {
      const { paymentLink } = await client.createPayholdDeal({
        listingId: id,
        startDate,
        endDate,
        preferredMethod: method,
      });
      setLink(paymentLink);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size={26} />
      </div>
    );
  }

  if (!listing || !startDate || !endDate) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="font-medium text-ink-900">We've lost your dates</p>
        <p className="mt-1 text-sm text-ink-500">Pick them again and we'll bring you back here.</p>
        <Link to={`/cars/${id}`} className="mt-4 inline-block">
          <Button>Back to the car</Button>
        </Link>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <Banknote size={22} />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">How do you want to pay?</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            {money(total)} for {days} day{days === 1 ? '' : 's'} — {listing.title}
          </p>
        </div>
      </div>

      {/* Once the deal exists the choice is made, so the picker gives way to
          the checkout rather than sitting above it inviting a second answer. */}
      {link ? (
        <div className="mt-6">
          <PayholdCheckout paymentLink={link} />
        </div>
      ) : (
        <>
          {!payerCountry && (
            <Card className="mt-6 border-amber-200 bg-amber-50/60">
              <CardBody>
                <p className="font-medium text-ink-900">Tell us where you're paying from</p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Payment options differ by country — mobile money isn't offered everywhere.{' '}
                  <Link to="/account" className="font-medium text-brand-600 underline">
                    Set your country
                  </Link>
                </p>
              </CardBody>
            </Card>
          )}

          {payerCountry && methods.length === 0 && (
            <Card className="mt-6 border-amber-200 bg-amber-50/60">
              <CardBody>
                <p className="font-medium text-ink-900">
                  We can't take payments from {known?.name ?? 'your country'} yet
                </p>
                <p className="mt-0.5 text-sm text-ink-600">
                  Nothing has been charged and the car is still available.
                </p>
              </CardBody>
            </Card>
          )}

          <div className={cn('mt-6 grid gap-3', !payerCountry && 'pointer-events-none opacity-40')}>
            {methods.map((m) => {
              const meta = PAYMENT_METHOD_META[m];
              const Icon = METHOD_ICON[m];
              const chosen = method === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  aria-pressed={chosen}
                  className={cn(
                    'flex items-start gap-3 rounded-2xl border p-4 text-left transition-all',
                    chosen
                      ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                      : 'border-ink-200 bg-white hover:border-ink-300 hover:shadow-card',
                  )}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                      <span className="font-semibold text-ink-900">{meta.label}</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <MethodMarks method={m} />
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                      {meta.blurb}
                    </span>
                  </span>
                  {/* A radio would say the same thing, but this row is the
                      control — a real one beside it invites a second click. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1 h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                      chosen ? 'border-brand-600 bg-brand-600 ring-2 ring-white' : 'border-ink-300',
                    )}
                  />
                </button>
              );
            })}
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          <Button className="mt-5 w-full" size="lg" disabled={!method || busy} onClick={pay}>
            {busy ? 'Starting secure checkout…' : `Pay ${money(total)}`}
          </Button>

          {/* Said before they commit, not after. The number they enter is typed
              on the payment provider's own page — AutoHire never sees it. */}
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-500">
            <Lock size={12} className="text-brand-600" />
            You'll enter your details on our secure checkout — AutoHire never sees them.
          </p>
          <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-400">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-600" />
            Your money is held until the trip is done. The host is paid only after you both
            confirm the car came back.
          </p>
        </>
      )}
    </section>
  );
}
