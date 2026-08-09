// AutoHire — PayHold client.
//
// PayHold is the escrow platform AutoHire is tenant #1 on. It owns the money:
// the hold, the clearance window, the seller's wallet, the payout. AutoHire
// creates deals and reads state; it never touches a provider itself.
//
// This replaces the direct-provider rails. `create-payment-intent`,
// `capture-payment`, `flutterwave-collect` and `flutterwave-transfer` all
// existed because AutoHire was orchestrating Stripe and Flutterwave by hand —
// PayHold does that now, behind /deals → /confirm → /withdraw.
//
// Shapes here are taken from PayHold's own source (payhold-backend/supabase/
// functions/{deals,sellers,disputes}/index.ts), not guessed. Where a field is a
// judgement call rather than a copy, the comment says so.
//
// Secrets:
//   PAYHOLD_BASE_URL       https://<ref>.supabase.co/functions/v1
//   PAYHOLD_API_KEY        from the PayHold dashboard → Rails → API Keys
//   PAYHOLD_WEBHOOK_SECRET the endpoint secret PayHold minted for our URL

// ---------------------------------------------------------------------------
// Types — PayHold's wire shapes
// ---------------------------------------------------------------------------

/** PayHold's 18 deal states. AutoHire only branches on a handful. */
export type DealStatus =
  | 'created'
  | 'checkout_started'
  | 'payment_pending'
  | 'payment_failed'
  | 'expired'
  | 'canceled'
  | 'funded_held'
  | 'in_progress'
  | 'revision_requested'
  | 'confirmed_buyer'
  | 'confirmed_seller'
  | 'clearing'
  | 'released'
  | 'payout_pending'
  | 'paid_out'
  | 'refunded'
  | 'partially_refunded'
  | 'disputed';

/** Money is with the provider under PayHold's control — the trip may proceed. */
export const HOLDING: readonly DealStatus[] = [
  'funded_held',
  'in_progress',
  'revision_requested',
  'confirmed_buyer',
  'confirmed_seller',
  'disputed',
];

/** Past the hold: released to the seller's wallet, clearing, or paid out. */
export const PAST_HOLD: readonly DealStatus[] = [
  'clearing',
  'released',
  'payout_pending',
  'paid_out',
];

export interface Deal {
  id: string;
  buyer_ref: string;
  seller_id: string;
  description: string;
  /** Minor units, in `currency`. */
  amount: number;
  currency: string;
  presentment_currency: string;
  presentment_amount: number;
  status: DealStatus;
  payment_method: string | null;
  provider: string | null;
  auto_release_at: string | null;
  payout_due_at: string | null;
  released_at: string | null;
  fee_amount: number;
  /** What we attached at creation. This is how a deal is bound to a booking. */
  metadata: Record<string, string>;
  created_at: string;
  /** Present on single-deal reads and on `confirm`; absent from list rows. */
  confirmations?: { side: 'buyer' | 'seller'; actor: string; confirmed_at: string }[];
}

export interface Seller {
  id: string;
  name: string;
  country: string;
  payout_currency: string;
  payout_provider: PayoutProvider;
  masked_destination: string;
  kyc_status: 'pending' | 'verified' | 'restricted' | 'rejected' | 'review_required';
  /**
   * Our own handle for this host — their `profiles.id`. PayHold mints its own
   * seller id and has no idea who our users are, so this column is the only way
   * to ask "which seller is this host of mine" without AutoHire's own link being
   * intact. Unique per tenant where present; null on a seller registered by hand
   * from PayHold's dashboard.
   */
  external_user_id: string | null;
}

/** The rail a destination is tokenized against — provider and method together. */
export type PayoutProvider =
  | 'flutterwave_momo'
  | 'flutterwave_bank'
  | 'stripe_connect'
  | 'paypal'
  | 'venmo'
  | 'cash_app_pay'
  | 'alipay'
  | 'wechat_pay';

/** Ledger money, in the currency the buyer was charged. */
export interface WalletBalance {
  currency: string;
  held: number;
  pending_clearance: number;
  available: number;
  reserved: number;
  paid_out: number;
}

/** What a withdrawal would actually move, in the seller's payout currency. */
export interface Withdrawable {
  currency: string;
  available_amount: number;
  available_count: number;
  requested_amount: number;
  requested_count: number;
  clearing_amount: number;
  clearing_count: number;
  held_count: number;
  needs_verification_count: number;
  blocked_count: number;
  paid_amount: number;
  paid_count: number;
}

/** Where a host's money can be sent. A seller may have more than one. */
export interface SellerDestination {
  id: string;
  label: string | null;
  country: string;
  payout_currency: string;
  payout_provider: PayoutProvider;
  masked_destination: string;
  is_primary: boolean;
  is_backup: boolean;
  /** Null until PayHold has verified it. An unverified one cannot be paid to. */
  verified_at: string | null;
  /** A freshly added destination is frozen for a window — §5.1's takeover guard. */
  security_hold_until: string | null;
}

/** One payout PayHold has scheduled, sent, or stopped. */
export interface Payout {
  id: string;
  deal_id: string;
  seller_id: string;
  amount: number;
  currency: string;
  status:
    | 'scheduled'
    | 'processing'
    | 'paid'
    | 'failed'
    | 'frozen'
    | 'held_for_review'
    | 'blocked'
    | 'needs_verification';
  /** When the clearance window ends and the cron will send it. */
  scheduled_for: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  attempts: number;
}

/** Per-deal money, every figure separately — PayHold derives these from its ledger. */
export interface DealAmounts {
  currency: string;
  buyer_paid: number;
  platform_fee: number;
  provider_fee: number;
  tax: number;
  reserve: number;
  refunded: number;
  paid_out: number;
  /** What the host actually earns on this trip. */
  seller_net: number;
}

export interface SellerCapabilities {
  can_receive_payouts: boolean;
  kyc_status: string;
  /** What this seller must go and do. */
  reasons: string[];
  /** What PayHold cannot reach — not the seller's fault and not their fix. */
  route_reasons: string[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = (Deno.env.get('PAYHOLD_BASE_URL') ?? '').replace(/\/+$/, '');
const API_KEY = Deno.env.get('PAYHOLD_API_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('PAYHOLD_WEBHOOK_SECRET') ?? '';

/** True once the secrets are set. Callers fall back to the old rails if not. */
export function payholdConfigured(): boolean {
  return !!BASE_URL && !!API_KEY;
}

export function payholdWebhookConfigured(): boolean {
  return !!WEBHOOK_SECRET;
}

export class PayHoldError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** PayHold's own code: not_found, invalid_state, policy_violation, … */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PayHoldError';
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function call<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  if (!payholdConfigured()) {
    throw new PayHoldError(
      'PayHold is not configured (set PAYHOLD_BASE_URL and PAYHOLD_API_KEY).',
      503,
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers: {
      // PayHold's own header — see payhold-backend/_shared/auth.ts, which reads
      // `x-api-key` and returns 401 'Missing X-Api-Key header' without it. It is
      // NOT a bearer token; Authorization there means a dashboard session.
      'X-Api-Key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const e = parsed as { error?: { code?: string; message?: string }; message?: string };
    throw new PayHoldError(
      e?.error?.message ?? e?.message ?? `PayHold returned ${res.status}.`,
      res.status,
      e?.error?.code,
    );
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

export interface CreateDealInput {
  /** The renter's AutoHire profile id. PayHold has no account for them. */
  buyerRef: string;
  /** The host's PayHold seller id. Must exist before a deal can name it. */
  sellerId: string;
  description: string;
  /** Minor units. RWF is zero-decimal, so RWF minor === RWF major. */
  amount: number;
  currency: string;
  /** The renter's own country, so PayHold can pick a rail they can pay on. */
  buyerCountry?: string;
  /** When the trip ends — PayHold's completion clock reads it. */
  expectedCompleteAt?: string;
  /**
   * Bound to the deal and returned by GET /deals/:id. This is the only trusted
   * route from a payment back to a trip: the webhook reads the booking's
   * particulars from here, never from its own payload.
   */
  metadata: Record<string, string>;
}

export interface CreateDealResult {
  deal: Deal;
  /** PayHold's hosted checkout. The renter picks a method and pays there. */
  payment_link: string;
}

/**
 * Open a deal. Nothing is charged yet — the renter pays on `payment_link`, and
 * the money is held until both sides confirm.
 */
export function createDeal(input: CreateDealInput): Promise<CreateDealResult> {
  return call<CreateDealResult>('/deals', {
    method: 'POST',
    body: {
      buyer_ref: input.buyerRef,
      seller_id: input.sellerId,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      buyer_country: input.buyerCountry,
      expected_complete_at: input.expectedCompleteAt,
      completion_policy: {
        // AutoHire's own name for the event that ends the work. PayHold stores
        // it verbatim and hands it back; it does not interpret it.
        completion_event: 'vehicle_returned',
        // auto_complete_after_hours and clearing_days are left null on purpose:
        // null means "use the tenant default", and those windows are PayHold
        // account settings that ops should be able to move without a deploy.
      },
      metadata: input.metadata,
    },
  });
}

/**
 * Re-read a deal. This is the trust boundary — the webhook's payload says what
 * happened, this says what is true.
 */
export function getDeal(id: string): Promise<Deal & { amounts: DealAmounts | null }> {
  return call(`/deals/${encodeURIComponent(id)}`, { method: 'GET' });
}

/**
 * Record one side's confirmation. When both sides have confirmed, PayHold
 * releases the hold atomically inside its own transaction — there is no
 * separate "release" call for AutoHire to make, and no window where it could
 * be missed.
 */
export function confirmDeal(id: string, side: 'buyer' | 'seller'): Promise<Deal> {
  return call<Deal>(`/deals/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: { side },
  });
}

/** Give the renter their money back. Omit `amount` for the full remainder. */
export function refundDeal(id: string, reason: string, amount?: number): Promise<Deal> {
  return call<Deal>(`/deals/${encodeURIComponent(id)}/refund`, {
    method: 'POST',
    body: { reason, ...(amount === undefined ? {} : { amount }) },
  });
}

// ---------------------------------------------------------------------------
// Sellers
// ---------------------------------------------------------------------------

export interface CreateSellerInput {
  name: string;
  country: string;
  payoutProvider: PayoutProvider;
  /**
   * The raw MoMo number or bank account. PayHold tokenizes it with the provider
   * and drops it — it is never written to a column on either side. AutoHire
   * holds it only for the duration of this call.
   */
  destination: string;
  payoutCurrency?: string;
  /**
   * The host's `profiles.id`. Sent so the seller can be found again from our
   * side alone — see `Seller.external_user_id`. PayHold **refuses** a second
   * registration under the same handle rather than returning the existing
   * seller, which is what turns a double-submit from an orphaned duplicate into
   * an error we can act on.
   */
  externalUserId?: string;
}

export function createSeller(
  input: CreateSellerInput,
): Promise<{ seller: Seller; payout_route: unknown }> {
  return call('/sellers', {
    method: 'POST',
    body: {
      name: input.name,
      country: input.country,
      payout_provider: input.payoutProvider,
      destination: input.destination,
      payout_currency: input.payoutCurrency,
      external_user_id: input.externalUserId,
    },
  });
}

/**
 * Find a host's seller by our own id for them.
 *
 * PayHold filters this server-side on the handle we registered them under, so
 * one host is one row — not a scan of every seller we have, which is a list
 * that grows with the business and would eventually paginate out from under
 * this lookup. An unmatched handle comes back as an empty list, because "this
 * host is not registered yet" is an answer and not a failure.
 *
 * This is the only repair available for a lost link. It cannot re-create a
 * seller: `POST /v1/sellers` tokenizes the RAW destination, and the raw number
 * exists only while the host is typing it — we store a mask and PayHold stores
 * a token, so neither side can reconstruct one. A host with no seller has to be
 * asked again; a host with a seller we lost track of can be re-linked here.
 */
export async function findSellerByExternalUserId(
  externalUserId: string,
): Promise<Seller | null> {
  const handle = externalUserId.trim();
  // PayHold rejects a blank handle rather than ignoring it, and it would come
  // back as a PayHoldError that callers here treat as "PayHold is unreachable".
  // No id means no seller, which we can answer without the round trip.
  if (!handle) return null;

  const { sellers } = await call<{ sellers: Seller[] }>(
    `/sellers?external_user_id=${encodeURIComponent(handle)}`,
    { method: 'GET' },
  );

  // The match is checked here and not taken on trust. A PayHold that predates
  // the filter ignores the parameter and answers with the tenant's WHOLE list,
  // and taking row zero of that would link this host to whichever seller was
  // registered most recently — someone else's payout destination, written onto
  // their profile. Checking the handle makes an undeployed filter read as "not
  // registered", which is wrong but harmless, instead of paying the wrong host.
  return sellers.find((s) => s.external_user_id === handle) ?? null;
}

/** Can this host be paid, and if not, what is missing. */
export function sellerCapabilities(id: string): Promise<SellerCapabilities> {
  return call(`/sellers/${encodeURIComponent(id)}/capabilities`, { method: 'GET' });
}

/**
 * One host's wallet, in two shapes that answer two questions.
 *
 * `balances` is ledger money in the currency the renter was charged.
 * `withdrawable` is what a withdrawal would actually move, in the host's own
 * payout currency, with a count against each reason something is stuck. A
 * cross-border trip makes these genuinely different numbers in different
 * currencies, so collapsing them would mean picking one to be wrong.
 */
export function sellerBalance(
  id: string,
): Promise<{ seller_id: string; balances: WalletBalance[]; withdrawable: Withdrawable[] }> {
  return call(`/sellers/${encodeURIComponent(id)}/balance`, { method: 'GET' });
}

/** Where this host can be paid — each with its own verification state. */
export function sellerDestinations(id: string): Promise<{ destinations: SellerDestination[] }> {
  return call(`/sellers/${encodeURIComponent(id)}/destinations`, { method: 'GET' });
}

/**
 * The tenant's payouts, newest first.
 *
 * PayHold has no per-seller filter here — this is every host's payouts, so a
 * caller MUST narrow by `seller_id` before showing anything. Doing that in the
 * one place that reads this (`payhold-earnings`) is why this returns raw.
 */
export function listPayouts(limit = 500): Promise<{ payouts: Payout[] }> {
  return call(`/payouts?limit=${limit}`, { method: 'GET' });
}

/**
 * Ask for the cleared money.
 *
 * This is not a shortcut past anything: PayHold runs the same frozen-tenant
 * check, eligibility gate, routing decision and provider call it runs for its
 * own cron. A withdrawal that skipped them would be a second way to pay a host
 * nobody had verified.
 */
export function withdraw(
  id: string,
  destinationId?: string,
): Promise<{ seller_id: string; requested: number; payouts: { payout_id: string; outcome: string }[] }> {
  return call(`/sellers/${encodeURIComponent(id)}/withdraw`, {
    method: 'POST',
    body: destinationId ? { destination_id: destinationId } : {},
  });
}

// ---------------------------------------------------------------------------
// Payment options — PayHold's routing table
// ---------------------------------------------------------------------------

/**
 * What PayHold can actually do in one country.
 *
 * `can_collect` and `can_payout` are separate because they genuinely are: 123 of
 * the 198 countries can be charged but not paid. China is the one that bit us —
 * a renter in Shanghai can pay for a trip, and a host in Shanghai can never
 * receive one, so offering them a payout method is offering a dead end.
 */
export interface PayoutCountry {
  code: string;
  name: string;
  flag: string;
  region: string;
  currency: string;
  can_collect: boolean;
  can_payout: boolean;
  /** Sanctioned — neither direction, and not a corridor that will open. */
  restricted: boolean;
  closed_reason: string | null;
}

export interface PaymentOptions {
  countries: PayoutCountry[];
  currencies: string[];
  /** False while PayHold's providers are still in test mode. */
  rails_verified: boolean;
}

/**
 * PayHold's own answer to "where can money go".
 *
 * AutoHire used to answer this from `FLUTTERWAVE_COUNTRIES`, an eight-entry
 * hardcoded list, which was wrong in both directions: it offered bank and card
 * to hosts in countries PayHold cannot pay at all, and it withheld payouts from
 * the 60-odd countries beyond those eight that PayHold does reach. This is the
 * authority, and it is tenant-wide rather than per-seller, so it caches well.
 */
export function paymentOptions(): Promise<PaymentOptions> {
  return call('/payment-options', { method: 'GET' });
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

export type DisputeSide = 'buyer' | 'seller';

/**
 * Open a case in PayHold's Resolution Center. Opening one freezes the payout on
 * that deal — that freeze is the reason to mirror AutoHire's disputes here at
 * all, rather than only tracking them locally.
 *
 * Note PayHold refuses `resolve` from an API key: deciding a case is a person's
 * judgement made in their dashboard, not something AutoHire's server can do on
 * its own behalf. Resolutions therefore travel back to us by webhook.
 */
export function openDispute(input: {
  dealId: string;
  raisedBy: DisputeSide;
  reason: string;
  reasonCode?: string;
  disputedAmount?: number;
}): Promise<{ id: string }> {
  return call('/disputes', {
    method: 'POST',
    body: {
      deal_id: input.dealId,
      raised_by: input.raisedBy,
      reason: input.reason,
      reason_code: input.reasonCode ?? 'other',
      disputed_amount: input.disputedAmount,
    },
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  event: string;
  deal_id: string | null;
  occurred_at: string;
  data: Record<string, unknown>;
}

/** Default replay window. PayHold retries at 1m, 5m, 30m and 2h. */
const SIGNATURE_TOLERANCE_SECONDS = 60 * 60 * 3;

/**
 * Verify a `PayHold-Signature: t=<unix>,v1=<hmac>` header.
 *
 * The MAC is HMAC-SHA256 over `${timestamp}.${rawBody}` — the timestamp is
 * inside the signed material, so it cannot be edited to extend the window.
 *
 * The age bound is what stops a captured delivery being replayed at us later.
 * It is generous because PayHold's last retry lands two hours out and rejecting
 * a legitimate final retry would lose the event for good.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!WEBHOOK_SECRET || !header) return false;

  const parts = new Map(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as [string, string];
    }),
  );
  const timestamp = Number(parts.get('t'));
  const presented = parts.get('v1');
  if (!Number.isFinite(timestamp) || !presented) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time compare — a length-leaking early return is enough to attack.
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(presented.toLowerCase());
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Mapping AutoHire onto PayHold
// ---------------------------------------------------------------------------

/** Currencies with no minor unit — the amount goes as-is, not ×100. */
const ZERO_DECIMAL = new Set(['RWF', 'UGX', 'JPY', 'KRW', 'VND', 'XAF', 'XOF']);

/** AutoHire stores whole units; PayHold wants minor units and only integers. */
export function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : Math.round(amount * 100);
}

export function fromMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? amount : amount / 100;
}

/**
 * Which PayHold rail a host's payout destination is tokenized against.
 *
 * Mobile money is Flutterwave's, everywhere it exists. A bank account goes to
 * Flutterwave inside its African corridors and to Stripe Connect outside them,
 * which is the same split `payoutProviderFor` makes in the web app.
 */
/** Every destination type a host can pick in the app. */
export type PayoutMethod =
  | 'momo'
  | 'bank'
  | 'card'
  | 'paypal'
  | 'venmo'
  | 'cash_app'
  | 'alipay'
  | 'wechat_pay';

export function payoutProviderFor(method: PayoutMethod, countryCode: string): PayoutProvider {
  const african = new Set(['RW', 'KE', 'UG', 'TZ', 'NG', 'GH', 'ZA', 'CM', 'CI', 'SN', 'ZM', 'ET']);
  if (method === 'momo') return 'flutterwave_momo';
  if (method === 'bank') {
    return african.has(countryCode.toUpperCase()) ? 'flutterwave_bank' : 'stripe_connect';
  }
  // The wallets are their own rails on PayHold, not a flavour of card. Mapping
  // them onto `stripe_connect` would demand an `acct_…` for a destination that
  // is an email address.
  if (method === 'paypal') return 'paypal';
  if (method === 'venmo') return 'venmo';
  if (method === 'cash_app') return 'cash_app_pay';
  if (method === 'alipay') return 'alipay';
  if (method === 'wechat_pay') return 'wechat_pay';
  return 'stripe_connect';
}
