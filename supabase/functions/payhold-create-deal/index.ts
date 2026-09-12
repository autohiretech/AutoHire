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
  createSeller,
  DAILY_OVERAGE_GRACE_HOURS,
  findSellerByExternalUserId,
  PayHoldError,
  payholdConfigured,
  sessionToken,
  toMinorUnits,
  type Seller,
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

    const {
      listingId,
      startDate,
      endDate,
      preferredMethod,
      payerRef,
      buyerCountry,
      presentmentCurrency,
      pickupTime,
      rentalType,
      estimatedHours,
    } = await req.json();

    // Daily unless the renter picked hourly — old callers with no rentalType
    // still get today's behavior exactly.
    const isHourly = rentalType === 'hourly';
    const hours = Number(estimatedHours);

    // Which market to charge the renter's card as. Defaults to their profile's
    // country below, but a renter paying with a foreign card can name a
    // different one here — PayHold prices the deal in whatever currency that
    // market's rails serve, so this is how "charge me in a currency my card
    // actually accepts" is answered without asking them to change their
    // account's country just to pay for one trip.
    const buyerCountryOverride =
      typeof buyerCountry === 'string' && buyerCountry.trim() ? buyerCountry.trim().toUpperCase() : '';

    // Which currency the renter is CHARGED in. Separate from the country above
    // — a renter in Rwanda may still want to be charged in USD — and entirely
    // separate from the deal's own `currency`, which stays the car's and is
    // what the host is owed. Validated as an ISO shape only: PayHold owns the
    // question of whether it can actually collect this one, and a list here
    // would be the hardcoded-country-list mistake again in another column.
    const presentment =
      typeof presentmentCurrency === 'string' && /^[A-Za-z]{3}$/.test(presentmentCurrency.trim())
        ? presentmentCurrency.trim().toUpperCase()
        : '';

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
    if (!/^\d{2}:\d{2}$/.test(String(pickupTime ?? ''))) {
      return json({ error: 'pickupTime (HH:mm) is required.' }, 400);
    }
    if (isHourly && !(Number.isInteger(hours) && hours > 0)) {
      return json({ error: 'estimatedHours must be a positive whole number.' }, 400);
    }

    // --- Who may rent ------------------------------------------------------
    const { data: renter } = await admin
      .from('profiles')
      .select('role, owner_type, country, full_name')
      .eq('id', uid)
      .single();
    if (renter?.owner_type === 'business') {
      return json({ error: 'Company accounts cannot rent — they can only view cars.' }, 403);
    }
    if (renter?.role === 'owner') {
      return json({ error: 'Host accounts cannot rent — they can only view cars.' }, 403);
    }

    // --- What is being rented ----------------------------------------------
    const { data: listing, error: listErr } = await admin
      .from('listings')
      .select(
        'title, price_per_day_rwf, price_currency, country, host_id, blocked_dates, pricing_mode, price_per_hour_rwf, overage_multiplier',
      )
      .eq('id', listingId)
      .single();
    if (listErr || !listing) return json({ error: 'Listing not found.' }, 404);
    if (listing.host_id === uid) return json({ error: 'You cannot book your own car.' }, 403);
    // A car is priced one way or the other, never both — the renter's choice
    // has to match exactly what the host set, not just be compatible with it.
    // Normalized (isHourly ? 'hourly' : 'daily'), not the raw body value, so
    // an old caller sending no rentalType at all still reads as 'daily'
    // rather than failing this check on `undefined`.
    if ((isHourly ? 'hourly' : 'daily') !== listing.pricing_mode) {
      return json(
        {
          error:
            listing.pricing_mode === 'hourly'
              ? 'This car is booked by the hour, not by the day.'
              : 'This car is booked by the day, not by the hour.',
          code: 'wrong_rental_type',
        },
        400,
      );
    }

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
    // can be paid for. That used to mean payouts had to be set up first — the
    // only door was `payhold-register-seller`, which requires a destination —
    // so a renter booking a host who had not reached payout setup was refused
    // outright with a message blaming missing payout methods. As of PayHold's
    // `20260814000001`, that is no longer true: `POST /v1/sellers` accepts a
    // bare `{ name, external_user_id }`, money can accrue against a seller with
    // no payout destination at all, and every host is registered that way the
    // moment they toggle to `role: 'owner'` — see `payhold-ensure-seller`.
    //
    // So by the time a renter reaches checkout, `payhold_seller_id` is normally
    // already there. A miss here is not "this host hasn't finished setting up
    // payouts" — it means the *link* is missing (an interrupted toggle, a
    // profile restored from a backup, an account older than
    // `payhold-ensure-seller`), and that is exactly what `payhold-ensure-seller`
    // repairs. So it is repaired here too, inline, rather than turning a fact
    // about our own bookkeeping into a renter-facing refusal that blames the
    // host for something they did nothing wrong to cause. The booking only
    // fails now if PayHold itself cannot be reached to do that repair.
    const { data: host } = await admin
      .from('profiles')
      .select('id, full_name, business_name, payhold_seller_id')
      .eq('id', listing.host_id)
      .single();

    /**
     * Establish the host's PayHold seller link and persist it, from scratch.
     *
     * Used for a host who has no link yet, and again when the link they have
     * turns out to be dead — see the retry around `createDeal` below. Throws
     * if PayHold cannot be reached to do it; the caller decides what a
     * renter sees.
     */
    const linkSeller = async (): Promise<string> => {
      const existing = await findSellerByExternalUserId(listing.host_id).catch(() => null);
      let seller: Seller;
      if (existing) {
        seller = existing;
      } else {
        try {
          ({ seller } = await createSeller({
            name: (host?.business_name as string | null) ?? (host?.full_name as string) ??
              'AutoHire host',
            // No country, no payoutProvider, no destination — this mirrors
            // `payhold-ensure-seller` exactly: none of that exists yet, and
            // `payhold-register-seller` is still the only place a raw payout
            // number is ever typed.
            externalUserId: listing.host_id,
          }));
        } catch (e) {
          // Two renters racing to book the same never-linked host both reach
          // the create; PayHold refuses the second on its unique handle.
          // Re-ask rather than treating that as a real failure.
          if ((e as { code?: string }).code === 'policy_violation') {
            const raced = await findSellerByExternalUserId(listing.host_id);
            if (!raced) throw e;
            seller = raced;
          } else {
            throw e;
          }
        }
      }
      await admin.from('profiles').update({ payhold_seller_id: seller.id }).eq('id', listing.host_id);
      return seller.id;
    };

    let sellerId = host?.payhold_seller_id as string | null;
    if (!sellerId) {
      try {
        sellerId = await linkSeller();
      } catch {
        return json(
          {
            error: 'This car is not available for booking right now — please try again in a moment.',
            code: 'host_registration_unavailable',
          },
          409,
        );
      }
    }

    // --- The money ----------------------------------------------------------
    const days = diffDays(startDate, endDate);
    const pricePerHour = Number(listing.price_per_hour_rwf ?? 0);
    // The late-return rate for a daily booking.
    //
    // `overage_multiplier` is a multiple of an *implied* hourly price, and the
    // host-facing form has always spelled out what implies it: "day price ÷
    // 24" (ListCarPage). This computed it from `price_per_hour_rwf` instead —
    // a column daily listings never set — so the rate was 0 for all 429 of
    // them, and a late return billed the host's follow-up figure as nothing.
    // Falling back to the day rate is what the form already promises, not a
    // new price.
    const impliedHourly = pricePerHour > 0
      ? pricePerHour
      : Number(listing.price_per_day_rwf ?? 0) / 24;
    const overageRate = Math.round(impliedHourly * Number(listing.overage_multiplier ?? 2));

    // `subtotal` is the full estimate, charged now, for both rental types.
    // For an hourly car any time beyond the estimate is collected
    // automatically by PayHold itself — overage_rate below — the moment both
    // sides confirm the trip is over, on the card the renter paid with, or
    // the trip pauses for the host to collect by hand if the renter paid by
    // a method with no reusable credential (mobile money). An early return
    // still needs payhold-settle-usage's own refund, since PayHold's overage
    // can only ever add to what was charged, never take away — it cannot
    // know the trip ran short of the estimate.
    const estimatedTotal = isHourly ? hours * pricePerHour : (listing.price_per_day_rwf as number) * days;
    const subtotal = estimatedTotal;
    const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE);
    const total = subtotal + serviceFee;
    const dealAmount = total;

    // Always the car's own currency — the renter's market never re-denominates
    // it. PayHold converts to something the renter's country can actually be
    // charged in and carries the FX itself.
    const currency = String(listing.price_currency ?? 'RWF').toUpperCase();

    // What an extra hour is billed at, in minor units, per rental type.
    // Hourly has never carried the penalty multiplier — it bills late time at
    // the same flat rate the booking is already priced in — and daily has
    // always carried it. `overageRate` above is the daily figure; this is the
    // one that actually goes to PayHold, so it has to branch.
    const overageMinor = toMinorUnits(isHourly ? pricePerHour : overageRate, currency);


    // The moment the ESTIMATE says the car should be back.
    //
    //   hourly — pickup plus the hours the renter asked for. Late past this
    //            is what PayHold's overage charges for, at the same flat
    //            per-hour rate this booking already uses — hourly has never
    //            charged a penalty rate, only the daily case does.
    //   daily  — end_date at the agreed return time, plus the same 2-hour
    //            grace AutoHire has always given a daily return before it
    //            counts as late. Pushing PayHold's own deadline out by the
    //            grace, rather than leaving it at the bare agreed time, is
    //            what keeps PayHold's automatic charge from firing earlier
    //            than a renter has ever been told to expect.
    //
    // Computed on the branch that is actually used, never both. `hours` is
    // `Number(estimatedHours)`, and a daily booking has no estimatedHours to
    // send — so the hourly expression is `NaN` for every daily booking, and
    // `new Date(NaN).toISOString()` throws `RangeError: Invalid time value`.
    // Evaluating it eagerly meant every daily checkout died with a 500 before
    // PayHold was ever called.
    const expectedCompleteAt = isHourly
      ? new Date(
          new Date(`${startDate}T${pickupTime}:00Z`).getTime() + hours * 3_600_000,
        ).toISOString()
      : new Date(
          new Date(`${endDate}T${pickupTime}:00Z`).getTime() +
            DAILY_OVERAGE_GRACE_HOURS * 3_600_000,
        ).toISOString();

    const buildDeal = (seller: string) => createDeal({
      buyerRef: uid,
      sellerId: seller,
      description: isHourly
        ? `AutoHire — ${listing.title} (${hours}hr estimate)`
        : `AutoHire — ${listing.title} (${days} day${days === 1 ? '' : 's'})`,
      amount: toMinorUnits(dealAmount, currency),
      currency,
      // The renter's own country, not the car's market — unless they picked a
      // different one for this payment. Either way, this is what decides what
      // they can pay with and which currency their card is actually charged in.
      buyerCountry: buyerCountryOverride || (renter?.country as string | null) || undefined,
      // What the renter asked to be charged in, when they picked. Never
      // touches `currency` above — the host is owed the car's currency
      // whatever the renter's card was charged, and PayHold carries the FX
      // between the two.
      ...(presentment && presentment !== currency ? { presentmentCurrency: presentment } : {}),
      expectedCompleteAt,
      // No split, for either rental type — the full estimate is charged up
      // front. Overage is conditional on going past it, so mobile money
      // stays offered here regardless: if it never happens, nothing needed a
      // reusable credential in the first place, and if it does, the charge
      // attempt fails the same way it does for any provider with no saved
      // method — the trip pauses and the host collects the penalty
      // themselves, the way this always worked before PayHold could ever
      // attempt it automatically. Card renters get it collected
      // automatically the moment both sides confirm the trip is over.
      //
      // **Every deal carries an overage rate, so a late return is collected
      // automatically — and when it cannot be, the host is told the figure.**
      //
      // Sending these two is what switches PayHold's automatic collection on:
      // at confirmation it charges the renter's saved card for whatever the
      // trip ran over. Hourly used to do this and daily never did, so the same
      // late return either billed a card or asked the host to chase it,
      // decided by how the car happened to be listed. Both do it now.
      //
      // The rate differs by type and each is billed what it was quoted:
      // hourly at its own flat hourly rate, which is the price the booking is
      // already denominated in, and daily at the host's penalty multiplier
      // over an implied hourly price their form defines as day ÷ 24. Neither
      // is a new price and the renter is shown theirs before paying
      // (BookingPage).
      //
      // Collection is never certain — a renter who paid by mobile money has
      // no reusable credential, so `chargeSaved` has no token and the charge
      // is refused. That is an ordinary outcome, not an error: PayHold emits
      // `order.balance_charge_failed` with the amount it could not take, the
      // webhook writes it to the booking, and the host is shown exactly what
      // to claim in person. Which is why mobile money stays offered at
      // checkout: overage is conditional, and a trip that ends on time never
      // needed a reusable credential at all.
      //
      // PayHold refuses `overage_rate: 0` outright — both fields must be
      // positive integers or neither may be sent — so a listing with no
      // usable rate sends nothing and settles the old way, by display.
      ...(overageMinor > 0
        ? { overageRate: overageMinor, overageUnitSeconds: 3600 }
        : {}),
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
        rentalType: isHourly ? 'hourly' : 'daily',
        pickupTime: String(pickupTime),
        // Today, "the agreed return time" is the same time-of-day as pickup —
        // back by this time on endDate. Settlement reads it for the daily
        // 2-hour-late overage check; an hourly booking is settled on actual
        // time used and doesn't consult it.
        expectedReturnTime: String(pickupTime),
        // Snapshots of the listing's own rates at booking time — immutable
        // once written, same reasoning as subtotal/serviceFee/total above.
        pricePerHourRwf: String(pricePerHour),
        overageRateRwf: String(overageRate),
        ...(isHourly ? { estimatedHours: String(hours) } : {}),
      },
    });

    /**
     * A stored seller link can be dead, not just missing.
     *
     * `payhold_seller_id` is our copy of an id that lives in PayHold, and the
     * two can diverge — a PayHold environment reset is the way it has
     * actually happened, leaving every host pointing at a seller that no
     * longer exists. The repair above only ever fired on a *missing* link, so
     * a stale one sailed straight past it and PayHold refused the deal with
     * "Seller <id> not found". Every booking for that host failed, hourly and
     * daily alike, and nothing self-healed because from our side the link
     * looked present and fine.
     *
     * So a 404 naming the seller is treated as what it is — evidence our copy
     * is wrong — by re-running the same repair and retrying once. Retried
     * exactly once, and only for this error: a second 404 means PayHold is
     * refusing a seller it just handed us, which is a real fault and belongs
     * in the renter's error rather than in a loop.
     */
    let deal: Awaited<ReturnType<typeof buildDeal>>['deal'];
    let payment_link: Awaited<ReturnType<typeof buildDeal>>['payment_link'];
    try {
      ({ deal, payment_link } = await buildDeal(sellerId!));
    } catch (e) {
      // Both halves matter. PayHold's router echoes the requested path on an
      // unmatched route — `POST /sellers/<id>/deals is not a route` — a 404
      // whose message contains "sellers" and says nothing about this seller
      // existing. On this path a false positive is worse than anywhere else:
      // it sits on the RENTER's booking, so the repair would run, fail, and
      // the failure would be invisible to the host who is the only person able
      // to act on it. The seller-gone message is `Seller <uuid> not found`.
      const stale = e instanceof PayHoldError && e.status === 404 &&
        /seller/i.test(e.message) && /not found/i.test(e.message);
      if (!stale) throw e;
      try {
        sellerId = await linkSeller();
      } catch {
        return json(
          {
            error: 'This car is not available for booking right now — please try again in a moment.',
            code: 'host_registration_unavailable',
          },
          409,
        );
      }
      ({ deal, payment_link } = await buildDeal(sellerId));
    }

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
