// AutoHire — flutterwave-transfer Edge Function.
//
// Disburses a host payout to their mobile money / bank via Flutterwave Transfers.
// Runs against 'scheduled' payout rows (created by the release_payout_on_complete
// trigger when a trip completes) and moves them scheduled → processing → paid.
//
// Intended to be called by an admin or a scheduled job (pg_cron / a worker), not
// by renters. It authorises the caller as an admin; a cron worker would use the
// service-role key instead.
//
// Modes, decided by whether FLUTTERWAVE_SECRET_KEY is set:
//   • Live  — creates a real Flutterwave transfer to the host's destination.
//   • Demo  — marks the payout paid without moving money.
//
// NOTE on destinations: we only store a MASKED destination for privacy. A live
// build tokenises the host's real account into a Flutterwave beneficiary during
// payout setup and stores that beneficiary reference — this function would look
// it up rather than a raw number. The demo path doesn't need it.
//
// Secrets:  FLUTTERWAVE_SECRET_KEY, ALLOWED_ORIGIN
// Deploy:   supabase functions deploy flutterwave-transfer

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FLW_KEY = Deno.env.get('FLUTTERWAVE_SECRET_KEY') ?? '';
const DEMO = !FLW_KEY;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Missing authorization token.' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);

    // Only admins may trigger disbursement from the client.
    const { data: caller } = await admin
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();
    if (caller?.role !== 'admin') return json({ error: 'Not allowed.' }, 403);

    const { payoutId } = await req.json();
    if (!payoutId) return json({ error: 'payoutId is required.' }, 400);

    const { data: payout, error: poErr } = await admin
      .from('payouts')
      .select('*')
      .eq('id', payoutId)
      .single();
    if (poErr || !payout) return json({ error: 'Payout not found.' }, 404);
    if (payout.status === 'paid') return json({ payout, alreadyPaid: true }, 200);

    // Mark processing so a retry doesn't double-pay.
    await admin.from('payouts').update({ status: 'processing' }).eq('id', payoutId);

    if (DEMO) {
      const { data: paid } = await admin
        .from('payouts')
        .update({ status: 'paid', paid_at: new Date().toISOString().slice(0, 10) })
        .eq('id', payoutId)
        .select('*')
        .single();
      return json({ payout: paid, demo: true }, 200);
    }

    // Live: disburse against the host's stored beneficiary (tokenised at payout
    // setup — we never hold the raw number).
    const { data: host } = await admin
      .from('profiles')
      .select('payout_beneficiary')
      .eq('id', payout.host_id)
      .single();
    if (!host?.payout_beneficiary) {
      await admin.from('payouts').update({ status: 'failed' }).eq('id', payoutId);
      return json({ error: 'Host has no payout destination on file.', code: 'no_destination' }, 409);
    }

    const res = await fetch('https://api.flutterwave.com/v3/transfers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FLW_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        beneficiary: host.payout_beneficiary,
        amount: payout.amount_rwf,
        currency: 'RWF',
        reference: `po-${payoutId}-${Date.now()}`,
        narration: 'AutoHire host payout',
      }),
    });
    const body = await res.json();
    if (!res.ok || body.status !== 'success') {
      await admin.from('payouts').update({ status: 'failed' }).eq('id', payoutId);
      return json({ error: body.message ?? 'Transfer failed.' }, 502);
    }

    // Flutterwave transfers settle asynchronously; a transfer webhook flips it to
    // 'paid'. Leave it 'processing' here.
    return json({ payout: { ...payout, status: 'processing' }, transferId: body.data?.id }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
