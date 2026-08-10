import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Lock, Smartphone } from 'lucide-react';
import { Button, Input, Label, Modal } from '@/components/ui';
import { MethodMarks } from '@/components/PaymentBrands';
import type { PaymentMethodType } from '@autohire/shared';

/**
 * The provider's payment page, running inside the modal.
 *
 * Flutterwave's hosted checkout sets no `X-Frame-Options` and no
 * `frame-ancestors`, so it embeds — which is what lets a renter in Rwanda pay
 * without the page ever changing. Stripe Checkout refuses framing outright, so
 * markets on that rail are detected here and sent the whole tab instead.
 *
 * A refused frame still fires `load`, so the event proves nothing. What
 * separates them is reachability: a frame that really loaded the provider is
 * cross-origin and reading its location throws, while a blocked one sits on
 * `about:blank`, same-origin and readable. The throw is the success signal.
 */
function PayFrame({
  url,
  momo,
  amountLabel,
}: {
  url: string;
  momo: boolean;
  amountLabel: string;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [blocked, setBlocked] = useState(false);

  const check = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    try {
      const href = win.location.href;
      if (href === 'about:blank' || href === '') setBlocked(true);
    } catch {
      /* cross-origin — it loaded, which is what we want */
    }
  }, []);

  // Nothing rendered after a beat means a blocker suppressed it entirely.
  useEffect(() => {
    const t = setTimeout(check, 4000);
    return () => clearTimeout(t);
  }, [check]);

  if (blocked) {
    return (
      <div className="py-4 text-center">
        <p className="font-medium text-ink-900">One more step</p>
        <p className="mt-1 text-sm text-ink-600">
          Your bank needs its own page to finish this payment securely.
        </p>
        <Button className="mt-4 w-full" onClick={() => window.location.assign(url)}>
          Continue · {amountLabel}
        </Button>
      </div>
    );
  }

  return (
    <div>
      {momo && (
        <p className="mb-2.5 flex items-start gap-1.5 text-xs text-ink-600">
          <Smartphone size={13} className="mt-0.5 shrink-0 text-brand-600" />
          Confirm the prompt on your phone — this updates on its own once you do.
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-ink-200">
        <iframe
          ref={frame}
          src={url}
          onLoad={check}
          title="Payment"
          className="block w-full"
          style={{ height: 520 }}
          // No `allow-top-navigation`: the payment page must not be able to move
          // the booking out from under the renter.
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          allow="payment *"
        />
      </div>
      <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-ink-400">
        <Loader2 size={12} className="animate-spin" />
        Waiting for your payment to clear…
      </p>
    </div>
  );
}

/** One method as PayHold describes it — its words, not ours. */
export interface CheckoutMethod {
  method: string;
  label: string;
  blurb?: string | null;
  networks?: string[];
  schemes?: { code: string; label: string }[];
  note?: string | null;
}

interface PublicCheckout {
  deal?: { description?: string; amount?: number; currency?: string };
  methods?: CheckoutMethod[];
  status?: string;
}

/** PayHold's method names onto the marks we draw. */
function marksFor(method: string): PaymentMethodType | null {
  if (method === 'card') return 'card';
  if (method === 'mobile_money') return 'momo';
  if (method === 'bank_transfer') return 'bank';
  if (method === 'paypal' || method === 'alipay' || method === 'wechat_pay') {
    return method as PaymentMethodType;
  }
  return null;
}

/**
 * Checkout, start to finish, without leaving the booking page.
 *
 * How much of it can actually live here is PayHold's constraint rather than a
 * design choice, and it differs by method:
 *
 *   • **Mobile money** finishes here in full. There is no provider page to send
 *     anyone to — the renter approves on their handset — so the modal shows a
 *     "check your phone" state and polls until the money is held.
 *   • **Card** cannot. It ends on Flutterwave's or Stripe's own page, and
 *     Stripe Checkout refuses to be framed, so the tab has to go. The modal
 *     carries the choice and hands over.
 *
 * Framing PayHold's hosted page would appear to solve this and does not: it
 * carries its own method picker, so the renter would be asked twice, and the
 * frame ends at the provider anyway.
 *
 * The booking is created by the signed `order.funded_held` webhook throughout.
 * Nothing this modal observes confirms a trip — polling only decides what the
 * renter is shown.
 */
export function CheckoutModal({
  open,
  onClose,
  checkoutBase,
  paymentLink,
  fallback,
  amountLabel,
}: {
  open: boolean;
  onClose: () => void;
  /** PayHold's public session URL. Null when sessions are unavailable. */
  checkoutBase: string | null;
  paymentLink: string;
  /** Our own picker, shown when PayHold cannot describe the methods itself. */
  fallback: React.ReactNode;
  amountLabel: string;
}) {
  const [methods, setMethods] = useState<CheckoutMethod[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [network, setNetwork] = useState('');
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState<
    'choosing' | 'starting' | 'paying' | 'paid' | 'failed'
  >('choosing');
  const [providerUrl, setProviderUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef<number | null>(null);

  const leave = useCallback(() => window.location.assign(paymentLink), [paymentLink]);

  // Read what this renter may pay with, in PayHold's own words. No credential:
  // the session token in the path is the credential.
  useEffect(() => {
    if (!open || !checkoutBase) return;
    let live = true;
    fetch(checkoutBase)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PublicCheckout) => {
        if (live) setMethods(d.methods ?? []);
      })
      .catch(() => {
        // Leave `methods` null so our own picker shows instead of an error —
        // the renter can still pay, they just see our labels rather than theirs.
        if (live) setMethods(null);
      });
    return () => {
      live = false;
    };
  }, [open, checkoutBase]);

  // Watch for the money landing while the renter is on their handset.
  useEffect(() => {
    if (stage !== 'paying' || !checkoutBase) return;
    const tick = async () => {
      try {
        const r = await fetch(checkoutBase);
        if (!r.ok) return;
        const d = (await r.json()) as PublicCheckout;
        const s = String(d.status ?? '');
        if (['funded_held', 'in_progress', 'paid', 'completed'].includes(s)) setStage('paid');
        else if (['payment_failed', 'expired', 'canceled'].includes(s)) setStage('failed');
      } catch {
        /* a dropped poll is not a failed payment — keep waiting */
      }
    };
    polling.current = window.setInterval(tick, 3000);
    return () => {
      if (polling.current) window.clearInterval(polling.current);
    };
  }, [stage, checkoutBase]);

  async function start(method: string) {
    if (!checkoutBase) return leave();
    setStage('starting');
    setError(null);
    try {
      const res = await fetch(`${checkoutBase}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method,
          ...(network ? { network } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
      });
      const data = (await res.json()) as { payment_link?: string; error?: { message?: string } };
      if (!res.ok) throw new Error(data?.error?.message ?? 'Could not start the payment.');

      // The provider's page finishes the payment, and it can run right here:
      // Flutterwave sets no frame headers, so it embeds. Stripe markets refuse,
      // which `PayFrame` detects and turns into a redirect — so this is a
      // preference for staying put, never a requirement.
      setProviderUrl(data.payment_link ?? paymentLink);
      setStage('paying');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
      setStage('choosing');
    }
  }

  const title =
    stage === 'paid'
      ? 'Payment received'
      : stage === 'paying'
        ? 'Complete your payment'
        : 'How do you want to pay?';

  return (
    <Modal
      open={open}
      // Not dismissable mid-payment: the provider is mid-charge behind this and
      // closing would lose the renter's place in it.
      onClose={stage === 'paying' ? () => {} : onClose}
      title={title}
      className={stage === 'paying' ? 'max-w-xl' : undefined}
    >
      <div className="space-y-4">
        {stage === 'paid' && (
          <div className="py-4 text-center">
            <CheckCircle2 size={30} className="mx-auto text-emerald-600" />
            <p className="mt-3 font-medium text-ink-900">Your money is held safely</p>
            <p className="mt-1 text-sm text-ink-600">
              We're setting up your trip — it'll appear in My trips in a moment.
            </p>
            <Button className="mt-4 w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        )}

        {stage === 'paying' && providerUrl && (
          <PayFrame
            url={providerUrl}
            momo={chosen === 'mobile_money'}
            amountLabel={amountLabel}
          />
        )}

        {stage === 'failed' && (
          <div className="py-4 text-center">
            <p className="font-medium text-ink-900">That payment didn't go through</p>
            <p className="mt-1 text-sm text-ink-600">
              Nothing has been charged and the car is still available.
            </p>
            <Button className="mt-4 w-full" onClick={() => setStage('choosing')}>
              Try again
            </Button>
          </div>
        )}

        {(stage === 'choosing' || stage === 'starting') && (
          <>
            {/* PayHold's own list when we have a session; ours when we don't.
                Its labels beat ours because it knows which rails are switched on
                in this market today. */}
            {methods && methods.length > 0 ? (
              <div className="grid gap-2.5">
                {methods.map((m) => {
                  const mark = marksFor(m.method);
                  const isChosen = chosen === m.method;
                  return (
                    <div
                      key={m.method}
                      className={
                        'rounded-xl border transition-all ' +
                        (isChosen
                          ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-200'
                          : 'border-ink-200 hover:border-ink-300')
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setChosen(m.method);
                          setNetwork(m.networks?.[0] ?? '');
                        }}
                        className="flex w-full items-start gap-3 p-3.5 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-semibold text-ink-900">{m.label}</span>
                            {mark && (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <MethodMarks method={mark} />
                              </span>
                            )}
                          </span>
                          {m.blurb && (
                            <span className="mt-0.5 block text-xs text-ink-500">{m.blurb}</span>
                          )}
                        </span>
                        <span
                          aria-hidden="true"
                          className={
                            'mt-1 h-4 w-4 shrink-0 rounded-full border-2 ' +
                            (isChosen ? 'border-brand-600 bg-brand-600' : 'border-ink-300')
                          }
                        />
                      </button>

                      {isChosen && m.method === 'mobile_money' && (
                        <div className="space-y-2.5 border-t border-brand-200/70 px-3.5 pb-3.5 pt-3">
                          {(m.networks?.length ?? 0) > 1 && (
                            <div className="flex flex-wrap gap-2">
                              {m.networks!.map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  onClick={() => setNetwork(n)}
                                  className={
                                    'rounded-lg border px-2.5 py-1 text-xs font-medium ' +
                                    (network === n
                                      ? 'border-brand-500 bg-white text-brand-700'
                                      : 'border-ink-200 text-ink-600')
                                  }
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                          )}
                          <div>
                            <Label htmlFor="momo-phone">Mobile money number</Label>
                            <Input
                              id="momo-phone"
                              value={phone}
                              onChange={(e) => setPhone(e.target.value)}
                              placeholder="+250 788 123 456"
                              inputMode="tel"
                            />
                          </div>
                        </div>
                      )}

                      {isChosen && m.method !== 'mobile_money' && (
                        <p className="flex items-start gap-1.5 border-t border-brand-200/70 px-3.5 pb-3.5 pt-3 text-xs text-ink-600">
                          <Lock size={13} className="mt-0.5 shrink-0 text-brand-600" />
                          You'll finish on our payment provider's secure page — your details never
                          pass through AutoHire.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              fallback
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {methods && methods.length > 0 && (
              <Button
                className="w-full"
                size="lg"
                disabled={
                  !chosen ||
                  stage === 'starting' ||
                  (chosen === 'mobile_money' && phone.trim().length < 8)
                }
                onClick={() => chosen && start(chosen)}
              >
                {stage === 'starting' ? 'Starting…' : `Pay ${amountLabel}`}
              </Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
