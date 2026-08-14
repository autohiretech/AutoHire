// AutoHire — payhold-create-deal Edge Function.
//
// Turns a renter's checkout into a PayHold deal and hands back the hosted
// payment link. Nothing is charged here and no booking row is written: the
// renter pays on PayHold's page, and `payhold-webhook` creates the trip when
// `order.funded_held` says the money is actually held.
//
// The amount is computed server-side from the listing, never taken from the
// client. Everything that would make the trip impossible — a host trying to
// rent, an unverified renter, dates already taken — is refused BEFORE a deal
// exists, because a deal the renter can pay for is a deal we owe them a car for.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-create-deal

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  createCheckoutSession,
  createDeal,
  payholdConfigured,
  sessionToken,
  toMinorUnits,
} from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SERVICE_FEE_RATE = 0.1;

/**
 * PayHold's public base, handed to the browser so it does not need its own copy
 * of the URL. The public checkout routes take no credential — the session token
 * in the path is the credential — so this is safe to expose and the API key
 * stays here.
 */
const PAYHOLD_PUBLIC = (Deno.env.get('PAYHOLD_BASE_URL') ?? '').replace(/\/+$/, '');

/** Methods a renter may state a preference for. Anything else is ignored. */
const PREFERRED = ['card', 'momo', 'bank', 'paypal', 'alipay', 'wechat_pay'];

/**
 * Does this look like a card number?
 *
 * `metadata` is stored verbatim by PayHold and shown in its dashboard, so a PAN
 * landing there would be a plaintext card number at rest in two systems — the
 * one thing this whole integration is arranged to avoid. The renter's card is
 * typed on PayHold's own checkout and never passes through AutoHire.
 *
 * Length plus Luhn is what separates a card from a phone number or an account
 * number, both of which are legitimately 13-19 digits. This is a backstop, not
 * the control: the payment screen offers no card field at all. It exists so a
 * future caller cannot reintroduce one by accident.
 */
function looksLikeCard(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
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

    const { listingId, startDate, endDate, preferredMethod, payerRef, buyerCountry } = await req.json();

    // Which market to charge the renter's card as. Defaults to their profile's
    // country below, but a renter paying with a foreign card can name a
    // different one here — PayHold prices the deal in whatever currency that
    // market's rails serve, so this is how "charge me in a currency my card
    // actually accepts" is answered without asking them to change their
    // account's country just to pay for one trip.
    const buyerCountryOverride =
      typeof buyerCountry === 'string' && buyerCountry.trim() ? buyerCountry.trim().toUpperCase() : '';

    // Where the renter wants to be charged — a MoMo number, a PayPal address.
    // Never a card: those are typed on PayHold's checkout.
    const ref = typeof payerRef === 'string' ? payerRef.trim().slice(0, 128) : '';
    if (ref && looksLikeCard(ref)) {
      return json(
        {
          error: 'Card details are entered on the secure checkout, not here.',
          code: 'card_not_accepted',
        },
        400,
      );
    }
    if (!listingId || !startDate || !endDate) {
      return json({ error: 'listingId, startDate and endDate are required.' }, 400);
    }
    if (new Date(endDate) <= new Date(startDate)) {
      return json({ error: 'Return date must be after pick-up date.' }, 400);
    }

    // --- Who may rent ------------------------------------------------------
    const { data: renter } = await admin
      .from('profiles')
      .select('role, owner_type, verification, country, full_name')
      .eq('id', uid)
      .single();
    if (renter?.owner_type === 'business') {
      return json({ error: 'Company accounts cannot rent — they can only view cars.' }, 403);
    }
    if (renter?.role === 'owner') {
      return json({ error: 'Host accounts cannot rent — they can only view cars.' }, 403);
    }
    if (renter?.verification !== 'verified') {
      return json({ error: 'Verify your identity before renting.', code: 'verification_required' }, 403);
    }

    // --- What is being rented ----------------------------------------------
    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select('title, price_per_day_rwf, price_currency, country, host_id, blocked_dates')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);

    const blocked = new Set<string>((listing.blocked_dates as string[] | null) ?? []);
    for (let d = new Date(startDate); d < new Date(endDate); d.setDate(d.getDate() + 1)) {
      if (blocked.has(d.toISOString().slice(0, 10))) {
        return json({ error: 'Those dates are not available for this car.' }, 409);
      }
    }
    const { data: clash } = await admin
      .from('bookings')
      .select('id')
      .eq('listing_id', listingId)
      .not('state', 'in', '(cancelled,declined,completed)')
      .lt('start_date', endDate)
      .gt('end_date', startDate)
      .maybeSingle();
    if (clash) return json({ error: 'This car is already booked for those dates.' }, 409);

    // --- Who gets paid ------------------------------------------------------
    //
    // A deal names a seller, so the host must exist in PayHold before their car
    // can be paid for. They are registered when they set up payouts
    // (`payhold-register-seller`), which is the only moment the raw destination
    // exists — AutoHire stores only a mask (••••4242), and tokenizing a mask
    // would produce a destination that cannot receive money.
    //
    // So this cannot self-heal, and refusing is right: taking the renter's
    // money for a trip whose host has nowhere to be paid would leave us holding
    // funds we cannot settle.
    const { data: host } = await admin
      .from('profiles')
      .select('id, payhold_seller_id, payout_status')
      .eq('id', listing.host_id)
      .single();

    const sellerId = host?.payhold_seller_id as string | null;
    if (!sellerId) {
      return json(
        {
          error: 'This car is not available for booking yet — the host has not finished setting up payouts.',
          code: 'host_payout_missing',
        },
        409,
      );
    }

    // --- The money ----------------------------------------------------------
    const days = diffDays(startDate, endDate);
    const subtotal = (listing.price_per_day_rwf as number) * days;
    const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
    const total = subtotal + serviceFee;

    // Always the car's own currency — the renter's market never re-denominates
    // it. PayHold converts to something the renter's country can actually be
    // charged in and carries the FX itself.
    const currency = String(listing.price_currency ?? 'RWF').toUpperCase();

    const { deal, payment_link } = await createDeal({
      buyerRef: uid,
      sellerId,
      description: `AutoHire — ${listing.title} (${days} day${days === 1 ? '' : 's'})`,
      amount: toMinorUnits(total, currency),
      currency,
      // The renter's own country, not the car's market — unless they picked a
      // different one for this payment. Either way, this is what decides what
      // they can pay with and which currency their card is actually charged in.
      buyerCountry: buyerCountryOverride || (renter?.country as string | null) || undefined,
      expectedCompleteAt: new Date(endDate).toISOString(),
      // Everything the webhook needs to build the trip. It reads these from the
      // deal, never from its own payload — see payhold-webhook.
      metadata: {
        uid,
        listingId,
        // What the renter picked before they got here. PayHold stores metadata
        // verbatim and hands it back, so this rides along whether or not its
        // checkout reads it yet — the choice is recorded either way, and it is
        // a preference rather than an instruction: PayHold decides what a buyer
        // in that country can actually be charged with.
        ...(PREFERRED.includes(String(preferredMethod))
          ? { preferredMethod: String(preferredMethod) }
          : {}),
        ...(ref && preferredMethod !== 'card' ? { payerRef: ref } : {}),
        startDate,
        endDate,
        days: String(days),
        subtotal: String(subtotal),
        serviceFee: String(serviceFee),
        total: String(total),
        currency,
      },
    });

    /**
     * Make the deal payable by the browser as well as by the link.
     *
     * A session lets AutoHire render PayHold's own method list and start the
     * payment from the renter's browser, so mobile money can finish without
     * anyone leaving the page. It is attempted, not required: the endpoint is
     * newer than the rest of this flow, and a deal with a `payment_link` is
     * still perfectly payable without one. Falling back is a worse experience,
     * not a broken booking.
     */
    let checkoutToken: string | null = null;
    try {
      const s = await createCheckoutSession(
        deal.id,
        `${Deno.env.get('ALLOWED_ORIGIN') ?? 'https://autohiretech.pages.dev'}/trips`,
      );
      checkoutToken = sessionToken(s);
    } catch (e) {
      console.warn('checkout session unavailable, falling back to payment_link:', e);
    }

    return json(
      {
        dealId: deal.id,
        status: deal.status,
        paymentLink: payment_link,
        // Where the browser can read methods and start the payment without a
        // credential. Null when sessions are unavailable.
        checkoutBase: checkoutToken
          ? `${PAYHOLD_PUBLIC}/checkout/public/${checkoutToken}`
          : null,
        amount: deal.amount,
        currency: deal.currency,
        total,
      },
      200,
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
