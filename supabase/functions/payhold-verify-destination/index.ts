// AutoHire — payhold-verify-destination Edge Function.
//
// Admin → KYC review verifies a host's payout account here. PayHold's own
// dashboard and auto-verify no longer verify AutoHire's sellers or their
// destinations (`platform_owns_verification`), so this is the one door.
//
//   GET  /payhold-verify-destination?profileId=   { account, reason? }
//   POST /payhold-verify-destination              { profileId, verified }
//                                                  → { outcome, account }
//
// Admin session only (`profiles.role = 'admin'`, checked server-side). The
// account is re-read from PayHold on every call; the verifier is the session's
// admin as `autohire-admin:<profile id>`. Verifying does not end the security
// hold — it expires on its own timer. See `account.ts` for the outcomes.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN (leave unset)
// Deploy:   supabase functions deploy payhold-verify-destination

import { createClient } from 'npm:@supabase/supabase-js@2';
import { handlePayoutAccountRequest, type HandlerDeps } from './account.ts';

Deno.serve((req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const deps: HandlerDeps = {
    userIdForToken: async (token) => {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    roleOf: async (userId) => {
      const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
      return (data?.role as string | undefined) ?? null;
    },
    readProfile: async (profileId) => {
      const { data, error } = await admin
        .from('profiles')
        .select('id, payhold_seller_id, payout_status')
        .eq('id', profileId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id as string,
        payhold_seller_id: (data.payhold_seller_id as string | null) ?? null,
        payout_status: (data.payout_status as string | null) ?? null,
      };
    },
    profileName: async (profileId) => {
      const { data } = await admin
        .from('profiles')
        .select('full_name')
        .eq('id', profileId)
        .maybeSingle();
      return (data?.full_name as string | null | undefined) ?? null;
    },
    writeSellerLink: async (profileId, sellerId) => {
      const { error } = await admin
        .from('profiles')
        .update({ payhold_seller_id: sellerId })
        .eq('id', profileId);
      if (error) throw new Error(error.message);
    },
    writePayoutStatus: async (profileId, status) => {
      const { error } = await admin
        .from('profiles')
        .update({ payout_status: status })
        .eq('id', profileId);
      if (error) throw new Error(error.message);
    },
  };

  return handlePayoutAccountRequest(req, deps);
});
