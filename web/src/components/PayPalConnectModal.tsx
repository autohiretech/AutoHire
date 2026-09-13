import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { client } from '@/lib/client';
import { Button, Modal } from '@/components/ui';
import { PayPalMark } from '@/components/PaymentBrands';

/**
 * Connecting a PayPal account, without ever leaving the app.
 *
 * **Why a modal rather than the inline card this replaces.** A host setting up
 * payouts used to press a button on the form and have a window to paypal.com
 * appear over it with no explanation, while the page behind carried on looking
 * like a form they had not finished. `CheckoutModal` puts PayPal inside a
 * surface that says what is about to happen; this is that, for the other side
 * of the money.
 *
 * **There is no popup, on any device, and that is the decision this file
 * exists to hold.** The first version opened PayPal in a second window — the
 * shape checkout uses — and it was wrong here twice over. On a phone or in the
 * installed PWA a popup is refused, or opens as a separate browser the app
 * never hears back from. And on a desktop it is still a separate window: the
 * host signs in to PayPal *outside* AutoHire and is left to find their own way
 * back, which is exactly what the product owner said they were trying to
 * avoid. PayPal cannot be framed either — a wallet login inside somebody
 * else's iframe is the shape of a phishing page, and they refuse it rightly —
 * so the one honest way for this to stay inside the app is the one PayPal
 * documents as `fullPage=true`: this tab goes to PayPal's page, and PayPal
 * sends this same tab back to `/payouts/paypal/return`, which lands the host
 * on their payout settings with the answer. `PayoutSetupPage` reads it through
 * `PAYPAL_CONNECT_HANDOFF` on mount.
 *
 * **PayPal's current documentation builds this flow as a URL, not a button
 * script.** Checkout has a Buttons SDK; Log in with PayPal's `api.js` +
 * `paypal.use(['login'])` is the deprecated checkout.js generation, and the
 * live reference describes assembling the authorization URL that
 * `PayPalProvider.loginUrl` assembles server-side. So the button below is ours.
 */
export const PAYPAL_CONNECT_HANDOFF = 'paypalConnectOutcome';

export function PayPalConnectModal({
  open,
  onClose,
  outcome = null,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * What the last round trip came back with, when the screen underneath has
   * one to show. The modal itself never sees a result arrive: the tab leaves
   * for PayPal, and the result lands on the payout screen, not here.
   */
  outcome?: PayPalConnectOutcome | null;
}) {
  const [environment, setEnvironment] = useState<'sandbox' | 'live' | null>(null);
  const [leaving, setLeaving] = useState(false);

  // A fresh open is a fresh attempt.
  useEffect(() => {
    if (!open) return;
    setLeaving(false);
  }, [open]);

  const start = useMutation({
    mutationFn: () => client.startPayPalConnect(),
    onSuccess: ({ url, state, environment: env }) => {
      // Checked by the return page. A callback that does not check it accepts
      // a code from anywhere.
      sessionStorage.setItem('paypalConnectState', state);
      setEnvironment(env);
      setLeaving(true);
      // The whole app goes, and comes back. Not `window.open` — see the header.
      window.location.assign(url);
    },
  });

  const busy = start.isPending || leaving;

  return (
    <Modal open={open} onClose={onClose} title="Connect PayPal">
      <div className="py-1">
        <div className="flex items-center justify-center">
          <PayPalMark />
        </div>

        <p className="mt-4 text-center text-body-sm text-[var(--color-content-muted)]">
          Sign in to PayPal once and we'll ask PayPal directly whether your account can
          receive payouts — rather than finding out after a payment sits unclaimed for
          thirty days. You'll come straight back here when you're done.
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
            {busy ? 'Taking you to PayPal…' : outcome ? 'Try again' : 'Continue with PayPal'}
          </Button>
        )}

        {leaving && (
          <p className="mt-3 flex items-center justify-center gap-1.5 text-caption text-[var(--color-content-subtle)]">
            <Loader2 size={12} className="animate-spin" />
            Opening PayPal in this tab — you'll be brought back to your payout settings.
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
            reason this flow exists. Shown here when the screen underneath
            reopened the modal with one, e.g. to connect a different account. */}
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
