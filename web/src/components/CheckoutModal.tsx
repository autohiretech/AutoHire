import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Lock, ShieldCheck, Smartphone } from 'lucide-react';
import { Button, Input, Label, Modal } from '@/components/ui';
import { MethodMarks } from '@/components/PaymentBrands';
import type { PaymentMethodType } from '@autohire/shared';

/**
 * What PayHold says the renter must do next.
 *
 * This is the contract that replaced a bare `payment_link`. A link could only
 * ever mean "leave", so every method used to end on somebody else's page and
 * the renter was asked to choose twice — once here and once there. These say
 * which of four different things is actually being asked, and three of the four
 * are answerable without the page ever changing.
 */
type NextAction =
  /** Approve on the handset. Nothing to type; the deal moves on its own. */
  | { type: 'wait'; message: string }
  /** The rail sent a code and wants it back, against `reference`. */
  | { type: 'otp'; reference: string; message: string }
  /** No way to finish here — the provider needs its own page. */
  | { type: 'redirect'; url: string }
  /** The provider collects the details itself, in this page, from its own script. */
  | {
      type: 'element';
      provider: string;
      public_key: string;
      reference: string;
      amount: number;
      currency: string;
      options: string[];
      redirect_url: string;
    };

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
  deal?: { description?: string; amount?: number; currency?: string; status?: string };
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

/** Deal states that mean the money is with PayHold and the trip is being made. */
const SETTLED = ['funded_held', 'in_progress', 'paid', 'completed'];
/** Deal states that mean nothing was taken and the car is still free. */
const DEAD = ['payment_failed', 'expired', 'canceled'];

/**
 * The provider's page, running inside the modal.
 *
 * This is how card is collected, and the reasoning is worth keeping because the
 * obvious alternatives are both worse:
 *
 *   • **Our own card inputs** would put the number in AutoHire's DOM, which
 *     alone moves us from PCI SAQ A to SAQ D. PayHold §6 forbids raw cards on
 *     their infrastructure too, so there would be nowhere to send it.
 *   • **Flutterwave's inline script** (`checkout.flutterwave.com/v3.js`) was
 *     tried and removed. It takes the whole viewport with a dialog of its own,
 *     carrying its own method sidebar — so a renter who had already chosen Card
 *     here was shown Card and Mobile Money again, full-screen, on top of the
 *     booking. That is the same duplicate this modal exists to remove, and
 *     `payment_options` did not suppress it.
 *
 * A frame keeps the fields in Flutterwave's origin — the card number never
 * touches AutoHire — while the modal stays the thing the renter is looking at.
 *
 * Stripe is why the fallback survives: Stripe Checkout refuses to be framed, so
 * a frame that loaded perfectly goes blank at the moment the renter is sent to
 * pay. A refused frame still fires `load`, so the event proves nothing. What
 * separates them is reachability: a frame that really loaded the provider is
 * cross-origin and reading its location throws, while a blocked one sits on
 * `about:blank`, same-origin and readable. The throw is the success signal.
 */
function PayFrame({ url, amountLabel }: { url: string; amountLabel: string }) {
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
      <div className="overflow-hidden rounded-xl border border-ink-200">
        <iframe
          ref={frame}
          src={url}
          onLoad={check}
          title="Payment"
          className="block w-full"
          // Tall enough for the provider's card form without its own scrollbar.
          // Their page centres its content, so a short frame shows a band of
          // empty chrome and puts the fields half off-screen.
          style={{ height: 640 }}
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

/**
 * Checkout, start to finish, without leaving the booking page.
 *
 * The renter is asked how they want to pay exactly once. That sentence used to
 * be untrue in a way no amount of styling could fix: PayHold's hosted page
 * carries its own method picker, so handing the renter over after they had
 * already chosen here asked them the same question twice, in someone else's
 * brand, on a domain that is not ours. Nothing is handed over now — AutoHire
 * reads PayHold's method list, starts the charge from this modal, and answers
 * whatever the rail asks for next in these same fields.
 *
 * What each method costs, honestly:
 *
 *   • **Mobile money** finishes here in full. The number is typed here, the
 *     charge is direct, and if the network wants a code that box appears here
 *     too. There is no provider page anywhere in it.
 *   • **Card** is the provider's own form, framed inside this modal. The fields
 *     belong to Flutterwave's origin, so the number never enters AutoHire's DOM
 *     and we stay PCI SAQ A — which is why they are not inputs of ours. Framed
 *     rather than launched: their inline script takes the whole viewport and
 *     brings its own method sidebar, so a renter who had chosen Card here was
 *     asked the same question again, full-screen, over the booking.
 *   • **Anything on a Stripe rail** can still need the provider's page, because
 *     Stripe Checkout refuses to be framed. `redirect` is what PayHold answers
 *     then, and it is the only branch that can still move the renter.
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
  const [otp, setOtp] = useState('');
  const [action, setAction] = useState<NextAction | null>(null);
  const [stage, setStage] = useState<
    'choosing' | 'starting' | 'acting' | 'validating' | 'paid' | 'failed'
  >('choosing');
  const [error, setError] = useState<string | null>(null);
  const polling = useRef<number | null>(null);


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

  /**
   * Watch the deal, not the session.
   *
   * `status` at the top of that response is the *session's* — `open` or
   * `completed`, meaning whether the renter has finished choosing. The money is
   * `deal.status`, and reading the wrong one is a screen that waits forever
   * through a payment that already landed.
   */
  useEffect(() => {
    if (!open || !checkoutBase) return;
    if (stage !== 'acting' && stage !== 'validating') return;

    const tick = async () => {
      try {
        const r = await fetch(checkoutBase);
        if (!r.ok) return;
        const d = (await r.json()) as PublicCheckout;
        const s = String(d.deal?.status ?? '');
        if (SETTLED.includes(s)) setStage('paid');
        else if (DEAD.includes(s)) setStage('failed');
      } catch {
        /* a dropped poll is not a failed payment — keep waiting */
      }
    };

    polling.current = window.setInterval(tick, 3000);
    return () => {
      if (polling.current) window.clearInterval(polling.current);
    };
  }, [open, stage, checkoutBase]);

  /**
   * Whatever PayHold answered, applied.
   *
   * `element` is deliberately collapsed into `redirect` here rather than
   * honoured as its own screen. PayHold offers both for a card — the element
   * and the hosted link are two doors onto one charge, sharing a `tx_ref` — and
   * of the two only the link can be put *inside* something. Flutterwave's
   * script insists on the whole viewport and brings its own method sidebar with
   * it, which is the duplicate picker in a new costume.
   *
   * So the element is read as what it proves rather than as an instruction: the
   * provider is Flutterwave, and Flutterwave frames. The link goes in the modal.
   */
  function apply(next: NextAction | undefined, link: string | undefined) {
    const url = link || paymentLink;
    const resolved: NextAction =
      // An older PayHold that only knows how to return a link meant `redirect`
      // and always did, so a missing action reads as that rather than a failure.
      !next || next.type === 'element' ? { type: 'redirect', url } : next;
    setAction(resolved);
    setOtp('');
    setStage('acting');
  }

  async function start(method: string) {
    if (!checkoutBase) return window.location.assign(paymentLink);
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
      const data = (await res.json()) as {
        payment_link?: string;
        next_action?: NextAction;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(data?.error?.message ?? 'Could not start the payment.');
      apply(data.next_action, data.payment_link);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the payment.');
      setStage('choosing');
    }
  }

  async function submitOtp() {
    if (!checkoutBase || action?.type !== 'otp') return;
    setStage('validating');
    setError(null);
    try {
      const res = await fetch(`${checkoutBase}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: action.reference, otp: otp.trim() }),
      });
      const data = (await res.json()) as {
        next_action?: NextAction;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(data?.error?.message ?? 'That code was not accepted.');
      apply(data.next_action, undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code was not accepted.');
      // Back to the same box with the message above it — a rejected code is a
      // retry, not the end of a payment.
      setStage('acting');
    }
  }

  const title =
    stage === 'paid'
      ? 'Payment received'
      : stage === 'acting' || stage === 'validating'
        ? 'Complete your payment'
        : 'How do you want to pay?';

  const busy = stage === 'starting' || stage === 'validating';
  const midPayment = stage === 'acting' || stage === 'validating';

  return (
    <Modal
      open={open}
      // Not dismissable mid-payment: the provider is mid-charge behind this and
      // closing would lose the renter's place in it.
      onClose={midPayment ? () => {} : onClose}
      title={title}
      className={action?.type === 'redirect' ? 'max-w-xl' : undefined}
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

        {stage === 'failed' && (
          <div className="py-4 text-center">
            <p className="font-medium text-ink-900">That payment didn't go through</p>
            <p className="mt-1 text-sm text-ink-600">
              Nothing has been charged and the car is still available.
            </p>
            <Button
              className="mt-4 w-full"
              onClick={() => {
                setAction(null);
                setStage('choosing');
              }}
            >
              Try again
            </Button>
          </div>
        )}

        {midPayment && action?.type === 'wait' && (
          <div className="py-2 text-center">
            <Smartphone size={28} className="mx-auto text-brand-600" />
            <p className="mt-3 font-medium text-ink-900">Check your phone</p>
            <p className="mx-auto mt-1 max-w-xs text-sm text-ink-600">{action.message}</p>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400">
              <Loader2 size={12} className="animate-spin" />
              This updates on its own — don't close this window.
            </p>
          </div>
        )}

        {midPayment && action?.type === 'otp' && (
          <div className="py-1">
            <div className="text-center">
              <ShieldCheck size={26} className="mx-auto text-brand-600" />
              <p className="mt-2.5 font-medium text-ink-900">Enter your code</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-600">{action.message}</p>
            </div>
            <div className="mx-auto mt-4 max-w-xs">
              <Label htmlFor="pay-otp">Verification code</Label>
              <Input
                id="pay-otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                autoFocus
              />
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              <Button
                className="mt-3 w-full"
                disabled={otp.trim().length < 4 || busy}
                onClick={submitOtp}
              >
                {busy ? 'Checking…' : 'Confirm payment'}
              </Button>
            </div>
          </div>
        )}

        {midPayment && action?.type === 'redirect' && (
          <PayFrame url={action.url} amountLabel={amountLabel} />
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
                            <p className="mt-1.5 text-xs text-ink-500">
                              You'll get a prompt on this number. Nothing leaves your wallet
                              until you approve it.
                            </p>
                          </div>
                        </div>
                      )}

                      {isChosen && m.method === 'card' && (
                        <p className="flex items-start gap-1.5 border-t border-brand-200/70 px-3.5 pb-3.5 pt-3 text-xs text-ink-600">
                          <Lock size={13} className="mt-0.5 shrink-0 text-brand-600" />
                          The card form opens right here, and it is our payment provider's own —
                          your number never passes through AutoHire.
                        </p>
                      )}

                      {isChosen && m.method !== 'mobile_money' && m.method !== 'card' && (
                        <p className="flex items-start gap-1.5 border-t border-brand-200/70 px-3.5 pb-3.5 pt-3 text-xs text-ink-600">
                          <Lock size={13} className="mt-0.5 shrink-0 text-brand-600" />
                          You'll approve this on our payment provider's secure checkout — your
                          details never pass through AutoHire.
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
