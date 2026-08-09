import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Landmark, Lock, QrCode, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import type { PaymentMethodType } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { PAYMENT_METHOD_META, PAYMENTS_PAYHOLD, paymentMethodsFor } from '@/lib/payments';
import { PayholdHandover } from '@/components/PayholdHandover';
import { MethodMarks } from '@/components/PaymentBrands';
import { Button, Input, Label } from '@/components/ui';

const METHOD_ICON: Record<PaymentMethodType, typeof Smartphone> = {
  card: CreditCard,
  momo: Smartphone,
  bank: Landmark,
  paypal: Wallet,
  alipay: QrCode,
  wechat_pay: QrCode,
};

/**
 * Choosing how to pay, and paying — on the booking page, in one place.
 *
 * This began as its own screen and should not have been. Checkout is a single
 * decision with a single confirmation, and sending the renter to a second page
 * to make half of it put the price on one screen and the payment on another.
 * Everything now happens beside the summary that states what is being paid for.
 *
 * What is on offer comes from PayHold's own `can_collect` table rather than a
 * list of ours, so a market it cannot charge never shows a method that would
 * fail at the end.
 */
export function PayholdPayment({
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
  const { data: me } = useCurrentUser();

  const [method, setMethod] = useState<PaymentMethodType | null>(null);
  const [ref, setRef] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Card carries no field — the provider collects it — so choosing it is
  // enough. Every other method needs the detail it asked for.
  const ready = !!method && (method === 'card' || ref.trim().length >= 4);

  async function pay() {
    if (!method) return;
    setBusy(true);
    setError(null);
    try {
      const { paymentLink } = await client.createPayholdDeal({
        listingId,
        startDate,
        endDate,
        preferredMethod: method,
        // Card details are never sent from here — see the note by the card row.
        payerRef: method === 'card' ? undefined : ref.trim() || undefined,
      });
      setLink(paymentLink);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
      setBusy(false);
    }
  }

  return (
    <div>
    {/* Once the deal exists the choice is made, so the picker gives way to
        the handover rather than sitting above it inviting a second answer. */}
    {link ? (
      <PayholdHandover paymentLink={link} />
    ) : (
      <>
        {/* Flat panels, not cards: this whole block already sits inside the
            checkout card, and a card within a card reads as a second subject. */}
        {!payerCountry && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-sm font-medium text-ink-900">Tell us where you're paying from</p>
            <p className="mt-0.5 text-xs text-ink-600">
              Payment options differ by country — mobile money isn't offered everywhere.{' '}
              <Link to="/account" className="font-medium text-brand-600 underline">
                Set your country
              </Link>
            </p>
          </div>
        )}

        {payerCountry && methods.length === 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-sm font-medium text-ink-900">
              We can't take payments from {known?.name ?? 'your country'} yet
            </p>
            <p className="mt-0.5 text-xs text-ink-600">
              Nothing has been charged and the car is still available.
            </p>
          </div>
        )}

        <div className={cn('grid gap-3', !payerCountry && 'pointer-events-none opacity-40')}>
          {methods.map((m) => {
            const meta = PAYMENT_METHOD_META[m];
            const Icon = METHOD_ICON[m];
            const chosen = method === m;
            return (
              <div
                key={m}
                className={cn(
                  'rounded-2xl border transition-all',
                  chosen
                    ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                    : 'border-ink-200 bg-white hover:border-ink-300 hover:shadow-card',
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    // Switching method clears the field: a MoMo number left in
                    // a PayPal row would be submitted as an address.
                    setMethod(m);
                    setRef('');
                  }}
                  aria-expanded={chosen}
                  className="flex w-full items-start gap-3 p-4 text-left"
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
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1 h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                      chosen ? 'border-brand-600 bg-brand-600 ring-2 ring-white' : 'border-ink-300',
                    )}
                  />
                </button>

                {/* The detail for this method, opened underneath it. */}
                {chosen && (
                  <div className="border-t border-brand-200/70 px-4 pb-4 pt-3">
                    {m === 'card' ? (
                      // No card fields, on PayHold's instruction and for the
                      // reason they give: an <input> we own puts the number in
                      // AutoHire's DOM, and that alone moves us from PCI SAQ A
                      // to SAQ D. The provider's own page collects it, which is
                      // the arrangement the whole integration is built on.
                      <p className="flex items-start gap-1.5 text-xs text-ink-600">
                        <Lock size={13} className="mt-0.5 shrink-0 text-brand-600" />
                        You'll enter your card on our payment provider's secure page — it never
                        passes through AutoHire.
                      </p>
                    ) : (
                      <>
                        <Label htmlFor={`ref-${m}`}>{meta.field}</Label>
                        <Input
                          id={`ref-${m}`}
                          value={ref}
                          onChange={(e) => setRef(e.target.value)}
                          placeholder={meta.placeholder}
                          inputMode={m === 'momo' || m === 'bank' ? 'numeric' : 'text'}
                          autoComplete="off"
                        />
                        <p className="mt-1.5 text-xs text-ink-500">
                          We pass this to the secure checkout so you don't type it again. You
                          approve the payment there.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <Button className="mt-5 w-full" size="lg" disabled={disabled || !ready || busy} onClick={pay}>
          {busy ? 'Starting secure checkout…' : `Pay ${label}`}
        </Button>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-500">
          <Lock size={12} className="text-brand-600" />
          You approve every payment on our secure checkout.
        </p>
        <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-400">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand-600" />
          Your money is held until the trip is done. The host is paid only after you both
          confirm the car came back.
        </p>
      </>
    )}
    </div>
  );
}
