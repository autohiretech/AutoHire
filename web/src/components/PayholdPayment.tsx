import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Landmark, Lock } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useCountry } from '@/lib/country';
import { CheckoutModal } from '@/components/CheckoutModal';
import { Button, Label, Select } from '@/components/ui';

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
  const { countries } = useCountry();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [checkoutBase, setCheckoutBase] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where the renter pays FROM decides what they can pay with, and which
  // currency their card is actually charged in — not the car's market. Someone
  // in Kigali renting in Dubai still pays the way Rwanda can. Defaults to their
  // account country but is editable here: a renter whose card is foreign (or
  // who simply prefers to be charged in a currency other than their account's)
  // picks a different market for this one payment instead of being stuck with
  // whatever their profile says.
  const payerCountry = me?.country ?? '';
  const [payAsCountry, setPayAsCountry] = useState('');
  useEffect(() => {
    if (payerCountry && !payAsCountry) setPayAsCountry(payerCountry);
  }, [payerCountry, payAsCountry]);
  const chargeCountry = payAsCountry || payerCountry;
  const chargeCurrency = countries.find((c) => c.code === chargeCountry)?.currency;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const { dealId: newDealId, paymentLink, checkoutBase: base } = await client.createPayholdDeal({
        listingId,
        startDate,
        endDate,
        ...(chargeCountry && chargeCountry !== payerCountry ? { buyerCountry: chargeCountry } : {}),
      });
      setCheckoutBase(base);
      setLink(paymentLink);
      setDealId(newDealId);
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

      {/* Which currency the card gets charged in, not which cars are shown —
          that's the header's country selector. Changing it here only affects
          this one payment; it never touches the account's saved country. */}
      {payerCountry && countries.length > 0 && (
        <div className="mb-4 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
          <Label htmlFor="pay-as-country" className="flex items-center gap-1.5 text-ink-700">
            <Landmark size={14} className="text-ink-400" /> Charge my card as
          </Label>
          <Select
            id="pay-as-country"
            value={chargeCountry}
            onChange={(e) => setPayAsCountry(e.target.value)}
          >
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} — {c.currency}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-ink-500">
            {chargeCurrency
              ? `Your card will be charged in ${chargeCurrency}. PayHold converts the total automatically.`
              : "PayHold picks the currency your card accepts once you continue."}
          </p>
        </div>
      )}

      {/* The choice lives in a modal so the booking summary stays put behind
          it — a renter deciding how to pay should still see what they are
          paying for. */}
      <Button
        className="h-[52px] w-full rounded-xl text-base font-semibold shadow-sm"
        size="lg"
        disabled={disabled || busy}
        onClick={pay}
      >
        {busy ? 'Opening…' : `Pay ${label}`}
      </Button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[13px] text-ink-500">
        <Lock size={13} className="shrink-0 text-ink-400" />
        Your money is held until the trip is done — the host is paid after you both confirm the
        car came back.
      </p>

      <CheckoutModal
        open={open}
        onClose={() => {
          setOpen(false);
          setLink(null);
          setCheckoutBase(null);
          setDealId(null);
        }}
        checkoutBase={checkoutBase}
        paymentLink={link ?? ''}
        amountLabel={label}
        dealId={dealId}
        // Straight to the trip the moment it exists — the renter just paid
        // for it, and the only reason to leave them here is a page they
        // no longer need.
        onPaid={(bookingId) => {
          setOpen(false);
          setLink(null);
          setCheckoutBase(null);
          setDealId(null);
          navigate(`/trips/${bookingId}`);
        }}
      />
    </>
  );
}
