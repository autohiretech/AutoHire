// AutoHire — flutterwave-beneficiary Edge Function.
//
// Called at payout setup. Takes the host's RAW destination (MoMo number / bank
// account) once, registers it as a Flutterwave transfer beneficiary, and stores
// only the returned beneficiary id + a masked label on the profile. The raw
// number is never persisted. flutterwave-transfer later disburses against the id.
//
// Demo mode (no FLUTTERWAVE_SECRET_KEY) stores a demo token so the flow works
// without a provider account.
//
// Secrets:  FLUTTERWAVE_SECRET_KEY, ALLOWED_ORIGIN
// Deploy:   supabase functions deploy flutterwave-beneficiary

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FLW_KEY = Deno.env.get('FLUTTERWAVE_SECRET_KEY') ?? '';
const DEMO = !FLW_KEY;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function mask(dest: string): string {
  const s = String(dest).replace(/\s+/g, '');
  return s.length <= 4 ? s : `••••${s.slice(-4)}`;
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
    const uid = userData.user.id;

    // method: 'momo' | 'bank' ; destination: raw number ; accountBank: bank/MoMo code
    const { method, destination, accountBank } = await req.json();
    if (!method || !destination) return json({ error: 'method and destination are required.' }, 400);

    const label = `${method === 'momo' ? 'Mobile Money' : method === 'bank' ? 'Bank account' : 'Debit card'} · ${mask(destination)}`;

    let beneficiaryId = `demo-ben-${Date.now()}`;
    if (!DEMO) {
      const res = await fetch('https://api.flutterwave.com/v3/beneficiaries', {
        method: 'POST',
        headers: { Authorization: `Bearer ${FLW_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_number: destination,
          account_bank: accountBank ?? (method === 'momo' ? 'MPS' : undefined),
          beneficiary_name: 'AutoHire host',
        }),
      });
      const body = await res.json();
      if (!res.ok || body.status !== 'success') {
        return json({ error: body.message ?? 'Could not register the payout destination.' }, 502);
      }
      beneficiaryId = String(body.data.id);
    }

    const { data: profile } = await admin
      .from('profiles')
      .update({
        payout_method: method,
        payout_provider: 'flutterwave',
        payout_beneficiary: beneficiaryId,
        payout_destination: mask(destination),
        payout_label: label,
        payout_status: 'active',
      })
      .eq('id', uid)
      .select('*')
      .single();

    return json({ profile, demo: DEMO }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
