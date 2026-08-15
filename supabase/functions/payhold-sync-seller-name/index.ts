// AutoHire — payhold-sync-seller-name Edge Function.
//
// Keeps PayHold's record of a seller's name matching AutoHire's own the
// moment a host edits their profile name. `payhold-ensure-seller` only ever
// set `name` once, at registration — an edit afterward (a legal name change,
// a typo fix) went nowhere, so PayHold's Sellers dashboard kept showing
// whoever a host was the day they signed up, drifting further from the truth
// every time their AutoHire profile changed. A dashboard that identifies who
// money is owed to by a name nobody can update again is a name an operator
// has no way to trust.
//
// Called right after `updateProfile()` changes `full_name` or `business_name`
// for a host. A profile with no `payhold_seller_id` yet has nothing to sync —
// a quiet no-op, not an error, since most name edits are made before anyone
// has ever toggled to host.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-sync-seller-name

import { createClient } from 'npm:@supabase/supabase-js@2';
import { payholdConfigured, setSellerName } from '../_shared/payhold.ts';

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
      .select('payhold_seller_id, full_name, business_name')
      .eq('id', uid)
      .single();

    if (!profile?.payhold_seller_id) {
      return json({ synced: false, reason: 'no_seller' }, 200);
    }

    // The same precedence `createSeller` used at registration — a business
    // name, when there is one, is the name that identifies the seller.
    const name = (profile.business_name as string | null) ?? (profile.full_name as string | null);
    if (!name?.trim()) {
      return json({ synced: false, reason: 'no_name' }, 200);
    }

    const seller = await setSellerName(profile.payhold_seller_id as string, name.trim());
    return json({ synced: true, sellerId: seller.id }, 200);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
