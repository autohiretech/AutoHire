// AutoHire — payhold-earnings Edge Function.
//
// Every trip's money and the stage it is at, for one host.
//
// The wallet totals (`payhold-balance`) answer "how much"; this answers "which
// trip, and where is that money right now" — which is the question a host
// actually asks when a number looks wrong. A total nobody can decompose is a
// total nobody trusts.
//
// Three sources, merged:
//   • AutoHire bookings   — the car, the dates, our own figures
//   • PayHold deals       — the money's stage and when it clears
//   • PayHold payouts     — when it was sent, or why it was stopped
//
// Everything is scoped to the calling host's own seller id, taken from their
// session. PayHold's `GET /payouts` is tenant-wide — it returns every host's
// payouts — so the filter here is not a convenience, it is the thing standing
// between one host and another host's earnings.
//
// Secrets:  PAYHOLD_* (see _shared/payhold.ts), ALLOWED_ORIGIN
// Deploy:   supabase functions deploy payhold-earnings

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  getDeal,
  listPayouts,
  payholdConfigured,
  sellerDestinations,
  type Payout,
} from '../_shared/payhold.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

/**
 * Trips fetched per page. Each one is a `GET /deals/:id` round trip — they run
 * in parallel, but an Edge Function has a wall clock and PayHold has a rate to
 * respect, so this is deliberately not "all of them".
 */
const PAGE = 20;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

/**
 * Where a trip's money is, in one word a host can act on.
 *
 * Derived from the deal's status first and the payout's second, because until
 * a payout row exists the deal is the only thing that knows anything. The order
 * of these checks is the order money actually moves.
 */
type Stage =
  | 'awaiting_payment'
  | 'on_trip'
  | 'awaiting_confirmation'
  | 'clearing'
  | 'ready'
  | 'sending'
  | 'paid'
  | 'on_hold'
  | 'disputed'
  | 'refunded'
  | 'cancelled';

function stageFor(dealStatus: string, payout: Payout | undefined): Stage {
  // A stopped payout outranks everything: the money exists, it is the host's,
  // and something is in the way. That is the one thing they need to see.
  if (payout) {
    if (payout.status === 'paid') return 'paid';
    if (payout.status === 'processing') return 'sending';
    if (
      ['failed', 'frozen', 'blocked', 'needs_verification', 'held_for_review'].includes(
        payout.status,
      )
    ) {
      return 'on_hold';
    }
  }

  switch (dealStatus) {
    case 'created':
    case 'checkout_started':
    case 'payment_pending':
      return 'awaiting_payment';
    case 'payment_failed':
    case 'expired':
    case 'canceled':
      return 'cancelled';
    case 'refunded':
    case 'partially_refunded':
      return 'refunded';
    case 'funded_held':
    case 'in_progress':
    case 'revision_requested':
      return 'on_trip';
    // One side has confirmed and the other has not. The money is still held,
    // and saying "on trip" would hide that it is waiting on somebody.
    case 'confirmed_buyer':
    case 'confirmed_seller':
      return 'awaiting_confirmation';
    // NOT awaiting_confirmation. A disputed deal is in the Resolution Center
    // with its payout frozen — telling the host to "confirm the return" would
    // point them at a button that cannot resolve this.
    case 'disputed':
      return 'disputed';
    case 'clearing':
      return 'clearing';
    case 'released':
    case 'payout_pending':
      return 'ready';
    case 'paid_out':
      return 'paid';
    default:
      return 'on_trip';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'GET only.' }, 405);

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
      .select('role, payhold_seller_id')
      .eq('id', uid)
      .single();

    if (profile?.role !== 'owner') return json({ error: 'Only hosts have earnings.' }, 403);

    const sellerId = profile?.payhold_seller_id as string | null;
    if (!sellerId) {
      return json({ sellerId: null, trips: [], destinations: [], hasMore: false }, 200);
    }

    const url = new URL(req.url);
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);

    // The host's own trips, from our database — the car and the dates are ours
    // and asking PayHold for them would be asking the wrong system.
    const { data: bookings } = await admin
      .from('bookings')
      .select(
        'id, listing_id, start_date, end_date, days, state, total_rwf, charge_currency, payhold_deal_id, created_at, rental_type, amount_owed_rwf, amount_exceeded_rwf',
      )
      .eq('host_id', uid)
      .not('payhold_deal_id', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE);

    const rows = bookings ?? [];
    const hasMore = rows.length > PAGE;
    const page = rows.slice(0, PAGE);

    if (page.length === 0) {
      return json({ sellerId, trips: [], destinations: [], hasMore: false }, 200);
    }

    // Car titles in one query rather than one per row.
    const { data: listings } = await admin
      .from('listings')
      .select('id, title, photos')
      .in('id', [...new Set(page.map((b) => b.listing_id))]);
    const titleById = new Map(
      (listings ?? []).map((l) => [
        l.id as string,
        { title: l.title as string, photo: ((l.photos as string[]) ?? [])[0] ?? null },
      ]),
    );

    // Deals in parallel; payouts and destinations once. `listPayouts` is
    // tenant-wide, so it is filtered to this seller before anything is read
    // off it — see the note on the function.
    const [deals, payoutList, destList] = await Promise.all([
      Promise.all(
        page.map((b) =>
          getDeal(b.payhold_deal_id as string).catch(() => null),
        ),
      ),
      listPayouts().catch(() => ({ payouts: [] as Payout[] })),
      sellerDestinations(sellerId).catch(() => ({ destinations: [] })),
    ]);

    const payoutByDeal = new Map<string, Payout>();
    for (const p of payoutList.payouts) {
      if (p.seller_id !== sellerId) continue;
      // Newest first from PayHold, so the first one seen for a deal is the
      // current one and later rows are superseded attempts.
      if (!payoutByDeal.has(p.deal_id)) payoutByDeal.set(p.deal_id, p);
    }

    const trips = page.map((b, i) => {
      const deal = deals[i];
      const payout = deal ? payoutByDeal.get(deal.id) : undefined;
      const listing = titleById.get(b.listing_id as string);

      return {
        bookingId: b.id,
        dealId: b.payhold_deal_id,
        car: listing?.title ?? 'Car',
        photo: listing?.photo ?? null,
        startDate: b.start_date,
        endDate: b.end_date,
        days: b.days,
        tripState: b.state,

        // Unreachable deal → the trip still shows, with what we know. A PayHold
        // hiccup should not blank a host's earnings list.
        stage: deal ? stageFor(deal.status, payout) : 'on_trip',
        dealStatus: deal?.status ?? null,

        currency: deal?.amounts?.currency ?? deal?.currency ?? b.charge_currency ?? 'RWF',
        // What the renter paid, what we took, what the host earns. Separate
        // because a host querying a number is almost always querying the gap.
        gross: deal?.amounts?.buyer_paid ?? null,
        platformFee: deal?.amounts?.platform_fee ?? null,
        providerFee: deal?.amounts?.provider_fee ?? null,
        refunded: deal?.amounts?.refunded ?? null,
        net: deal?.amounts?.seller_net ?? null,

        // When this money becomes sendable, and when it went.
        availableAt: payout?.scheduled_for ?? deal?.payout_due_at ?? null,
        releasedAt: deal?.released_at ?? null,
        paidAt: payout?.paid_at ?? null,
        holdReason: payout?.failure_reason ?? null,
        payoutStatus: payout?.status ?? null,

        // AutoHire's own figure, in whole units — never converted through
        // toMinorUnits, never PayHold's. See EarningTrip's comment.
        rentalType: (b.rental_type as string) === 'hourly' ? 'hourly' : 'daily',
        amountOwedRwf: (b.amount_owed_rwf as number | null) ?? 0,
        amountExceededRwf: (b.amount_exceeded_rwf as number | null) ?? null,
      };
    });

    return json(
      {
        sellerId,
        trips,
        // Where the money can go. `verifiedAt` null or a live
        // `securityHoldUntil` means PayHold will refuse to send there, so the
        // screen must show why rather than offering it as a choice.
        destinations: destList.destinations.map((d) => ({
          id: d.id,
          label: d.label,
          country: d.country,
          payoutCurrency: d.payout_currency,
          maskedDestination: d.masked_destination,
          isPrimary: d.is_primary,
          isBackup: d.is_backup,
          verifiedAt: d.verified_at,
          securityHoldUntil: d.security_hold_until,
        })),
        hasMore,
        offset,
      },
      200,
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
