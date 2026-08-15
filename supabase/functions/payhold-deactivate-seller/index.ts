// AutoHire — payhold-deactivate-seller Edge Function.
//
// Marks a host's PayHold seller inactive the moment they switch back to
// renting. Status only — PayHold's payout path never reads `active`, so this
// never pauses or delays money already owed to a host who stepped back; it is
// us restating a fact about our own roster, not a claim about anyone's money.
//
// The counterpart to `payhold-ensure-seller`, which reactivates on the way
// back in — see that function's header for why the reactivation lives there
// and not here.
//
// Called right after `toggleRole()` flips a profile to `role: 'renter'`.
// A profile with no `payhold_seller_id` yet (never hosted, or never made it
// past the toggle before this shipped) has nothing to deactivate — a quiet
// no-op, not an error, because "nothing to turn off" is the expected answer
// for most renters.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-deactivate-seller

import { createClient } from 'npm:@supabase/supabase-js@2';
import { payholdConfigured, setSellerActive } from '../_shared/payhold.ts';

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
      .select('payhold_seller_id')
      .eq('id', uid)
      .single();

    if (!profile?.payhold_seller_id) {
      return json({ deactivated: false, reason: 'no_seller' }, 200);
    }

    const seller = await setSellerActive(profile.payhold_seller_id as string, false);
    return json({ deactivated: true, sellerId: seller.id }, 200);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
