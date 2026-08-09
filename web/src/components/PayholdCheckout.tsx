import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';

/**
 * PayHold's checkout, running inside AutoHire rather than replacing it.
 *
 * Framing a payment page is a privilege the page grants, and it can be withdrawn
 * mid-flow. Three things can refuse us, and only the first is predictable:
 *
 *  1. PayHold itself, if its `frame-ancestors` does not name our origin — the
 *     state before its header change ships.
 *  2. **The provider it hands off to.** PayHold collects on Flutterwave or
 *     Stripe, and Stripe Checkout refuses framing outright. So a frame that
 *     loaded perfectly well goes blank at the exact moment the renter is sent
 *     to pay. The redirect is not a fallback for old browsers here; on that rail
 *     it is the only path that completes.
 *  3. A browser blocking third-party frames wholesale.
 *
 * So this never assumes the frame is working. It watches for PayHold saying
 * hello, and treats silence as refusal.
 *
 * Whether a refusal is recoverable depends on when it happens. Before the renter
 * has touched anything, leaving is free and we go without asking. Once the frame
 * has spoken — a method chosen, a handoff begun — an unannounced navigation
 * could interrupt a payment in progress, so we stop and offer the link instead.
 */
export function PayholdCheckout({
  paymentLink,
  prefill = null,
}: {
  paymentLink: string;
  /**
   * Card details the renter typed on the booking page, to be handed to the
   * checkout so they are not asked twice.
   *
   * This goes browser-to-frame and nowhere else: posted to PayHold's exact
   * origin, never to AutoHire's server, never into the deal. It is the same
   * journey the number makes when typed on PayHold's page directly.
   */
  prefill?: { number: string; expiry: string; cvc: string } | null;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(620);
  const [stage, setStage] = useState<'loading' | 'live' | 'stranded' | 'paid' | 'failed'>(
    'loading',
  );
  const [failure, setFailure] = useState<string | null>(null);

  // Has PayHold said anything at all? This is what separates "the frame never
  // worked" from "the frame was working and then the provider refused", and the
  // two want opposite handling.
  const spoke = useRef(false);

  const origin = useMemo(() => {
    try {
      return new URL(paymentLink).origin;
    } catch {
      return null;
    }
  }, [paymentLink]);

  const leave = useCallback(() => window.location.assign(paymentLink), [paymentLink]);

  /** Give up on framing. Silent if nothing is in flight, asked if something is. */
  const refused = useCallback(() => {
    if (spoke.current) setStage('stranded');
    else leave();
  }, [leave]);

  useEffect(() => {
    if (!origin) return;

    function onMessage(e: MessageEvent) {
      // The frame is a payment page; anything else claiming to be one is not
      // something to take instructions from.
      if (e.origin !== origin) return;
      const data = e.data as { source?: string; event?: string; height?: number } | null;
      if (!data || data.source !== 'payhold') return;

      spoke.current = true;
      setStage((s) => (s === 'loading' ? 'live' : s));

      // Hand over the card the moment the frame is listening, and only then —
      // posting before it has spoken would send the number into a page that may
      // not be PayHold's yet. Targeted at its exact origin, never "*".
      if (data.event === 'ready' && prefill?.number) {
        e.source?.postMessage?.(
          { source: 'autohire', event: 'prefill', method: 'card', card: prefill },
          { targetOrigin: origin } as WindowPostMessageOptions,
        );
      }

      switch (data.event) {
        case 'resize':
          // Bounded: a bad number here would either clip the card form or
          // stretch the page to nothing.
          if (typeof data.height === 'number' && Number.isFinite(data.height)) {
            setHeight(Math.min(Math.max(Math.round(data.height), 320), 1400));
          }
          break;
        case 'payment_succeeded':
          // Only a screen change. The booking is created by the signed
          // `order.funded_held` webhook, never by a message from a frame —
          // anything that can post one could otherwise mint itself a trip.
          setStage('paid');
          break;
        case 'payment_failed':
          setFailure('That payment did not go through.');
          setStage('failed');
          break;
        case 'payment_cancelled':
          setFailure(null);
          setStage('failed');
          break;
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, prefill]);

  /**
   * Did the frame actually render, or is it the blank document a refusal leaves?
   *
   * A refused frame still fires `load`, so the event alone proves nothing. What
   * distinguishes them is reachability: a frame that really loaded PayHold is
   * cross-origin and touching its location throws, while a blocked one sits on
   * `about:blank`, same-origin and readable. The throw is the success signal.
   */
  const onLoad = useCallback(() => {
    const win = frame.current?.contentWindow;
    if (!win) return refused();
    try {
      const href = win.location.href;
      if (href === 'about:blank' || href === '') refused();
    } catch {
      setStage((s) => (s === 'loading' ? 'live' : s));
    }
  }, [refused]);

  // Nothing at all after a beat means the frame is not coming up — a blocker
  // that suppresses `load`, or a PayHold that has not shipped its headers yet.
  useEffect(() => {
    if (stage !== 'loading') return;
    const t = setTimeout(() => {
      if (!spoke.current) leave();
    }, 6000);
    return () => clearTimeout(t);
  }, [stage, leave]);

  if (stage === 'paid') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 text-center">
        <p className="font-semibold text-ink-900">Payment received</p>
        <p className="mt-1 text-sm text-ink-600">
          We're setting up your trip now. It'll appear in your trips in a moment — you don't
          need to stay on this page.
        </p>
        <Link
          to="/trips"
          className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white"
        >
          Go to my trips
        </Link>
      </div>
    );
  }

  if (stage === 'failed') {
    return (
      <div className="rounded-xl border border-ink-200 p-5 text-center">
        <p className="font-medium text-ink-900">{failure ?? 'Payment cancelled'}</p>
        <p className="mt-1 text-sm text-ink-600">
          Nothing has been charged and the car is still available.
        </p>
        <Button className="mt-4" onClick={leave}>
          Try again
        </Button>
      </div>
    );
  }

  if (stage === 'stranded') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 text-center">
        <p className="font-medium text-ink-900">Finish paying on our secure page</p>
        <p className="mt-1 text-sm text-ink-600">
          Your bank's page can't open inside AutoHire, so the last step happens on our checkout
          page. Your booking details are saved.
        </p>
        <Button className="mt-4" onClick={leave}>
          Continue to payment
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-xl border border-ink-200">
        <iframe
          ref={frame}
          src={paymentLink}
          onLoad={onLoad}
          title="Secure checkout"
          className="block w-full"
          style={{ height }}
          // Card fields and the provider handoff both need these. No
          // `allow-top-navigation`: the frame must not be able to move the page
          // out from under the renter.
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
          allow="payment *"
        />
      </div>
      {stage === 'loading' && (
        <p className="mt-3 text-center text-xs text-ink-500">Opening secure checkout…</p>
      )}
      <p className="mt-3 text-center text-xs text-ink-500">
        Your money is held until the trip is done — the host is paid after you both confirm the
        car came back.{' '}
        <button type="button" onClick={leave} className="font-medium text-brand-600 underline">
          Having trouble? Open the checkout page
        </button>
      </p>
    </div>
  );
}
