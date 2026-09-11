// AutoHire — payhold-sync-verification Edge Function.
//
// When an admin verifies a host in AutoHire, PayHold is told too — and when
// they un-verify or reject, PayHold is told that. Until this existed the two
// platforms each kept their own opinion of the same person: an admin who had
// checked a host's documents here still had to find the same host in PayHold's
// Sellers dashboard and click Verify a second time, and nothing reconciled the
// two when they drifted.
//
// The admin page has two ways to reach a verification decision — a sticky
// profile override (`admin_set_verification` RPC) and per-document approval
// (a direct `verification_documents` UPDATE that a trigger folds into
// `profiles.verification`). Neither goes through an Edge Function, so neither
// is hooked. Instead both call THIS after they succeed, with only a profile id:
// this function reads `profiles.verification` itself and relays the STORED
// status. The client never gets to say which way. See `sync.ts` for why that
// is the right shape and what it means after a partial approval.
//
// AutoHire's admin is the only place a host is verified. PayHold's own
// dashboard answers 409 `verification_owned_by_platform` while its
// `platform_owns_verification` setting is on (the default), and its
// auto-verify no longer verifies. The relay names the admin who decided —
// `verified_by = autohire-admin:<profile id>`, from this session.
//
// If relay is off PayHold answers 422 `verification_relay_off`. That is
// reported as `payhold: 'not_trusted_yet'`, the AutoHire decision stands, and
// nothing retries. Verification is also NOT payability: a PayHold-verified host
// is still unpayable while their payout account is unverified or inside its
// security hold — a separate gate, verified through `payhold-verify-destination`,
// and a hold that expires on its own timer.
//
// Request:  POST { profileId }            — admin session required
// Response: { profileId, verification, verified, payhold, sellerId, … }
//           see `SyncResult` in sync.ts. Always 200 once the profile is found:
//           PayHold's part is reported in the body, not as an HTTP failure,
//           because the AutoHire write it follows has already happened.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-sync-verification

import { createClient } from 'npm:@supabase/supabase-js@2';
import { autohireAdminActor, payholdConfigured } from '../_shared/payhold.ts';
import { relayVerification } from './sync.ts';

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
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);

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

    // Admins only — the same gate `payhold-seller` puts on reading another
    // host's record, and the same one the RPCs behind the two admin buttons
    // enforce. A host could otherwise relay their OWN stored status, which is
    // harmless in itself (it is still the stored status) but is not theirs to
    // send: the attestation PayHold records is the operator's.
    const { data: caller } = await admin.from('profiles').select('role').eq('id', uid).single();
    if (caller?.role !== 'admin') {
      return json({ error: 'Only an admin can relay verification to PayHold.' }, 403);
    }

    const body = (await req.json().catch(() => null)) as { profileId?: unknown } | null;
    const profileId = typeof body?.profileId === 'string' ? body.profileId.trim() : '';
    if (!profileId) return json({ error: 'profileId is required.' }, 400);

    // Read, never trust: the status relayed is the one in the row right now.
    const { data: profile } = await admin
      .from('profiles')
      .select('id, verification, payhold_seller_id')
      .eq('id', profileId)
      .maybeSingle();
    if (!profile) return json({ error: 'Profile not found.' }, 404);

    // Who decided: the admin in this session, as a profile id — never a field
    // of the request, and never an email, since PayHold stores it.
    const verifiedBy = autohireAdminActor(uid);

    const result = await relayVerification(
      {
        id: profile.id as string,
        verification: (profile.verification as string | null) ?? 'unverified',
        payhold_seller_id: (profile.payhold_seller_id as string | null) ?? null,
      },
      verifiedBy,
      {
        writeSellerLink: async (id, sellerId) => {
          const { error } = await admin
            .from('profiles')
            .update({ payhold_seller_id: sellerId })
            .eq('id', id);
          if (error) throw new Error(error.message);
        },
      },
    );

    return json(result, 200);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
