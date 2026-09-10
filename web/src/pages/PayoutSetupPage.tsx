import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  Check,
  CheckCircle2,
  Clock,
  Lock,
  MapPin,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { PayoutMethodType, PayoutProvider } from '@autohire/shared';
import { client } from '@/lib/client';
import { StripeConnectOnboarding } from '@/components/StripeConnectOnboarding';
import { cn } from '@/lib/cn';
import { useCountry } from '@/lib/country';
import { useCurrentUser } from '@/lib/useCurrentUser';
import {
  PAYMENTS_LIVE,
  PAYMENTS_PAYHOLD,
  PAYOUT_METHOD_ICON,
  PAYOUT_METHOD_META,
  maskDestination,
  isPayPalDestination,
  payoutAvailability,
  payoutLabel,
  payoutProviderFor,
} from '@/lib/payments';
import {
  BrandMark,
  CARD_BRANDS,
  detectCardScheme,
  detectMomoNetwork,
  walletBrand,
} from '@/lib/paymentBrands';
import { Badge, Button, Card, CardBody, Input, Label, ListGroup, ListRow, Modal, Notice, Select, Skeleton, toast } from '@/components/ui';

const PROVIDER_NAME: Record<PayoutProvider, string> = {
  flutterwave: 'Flutterwave',
  stripe: 'Stripe',
  // The external system is the platform's own rail — hosts see AutoHire, not a
  // third-party brand they've never heard of.
  external: 'AutoHire Payments',
  payhold: 'PayHold',
};

/**
 * What actually happens to payouts while the new destination is checked.
 *
 * This screen used to say "payouts pause for up to 24 hours" everywhere, as a
 * fact. §5.1's security hold is a per-tenant setting now and may be zero, so
 * the sentence has to be read off the answer PayHold gave — telling a host to
 * expect a day of silence they will not get is the same kind of wrong as not
 * warning them about one they will.
 */
function holdNotice(securityHoldUntil: string | null, canReceivePayouts: boolean): string {
  const until = securityHoldUntil ? new Date(securityHoldUntil) : null;
  const msLeft = until && !Number.isNaN(until.getTime()) ? until.getTime() - Date.now() : 0;
  if (msLeft <= 0) {
    return canReceivePayouts
      ? 'Nothing pauses — your next payout goes there.'
      : 'Payouts start once PayHold has verified the account.';
  }
  const hours = Math.ceil(msLeft / 3_600_000);
  const window = hours <= 1 ? 'about an hour' : `about ${hours} hours`;
  return (
    `It's verified first, so payouts pause for ${window} — your cars stay bookable and ` +
    'the money keeps building up in the meantime.'
  );
}

/**
 * Host payout-method setup. The host picks how they want to be paid — Mobile
 * Money, Bank, or Card — and the system routes it to the right provider behind
 * the scenes. Required before earning; surfaced from the dashboard checklist and
 * when a renter switches to hosting.
 */
/**
 * The payout setup UI itself, with no opinion about what surrounds it.
 *
 * Extracted so adding a payout method stops being a page change. Everywhere a
 * host is prompted to set payouts up they are already looking at the thing
 * that prompted them — the earnings screen, the dashboard tile, an account row
 * — and navigating away to a form, then back, loses that context for a task
 * that is four fields long. Checkout has worked this way for a while
 * (`CheckoutModal`); this brings payouts in line.
 *
 * **The route stays**, so `chrome: 'page'` is not vestigial: Stripe Connect's
 * hosted onboarding returns the host to a URL, `StripeConnectReturnPage` links
 * back here, and a deep link to `/payouts/setup` has to keep working.
 */
function PayoutSetupBody({
  chrome,
  onDone,
}: {
  chrome: 'page' | 'modal';
  onDone?: () => void;
}) {
  // Whether Stripe's onboarding is mounted here rather than redirected to.
  const [embedConnect, setEmbedConnect] = useState(false);
  const { countries } = useCountry();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useCurrentUser();

  /**
   * The live answer, not the profile's own frozen copy of it.
   *
   * `profiles.payout_status` is written once, at the moment a destination is
   * saved, against whatever PayHold said in that instant. Nothing writes it
   * again — a destination verified afterward (someone clicking Verify in
   * PayHold's dashboard, a security hold expiring, the tenant turning on
   * auto-verify) never reaches AutoHire on its own, because
   * `verify_seller_destination` writes an audit row, not a webhook. So a host
   * who had just been checked read "Verifying" forever, on the one screen
   * whose whole job is telling them whether they can be paid.
   *
   * `payhold-seller` reconciles the column against live capabilities on every
   * call now, so simply asking here both answers this page correctly and
   * fixes the column for every other screen reading it afterward.
   */
  const { data: liveSeller } = useQuery({
    queryKey: ['payholdSeller'],
    queryFn: () => client.payholdSeller(),
    enabled: PAYMENTS_PAYHOLD && !!me?.payoutLabel,
    // Short-lived, deliberately: this page exists to answer "can I be paid
    // yet", and a host who just came back from verifying in PayHold's own
    // dashboard should not have to wait out a long cache to hear yes.
    staleTime: 15_000,
    retry: false,
  });

  // The host's OWN country decides which methods they can use and which rail
  // they land on — not the header selector, which only filters the catalogue
  // and lives in localStorage. Guessing from that put hosts on the wrong rail
  // and then froze it into their profile.
  const payoutCountry = me?.country ?? '';

  // PayHold's own routing table, not our constant. Only worth asking once the
  // host has a country to look up, and only on the PayHold rail — the old rails
  // route themselves and have no such endpoint.
  const { data: payoutCountries } = useQuery({
    queryKey: ['payholdPayoutCountries'],
    queryFn: () => client.payholdPayoutCountries(),
    enabled: PAYMENTS_PAYHOLD && !!payoutCountry,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const known = payoutCountries?.countries.find((c) => c.code === payoutCountry) ?? null;

  const [selected, setSelected] = useState<PayoutMethodType | null>(null);
  const [dest, setDest] = useState('');
  // Which wallet the number is on, and which bank the account is with. PayHold
  // used to infer both and refuses to now: an inferred wrong one registered a
  // destination Flutterwave will not actually transfer to, and the host only
  // found out when a payout failed weeks later.
  const [network, setNetwork] = useState('');
  const [bankCode, setBankCode] = useState('');
  /**
   * Has the host picked a wallet themselves?
   *
   * The number's prefix fills this field in for them, which is the whole
   * convenience — but the moment they tap a tile, the next keystroke must not
   * overwrite the choice they just made. So detection writes only into an
   * untouched field, and touching it is permanent for that method.
   */
  const [networkTouched, setNetworkTouched] = useState(false);

  // The bulk list above only says whether `payoutCountry` can be paid at all;
  // this is what actually decides which methods to offer inside it — see
  // `payoutMethodsFromRoute`. Asked only once the bulk check already says
  // `can_payout`, so a host in a closed market costs one PayHold call instead
  // of two.
  const { data: payoutRoute } = useQuery({
    queryKey: ['payholdPayoutRoute', payoutCountry],
    queryFn: () => client.payholdPayoutRoute(payoutCountry),
    enabled: PAYMENTS_PAYHOLD && !!payoutCountry && !!known?.can_payout,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  // Banks are a second, opt-in question: PayHold enumerates them live from the
  // rail, so they are only asked for once a host has actually picked Bank —
  // and never at all in a market whose bank rail is Stripe Connect, where
  // there is no account number to name a bank for.
  const { data: bankRoute, isFetching: banksLoading } = useQuery({
    queryKey: ['payholdPayoutRoute', payoutCountry, 'banks'],
    queryFn: () => client.payholdPayoutRoute(payoutCountry, { banks: true }),
    enabled:
      PAYMENTS_PAYHOLD &&
      !!payoutCountry &&
      !!known?.can_payout &&
      selected === 'bank' &&
      payoutRoute?.payout?.provider === 'flutterwave',
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  /**
   * Read the wallet out of the number as it is typed.
   *
   * Kept up here with the other hooks rather than beside the field it fills,
   * because it must run before this component's loading return — and stated
   * as an effect rather than derived state because the host owns `network`
   * the moment they touch it, and derived state cannot be overridden.
   *
   * `detectMomoNetwork` already filters against PayHold's list, so this
   * cannot select something the country does not offer.
   */
  useEffect(() => {
    if (!PAYMENTS_PAYHOLD || selected !== 'momo' || networkTouched) return;
    const offered = payoutRoute?.networks ?? [];
    const found = detectMomoNetwork(dest, payoutCountry, offered);
    // Only ever fills a blank or replaces a previous detection — never clears
    // a value, so backspacing to an ambiguous prefix leaves the last good
    // guess standing rather than emptying the field under the host.
    if (found && found !== network) setNetwork(found);
  }, [dest, selected, networkTouched, payoutRoute, payoutCountry, network]);

  const availability = payoutAvailability(
    payoutCountry,
    PAYMENTS_PAYHOLD ? known : undefined,
    PAYMENTS_PAYHOLD ? payoutRoute?.payout : undefined,
  );
  const methods = availability.state === 'ok' ? availability.methods : [];
  const countryName = known?.name ?? 'your country';

  // Under PayHold, `payoutProviderFor` always answers 'payhold' — the actual
  // rail is PayHold's own decision, not ours. The one place that decision
  // matters to this screen is here: Bank/Card outside Flutterwave's African
  // corridors settle through Stripe Connect, whose destination is an
  // `acct_…` Stripe mints during its own hosted onboarding, not a number a
  // host can type into a field. `payoutRoute` (already fetched above for the
  // method list) is what says so.
  const needsStripeConnect =
    PAYMENTS_PAYHOLD && payoutRoute?.payout?.provider === 'stripe' &&
    payoutRoute?.payout?.kind === 'connect';

  // Payout country used to be inherited from the profile with no way back to
  // it here — a host paid in whatever currency their account happened to
  // carry, with no path to a different one even though PayHold reaches over
  // a hundred countries. This is the toggle that reveals the picker again
  // once a country is already on file.
  const [changingCountry, setChangingCountry] = useState(false);

  // The live check wins when it answered; the profile's own copy is the
  // fallback while it loads or if PayHold could not be reached just now —
  // never a reason to flash "Verifying" over a host who a moment ago read
  // "Active".
  const active = (liveSeller?.payout?.status ?? me?.payoutStatus) === 'active';

  /**
   * A method is on file — which is not the same as being payable.
   *
   * Changing a destination sends `payout_status` back to 'pending' while
   * PayHold verifies the new account, and keying the card off `active` alone
   * made the host's payout method appear to vanish at exactly the moment they
   * had just saved one.
   */
  const connected = !!me?.payoutLabel && me.payoutStatus !== 'none';

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
    queryClient.invalidateQueries({ queryKey: ['payholdSeller'] });
  };

  const connect = useMutation({
    mutationFn: async (method: PayoutMethodType) => {
      // PayHold owns payouts on this rail, so the host has to exist there as a
      // SELLER — a deal names one, and without it their cars cannot be booked
      // at all. The raw destination goes straight to PayHold to be tokenized
      // and is written down by neither side.
      if (PAYMENTS_PAYHOLD) {
        // The number is sent exactly as typed — PayHold normalises it itself,
        // and a second opinion here would only be a different wrong answer for
        // the country whose format we guessed at.
        return await client.registerPayholdSeller({
          method,
          destination: dest.trim(),
          ...(method === 'momo' && network ? { network } : {}),
          ...(method === 'bank' && bankCode ? { bankCode: bankCode.trim() } : {}),
        });
      }

      const provider = payoutProviderFor(method, payoutCountry);
      // Live + Flutterwave: register the raw destination as a beneficiary server-
      // side (only a token is stored). Otherwise store the masked method directly.
      if (PAYMENTS_LIVE && provider === 'flutterwave' && (method === 'momo' || method === 'bank')) {
        return await client.connectPayoutBeneficiary({ method, destination: dest.trim() });
      }
      return await client.setPayoutMethod({
        method,
        provider,
        destinationMasked: maskDestination(dest),
        label: payoutLabel(method, dest),
      });
    },
    onSuccess: (result) => {
      refresh();
      setSelected(null);
      // In a modal, saving is the end of the task. On the page there is
      // nowhere to go, so this is a no-op there.
      onDone?.();
      setDest('');
      setNetwork('');
      setBankCode('');
      setNetworkTouched(false);

      // PayHold decides whether this host can actually be paid, and says why
      // not. Telling them now beats a payout that sits stuck weeks later with
      // a renter's money already taken.
      if (result && typeof result === 'object' && 'canReceivePayouts' in result) {
        const r = result as {
          relinked?: boolean;
          changed?: boolean;
          securityHoldUntil?: string | null;
          maskedDestination: string;
          canReceivePayouts: boolean;
          reasons: string[];
          routeReasons: string[];
        };

        // A payout account already existed for this host and we reconnected it.
        // Say plainly that the number they just typed was not used: this path
        // repairs a lost link, and the destination on file is the one PayHold
        // has a token for. Saving again now goes down the change path, which
        // does use what they typed.
        if (r.relinked) {
          toast.success(
            `Reconnected your existing payout account (${r.maskedDestination}) — the number you entered was not saved. ` +
              'Save it again to move your payouts there.',
          );
          return;
        }

        // A change, not a first registration. The new account is real but
        // frozen while PayHold checks it belongs to them — the same hold that
        // stops someone who got into the account from redirecting the money.
        if (r.changed) {
          toast.success(
            `Payouts will now go to ${r.maskedDestination}. ` +
              holdNotice(r.securityHoldUntil ?? null, r.canReceivePayouts),
          );
          return;
        }

        if (r.canReceivePayouts) {
          toast.success('Payout method saved — you can receive payouts.');
        } else {
          const blockers = [...r.reasons, ...r.routeReasons];
          toast.success(
            blockers.length
              ? `Saved. Before you can be paid: ${blockers.join('; ')}`
              : 'Saved. Payouts unlock once your account finishes verification.',
          );
        }
        return;
      }
      toast.success('Payout method saved.');
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : "Couldn't save your payout method. Please try again.",
      ),
  });

  const connectStripe = useMutation({
    mutationFn: () => client.startStripeConnectOnboarding(),
    onSuccess: ({ url }) => {
      // A real navigation, not a fetch — the rest of onboarding happens on
      // Stripe's own hosted page, and completion is picked up back here by
      // `/payouts/stripe-connect/return` polling PayHold, not by anything
      // this response carries.
      window.location.href = url;
    },
    onError: (e) =>
      toast.error(
        e instanceof Error && e.message ? e.message : "Couldn't start Stripe onboarding. Please try again.",
      ),
  });

  const saveCountry = useMutation({
    mutationFn: (code: string) => client.updateProfile({ country: code }),
    onSuccess: () => refresh(),
    onError: () => toast.error("Couldn't save your country. Please try again."),
  });

  const remove = useMutation({
    mutationFn: () => client.clearPayoutMethod(),
    onSuccess: () => {
      refresh();
      toast.success('Payout method removed.');
    },
    onError: () => toast.error("Couldn't remove your payout method. Please try again."),
  });

  if (isLoading) {
    return <PayoutSetupSkeleton chrome={chrome} />;
  }

  const meta = selected ? PAYOUT_METHOD_META[selected] : null;

  // A number on its own no longer names a destination. PayHold refuses a
  // mobile-money one with no wallet and a local bank one with no bank code
  // rather than guessing, so these are as required as the number itself —
  // failing here, in front of the host, beats a policy_violation after.
  const networks = payoutRoute?.networks ?? [];
  const banks = bankRoute?.banks ?? null;
  const needsNetwork = PAYMENTS_PAYHOLD && selected === 'momo';

  // What the number says the wallet is, filtered against PayHold's own list
  // for this country — see `detectMomoNetwork`. A convenience, never a
  // decision: the effect below only fills a blank the host has not touched.
  const detectedNetwork =
    needsNetwork && !networkTouched ? detectMomoNetwork(dest, payoutCountry, networks) : null;
  const cardScheme = selected === 'card' ? detectCardScheme(dest) : null;
  const needsBankCode =
    PAYMENTS_PAYHOLD && selected === 'bank' && payoutRoute?.payout?.provider === 'flutterwave';
  // PayPal is the one destination that is not a number, so the generic
  // "at least 4 characters" gate does not describe it — `ab@c` would submit and
  // come back refused from two systems away. `isPayPalDestination` is PayHold's
  // own rule, checked here so the host is told in front of the field.
  const destValid = selected === 'paypal'
    ? isPayPalDestination(dest)
    : dest.trim().length >= 4;
  const canSave =
    !!selected &&
    destValid &&
    (!needsNetwork || !!network) &&
    (!needsBankCode || !!bankCode.trim());
  const routedProvider = selected ? payoutProviderFor(selected, payoutCountry) : null;

  const isModal = chrome === 'modal';
  const Root = isModal ? 'div' : 'section';

  return (
    <Root className={isModal ? undefined : 'mx-auto max-w-2xl px-4 py-8 sm:py-10'}>
      {/* Back, the title block and the icon are the page's own furniture. In a
          modal the dialog supplies its own heading and a close control, and a
          "Back" that calls `navigate(-1)` inside an overlay would take the host
          off the screen they opened it from. */}
      {!isModal && (
        <>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-5 inline-flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
          >
            <ArrowLeft size={16} /> Back
          </button>

          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]">
              <Banknote size={22} />
            </span>
            <div>
              <h1 className="text-h2">How you get paid</h1>
              <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
                Add where your rental earnings are sent. You keep the subtotal; AutoHire's fee is deducted.
              </p>
            </div>
          </div>
        </>
      )}

      <div className={cn('flex flex-col gap-6', !isModal && 'mt-6')}>
        {/* Currently connected — a genuine state, so it's a Notice: reassurance
            (brand) once active, action-needed (warn) while still verifying. */}
        {connected && me && (
          <Notice tone={active ? 'brand' : 'warn'} className="flex-wrap items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-raised)] ring-1 ring-current/20">
                {active ? <CheckCircle2 size={20} /> : <Clock size={20} />}
              </span>
              <div>
                <p className="flex items-center gap-2 font-semibold text-[var(--color-content)]">
                  {me.payoutLabel ?? 'Payout method'}
                  {active ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="warning">Verifying</Badge>
                  )}
                </p>
                <p className="text-body-sm text-[var(--color-content-muted)]">
                  {active
                    ? 'Earnings are released here after each completed trip.'
                    : 'Being checked before the first payout. Your earnings keep building up meanwhile.'}
                </p>
              </div>
            </div>
            {/* Under PayHold there is nothing here to REMOVE: the destination
                is held by PayHold, which has no delete-seller endpoint, and
                money may already be owed to that record. Clearing our columns
                would change nothing and imply otherwise. Changing it is a
                different matter and is the form below. */}
            {PAYMENTS_PAYHOLD ? (
              <span className="text-caption text-[var(--color-content-muted)]">
                Moving? Save a new method below.
              </span>
            ) : (
              <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                <Trash2 size={14} /> Remove
              </Button>
            )}
          </Notice>
        )}

        {/* Country decides both the methods on offer and the currency they pay
            in — a US bank account settles in USD, a Rwandan Mobile Money number
            in RWF. It used to be set once from the profile and then frozen,
            with nothing on this screen to change it back — so a host who
            wanted a different currency than whatever their profile happened to
            carry had no way to ask for one. Always changeable now, not just on
            the first visit. */}
        {payoutCountry && !changingCountry && (
          <ListGroup>
            <ListRow
              icon={<MapPin size={18} />}
              value={`${countries.find((c) => c.code === payoutCountry)?.flag ?? ''} ${countryName}`}
              onClick={() => setChangingCountry(true)}
            >
              Paying out from
            </ListRow>
          </ListGroup>
        )}

        {(!payoutCountry || changingCountry) && (
          <Notice tone="warn" className="flex-col items-stretch">
            <div>
              <p className="font-medium">Where do you get paid?</p>
              <p className="mt-0.5">
                This decides which payout methods and which currency are available — pick the
                country of the account you actually want the money to land in, not necessarily
                where you live.
              </p>
            </div>
            <Select
              aria-label="Payout country"
              className="mt-3"
              value=""
              disabled={saveCountry.isPending}
              onChange={(e) => {
                if (!e.target.value) return;
                saveCountry.mutate(e.target.value);
                setChangingCountry(false);
              }}
            >
              <option value="" disabled>
                Select your country
              </option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name}
                </option>
              ))}
            </Select>
            {payoutCountry && (
              <button
                type="button"
                onClick={() => setChangingCountry(false)}
                className="mt-2 self-start text-caption underline underline-offset-2"
              >
                Cancel
              </button>
            )}
          </Notice>
        )}

        {/* PayHold cannot pay this country — say so instead of offering a method
            that fails on submit. Before this, a host here picked Bank or Card,
            typed their account number, and got a 422 they could do nothing about. */}
        {payoutCountry && availability.state !== 'ok' && (
          <Notice tone={availability.state === 'unavailable' ? 'warn' : 'danger'} className="flex-col items-stretch">
            <p className="font-medium">
              {availability.state === 'restricted'
                ? `Payouts aren't available in ${countryName}.`
                : availability.state === 'unavailable'
                  ? `We can't send payouts to ${countryName} yet.`
                  : `We couldn't work out how payouts route in ${countryName}.`}
            </p>
            <p className="mt-1">
              {availability.state === 'restricted'
                ? 'This market is sanctioned, so money cannot move in either direction.'
                : availability.state === 'unavailable'
                  ? (availability.reason ??
                    `Renters in ${countryName} can still book and pay — it's only payouts that aren't open yet. We'll email you the moment they are.`)
                  : 'This is unexpected — try refreshing, and contact support if it keeps happening.'}
            </p>
            <p className="mt-1">
              Until then your listings can't take bookings, because we won't hold a renter's money
              for a trip we can't pay you for.
            </p>
          </Notice>
        )}

        {/* Method chooser. A tile grid, not ListRow — this is a single-select
            choice among peers, not a list of settings to navigate into, and
            (per Chip's own rationale, see Chip.tsx) the selected state is
            carried by inverting to the solid surface rather than by hue, so
            the accent stays spent on the one Save/Connect action below. */}
        <div className={cn((!payoutCountry || availability.state !== 'ok') && 'pointer-events-none hidden')}>
          <p className="mb-2 text-body-sm font-medium text-[var(--color-content)]">
            {connected ? 'Change your payout method' : 'Choose how you want to be paid'}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {methods.map((m) => {
              const isSel = selected === m;
              const Icon = PAYOUT_METHOD_ICON[m];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setSelected(isSel ? null : m);
                    setDest('');
                    setNetwork('');
                    setBankCode('');
                    // A different method is a fresh question, so detection
                    // gets to answer it again.
                    setNetworkTouched(false);
                  }}
                  aria-pressed={isSel}
                  className={cn(
                    'flex flex-col gap-2 rounded-[var(--radius-card)] border p-4 text-left transition-colors',
                    isSel
                      ? 'border-[var(--color-surface-inverse)] bg-[var(--color-surface-inverse)] text-[var(--color-content-inverse)]'
                      : 'border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] text-[var(--color-content)] hover:bg-[var(--color-surface-sunken)]',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)]',
                      isSel
                        ? 'bg-[var(--color-content-inverse)]/15 text-[var(--color-content-inverse)]'
                        : 'bg-[var(--color-surface-sunken)] text-[var(--color-content-muted)]',
                    )}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="font-semibold">{PAYOUT_METHOD_META[m].label}</span>
                  <span
                    className={cn(
                      'text-caption leading-relaxed',
                      isSel ? 'text-[var(--color-content-inverse)]/80' : 'text-[var(--color-content-muted)]',
                    )}
                  >
                    {PAYOUT_METHOD_META[m].blurb}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Destination form for the chosen method — or, on Stripe Connect
            markets, the onboarding handoff instead of a field nothing here can
            validate. This is the one primary (green) action on the whole
            screen — everything above it is a Notice, a nav row, or a
            selection tile. */}
        {meta && selected && needsStripeConnect && (selected === 'bank' || selected === 'card') ? (
          <Card>
            <CardBody className="space-y-3">
              <p className="text-body-sm text-[var(--color-content-muted)]">
                Getting paid in {countryName} goes through Stripe. You'll set up your account on
                Stripe's own secure page — bank details go straight to them, never through us.
              </p>
              <p className="flex items-center gap-1.5 text-caption text-[var(--color-content-muted)]">
                <Lock size={12} className="text-[var(--color-accent-on)]" /> Processed securely via
                Stripe. We only ever see that your account is connected, never the details behind it.
              </p>
              {connected && (
                <Notice tone="warn">
                  This replaces {me?.payoutLabel ?? 'your current method'}. New accounts are verified
                  before they're paid, so payouts can pause while that happens — your cars stay
                  bookable and your earnings keep building up either way. We'll tell you how long
                  once it's saved.
                </Notice>
              )}
              {/* Embedded first, hosted page as the way out.
                  Onboarding now mounts here rather than sending the host to
                  connect.stripe.com — the last part of payout setup that left
                  the app. The redirect is not deprecated: Stripe rules
                  embedded components out inside mobile and desktop webviews
                  and AutoHire ships as a PWA, so `onFallback` has to stay
                  reachable from inside the component too, not only when it
                  fails to load. */}
              {embedConnect ? (
                <StripeConnectOnboarding
                  onExit={() => {
                    // Leaving is not finishing. Stripe says nothing about
                    // whether the host completed anything, so this asks
                    // PayHold — `/connect/status` is what promotes the
                    // destination, and it is the same call the hosted-page
                    // return route makes.
                    setEmbedConnect(false);
                    void client
                      .stripeConnectStatus()
                      .catch(() => undefined)
                      .finally(refresh);
                  }}
                  onFallback={() => {
                    setEmbedConnect(false);
                    connectStripe.mutate();
                  }}
                />
              ) : (
                <Button
                  className="w-full"
                  disabled={connectStripe.isPending}
                  onClick={() => setEmbedConnect(true)}
                >
                  Connect with Stripe
                </Button>
              )}
            </CardBody>
          </Card>
        ) : (
          meta &&
          selected && (
            <Card>
              <CardBody className="space-y-3">
                {/* Which wallet, asked before the number, because it is what
                    the number belongs to. PayHold's own list for this country
                    — a wallet that isn't on it is one Flutterwave cannot
                    transfer to, so typing a brand freely was never a kindness.
                    The free-text fallback only runs if that list is missing:
                    an unsaveable form is worse than an unvalidated one. */}
                {needsNetwork && (
                  <div>
                    <Label htmlFor="payout-network">Mobile money network</Label>
                    {networks.length > 0 ? (
                      <>
                        {/* Tiles rather than a dropdown: a host recognises
                            their wallet by its colour before they read the
                            word, and this is the one field where picking the
                            wrong option is silently unpayable rather than
                            merely wrong. The list is still PayHold's — every
                            tile comes from `networks`, and a wallet with no
                            branding here renders in neutral colours under its
                            own name rather than being dropped. */}
                        <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {networks.map((n) => {
                            const brand = walletBrand(n);
                            const isSel = network === n;
                            return (
                              <button
                                key={n}
                                type="button"
                                id={n === networks[0] ? 'payout-network' : undefined}
                                onClick={() => {
                                  setNetwork(n);
                                  // They have answered the question, so stop
                                  // answering it for them — otherwise the next
                                  // keystroke would overwrite the choice they
                                  // just made with the prefix's opinion.
                                  setNetworkTouched(true);
                                }}
                                aria-pressed={isSel}
                                className={cn(
                                  'flex items-center gap-2 rounded-[var(--radius-control)] border p-2.5 text-left transition-colors',
                                  isSel
                                    ? 'border-[var(--color-accent-on)] bg-[var(--color-surface-sunken)]'
                                    : 'border-[var(--color-line-strong)] bg-[var(--color-surface-raised)] hover:bg-[var(--color-surface-sunken)]',
                                )}
                              >
                                <BrandMark brand={brand} size="sm" />
                                <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-[var(--color-content)]">
                                  {brand.label}
                                </span>
                                {isSel && (
                                  <Check size={14} className="shrink-0 text-[var(--color-accent-on)]" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {detectedNetwork && !networkTouched && (
                          <p className="mt-1.5 flex items-center gap-1 text-caption text-[var(--color-content-muted)]">
                            <Check size={12} className="text-[var(--color-accent-on)]" />
                            Picked from your number — change it if that's not right.
                          </p>
                        )}
                      </>
                    ) : (
                      <Input
                        id="payout-network"
                        value={network}
                        onChange={(e) => {
                          setNetwork(e.target.value);
                          setNetworkTouched(true);
                        }}
                        placeholder="MTN"
                      />
                    )}
                  </div>
                )}

                {/* The bank list is fetched only once Bank is picked, and
                    `banks: null` means "we couldn't ask", not "there are
                    none" — so an empty picker is never shown; the host types
                    the code from their own statement instead. */}
                {needsBankCode && (
                  <div>
                    <Label htmlFor="payout-bank">Bank</Label>
                    {banks && banks.length > 0 ? (
                      <Select
                        id="payout-bank"
                        value={bankCode}
                        onChange={(e) => setBankCode(e.target.value)}
                      >
                        <option value="" disabled>
                          {banksLoading ? 'Loading banks…' : 'Select your bank'}
                        </option>
                        {banks.map((b) => (
                          <option key={b.code} value={b.code}>
                            {b.name}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <>
                        <Input
                          id="payout-bank"
                          value={bankCode}
                          onChange={(e) => setBankCode(e.target.value)}
                          placeholder={banksLoading ? 'Loading banks…' : 'Bank code'}
                          disabled={banksLoading}
                        />
                        {!banksLoading && (
                          <p className="mt-1 text-caption text-[var(--color-content-muted)]">
                            We couldn't load the bank list just now — your bank's code is on your
                            statement, or ask them for it.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div>
                  <Label htmlFor="payout-dest">{meta.field}</Label>
                  <div className="relative">
                    <Input
                      id="payout-dest"
                      value={dest}
                      onChange={(e) => setDest(e.target.value)}
                      placeholder={meta.placeholder}
                      // `inputMode`, not `type="email"`. The browser's own
                      // email validation would reject a PayPal payer id, which
                      // PayHold accepts — so the strict-looking option is the
                      // one that blocks a legitimate destination.
                      autoComplete={selected === 'paypal' ? 'email' : 'off'}
                      // A PayPal destination is an address, not a number. This
                      // sent every non-bank method to a phone keypad, which on
                      // a phone is a field you cannot type an email into
                      // without hunting for the letters.
                      inputMode={selected === 'bank' || selected === 'card'
                        ? 'numeric'
                        : selected === 'paypal'
                        ? 'email'
                        : 'tel'}
                      className={cn(cardScheme && 'pr-16')}
                    />
                    {/* The scheme, read off the number's own opening digits.
                        Shown rather than asked: a card says what it is, so
                        making somebody pick Visa from a list while holding a
                        card with VISA printed on it is a question with a
                        visible answer. */}
                    {cardScheme && (
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
                        <BrandMark brand={CARD_BRANDS[cardScheme]} size="sm" />
                      </span>
                    )}
                  </div>
                </div>
                {routedProvider && (
                  <p className="flex items-center gap-1.5 text-caption text-[var(--color-content-muted)]">
                    <Lock size={12} className="text-[var(--color-accent-on)]" /> Processed securely via{' '}
                    {PROVIDER_NAME[routedProvider]}.{' '}
                    {/* "Only the last 4 digits" is true of a number and false
                        of an address — a PayPal destination is masked as
                        ho•••@example.com, which is not four digits of
                        anything. Saying the wrong thing about what we keep is
                        worse than saying less. */}
                    {selected === 'paypal'
                      ? 'Your address is stored masked.'
                      : 'Only the last 4 digits are stored.'}
                  </p>
                )}
                {/* What saving actually does, said before they do it. A change is
                    not a free action — the new account is frozen while it is
                    checked — and a host who finds that out from a paused payout is
                    a host who thinks something broke. */}
                {/* Shown on a first destination too, not only on a change.
                    This used to render for `connected` alone, which had it
                    exactly backwards: `add_seller_destination` stamps
                    `security_hold_until = now() + destination_hold_hours` on
                    every insert, with no branch for "there was no primary
                    before". So the host who saw no warning was the one whose
                    first payout was *certain* to be held — and the one with no
                    prior experience of this to reason from. A hold nobody
                    mentioned is indistinguishable from a fault. */}
                {PAYMENTS_PAYHOLD ? (
                  connected ? (
                    <Notice tone="warn">
                      This replaces {me?.payoutLabel ?? 'your current method'}. New accounts are
                      verified before they're paid, so payouts can pause while that happens — your
                      cars stay bookable and your earnings keep building up either way. We'll tell
                      you how long once it's saved.
                    </Notice>
                  ) : (
                    <Notice tone="info">
                      New payout accounts are checked before the first payment goes out, so this
                      won't be live the moment you save it — your cars stay bookable and your
                      earnings keep building up meanwhile. We'll tell you how long once it's saved.
                    </Notice>
                  )
                ) : (
                  <Notice tone="info">
                    Demo: connecting is simulated. In production this opens secure onboarding and
                    activates once verified.
                  </Notice>
                )}
                <Button
                  className="w-full"
                  disabled={!canSave || connect.isPending}
                  onClick={() => connect.mutate(selected)}
                >
                  {connect.isPending ? 'Saving…' : connected ? 'Save new payout method' : 'Save payout method'}
                </Button>
              </CardBody>
            </Card>
          )
        )}

        <p className="flex items-center gap-1.5 text-caption text-[var(--color-content-subtle)]">
          <ShieldCheck size={14} className="text-[var(--color-accent-on)]" /> Your payout details are
          private and never shown to renters.
        </p>

        {active && (
          <Link
            to="/dashboard"
            className="text-body-sm font-medium text-[var(--color-accent-on)] hover:underline"
          >
            Back to dashboard
          </Link>
        )}
      </div>
    </Root>
  );
}

/**
 * Loaded-layout stand-in for the initial profile/payout-status fetch. The
 * header (icon, title, blurb) is static copy so it stays live; below it
 * mirrors the "paying out from" row, the method tile grid and the
 * destination-form card that fill this space once `me` and the payout
 * country are known.
 */
function PayoutSetupSkeleton({ chrome }: { chrome: 'page' | 'modal' }) {
  const navigate = useNavigate();
  const isModal = chrome === 'modal';
  const Root = isModal ? 'div' : 'section';
  return (
    <Root
      className={isModal ? undefined : 'mx-auto max-w-2xl px-4 py-8 sm:py-10'}
      aria-busy="true"
      aria-label="Loading"
    >
      {!isModal && (
        <>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-5 inline-flex items-center gap-1.5 text-body-sm text-[var(--color-content-muted)] hover:text-[var(--color-content)]"
      >
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-on)] text-[var(--color-accent-contrast)]">
          <Banknote size={22} />
        </span>
        <div>
          <h1 className="text-h2">How you get paid</h1>
          <p className="mt-0.5 text-body-sm text-[var(--color-content-muted)]">
            Add where your rental earnings are sent. You keep the subtotal; AutoHire's fee is deducted.
          </p>
        </div>
      </div>
        </>
      )}

      <div className={cn('flex flex-col gap-6', !isModal && 'mt-6')}>
        <ListGroup>
          <ListRow
            icon={<Skeleton className="h-[18px] w-[18px] rounded-full" />}
            value={<Skeleton className="h-4 w-24" />}
            chevron={false}
          >
            <Skeleton className="h-4 w-32" />
          </ListRow>
        </ListGroup>

        <div>
          <Skeleton className="mb-2 h-4 w-48" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
            <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
            <Skeleton className="h-28 w-full rounded-[var(--radius-card)]" />
          </div>
        </div>

        <Card>
          <CardBody className="space-y-3">
            <div>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1.5 h-11 w-full" />
            </div>
            <Skeleton className="h-11 w-full" />
          </CardBody>
        </Card>
      </div>
    </Root>
  );
}


/**
 * `/payouts/setup` — the addressable version.
 *
 * Kept because things outside AutoHire point at it: Stripe Connect's hosted
 * onboarding returns the host to a URL rather than to a component, and
 * `StripeConnectReturnPage` links back here. A modal cannot be a redirect
 * target, so this is not dead weight left behind by the modal.
 */
export function PayoutSetupPage() {
  return <PayoutSetupBody chrome="page" />;
}

/**
 * The same thing over whatever the host was already looking at.
 *
 * Every in-app prompt to set up payouts happens next to the reason for it —
 * an earnings balance with nowhere to go, a dashboard tile, an account row —
 * and sending someone to a separate page to type four fields throws that
 * context away and makes them find their way back. Checkout has been a modal
 * for a while; this is payouts catching up.
 *
 * `onDone` fires when a destination actually saves, so the modal closes on
 * success and stays open on a refusal, where the error belongs next to the
 * field that caused it.
 */
export function PayoutSetupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="How you get paid">
      <PayoutSetupBody chrome="modal" onDone={onClose} />
    </Modal>
  );
}
