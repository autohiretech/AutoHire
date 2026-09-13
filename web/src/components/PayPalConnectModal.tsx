import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { client } from '@/lib/client';
import { Button, Modal } from '@/components/ui';
import { PayPalMark } from '@/components/PaymentBrands';

/**
 * Connecting a PayPal account, in the app — the shape paying already has.
 *
 * **Why a modal rather than the inline card this replaces.** A host setting up
 * payouts used to press a button on the form and have a window to paypal.com
 * appear over it with no explanation, while the page behind carried on looking
 * like a form they had not finished. Paying does not work that way:
 * `CheckoutModal` puts PayPal inside a surface that says what is about to
 * happen, and the renter approves in PayPal's own window over the top of it.
 * This is that, for the other side of the money.
 *
 * **The popup is PayPal's, and it has to be.** A wallet login inside somebody
 * else's iframe is the shape of a phishing page, so PayPal refuses to be
 * framed and is right to — the same sentence `CheckoutModal`'s own header
 * carries. What "in the app" can honestly mean is that the host never loses
 * their place: this modal stays open underneath, and the result lands in it
 * rather than on a page they get bounced back to.
 *
 * **PayPal's current documentation builds this flow as a URL, not a button
 * script.** Checkout has a Buttons SDK; Log in with PayPal does not have an
 * equivalent that is current — `paypalobjects.com/js/external/api.js` with
 * `paypal.use(['login'])` is the legacy of a deprecated generation, and the
 * live reference describes assembling the authorization URL with `client_id`,
 * `scope`, `redirect_uri`, `response_type` and `state`, which is exactly what
 * `PayPalProvider.loginUrl` assembles server-side. So the button below is
 * ours. Which of PayPal's two presentations the URL asks for is `sameTab`'s
 * decision, just below: a desktop gets the mini browser over this modal, a
 * phone or the installed PWA gets PayPal as a page in this same tab.
 */
/**
 * Whether this device has to go to PayPal in the same tab.
 *
 * A popup is the right shape on a desktop: the modal underneath keeps the
 * host's place and the result lands in it. On a phone it is the wrong one, in
 * two different ways. Installed as a PWA there is no browser chrome for a
 * second window to open in, so `window.open` is either refused or opens an
 * external browser the app never hears back from. In a mobile browser the
 * popup is a whole separate tab, and the host has left AutoHire to sign in —
 * exactly what this flow exists to avoid. PayPal documents a same-tab
 * presentation for precisely this (`fullPage=true`): the app itself navigates
 * to the consent page and PayPal sends that tab back to `/payouts/paypal/return`,
 * so nothing ever happens outside the app.
 *
 * Standalone display mode is the PWA; coarse pointer is a touch device. Either
 * is enough — a phone in a browser is still a phone.
 */
export function sameTab(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if ((navigator as unknown as { standalone?: boolean }).standalone === true) return true;
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** The return page hands the same-tab outcome back through this key. */
export const PAYPAL_CONNECT_HANDOFF = 'paypalConnectOutcome';

export function PayPalConnectModal({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  /** So the screen underneath can show what was connected after this closes. */
  onResult?: (result: PayPalConnectOutcome) => void;
}) {
  const queryClient = useQueryClient();
  const [environment, setEnvironment] = useState<'sandbox' | 'live' | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [outcome, setOutcome] = useState<PayPalConnectOutcome | null>(null);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  // A fresh open is a fresh attempt. Without this, a host who connected an
  // unverified account, closed the modal and came back would be reading last
  // time's answer while pressing a button that had not run yet.
  useEffect(() => {
    if (!open) return;
    setOutcome(null);
    setWaiting(false);
  }, [open]);

  /**
   * The popup reports back by `postMessage` from `/payouts/paypal/return`.
   *
   * Same-origin only: the payload names a payout account, and a wildcard
   * target would hand it to whatever else is listening.
   */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as { type?: string; payload?: Record<string, unknown> } | null;
      if (data?.type !== 'paypal-connect') return;

      setWaiting(false);
      const payload = data.payload ?? {};

      // A host who closed PayPal's window has not failed at anything and is
      // told nothing — the modal simply stops waiting, with its button where
      // they left it. A refusal is different: PayPal said something, and this
      // is the only place it can land.
      if (payload.cancelled) return;

      if (payload.ok) {
        const r = payload.result as {
          email: string | null;
          status: 'ready' | 'unverified_paypal_account' | 'unknown';
        };
        const result: PayPalConnectOutcome = { ok: true, email: r.email, status: r.status };
        setOutcome(result);
        onResultRef.current?.(result);
        queryClient.invalidateQueries({ queryKey: ['currentUser'] });
        queryClient.invalidateQueries({ queryKey: ['payholdEarnings'] });
        queryClient.invalidateQueries({ queryKey: ['payholdWallet'] });
      } else {
        const result: PayPalConnectOutcome = {
          ok: false,
          message: String(payload.message ?? 'Could not connect that account.'),
        };
        setOutcome(result);
        onResultRef.current?.(result);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [queryClient]);

  const start = useMutation({
    mutationFn: () => client.startPayPalConnect({ fullPage: sameTab() }),
    onSuccess: ({ url, state, environment: env }) => {
      sessionStorage.setItem('paypalConnectState', state);
      setEnvironment(env);
      setOutcome(null);

      // A phone or the installed app: the whole tab goes to PayPal and comes
      // back to the return page, which sends the host on to their payout
      // settings with the answer. No second window is ever opened, so there
      // is nothing for a mobile browser to block or a PWA to lose.
      if (sameTab()) {
        setWaiting(true);
        window.location.assign(url);
        return;
      }

      const popup = window.open(
        url,
        'paypal-connect',
        'width=500,height=720,menubar=no,toolbar=no,location=no',
      );
      if (!popup) {
        // Blocked. The whole-page navigation still works, and the return page
        // renders standalone when it has no opener to talk to.
        window.location.href = url;
        return;
      }
      setWaiting(true);
      popup.focus();
    },
  });

  const busy = start.isPending || waiting;

  return (
    <Modal open={open} onClose={onClose} title="Connect PayPal">
      <div className="py-1">
        <div className="flex items-center justify-center">
          <PayPalMark />
        </div>

        <p className="mt-4 text-center text-body-sm text-[var(--color-content-muted)]">
          Sign in to PayPal once and we'll ask PayPal directly whether your account can
          receive payouts — rather than finding out after a payment sits unclaimed for
          thirty days.
        </p>

        {/* Which PayPal this is, when it is not the real one. PayHold knows —
            sandbox and live are different hosts on this rail — and a host or a
            tester looking at a sandbox login deserves to be told rather than
            wondering why their real password is refused. */}
        {environment === 'sandbox' && (
          <p className="mt-2 text-center text-caption text-[var(--color-content-subtle)]">
            Connecting to PayPal's sandbox — use a sandbox test account, not your real one.
          </p>
        )}

        {outcome?.ok !== true && (
          <Button className="mt-5 w-full" disabled={busy} onClick={() => start.mutate()}>
            {start.isPending || (waiting && sameTab())
              ? 'Opening PayPal…'
              : waiting
                ? 'Waiting for PayPal…'
                : outcome
                  ? 'Try again'
                  : 'Continue with PayPal'}
          </Button>
        )}

        {waiting && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-caption text-[var(--color-content-subtle)]">
            <Loader2 size={12} className="animate-spin" />
            {sameTab()
              ? "Taking you to PayPal — you'll come straight back here."
              : 'Finish signing in to PayPal in the window that opened.'}
          </p>
        )}

        {start.isError && (
          <p className="mt-3 text-center text-caption text-[var(--color-danger-500)]">
            {start.error instanceof Error
              ? start.error.message
              : "Couldn't start PayPal sign-in."}
          </p>
        )}

        {/* PayPal's own answer about whether money can reach this account —
            the one thing a typed address can never tell us, and the whole
            reason this flow exists. */}
        {outcome?.ok === true && (
          <div className="mt-5 flex items-start gap-2 rounded-[var(--radius-control)] bg-[var(--color-surface-sunken)] px-3 py-2.5">
            {outcome.status === 'ready' ? (
              <CheckCircle2
                size={15}
                className="mt-0.5 shrink-0 text-[var(--color-accent-on)]"
              />
            ) : (
              <AlertTriangle
                size={15}
                className="mt-0.5 shrink-0 text-[var(--color-warn-500)]"
              />
            )}
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-[var(--color-content)]">
                {outcome.status === 'ready'
                  ? 'PayPal connected'
                  : "Connected — but PayPal can't pay it yet"}
              </p>
              <p className="mt-0.5 text-caption text-[var(--color-content-muted)]">
                {outcome.status === 'ready'
                  ? `${outcome.email ?? 'Your account'} is ready to receive payouts.`
                  : outcome.status === 'unverified_paypal_account'
                    ? "PayPal says this account isn't verified. Confirm your email with PayPal and connect again — until then a payment would sit unclaimed for 30 days and come back."
                    : "PayPal didn't say whether this account can receive payments, so we've left it unverified."}
              </p>
            </div>
          </div>
        )}

        {outcome?.ok === false && (
          <p className="mt-3 text-center text-caption text-[var(--color-danger-500)]">
            {outcome.message}
          </p>
        )}

        <Button
          variant={outcome?.ok === true ? 'primary' : 'ghost'}
          className="mt-3 w-full"
          onClick={onClose}
        >
          {outcome?.ok === true ? 'Done' : 'Cancel'}
        </Button>
      </div>
    </Modal>
  );
}

export type PayPalConnectOutcome =
  | { ok: true; email: string | null; status: 'ready' | 'unverified_paypal_account' | 'unknown' }
  | { ok: false; message: string };
