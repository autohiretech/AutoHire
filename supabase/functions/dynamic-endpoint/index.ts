// AutoHire — delete-account Edge Function.
//
// Permanently deletes the calling user's account: their profile row (which
// cascades to all their data via ON DELETE CASCADE — see migration-002) and
// their auth.users login. This needs the service_role key, which must never be
// in the browser, so it lives here.
//
// Deploy:  supabase functions deploy delete-account
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
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
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Missing authorization token.' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Identify the caller from their JWT — they can only delete themselves.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);
    const uid = userData.user.id;

    // Delete the profile first; FK cascades remove listings, bookings, messages,
    // reviews, payouts, verification docs, notifications, flags, disputes.
    const { error: profileErr } = await admin.from('profiles').delete().eq('id', uid);
    if (profileErr) return json({ error: `Failed to delete data: ${profileErr.message}` }, 400);

    // Then remove the login itself.
    const { error: authErr } = await admin.auth.admin.deleteUser(uid);
    if (authErr) return json({ error: `Failed to delete login: ${authErr.message}` }, 400);

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
