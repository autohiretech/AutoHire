// AutoHire — payhold-auto-verify-payouts Edge Function.
//
// The hourly sweep behind `app_settings.payout_auto_verify_after_hours`
// (migration 083): a host's payout account that has sat unverified for the
// configured wait is verified in PayHold, so their payouts start instead of
// piling up behind a check nobody remembered to make. `sweep.ts` holds the
// rules and the reasons.
//
//   POST /payhold-auto-verify-payouts   → the run's counters
//   GET  /payhold-auto-verify-payouts   → the same (pg_cron posts; curl gets)
//
// **No JWT** (`verify_jwt = false` in supabase/config.toml) so pg_cron can call
// it with no key — see migration 083. It takes no input, answers with counts
// and no names, and every account it touches must already have been on file for
// the configured wait, which calling this early cannot bring forward. A second
// call inside five minutes does nothing at all.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN (leave unset)
// Deploy:   supabase functions deploy payhold-auto-verify-payouts --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2';
import { MAX_PER_RUN, runAutoVerifySweep, type CandidateHost, type SweepDeps } from './sweep.ts';

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ error: 'GET or POST only.' }, 405);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const deps: SweepDeps = {
    readSettings: async () => {
      const { data, error } = await admin
        .from('app_settings')
        .select('payout_auto_verify_after_hours, payout_auto_verify_last_run_at')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return {
        afterHours: Number(data?.payout_auto_verify_after_hours ?? 0),
        lastRunAt: (data?.payout_auto_verify_last_run_at as string | null) ?? null,
      };
    },

    // Who this can reach, written as a query: a verified, un-suspended host
    // with a PayHold seller whose payouts are still waiting on something.
    // `payout_status = 'pending'` is the whole point of the filter — 'active'
    // is already being paid and 'none'/null has no account on file — and it is
    // reconciled against PayHold on every read, including by this sweep.
    candidates: async (limit: number): Promise<CandidateHost[]> => {
      const { data, error } = await admin
        .from('profiles')
        .select('id, payhold_seller_id, payout_status')
        .not('payhold_seller_id', 'is', null)
        .eq('verification', 'verified')
        .eq('suspended', false)
        .eq('payout_status', 'pending')
        .order('id')
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? [])
        .filter((r) => typeof r.payhold_seller_id === 'string' && r.payhold_seller_id)
        .map((r) => ({
          id: r.id as string,
          sellerId: r.payhold_seller_id as string,
          payoutStatus: (r.payout_status as string | null) ?? null,
        }));
    },

    writePayoutStatus: async (profileId, status) => {
      const { error } = await admin
        .from('profiles')
        .update({ payout_status: status })
        .eq('id', profileId);
      if (error) throw new Error(error.message);
    },

    // `create_notification` (migration 052) — the host's bell. Nothing else
    // tells them: the account was verified with no person on either side of it.
    notifyHost: async (profileId, title, body) => {
      const { error } = await admin.rpc('create_notification', {
        p_profile: profileId,
        p_kind: 'payout_alert',
        p_title: title,
        p_body: body,
        p_link: '/earnings',
      });
      if (error) throw new Error(error.message);
    },

    markRun: async (at, verified) => {
      const { error } = await admin
        .from('app_settings')
        .update({
          payout_auto_verify_last_run_at: at.toISOString(),
          payout_auto_verify_last_count: verified,
        })
        .eq('id', 1);
      if (error) throw new Error(error.message);
    },
  };

  try {
    const result = await runAutoVerifySweep(deps);
    if (result.ran) {
      console.log('[payhold-auto-verify-payouts] run', result);
    }
    return json(result, 200);
  } catch (e) {
    console.error('[payhold-auto-verify-payouts] failed', e);
    return json({ error: e instanceof Error ? e.message : String(e), maxPerRun: MAX_PER_RUN }, 500);
  }
});
