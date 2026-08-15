// AutoHire — payhold-payment-options Edge Function.
//
// Where money can go, according to PayHold rather than according to us.
//
// `payoutMethodsFor` in the web app decided this from `FLUTTERWAVE_COUNTRIES`,
// eight country codes typed into a constant. That list was wrong in both
// directions at once:
//
//   • It offered Bank and Card to every host outside those eight. PayHold
//     settles all of those through Stripe and wants an `acct_…` from Connect
//     onboarding, so a host in Dubai or San Francisco picked a method, typed
//     their account number, and got a 422 — with their cars unbookable until
//     they did something no screen was able to offer them.
//
//   • It withheld payouts from ~60 countries PayHold does reach. Kenya, Nigeria
//     and Ghana were in the constant; Egypt, Senegal, Zambia and most of the EU
//     were not, and a host there was told their market was unsupported when it
//     was not.
//
// So the list stops being ours. This proxies PayHold's `payment-options`, which
// carries `can_collect` / `can_payout` / `restricted` per country and is the
// same table its routing decisions are made from.
//
// The bulk list only answers "can this country be paid at all" — it does not
// say which methods work inside a payable one, and the same local guess used
// to fill that gap: PayPal, Venmo, Cash App, Alipay and WeChat Pay offered as
// payout methods everywhere those brands are known, none of which PayHold can
// actually pay out to today, and Card offered in Flutterwave's African
// corridors, where Stripe cannot reach a recipient and Flutterwave has no card
// payout at all. `?country=` proxies PayHold's per-country `payout_country`
// route instead, which is the same decision `route_payout` itself would reach
// — see `payoutRouteFor` in `_shared/payhold.ts`.
//
// It is a proxy rather than a direct browser call because `PAYHOLD_API_KEY` is
// a server secret; the browser must never hold it. Nothing here is per-user, so
// one cached copy serves every host — a cache per country for `?country=`,
// since that answer varies by the question.
//
// Routes
//   GET /payhold-payment-options              every country PayHold knows,
//                                              with what it can do there
//   GET /payhold-payment-options?country=RW   that one country's actual
//                                              payout route and methods
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-payment-options

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  payholdConfigured,
  paymentOptions,
  payoutRouteFor,
  type PaymentOptions,
  type PayoutCountryRoute,
} from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      ...(cacheSeconds ? { 'Cache-Control': `private, max-age=${cacheSeconds}` } : {}),
    },
  });
}

/**
 * One in-memory copy per warm instance.
 *
 * Corridors open and close on the timescale of licensing deals, not requests,
 * and every host loading the payout screen would otherwise be a round trip to
 * PayHold for the same 198 rows. An hour is short enough that a newly opened
 * corridor appears the same day and long enough that this is effectively free.
 */
const TTL_MS = 60 * 60 * 1000;
let cached: { at: number; value: PaymentOptions } | null = null;

/**
 * Per-country payout route, keyed on the code. Same TTL and same reasoning as
 * the bulk cache above, just one entry per country instead of one for
 * everything — the payout-setup screen only ever asks about the signed-in
 * host's own country, so this stays small in practice.
 */
const routeCache = new Map<string, { at: number; value: PayoutCountryRoute }>();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!payholdConfigured()) {
      return json({ error: 'PayHold is not configured.', code: 'not_configured' }, 503);
    }

    // Signed-in callers only. This is not personal data, but it is PayHold's
    // commercial footprint — which corridors it has bought — and there is no
    // reason to serve it to anyone who has not signed up.
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Missing authorization token.' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);

    // One country's payout route — which methods it actually offers, not just
    // whether the country can be paid at all. Separate from the bulk list
    // below: `?country=` asks a different, more specific question.
    const country = new URL(req.url).searchParams.get('country');
    if (country) {
      const key = country.toUpperCase();
      const entry = routeCache.get(key);
      if (entry && Date.now() - entry.at < TTL_MS) {
        return json({ ...entry.value, cached: true }, 200, 3600);
      }
      try {
        const route = await payoutRouteFor(key);
        routeCache.set(key, { at: Date.now(), value: route });
        return json({ ...route, cached: false }, 200, 3600);
      } catch (e) {
        if (entry) return json({ ...entry.value, cached: true, stale: true }, 200);
        const message = e instanceof Error ? e.message : 'Could not reach PayHold.';
        return json({ error: message }, 502);
      }
    }

    if (cached && Date.now() - cached.at < TTL_MS) {
      return json({ ...cached.value, cached: true }, 200, 3600);
    }

    const options = await paymentOptions();
    cached = { at: Date.now(), value: options };

    return json({ ...options, cached: false }, 200, 3600);
  } catch (e) {
    // A stale copy beats no answer: without this the payout screen has to fall
    // back to guessing, which is the behaviour this function exists to remove.
    if (cached) {
      return json({ ...cached.value, cached: true, stale: true }, 200);
    }
    const message = e instanceof Error ? e.message : 'Could not reach PayHold.';
    return json({ error: message }, 502);
  }
});
