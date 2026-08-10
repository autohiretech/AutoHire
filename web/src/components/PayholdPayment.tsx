import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { CheckoutModal } from '@/components/CheckoutModal';
import { Button } from '@/components/ui';

/**
 * Opening checkout. Nothing else.
 *
 * This file used to carry a second method picker of its own — icons, labels, a
 * field per method — shown whenever PayHold's checkout session could not be
 * read. It was described as a fallback and it was not one: its only exit was a
 * "Continue" button that navigated to PayHold's hosted page, which is the
 * screen this entire flow exists to stop a renter ever seeing. A fallback whose
 * destination is the failure mode is the failure mode, behind a condition.
 *
 * So there is now exactly one picker in AutoHire, it lives in `CheckoutModal`,
 * and it is PayHold's list rather than ours — PayHold knows which rails are
 * switched on in this market today and a constant here never will. When that
 * list cannot be read the modal says so and offers a retry. It does not offer a
 * way out of the app.
 *
 * No `preferredMethod` or `payerRef` is sent either. Both existed so a choice
 * made *here* could ride along to a page somewhere else; the choice is made in
 * the modal now, against the live list, and passing a guess ahead of it would
 * only be a second opinion for PayHold to ignore.
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

  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [checkoutBase, setCheckoutBase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where the renter pays FROM decides what they can pay with — not the car's
  // market. Someone in Kigali renting in Dubai still pays the way Rwanda can.
  // PayHold reads this off the deal; we only need it to explain a refusal.
  const payerCountry = me?.country ?? '';

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const { paymentLink, checkoutBase: base } = await client.createPayholdDeal({
        listingId,
        startDate,
        endDate,
      });
      setCheckoutBase(base);
      setLink(paymentLink);
      setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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

      {/* The choice lives in a modal so the booking summary stays put behind
          it — a renter deciding how to pay should still see what they are
          paying for. */}
      <Button
        className="h-14 w-full rounded-xl text-lg font-semibold shadow-sm"
        size="lg"
        disabled={disabled || busy}
        onClick={pay}
      >
        {busy ? 'Opening…' : `Pay ${label}`}
      </Button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <p className="mt-3.5 flex items-center justify-center gap-1.5 text-center text-sm text-ink-500">
        <Lock size={14} className="shrink-0 text-ink-400" />
        Your money is held until the trip is done — the host is paid after you both confirm the
        car came back.
      </p>

      <CheckoutModal
        open={open}
        onClose={() => {
          setOpen(false);
          setLink(null);
          setCheckoutBase(null);
        }}
        checkoutBase={checkoutBase}
        paymentLink={link ?? ''}
        amountLabel={label}
      />
    </>
  );
}
