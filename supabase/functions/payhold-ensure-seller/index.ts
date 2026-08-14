// AutoHire — payhold-ensure-seller Edge Function.
//
// Registers a host as a PayHold seller the moment they become one — no payout
// destination required. As of PayHold's `20260814000001`, `POST /v1/sellers`
// accepts a bare `{ name, external_user_id }`: a seller can exist, and money
// can accrue against them, before anyone has typed a payout number. Until this
// function, the only door was `payhold-register-seller`, which requires
// `method` and `destination` in the same request — so a host who toggled to
// "host" but had not yet reached payout setup had no PayHold record at all.
//
// This does not replace that function. `payhold-register-seller` is still the
// only place a destination is ever tokenized, and it still branches on
// `profiles.payhold_seller_id` to register vs. change — this just means that
// branch usually finds a seller already there by the time a host reaches it,
// and takes the "change" (add a destination) path from the start.
//
// Called once, right after `toggleRole()` flips a profile to `role: 'owner'`.
// Safe to call again — it is a no-op once `payhold_seller_id` is set — so a
// retry, a double-click, or a host who somehow reaches this with no PayHold
// record already linked (an interrupted signup, a profile restored from a
// backup) all converge rather than erroring or duplicating.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-ensure-seller

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  createSeller,
  findSellerByExternalUserId,
  payholdConfigured,
  type Seller,
} from '../_shared/payhold.ts';

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

async function link(admin: SupabaseClient, uid: string, seller: Seller): Promise<Response> {
  const { error } = await admin
    .from('profiles')
    .update({ payhold_seller_id: seller.id })
    .eq('id', uid);
  if (error) return json({ error: error.message }, 500);

  return json({ sellerId: seller.id, kycStatus: seller.kyc_status }, 200);
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
      .select('id, full_name, business_name, role, payhold_seller_id')
      .eq('id', uid)
      .single();

    // Only a host is a seller. A renter has no earnings to route anywhere, and
    // registering one would be a payout destination with nothing behind it —
    // the same guard `payhold-register-seller` makes, checked here first so a
    // stray call from a renter session is a plain refusal rather than a
    // PayHold round trip.
    if (profile?.role !== 'owner') {
      return json({ error: 'Only host accounts are PayHold sellers.' }, 403);
    }

    // Already linked. This is the common case on every call after the first —
    // toggling host mode off and back on, a page reload, a retry — and it must
    // stay cheap and silent rather than asking PayHold anything.
    if (profile.payhold_seller_id) {
      return json({ sellerId: profile.payhold_seller_id, alreadyLinked: true }, 200);
    }

    // A seller may already exist under this handle while this profile has
    // forgotten it — the same repair `payhold-register-seller` makes, asked
    // for before anything is created so a lost link is re-linked rather than
    // duplicated.
    const existing = await findSellerByExternalUserId(uid).catch(() => null);
    if (existing) return await link(admin, uid, existing);

    let seller: Seller;
    try {
      ({ seller } = await createSeller({
        name: (profile.business_name as string | null) ?? (profile.full_name as string) ??
          'AutoHire host',
        // No country, no payoutProvider, no destination — none of that exists
        // yet. `payhold-register-seller` is still the only place a raw number
        // is ever typed.
        externalUserId: uid,
      }));
    } catch (e) {
      // Two toggles racing both reach the create; PayHold refuses the second
      // on its unique handle. Re-ask rather than parsing the message, and link
      // whichever won.
      if ((e as { code?: string }).code === 'policy_violation') {
        const raced = await findSellerByExternalUserId(uid).catch(() => null);
        if (raced) return await link(admin, uid, raced);
      }
      throw e;
    }

    return await link(admin, uid, seller);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
