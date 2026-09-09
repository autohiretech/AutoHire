import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Lock } from 'lucide-react';
import { client } from '@/lib/client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useCountry } from '@/lib/country';
import { presentmentCurrenciesFor } from '@/lib/payments';
import { CheckoutModal } from '@/components/CheckoutModal';
import { Button, Label, Notice, Select, Skeleton } from '@/components/ui';

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
  pickupTime,
  rentalType,
  estimatedHours,
  listingCurrency,
  label,
  disabled,
  onCheckoutOpenChange,
}: {
  listingId: string;
  startDate: string;
  endDate: string;
  /** Agreed pickup time-of-day (HH:mm) — what a late return is measured from. */
  pickupTime: string;
  rentalType: 'daily' | 'hourly';
  /** Required when rentalType is 'hourly' — the duration the deposit is against. */
  estimatedHours?: number;
  /**
   * What the car is priced in — the deal's settlement currency, and what the
   * host is owed. The renter can ask to be charged in something else; this
   * never moves.
   */
  listingCurrency: string;
  label: string;
  disabled: boolean;
  /**
   * A deal is a snapshot — PayHold prices it once, at creation, off whatever
   * `estimatedHours` was at that moment. Nothing re-prices it if the caller's
   * own hours input keeps changing underneath an open checkout, so the
   * caller uses this to lock that input for as long as a deal exists: open,
   * or paid and simply not yet closed.
   */
  onCheckoutOpenChange?: (open: boolean) => void;
}) {
  const { data: me } = useCurrentUser();
  // Only for the flag and the country name beside each code — the list of
  // codes itself comes from PayHold below, not from here.
  const { currencies: currencyMeta } = useCountry();
  const navigate = useNavigate();

  // PayHold's own collection table. Shares react-query's cache with the payout
  // screen's copy, so a renter who has been anywhere near /payouts/setup this
  // session pays nothing for it.
  const { data: payoutCountries } = useQuery({
    queryKey: ['payholdPayoutCountries'],
    queryFn: () => client.payholdPayoutCountries(),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  // What this renter's own market can actually be charged, which is a
  // different and narrower question than the bulk table above answers. Asked
  // per country and cached for an hour on both sides; skipped entirely until
  // we know where the renter is, since the answer is about them.
  const { data: collectOptions, isPending: optionsPending } = useQuery({
    queryKey: ['payholdCollectionOptions', me?.country ?? ''],
    queryFn: () => client.payholdCollectionOptions(me!.country!),
    enabled: !!me?.country,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [checkoutBase, setCheckoutBase] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCheckoutOpenChange?.(open);
    // Only the transition matters to the caller, not its own identity —
    // re-running this because a re-render gave it a new function reference
    // would report "open" repeatedly for no real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Where the renter pays FROM decides what they can pay with — not the car's
  // market. Someone in Kigali renting in Dubai still pays the way Rwanda can,
  // so this stays their own account country and is not something the picker
  // below moves.
  //
  // The picker used to name a COUNTRY, and asking "which market shall we
  // pretend you're in" to answer "which currency do you want to be charged in"
  // was a riddle: a renter who wanted USD had to know to pick the United
  // States, and picking it also changed which payment methods PayHold offered
  // them. Currency is the thing they actually care about, so it is the thing
  // they are asked.
  const payerCountry = me?.country ?? '';
  const currencies = useMemo(
    () =>
      presentmentCurrenciesFor(payerCountry, payoutCountries?.countries, collectOptions),
    [payerCountry, payoutCountries, collectOptions],
  );
  // react-query v5 reports a *disabled* query as `isPending` forever — it has
  // no data and never will until it is enabled — so `optionsPending` alone
  // cannot distinguish "waiting for PayHold" from "never asked, because we
  // don't know the renter's country". Gating the Pay button on the raw flag
  // would strand anyone with no country set behind a spinner that resolves
  // never.
  const optionsLoading = !!payerCountry && optionsPending;

  const [payInCurrency, setPayInCurrency] = useState('');
  useEffect(() => {
    // The car's own currency when this renter's market can be charged in it —
    // nothing is converted, and the total they were quoted is the total on
    // their statement. Otherwise USD, which is what PayHold falls back to
    // anyway, so defaulting anywhere else would be inventing a third answer.
    // Not before PayHold has answered: the pre-load list cannot contain the
    // renter's own market currency, so defaulting off it would quietly charge
    // a Kigali renter in USD for a car priced in RWF.
    if (optionsPending || payInCurrency || !currencies.length) return;
    setPayInCurrency(currencies.includes(listingCurrency) ? listingCurrency : 'USD');
  }, [currencies, listingCurrency, payInCurrency, optionsPending]);
  const chargeCurrency = payInCurrency || listingCurrency;

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const { dealId: newDealId, paymentLink, checkoutBase: base } = await client.createPayholdDeal({
        listingId,
        startDate,
        endDate,
        pickupTime,
        rentalType,
        ...(estimatedHours !== undefined ? { estimatedHours } : {}),
        // Still their real country — it is what decides which rails can take
        // their money. Only the currency is theirs to choose.
        ...(payerCountry ? { buyerCountry: payerCountry } : {}),
        ...(chargeCurrency && chargeCurrency !== listingCurrency
          ? { presentmentCurrency: chargeCurrency }
          : {}),
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
        <Notice tone="warn" className="mb-4 flex-col items-start">
          <p className="font-medium">Tell us where you're paying from</p>
          <p className="mt-0.5">
            Payment options differ by country — mobile money isn't offered everywhere.{' '}
            <Link to="/account" className="font-medium underline">
              Set your country
            </Link>
          </p>
        </Notice>
      )}

      {/* Reserves the currency card's own space while PayHold is still
          answering. Without it the card appeared *above* the Pay button once
          the answer landed, shoving the button down the page mid-aim — and
          the renter had already been able to press it (see the button's
          `disabled` below for why that mattered). A skeleton the shape of
          the real card means nothing moves when it arrives. */}
      {optionsLoading && (
        <div
          className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3"
          aria-busy="true"
          aria-label="Loading payment currencies"
        >
          <Skeleton className="h-4 w-16" />
          <Skeleton className="mt-1.5 h-11 w-full" />
          <Skeleton className="mt-1.5 h-3.5 w-3/4" />
        </div>
      )}

      {/* Which currency the renter is charged in — not which cars are shown,
          that's the header's country selector, and not where they pay from,
          which stays their account country. Changing it affects this one
          payment only; the host is still owed the car's own currency. */}
      {payerCountry && !optionsLoading && currencies.length > 1 && (
        <div className="mb-4 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-[var(--color-surface-sunken)] p-3">
          <Label htmlFor="pay-in-currency" className="flex items-center gap-1.5 text-[var(--color-content-muted)]">
            <Landmark size={14} className="text-[var(--color-content-subtle)]" /> Pay in
          </Label>
          <Select
            id="pay-in-currency"
            value={chargeCurrency}
            onChange={(e) => setPayInCurrency(e.target.value)}
          >
            {currencies.map((code) => {
              const meta = currencyMeta.find((c) => c.currency === code);
              return (
                <option key={code} value={code}>
                  {meta ? `${meta.flag} ${code} — ${meta.name}` : code}
                </option>
              );
            })}
          </Select>
          <p className="mt-1.5 text-caption text-[var(--color-content-muted)]">
            {chargeCurrency === listingCurrency
              ? `Charged in ${chargeCurrency} — the price you see, with nothing converted.`
              : `Charged in ${chargeCurrency}. PayHold converts from ${listingCurrency} and carries the exchange rate.`}
          </p>
        </div>
      )}

      {/* The choice lives in a modal so the booking summary stays put behind
          it — a renter deciding how to pay should still see what they are
          paying for. This is the one accent action in this flow. */}
      {/* `optionsPending` belongs in here, and its absence was a money bug
          rather than a cosmetic one. A deal is priced once at creation and
          never re-priced. While PayHold is still answering, `currencies` is
          empty, so the picker above has not rendered, `payInCurrency` is
          still '' and `chargeCurrency` collapses to the listing's own
          currency — which means `pay()` sends no `presentmentCurrency` at
          all and PayHold picks for the renter. Press Pay a moment early and
          you get a snapshot deal in a currency you were never shown and
          cannot now change. The choice has to exist before the button that
          commits it does. */}
      <Button
        className="w-full"
        size="lg"
        disabled={disabled || busy || optionsLoading || !payerCountry}
        onClick={pay}
      >
        {busy
          ? 'Opening…'
          : optionsLoading
            ? 'Checking payment options…'
            : !payerCountry
              ? 'Set your country to pay'
              : `Pay ${label}`}
      </Button>
      {error && (
        <Notice tone="danger" className="mt-3">
          {error}
        </Notice>
      )}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-body-sm text-[var(--color-content-muted)]">
        <Lock size={13} className="shrink-0 text-[var(--color-content-subtle)]" />
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
