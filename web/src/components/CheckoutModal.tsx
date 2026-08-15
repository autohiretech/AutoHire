import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import {
  Check,
  CheckCircle2,
  Copy,
  Landmark,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { Button, Input, Label, Modal } from '@/components/ui';
import { MethodMarks } from '@/components/PaymentBrands';
import { getStripeFor } from '@/lib/stripe';
import { formatMoneyMinor } from '@/lib/currency';
import { client } from '@/lib/client';
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
  /**
   * The provider's fields, mounted into our own markup. The best of the four:
   * the inputs are served from the provider's origin so the card never touches
   * AutoHire, but the layout around them is ours.
   */
  | {
      type: 'payment_element';
      provider: string;
      publishable_key: string;
      client_secret: string;
      return_url: string;
    }
  /**
   * Pay us from your own banking app, into an account minted for this charge.
   * Nothing to collect and nowhere to go — the account number is the whole
   * instruction, so it belongs in this modal and not on anybody's page.
   */
  | {
      type: 'transfer';
      account: string;
      bank: string;
      amount: string;
      reference: string;
      expires_at: string | null;
      note: string | null;
    }
  /**
   * A wallet the renter signs into. Approved in a popup their provider owns,
   * over this page — never in a frame, which PayPal refuses and should.
   */
  | {
      type: 'wallet_approval';
      provider: string;
      client_id: string;
      order: string;
      currency: string;
      approval_url: string;
    }
  /** The card needs a PIN. The answer goes back to `/authorize` with the card. */
  | { type: 'pin'; message: string }
  /** The card needs its billing address. `fields` says what to ask for. */
  | { type: 'avs'; message: string; fields: string[] }
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
  /**
   * The rail behind this method, and the reason the card step differs.
   *
   * Never shown to the renter — they choose a card, not an acquirer — but it
   * decides *who collects the number*. Flutterwave has no field-level embed, so
   * the fields below are ours; Stripe has one, so its Element collects the card
   * after this step and our own inputs would ask for it twice.
   */
  provider?: string;
  blurb?: string | null;
  networks?: string[];
  schemes?: { code: string; label: string }[];
  note?: string | null;
}

/**
 * A method is identified by both its type and its rail, because PayHold can
 * offer the same method (e.g. `card`) on more than one provider (Stripe and
 * Flutterwave) in one market. Using only `method` as the key collapsed the two
 * into a single row and made the choice meaningless — both rows shared the key,
 * and starting the payment could only ever name `method`, so it fell to
 * PayHold's default rail.
 *
 * The rail itself is never shown for this — see `CheckoutMethod.provider`'s
 * own comment. Two rows sharing a method and nothing to tell them apart on
 * screen is a real, narrow gap this leaves open (currently only reachable
 * where PayHold quotes card on both Stripe and Flutterwave in one market);
 * closing it wants a renter-facing differentiator — a scheme list, say —
 * rather than the acquirer's name standing in for one.
 */
export function methodKey(m: CheckoutMethod): string {
  return `${m.method}:${m.provider ?? ''}`;
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
  // PayHold calls the method `wallet` because the rail could be any of several.
  // Ours is PayPal, and a renter recognises the mark rather than the category.
  if (method === 'wallet') return 'paypal';
  if (method === 'paypal' || method === 'alipay' || method === 'wechat_pay') {
    return method as PaymentMethodType;
  }
  return null;
}

/**
 * One line of bank details, copyable where it matters.
 *
 * An account number and an amount get retyped into a banking app on a phone,
 * and a digit dropped there is a payment that never matches the booking. The
 * copy button is the whole point of rendering these ourselves rather than
 * sending the renter to a page that also just prints them.
 */
function TransferRow({
  label,
  value,
  copy = false,
}: {
  label: string;
  value: string;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="text-xs text-ink-500">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium text-ink-900">{value}</span>
        {copy && (
          <button
            type="button"
            aria-label={`Copy ${label}`}
            className="text-ink-400 transition-colors hover:text-brand-600"
            onClick={() => {
              navigator.clipboard?.writeText(value);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          </button>
        )}
      </span>
    </div>
  );
}

/** The rail names its address fields tersely; a renter should not have to. */
const AVS_LABEL: Record<string, string> = {
  address: 'Street address',
  city: 'City',
  state: 'State or province',
  zipcode: 'Postal code',
  country: 'Country',
};

const AVS_AUTOCOMPLETE: Record<string, string> = {
  address: 'billing street-address',
  city: 'billing address-level2',
  state: 'billing address-level1',
  zipcode: 'billing postal-code',
  country: 'billing country-name',
};

/** Groups of four, the way the number is printed on the card. */
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

/** `MM/YY`, with the slash inserted rather than demanded. */
function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/**
 * Enough to be worth sending — not a validity claim.
 *
 * Deliberately loose: the issuer decides whether a card is good, and a stricter
 * check here would reject a legitimate card on a rule we got wrong. This only
 * stops an obviously half-filled form reaching the rail.
 */
function cardLooksComplete(card: { number: string; expiry: string; cvv: string }): boolean {
  return (
    card.number.replace(/\D/g, '').length >= 13 &&
    /^\d{2}\/\d{2}$/.test(card.expiry) &&
    card.cvv.length >= 3
  );
}

/** Only what we call — their SDK is far larger than the part we depend on. */
interface PayPalSdk {
  Buttons: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID?: string }) => Promise<void>;
    onCancel: () => void;
    onError: (err: unknown) => void;
  }) => { render: (el: HTMLElement) => void };
}

/** Deal states that mean the money is with PayHold and the trip is being made. */
const SETTLED = ['funded_held', 'in_progress', 'paid', 'completed'];
/** Deal states that mean nothing was taken and the car is still free. */
const DEAD = ['payment_failed', 'expired', 'canceled'];

// ---------------------------------------------------------------------------
// The provider's fields, in our layout
// ---------------------------------------------------------------------------

/**
 * Stripe's Payment Element, mounted inside this modal.
 *
 * This is the rail every renter outside Africa lands on — PayHold quotes them
 * in USD or EUR, and the Stripe card rail is the only one that serves those
 * currencies — so it is the path most non-Rwandan bookings take, and until now
 * it was a redirect to `checkout.stripe.com`.
 *
 * An Element is not a hosted page in a border. Each input is its own iframe
 * served from Stripe, so the card number never enters AutoHire's DOM and we
 * stay PCI SAQ A, but the arrangement, spacing and button around them are ours.
 */
function StripeFields({
  action,
  amountLabel,
  onDone,
}: {
  action: Extract<NextAction, { type: 'payment_element' }>;
  amountLabel: string;
  onDone: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);

    /**
     * `if_required` is what keeps this in the page.
     *
     * The default sends the browser to `return_url` unconditionally. With this,
     * Stripe only leaves when the *issuer* insists — a 3DS challenge it cannot
     * render inline — and for everything else it resolves right here. The
     * `return_url` is still required, because Stripe needs somewhere to come
     * back to on the occasions it does go.
     */
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: action.return_url },
      redirect: 'if_required',
    });

    if (err) {
      // Card errors are the renter's to fix and safe to show; anything else is
      // Stripe's own wording, which is better than ours at explaining itself.
      setError(err.message ?? 'That payment could not be completed.');
      setBusy(false);
      return;
    }

    // Confirmed with Stripe — not funded. The hold is written by the signed
    // webhook once PayHold has re-fetched the intent, so this only tells the
    // modal to stop showing a form and start watching the deal.
    onDone();
  }

  return (
    <div>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <Button className="mt-4 w-full" size="lg" disabled={!stripe || busy} onClick={submit}>
        {busy ? 'Confirming…' : `Pay ${amountLabel}`}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-500">
        <Lock size={12} className="text-brand-600" />
        Your card is entered directly with our payment provider.
      </p>
    </div>
  );
}

/**
 * PayPal's own buttons, rendered in our modal.
 *
 * The approval itself happens in a popup PayPal opens, and that is not a
 * compromise — a wallet login inside somebody else's iframe is the shape of a
 * phishing page, so PayPal refuses to be framed and is right to. What matters
 * is that the booking underneath survives: the renter approves, the popup
 * closes, and they are still on the page they started on.
 *
 * `createOrder` hands back an order PayHold already opened rather than making
 * one here, so the charge the browser approves is the charge our webhook is
 * waiting for.
 */
function PayPalButtons({
  action,
  onApproved,
  onFailed,
}: {
  action: Extract<NextAction, { type: 'wallet_approval' }>;
  onApproved: (orderId: string) => void;
  onFailed: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    const src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(action.client_id)}` +
      `&currency=${encodeURIComponent(action.currency)}&intent=capture`;

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const script = existing ?? document.createElement('script');

    const render = () => {
      const sdk = (window as unknown as { paypal?: PayPalSdk }).paypal;
      if (cancelled || !sdk || !host.current) return;
      host.current.innerHTML = '';
      setState('ready');
      sdk
        .Buttons({
          createOrder: () => Promise.resolve(action.order),
          onApprove: (data) => {
            onApproved(data.orderID ?? action.order);
            return Promise.resolve();
          },
          // A renter who closes the popup has not failed at anything, so this
          // says nothing and leaves the buttons where they are.
          onCancel: () => undefined,
          onError: () => onFailed('PayPal could not complete that payment.'),
        })
        .render(host.current);
    };

    if ((window as unknown as { paypal?: PayPalSdk }).paypal) {
      render();
    } else {
      script.addEventListener('load', render);
      script.addEventListener('error', () => !cancelled && setState('failed'));
      if (!existing) {
        script.src = src;
        script.async = true;
        document.body.appendChild(script);
      }
    }

    return () => {
      cancelled = true;
      script.removeEventListener('load', render);
    };
  }, [action, onApproved, onFailed]);

  if (state === 'failed') {
    return (
      <div className="py-4 text-center">
        <p className="font-medium text-ink-900">One more step</p>
        <p className="mt-1 text-sm text-ink-600">
          We couldn't open PayPal here. This link approves the same payment.
        </p>
        <Button
          className="mt-4 w-full"
          onClick={() => window.location.assign(action.approval_url)}
        >
          Continue with PayPal
        </Button>
      </div>
    );
  }

  return (
    <div className="py-2">
      <p className="mb-3 text-center text-sm text-ink-600">
        Approve this booking in your PayPal account. You'll stay on this page.
      </p>
      <div ref={host} />
      {state === 'loading' && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-400">
          <Loader2 size={12} className="animate-spin" />
          Loading PayPal…
        </p>
      )}
    </div>
  );
}

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
  amountLabel,
  dealId,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  /** PayHold's public session URL. Null when sessions are unavailable. */
  checkoutBase: string | null;
  /**
   * PayHold's hosted page. Held only so a frame that a provider refuses has
   * somewhere to send the renter — never opened by any path of our own.
   */
  paymentLink: string;
  amountLabel: string;
  /**
   * The deal this checkout is for — how the trip is found once it's paid.
   * `payhold-webhook`, not this modal, writes the booking row, so there is a
   * real (usually sub-second, but not always) gap between PayHold saying the
   * deal funded and that row existing to send the renter to.
   */
  dealId?: string | null;
  /** Called once the booking behind `dealId` exists, so the caller can navigate. */
  onPaid?: (bookingId: string) => void;
}) {
  const [methods, setMethods] = useState<CheckoutMethod[] | null>(null);
  /**
   * What PayHold will actually charge — its `presentment_amount` /
   * `presentment_currency`, which can differ from the listing's own currency
   * when the renter's market can't be charged that one directly (see
   * `presentmentCurrencyFor` in payhold-backend). Shown before any method is
   * chosen so the renter sees the real number, in the real currency, with a
   * plain way to back out (the modal's own close button) if it's not what
   * they expected — rather than only finding out on PayHold's own page.
   */
  const [deal, setDeal] = useState<PublicCheckout['deal'] | null>(null);
  /** The chosen method, keyed by `methodKey` so two rails stay distinct. */
  const [chosen, setChosen] = useState<string | null>(null);
  /** The method object the key resolves to — what we actually start with. */
  const selected = methods?.find((m) => methodKey(m) === chosen) ?? null;
  const [network, setNetwork] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  /**
   * The card, held in memory for exactly as long as the rail needs it.
   *
   * A PIN or address demand is answered by resending the whole card, so it has
   * to survive between two requests. It lives here and nowhere else — no
   * storage, no logging, and cleared the moment the payment settles or the
   * modal closes. This is the SAQ D surface, and keeping it this small is the
   * only mitigation available once the fields are ours.
   */
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '', name: '' });
  const [pin, setPin] = useState('');
  const [avs, setAvs] = useState<Record<string, string>>({});
  const cardAttempt = useRef(0);
  const [action, setAction] = useState<NextAction | null>(null);
  const [stage, setStage] = useState<
    'choosing' | 'starting' | 'acting' | 'validating' | 'paid' | 'failed'
  >('choosing');
  const [error, setError] = useState<string | null>(null);
  /** Bumped to re-ask for the method list. `methods` alone is not a trigger. */
  const [attempt, setAttempt] = useState(0);
  /**
   * Do *we* collect the card, or does the provider?
   *
   * Only Flutterwave makes us: it has no field-level embed, so the fields are
   * ours and AutoHire carries PCI SAQ D for them. Stripe has the Payment
   * Element, so its own inputs appear after this step — and asking here too
   * would make the renter type the same card twice, into two different forms,
   * one of which then throws it away.
   */
  const collectsCardHere = selected?.provider === 'flutterwave';
  const polling = useRef<number | null>(null);
  /**
   * Whether this PayHold has `/confirm`. Assumed yes and unset on the first
   * 404, so an older deployment costs one wasted request rather than a
   * capability check on every payment.
   */
  const confirmable = useRef(true);

  // Read what this renter may pay with, in PayHold's own words. No credential:
  // the session token in the path is the credential.
  useEffect(() => {
    if (!open || !checkoutBase) return;
    let live = true;
    fetch(checkoutBase)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PublicCheckout) => {
        if (live) {
          setMethods(d.methods ?? []);
          setDeal(d.deal ?? null);
        }
      })
      .catch(() => {
        // Empty, not null. There used to be a picker of ours waiting behind
        // this branch, and its only exit was PayHold's hosted page — so a
        // transient network failure quietly became the very handoff this modal
        // exists to prevent. An empty list shows the retry below instead.
        if (live) setMethods([]);
      });
    return () => {
      live = false;
    };
  }, [open, checkoutBase, attempt]);

  /**
   * Watch the deal, not the session.
   *
   * `status` at the top of that response is the *session's* — `open` or
   * `completed`, meaning whether the renter has finished choosing. The money is
   * `deal.status`, and reading the wrong one is a screen that waits forever
   * through a payment that already landed.
   *
   * And **it asks rather than reads**. A plain `GET` returns PayHold's own
   * row, which only ever changed when the provider's webhook reached PayHold —
   * so a payment that succeeded at the rail while that delivery failed left
   * this poll refreshing a value nothing could move. The renter's money was
   * gone, the spinner was permanent, and the host was never told anyone had
   * booked. `/confirm` makes PayHold re-fetch the transaction from the provider
   * and fund the deal if it landed, which is the same evidence its webhook
   * handler acts on, obtained by asking instead of by waiting.
   */
  useEffect(() => {
    if (!open || !checkoutBase) return;
    if (stage !== 'acting' && stage !== 'validating') return;

    const tick = async () => {
      try {
        // Fall back to reading the session for a PayHold too old to have
        // `/confirm`. Worse — it can only see a payment the webhook delivered —
        // but a deployment mismatch should degrade rather than break checkout.
        const r = confirmable.current
          ? await fetch(`${checkoutBase}/confirm`, { method: 'POST' })
          : await fetch(checkoutBase);

        if (r.status === 404 && confirmable.current) {
          confirmable.current = false;
          return;
        }
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
   * The trip itself, once PayHold says the deal is funded. `stage === 'paid'`
   * only means the deal settled at PayHold — `payhold-webhook` still has to
   * receive that event and write the booking row, and PayHold dispatches
   * webhooks off a once-a-minute cron rather than pushing them instantly
   * (confirmed against real delivery logs: `order.funded_held`, the event
   * that creates the booking, has taken up to ~40s to arrive, and other
   * events on the same deal up to ~60s). A short poll window reliably misses
   * that, so this waits long enough to cover a full cron cycle plus margin
   * rather than the ~20s a "just poll a bit" window would use. `onPaid` never
   * firing still is not an error — the renter sees "Done" instead of being
   * moved automatically, and the trip still shows up in My trips once the
   * webhook lands regardless.
   */
  useEffect(() => {
    if (stage !== 'paid' || !dealId || !onPaid) return;
    let cancelled = false;
    let tries = 0;
    const MAX_TRIES = 30; // 30 × 3s = 90s — one ~60s cron cycle, plus margin.

    const tick = async () => {
      tries += 1;
      try {
        const booking = await client.getBookingByDealId(dealId);
        if (cancelled) return;
        if (booking) {
          onPaid(booking.id);
          return;
        }
      } catch {
        /* a dropped lookup is not a failure — keep trying until the timeout */
      }
      if (!cancelled && tries < MAX_TRIES) {
        window.setTimeout(tick, 3000);
      }
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [stage, dealId, onPaid]);

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
  /**
   * Stripe.js and the Element's options, built once per client secret.
   *
   * `Elements` treats `options.clientSecret` as fixed after mount, so this must
   * not be rebuilt on unrelated renders — a new object each time remounts the
   * Element and loses whatever the renter had typed into it.
   */
  const stripeElements = useMemo(() => {
    if (action?.type !== 'payment_element') return null;
    return {
      stripe: getStripeFor(action.publishable_key),
      options: {
        clientSecret: action.client_secret,
        // Their fields, our palette — which is the whole point of an Element
        // over a hosted page.
        appearance: {
          theme: 'stripe' as const,
          variables: { colorPrimary: '#0f766e', borderRadius: '10px' },
        },
      },
    };
  }, [action]);

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

  async function start(m: CheckoutMethod) {
    // No session, no payment. This used to navigate to PayHold's hosted page,
    // which meant the one condition nobody tests — a session that failed to
    // open — was also the one that undid the whole flow.
    if (!checkoutBase) {
      setError('We could not start this payment. Nothing has been charged.');
      return;
    }
    setStage('starting');
    setError(null);
    try {
      const res = await fetch(`${checkoutBase}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: m.method,
          ...(m.provider ? { provider: m.provider } : {}),
          ...(network ? { network } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(m.method === 'card' && collectsCardHere ? { card: cardPayload() } : {}),
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

  /** The card in the rail's shape. Split here so the form can stay friendly. */
  function cardPayload() {
    const [mm = '', yy = ''] = card.expiry.split('/').map((p) => p.trim());
    return {
      number: card.number.replace(/\s+/g, ''),
      cvv: card.cvv.trim(),
      expiry_month: mm.padStart(2, '0'),
      // Two digits is what the rail wants; renters type either.
      expiry_year: yy.length === 4 ? yy.slice(2) : yy,
      name: card.name.trim() || undefined,
    };
  }

  /**
   * Answer the PIN or address the issuer asked for.
   *
   * Goes to `/authorize` rather than `/pay`: `/pay` completes the checkout
   * session, and this continues a charge that call already started. The card
   * goes again because the rail wants the whole payload back — which is exactly
   * why it was kept in memory rather than stored anywhere.
   */
  async function authorize(auth: Record<string, string>) {
    if (!checkoutBase) return;
    setStage('validating');
    setError(null);
    cardAttempt.current += 1;
    try {
      const res = await fetch(`${checkoutBase}/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card: cardPayload(),
          authorization: auth,
          attempt: cardAttempt.current,
        }),
      });
      const data = (await res.json()) as {
        next_action?: NextAction;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(data?.error?.message ?? 'That could not be verified.');
      apply(data.next_action, undefined);
      setPin('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be verified.');
      setStage('acting');
    }
  }

  /**
   * The renter approved in the wallet's popup; ask the rail to take the money.
   *
   * The SDK reporting approval is not evidence of anything — it runs in the
   * renter's browser. PayHold asks PayPal to capture and lets PayPal refuse if
   * no such approval happened, and even a successful capture only means money
   * moved *there*: the trip still waits for the signed webhook.
   */
  async function capture(orderId: string) {
    if (!checkoutBase) return;
    setStage('validating');
    setError(null);
    try {
      const res = await fetch(`${checkoutBase}/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: orderId }),
      });
      const data = (await res.json()) as {
        next_action?: NextAction;
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(data?.error?.message ?? 'That payment could not be completed.');
      apply(data.next_action, undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That payment could not be completed.');
      setStage('acting');
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
              {dealId && onPaid
                ? "We're setting up your trip — taking you there as soon as it's ready."
                : "We're setting up your trip — it'll appear in My trips in a moment."}
            </p>
            {dealId && onPaid && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-ink-400">
                <Loader2 size={12} className="animate-spin" /> Opening your trip — this can take up to a
                minute.
              </p>
            )}
            <Button
              className="mt-4 w-full"
              onClick={() => {
                // The SAQ D surface closes here. Nothing reads it again, and
                // leaving it in a live component is the one avoidable risk.
                setCard({ number: '', expiry: '', cvv: '', name: '' });
                onClose();
              }}
            >
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
            {/* "Check your phone" is true of a wallet and false of a card. A
                card buyer who has already answered an OTP is waiting on their
                bank, and telling them to look at a handset sends them hunting
                for a prompt that is never coming. */}
            {selected?.method === 'mobile_money' ? (
              <>
                <Smartphone size={28} className="mx-auto text-brand-600" />
                <p className="mt-3 font-medium text-ink-900">Check your phone</p>
              </>
            ) : (
              <>
                <Loader2 size={28} className="mx-auto animate-spin text-brand-600" />
                <p className="mt-3 font-medium text-ink-900">Confirming your payment</p>
              </>
            )}
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

        {stage === 'acting' && action?.type === 'wallet_approval' && (
          <PayPalButtons
            action={action}
            onApproved={capture}
            onFailed={(m) => setError(m)}
          />
        )}

        {midPayment && action?.type === 'transfer' && (
          <div className="py-1">
            <div className="text-center">
              <Landmark size={26} className="mx-auto text-brand-600" />
              <p className="mt-2.5 font-medium text-ink-900">Transfer from your bank</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-600">
                Send exactly this amount to the account below. It's held for this booking
                only.
              </p>
            </div>

            <div className="mt-4 divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200">
              <TransferRow label="Bank" value={action.bank} />
              <TransferRow label="Account number" value={action.account} copy />
              <TransferRow label="Amount" value={action.amount} copy />
              <TransferRow label="Reference" value={action.reference} copy />
            </div>

            {action.note && <p className="mt-2.5 text-xs text-ink-500">{action.note}</p>}
            {action.expires_at && (
              <p className="mt-2.5 text-center text-xs text-amber-700">
                This account expires — complete the transfer soon, or start again for a fresh
                one.
              </p>
            )}

            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-ink-400">
              <Loader2 size={12} className="animate-spin" />
              We'll confirm as soon as it lands — don't close this window.
            </p>
          </div>
        )}

        {midPayment && action?.type === 'pin' && (
          <div className="py-1">
            <div className="text-center">
              <ShieldCheck size={26} className="mx-auto text-brand-600" />
              <p className="mt-2.5 font-medium text-ink-900">Enter your card PIN</p>
              <p className="mx-auto mt-1 max-w-xs text-sm text-ink-600">{action.message}</p>
            </div>
            <div className="mx-auto mt-4 max-w-xs">
              <Label htmlFor="card-pin">PIN</Label>
              <Input
                id="card-pin"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                maxLength={6}
                placeholder="••••"
                autoFocus
              />
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              <Button
                className="mt-3 w-full"
                disabled={pin.length < 4 || busy}
                onClick={() => authorize({ mode: 'pin', pin })}
              >
                {busy ? 'Checking…' : 'Continue'}
              </Button>
            </div>
          </div>
        )}

        {midPayment && action?.type === 'avs' && (
          <div className="py-1">
            <div className="text-center">
              <ShieldCheck size={26} className="mx-auto text-brand-600" />
              <p className="mt-2.5 font-medium text-ink-900">Confirm your billing address</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-600">{action.message}</p>
            </div>
            <div className="mx-auto mt-4 max-w-sm space-y-2.5">
              {action.fields.map((field) => (
                <div key={field}>
                  <Label htmlFor={`avs-${field}`}>{AVS_LABEL[field] ?? field}</Label>
                  <Input
                    id={`avs-${field}`}
                    value={avs[field] ?? ''}
                    onChange={(e) => setAvs({ ...avs, [field]: e.target.value })}
                    autoComplete={AVS_AUTOCOMPLETE[field]}
                  />
                </div>
              ))}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button
                className="w-full"
                disabled={action.fields.some((f) => !(avs[f] ?? '').trim()) || busy}
                onClick={() => authorize({ mode: 'avs_noauth', ...avs })}
              >
                {busy ? 'Checking…' : 'Continue'}
              </Button>
            </div>
          </div>
        )}

        {midPayment && action?.type === 'redirect' && (
          <PayFrame url={action.url} amountLabel={amountLabel} />
        )}

        {/* `acting`, not `midPayment` — once Stripe has taken the card the form
            must come down. Leaving it up through `validating` would invite a
            renter to enter a second card against a charge already in flight. */}
        {stage === 'acting' && action?.type === 'payment_element' && stripeElements && (
          <Elements stripe={stripeElements.stripe} options={stripeElements.options}>
            <StripeFields
              action={action}
              amountLabel={amountLabel}
              // Stripe has taken the card; the deal has not moved yet. Handing
              // over to the poll rather than declaring success keeps the webhook
              // the only thing that can call a trip paid for.
              onDone={() => setStage('validating')}
            />
          </Elements>
        )}

        {stage === 'validating' && action?.type === 'payment_element' && (
          <div className="py-6 text-center">
            <Loader2 size={26} className="mx-auto animate-spin text-brand-600" />
            <p className="mt-3 font-medium text-ink-900">Confirming your payment</p>
            <p className="mt-1 text-sm text-ink-600">
              This takes a few seconds — don't close this window.
            </p>
          </div>
        )}

        {(stage === 'choosing' || stage === 'starting') && (
          <>
            {/* The real charge, from PayHold's own record of this deal — its
                presentment amount and currency, which is what actually gets
                charged and can differ from the listing's own currency. Shown
                before any method is picked, with the modal's own close button
                as the plain way to back out if this isn't what was expected. */}
            {deal?.currency && deal.amount != null && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3.5 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-brand-700">
                  You'll be charged
                </p>
                <p className="mt-0.5 text-xl font-bold text-ink-900">
                  {formatMoneyMinor(deal.amount, deal.currency)}
                </p>
                <p className="mt-1 text-xs text-ink-500">
                  The exact amount and currency PayHold will charge you.
                </p>
              </div>
            )}

            {/* PayHold's list, and only PayHold's. It knows which rails are
                switched on in this market today; a list of ours never will,
                and the one we used to keep here for emergencies led out of the
                app. */}
            {methods && methods.length > 0 ? (
              <div className="grid gap-2.5">
                {methods.map((m) => {
                  const mark = marksFor(m.method);
                  const key = methodKey(m);
                  const isChosen = chosen === key;
                  return (
                    <div
                      key={key}
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
                          setChosen(key);
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

                      {isChosen && m.method === 'card' && m.provider !== 'flutterwave' && (
                        <p className="flex items-start gap-1.5 border-t border-brand-200/70 px-3.5 pb-3.5 pt-3 text-xs text-ink-600">
                          <Lock size={13} className="mt-0.5 shrink-0 text-brand-600" />
                          Your card details come next, entered directly with our payment
                          provider — they never pass through AutoHire.
                        </p>
                      )}

                      {isChosen && m.method === 'card' && m.provider === 'flutterwave' && (
                        <div className="space-y-2.5 border-t border-brand-200/70 px-3.5 pb-3.5 pt-3">
                          <div>
                            <Label htmlFor="card-number">Card number</Label>
                            <Input
                              id="card-number"
                              value={card.number}
                              onChange={(e) =>
                                setCard({ ...card, number: formatCardNumber(e.target.value) })
                              }
                              placeholder="4242 4242 4242 4242"
                              inputMode="numeric"
                              autoComplete="cc-number"
                              maxLength={23}
                            />
                          </div>
                          <div className="flex gap-2.5">
                            <div className="flex-1">
                              <Label htmlFor="card-expiry">Expiry</Label>
                              <Input
                                id="card-expiry"
                                value={card.expiry}
                                onChange={(e) =>
                                  setCard({ ...card, expiry: formatExpiry(e.target.value) })
                                }
                                placeholder="MM/YY"
                                inputMode="numeric"
                                autoComplete="cc-exp"
                                maxLength={5}
                              />
                            </div>
                            <div className="flex-1">
                              <Label htmlFor="card-cvv">CVV</Label>
                              <Input
                                id="card-cvv"
                                value={card.cvv}
                                onChange={(e) =>
                                  setCard({ ...card, cvv: e.target.value.replace(/\D/g, '') })
                                }
                                placeholder="123"
                                inputMode="numeric"
                                autoComplete="cc-csc"
                                maxLength={4}
                              />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="card-name">Name on card</Label>
                            <Input
                              id="card-name"
                              value={card.name}
                              onChange={(e) => setCard({ ...card, name: e.target.value })}
                              placeholder="As printed on the card"
                              autoComplete="cc-name"
                            />
                          </div>
                          <p className="flex items-start gap-1.5 pt-0.5 text-xs text-ink-500">
                            <Lock size={13} className="mt-0.5 shrink-0 text-brand-600" />
                            Sent straight to our payment provider, encrypted. We never store it.
                          </p>
                        </div>
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
            ) : methods === null ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-ink-500">
                <Loader2 size={14} className="animate-spin" />
                Loading your payment options…
              </p>
            ) : (
              <div className="py-4 text-center">
                <p className="font-medium text-ink-900">
                  We can't take a payment for this trip right now
                </p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-ink-600">
                  Nothing has been charged and the car is still available. This is usually
                  temporary — try again in a moment.
                </p>
                <Button
                  variant="outline"
                  className="mt-4 w-full"
                  onClick={() => {
                    setMethods(null);
                    setAttempt((n) => n + 1);
                  }}
                >
                  Try again
                </Button>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {methods && methods.length > 0 && (
              <Button
                className="w-full"
                size="lg"
                disabled={
                  !selected ||
                  stage === 'starting' ||
                  (selected.method === 'mobile_money' && phone.trim().length < 8) ||
                  (selected.method === 'card' && collectsCardHere && !cardLooksComplete(card))
                }
                onClick={() => selected && start(selected)}
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
