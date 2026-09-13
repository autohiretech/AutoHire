import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from '@stripe/react-connect-js';
import type { LoadError, StepChange } from '@stripe/connect-js';

import { client } from '@/lib/client';
import { stripeConnectAppearance, STRIPE_CONNECT_FONTS } from '@/lib/stripeAppearance';
import { useMatchMedia } from '@/lib/useVisualViewport';
import { Button, Notice, Spinner } from '@/components/ui';

/**
 * Stripe Connect onboarding, mounted inside AutoHire instead of on Stripe's
 * hosted page.
 *
 * The rail is unchanged — this collects the same KYC and bank details, against
 * the same Express account, and finishes in the same place. What changes is
 * that a host setting up payouts stops being sent to `connect.stripe.com` and
 * back, which is the last place in the payout flow that left the app.
 *
 * ## Three things that are easy to get wrong here
 *
 * **The client secret must be re-minted on every call.** `fetchClientSecret`
 * is not a one-time initialiser: Connect.js calls it again whenever a session
 * expires part-way through, and returning a remembered secret at that point
 * leaves the host stuck on whatever step they had reached — typically the one
 * where they are entering bank details, which is the worst place to be stuck
 * and the least likely to be reported as a bug rather than abandoned. So this
 * POSTs every time and deliberately keeps nothing.
 *
 * **The publishable key comes from the response.** It is the tenant's own key,
 * it is not a secret, and hardcoding it would mean a rebuild whenever the
 * account behind it changes — the same "never keep a copy of somebody else's
 * data" failure that the payout table has been punished for twice today.
 *
 * **The Stripe sign-in popup depends on the account, and is no longer the
 * default.** PayHold now mints accounts whose requirements it collects itself,
 * which is the only configuration where Stripe permits
 * `disable_stripe_user_authentication` — so for those, onboarding finishes
 * here, code step included. Accounts created before that are Express and still
 * get the window: `controller.stripe_dashboard.type` is fixed when an account
 * is created and there is no migrating an existing one. PayHold answers which
 * kind this is on the session, and the copy below follows that answer rather
 * than assuming either way. It assumes the window when nobody has said,
 * because bracing a host for an interruption that does not come is a much
 * smaller failure than the reverse.
 *
 * ## What this is not
 *
 * It is not evidence of completion. A host can close the modal at any point
 * and Stripe says nothing by their leaving, so `/connect/status` polling
 * remains the only thing that promotes a destination — exactly as it does for
 * the hosted page. `onExit` refreshes and hands back; it never reports success.
 */
export function StripeConnectOnboarding({
  onExit,
  onFallback,
}: {
  /** Fired when the host leaves onboarding, finished or not. Never a success signal. */
  onExit: () => void;
  /** Offered when the component cannot mount at all — see the webview note below. */
  onFallback: () => void;
}) {
  const [failed, setFailed] = useState<string | null>(null);

  // Re-POSTs on every call, by design. See the header.
  const fetchClientSecret = useCallback(async () => {
    const { clientSecret } = await client.payholdConnectSession();
    return clientSecret;
  }, []);

  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  /**
   * Whether Stripe still interrupts with its own window near the end.
   *
   * Starts true, because that is the truthful default for an account we have
   * not asked about yet and for any older PayHold that does not answer. It
   * only ever becomes false on a real answer.
   */
  const [authPopup, setAuthPopup] = useState(true);
  /**
   * Whether Stripe's iframe has actually put something on the screen.
   *
   * Mounting the component is not the same as the host seeing a form, and the
   * gap between them is a dialog with two sentences, a way out, and nothing to
   * fill in — which reads as "there is nothing here" rather than "this is
   * still loading". `onStepChange` fires when Stripe enters a step, including
   * the first, so it is the earliest honest signal that the form exists.
   */
  const [painted, setPainted] = useState(false);

  // One session up front, only to learn the publishable key — `loadConnectAndInitialize`
  // needs it before it can ask for a secret of its own. The secret from this
  // call is deliberately discarded rather than threaded into the first
  // `fetchClientSecret`, because a secret held across a render is a secret
  // that can be handed back twice.
  useEffect(() => {
    let cancelled = false;
    client
      .payholdConnectSession()
      .then(({ publishableKey: key, authPopup: popup }) => {
        if (cancelled) return;
        setPublishableKey(key);
        setAuthPopup(popup);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setFailed(
            e instanceof Error && e.message
              ? e.message
              : "Couldn't start Stripe onboarding.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectInstance = useMemo(() => {
    if (!publishableKey) return null;
    try {
      return loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret,
        // Read at mount from the live theme — see `stripeAppearance`. Not in
        // the dependency list: a theme change updates the instance below
        // rather than building a second one, because re-initialising throws
        // the half-finished form away along with it.
        appearance: stripeConnectAppearance(),
        fonts: STRIPE_CONNECT_FONTS,
      });
    } catch {
      // Stripe's own docs rule embedded components out inside mobile and
      // desktop webviews, and AutoHire ships as a PWA — so this is a real
      // environment rather than a defensive branch, and the honest answer is
      // the hosted page rather than an error.
      return null;
    }
  }, [publishableKey, fetchClientSecret]);

  // The OS theme can change while the form is open — at sunset, on a phone
  // that schedules it — and Stripe's iframe does not hear `prefers-color-scheme`
  // on our behalf. `update` re-themes in place; re-initialising would discard
  // whatever the host had typed.
  const dark = useMatchMedia('(prefers-color-scheme: dark)');
  useEffect(() => {
    if (!connectInstance) return;
    connectInstance.update({ appearance: stripeConnectAppearance() });
  }, [connectInstance, dark]);

  if (failed) {
    return (
      <div className="space-y-3">
        <Notice tone="warn">{failed}</Notice>
        <Button variant="outline" className="w-full" onClick={onFallback}>
          Continue on Stripe's page instead
        </Button>
      </div>
    );
  }

  if (!connectInstance) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
        {/* Offered rather than waited for. If the component is never going to
            mount — a webview, a blocked script — a host staring at a spinner
            has no way to know that, and the hosted page still works. */}
        <Button variant="outline" className="w-full" onClick={onFallback}>
          Having trouble? Continue on Stripe's page
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Said before it happens, not after — but only where it happens. An
          unexplained Stripe window mid-way through entering bank details reads
          as something going wrong; a warning about a window that never opens
          is its own small lie, and it is the one a host remembers when they
          were braced for an interruption that never came. PayHold says which
          kind of account this is; see `authPopup`. */}
      {authPopup ? (
        <p className="text-caption text-[var(--color-content-muted)]">
          Near the end, Stripe opens its own window to text you a code and
          confirm it's you. That step belongs to Stripe and can't happen in
          here — finish it and you'll come straight back. Your details go to
          them, never through us.
        </p>
      ) : (
        <p className="text-caption text-[var(--color-content-muted)]">
          This all happens here — you won't be sent to another site. Your
          details go straight to Stripe, never through us.
        </p>
      )}
      {/* Reserves the height the form will take, so the dialog does not open
          collapsed and then jump to full size once Stripe paints — and so the
          spinner has somewhere to be. Stripe's own background is opaque (see
          `colorBackground` in `stripeAppearance`), so the form covers this the
          moment it exists, whether or not `onStepChange` ever fires. */}
      <div className="relative min-h-[20rem]">
        {!painted && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </div>
        )}
        <ConnectComponentsProvider connectInstance={connectInstance}>
          <ConnectAccountOnboarding
            onExit={onExit}
            onStepChange={(_: StepChange) => setPainted(true)}
            // **A load failure has to say so.** Without this, Stripe failing
            // to load is indistinguishable from Stripe having nothing to ask:
            // the same dialog, the same two sentences, no form and no error.
            // The host's only clue was the button offering them a way out of
            // something they could not see going wrong.
            onLoadError={({ error }: LoadError) =>
              setFailed(error?.message || "Stripe's onboarding couldn't load.")
            }
          />
        </ConnectComponentsProvider>
      </div>
      <Button variant="outline" className="w-full" onClick={onFallback}>
        Continue on Stripe's page instead
      </Button>
    </div>
  );
}
