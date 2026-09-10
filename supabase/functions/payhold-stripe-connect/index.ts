// AutoHire — payhold-stripe-connect Edge Function.
//
// The missing half of payout setup outside Flutterwave's African corridors.
// `payoutProviderFor` has always routed bank/card there to `stripe_connect`,
// but that rail's destination is a connected account id (acct_…) minted by
// Stripe's own hosted onboarding — not a number a host can type into a form.
// This starts that onboarding and, once Stripe reports it finished, asks
// PayHold to promote the resulting account into a real payout destination.
//
// GET  ?action=status  poll after the host returns from Stripe's page
// POST                 start (or resume) onboarding; returns a redirect URL
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-stripe-connect

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  connectOnboardingStatus,
  payholdConfigured,
  sellerCapabilities,
  startConnectOnboarding,
} from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const siteUrl = () => Deno.env.get('ALLOWED_ORIGIN') ?? 'https://autohiretech.pages.dev';

/** Same mask fallback `payhold-register-seller` uses when PayHold sends none. */
function mask(destination: string): string {
  const trimmed = destination.replace(/\s+/g, '');
  return `••••${trimmed.slice(-4)}`;
}

async function writeDestination(
  admin: SupabaseClient,
  uid: string,
  sellerId: string,
  maskedDestination: string,
): Promise<void> {
  await admin
    .from('profiles')
    .update({
      payout_method: 'bank',
      payout_provider: 'payhold',
      payout_destination: maskedDestination,
      payout_label: `Bank account · ${maskedDestination}`,
      // Same as every other destination change: PayHold has not verified this
      // one yet, and a profile still saying 'active' would tell the host their
      // money is on its way to an account nothing has checked.
      payout_status: 'pending',
    })
    .eq('id', uid);

  const caps = await sellerCapabilities(sellerId).catch(() => null);
  if (caps?.can_receive_payouts) {
    await admin.from('profiles').update({ payout_status: 'active' }).eq('id', uid);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!payholdConfigured()) {
      return json({ error: 'PayHold is not configured.', code: 'not_configured' }, 503);
    }

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Missing authorization token.' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);
    const uid = userData.user.id;

    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, country, payhold_seller_id')
      .eq('id', uid)
      .single();

    if (profile?.role !== 'owner') {
      return json({ error: 'Only host accounts receive payouts.' }, 403);
    }
    if (!profile.payhold_seller_id) {
      // Should not happen once `payhold-ensure-seller` has run at role toggle,
      // but this function must not be the one to register a seller from
      // nothing — that door stays `payhold-register-seller`'s alone.
      return json(
        {
          error: 'Set up your host account before connecting a payout method.',
          code: 'no_seller',
        },
        409,
      );
    }
    const sellerId = String(profile.payhold_seller_id);
    const returnUrl = `${siteUrl()}/payouts/stripe-connect/return`;

    if (req.method === 'GET') {
      const result = await connectOnboardingStatus(sellerId);

      if (result.status === 'connected') {
        await writeDestination(admin, uid, sellerId, result.destination.masked_destination);
      }

      return json(result, 200);
    }

    if (req.method === 'POST') {
      if (!profile.country) {
        return json(
          { error: 'Set your country before connecting a payout method.', code: 'country_required' },
          400,
        );
      }
      const started = await startConnectOnboarding(sellerId, {
        returnUrl,
        // Stripe's own link expires; sending the host back to the same route
        // re-triggers a POST from the page, which mints a fresh link against
        // the same in-progress account rather than a new one.
        refreshUrl: returnUrl,
        country: String(profile.country).toUpperCase(),
      });
      return json(started, 200);
    }

    return json({ error: `${req.method} not supported.` }, 405);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    const message = e instanceof Error ? e.message : String(e);

    // A platform-configuration failure is not the host's error, and until now
    // it was handed to them verbatim. Stripe refuses account creation with
    // "You can only create new accounts if you've signed up for Connect, which
    // you can do at https://dashboard.stripe.com/connect" when Connect is not
    // enabled on PayHold's own Stripe account — so a car owner in the US, who
    // has no relationship with that account and cannot see that dashboard, was
    // told to go configure it. It also names an internal dependency the host
    // has no reason to know exists.
    //
    // The distinction that matters: nothing the host does — retrying, a
    // different bank, a different card — changes this, so an error inviting
    // them to try again would be a lie. What IS true is that their money is
    // safe and accruing, which is the thing they actually want to know.
    // Operators get the real cause in the logs, where it can be acted on.
    //
    // **It must not say "in your country".** It said exactly that, and the
    // first person to read it was a host in the United States — the single
    // best-supported Stripe country there is, and one of the 44 this refusal
    // hits identically. Blaming the market for a switch on our own account
    // sends the one person who cannot fix it looking for a reason that does
    // not exist, and would read as "we don't serve you" to every host in
    // every one of those countries.
    if (/signed up for Connect|Connect.*not (enabled|activated)|platform.*not.*onboard/i.test(message)) {
      console.error(
        'stripe connect onboarding refused — Connect is not enabled on the platform Stripe account. ' +
          'Enable it at https://dashboard.stripe.com/connect; no host can complete Stripe payout ' +
          `setup in any of the 44 Stripe countries until then. Upstream: ${message}`,
      );
      return json(
        {
          error:
            "Card payouts aren't switched on yet — this is on us, not something " +
            'you can fix, and it is not about where you are. Your earnings keep ' +
            "building up in the meantime and nothing is lost; we'll let you know " +
            "the moment it's ready.",
          code: 'payouts_not_enabled',
        },
        503,
      );
    }

    return json({ error: message }, status);
  }
});
