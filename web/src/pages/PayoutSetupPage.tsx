import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Landmark,
  Lock,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react';
import type { PayoutMethodType } from '@autohire/shared';
import { client } from '@/lib/client';
import { cn } from '@/lib/cn';
import { useCountry } from '@/lib/country';
import { useCurrentUser } from '@/lib/useCurrentUser';
import {
  PAYMENTS_LIVE,
  PAYOUT_METHOD_META,
  maskDestination,
  payoutLabel,
  payoutMethodsFor,
  payoutProviderFor,
} from '@/lib/payments';
import { Badge, Button, Card, CardBody, Input, Label, Spinner, toast } from '@/components/ui';

const METHOD_ICON: Record<PayoutMethodType, typeof Smartphone> = {
  momo: Smartphone,
  bank: Landmark,
  card: CreditCard,
};

const PROVIDER_NAME = { flutterwave: 'Flutterwave', stripe: 'Stripe' } as const;

/**
 * Host payout-method setup. The host picks how they want to be paid — Mobile
 * Money, Bank, or Card — and the system routes it to the right provider behind
 * the scenes. Required before earning; surfaced from the dashboard checklist and
 * when a renter switches to hosting.
 */
export function PayoutSetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { country } = useCountry();
  const { data: me, isLoading } = useCurrentUser();

  const methods = payoutMethodsFor(country.code);
  const [selected, setSelected] = useState<PayoutMethodType | null>(null);
  const [dest, setDest] = useState('');

  const active = me?.payoutStatus === 'active';

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    queryClient.invalidateQueries({ queryKey: ['ownerHost'] });
  };

  const connect = useMutation({
    mutationFn: (method: PayoutMethodType) => {
      const provider = payoutProviderFor(method, country.code);
      // Live + Flutterwave: register the raw destination as a beneficiary server-
      // side (only a token is stored). Otherwise store the masked method directly.
      if (PAYMENTS_LIVE && provider === 'flutterwave' && (method === 'momo' || method === 'bank')) {
        return client.connectPayoutBeneficiary({ method, destination: dest.trim() });
      }
      return client.setPayoutMethod({
        method,
        provider,
        destinationMasked: maskDestination(dest),
        label: payoutLabel(method, dest),
      });
    },
    onSuccess: () => {
      refresh();
      setSelected(null);
      setDest('');
      toast.success('Payout method saved.');
    },
    onError: () => toast.error("Couldn't save your payout method. Please try again."),
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
  const routedProvider = selected ? payoutProviderFor(selected, country.code) : null;

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
      {active && me && (
        <Card className="mt-6 border-emerald-200 bg-emerald-50/40">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-emerald-600 ring-1 ring-emerald-100">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <p className="flex items-center gap-2 font-semibold text-ink-900">
                  {me.payoutLabel ?? 'Payout method'}
                  <Badge tone="success">Active</Badge>
                </p>
                <p className="text-sm text-ink-500">Earnings are released here after each completed trip.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 size={14} /> Remove
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Method chooser */}
      <div className="mt-6">
        <p className="mb-2 text-sm font-medium text-ink-700">
          {active ? 'Change your payout method' : 'Choose how you want to be paid'}
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

      {/* Destination form for the chosen method */}
      {meta && selected && (
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
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              Demo: connecting is simulated. In production this opens secure onboarding and activates once
              verified.
            </p>
            <Button
              className="w-full"
              disabled={!canSave || connect.isPending}
              onClick={() => connect.mutate(selected)}
            >
              {connect.isPending ? 'Saving…' : 'Save payout method'}
            </Button>
          </CardBody>
        </Card>
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
