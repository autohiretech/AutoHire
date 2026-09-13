import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { client } from '@/lib/client';
import { Button, Notice, Skeleton } from '@/components/ui';
import { PAYPAL_CONNECT_HANDOFF } from '@/components/PayPalConnectModal';

/**
 * Where PayPal sends a host back after they sign in to connect their account.
 *
 * The redirect carries a `code`, and a code is not identity — it is exchanged
 * server-side against our own client secret before anything is written, the
 * same reasoning `StripeConnectReturnPage` applies to Stripe's return. What
 * comes back is the host's payer id and, the part worth the whole flow,
 * whether PayPal considers their account able to receive money.
 *
 * **An unverified account is not an error and is not silently accepted.** The
 * destination is saved — it really is theirs — but it stays unverified, so the
 * payout is stopped here with a sentence they can act on rather than by PayPal
 * holding it unclaimed for thirty days and returning it.
 */
export function PayPalConnectReturnPage() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');
  /**
   * **PayPal's own words for why it sent us back empty.**
   *
   * This page read `error` to decide what to render and then threw it away,
   * showing "you came back without connecting an account" for every case —
   * a cancelled consent screen, a scope the app is not approved for, a
   * mismatched return URL. That is the same swallowing that made
   * `RECEIVER_UNCONFIRMED` invisible for a day: the provider said exactly what
   * was wrong and we replaced it with a guess.
   *
   * Every parameter is shown, not just the two named ones, because PayPal has
   * more than one way of saying no and a redirect carrying something we did
   * not think to read is precisely the case worth seeing.
   */
  const deniedDetail = [
    params.get('error_description'),
    denied && `error=${denied}`,
    ...[...params.entries()]
      .filter(([k]) => !['error', 'error_description', 'code', 'state'].includes(k))
      .map(([k, v]) => `${k}=${v}`),
  ]
    .filter(Boolean)
    .join(' · ');

  // The state PayPal was given at the start. A callback that does not check it
  // accepts a code from anywhere, which is the whole reason it is generated.
  const [stateMismatch, setStateMismatch] = useState(false);
  const sent = useRef(false);

  /**
   * Hand the outcome back to the page that opened us, and get out of the way.
   *
   * The connection runs in a popup so the host never leaves AutoHire — they
   * are in the middle of setting up payouts, and bouncing the whole app out to
   * paypal.com and back loses that place. So this page usually exists for
   * about a second inside a small window: it posts the result to its opener
   * and closes. Everything below it is the standalone rendering, for a popup
   * that was blocked and became a redirect instead.
   *
   * `window.location.origin` as the target, never `'*'` — the result names a
   * payout account, and a wildcard would hand it to whatever else is
   * listening.
   */
  const reportToOpener = (payload: unknown): boolean => {
    if (!window.opener || window.opener === window) return false;
    window.opener.postMessage(
      { type: 'paypal-connect', payload },
      window.location.origin,
    );
    window.close();
    return true;
  };

  const complete = useMutation({
    mutationFn: (c: string) => client.completePayPalConnect(c),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      queryClient.invalidateQueries({ queryKey: ['payholdEarnings'] });
      queryClient.invalidateQueries({ queryKey: ['payholdWallet'] });
      if (reportToOpener({ ok: true, result })) return;
      // No opener: this tab *is* the app, on a phone or in the installed PWA,
      // and the host is going back to the payout screen they started from.
      // The answer travels with them so that screen can show it the way the
      // popup path shows it inside the modal.
      try {
        sessionStorage.setItem(
          PAYPAL_CONNECT_HANDOFF,
          JSON.stringify({ ok: true, email: result.email, status: result.status }),
        );
      } catch {
        // Storage refused — the screen simply shows the saved method instead.
      }
    },
    onError: (err) => {
      reportToOpener({
        ok: false,
        message: err instanceof Error ? err.message : 'Could not connect that account.',
      });
    },
  });

  // A host who cancelled at PayPal comes back with no code. Tell the opener so
  // its button stops spinning, rather than leaving a dead popup on screen.
  useEffect(() => {
    if (code || sent.current) return;
    sent.current = true;
    reportToOpener({
      ok: false,
      cancelled: !deniedDetail,
      message: deniedDetail ? `PayPal said: ${deniedDetail}` : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    if (!code || sent.current) return;
    const expected = sessionStorage.getItem('paypalConnectState');
    sessionStorage.removeItem('paypalConnectState');
    if (expected && state !== expected) {
      setStateMismatch(true);
      reportToOpener({ ok: false, message: "That sign-in didn't match the request we started." });
      return;
    }
    // Once. React 18 mounts effects twice in development and a code can only
    // be exchanged one time — the second attempt fails against PayPal, which
    // would show the host a failure after a success.
    sent.current = true;
    complete.mutate(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, state]);

  const result = complete.data;

  return (
    <section className="mx-auto max-w-md px-4 py-16 text-center">
      {denied || (!code && !stateMismatch) ? (
        <Notice tone="warn" className="flex-col items-center text-center">
          <XCircle size={22} />
          <p className="font-medium">PayPal didn't finish</p>
          <p className="text-body-sm">
            You came back without connecting an account. Nothing changed — you can try
            again, or type your PayPal address instead.
          </p>
          {deniedDetail && (
            <p className="mt-1 break-words text-caption text-[var(--color-content-muted)]">
              PayPal said: {deniedDetail}
            </p>
          )}
        </Notice>
      ) : stateMismatch ? (
        <Notice tone="danger" className="flex-col items-center text-center">
          <XCircle size={22} />
          <p className="font-medium">That sign-in didn't match</p>
          <p className="text-body-sm">
            The response didn't match the request we started, so nothing was saved.
            Start the connection again from your payout settings.
          </p>
        </Notice>
      ) : complete.isPending ? (
        <div className="flex flex-col items-center gap-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-5 w-52" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : complete.isError ? (
        <Notice tone="danger" className="flex-col items-center text-center">
          <XCircle size={22} />
          <p className="font-medium">Couldn't connect that account</p>
          <p className="text-body-sm">
            {complete.error instanceof Error ? complete.error.message : 'Please try again.'}
          </p>
        </Notice>
      ) : result?.status === 'ready' ? (
        <Notice tone="brand" className="flex-col items-center text-center">
          <CheckCircle2 size={22} />
          <p className="font-medium">PayPal connected</p>
          <p className="text-body-sm">
            {result.email ? `${result.email} is` : 'Your PayPal account is'} ready to
            receive payouts. Nothing else to do.
          </p>
        </Notice>
      ) : result ? (
        <Notice tone="warn" className="flex-col items-center text-center">
          <AlertTriangle size={22} />
          <p className="font-medium">Connected, but PayPal can't pay it yet</p>
          <p className="text-body-sm">
            {result.status === 'unverified_paypal_account'
              ? "PayPal says this account isn't verified. Confirm your email address with PayPal, then come back — until then a payment would sit unclaimed for 30 days and be returned."
              : "PayPal didn't say whether this account can receive payments. We've saved it and left it unverified until we know."}
          </p>
        </Notice>
      ) : null}

      {/* Where they started, first — this page is the same-tab round trip's
          landing, and a host who tapped Connect on the payout screen expects
          to be back on it, not somewhere else in the app. */}
      <Link to="/payouts/setup" className="mt-6 block w-full">
        <Button className="w-full">Back to payout settings</Button>
      </Link>
      <Link to="/earnings" className="mt-2 block w-full">
        <Button variant="ghost" className="w-full">Back to earnings</Button>
      </Link>
    </section>
  );
}
