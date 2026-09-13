// AutoHire — book-cash Edge Function.
//
// A booking that takes no money. The renter is quoted an ESTIMATE, the car is
// held for the dates, and cash changes hands at the kerb between two people who
// are standing next to each other. AutoHire never touches it.
//
// This exists as its own function rather than a branch inside `confirm-booking`
// because that function's whole job is proving a payment happened — it re-reads
// a PaymentIntent, matches its metadata, refuses anything unauthorised. There
// is no payment here to prove, and threading "except when there isn't one"
// through every one of those checks would leave the paid path's guarantees
// resting on a boolean.
//
// What is still enforced, because none of it is about money:
//   • the renter is who they say they are, and is allowed to rent at all
//   • the CAR says it takes cash — never the browser
//   • the price is recomputed here from the listing
//   • availability and the state machine, by the same DB triggers as every
//     other booking
//
// Deploy:  supabase functions deploy book-cash

import { createClient } from 'npm:@supabase/supabase-js@2';
import { payholdConfigured, recordCashDeal } from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** The same 10% the paid path charges. Quoted, not collected — see below. */
const SERVICE_FEE_RATE = 0.1;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function diffDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

function toCamelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
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

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) return json({ error: 'Invalid or expired session.' }, 401);
    const uid = userData.user.id;

    const body = await req.json();
    const listingId: string = body.listingId;
    const startDate: string = body.startDate;
    const endDate: string = body.endDate;
    if (!listingId || !startDate || !endDate) {
      return json({ error: 'listingId, startDate and endDate are required.' }, 400);
    }

    // Same renter eligibility as every other creation path. The
    // `booking_renter_guard` trigger says it again on the insert.
    const { data: profile } = await admin
      .from('profiles')
      .select('role, owner_type, payhold_seller_id')
      .eq('id', uid)
      .single();
    if (profile?.owner_type === 'business') {
      return json({ error: 'Company accounts cannot rent — they can only view cars.' }, 403);
    }
    if (profile?.role === 'owner') {
      return json({ error: 'Host accounts cannot rent — they can only view cars.' }, 403);
    }

    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select('price_per_day_rwf, price_currency, country, host_id, booking_mode, accepts_cash, title')
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);

    // **The car decides, not the caller.** `accepts_cash` is a host's consent to
    // handle banknotes for this particular car, and a request that simply asked
    // for the cash path would be a way around it.
    if (!listing.accepts_cash) {
      return json(
        { error: 'This car does not accept cash on pickup.', code: 'cash_not_accepted' },
        409,
      );
    }

    const days = diffDays(startDate, endDate);
    const subtotal = (listing.price_per_day_rwf as number) * days;
    const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
    const total = subtotal + serviceFee;

    // A host who takes requests still takes requests. Cash does not get its own
    // approval flow — `requested` already exists, the host dashboard already
    // lists it, and inventing a second way to say yes would mean two.
    const state = listing.booking_mode === 'request' ? 'requested' : 'confirmed';

    const bookingId = `bk-${Date.now()}`;
    const { data: row, error: insErr } = await admin
      .from('bookings')
      .insert({
        id: bookingId,
        listing_id: listingId,
        renter_id: uid,
        host_id: listing.host_id,
        start_date: startDate,
        end_date: endDate,
        days,
        state,
        subtotal_rwf: subtotal,
        service_fee_rwf: serviceFee,
        total_rwf: total,
        // Unpaid, and it stays unpaid until a human says otherwise. Marking it
        // paid here would be the app asserting that money changed hands at a
        // moment when nobody has met anybody.
        payment_status: 'unpaid',
        provider: 'cash',
        charge_currency: listing.price_currency ?? 'RWF',
        // Nothing is held because nothing was taken. 'released' is the honest
        // value of the three this column allows.
        hold_status: 'released',
        cash_estimate_rwf: total,
        created_at: new Date().toISOString(),
      })
      .select('*')
      .single();
    if (insErr) return json({ error: insErr.message }, 409);

    // PayHold keeps the record of what this trip is worth, even though no rail
    // will ever see it. Best-effort on purpose: the booking exists, the car is
    // held and two people have an agreement — a bookkeeping call that failed
    // must not read back to the renter as "your booking did not happen". The
    // response says whether it landed so the caller is not guessing.
    let recorded: { dealId?: string; error?: string } = {};
    if (payholdConfigured() && profile?.payhold_seller_id) {
      try {
        const deal = await recordCashDeal({
          sellerId: String(profile.payhold_seller_id),
          buyerRef: uid,
          description: `${listing.title ?? 'Car rental'} — cash on pickup`,
          amount: total,
          currency: String(listing.price_currency ?? 'RWF'),
          buyerCountry: String(listing.country ?? 'RW').toUpperCase(),
          reference: bookingId,
          expectedCompleteAt: `${endDate}T12:00:00Z`,
        });
        recorded = { dealId: deal.id };
        await admin.from('bookings').update({ payhold_deal_id: deal.id }).eq('id', bookingId);
      } catch (e) {
        recorded = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    return json({ booking: toCamelRow(row), payhold: recorded }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
