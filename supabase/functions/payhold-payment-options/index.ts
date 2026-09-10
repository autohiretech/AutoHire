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
//                                              payout route and methods, plus
//                                              the mobile-money networks a
//                                              destination there may name
//   GET …?country=RW&banks=1                  the same, with the bank list —
//                                              opt-in because it is a live
//                                              call into the rail on PayHold's
//                                              side, and only a host who has
//                                              picked Bank needs it
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-payment-options

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  collectionOptionsFor,
  payholdConfigured,
  paymentOptions,
  payoutRouteFor,
  type CollectionOptions,
  type PaymentOptions,
  type PayoutCountryRoute,
} from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/**
 * `cacheSeconds = 0` now says **no-store**, not "say nothing".
 *
 * Omitting `Cache-Control` does not mean "do not cache" — a browser is free to
 * heuristically cache a 200 that says nothing, so the quiet default was a
 * cache of unknown length on exactly the replies that must not have one (the
 * stale-fallback paths below, and now the payout route). Saying it explicitly
 * costs a header and removes the guesswork.
 */
function json(body: unknown, status: number, cacheSeconds = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': cacheSeconds ? `private, max-age=${cacheSeconds}` : 'no-store',
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
/**
 * The bulk catalogue: which countries exist and what is possible in them. A
 * list, read to render a list, and it changes when provider coverage changes
 * — an hour old is fine.
 */
const TTL_MS = 60 * 60 * 1000;

/**
 * Everything that gates a money decision, which is a different question.
 *
 * `?country=` (a host's payout route) and `?collect_country=` (what a renter
 * can be charged in) are not catalogue reads: the first decides whether a
 * payout form is even offered, and the answer to it is what stands between a
 * host and tokenizing a destination nobody can pay. An hour of that is an hour
 * in which PayHold can close a corridor and this screen keeps saying yes.
 *
 * That is not hypothetical — PayHold's `payment-options` began failing closed
 * on corridors with no route row on 2026-09-09, and until that moment this
 * endpoint had been answering `blocked: false` for ~46 countries whose payouts
 * would all have been refused. A cache is exactly how such a fix fails to
 * arrive.
 *
 * A minute still collapses the burst that matters — a host opening the payout
 * screen and the form re-asking as they pick a method — without holding an
 * answer long enough to act on after it stops being true.
 */
const ROUTE_TTL_MS = 60 * 1000;
let cached: { at: number; value: PaymentOptions } | null = null;

/**
 * Per-country payout route, keyed on the code. Same TTL and same reasoning as
 * the bulk cache above, just one entry per country instead of one for
 * everything — the payout-setup screen only ever asks about the signed-in
 * host's own country, so this stays small in practice.
 *
 * The bank list is part of the key (`RW` vs `RW+banks`) rather than of the
 * value: a route fetched without banks carries `banks: null`, which means "not
 * asked" and not "none", so serving it to a caller that did ask would show a
 * host an empty bank picker for a country full of banks.
 */
const routeCache = new Map<string, { at: number; value: PayoutCountryRoute }>();

/**
 * The collection side, keyed the same way. A different question from
 * `routeCache` above and deliberately a different map: that one answers "how
 * would a host here be paid", this one "what can a renter here be charged", and
 * a single cache keyed on a bare country code would serve one as the other.
 */
const collectCache = new Map<string, { at: number; value: CollectionOptions }>();

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
    const params = new URL(req.url).searchParams;

    // What a renter in this market can be charged, and in which currencies.
    // PayHold's own answer rather than a guess assembled here: `currencies` is
    // every currency that market's rails take, intersected with the ones this
    // tenant has enabled, and neither half is knowable from AutoHire.
    const collectCountry = params.get('collect_country');
    if (collectCountry) {
      const key = collectCountry.toUpperCase();
      const entry = collectCache.get(key);
      if (entry && Date.now() - entry.at < ROUTE_TTL_MS) {
        return json({ ...entry.value, served_from: 'memory' }, 200, 0);
      }
      try {
        const options = await collectionOptionsFor(key);
        collectCache.set(key, { at: Date.now(), value: options });
        return json({ ...options, served_from: 'payhold' }, 200, 0);
      } catch (e) {
        // A stale answer beats none: the alternative is a checkout that cannot
        // offer a currency at all because PayHold blinked.
        if (entry) return json({ ...entry.value, served_from: 'memory', stale: true }, 200);
        const message = e instanceof Error ? e.message : 'Could not reach PayHold.';
        return json({ error: message }, 502);
      }
    }

    const country = params.get('country');
    if (country) {
      const banks = params.get('banks') === '1' || params.get('banks') === 'true';
      // The currency is part of the question, not a detail of it. PayPal's
      // eligibility is per (country, currency) — KE in KES routes mobile money
      // and KE in USD routes PayPal — so it has to be in the cache key too.
      // Keyed on country alone, a host asking about USD would have been handed
      // the KES answer from whoever asked first, and the difference is a
      // payout method appearing or vanishing for no visible reason.
      const currency = (params.get('payout_currency') ?? '').toUpperCase() || null;
      // Which absent currencies were asked about changes the answer, so it
      // changes the key too — otherwise a host who asked about their own
      // currency would be served an explanation list built for somebody else.
      const explain = (params.get('explain_currencies') ?? '')
        .split(',').map((c) => c.trim().toUpperCase()).filter(Boolean).sort();
      const key = [
        country.toUpperCase(),
        currency ?? 'default',
        explain.length > 0 ? explain.join('.') : 'explain-default',
        banks ? 'banks' : 'no-banks',
      ].join('+');
      const entry = routeCache.get(key);
      if (entry && Date.now() - entry.at < ROUTE_TTL_MS) {
        return json({ ...entry.value, served_from: 'memory' }, 200, 0);
      }
      try {
        const route = await payoutRouteFor(country.toUpperCase(), { banks, currency, explain });
        routeCache.set(key, { at: Date.now(), value: route });
        return json({ ...route, served_from: 'payhold' }, 200, 0);
      } catch (e) {
        if (entry) return json({ ...entry.value, served_from: 'memory', stale: true }, 200);
        const message = e instanceof Error ? e.message : 'Could not reach PayHold.';
        return json({ error: message }, 502);
      }
    }

    // The bulk catalogue, and the one branch that keeps the hour: it renders a
    // list of what is possible per country, nobody submits a form off it, and
    // one copy serves every host.
    if (cached && Date.now() - cached.at < TTL_MS) {
      return json({ ...cached.value, served_from: 'memory' }, 200, 3600);
    }

    const options = await paymentOptions();
    cached = { at: Date.now(), value: options };

    return json({ ...options, served_from: 'payhold' }, 200, 3600);
  } catch (e) {
    // A stale copy beats no answer: without this the payout screen has to fall
    // back to guessing, which is the behaviour this function exists to remove.
    if (cached) {
      return json({ ...cached.value, served_from: 'memory', stale: true }, 200);
    }
    const message = e instanceof Error ? e.message : 'Could not reach PayHold.';
    return json({ error: message }, 502);
  }
});
