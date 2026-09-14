// AutoHire — check-account-availability Edge Function.
//
// Answers one question, for the sign-up form only: does an account already
// exist with this email, or this phone number?
//
// **Why it has to be server-side.** `profiles` is RLS-protected — an
// anonymous browser reads nothing from it, which is correct and must stay
// true. So the check cannot be done in the page; it needs a function holding
// the service-role key that answers a strictly yes/no question and returns
// nothing else about whoever owns the address.
//
// **What this costs, stated plainly.** An endpoint that says whether an
// address has an account is a user-enumeration oracle: someone can ask it
// about addresses that aren't theirs. That is the deliberate trade for
// telling a person their email is taken *while they type it* instead of after
// they have filled in three stages. The mitigations are what keep it narrow:
//
//   - Hard per-IP rate limit (RATE_LIMIT per RATE_WINDOW_SECONDS), via the
//     same `rate_limit_hit` RPC the AI agent uses. Bulk enumeration is the
//     thing being priced out; one person checking their own address is not.
//   - The response is a boolean per field. No name, no id, no "when", no
//     partial match, no "did you mean" — nothing that turns a hit into a
//     profile.
//   - One address per field per call. No arrays, so a single request cannot
//     sweep a list.
//
// Deploy:  supabase functions deploy check-account-availability
//   JWT verification stays ON at the gateway — the anon key the web client
//   already sends satisfies it. This does NOT need --no-verify-jwt.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/** Per IP. Generous for a person filling in one form, useless for a sweep. */
const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 600;

/** The caller's address, as the platform's proxy reports it. */
function callerIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  return forwarded.split(',')[0]?.trim() || 'unknown';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Not configured.' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: allowed, error: rateErr } = await admin.rpc('rate_limit_hit', {
    p_key: `availability:${callerIp(req)}`,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  // Fails CLOSED, unlike the AI agent's throttle: there, refusing a signed-in
  // user's request over a throttle hiccup is worse than letting it through.
  // Here the thing being protected from a broken limiter is everyone's
  // addresses, and the cost of failing closed is that the form falls back to
  // checking at submit — which it does anyway.
  if (rateErr) {
    console.error('check-account-availability rate_limit_hit error (failing closed)', rateErr);
    return json({ error: 'Unavailable.' }, 503);
  }
  if (allowed === false) return json({ error: 'Too many requests.' }, 429);

  const body = (await req.json().catch(() => ({}))) as { email?: unknown; phone?: unknown };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (!email && !phone) return json({ error: 'An email or phone is required.' }, 400);

  // Shape checks before touching the database: an email needs an `@`, a phone
  // must already be E.164 (the client normalises with libphonenumber before
  // asking). Anything else is a malformed request, not a free lookup.
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ error: 'That is not an email address.' }, 400);
  }
  if (phone && !/^\+\d{8,15}$/.test(phone)) {
    return json({ error: 'That is not an E.164 phone number.' }, 400);
  }

  // `auth.users`, not `profiles`. A profile row is only written on the first
  // authenticated page load, so asking `profiles` reported "free" for an
  // account that existed and was signed in elsewhere at that moment — which
  // is how this was found. Migration 096's SECURITY DEFINER functions reach
  // the authoritative table; they are granted to `service_role` alone, so
  // this function is the only way to ask and the per-IP limit above is not
  // something a caller can step around by hitting the RPC directly.
  const result: { email: boolean | null; phone: boolean | null } = { email: null, phone: null };

  if (email) {
    const { data, error } = await admin.rpc('account_exists_for_email', { p_email: email });
    if (error) {
      console.error('availability email lookup failed', error);
      return json({ error: 'Unavailable.' }, 503);
    }
    result.email = data === true;
  }

  if (phone) {
    const { data, error } = await admin.rpc('account_exists_for_phone', { p_phone: phone });
    if (error) {
      console.error('availability phone lookup failed', error);
      return json({ error: 'Unavailable.' }, 503);
    }
    result.phone = data === true;
  }

  return json(result, 200);
});
