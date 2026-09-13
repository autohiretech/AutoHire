// AutoHire — payhold-paypal-connect Edge Function.
//
// "Connect PayPal" instead of "type your PayPal address".
//
// The address field works and will stay, because most hosts know their email
// and nothing else. But a typed address is not evidence of anything: PayPal
// accepts a payout to an account whose email is unconfirmed, reports the batch
// a success, holds the item UNCLAIMED for thirty days and then hands the money
// back. On 2026-09-13 three payouts totalling USD 2,231.07 sat in exactly that
// state against two different addresses, both typed and both looking correct.
// Nothing in the form could have caught it.
//
// Signing in answers it up front. PayPal returns the host's `payer_id` — the
// identifier its own Payouts reference names — and `verified_account`, which
// says whether a payout can reach them at all. So the host clicks once, and
// AutoHire learns more than the form could ever ask for.
//
// POST                  start: returns PayPal's sign-in URL and a state
// POST ?action=complete finish: exchanges the code, writes the destination
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-paypal-connect

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  completePayPalConnect,
  payholdConfigured,
  startPayPalConnect,
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

/**
 * The one URL PayPal will redirect to, and it must match on both legs.
 *
 * PayPal validates the code against the exact `redirect_uri` it was issued
 * for, so this is computed in one place rather than passed in by the browser
 * — a caller that could name its own return URL could point the sign-in at a
 * page it controls.
 */
const returnUrl = () => `${siteUrl()}/payouts/paypal/return`;

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
      .select('id, role, payhold_seller_id')
      .eq('id', uid)
      .single();

    if (profile?.role !== 'owner') {
      return json({ error: 'Only host accounts receive payouts.' }, 403);
    }
    if (!profile.payhold_seller_id) {
      // Same door policy as the Stripe twin: this function connects an
      // account, it does not register a seller from nothing.
      return json(
        {
          error: 'Set up your host account before connecting a payout method.',
          code: 'no_seller',
        },
        409,
      );
    }
    const sellerId = String(profile.payhold_seller_id);

    const action = new URL(req.url).searchParams.get('action');

    if (req.method === 'POST' && action === 'complete') {
      const body = await req.json().catch(() => ({}));
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!code) return json({ error: 'PayPal sent no sign-in code.' }, 400);

      const result = await completePayPalConnect(sellerId, code, returnUrl());

      // The profile follows the destination, the way every other payout change
      // does — and `payout_status` follows PayPal's own answer rather than
      // optimism. An unverified account is recorded (it is genuinely theirs)
      // and left pending, so the eligibility gate stops the payout here rather
      // than PayPal stopping it for thirty days afterwards.
      await admin
        .from('profiles')
        .update({
          payout_method: 'paypal',
          payout_provider: 'payhold',
          payout_destination: result.email ?? `PayPal •••• ${result.payer_id.slice(-4)}`,
          payout_label: result.email ? `PayPal · ${result.email}` : 'PayPal',
          payout_status: result.verified_account === true ? 'active' : 'pending',
        })
        .eq('id', uid);

      return json(result, 200);
    }

    if (req.method === 'POST') {
      // `full_page` is the browser saying it cannot keep a popup — a phone, or
      // the installed PWA. PayHold then asks PayPal for its same-tab
      // presentation, and the whole exchange stays inside AutoHire.
      const body = await req.json().catch(() => ({}));
      const fullPage = body?.full_page === true;
      const start = await startPayPalConnect(sellerId, returnUrl(), fullPage);
      return json({ ...start, return_url: returnUrl() }, 200);
    }

    return json({ error: `${req.method} is not supported here.` }, 405);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
