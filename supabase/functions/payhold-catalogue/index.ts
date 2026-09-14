// AutoHire — payhold-catalogue Edge Function.
//
// The country + currency catalogue, for callers who have no account yet.
//
// `payhold-payment-options` answers this question already, but only for a
// signed-in caller: it reads the Authorization header as a user JWT and
// `admin.auth.getUser(token)` 401s on anything else. That is a deliberate
// choice there — the bulk list carries `can_collect` / `can_payout` /
// `restricted` per country, which is PayHold's commercial footprint, and there
// was no reason to hand it to strangers.
//
// Then /signup started asking the same question. A visitor picking their
// country has, by definition, no session, so every load of the signed-out page
// got a 401, `country.tsx` swallowed it, and the picker fell back to
// FALLBACK_COUNTRIES — Rwanda, UAE, China, United States. Four countries, in a
// repo whose entire payout story is that AutoHire stopped guessing which
// markets exist; a host in Nairobi or Lisbon was told at the door that their
// country is not a place AutoHire goes, and only found out otherwise if they
// signed up anyway.
//
// So this is a second, narrower door onto the same data rather than a change to
// the first one. `payhold-payment-options` is untouched — its auth, its
// response and its per-country/`collect_country` branches all still gate on a
// session, because those genuinely are decisions about a particular host's
// money. What is served here is only the catalogue: the list of countries and
// the list of currencies. No seller, no balance, no route, no `rails_verified`
// (which says whether PayHold's providers are still in test mode — an
// operational fact about this tenant, not a fact about the world, and nothing a
// visitor's country picker needs).
//
// AUTH: there is deliberately no `auth.getUser()` here, and deliberately no
// `verify_jwt = false` in config.toml either. The gateway's JWT check stays ON
// and is satisfied by the app's *anon* key, which supabase-js already sends as
// the Authorization header when nobody is signed in. That is the whole trick:
// "anonymous visitor" and "unauthenticated request" are not the same thing, so
// the function needs no exemption and a plain deploy is the correct deploy.
// Turning the gateway check off would open this to the open internet for no
// gain and would have to be remembered on every redeploy.
//
// Routes
//   GET /payhold-catalogue    { countries, currencies }
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-catalogue

import { payholdConfigured, paymentOptions, type PaymentOptions } from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/**
 * `cacheSeconds = 0` says **no-store**, not "say nothing" — the same rule as in
 * `payhold-payment-options`. A 200 with no `Cache-Control` may be cached
 * heuristically for an unknown length, which is the one thing the error and
 * stale paths below must not be.
 *
 * `public` rather than `private`, unlike its sibling: this reply is identical
 * for every caller and is not derived from anyone's session, so a shared cache
 * holding one copy is correct rather than a leak. That is only true because of
 * what this function refuses to return — the moment anything per-user appears
 * in the body, this has to go back to `private`.
 */
function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store',
    },
  });
}

/**
 * One in-memory copy per warm instance.
 *
 * Corridors open and close on the timescale of licensing deals, not requests,
 * and this is now on the path of a *signed-out* page — every visitor who so
 * much as lands on /signup asks for the same 198 rows. An hour is short enough
 * that a newly opened corridor appears the same day, and nothing here gates a
 * money decision: the payout route, which does, is still behind the session in
 * `payhold-payment-options` and is cached for a minute there for that reason.
 */
const TTL_MS = 60 * 60 * 1000;
let cached: { at: number; value: PaymentOptions } | null = null;

/**
 * Catalogue fields only, named one at a time.
 *
 * Written as an explicit pick rather than a spread-and-delete because this is
 * the function's entire security boundary: a spread would forward whatever
 * `paymentOptions()` grows next straight to anonymous callers, and the first
 * person to learn that PayHold added a field to `/payment-options` would be a
 * stranger reading it here.
 */
function catalogue(options: PaymentOptions) {
  return { countries: options.countries, currencies: options.currencies };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    if (!payholdConfigured()) {
      return json({ error: 'PayHold is not configured.', code: 'not_configured' }, 503);
    }

    if (cached && Date.now() - cached.at < TTL_MS) {
      return json({ ...catalogue(cached.value), served_from: 'memory' }, 200, 3600);
    }

    const options = await paymentOptions();
    cached = { at: Date.now(), value: options };

    return json({ ...catalogue(options), served_from: 'payhold' }, 200, 3600);
  } catch (e) {
    // A stale copy beats no answer: the caller's fallback for "no answer" is a
    // four-country hardcoded list, which is the exact behaviour this function
    // exists to remove. Not cached downstream, though — a stale body is served
    // because it is better than nothing right now, not because it is true.
    if (cached) {
      return json({ ...catalogue(cached.value), served_from: 'memory', stale: true }, 200);
    }
    const message = e instanceof Error ? e.message : 'Could not reach PayHold.';
    return json({ error: message }, 502);
  }
});
