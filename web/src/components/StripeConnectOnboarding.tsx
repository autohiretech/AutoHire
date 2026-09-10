import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadConnectAndInitialize } from '@stripe/connect-js';
import {
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
} from '@stripe/react-connect-js';

import { client } from '@/lib/client';
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
 * **The Stripe sign-in popup is expected.** These are Express accounts, which
 * is a deliberate choice: suppressing that popup requires
 * `disable_stripe_user_authentication`, which is only available where
 * `controller.requirement_collection` is `application`, and that moves
 * negative-balance liability onto PayHold and is irreversible per account. So
 * one popup during first-time setup is the design, and the copy below says so
 * rather than letting it read as something going wrong.
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

  // One session up front, only to learn the publishable key — `loadConnectAndInitialize`
  // needs it before it can ask for a secret of its own. The secret from this
  // call is deliberately discarded rather than threaded into the first
  // `fetchClientSecret`, because a secret held across a render is a secret
  // that can be handed back twice.
  useEffect(() => {
    let cancelled = false;
    client
      .payholdConnectSession()
      .then(({ publishableKey: key }: { publishableKey: string }) => {
        if (!cancelled) setPublishableKey(key);
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
      return loadConnectAndInitialize({ publishableKey, fetchClientSecret });
    } catch {
      // Stripe's own docs rule embedded components out inside mobile and
      // desktop webviews, and AutoHire ships as a PWA — so this is a real
      // environment rather than a defensive branch, and the honest answer is
      // the hosted page rather than an error.
      return null;
    }
  }, [publishableKey, fetchClientSecret]);

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
      {/* Said before it happens, not after. An unexplained Stripe popup in the
          middle of entering bank details reads as something going wrong. */}
      <p className="text-caption text-[var(--color-content-muted)]">
        Near the end, Stripe opens its own window to text you a code and confirm
        it's you. That step belongs to Stripe and can't happen in here — finish
        it and you'll come straight back. Your details go to them, never
        through us.
      </p>
      <ConnectComponentsProvider connectInstance={connectInstance}>
        <ConnectAccountOnboarding onExit={onExit} />
      </ConnectComponentsProvider>
      <Button variant="outline" className="w-full" onClick={onFallback}>
        Continue on Stripe's page instead
      </Button>
    </div>
  );
}
