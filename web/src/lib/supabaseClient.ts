import type {
  AdminStats,
  AppNotification,
  Booking,
  Conversation,
  Dispute,
  DisputeStatus,
  Flag,
  Host,
  HostEarnings,
  Listing,
  Message,
  ModerationStatus,
  PaymentMethodType,
  PayholdDispute,
  PayholdRefund,
  PayholdSeller,
  PayholdWallet,
  Payout,
  PayoutDestination,
  PayoutMethodType,
  PayoutProvider,
  Review,
  UserProfile,
  VerificationDocType,
  VerificationDocument,
  VerificationReviewItem,
  VerificationEvent,
  VerificationStatus,
  KycMetrics,
  KycOwner,
  KycProfile,
  Page,
  ElectricQuota,
  AdminUser,
  AdminAction,
} from '@autohire/shared';
import {
  type CreateListingInput,
  type CreateReviewInput,
  type ListingFilters,
} from '@/lib/types';
import { getSupabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/identity';
import type { PayoutCountry } from '@/lib/payments';

/**
 * The Supabase-backed data client — the single implementation the app runs on.
 * `client.ts` re-exports it as `client` and derives the `Client` type from it.
 *
 * Identity comes from the logged-in Supabase session. Under "fresh signups
 * start empty" the acting user is one identity that backs both the renter and
 * host views, so `me()` drives renter_id and host_id alike.
 */
const me = () => getCurrentUserId();

const sb = () => getSupabase();

/** snake_case DB column -> camelCase domain key. */
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function mapRow<T>(row: Record<string, unknown> | null | undefined): T | undefined {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const ck = toCamel(k);
    // numeric(2,1) comes back as a string from PostgREST — coerce ratings to number.
    out[ck] = ck === 'ratingAvg' && typeof v === 'string' ? Number(v) : v;
  }
  return out as T;
}

function mapRows<T>(rows: Record<string, unknown>[] | null): T[] {
  return (rows ?? []).map((r) => mapRow<T>(r) as T);
}

/** Await a PostgREST builder, throwing on error and returning data. */
async function run<D>(builder: PromiseLike<{ data: D; error: { message: string } | null }>): Promise<D> {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}

/**
 * chat-files is a private bucket: messages store the storage path (or, for
 * rows from before the bucket went private, its old public URL), and rendering
 * goes through short-lived signed URLs minted here in one batch.
 */
async function signChatAttachments(msgs: Message[]): Promise<Message[]> {
  const toPath = (v: string): string | null => {
    if (!v.startsWith('http')) return v;
    const i = v.indexOf('/chat-files/');
    return i === -1 ? null : decodeURIComponent(v.slice(i + '/chat-files/'.length));
  };
  const pathByMessage = new Map<string, string>();
  for (const m of msgs) {
    const p = m.attachmentUrl ? toPath(m.attachmentUrl) : null;
    if (p) pathByMessage.set(m.id, p);
  }
  if (pathByMessage.size === 0) return msgs;
  const { data } = await sb()
    .storage.from('chat-files')
    .createSignedUrls([...new Set(pathByMessage.values())], 3600);
  const urlByPath = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
  }
  return msgs.map((m) => {
    const p = pathByMessage.get(m.id);
    const url = p ? urlByPath.get(p) : undefined;
    return url ? { ...m, attachmentUrl: url } : m;
  });
}

export const supabaseClient = {
  // --- Listings ----------------------------------------------------------
  /**
   * Every matching listing, best-rated first. The order matters: the home page's
   * "Featured" slideshow takes the first five of these, and without an ORDER BY
   * PostgREST returns rows in whatever order Postgres pleases (in practice, insertion
   * order) — so the six oldest fixture rows permanently occupied the hero.
   */
  async listListings(filters: ListingFilters = {}): Promise<Listing[]> {
    let q = sb().from('listings').select('*');
    if (filters.country) q = q.eq('country', filters.country);
    if (filters.city) q = q.eq('city', filters.city);
    if (filters.category) q = q.eq('category', filters.category);
    if (filters.ownerType) q = q.eq('owner_type', filters.ownerType);
    if (filters.transmission) q = q.eq('transmission', filters.transmission);
    if (filters.fuel) q = q.eq('fuel', filters.fuel);
    if (filters.minSeats) q = q.gte('seats', filters.minSeats);
    if (filters.maxPriceRwf) q = q.lte('price_per_day_rwf', filters.maxPriceRwf);
    if (filters.query) {
      const t = `%${filters.query}%`;
      q = q.or(`title.ilike.${t},make.ilike.${t},model.ilike.${t}`);
    }
    // Ordering goes last: `.order()` returns a transform builder with no `.eq()`.
    const ordered = q.order('rating_avg', { ascending: false }).order('id', { ascending: true });
    return mapRows<Listing>(await run(ordered));
  },
  /**
   * Paginated listings — same filters as `listListings`, but returns one page
   * plus the total match count so the browse grid can show page controls instead
   * of every car at once. `sort: 'rating'` ranks by rating (highest first);
   * otherwise results are ordered by id for stable paging.
   */
  async listListingsPage(
    filters: ListingFilters = {},
    page = 0,
    pageSize = 24,
    sort?: 'rating',
  ): Promise<{ items: Listing[]; total: number }> {
    let base = sb().from('listings').select('*', { count: 'exact' });
    if (filters.country) base = base.eq('country', filters.country);
    if (filters.city) base = base.eq('city', filters.city);
    if (filters.category) base = base.eq('category', filters.category);
    if (filters.ownerType) base = base.eq('owner_type', filters.ownerType);
    if (filters.transmission) base = base.eq('transmission', filters.transmission);
    if (filters.fuel) base = base.eq('fuel', filters.fuel);
    if (filters.minSeats) base = base.gte('seats', filters.minSeats);
    if (filters.maxPriceRwf) base = base.lte('price_per_day_rwf', filters.maxPriceRwf);
    if (filters.query) {
      const t = `%${filters.query}%`;
      base = base.or(`title.ilike.${t},make.ilike.${t},model.ilike.${t}`);
    }
    const ordered =
      sort === 'rating'
        ? base.order('rating_avg', { ascending: false }).order('id', { ascending: true })
        : base.order('id', { ascending: true });
    const from = page * pageSize;
    const { data, error, count } = await ordered.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return { items: mapRows<Listing>(data as Record<string, unknown>[]), total: count ?? 0 };
  },
  /**
   * Live foreign-exchange rates (quoted against USD) from the `fx_rates` table,
   * refreshed daily by the `refresh-fx-rates` Edge Function. Returns the newest
   * snapshot so the app can convert prices into the shopper's currency. Rows are
   * one per currency: { code, rate } where rate = units per 1 USD.
   */
  async getFxRates(): Promise<{ base: string; asOf: string; rates: Record<string, number> }> {
    const rows = (await run(
      sb()
        .from('fx_rates')
        .select('quote, rate, as_of')
        .eq('base', 'USD')
        .order('as_of', { ascending: false }),
    )) as { quote: string; rate: number; as_of: string }[] | null;
    const list = rows ?? [];
    const asOf = list[0]?.as_of ?? new Date().toISOString().slice(0, 10);
    // Keep only the newest as_of per currency (the query is date-desc ordered).
    const rates: Record<string, number> = {};
    for (const r of list) if (!(r.quote in rates)) rates[r.quote] = Number(r.rate);
    rates.USD = 1;
    return { base: 'USD', asOf, rates };
  },
  /**
   * AI Mode search: send a natural-language query to the `ai-search` Edge
   * Function, which uses Claude (server-side) to turn it into ListingFilters.
   * Returns the filters so the caller runs the normal `listListings` query.
   * Throws a friendly message when the function isn't deployed or AI isn't
   * configured, so the UI can fall back to plain keyword search.
   */
  async aiSearch(query: string): Promise<ListingFilters> {
    const { data, error } = await getSupabase().functions.invoke('ai-search', {
      body: { query },
    });
    if (error) {
      throw new Error(
        error.name === 'FunctionsFetchError'
          ? "AI search isn't deployed yet — deploy the ai-search Edge Function."
          : error.message,
      );
    }
    const payload = data as { filters?: ListingFilters; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload?.filters ?? {};
  },
  async getListing(id: string) {
    return mapRow<Listing>(await run(sb().from('listings').select('*').eq('id', id).maybeSingle()));
  },
  async getHost(id: string) {
    // Full row only for self / admins / booking or conversation counterparties
    // (RLS filters it out otherwise) — everyone else gets the PII-free view.
    const full = await run(sb().from('profiles').select('*').eq('id', id).maybeSingle());
    if (full) return mapRow<Host>(full);
    return mapRow<Host>(await run(sb().from('public_profiles').select('*').eq('id', id).maybeSingle()));
  },
  async listHosts(): Promise<Host[]> {
    return mapRows<Host>(await run(sb().from('public_profiles').select('*').not('owner_type', 'is', null)));
  },

  // --- Bookings ----------------------------------------------------------
  async listBookings() {
    return mapRows<Booking>(
      await run(sb().from('bookings').select('*').order('created_at', { ascending: false })),
    );
  },
  async getBooking(id: string) {
    return mapRow<Booking>(await run(sb().from('bookings').select('*').eq('id', id).maybeSingle()));
  },
  /**
   * Finalise a booking. There is no client-side insert: the `confirm-booking`
   * Edge Function recomputes the amounts and writes the row with the service
   * role, so the renter can't set their own price, days or status. RLS blocks
   * direct client inserts (migration-029), so this is the ONLY path in both
   * modes — including demo.
   *
   * In live mode it verifies the Stripe PaymentIntent (pass `paymentIntentId`).
   * In demo mode (no Stripe configured server-side) it confirms instantly from
   * the listing + dates — no real charge. listingId/startDate/endDate are sent
   * for both, and the function also enforces the renter's identity verification.
   */
  async confirmBooking(input: {
    listingId: string;
    startDate: string;
    endDate: string;
    paymentIntentId?: string;
    /** External hold system: the hold's reference (re-read server-side). */
    reference?: string;
  }): Promise<Booking> {
    const { data, error } = await getSupabase().functions.invoke('confirm-booking', {
      body: input,
    });
    if (error) {
      throw new Error(
        error.name === 'FunctionsFetchError'
          ? "Bookings aren't deployed yet — deploy the confirm-booking Edge Function."
          : error.message,
      );
    }
    const payload = data as { booking?: Booking; error?: string };
    if (payload?.error || !payload?.booking) {
      throw new Error(payload?.error ?? 'Could not confirm the booking.');
    }
    return payload.booking;
  },

  /**
   * Open an escrow hold on the external payment system. Returns whatever the
   * browser needs to finish it: a Stripe `clientSecret` (the external system
   * settles through Stripe), a `redirectUrl` to their hosted page, or neither
   * when the hold is already authorised. `reference` then goes to
   * `confirmBooking`, which re-reads the hold server-side before creating a trip.
   */
  async createExternalHold(input: {
    listingId: string;
    startDate: string;
    endDate: string;
    returnUrl?: string;
  }): Promise<{
    reference: string;
    status: string;
    clientSecret?: string;
    redirectUrl?: string;
    totalRwf?: number;
  }> {
    const { data, error } = await getSupabase().functions.invoke('external-create-hold', {
      body: input,
    });
    if (error) {
      throw new Error(
        error.name === 'FunctionsFetchError'
          ? "External payments aren't deployed yet — deploy the external-create-hold Edge Function."
          : error.message,
      );
    }
    const payload = data as {
      reference?: string;
      status?: string;
      clientSecret?: string;
      redirectUrl?: string;
      totalRwf?: number;
      error?: string;
    };
    if (payload?.error || !payload?.reference) {
      throw new Error(payload?.error ?? 'Could not start the payment.');
    }
    return { ...payload, reference: payload.reference, status: payload.status ?? 'pending' };
  },

  /**
   * Open a PayHold deal for a booking and get the hosted checkout link.
   *
   * No booking row exists yet — the renter pays on PayHold's page, and the trip
   * is created by `payhold-webhook` when the money is actually held. The link is
   * a redirect away from AutoHire, so nothing here should be treated as a
   * completed payment.
   */
  async createPayholdDeal(input: {
    listingId: string;
    startDate: string;
    endDate: string;
  }): Promise<{ dealId: string; paymentLink: string; status: string; total: number }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-create-deal', {
      body: input,
    });
    if (error) {
      throw new Error(
        error.name === 'FunctionsFetchError'
          ? "PayHold isn't deployed yet — deploy the payhold-create-deal Edge Function."
          : error.message,
      );
    }
    const payload = data as {
      dealId?: string;
      paymentLink?: string;
      status?: string;
      total?: number;
      error?: string;
    };
    if (payload?.error || !payload?.dealId || !payload?.paymentLink) {
      throw new Error(payload?.error ?? 'Could not start the payment.');
    }
    return {
      dealId: payload.dealId,
      paymentLink: payload.paymentLink,
      status: payload.status ?? 'created',
      total: payload.total ?? 0,
    };
  },

  /**
   * Register this host as a PayHold seller.
   *
   * The raw destination is sent once, to be tokenized, and is never stored on
   * either side — AutoHire keeps the seller id and a mask. This is why payout
   * setup goes through a function rather than a table write.
   */
  async registerPayholdSeller(input: {
    method: PayoutMethodType;
    destination: string;
  }): Promise<{
    sellerId: string;
    maskedDestination: string;
    /**
     * True when PayHold already had a seller for this host and we re-linked it
     * rather than registering a second one. The destination just typed was NOT
     * saved — changing where a host is paid is a different operation, with its
     * own verification and security hold, and it is not built yet.
     */
    relinked: boolean;
    canReceivePayouts: boolean;
    reasons: string[];
    routeReasons: string[];
  }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-register-seller', {
      body: input,
    });
    if (error) throw new Error(error.message);
    const payload = data as {
      sellerId?: string;
      maskedDestination?: string;
      relinked?: boolean;
      canReceivePayouts?: boolean;
      reasons?: string[];
      routeReasons?: string[];
      error?: string;
    };
    if (payload?.error || !payload?.sellerId) {
      throw new Error(payload?.error ?? 'Could not save your payout method.');
    }
    return {
      sellerId: payload.sellerId,
      maskedDestination: payload.maskedDestination ?? '',
      relinked: payload.relinked ?? false,
      canReceivePayouts: payload.canReceivePayouts ?? false,
      reasons: payload.reasons ?? [],
      routeReasons: payload.routeReasons ?? [],
    };
  },

  /**
   * This host's wallet, read live from PayHold — never cached in our database,
   * because a stale balance is one a host makes plans against.
   *
   * `balances` is ledger money in the currency the renter was charged;
   * `withdrawable` is what a withdrawal would move, in the host's own payout
   * currency. A cross-border trip makes those different numbers.
   */
  async payholdBalance(): Promise<PayholdWallet> {
    const { data, error } = await getSupabase().functions.invoke('payhold-balance', {
      method: 'GET',
    });
    if (error) throw new Error(error.message);
    const payload = data as PayholdWallet & { error?: string };
    if (payload?.error) throw new Error(payload.error);
    return {
      sellerId: payload.sellerId ?? null,
      balances: payload.balances ?? [],
      withdrawable: payload.withdrawable ?? [],
      canReceivePayouts: payload.canReceivePayouts ?? false,
      kycStatus: payload.kycStatus ?? 'pending',
      reasons: payload.reasons ?? [],
      routeReasons: payload.routeReasons ?? [],
    };
  },

  /**
   * Every trip's money and the stage it's at, plus where it can be sent.
   *
   * The wallet totals answer "how much"; this answers "which trip, and where is
   * that money" — the question a host asks when a number looks wrong.
   */
  async payholdEarnings(offset = 0): Promise<HostEarnings> {
    const { data, error } = await getSupabase().functions.invoke(
      `payhold-earnings?offset=${offset}`,
      { method: 'GET' },
    );
    if (error) throw new Error(error.message);
    const payload = data as HostEarnings & { error?: string };
    if (payload?.error) throw new Error(payload.error);
    return {
      sellerId: payload.sellerId ?? null,
      trips: payload.trips ?? [],
      destinations: payload.destinations ?? [],
      hasMore: payload.hasMore ?? false,
    };
  },

  /**
   * Ask PayHold to send the cleared money. `destinationId` picks among the
   * host's own registered destinations — it can never name a new address.
   */
  async payholdWithdraw(destinationId?: string): Promise<{ requested: number; message: string }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-balance', {
      method: 'POST',
      body: destinationId ? { destinationId } : {},
    });
    if (error) throw new Error(error.message);
    const payload = data as { requested?: number; message?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return { requested: payload.requested ?? 0, message: payload.message ?? 'Withdrawal requested.' };
  },

  /**
   * Confirm this side of a finished trip. When both sides have, PayHold
   * releases the held money to the host. Which side you are is decided from
   * your session server-side, not passed in.
   */
  async payholdConfirm(bookingId: string): Promise<{ dealStatus: string; side: string }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-confirm', {
      body: { bookingId },
    });
    if (error) throw new Error(error.message);
    const payload = data as { dealStatus?: string; side?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return { dealStatus: payload.dealStatus ?? 'unknown', side: payload.side ?? '' };
  },

  /**
   * This host's PayHold seller record — the thing that decides whether they can
   * be paid at all. Separate from `payholdBalance` because "can PayHold reach
   * me" and "how much is in there" change on different clocks, and the first is
   * what a host needs when a payout has not arrived.
   *
   * `hostId` is admin-only and refused for anyone else, so a host can never
   * read where another host gets paid.
   */
  async payholdSeller(hostId?: string): Promise<PayholdSeller> {
    const { data, error } = await getSupabase().functions.invoke(
      hostId ? `payhold-seller?hostId=${encodeURIComponent(hostId)}` : 'payhold-seller',
      { method: 'GET' },
    );
    if (error) throw new Error(error.message);
    const payload = data as PayholdSeller & { error?: string };
    if (payload?.error) throw new Error(payload.error);
    return {
      sellerId: payload.sellerId ?? null,
      registered: payload.registered ?? false,
      host: payload.host ?? null,
      payout: payload.payout ?? null,
      canReceivePayouts: payload.canReceivePayouts ?? false,
      kycStatus: payload.kycStatus ?? 'unknown',
      reasons: payload.reasons ?? [],
      routeReasons: payload.routeReasons ?? [],
      // Undefined → null, deliberately. See the note on the type: an empty
      // array means "nowhere to be paid" and must not be faked here.
      destinations: payload.destinations ?? null,
    };
  },

  /**
   * Which countries PayHold can collect in and pay out to.
   *
   * The payout screen asks this before offering anything, because the answer
   * used to be a hardcoded eight-country list that promised Bank and Card to
   * markets PayHold refuses. Tenant-wide and slow-moving, so it is cached hard
   * on both sides.
   */
  async payholdPayoutCountries(): Promise<PayoutCountry[]> {
    const { data, error } = await getSupabase().functions.invoke('payhold-payment-options', {
      method: 'GET',
    });
    if (error) throw new Error(error.message);
    const payload = data as { countries?: PayoutCountry[]; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload.countries ?? [];
  },

  /** Where this host's money can be sent, on its own — the narrow read. */
  async payholdDestinations(): Promise<PayoutDestination[]> {
    const { data, error } = await getSupabase().functions.invoke('payhold-seller/destinations', {
      method: 'GET',
    });
    if (error) throw new Error(error.message);
    const payload = data as { destinations?: PayoutDestination[]; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload.destinations ?? [];
  },

  /** Every dispute this person is party to, both raised and received. */
  async payholdDisputes(): Promise<PayholdDispute[]> {
    const { data, error } = await getSupabase().functions.invoke('payhold-dispute', {
      method: 'GET',
    });
    if (error) throw new Error(error.message);
    const payload = data as { disputes?: PayholdDispute[]; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload.disputes ?? [];
  },

  /**
   * Raise a dispute — in PayHold first, then here.
   *
   * This is the call that FREEZES the payout on the booking's deal. A dispute
   * that only lived in AutoHire watched the host's money clear and go out.
   *
   * Which side you are is decided from your session server-side. `amount` is in
   * whole units of the booking's charge currency; omit it to dispute the trip
   * in full.
   */
  async openPayholdDispute(input: {
    bookingId: string;
    reason: string;
    reasonCode?: string;
    amount?: number;
  }): Promise<{
    disputeId: string;
    payholdDisputeId: string | null;
    /** Whether a payout is actually being held. False = a complaint, not a hold. */
    frozen: boolean;
    side: string;
  }> {
    const { data, error } = await getSupabase().functions.invoke('payhold-dispute', {
      body: input,
    });
    if (error) throw new Error(error.message);
    const payload = data as {
      disputeId?: string;
      payholdDisputeId?: string | null;
      frozen?: boolean;
      side?: string;
      error?: string;
    };
    if (payload?.error || !payload?.disputeId) {
      throw new Error(payload?.error ?? 'Could not open the dispute.');
    }
    return {
      disputeId: payload.disputeId,
      payholdDisputeId: payload.payholdDisputeId ?? null,
      frozen: payload.frozen ?? false,
      side: payload.side ?? '',
    };
  },

  /**
   * Send a renter's money back, in full or in part. Hosts may refund their own
   * bookings; admins may refund any. A renter cannot refund themselves — they
   * open a dispute, which freezes the money for a person to decide.
   *
   * The booking is NOT marked refunded by this call. PayHold answers when it
   * accepts the refund; `refund.succeeded` is what says the money landed.
   */
  async payholdRefund(input: {
    bookingId: string;
    reason: string;
    amount?: number;
  }): Promise<PayholdRefund> {
    const { data, error } = await getSupabase().functions.invoke('payhold-refund', {
      body: input,
    });
    if (error) throw new Error(error.message);
    const payload = data as PayholdRefund & { error?: string };
    if (payload?.error || !payload?.dealId) {
      throw new Error(payload?.error ?? 'Could not send the refund.');
    }
    return {
      dealId: payload.dealId,
      dealStatus: payload.dealStatus ?? 'unknown',
      partial: payload.partial ?? false,
      amount: payload.amount ?? null,
      currency: payload.currency ?? 'RWF',
      message: payload.message ?? 'Refund sent.',
    };
  },

  /**
   * Start a Flutterwave collection for an African-market car (card or mobile
   * money). Returns a hosted-payment `link` to redirect to in live mode, or
   * `{ demo: true }` when no provider is configured (the caller then falls back
   * to the demo confirm-booking path).
   */
  async startFlutterwaveCollection(input: {
    listingId: string;
    startDate: string;
    endDate: string;
  }): Promise<{ link?: string; demo?: boolean; txRef?: string }> {
    const { data, error } = await getSupabase().functions.invoke('flutterwave-collect', { body: input });
    if (error) throw new Error(error.message);
    const payload = data as { link?: string; demo?: boolean; txRef?: string; error?: string };
    if (payload?.error) throw new Error(payload.error);
    return payload;
  },

  /**
   * Register a host's raw payout destination with Flutterwave (live) and store
   * only the returned beneficiary token + masked label. Used by payout setup in
   * live mode; the demo path uses `setPayoutMethod` instead.
   */
  async connectPayoutBeneficiary(input: {
    method: 'momo' | 'bank';
    destination: string;
    accountBank?: string;
  }): Promise<UserProfile> {
    const { data, error } = await getSupabase().functions.invoke('flutterwave-beneficiary', { body: input });
    if (error) throw new Error(error.message);
    const payload = data as { profile?: Record<string, unknown>; error?: string };
    if (payload?.error || !payload?.profile) throw new Error(payload?.error ?? 'Could not save destination.');
    return mapRow<UserProfile>(payload.profile) as UserProfile;
  },

  /** Capture the held Stripe authorisation when a trip starts (no-op for Flutterwave). */
  async capturePayment(bookingId: string): Promise<void> {
    await getSupabase().functions.invoke('capture-payment', { body: { bookingId } });
  },

  /** Admin: disburse a scheduled host payout via its provider. */
  async disbursePayout(payoutId: string): Promise<unknown> {
    const { data, error } = await getSupabase().functions.invoke('flutterwave-transfer', {
      body: { payoutId },
    });
    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Confirm one side of a handoff (pickup or return) with proof photos. The
   * server stamps the caller's slot and only advances the trip (→ active /
   * → completed) once BOTH the renter and host have signed off.
   */
  async confirmHandoff(
    bookingId: string,
    phase: 'pickup' | 'return',
    photoUrls: string[],
  ): Promise<Booking> {
    const takenAt = new Date().toISOString();
    const photos = photoUrls.map((url) => ({
      url,
      label: phase === 'pickup' ? 'Pickup' : 'Return',
      takenAt,
    }));
    const row = await run(
      getSupabase().rpc('confirm_handoff', {
        p_booking_id: bookingId,
        p_phase: phase,
        p_photos: photos,
      }),
    );
    const booking = mapRow<Booking>(row as Record<string, unknown>) as Booking;
    // Trip just started (both sides signed pickup) → capture the escrow hold.
    // Best-effort: a failed/undeployed capture must never block the handoff.
    if (booking.state === 'active') {
      supabaseClient.capturePayment(booking.id).catch(() => {});
    }
    return booking;
  },

  // --- Payouts -----------------------------------------------------------
  async listPayouts() {
    return mapRows<Payout>(await run(sb().from('payouts').select('*')));
  },

  // --- Owner dashboard ---------------------------------------------------
  async getCurrentHost() {
    return mapRow<Host>(
      await run(sb().from('profiles').select('*').eq('id', me()).maybeSingle()),
    );
  },
  async listOwnerListings() {
    return mapRows<Listing>(await run(sb().from('listings').select('*').eq('host_id', me())));
  },
  async listOwnerBookings() {
    return mapRows<Booking>(await run(sb().from('bookings').select('*').eq('host_id', me())));
  },
  /** Create any pending "overdue return" notifications for my trips (idempotent). */
  async checkOverdueReturns(): Promise<void> {
    await run(getSupabase().rpc('notify_overdue_returns'));
  },
  async listOwnerPayouts() {
    return mapRows<Payout>(await run(sb().from('payouts').select('*').eq('host_id', me())));
  },
  async respondToBooking(id: string, action: 'approve' | 'decline') {
    // Declining a paid request refunds it in the same update.
    const patch =
      action === 'approve'
        ? { state: 'confirmed' }
        : { state: 'declined', payment_status: 'refunded' };
    const row = await run(sb().from('bookings').update(patch).eq('id', id).select('*').maybeSingle());
    return mapRow<Booking>(row);
  },
  /** Cancel a booking and refund it (host: confirmed/pickup; renter: requested/confirmed). */
  async cancelBooking(id: string): Promise<Booking> {
    const row = await run(
      sb()
        .from('bookings')
        .update({ state: 'cancelled', payment_status: 'refunded' })
        .eq('id', id)
        .select('*')
        .single(),
    );
    return mapRow<Booking>(row) as Booking;
  },
  /** A single profile by id (renter or host). */
  async getProfile(id: string): Promise<(UserProfile & Partial<Host>) | undefined> {
    const full = await run(sb().from('profiles').select('*').eq('id', id).maybeSingle());
    if (full) return mapRow<UserProfile & Partial<Host>>(full);
    return mapRow<UserProfile & Partial<Host>>(
      await run(sb().from('public_profiles').select('*').eq('id', id).maybeSingle()),
    );
  },
  /** Verification documents for a profile (host can read a requester's via RLS). */
  async listVerificationDocumentsFor(profileId: string): Promise<VerificationDocument[]> {
    return mapRows<VerificationDocument>(
      await run(sb().from('verification_documents').select('*').eq('profile_id', profileId)),
    );
  },
  async updateListing(
    id: string,
    patch: Partial<
      Pick<
        Listing,
        | 'title'
        | 'category'
        | 'make'
        | 'model'
        | 'year'
        | 'seats'
        | 'transmission'
        | 'fuel'
        | 'pricePerDayRwf'
        | 'priceCurrency'
        | 'country'
        | 'location'
        | 'city'
        | 'photos'
        | 'features'
        | 'bookingMode'
        | 'blockedDates'
        | 'status'
        | 'maintenanceUntil'
        | 'lat'
        | 'lng'
        | 'locationUrl'
      >
    >,
  ) {
    const map: Record<string, string> = {
      title: 'title',
      category: 'category',
      make: 'make',
      model: 'model',
      year: 'year',
      seats: 'seats',
      transmission: 'transmission',
      fuel: 'fuel',
      pricePerDayRwf: 'price_per_day_rwf',
      priceCurrency: 'price_currency',
      country: 'country',
      location: 'location',
      city: 'city',
      photos: 'photos',
      features: 'features',
      bookingMode: 'booking_mode',
      blockedDates: 'blocked_dates',
      maintenanceUntil: 'maintenance_until',
      lat: 'lat',
      lng: 'lng',
      locationUrl: 'location_url',
    };
    const dbPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (k === 'status') {
        dbPatch.status = v;
        if (v === 'available') dbPatch.maintenance_until = null; // leaving maintenance clears the date
      } else if (map[k]) {
        dbPatch[map[k]] = v;
      }
    }
    const row = await run(
      sb().from('listings').update(dbPatch).eq('id', id).select('*').maybeSingle(),
    );
    return mapRow<Listing>(row);
  },
  /**
   * Booked (unavailable) date ranges for a listing — start/end of every live
   * booking, with no renter identity or amounts. Backed by a SECURITY DEFINER
   * function so it works for browsing renters too, not just the host.
   */
  async getBookedRanges(listingId: string): Promise<{ startDate: string; endDate: string }[]> {
    const rows = await run(
      sb().rpc('listing_booked_ranges', { p_listing_id: listingId }),
    );
    return ((rows as { start_date: string; end_date: string }[]) ?? []).map((r) => ({
      startDate: r.start_date,
      endDate: r.end_date,
    }));
  },
  /**
   * Upload car photos to Supabase Storage and return their public URLs. Files
   * are stored under the uploader's folder in the public `car-photos` bucket;
   * the returned URLs are what gets saved in `listings.photos`.
   */
  async uploadPhotos(files: File[]): Promise<string[]> {
    const userId = me();
    const urls: string[] = [];
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await sb()
        .storage.from('car-photos')
        .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
      if (error) throw new Error(error.message);
      urls.push(sb().storage.from('car-photos').getPublicUrl(path).data.publicUrl);
    }
    return urls;
  },
  /**
   * Create a listing owned by the logged-in user. The first listing promotes the
   * profile to an individual host (owner_type / role / payout + insurance terms);
   * existing hosts keep their owner_type. vehicle_count is refreshed to match.
   */
  async createListing(input: CreateListingInput): Promise<Listing> {
    const hostId = me();
    const profile = await run(
      sb().from('profiles').select('owner_type').eq('id', hostId).single(),
    );
    const ownerType = ((profile?.owner_type as Listing['ownerType']) ?? 'individual');

    const row = await run(
      sb()
        .from('listings')
        .insert({
          id: `car-${Date.now()}`,
          title: input.title,
          host_id: hostId,
          owner_type: ownerType,
          category: input.category,
          make: input.make,
          model: input.model,
          year: input.year,
          seats: input.seats,
          transmission: input.transmission,
          fuel: input.fuel,
          price_per_day_rwf: input.pricePerDayRwf,
          price_currency: input.priceCurrency ?? 'RWF',
          country: input.country ?? 'RW',
          location: input.location,
          city: input.city,
          photos: input.photos,
          features: input.features,
          booking_mode: input.bookingMode,
          status: input.status ?? 'available',
          maintenance_until: input.status === 'maintenance' ? input.maintenanceUntil || null : null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          location_url: input.locationUrl || null,
        })
        .select('*')
        .single(),
    );

    const { count } = await sb()
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('host_id', hostId);
    await run(
      sb()
        .from('profiles')
        .update({
          role: 'owner',
          owner_type: ownerType,
          payout_terms: 'per_trip',
          insurance_type: 'platform_provided',
          vehicle_count: count ?? 1,
        })
        .eq('id', hostId)
        .select('id'),
    );

    return mapRow<Listing>(row) as Listing;
  },

  // --- Messaging ---------------------------------------------------------
  /**
   * Find the renter↔host thread for a listing, or start one. Either participant
   * may call it (RLS lets you create a row you're part of), so it powers the
   * car-page "Message host", the booking auto-text, and the trip "Message" button
   * for both sides.
   */
  async getOrCreateConversation(
    listingId: string,
    renterId: string,
    hostId: string,
  ): Promise<Conversation> {
    const existing = await run(
      sb()
        .from('conversations')
        .select('*')
        .eq('listing_id', listingId)
        .eq('renter_id', renterId)
        .eq('host_id', hostId)
        .maybeSingle(),
    );
    if (existing) return mapRow<Conversation>(existing) as Conversation;

    const now = new Date().toISOString();
    const row = await run(
      sb()
        .from('conversations')
        .insert({
          id: `conv-${Date.now()}`,
          listing_id: listingId,
          renter_id: renterId,
          host_id: hostId,
          last_message_preview: '',
          last_message_at: now,
          unread: 0,
        })
        .select('*')
        .single(),
    );
    return mapRow<Conversation>(row) as Conversation;
  },
  /** Delete a conversation (its messages cascade). Removes it for both parties. */
  async deleteConversation(id: string): Promise<void> {
    await run(sb().from('conversations').delete().eq('id', id).select('id'));
  },
  /** Delete every conversation I'm part of. */
  async deleteAllConversations(): Promise<void> {
    const uid = me();
    await run(
      sb().from('conversations').delete().or(`renter_id.eq.${uid},host_id.eq.${uid}`).select('id'),
    );
  },
  async listConversations() {
    return mapRows<Conversation>(
      await run(sb().from('conversations').select('*').order('last_message_at', { ascending: false })),
    );
  },
  async getConversation(id: string) {
    return mapRow<Conversation>(
      await run(sb().from('conversations').select('*').eq('id', id).maybeSingle()),
    );
  },
  async listMessages(conversationId: string) {
    const msgs = mapRows<Message>(
      await run(
        sb().from('messages').select('*').eq('conversation_id', conversationId).order('sent_at'),
      ),
    );
    return signChatAttachments(msgs);
  },
  /** Total messages addressed to me that I haven't read — drives the header badge. */
  async getUnreadMessageCount(): Promise<number> {
    const { count } = await sb()
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null)
      .neq('sender_id', me());
    return count ?? 0;
  },
  /** Unread count per conversation (messages from the other party, unread). */
  async getUnreadByConversation(): Promise<Record<string, number>> {
    const rows = await run(
      sb().from('messages').select('conversation_id').is('read_at', null).neq('sender_id', me()),
    );
    const map: Record<string, number> = {};
    for (const r of (rows as { conversation_id: string }[]) ?? []) {
      map[r.conversation_id] = (map[r.conversation_id] ?? 0) + 1;
    }
    return map;
  },
  async markConversationRead(conversationId: string): Promise<void> {
    await run(sb().from('conversations').update({ unread: 0 }).eq('id', conversationId).select('id'));
    await run(
      sb()
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .neq('sender_id', me())
        .is('read_at', null)
        .select('id'),
    );
  },
  async sendMessage(
    conversationId: string,
    body: string,
    opts?: {
      attachmentUrl?: string;
      attachmentType?: string;
      attachmentName?: string;
      replyTo?: string;
    },
  ): Promise<Message> {
    const sentAt = new Date().toISOString();
    const row = await run(
      sb()
        .from('messages')
        .insert({
          id: `msg-${Date.now()}`,
          conversation_id: conversationId,
          sender_id: me(),
          body,
          sent_at: sentAt,
          attachment_url: opts?.attachmentUrl ?? null,
          attachment_type: opts?.attachmentType ?? null,
          attachment_name: opts?.attachmentName ?? null,
          reply_to: opts?.replyTo ?? null,
        })
        .select('*')
        .single(),
    );
    const preview = body.trim() || (opts?.attachmentType === 'image' ? '📷 Photo' : '📎 Attachment');
    await run(
      sb()
        .from('conversations')
        .update({ last_message_preview: preview, last_message_at: sentAt, unread: 0 })
        .eq('id', conversationId)
        .select('id'),
    );
    return mapRow<Message>(row) as Message;
  },
  /** Delete one of my own messages. */
  async deleteMessage(id: string): Promise<void> {
    await run(sb().from('messages').delete().eq('id', id).eq('sender_id', me()).select('id'));
  },
  /** Toggle my emoji reaction on a message. */
  async toggleReaction(messageId: string, emoji: string): Promise<void> {
    const uid = me();
    const current = await run(sb().from('messages').select('reactions').eq('id', messageId).single());
    const reactions: Record<string, string[]> = { ...((current?.reactions as Record<string, string[]>) ?? {}) };
    const users = new Set(reactions[emoji] ?? []);
    if (users.has(uid)) users.delete(uid);
    else users.add(uid);
    if (users.size === 0) delete reactions[emoji];
    else reactions[emoji] = [...users];
    await run(sb().from('messages').update({ reactions }).eq('id', messageId).select('id'));
  },
  /**
   * Upload a chat attachment to the private chat-files bucket. Returns the
   * storage path — messages store the path, and `listMessages` swaps it for a
   * signed URL when rendering.
   */
  async uploadChatFile(file: File): Promise<{ url: string; type: 'image' | 'file'; name: string }> {
    const userId = me();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb()
      .storage.from('chat-files')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(error.message);
    return { url: path, type: file.type.startsWith('image/') ? 'image' : 'file', name: file.name };
  },
  /** Profiles by id (any role) — used to label chat threads by the other party. */
  async getProfilesByIds(ids: string[]): Promise<Record<string, UserProfile & Partial<Host>>> {
    if (ids.length === 0) return {};
    const unique = [...new Set(ids)];
    const rows = await run(sb().from('profiles').select('*').in('id', unique));
    const map: Record<string, UserProfile & Partial<Host>> = {};
    for (const r of mapRows<UserProfile & Partial<Host>>(rows as Record<string, unknown>[])) {
      map[r.id] = r;
    }
    // Ids RLS filtered out (not a counterparty) still need a name/avatar label.
    const missing = unique.filter((id) => !map[id]);
    if (missing.length > 0) {
      const pub = await run(sb().from('public_profiles').select('*').in('id', missing));
      for (const r of mapRows<UserProfile & Partial<Host>>(pub as Record<string, unknown>[])) {
        map[r.id] = r;
      }
    }
    return map;
  },

  // --- Reviews -----------------------------------------------------------
  async listReviews(subjectId?: string) {
    let q = sb().from('reviews').select('*');
    if (subjectId) q = q.eq('subject_id', subjectId);
    return mapRows<Review>(await run(q));
  },
  async listReviewsForBooking(bookingId: string) {
    return mapRows<Review>(await run(sb().from('reviews').select('*').eq('booking_id', bookingId)));
  },
  async createReview(input: CreateReviewInput): Promise<Review> {
    const booking = await run(
      sb().from('bookings').select('renter_id, host_id').eq('id', input.bookingId).single(),
    );
    if (!booking) throw new Error(`Booking ${input.bookingId} not found`);
    const toHost = input.direction === 'renter_to_host';
    const row = await run(
      sb()
        .from('reviews')
        .insert({
          id: `rv-${Date.now()}`,
          booking_id: input.bookingId,
          author_id: toHost ? booking.renter_id : booking.host_id,
          subject_id: toHost ? booking.host_id : booking.renter_id,
          direction: input.direction,
          rating: input.rating,
          body: input.body,
          created_at: new Date().toISOString(),
        })
        .select('*')
        .single(),
    );
    return mapRow<Review>(row) as Review;
  },

  // --- Notifications -----------------------------------------------------
  async listNotifications(): Promise<AppNotification[]> {
    return mapRows<AppNotification>(
      await run(
        sb()
          .from('notifications')
          .select('*')
          .eq('profile_id', me())
          // Messages live in the chat with their own unread badge — keep them out.
          .neq('kind', 'message')
          .order('created_at', { ascending: false }),
      ),
    );
  },
  async markNotificationRead(id: string): Promise<void> {
    await run(sb().from('notifications').update({ read: true }).eq('id', id).select('id'));
  },
  async markAllNotificationsRead(): Promise<void> {
    await run(
      sb()
        .from('notifications')
        .update({ read: true })
        .eq('profile_id', me())
        .eq('read', false)
        .select('id'),
    );
  },

  // --- Watchlist ---------------------------------------------------------
  /**
   * Cars the signed-in account is watching. Watching is not booking — hosts and
   * companies may watch too — it subscribes you to a notification when the car
   * comes back into service or the trip on it ends (see migration 043).
   */
  async listWatchlist(): Promise<string[]> {
    const rows = await run(sb().from('watchlist').select('listing_id').eq('profile_id', me()));
    return (rows ?? []).map((r) => r.listing_id as string);
  },
  /** The watched cars themselves, newest watch first — one round trip. */
  async listWatchedListings(): Promise<Listing[]> {
    const rows = await run(
      sb()
        .from('watchlist')
        .select('created_at, listings(*)')
        .eq('profile_id', me())
        .order('created_at', { ascending: false }),
    );
    return (rows ?? [])
      .map((r) => {
        // PostgREST types an embedded resource as an array; a to-one join like
        // this one comes back as a single row at runtime. Accept both.
        const embedded: unknown = (r as { listings?: unknown }).listings;
        const row = Array.isArray(embedded) ? embedded[0] : embedded;
        return mapRow<Listing>(row as Record<string, unknown> | null);
      })
      .filter((l): l is Listing => !!l);
  },
  async watchListing(listingId: string): Promise<void> {
    await run(
      sb()
        .from('watchlist')
        // Re-watching an already-watched car must not blow up on the PK.
        .upsert({ profile_id: me(), listing_id: listingId }, { onConflict: 'profile_id,listing_id' })
        .select('listing_id'),
    );
  },
  async unwatchListing(listingId: string): Promise<void> {
    await run(
      sb()
        .from('watchlist')
        .delete()
        .eq('profile_id', me())
        .eq('listing_id', listingId)
        .select('listing_id'),
    );
  },

  // --- Verification ------------------------------------------------------
  async listVerificationDocuments(): Promise<VerificationDocument[]> {
    return mapRows<VerificationDocument>(
      await run(sb().from('verification_documents').select('*').eq('profile_id', me())),
    );
  },
  /**
   * Upload a real KYC document to the private `kyc-documents` bucket and record
   * it for review. Stores the storage path (not a public URL) — admins view it
   * through a short-lived signed URL. Re-uploading a type replaces the file and
   * resets it to pending.
   */
  async uploadVerificationDocument(
    type: VerificationDocType,
    file: File,
  ): Promise<VerificationDocument> {
    const uid = me();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `${uid}/${type}-${Date.now()}.${ext}`;
    const { error: upErr } = await sb()
      .storage.from('kyc-documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const existing = await run(
      sb()
        .from('verification_documents')
        .select('id, storage_path')
        .eq('profile_id', uid)
        .eq('type', type)
        .maybeSingle(),
    );
    const fields = {
      profile_id: uid,
      type,
      status: 'pending' as const,
      file_name: file.name,
      storage_path: path,
      uploaded_at: new Date().toISOString().slice(0, 10),
      note: null,
      reviewed_by: null,
      reviewed_at: null,
      extracted: null,
    };
    const row = existing
      ? await run(sb().from('verification_documents').update(fields).eq('id', existing.id).select('*').single())
      : await run(
          sb()
            .from('verification_documents')
            .insert({ id: `vd-${Date.now()}`, ...fields })
            .select('*')
            .single(),
        );
    // Best-effort cleanup of the file this one replaced.
    const oldPath = (existing as { storage_path?: string } | null)?.storage_path;
    if (oldPath && oldPath !== path) {
      await sb().storage.from('kyc-documents').remove([oldPath]);
    }
    return mapRow<VerificationDocument>(row) as VerificationDocument;
  },

  // --- Admin -------------------------------------------------------------
  /**
   * Grouped KYC review queue — one row per PERSON who has documents (not one
   * per document), with pending/total counts. `scope: 'pending'` shows only
   * people with something awaiting review; 'all' shows everyone who uploaded.
   * Paginated + searchable by name/email. Admin-only (RPC checks is_admin()).
   */
  async listVerificationProfiles(opts: {
    scope?: 'pending' | 'all';
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<Page<KycProfile>> {
    const page = opts.page ?? 0;
    const pageSize = opts.pageSize ?? 20;
    const rows = (await run(
      sb().rpc('admin_kyc_profiles', {
        p_scope: opts.scope ?? 'pending',
        p_search: opts.search?.trim() ?? '',
        p_limit: pageSize,
        p_offset: page * pageSize,
      }),
    )) as Record<string, unknown>[] | null;
    const list = rows ?? [];
    const total = list.length ? Number(list[0].total_count ?? 0) : 0;
    const items: KycProfile[] = list.map((r) => ({
      id: r.id as string,
      fullName: r.full_name as string,
      email: r.email as string,
      avatarUrl: (r.avatar_url as string) ?? undefined,
      role: r.role as KycProfile['role'],
      ownerType: (r.owner_type as KycProfile['ownerType']) ?? undefined,
      verification: r.verification as KycProfile['verification'],
      verificationOverride: Boolean(r.verification_override),
      pendingCount: Number(r.pending_count ?? 0),
      docCount: Number(r.doc_count ?? 0),
    }));
    return { items, total };
  },
  /** All KYC documents for one person, for the expanded review card. */
  async listVerificationsForProfile(profileId: string): Promise<VerificationReviewItem[]> {
    const rows = await run(
      sb()
        .from('verification_documents')
        .select(
          '*, owner:profiles!verification_documents_profile_id_fkey(id, full_name, email, avatar_url, role, owner_type)',
        )
        .eq('profile_id', profileId)
        .order('type'),
    );
    return (rows as Record<string, unknown>[] ?? []).map((r) => {
      const owner = mapRow<VerificationReviewItem['owner']>(r.owner as Record<string, unknown>);
      const doc = mapRow<VerificationReviewItem>({ ...r, owner: undefined });
      return { ...(doc as VerificationReviewItem), owner: owner as VerificationReviewItem['owner'] };
    });
  },
  /** Force a user's verification to a value (sticky admin override). */
  async overrideProfileVerification(
    profileId: string,
    status: VerificationStatus,
    note?: string,
  ): Promise<void> {
    await run(
      sb().rpc('admin_set_verification', {
        p_profile_id: profileId,
        p_status: status,
        p_note: note ?? null,
      }),
    );
  },
  /** Remove an override and resume automatic status from the documents. */
  async clearVerificationOverride(profileId: string): Promise<void> {
    await run(sb().rpc('admin_clear_verification_override', { p_profile_id: profileId }));
  },
  /** Whether new KYC submissions are auto-approved (vs. manual review). */
  async getKycAutoApprove(): Promise<boolean> {
    const row = await run(
      sb().from('app_settings').select('kyc_auto_approve').eq('id', 1).maybeSingle(),
    );
    return Boolean((row as { kyc_auto_approve?: boolean } | null)?.kyc_auto_approve);
  },
  /** Turn auto-approve on/off (admin only). */
  async setKycAutoApprove(on: boolean): Promise<void> {
    await run(sb().rpc('admin_set_kyc_auto_approve', { p_on: on }));
  },
  /** Current electric-car quota + whether a non-electric car may be listed now. */
  async getElectricQuota(): Promise<ElectricQuota> {
    const rows = (await run(sb().rpc('electric_quota_status'))) as Record<string, unknown>[] | null;
    const r = rows?.[0];
    return {
      minPercent: Number(r?.min_percent ?? 95),
      totalCars: Number(r?.total_cars ?? 0),
      electricCars: Number(r?.electric_cars ?? 0),
      canAddNonElectric: Boolean(r?.can_add_non_electric),
    };
  },
  /** Set the minimum electric-car percentage (admin only). */
  async setElectricMinPercent(percent: number): Promise<void> {
    await run(sb().rpc('admin_set_electric_min_percent', { p_pct: percent }));
  },
  /** Paginated, searchable user directory (admin only). */
  async listUsers(opts: { search?: string; page?: number; pageSize?: number } = {}): Promise<
    Page<AdminUser>
  > {
    const page = opts.page ?? 0;
    const pageSize = opts.pageSize ?? 20;
    const rows = (await run(
      sb().rpc('admin_list_users', {
        p_search: opts.search?.trim() ?? '',
        p_limit: pageSize,
        p_offset: page * pageSize,
      }),
    )) as Record<string, unknown>[] | null;
    const list = rows ?? [];
    const total = list.length ? Number(list[0].total_count ?? 0) : 0;
    const items: AdminUser[] = list.map((r) => ({
      id: r.id as string,
      fullName: r.full_name as string,
      email: r.email as string,
      phone: (r.phone as string) ?? undefined,
      avatarUrl: (r.avatar_url as string) ?? undefined,
      role: r.role as AdminUser['role'],
      ownerType: (r.owner_type as AdminUser['ownerType']) ?? undefined,
      verification: r.verification as AdminUser['verification'],
      suspended: Boolean(r.suspended),
      joinedAt: (r.joined_at as string) ?? undefined,
      listingCount: Number(r.listing_count ?? 0),
      bookingCount: Number(r.booking_count ?? 0),
    }));
    return { items, total };
  },
  /** Suspend or reinstate a user (admin only). */
  async setUserSuspended(profileId: string, suspended: boolean): Promise<void> {
    await run(sb().rpc('admin_set_suspended', { p_profile_id: profileId, p_suspended: suspended }));
  },
  /** Send a message (delivered as a notification) to a user (admin only). */
  async sendUserMessage(profileId: string, title: string, body: string): Promise<void> {
    await run(
      sb().rpc('admin_send_message', { p_profile_id: profileId, p_title: title, p_body: body }),
    );
  },
  /** Send a warning to a user (notification + recorded action; admin only). */
  async warnUser(profileId: string, message: string): Promise<void> {
    await run(sb().rpc('admin_warn_user', { p_profile_id: profileId, p_message: message }));
  },
  /** A user's listings (cars/machines they host). */
  async listUserListings(hostId: string): Promise<Listing[]> {
    return mapRows<Listing>(
      await run(sb().from('listings').select('*').eq('host_id', hostId).order('id')),
    );
  },
  /** Bookings placed on a specific listing (admin reads all via RLS). */
  async listListingBookings(listingId: string): Promise<Booking[]> {
    return mapRows<Booking>(
      await run(
        sb()
          .from('bookings')
          .select('*')
          .eq('listing_id', listingId)
          .order('created_at', { ascending: false }),
      ),
    );
  },
  /** Permanently delete a user (admin only) via the admin-delete-user function. */
  async deleteUser(profileId: string): Promise<void> {
    const { data, error } = await getSupabase().functions.invoke('admin-delete-user', {
      body: { profileId },
    });
    if (error) throw new Error(error.message);
    const payload = data as { error?: string } | null;
    if (payload?.error) throw new Error(payload.error);
  },
  /** A user's bookings as renter or host, with the car title (admin reads all). */
  async listUserBookings(userId: string): Promise<(Booking & { carTitle?: string })[]> {
    const rows = await run(
      sb()
        .from('bookings')
        .select('*, listing:listings(title, make, model)')
        .or(`renter_id.eq.${userId},host_id.eq.${userId}`)
        .order('created_at', { ascending: false }),
    );
    return (rows as Record<string, unknown>[] ?? []).map((r) => {
      const listing = r.listing as { title?: string } | null;
      const b = mapRow<Booking>({ ...r, listing: undefined }) as Booking;
      return { ...b, carTitle: listing?.title };
    });
  },
  /** Recorded admin actions taken on a user (admin only). */
  async listUserActions(profileId: string): Promise<AdminAction[]> {
    const rows = (await run(
      sb().from('admin_actions').select('*').eq('target_id', profileId).order('created_at', { ascending: false }),
    )) as Record<string, unknown>[] | null;
    const list = rows ?? [];
    const adminIds = [...new Set(list.map((r) => r.admin_id).filter(Boolean) as string[])];
    const admins = adminIds.length ? await this.getProfilesByIds(adminIds) : {};
    return list.map((r) => ({
      id: Number(r.id),
      adminId: (r.admin_id as string) ?? undefined,
      targetId: r.target_id as string,
      action: r.action as string,
      detail: (r.detail as string) ?? undefined,
      createdAt: r.created_at as string,
      adminName: r.admin_id ? admins[r.admin_id as string]?.fullName : undefined,
    }));
  },
  /**
   * KYC activity feed — every submit/approve/reject, newest first, paginated.
   * verification_events has no FK to profiles (history outlives a deleted
   * profile), so owner + actor names are resolved in one batch lookup here.
   */
  async listKycEvents(opts: { profileId?: string; page?: number; pageSize?: number } = {}): Promise<
    Page<VerificationEvent>
  > {
    const page = opts.page ?? 0;
    const pageSize = opts.pageSize ?? 30;
    let q = sb().from('verification_events').select('*', { count: 'exact' });
    if (opts.profileId) q = q.eq('profile_id', opts.profileId);
    const from = page * pageSize;
    const { data, error, count } = await q
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data as Record<string, unknown>[]) ?? [];
    const ids = [
      ...new Set(
        rows.flatMap((r) => [r.profile_id, r.actor_id]).filter(Boolean) as string[],
      ),
    ];
    const profiles = ids.length ? await this.getProfilesByIds(ids) : {};
    const toOwner = (p?: UserProfile & Partial<Host>): KycOwner | undefined =>
      p && {
        id: p.id,
        fullName: p.fullName,
        email: p.email,
        avatarUrl: p.avatarUrl,
        role: p.role,
        ownerType: p.ownerType,
      };
    const items = rows.map((r) => {
      const ev = mapRow<VerificationEvent>(r) as VerificationEvent;
      return {
        ...ev,
        owner: toOwner(profiles[ev.profileId]),
        actorName: ev.actorId ? profiles[ev.actorId]?.fullName : undefined,
      };
    });
    return { items, total: count ?? 0 };
  },
  /** Aggregate KYC counts for the admin overview (cheap head/count queries). */
  async getKycMetrics(): Promise<KycMetrics> {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const countOf = (
      builder: PromiseLike<{ count: number | null; error: { message: string } | null }>,
    ) => builder.then(({ count }) => count ?? 0);
    const [pendingDocs, verified, pending, rejected, unverified, decisions7d] = await Promise.all([
      countOf(sb().from('verification_documents').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'verified')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'pending')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'rejected')),
      countOf(sb().from('public_profiles').select('id', { count: 'exact', head: true }).eq('verification', 'unverified')),
      countOf(sb().from('verification_events').select('id', { count: 'exact', head: true }).in('event', ['approved', 'rejected']).gte('created_at', weekAgo)),
    ]);
    return {
      pendingDocs,
      verifiedUsers: verified,
      pendingUsers: pending,
      rejectedUsers: rejected,
      unverifiedUsers: unverified,
      decisions7d,
    };
  },
  /** Approve or reject a document; the DB trigger re-derives profiles.verification. */
  async reviewVerificationDocument(
    id: string,
    status: 'verified' | 'rejected',
    note?: string,
  ): Promise<VerificationDocument> {
    const row = await run(
      sb()
        .from('verification_documents')
        .update({
          status,
          note: note ?? null,
          reviewed_by: me(),
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single(),
    );
    return mapRow<VerificationDocument>(row) as VerificationDocument;
  },
  /** Short-lived signed URL to view a KYC document (admin reads the private bucket). */
  async getKycDocumentUrl(storagePath: string): Promise<string> {
    const { data, error } = await sb()
      .storage.from('kyc-documents')
      .createSignedUrl(storagePath, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },
  async listFlags(): Promise<Flag[]> {
    return mapRows<Flag>(await run(sb().from('flags').select('*').order('created_at', { ascending: false })));
  },
  async resolveFlag(id: string, status: ModerationStatus) {
    const row = await run(sb().from('flags').update({ status }).eq('id', id).select('*').maybeSingle());
    return mapRow<Flag>(row);
  },
  async listDisputes(): Promise<Dispute[]> {
    return mapRows<Dispute>(
      await run(sb().from('disputes').select('*').order('created_at', { ascending: false })),
    );
  },
  async resolveDispute(id: string, status: DisputeStatus) {
    const row = await run(sb().from('disputes').update({ status }).eq('id', id).select('*').maybeSingle());
    return mapRow<Dispute>(row);
  },
  async getAdminStats(): Promise<AdminStats> {
    const [bookingRows, payoutRows, listings, hosts, flagsOpen, disputesOpen] = await Promise.all([
      run(sb().from('bookings').select('service_fee_rwf, total_rwf')),
      run(sb().from('payouts').select('amount_rwf, status')),
      sb().from('listings').select('id', { count: 'exact', head: true }),
      sb().from('public_profiles').select('id', { count: 'exact', head: true }).not('owner_type', 'is', null),
      sb().from('flags').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      sb().from('disputes').select('id', { count: 'exact', head: true }).in('status', ['open', 'under_review']),
    ]);
    const sum = (rows: Record<string, unknown>[], key: string) =>
      rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);
    const payouts = (payoutRows ?? []) as Record<string, unknown>[];
    const bookingsArr = (bookingRows ?? []) as Record<string, unknown>[];
    return {
      grossRwf: sum(bookingsArr, 'total_rwf'),
      revenueRwf: sum(bookingsArr, 'service_fee_rwf'),
      payoutsPaidRwf: sum(payouts.filter((p) => p.status === 'paid'), 'amount_rwf'),
      payoutsDueRwf: sum(payouts.filter((p) => p.status !== 'paid'), 'amount_rwf'),
      bookings: (bookingRows as unknown[]).length,
      listings: listings.count ?? 0,
      hosts: hosts.count ?? 0,
      openFlags: flagsOpen.count ?? 0,
      openDisputes: disputesOpen.count ?? 0,
    };
  },

  // --- Current user ------------------------------------------------------
  async getCurrentUser() {
    return mapRow<UserProfile>(
      await run(sb().from('profiles').select('*').eq('id', me()).maybeSingle()),
    ) as UserProfile;
  },
  /** Update the signed-in user's own profile (RLS allows id = auth.uid()). */
  async updateProfile(patch: {
    fullName?: string;
    businessName?: string;
    avatarUrl?: string;
    role?: UserProfile['role'];
    ownerType?: 'individual' | 'business';
    /** ISO 3166-1 alpha-2 — where they pay from / are paid into. */
    country?: string;
  }): Promise<UserProfile> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.fullName !== undefined) dbPatch.full_name = patch.fullName;
    if (patch.businessName !== undefined) dbPatch.business_name = patch.businessName;
    if (patch.avatarUrl !== undefined) dbPatch.avatar_url = patch.avatarUrl;
    if (patch.role !== undefined) dbPatch.role = patch.role;
    if (patch.ownerType !== undefined) dbPatch.owner_type = patch.ownerType;
    if (patch.country !== undefined) dbPatch.country = patch.country.toUpperCase();
    const row = await run(
      sb().from('profiles').update(dbPatch).eq('id', me()).select('*').single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /**
   * Connect a host payout method. The host picks a method (momo/bank/card) and a
   * destination; the caller routes it to a provider (Flutterwave/Stripe) and
   * passes both. In a live build this kicks off provider onboarding server-side
   * and status becomes 'active' only once the provider confirms via webhook; the
   * demo marks it active immediately. Only the MASKED destination is stored.
   */
  async setPayoutMethod(input: {
    method: 'momo' | 'bank' | 'card';
    provider: PayoutProvider;
    destinationMasked: string;
    label: string;
  }): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payout_method: input.method,
          payout_provider: input.provider,
          payout_destination: input.destinationMasked,
          payout_label: input.label,
          payout_status: 'active',
        })
        .eq('id', me())
        .select('*')
        .single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /**
   * Save a renter's payment method — how they pay, the mirror of
   * `setPayoutMethod`. Only the MASKED destination is stored; the real
   * credentials belong to the payment provider, never to us. `ref` is that
   * provider's token for the method, absent until the external payment system
   * is connected (nothing in AutoHire mints one), which is why the status stays
   * 'pending' without it — an unbacked method can't actually be charged.
   */
  async setPaymentMethod(input: {
    method: PaymentMethodType;
    destinationMasked: string;
    label: string;
    ref?: string;
  }): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payment_method: input.method,
          payment_destination: input.destinationMasked,
          payment_label: input.label,
          payment_ref: input.ref ?? null,
          payment_status: input.ref ? 'active' : 'pending',
        })
        .eq('id', me())
        .select('*')
        .single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /** Remove the saved payment method. */
  async clearPaymentMethod(): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payment_method: null,
          payment_destination: null,
          payment_label: null,
          payment_ref: null,
          payment_status: 'none',
        })
        .eq('id', me())
        .select('*')
        .single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /** Remove the connected payout method. */
  async clearPayoutMethod(): Promise<UserProfile> {
    const row = await run(
      sb()
        .from('profiles')
        .update({
          payout_method: null,
          payout_provider: null,
          payout_destination: null,
          payout_label: null,
          payout_status: 'none',
        })
        .eq('id', me())
        .select('*')
        .single(),
    );
    return mapRow<UserProfile>(row) as UserProfile;
  },
  /** Upload a profile picture to the public `avatars` bucket; returns its URL. */
  async uploadAvatar(file: File): Promise<string> {
    const userId = me();
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error } = await sb()
      .storage.from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new Error(error.message);
    return sb().storage.from('avatars').getPublicUrl(path).data.publicUrl;
  },
};
