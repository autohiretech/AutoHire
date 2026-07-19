// AutoHire — admin-delete-user Edge Function.
//
// Permanently deletes ANOTHER user's account on an admin's behalf: their
// profile row (which cascades to all their data) and their auth.users login.
// Requires the service_role key, so it lives here, and it verifies the caller
// is an admin before doing anything.
//
// Deploy:  supabase functions deploy admin-delete-user
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  // Set the ALLOWED_ORIGIN secret to your web app's origin in production.
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
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Missing authorization token.' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Identify the caller and confirm they are an admin.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);
    const callerId = userData.user.id;

    const { data: caller } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .single();
    if (caller?.role !== 'admin') return json({ error: 'Admins only.' }, 403);

    const { profileId } = await req.json();
    if (!profileId) return json({ error: 'profileId is required.' }, 400);
    if (profileId === callerId) {
      return json({ error: 'You cannot delete your own account here.' }, 400);
    }

    // Don't allow deleting another admin.
    const { data: target } = await admin
      .from('profiles')
      .select('role')
      .eq('id', profileId)
      .single();
    if (target?.role === 'admin') {
      return json({ error: 'Admin accounts cannot be deleted here.' }, 403);
    }

    // Delete the profile first (FK cascades remove listings, bookings, messages,
    // reviews, payouts, verification docs/events, notifications, flags, disputes).
    const { error: profileErr } = await admin.from('profiles').delete().eq('id', profileId);
    if (profileErr) return json({ error: `Failed to delete data: ${profileErr.message}` }, 400);

    // Then remove the login itself.
    const { error: authErr } = await admin.auth.admin.deleteUser(profileId);
    if (authErr) return json({ error: `Failed to delete login: ${authErr.message}` }, 400);

    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
