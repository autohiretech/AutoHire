// AutoHire — payhold-register-seller Edge Function.
//
// Registers a host as a PayHold seller. This is the ONLY point where the raw
// payout destination exists: the host types it, it goes straight to PayHold to
// be tokenized, and neither side writes it down. AutoHire keeps the seller id
// and a mask; PayHold keeps the token.
//
// That is why this is a server function and not a client call — the raw number
// must not travel through a browser holding an anon key, and the seller id must
// be written by something the host cannot forge.
//
// Called by the payout-setup screen instead of `setPayoutMethod` once PayHold
// is switched on.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-register-seller

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  createSeller,
  payholdConfigured,
  payoutProviderFor,
  sellerCapabilities,
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

/** Keep the last four digits only — what the host recognises, nothing usable. */
function mask(destination: string): string {
  const trimmed = destination.replace(/\s+/g, '');
  return `••••${trimmed.slice(-4)}`;
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

    const { method, destination } = await req.json();
    if (!method || !destination) {
      return json({ error: 'method and destination are required.' }, 400);
    }
    if (!['momo', 'bank', 'card'].includes(method)) {
      return json({ error: 'method must be momo, bank or card.' }, 400);
    }
    if (String(destination).trim().length < 4) {
      return json({ error: 'That destination looks too short.' }, 400);
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('id, full_name, business_name, role, owner_type, country, payhold_seller_id')
      .eq('id', uid)
      .single();

    // Only a host is paid. A renter has no earnings to route anywhere, and
    // registering one as a seller would create a payout destination with
    // nothing behind it.
    if (profile?.role !== 'owner') {
      return json({ error: 'Only host accounts receive payouts.' }, 403);
    }
    if (!profile?.country) {
      return json(
        { error: 'Set your country before adding a payout method.', code: 'country_required' },
        400,
      );
    }
    if (profile.payhold_seller_id) {
      // Changing a destination is a different operation with its own security
      // hold on PayHold's side (§5.1) — it must not be reachable by calling the
      // register endpoint twice.
      return json(
        {
          error: 'You already have a payout method. Remove it before adding another.',
          code: 'seller_exists',
        },
        409,
      );
    }

    const country = String(profile.country).toUpperCase();
    const raw = String(destination).trim();

    const { seller } = await createSeller({
      name: (profile.business_name as string | null) ?? (profile.full_name as string) ?? 'AutoHire host',
      country,
      payoutProvider: payoutProviderFor(method as 'momo' | 'bank' | 'card', country),
      destination: raw,
    });

    // Store the id and the mask. `raw` goes out of scope here and is never
    // written, logged or returned.
    const { error: upErr } = await admin
      .from('profiles')
      .update({
        payhold_seller_id: seller.id,
        payout_method: method,
        payout_provider: 'payhold',
        payout_destination: seller.masked_destination ?? mask(raw),
        payout_label: `${method === 'momo' ? 'Mobile Money' : method === 'bank' ? 'Bank' : 'Card'} · ${seller.masked_destination ?? mask(raw)}`,
        // Not 'active' on our say-so. PayHold decides whether this seller can
        // actually be paid, and says so through /capabilities below.
        payout_status: 'pending',
      })
      .eq('id', uid);
    if (upErr) return json({ error: upErr.message }, 500);

    // Tell the host now what would otherwise surface as a stuck payout weeks
    // later — an unverified identity, a corridor PayHold cannot reach.
    const caps = await sellerCapabilities(seller.id).catch(() => null);

    if (caps?.can_receive_payouts) {
      await admin.from('profiles').update({ payout_status: 'active' }).eq('id', uid);
    }

    return json(
      {
        sellerId: seller.id,
        maskedDestination: seller.masked_destination,
        kycStatus: seller.kyc_status,
        canReceivePayouts: caps?.can_receive_payouts ?? false,
        reasons: caps?.reasons ?? [],
        routeReasons: caps?.route_reasons ?? [],
      },
      200,
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
