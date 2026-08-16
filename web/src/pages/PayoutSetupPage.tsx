import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Landmark,
  Lock,
  QrCode,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wallet,
} from 'lucide-react';
import type { PayoutMethodType, PayoutProvider } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { useCountry } from '@/lib/country';
import { useCurrentUser } from '@/lib/useCurrentUser';
import {
  PAYMENTS_LIVE,
  PAYMENTS_PAYHOLD,
  PAYOUT_METHOD_META,
  maskDestination,
  payoutAvailability,
  payoutLabel,
  payoutProviderFor,
} from '@/lib/payments';
import { Badge, Button, Card, CardBody, Input, Label, Select, Spinner, toast } from '@/components/ui';

const METHOD_ICON: Record<PayoutMethodType, typeof Smartphone> = {
  momo: Smartphone,
  bank: Landmark,
  card: CreditCard,
  // The wallets share an icon on purpose: they are the same shape of thing —
  // an account held with a provider — and the label already names which.
  paypal: Wallet,
  venmo: Wallet,
  cash_app: Wallet,
  alipay: QrCode,
  wechat_pay: QrCode,
};

const PROVIDER_NAME: Record<PayoutProvider, string> = {
  flutterwave: 'Flutterwave',
  stripe: 'Stripe',
  // The external system is the platform's own rail — hosts see AutoHire, not a
  // third-party brand they've never heard of.
  external: 'AutoHire Payments',
  payhold: 'PayHold',
};

/**
 * Host payout-method setup. The host picks how they want to be paid — Mobile
 * Money, Bank, or Card — and the system routes it to the right provider behind
 * the scenes. Required before earning; surfaced from the dashboard checklist and
 * when a renter switches to hosting.
 */
export function PayoutSetupPage() {
  const { countries } = useCountry();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useCurrentUser();

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

  const [selected, setSelected] = useState<PayoutMethodType | null>(null);
  const [dest, setDest] = useState('');
  // Payout country used to be inherited from the profile with no way back to
  // it here — a host paid in whatever currency their account happened to
  // carry, with no path to a different one even though PayHold reaches over
  // a hundred countries. This is the toggle that reveals the picker again
  // once a country is already on file.
  const [changingCountry, setChangingCountry] = useState(false);

  const active = me?.payoutStatus === 'active';

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
  };

  const connect = useMutation({
    mutationFn: async (method: PayoutMethodType) => {
      // PayHold owns payouts on this rail, so the host has to exist there as a
      // SELLER — a deal names one, and without it their cars cannot be booked
      // at all. The raw destination goes straight to PayHold to be tokenized
      // and is written down by neither side.
      if (PAYMENTS_PAYHOLD) {
        return await client.registerPayholdSeller({ method, destination: dest.trim() });
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
      setDest('');

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
              'It has to be verified first, so payouts pause for up to 24 hours — ' +
              'your cars stay bookable and the money keeps building up in the meantime.',
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
    return (
      <div className="flex justify-center py-20">
        <Spinner size={26} />
      </div>
    );
  }

  const meta = selected ? PAYOUT_METHOD_META[selected] : null;
  const canSave = !!selected && dest.trim().length >= 4;
  const routedProvider = selected ? payoutProviderFor(selected, payoutCountry) : null;

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
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">How you get paid</h1>
          <p className="mt-0.5 text-sm text-ink-500">
            Add where your rental earnings are sent. You keep the subtotal; AutoHire's fee is deducted.
          </p>
        </div>
      </div>

      {/* Currently connected */}
      {connected && me && (
        <Card
          className={cn(
            'mt-6',
            active ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/50',
          )}
        >
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1',
                  active ? 'text-emerald-600 ring-emerald-100' : 'text-amber-600 ring-amber-100',
                )}
              >
                {active ? <CheckCircle2 size={20} /> : <Clock size={20} />}
              </span>
              <div>
                <p className="flex items-center gap-2 font-semibold text-ink-900">
                  {me.payoutLabel ?? 'Payout method'}
                  {active ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="warning">Verifying</Badge>
                  )}
                </p>
                <p className="text-sm text-ink-500">
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
              <span className="text-xs text-ink-500">
                Moving? Save a new method below.
              </span>
            ) : (
              <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
                <Trash2 size={14} /> Remove
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* Country decides both the methods on offer and the currency they pay
          in — a US bank account settles in USD, a Rwandan Mobile Money number
          in RWF. It used to be set once from the profile and then frozen,
          with nothing on this screen to change it back — so a host who
          wanted a different currency than whatever their profile happened to
          carry had no way to ask for one. Always changeable now, not just on
          the first visit. */}
      {payoutCountry && !changingCountry && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 bg-white px-4 py-2.5">
          <p className="text-sm text-ink-600">
            Paying out from{' '}
            <span className="font-medium text-ink-900">
              {countries.find((c) => c.code === payoutCountry)?.flag} {countryName}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setChangingCountry(true)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            Get paid in a different country or currency
          </button>
        </div>
      )}

      {(!payoutCountry || changingCountry) && (
        <Card className="mt-6 border-amber-200 bg-amber-50/60">
          <CardBody className="space-y-3">
            <div>
              <p className="font-medium text-ink-900">Where do you get paid?</p>
              <p className="mt-0.5 text-sm text-ink-600">
                This decides which payout methods and which currency are available — pick the
                country of the account you actually want the money to land in, not necessarily
                where you live.
              </p>
            </div>
            <Select
              aria-label="Payout country"
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
                className="text-xs text-ink-500 hover:underline"
              >
                Cancel
              </button>
            )}
          </CardBody>
        </Card>
      )}

      {/* PayHold cannot pay this country — say so instead of offering a method
          that fails on submit. Before this, a host here picked Bank or Card,
          typed their account number, and got a 422 they could do nothing about. */}
      {payoutCountry && availability.state !== 'ok' && (
        <Card className="mt-6 border-amber-200 bg-amber-50/60">
          <CardBody className="space-y-2">
            <p className="font-medium text-ink-900">
              {availability.state === 'restricted'
                ? `Payouts aren't available in ${countryName}.`
                : availability.state === 'unavailable'
                  ? `We can't send payouts to ${countryName} yet.`
                  : `We couldn't work out how payouts route in ${countryName}.`}
            </p>
            <p className="text-sm text-ink-600">
              {availability.state === 'restricted'
                ? 'This market is sanctioned, so money cannot move in either direction.'
                : availability.state === 'unavailable'
                  ? (availability.reason ??
                    `Renters in ${countryName} can still book and pay — it's only payouts that aren't open yet. We'll email you the moment they are.`)
                  : 'This is unexpected — try refreshing, and contact support if it keeps happening.'}
            </p>
            <p className="text-sm text-ink-600">
              Until then your listings can't take bookings, because we won't hold a renter's money
              for a trip we can't pay you for.
            </p>
          </CardBody>
        </Card>
      )}

      {/* Method chooser */}
      <div
        className={cn(
          'mt-6',
          (!payoutCountry || availability.state !== 'ok') && 'pointer-events-none hidden',
        )}
      >
        <p className="mb-2 text-sm font-medium text-ink-700">
          {connected ? 'Change your payout method' : 'Choose how you want to be paid'}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {methods.map((m) => {
            const isSel = selected === m;
            const Icon = METHOD_ICON[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setSelected(isSel ? null : m);
                  setDest('');
                }}
                aria-pressed={isSel}
                className={cn(
                  'flex flex-col gap-2 rounded-2xl border p-4 text-left transition-all',
                  isSel
                    ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                    : 'border-ink-200 bg-white hover:border-ink-300 hover:shadow-card',
                )}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Icon size={18} />
                </span>
                <span className="font-semibold text-ink-900">{PAYOUT_METHOD_META[m].label}</span>
                <span className="text-xs leading-relaxed text-ink-500">{PAYOUT_METHOD_META[m].blurb}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Destination form for the chosen method — or, on Stripe Connect
          markets, the onboarding handoff instead of a field nothing here can
          validate. */}
      {meta && selected && needsStripeConnect && (selected === 'bank' || selected === 'card') ? (
        <Card className="mt-4">
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-600">
              Getting paid in {countryName} goes through Stripe. You'll set up your account on
              Stripe's own secure page — bank details go straight to them, never through us.
            </p>
            <p className="flex items-center gap-1.5 text-xs text-ink-500">
              <Lock size={12} className="text-brand-600" /> Processed securely via Stripe. We only ever
              see that your account is connected, never the details behind it.
            </p>
            {connected && (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                This replaces {me?.payoutLabel ?? 'your current method'}. New accounts are verified
                before they're paid, so payouts pause for up to 24 hours — your cars stay bookable and
                your earnings keep building up in the meantime.
              </p>
            )}
            <Button
              className="w-full"
              disabled={connectStripe.isPending}
              onClick={() => connectStripe.mutate()}
            >
              {connectStripe.isPending ? 'Starting…' : 'Connect with Stripe'}
            </Button>
          </CardBody>
        </Card>
      ) : (
        meta &&
        selected && (
          <Card className="mt-4">
            <CardBody className="space-y-3">
              <div>
                <Label htmlFor="payout-dest">{meta.field}</Label>
                <Input
                  id="payout-dest"
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  placeholder={meta.placeholder}
                  inputMode={selected === 'bank' || selected === 'card' ? 'numeric' : 'tel'}
                />
              </div>
              {routedProvider && (
                <p className="flex items-center gap-1.5 text-xs text-ink-500">
                  <Lock size={12} className="text-brand-600" /> Processed securely via{' '}
                  {PROVIDER_NAME[routedProvider]}. Only the last 4 digits are stored.
                </p>
              )}
              {/* What saving actually does, said before they do it. A change is
                  not a free action — the new account is frozen while it is
                  checked — and a host who finds that out from a paused payout is
                  a host who thinks something broke. */}
              {PAYMENTS_PAYHOLD ? (
                connected && (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                    This replaces {me?.payoutLabel ?? 'your current method'}. New accounts are verified
                    before they're paid, so payouts pause for up to 24 hours — your cars stay bookable
                    and your earnings keep building up in the meantime.
                  </p>
                )
              ) : (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  Demo: connecting is simulated. In production this opens secure onboarding and
                  activates once verified.
                </p>
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

      <p className="mt-6 flex items-center gap-1.5 text-xs text-ink-400">
        <ShieldCheck size={14} className="text-brand-600" /> Your payout details are private and never shown to
        renters.
      </p>

      {active && (
        <div className="mt-4">
          <Link to="/dashboard" className="text-sm font-medium text-brand-600 hover:underline">
            Back to dashboard
          </Link>
        </div>
      )}
    </section>
  );
}
