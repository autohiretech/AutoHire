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
  findSellerByExternalUserId,
  payholdConfigured,
  payoutProviderFor,
  sellerCapabilities,
  type PayoutProvider,
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

/** Keep the last four digits only — what the host recognises, nothing usable. */
function mask(destination: string): string {
  const trimmed = destination.replace(/\s+/g, '');
  return `••••${trimmed.slice(-4)}`;
}

const METHOD_LABEL: Record<string, string> = {
  momo: 'Mobile Money',
  bank: 'Bank',
  card: 'Card',
  paypal: 'PayPal',
  venmo: 'Venmo',
  cash_app: 'Cash App',
  alipay: 'Alipay',
  wechat_pay: 'WeChat Pay',
};

/**
 * Which of our methods a PayHold rail came from.
 *
 * `stripe_connect` is genuinely ambiguous — `payoutProviderFor` sends both a
 * card and a non-African bank account there — so this is only ever used to fill
 * a column that is empty, never to overwrite what the host told us. The wallets
 * are unambiguous: one rail, one method.
 */
function methodForProvider(provider: PayoutProvider): string {
  const byRail: Partial<Record<PayoutProvider, string>> = {
    flutterwave_momo: 'momo',
    flutterwave_bank: 'bank',
    paypal: 'paypal',
    venmo: 'venmo',
    cash_app_pay: 'cash_app',
    alipay: 'alipay',
    wechat_pay: 'wechat_pay',
  };
  return byRail[provider] ?? 'card';
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
    const METHODS = ['momo', 'bank', 'card', 'paypal', 'venmo', 'cash_app', 'alipay', 'wechat_pay'];
    if (!METHODS.includes(method)) {
      return json({ error: `method must be one of: ${METHODS.join(', ')}.` }, 400);
    }
    if (String(destination).trim().length < 4) {
      return json({ error: 'That destination looks too short.' }, 400);
    }

    const { data: profile } = await admin
      .from('profiles')
      .select(
        'id, full_name, business_name, role, owner_type, country, payhold_seller_id, payout_method',
      )
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
      // Registering again would create a SECOND seller record for one host,
      // orphaning the first — and money may already be owed to it. PayHold has
      // no delete-seller endpoint, so this is not recoverable by retrying.
      //
      // Changing where a host is paid is a different operation: a new row in
      // PayHold's `seller_destinations`, with its own verification and security
      // hold (§5.1). That flow is not built yet, so say so rather than
      // suggesting a "remove and re-add" that would not work.
      return json(
        {
          error:
            'Your payout account is already set up. Changing where you get paid needs to go through support for now.',
          code: 'seller_exists',
        },
        409,
      );
    }

    const country = String(profile.country).toUpperCase();
    const raw = String(destination).trim();

    /**
     * Write the link and tell the host where they stand.
     *
     * Shared by both paths below, because a re-linked seller and a freshly
     * registered one leave this profile in the same state — the only difference
     * is whether PayHold tokenized anything just now, which is what `relinked`
     * carries back so the screen does not claim we saved a number we discarded.
     */
    const link = async (seller: Seller, relinked: boolean) => {
      const maskedDestination = relinked
        ? seller.masked_destination
        : (seller.masked_destination ?? mask(raw));

      // On a relink the method the host just picked describes a destination we
      // did not store, so it must not overwrite the one on file. Their existing
      // value stands; only an empty column is filled, and from the rail.
      const storedMethod = relinked
        ? ((profile.payout_method as string | null) ?? methodForProvider(seller.payout_provider))
        : (method as string);

      const { error: upErr } = await admin
        .from('profiles')
        .update({
          payhold_seller_id: seller.id,
          payout_method: storedMethod,
          payout_provider: 'payhold',
          payout_destination: maskedDestination,
          payout_label: `${METHOD_LABEL[storedMethod] ?? 'Payout'} · ${maskedDestination}`,
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
          maskedDestination,
          kycStatus: seller.kyc_status,
          relinked,
          canReceivePayouts: caps?.can_receive_payouts ?? false,
          reasons: caps?.reasons ?? [],
          routeReasons: caps?.route_reasons ?? [],
        },
        200,
      );
    };

    // A host may already exist on PayHold while this profile has forgotten it —
    // a write that failed after registration, a profile restored from a backup,
    // an account registered before the link column existed. Registering again
    // would orphan the first seller, and money may already be owed to it, so the
    // handle is asked for before anything is tokenized.
    //
    // This is also the *only* repair possible here. It cannot re-create a
    // missing seller: `POST /v1/sellers` tokenizes the raw number, we store a
    // mask, and PayHold stores a token — so no bulk import can exist and a host
    // with no seller has to be asked to type it again. That is what the
    // ReconnectPayouts banner is for.
    const existing = await findSellerByExternalUserId(uid).catch(() => null);
    if (existing) return await link(existing, true);

    let seller: Seller;
    try {
      ({ seller } = await createSeller({
        name:
          (profile.business_name as string | null) ?? (profile.full_name as string) ??
            'AutoHire host',
        country,
        payoutProvider: payoutProviderFor(method as 'momo' | 'bank' | 'card', country),
        destination: raw,
        // Our own id for this host. PayHold refuses a second registration under
        // it rather than quietly accepting one, which is what makes a
        // double-submit an error instead of a duplicate seller.
        externalUserId: uid,
      }));
    } catch (e) {
      // The lookup above is not a lock, so two submits can both reach the
      // create and PayHold refuses the second on its unique handle. Re-ask
      // rather than parsing their message for an id, and link the winner.
      if ((e as { code?: string }).code === 'policy_violation') {
        const raced = await findSellerByExternalUserId(uid).catch(() => null);
        if (raced) return await link(raced, true);
      }
      throw e;
    }

    // `raw` goes out of scope here and is never written, logged or returned.
    return await link(seller, false);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
