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

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  addSellerDestination,
  createSeller,
  findSellerByExternalUserId,
  payholdConfigured,
  payoutProviderFor,
  payoutRailFromRoute,
  payoutRouteFor,
  sellerCapabilities,
  sellerDestinations,
  type PayoutMethod,
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
/**
 * Null when the seller PayHold found has no destination at all — reachable
 * since `20260814000001` lets `payhold-ensure-seller` create one with none.
 * The caller falls back to what the host just typed in that case; there is no
 * rail on file to read one from.
 */
function methodForProvider(provider: PayoutProvider | null): string | null {
  if (!provider) return null;
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

/**
 * Move a host's payout destination — the second and every later save.
 *
 * PayHold registers the new destination as the seller's one destination —
 * archiving the old one, which is never paid again — and puts it
 * inside §5.1's security hold: unverified, and frozen for a window measured in
 * hours. Payouts pause for that window. That is the trade this operation makes
 * and the screen says so, because the alternative — letting a fresh destination
 * be paid immediately — is an account takeover's entire plan.
 *
 * `payout_status` goes back to 'pending' for the same reason. It is not a
 * demotion of the host: bookings gate on `payhold_seller_id`, which does not
 * move here, so their cars stay bookable while the new account is checked.
 */
async function changeDestination(
  admin: SupabaseClient,
  uid: string,
  sellerId: string,
  method: PayoutMethod,
  payoutProvider: PayoutProvider,
  raw: string,
  country: string,
  network: string,
  bankCode: string,
  currency: string,
): Promise<Response | null> {
  // Country and currency are stated on every destination, not inferred.
  //
  // There used to be a `sellerDestinations` lookup here purely to decide
  // whether this was the host's first destination, because PayHold only
  // *requires* country on the first one and restating an established fact
  // looked like a chance to restate it wrongly. Two problems: it spent a round
  // trip on every destination change to answer a question the answer no longer
  // depends on, and omitting country is what stranded a host who had moved —
  // PayHold fell back to the country of their first destination and refused
  // the new one for a market they had already left.
  //
  // So the lookup is gone and both facts are always sent. `profile.country` is
  // read once at the top of the request and is the same value the payout
  // screen resolved its route against, so client and server cannot disagree.

  let destination;
  try {
    ({ destination } = await addSellerDestination(sellerId, {
      payoutProvider,
      destination: raw,
      // Which wallet, or which bank. PayHold used to infer these and refuses
      // to now — an inferred wrong one registered a destination Flutterwave
      // will not transfer to, and nothing said so until a payout failed.
      ...(network ? { network } : {}),
      ...(bankCode ? { bankCode } : {}),
      // **Every time, not only on the first destination.**
      //
      // This used to be `firstDestination ? { country } : {}`, on the
      // reasoning that a seller's country is already established and restating
      // it is a chance to restate it wrongly. That held while a host could not
      // move. They can now, and the omission made the move impossible to
      // complete: PayHold falls back to `body.country ?? seller.country`, and
      // `seller.country` is wherever the host registered their *first*
      // destination — so a host who moved to the United States was still
      // judged in Rwanda, and PayPal refused with "paypal cannot pay a
      // destination in RW" naming a country they had already changed.
      //
      // `country` here is `profile.country`, read at the top of the request,
      // which is the same value the payout screen resolved its route against.
      country,
      // Sent with it, always, because the two are one fact. PayHold pairs a
      // supplied country with the *stored* `payout_currency` when no currency
      // arrives — which is how "in RW … Paid in RWF" survives a move to the
      // US. The client sends the currency its offer was actually based on, so
      // the pair PayHold stores is the pair the host was shown.
      ...(currency ? { currency: String(currency).toUpperCase() } : {}),
      label: METHOD_LABEL[method] ?? 'Payout',
    }));
  } catch (e) {
    // Our column names a seller PayHold has never heard of — a profile carried
    // between environments, a seller id written by hand, or a tenant sandbox
    // reset, which is a documented and repeatable owner action rather than an
    // accident. "Seller <uuid> not found" is PayHold telling us about our own
    // bookkeeping, and it is ours to repair.
    //
    // This used to stop here with "contact support and we will reconnect it",
    // which stranded the host permanently: nothing cleared the column, so
    // every later attempt took this same branch and hit the same wall. After a
    // reset that is every linked host at once, and support has no button
    // either.
    //
    // So the stale link is dropped and the caller falls through to the path it
    // already has for a profile with no seller — a get-or-create on the
    // client's own `external_user_id`. A seller that still exists under that
    // handle is relinked rather than duplicated; one that is genuinely gone is
    // registered fresh, with the destination the host just typed.
    //
    // **Only a 404 that says the seller is gone.** The refusals that matter to
    // a host — `network_required`, `bank_code_required`, a corridor PayHold
    // will not pay — are 4xx but never 404, so they still surface as
    // themselves rather than silently unlinking somebody over their own typo.
    //
    // The message check is not belt-and-braces, it is load-bearing. This used
    // to fire on *any* 404, on the reasoning that the call names no other
    // resource so a 404 could only be the seller. PayHold's router now echoes
    // the requested path on an unmatched route — `POST /sellers/<id>/connect
    // is not a route` — which is a 404 that is not about the seller at all,
    // and would have had a mistyped or newly-renamed endpoint quietly clear a
    // host's payout link and re-register them from scratch. Note it also
    // contains the word "sellers", so matching `/seller/i` alone is not
    // enough; the seller-gone message is `Seller <uuid> not found`.
    const notFound = (e as { status?: number }).status === 404;
    const message404 = e instanceof Error ? e.message : String(e);
    const sellerGone = notFound && /seller/i.test(message404) && /not found/i.test(message404);
    if (sellerGone) {
      console.warn(
        `payhold_seller_id ${sellerId} is unknown to PayHold — clearing the stale ` +
          'link and re-registering this host from scratch.',
      );
      const { error: clearErr } = await admin
        .from('profiles')
        .update({
          payhold_seller_id: null,
          // The masked destination and label describe a seller that no longer
          // exists; leaving them would show the host an account they cannot be
          // paid through. `payout_method` deliberately survives — it is their
          // own preference, and the create path reads it.
          payout_destination: null,
          payout_label: null,
          payout_status: null,
        })
        .eq('id', uid);
      if (clearErr) return json({ error: clearErr.message }, 500);

      // Null, not a Response: the caller reads this as "there was no usable
      // link" and carries on into registration.
      return null;
    }
    throw e;
  }

  const maskedDestination = destination.masked_destination ?? mask(raw);

  const { error: upErr } = await admin
    .from('profiles')
    .update({
      payout_method: method,
      payout_provider: 'payhold',
      payout_destination: maskedDestination,
      payout_label: `${METHOD_LABEL[method] ?? 'Payout'} · ${maskedDestination}`,
      // Back to pending, truthfully. PayHold will not pay this destination
      // until it has verified it, and a profile that still said 'active' would
      // be telling the host their money is on its way to an account nothing has
      // checked.
      payout_status: 'pending',
    })
    .eq('id', uid);
  if (upErr) return json({ error: upErr.message }, 500);

  const caps = await sellerCapabilities(sellerId).catch(() => null);
  if (caps?.can_receive_payouts) {
    await admin.from('profiles').update({ payout_status: 'active' }).eq('id', uid);
  }

  return json(
    {
      sellerId,
      maskedDestination,
      changed: true,
      relinked: false,
      securityHoldUntil: destination.security_hold_until,
      canReceivePayouts: caps?.can_receive_payouts ?? false,
      reasons: caps?.reasons ?? [],
      routeReasons: caps?.route_reasons ?? [],
    },
    200,
  );
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

    const { method, destination, network, bankCode, currency } = await req.json();
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
    const country = String(profile.country).toUpperCase();
    const raw = String(destination).trim();
    // The number alone no longer identifies a destination. PayHold used to
    // guess the wallet from the prefix and the bank from nothing at all, and a
    // wrong guess is a destination Flutterwave silently will not transfer to —
    // so it refuses both without these now, and so do we, with a message that
    // names the missing thing rather than passing on a policy_violation.
    const networkName = typeof network === 'string' ? network.trim() : '';
    const bank = typeof bankCode === 'string' ? bankCode.trim() : '';

    // Computed once, here, so registering and changing a destination refuse
    // the exact same combinations rather than two call sites drifting apart.
    // `null` means no PayHold rail reaches this method in this country at
    // all — Card in one of Flutterwave's African corridors, today — and a
    // destination created anyway would sit at `blocked` forever rather than
    // ever being fixable by the host.
    let payoutProvider = payoutProviderFor(method as PayoutMethod, country);

    // A refusal is checked against PayHold before it reaches the host.
    //
    // `payoutProviderFor` reads a hardcoded copy of PayHold's routing, because
    // this decision has to be made synchronously, before anything is
    // tokenized. That is worth keeping — but it makes every `null` here
    // unfalsifiable, and a stale table has twice refused hosts who could have
    // been paid, silently, for as long as it took a person to notice.
    //
    // So the fast path still decides, and only a refusal pays for a second
    // opinion: one route lookup, on the rare branch, before telling somebody
    // there is no way to pay them. If PayHold disagrees, PayHold is right — it
    // is the authority and this is the copy — and the host is registered
    // against the rail it named while the disagreement goes to the log for the
    // table to be corrected. If PayHold agrees, or cannot be reached, the
    // refusal stands exactly as before and nothing is registered.
    // What PayHold said this market actually takes, when we had to ask. Used
    // by the refusal below to name real alternatives instead of guessing.
    let liveMethods: string[] | null = null;

    if (!payoutProvider) {
      try {
        const route = await payoutRouteFor(country);
        liveMethods = route.payout?.methods ?? null;
        const liveRail = payoutRailFromRoute(method as PayoutMethod, route);
        if (liveRail) {
          console.warn(
            `[payhold-register-seller] stale payout table for ${country}: ` +
              `payoutProviderFor() refused ${method} but PayHold routes it as ` +
              `${route.payout?.provider ?? 'none'}/${route.payout?.kind ?? 'none'} → ` +
              `${liveRail}. Registering against PayHold's answer and continuing. ` +
              `Correct FLUTTERWAVE_PAYOUT_KIND / NO_PAYOUT_RAIL in ` +
              `_shared/payhold.ts against PayHold's generated countries.ts ` +
              `(membership = flutterwavePayout, kind = momoPayout).`,
          );
          payoutProvider = liveRail;
        }
      } catch (err) {
        // PayHold unreachable. The refusal below is the fail-closed answer and
        // is what this path did before the check existed, so a route lookup
        // being down can only cost the host the old behaviour, never a
        // destination that cannot be paid.
        console.warn(
          `[payhold-register-seller] could not confirm the ${country} refusal ` +
            `against PayHold (${err instanceof Error ? err.message : String(err)}); ` +
            `refusing on the local table as before.`,
        );
      }
    }

    if (!payoutProvider) {
      // Say what this market *does* take, and stop blaming the market.
      //
      // This used to read "isn't a way to get paid in this market yet — try
      // Mobile Money or Bank instead", which was wrong twice over for the US
      // host who reported it: the refusal was not about their market at all
      // (AutoHire refused PayPal everywhere), and Mobile Money does not exist
      // in the United States, so the one piece of advice in the sentence sent
      // them looking for something that was never there.
      //
      // `liveMethods` is PayHold's own answer for this country and we already
      // paid for it on the branch above, so the alternatives are real ones
      // rather than a guess. When PayHold could not be reached there is no
      // list, and the honest sentence names no alternatives at all.
      const alternatives = (liveMethods ?? [])
        .filter((m) => m !== method)
        .map((m) => (m === 'connect' ? 'Bank or Card' : METHOD_LABEL[m] ?? m));
      const label = METHOD_LABEL[method as PayoutMethod] ?? method;
      return json(
        {
          error: alternatives.length > 0
            ? `${label} isn't a way to get paid here yet — try ${
              alternatives.join(' or ')
            } instead.`
            : `${label} isn't a way to get paid here yet.`,
          code: 'unsupported_payout_method',
        },
        400,
      );
    }

    if (payoutProvider === 'flutterwave_momo' && !networkName) {
      return json(
        {
          error: 'Choose which mobile money network this number is on.',
          code: 'network_required',
        },
        400,
      );
    }
    if (payoutProvider === 'flutterwave_bank' && !bank) {
      return json(
        { error: 'Choose which bank this account is with.', code: 'bank_code_required' },
        400,
      );
    }

    // A host who already has a seller is CHANGING where they are paid, not
    // registering. Those are different operations and PayHold treats them as
    // such: a second `POST /sellers` under the same handle is refused, because
    // silently accepting one would be a destination change that skipped §5.1's
    // security hold — which is exactly what a takeover wants.
    //
    // This used to be a 409 telling the host to contact support, which is a
    // wall in front of something every host eventually needs: a MoMo line gets
    // cut off, a bank account closes, and the money keeps being sent somewhere
    // they can no longer reach.
    if (profile.payhold_seller_id) {
      const changed = await changeDestination(
        admin,
        uid,
        String(profile.payhold_seller_id),
        method as PayoutMethod,
        payoutProvider,
        raw,
        country,
        networkName,
        bank,
        currency ? String(currency).toUpperCase() : '',
      );
      // A Response means the change was answered, one way or another. Null
      // means the link was stale and has just been cleared — so this host is
      // now exactly a host with no seller, and falls into the registration
      // path below rather than being told to contact support about a row
      // nobody can see.
      if (changed) return changed;
      profile.payhold_seller_id = null;
    }

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
      // value stands; failing that, the rail on the seller PayHold found; and
      // if that seller has no destination either — found with nothing to
      // relink, the case a destination-less `payhold-ensure-seller` record
      // makes possible — there is nothing to defer to but what they just typed.
      const storedMethod = relinked
        ? ((profile.payout_method as string | null) ?? methodForProvider(seller.payout_provider) ??
          (method as string))
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
        payoutProvider,
        destination: raw,
        // See `changeDestination` — PayHold refuses a momo destination with no
        // wallet named and a bank one with no bank code, rather than guessing.
        ...(networkName ? { network: networkName } : {}),
        ...(bank ? { bankCode: bank } : {}),
        // Same reason as the destination path below: a first-time seller whose
        // chosen currency is dropped here is created against the country's own,
        // and their first destination inherits it.
        ...(currency ? { payoutCurrency: String(currency).toUpperCase() } : {}),
        // Same label `changeDestination` already sends on every later save —
        // this was the gap: a host's very first destination had no label at
        // all, so PayHold's own mask (guessed from a Flutterwave field that is
        // unset for every RWF corridor) was the only word describing it.
        label: METHOD_LABEL[method] ?? 'Payout',
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
    // A 404 that is not "seller gone" is never the host's doing — a route we
    // asked for that does not exist, a resource we named wrongly. PayHold now
    // echoes the path in that message, so forwarding it verbatim would put
    // `POST /sellers/<uuid>/connect is not a route` in front of a car owner as
    // a toast. They cannot act on it and it is ours to fix, so they get a
    // sentence that says so and the real one goes to the log.
    if (status === 404) {
      const raw = e instanceof Error ? e.message : String(e);
      console.error(`[payhold-register-seller] unexpected 404 from PayHold: ${raw}`);
      return json(
        {
          error:
            "Something on our side isn't set up right, so we couldn't save that. " +
            "Your earnings are safe — please try again shortly.",
          code: 'payhold_unexpected_404',
        },
        502,
      );
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
