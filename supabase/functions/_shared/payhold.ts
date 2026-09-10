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

/**
 * A daily return coming back within this many hours of the agreed time is
 * on time; past it, the late-return penalty applies. Shared between
 * `payhold-create-deal` (which pushes PayHold's own `expected_complete_at`
 * out by this much, so PayHold's automatic overage collection does not
 * start charging before AutoHire's own grace period would) and
 * `payhold-settle-usage` (which still computes the same window for a
 * pre-overage-wiring deal, and for its own display numbers). One constant
 * rather than two, so the two cannot drift apart.
 */
export const DAILY_OVERAGE_GRACE_HOURS = 2;

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
  /**
   * Installment billing (PayHold's, not a spec section — see its root
   * CLAUDE.md). Null `split_percent` means the whole `amount` was charged
   * up front; a non-null `balance_amount` of 0 means the split deal's
   * second installment has already been collected.
   */
  split_percent: number | null;
  balance_amount: number | null;
  overage_rate: number | null;
  overage_unit_seconds: number | null;
  /** What we attached at creation. This is how a deal is bound to a booking. */
  metadata: Record<string, string>;
  created_at: string;
  /** Present on single-deal reads and on `confirm`; absent from list rows. */
  confirmations?: { side: 'buyer' | 'seller'; actor: string; confirmed_at: string }[];
}

export interface Seller {
  id: string;
  name: string;
  /**
   * Null until a destination is registered — PayHold's `20260814000001` made
   * that optional, which is what `payhold-ensure-seller` relies on: a host
   * gets a seller record the moment they toggle to host mode, before they
   * have typed a payout number. `country`, `payout_currency` and
   * `masked_destination` are null together with it.
   */
  country: string | null;
  payout_currency: string | null;
  /** PayHold's own enum column — three values, never a disabled rail. */
  payout_provider: PayoutRail | null;
  masked_destination: string | null;
  kyc_status: 'pending' | 'verified' | 'restricted' | 'rejected' | 'review_required';
  /**
   * Our own handle for this host — their `profiles.id`. PayHold mints its own
   * seller id and has no idea who our users are, so this column is the only way
   * to ask "which seller is this host of mine" without AutoHire's own link being
   * intact. Unique per tenant where present; null on a seller registered by hand
   * from PayHold's dashboard.
   */
  external_user_id: string | null;
  /**
   * Whether this host is currently one of our active sellers. Status only —
   * PayHold's payout path never reads it. `payhold-ensure-seller` sets it true
   * on every toggle to host mode (including reactivating one that had gone
   * false); `payhold-deactivate-seller` sets it false on the toggle back.
   */
  active: boolean;
}

/**
 * The rail a destination is tokenized against — provider and method together.
 *
 * **These three are the whole of PayHold's `payout_provider` Postgres enum**
 * (`20260805000001_schema.sql`). Nothing else can ever be stored against a
 * destination, so nothing else can ever come back on a `Seller` or a
 * `SellerDestination`, and nothing here may ever send one.
 */
export type PayoutRail =
  | 'flutterwave_momo'
  | 'flutterwave_bank'
  | 'stripe_connect'
  /**
   * Live since PayHold's `20260910000005` lifted the §16 gate on the
   * `(paypal, paypal)` route. It is a real `payout_provider` value with an
   * adapter behind it, so AutoHire may produce it — which nothing here could
   * do while it sat in `DisabledPayoutRail`.
   *
   * **Eligibility is per (country, currency), not per country**, because the
   * row carries PayPal's currencies intersected with what PayHold can price:
   * a Kenyan seller paid in USD reaches it, the same seller paid in KES does
   * not. Nothing in AutoHire may guess at that — `payout.methods` from the
   * live route is the only thing that knows, which is why `payoutProviderFor`
   * still answers `null` for it and the rescue path does the work.
   */
  | 'paypal';

/**
 * §29.3's declared-and-disabled rails — Venmo, Cash App Pay, Alipay, WeChat
 * Pay. **PayPal left this set on 2026-09-10** (`20260910000005`): its route is
 * enabled, it has an adapter, and it is a `PayoutRail` now. The other four are
 * unchanged, and the way to tell is not this comment — it is whether PayHold
 * names the method in `payout.methods`. They exist as `payout_routes` rows so a host who picks one gets a
 * specific sentence instead of "unknown destination type", and those rows carry
 * **no `provider`**, which a check constraint turns into "cannot be enabled".
 * There is no live payout adapter behind any of the five and no signed
 * agreement behind the one class that exists (PayPal), so a destination on one
 * of them cannot be created, cannot be routed, and cannot be paid.
 *
 * They used to sit in `PayoutProvider` beside the three real rails, and
 * `payoutProviderFor` mapped a host's choice straight onto them — a host who
 * picked PayPal got a destination registered against a rail with nothing behind
 * it, and their first payout sat at `blocked` forever. `payoutProviderFor`
 * answers `null` for all five now.
 *
 * The names survive only because `methodForProvider` in
 * `payhold-register-seller` keys a `Partial<Record<PayoutProvider, string>>` on
 * them. **Nothing in AutoHire may produce one**, and no PayHold row can carry
 * one — which is why every field that holds what PayHold actually said is typed
 * `PayoutRail`, not this.
 */
export type DisabledPayoutRail = 'venmo' | 'cash_app_pay' | 'alipay' | 'wechat_pay';

export type PayoutProvider = PayoutRail | DisabledPayoutRail;

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
  payout_provider: PayoutRail;
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
  /**
   * The currency the RENTER is charged in, when it differs from `currency`.
   *
   * `currency` is the settlement currency — the car's own, what the host is
   * owed — and it must not move because a renter picked something else to pay
   * in. This is the other half of that pair: PayHold converts and carries the
   * FX, so the host is still paid in the car's currency whatever the renter's
   * card was charged. Omit and PayHold picks from `buyerCountry` as before.
   */
  presentmentCurrency?: string;
  /** When the trip ends — PayHold's completion clock reads it. */
  expectedCompleteAt?: string;
  /**
   * Charge this percentage of `amount` now; the rest is collected
   * automatically, on the card the renter paid with, the moment both sides
   * confirm the trip is over. Omit for the old behaviour: all of `amount`
   * charged up front.
   */
  splitPercent?: number;
  /**
   * Per-unit price for a late return, in `currency`'s minor units — charged
   * on top of the split's second installment if the trip is confirmed
   * returned after `expectedCompleteAt`. Requires `overageUnitSeconds` and
   * `expectedCompleteAt` together.
   */
  overageRate?: number;
  overageUnitSeconds?: number;
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
      ...(input.presentmentCurrency ? { presentment_currency: input.presentmentCurrency } : {}),
      expected_complete_at: input.expectedCompleteAt,
      ...(input.splitPercent === undefined ? {} : { split_percent: input.splitPercent }),
      ...(input.overageRate === undefined
        ? {}
        : { overage_rate: input.overageRate, overage_unit_seconds: input.overageUnitSeconds }),
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
 *
 * `overageOverride` is the host's own lever on a late charge — reduce or
 * waive it before it is collected. PayHold refuses it outright unless
 * `side === 'seller'`, so passing it on the renter's own confirmation is
 * simply wasted, not a way around the restriction.
 */
export function confirmDeal(
  id: string,
  side: 'buyer' | 'seller',
  overageOverride?: number,
): Promise<Deal> {
  return call<Deal>(`/deals/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: {
      side,
      ...(overageOverride === undefined ? {} : { overage_override: overageOverride }),
    },
  });
}

/** Give the renter their money back. Omit `amount` for the full remainder. */
export function refundDeal(id: string, reason: string, amount?: number): Promise<Deal> {
  return call<Deal>(`/deals/${encodeURIComponent(id)}/refund`, {
    method: 'POST',
    body: { reason, ...(amount === undefined ? {} : { amount }) },
  });
}

/**
 * Withdraw a deal that never took money — the renter closed the payment sheet.
 *
 * Allowed only from `created`, `checkout_started` and `payment_failed`;
 * PayHold refuses `payment_pending` (a mobile-money push may still be
 * approved on the renter's phone) and anything funded or later, which must be
 * refunded rather than cancelled. Idempotent: cancelling an already-cancelled
 * deal returns it and writes nothing, so a double-tap on the close button is
 * safe. PayHold keeps the row as `canceled` with an audit entry — nothing is
 * deleted there; removing the local booking is the caller's half.
 */
export function cancelDeal(id: string, reason: string): Promise<Deal> {
  return call<Deal>(`/deals/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: { reason },
  });
}

// ---------------------------------------------------------------------------
// Sellers
// ---------------------------------------------------------------------------

export interface CreateSellerInput {
  name: string;
  /**
   * `country`, `payoutProvider` and `destination` are optional together — as of
   * PayHold's `20260814000001`, a seller can be registered with no destination
   * at all. That is what `payhold-ensure-seller` does the moment someone
   * becomes a host: money can start accruing against them before they have
   * typed a payout number. Sending one of the three without the others is
   * refused rather than silently dropped, same as on PayHold's side.
   */
  country?: string;
  /**
   * Only ever one of the three `PayoutRail` values in practice — the wider type
   * is here because `payhold-register-seller` threads it through a local
   * signature typed `PayoutProvider`. `payoutProviderFor` is what makes that
   * true: it answers `null` for every disabled rail, so a caller that checks
   * for null (they all do) cannot reach this field with one.
   */
  payoutProvider?: PayoutProvider;
  /**
   * The raw MoMo number or bank account. PayHold tokenizes it with the provider
   * and drops it — it is never written to a column on either side. AutoHire
   * holds it only for the duration of this call.
   */
  destination?: string;
  /**
   * The mobile-money wallet the number belongs to — "MTN", "Airtel Money",
   * "M-Pesa". Required in practice for a momo destination: PayHold used to
   * guess it, and a wrong guess registered a destination Flutterwave will not
   * transfer to, which surfaces as a payout stuck weeks later rather than as
   * an error the host could have fixed while they were still on the screen.
   * PayHold now refuses a momo destination without it.
   */
  network?: string;
  /** The bank's own code, for a bank destination. Refused without it, same reason. */
  bankCode?: string;
  payoutCurrency?: string;
  /**
   * The host's `profiles.id`. Sent so the seller can be found again from our
   * side alone — see `Seller.external_user_id`. PayHold **refuses** a second
   * registration under the same handle rather than returning the existing
   * seller, which is what turns a double-submit from an orphaned duplicate into
   * an error we can act on.
   */
  externalUserId?: string;
  /**
   * What we call this destination — "Bank transfer", "Mobile Money". Same
   * field `AddDestinationInput` already sends on every later save; a host's
   * first destination deserves it as much as their second, since PayHold's own
   * mask guesses this word from a provider field (Flutterwave's `bank_name`)
   * that is unset for every RWF corridor.
   */
  label?: string;
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
      network: input.network,
      bank_code: input.bankCode,
      payout_currency: input.payoutCurrency,
      external_user_id: input.externalUserId,
      label: input.label,
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
 * Whether this host is currently one of our active sellers.
 *
 * Status only — PayHold's payout path never reads it, so this never blocks or
 * delays money already owed to a host who stepped back. Unlike `verifySeller`
 * on PayHold's own client this takes an API key happily: it is us restating a
 * fact about our own roster, not an attestation.
 */
export function setSellerActive(id: string, active: boolean): Promise<Seller> {
  return call(`/sellers/${encodeURIComponent(id)}/active`, {
    method: 'POST',
    body: { active },
  });
}

/**
 * Keep PayHold's record of a seller's name matching AutoHire's own — a
 * profile edit after registration used to go nowhere, leaving PayHold's
 * Sellers dashboard showing whoever a host was the day they were registered
 * even after their profile changed. Same restating-a-known-fact shape as
 * `setSellerActive`.
 */
export function setSellerName(id: string, name: string): Promise<Seller> {
  return call(`/sellers/${encodeURIComponent(id)}/name`, {
    method: 'POST',
    body: { name },
  });
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

export interface AddDestinationInput {
  /** Which currency this destination is paid in. Omitted means the country's own. */
  currency?: string | null;
  /** See `CreateSellerInput.payoutProvider` — a `PayoutRail` in practice. */
  payoutProvider: PayoutProvider;
  /** Raw MoMo number, account number or wallet handle. Tokenized and dropped. */
  destination: string;
  /** The wallet a momo number belongs to. See `CreateSellerInput.network`. */
  network?: string;
  /** The bank a bank account belongs to. See `CreateSellerInput.bankCode`. */
  bankCode?: string;
  /** Defaults to the seller's own country, which a rail change does not move. */
  country?: string;
  label?: string;
  /** 'primary' moves where the money goes; 'backup' is only used after a failure. */
  role?: 'primary' | 'backup';
}

/**
 * Move where a host is paid — the operation `createSeller` deliberately is not.
 *
 * PayHold refuses a second `POST /sellers` under the same `external_user_id`
 * precisely so a re-registration cannot become a silent destination change.
 * This is the door with the lock on it: the new row lands unverified and inside
 * §5.1's security hold, so payouts pause until PayHold has checked the account
 * belongs to the host. That pause is the feature — the shape of an account
 * takeover is "move the destination, then withdraw" — and there is no parameter
 * to skip it. A caller's job is to tell the host it will happen.
 */
export function addSellerDestination(
  sellerId: string,
  input: AddDestinationInput,
): Promise<{ destination: SellerDestination }> {
  return call(`/sellers/${encodeURIComponent(sellerId)}/destinations`, {
    method: 'POST',
    body: {
      payout_provider: input.payoutProvider,
      destination: input.destination,
      network: input.network,
      bank_code: input.bankCode,
      country: input.country,
      // **Sent, or the currency chooser is decoration.** PayHold defaults
      // `payout_currency` to the country's own, so a Kenyan host who chose USD
      // and had it omitted here would get a KES destination — and PayPal, the
      // reason they chose USD, is not a rail KES can use. Offering a currency
      // and registering a different one is worse than not offering it.
      payout_currency: input.currency,
      label: input.label,
      role: input.role ?? 'primary',
    },
  });
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
// Stripe Connect onboarding — minting the acct_… `stripe_connect` needs
// ---------------------------------------------------------------------------

export interface ConnectOnboardingStart {
  account_id: string;
  /** One-time hosted onboarding link. Redirect the host here; do not cache it. */
  url: string;
}

/**
 * Start (or resume) Stripe Connect onboarding for a host whose market pays
 * out via `stripe_connect` rather than Flutterwave. That rail's destination
 * cannot be typed in — `addSellerDestination` tokenizes an existing `acct_…`,
 * and outside Africa nobody has minted one until the host has gone through
 * Stripe's own hosted onboarding. This is what starts it.
 *
 * Idempotent across repeat calls before completion: PayHold reuses the same
 * in-progress account rather than minting a second Express account every time
 * a host reopens the link.
 */
export function startConnectOnboarding(
  sellerId: string,
  input: { returnUrl: string; refreshUrl: string; country?: string; email?: string | null },
): Promise<ConnectOnboardingStart> {
  return call(`/sellers/${encodeURIComponent(sellerId)}/connect/onboard`, {
    method: 'POST',
    body: {
      return_url: input.returnUrl,
      refresh_url: input.refreshUrl,
      country: input.country,
      email: input.email,
    },
  });
}

export interface ConnectSession {
  account_id: string;
  /**
   * Single-use and short-lived, by Stripe's design. **Never cache it.**
   * Connect.js calls `fetchClientSecret` again when a session expires
   * mid-onboarding, and returning the first secret a second time strands the
   * host on whatever step they had reached — typically the one where they are
   * entering bank details. PayHold mints a fresh session per call for exactly
   * this reason, so the correct client behaviour is to re-POST every time.
   */
  client_secret: string;
  /**
   * The tenant's own publishable key. Not a secret, and deliberately returned
   * rather than compiled in: a client that hardcodes a provider key is a
   * client that has to be rebuilt when the account behind it changes, and it
   * is the same "never keep your own copy of somebody else's data" failure as
   * the payout table.
   */
  publishable_key: string;
}

/**
 * A Connect embedded-components session — the in-app alternative to
 * `startConnectOnboarding`'s redirect.
 *
 * Same destination, different surface: `/connect/onboard` sends the host to
 * Stripe's hosted page, this mounts the same onboarding inside AutoHire.
 * Neither is evidence of completion — `connectOnboardingStatus` remains the
 * only thing that promotes a destination, because a host can close either one
 * at any point and Stripe tells us nothing by their leaving.
 *
 * **The redirect stays reachable.** Stripe's own docs rule embedded components
 * out inside mobile and desktop webviews, and AutoHire ships as a PWA, so the
 * hosted page is the fallback wherever this cannot mount rather than a legacy
 * path to be removed.
 */
export function startConnectSession(
  sellerId: string,
  input: { country?: string },
): Promise<ConnectSession> {
  return call(`/sellers/${encodeURIComponent(sellerId)}/connect/session`, {
    method: 'POST',
    // **The country, same as `/connect/onboard`.** This posted an empty body,
    // which is not "no opinion" — PayHold falls back to the stored
    // `seller.country`, so a host who had moved was refused with the country
    // they left. A US host saw "Paying out from: United States" and "We cannot
    // pay out to Rwanda through Stripe" on the same screen, inches apart.
    //
    // Exactly the failure `payhold-register-seller` had on its destination
    // path, reintroduced here because this endpoint was added later and the
    // empty body looked harmless. Stripe also fixes an account's country at
    // creation and will not change it afterwards, so the country this call
    // carries is the one the host is stuck with.
    body: { country: input.country },
  });
}

export type ConnectOnboardingStatus =
  | { status: 'not_started' }
  | { status: 'pending'; account_id: string }
  | { status: 'connected'; destination: SellerDestination };

/**
 * Has Stripe finished onboarding this host? Called from the return page
 * rather than trusted from the redirect itself — same "the return is not the
 * evidence" shape PayHold's own checkout polling uses. A `connected` result
 * means PayHold has already written the destination (unverified, inside its
 * usual security hold); there is nothing left here to save.
 */
export function connectOnboardingStatus(sellerId: string): Promise<ConnectOnboardingStatus> {
  return call(`/sellers/${encodeURIComponent(sellerId)}/connect/status`, { method: 'GET' });
}

// ---------------------------------------------------------------------------
// Checkout sessions — the renter's half of a deal
// ---------------------------------------------------------------------------

/**
 * A session is a deal made payable by someone who holds no credential.
 *
 * The token IS the authorisation: scoped to one payment on one deal, and it
 * expires. That is what lets AutoHire's browser read the methods and start the
 * payment itself, instead of proxying both through an Edge Function that would
 * only be relaying a public call while holding a secret key.
 *
 * Idempotent per deal — a retry hands back the live session rather than minting
 * a second payable link for the same trip.
 */
export interface CheckoutSession {
  id: string;
  deal_id: string;
  status: string;
  /**
   * The renter-facing checkout URL. Its last path segment is the session token,
   * which is what the public routes are addressed by — PayHold returns the URL
   * rather than the bare token, so callers derive it.
   */
  url: string;
  method: string | null;
  network: string | null;
  provider: string | null;
  expires_at: string;
}

/** The session token, as the public routes want it. */
export function sessionToken(session: CheckoutSession): string | null {
  const last = session.url?.split('/').filter(Boolean).pop();
  return last || null;
}

export function createCheckoutSession(
  dealId: string,
  returnUrl: string,
): Promise<CheckoutSession> {
  return call('/checkout/sessions', {
    method: 'POST',
    body: { deal_id: dealId, return_url: returnUrl },
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

/** How a seller in one specific country is actually paid, from `payoutRoute`. */
export interface PayoutCountryRoute {
  country: { code: string; name: string; flag: string };
  payout: {
    provider: 'flutterwave' | 'stripe' | null;
    /** `momo`/`bank` are Flutterwave's; `connect` is Stripe's — never both at once. */
    kind: 'momo' | 'bank' | 'connect' | null;
    currency: string;
    blocked: boolean;
    verified: boolean;
    reason: string;
    /**
     * Every destination this market can actually be paid into, which is the
     * question `kind` cannot answer: it is one value and a market is not.
     * Kenya and Tanzania take a wallet while their bank corridor sits behind a
     * Flutterwave request, Malawi likewise, Ethiopia takes either. PayHold
     * derives it from `route_evaluation`, so a rail switched off or missing an
     * adapter drops out without anyone remembering to remove it, and sorts
     * `kind` first so the preferred destination heads the list.
     *
     * Optional: an operator-closed market answers without it, and a PayHold
     * predating the field sends nothing.
     */
    methods?: ('momo' | 'bank' | 'connect' | 'paypal')[];
    /**
     * Every currency a host in this market can actually be paid in, and what
     * each one can be paid into. The other half of `methods`, and the half a
     * payout form cannot invent.
     *
     * **Nested inside `payout`, beside `methods`** — not a sibling of it.
     * Read a level up it is `undefined`, which is silent.
     *
     * `default: true` marks the country's own currency, and PayHold sorts it
     * first. Preselect it: a host who has been paid in their local currency
     * for months should not find it quietly changed by a new picker.
     *
     * A closed market returns `[]`. Empty is not "no restriction".
     */
    currencies?: { currency: string; methods: ('momo' | 'bank' | 'connect' | 'paypal')[]; default: boolean }[];
    /**
     * Currencies a host might have expected and cannot have, with why.
     *
     * Bounded by the caller, not by the table: `?explain_currencies=` names
     * what to explain (default `USD,EUR`, capped at ten). PayHold cannot
     * bound it itself — a Rwandan wallet row carries KES, UGX, TZS, GHS, ZMW,
     * XOF and XAF, so "everything absent" would explain to a Rwandan host why
     * they cannot be paid in Ugandan shillings, which nobody wondered.
     *
     * The one that matters most is the currency the host is *already* paid
     * in quietly dropping out. This endpoint cannot know it — it is a
     * catalogue keyed by country and currency, and a seller lookup would make
     * a cacheable answer depend on whose it is — so the client names it.
     *
     * `reason_code` is the stable value to switch on; `permanence` is 1:1
     * with it today and kept deliberately, so an unrecognised future code
     * still renders correctly instead of showing a blank. `message` states
     * the fact about the market and stops — anything about *this host's*
     * situation is the client's to add, because PayHold does not know whether
     * they have a payout method at all.
     *
     * Never overlaps `currencies`; `[]` for a closed market.
     */
    currencies_unavailable?: {
      currency: string;
      reason_code: 'no_rail_reaches_market' | 'local_currency_only' | 'rail_unavailable';
      permanence: 'permanent' | 'method_dependent' | 'temporary';
      message: string;
    }[];
  };
  /**
   * The mobile-money wallets that actually exist in this country — "MTN",
   * "Airtel Money", "M-Pesa". A momo destination has to name one, so the host
   * has to be offered the real list rather than typing a brand PayHold will
   * refuse.
   */
  networks?: string[];
  /**
   * The banks, when they were asked for (`banks: true`). **`null` is not an
   * empty list**: it means either that they were not asked for, or that the
   * rail could not be reached to enumerate them — and showing "no banks" for
   * a country that has plenty is worse than showing nothing at all.
   */
  banks?: { code: string; name: string }[] | null;
  rails_verified: boolean;
}

/**
 * The one thing `paymentOptions()`'s bulk list cannot answer: what a seller in
 * THIS country can actually be paid with. The bulk list's `can_payout` is a
 * country-level boolean; it says nothing about which methods work inside a
 * payable country, and AutoHire used to fill that gap with a local guess (see
 * `payoutMethodsFor` in the web app) that offered PayPal, Venmo, Cash App,
 * Alipay and WeChat Pay as payout methods everywhere those brands are known —
 * none of which PayHold can actually pay out to today (§9: declared and
 * disabled, no live adapter) — and offered Card in Flutterwave's African
 * corridors, where Stripe cannot reach a recipient and Flutterwave has no card
 * payout at all. Either one leaves a host's first payout stuck at `blocked`
 * weeks after they thought they had finished setup.
 *
 * `banks` is opt-in because enumerating them is a live call into the rail on
 * PayHold's side, and only the host who has actually chosen Bank needs the
 * list — every other caller of this asks the same question without paying for
 * an answer it will not render.
 */
export async function payoutRouteFor(
  country: string,
  opts?: { banks?: boolean; currency?: string | null; explain?: string[] },
): Promise<PayoutCountryRoute> {
  // `payout_currency` is optional and PayHold defaults it to the country's own
  // currency. That default is why PayPal was unreachable in every African
  // corridor: PayPal takes no KES, NGN, GHS or RWF, so asking about KE always
  // asked about KES and always got mobile money back, while KE in USD routes
  // PayPal perfectly well. Sending it is what lets a host be paid in a
  // currency their country does not use.
  // `explain_currencies` names which absent currencies deserve an explanation.
  // PayHold defaults to USD,EUR; the caller adds the one that actually matters
  // — the currency this host is already paid in, which PayHold cannot know.
  const explain = (opts?.explain ?? []).filter(Boolean);
  const query = `payout_country=${encodeURIComponent(country)}` +
    (opts?.currency ? `&payout_currency=${encodeURIComponent(opts.currency)}` : '') +
    (explain.length > 0
      ? `&explain_currencies=${encodeURIComponent(explain.join(','))}`
      : '') +
    (opts?.banks ? '&banks=1' : '');
  const route = await call<PayoutCountryRoute>(`/payment-options?${query}`, { method: 'GET' });
  warnOnRouteDrift(country, route);
  return route;
}

/**
 * Say out loud when `FLUTTERWAVE_PAYOUT_KIND` and PayHold disagree.
 *
 * The table below `payoutProviderFor` is a hardcoded copy of PayHold's routing,
 * kept only because that function has to answer synchronously on the
 * registration path. A copy drifts — this one already did, silently, and
 * Burkinabè hosts could not set up payouts for as long as nobody noticed.
 *
 * This is the cheap half of the fix. Every call to `payoutRouteFor` already
 * holds both answers at once: PayHold's live route for a country, and what the
 * table would have said about the same country. Comparing them costs nothing
 * and turns the next drift into a log line on the very first host who opens the
 * payout screen in the affected market, instead of a support ticket months
 * later — or nothing at all, which is what happened last time.
 *
 * **It only ever logs.** PayHold's answer is returned untouched either way: it
 * is the authority, the table is the copy, and a shared helper on the money
 * path that could throw would turn a bookkeeping disagreement into an outage.
 * A drifted country is one whose `FLUTTERWAVE_PAYOUT_KIND` row should be
 * corrected against PayHold's generated `countries.ts`.
 */
function warnOnRouteDrift(country: string, route: PayoutCountryRoute): void {
  try {
    const code = country.toUpperCase();

    // What PayHold just said, in this table's own terms.
    const live: 'momo' | 'bank' | null = route.payout?.provider === 'flutterwave'
      ? route.payout.kind === 'momo' ? 'momo' : 'bank'
      : null;
    const local = FLUTTERWAVE_PAYOUT_KIND[code] ?? null;

    // A deliberately closed corridor is usually not drift: `payment_markets` is
    // an overlay an operator sets with a reason, it changes without the
    // registry changing, and `payoutAvailability` already renders it as "not
    // open yet" — warning every time would bury the one message worth reading.
    //
    // **But only when this table agrees the country is unpayable.** This used
    // to return on `blocked` before reading the table at all, and that is why
    // the BF drift was silent for its whole life: PayHold blocked Burkina Faso,
    // the table still said `momo`, `payoutProviderFor` still handed out
    // `flutterwave_momo`, and the one mechanism built to notice suppressed
    // itself on the very signal that meant it was wrong. A blocked corridor the
    // table still thinks it can pay is the most urgent drift there is — it is
    // the shape that registers destinations which can never be paid.
    if (route.payout?.blocked && local === null) return;
    if (!route.payout?.blocked && live === local) return;

    console.warn(
      `[payhold] payout-route drift for ${code}: PayHold ` +
        (route.payout?.blocked
          ? `BLOCKS payouts here (${route.payout.reason || 'no reason given'})`
          : `routes it as ${live ?? 'not a Flutterwave payout corridor'}`) +
        ` (provider=${route.payout?.provider ?? 'none'}, kind=` +
        `${route.payout?.kind ?? 'none'}, blocked=${route.payout?.blocked ?? false}), while ` +
        `FLUTTERWAVE_PAYOUT_KIND in _shared/payhold.ts says ` +
        `${local ?? 'not a Flutterwave payout corridor'}. ` +
        `payoutProviderFor() is therefore refusing or mis-routing destinations ` +
        `in ${code} — correct the table against PayHold's generated countries.ts ` +
        `(membership = flutterwavePayout, kind = momoPayout).`,
    );
  } catch {
    // A diagnostic must never be able to fail a payout-route lookup.
  }
}

/**
 * What a renter in one country can actually be charged — the collection side,
 * and the mirror of `payoutRouteFor`'s seller side.
 *
 * `currencies` is the authoritative answer to "which currencies may this deal
 * be presented in", and it is PayHold's to give: it is every currency that
 * market's rails can take, intersected with the currencies this tenant has
 * enabled. AutoHire used to approximate it (the country's own currency plus
 * USD/EUR/GBP) because nothing here asked — an approximation that offers a
 * currency PayHold will refuse, or hides one it would have taken.
 */
export interface CollectionOptions {
  country: { code: string; name: string; flag: string; currency: string };
  restricted: boolean;
  closed?: boolean;
  /** The currency `methods` are quoted in. */
  charged_in?: string;
  methods: { method: string; label: string; networks?: string[] }[];
  /** Every currency a buyer here can be charged. Empty when the market is shut. */
  currencies: string[];
  reason?: string;
  rails_verified: boolean;
}

export function collectionOptionsFor(country: string): Promise<CollectionOptions> {
  return call(`/payment-options?country=${encodeURIComponent(country)}`, { method: 'GET' });
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

/**
 * Flutterwave's payout corridors, and which kind of destination each reaches.
 *
 * **This is a copy of somebody else's data and it should not be one.** The
 * authority is PayHold's generated `_shared/countries.ts` — `flutterwavePayout`
 * for membership, `momo` for the kind, which is exactly how PayHold's own
 * `payoutRoute` decides it (`rails.ts`: `kind: hasWallet ? 'momo' : 'bank'`,
 * where `hasWallet` is a mobile-money rail that can pay out, i.e. `momo &&
 * flutterwavePayout`). `payoutRouteFor` below asks PayHold that question live
 * and is the answer every screen should be reading.
 *
 * It survives here because **`payoutProviderFor` is synchronous and sits on the
 * registration path**: `payhold-register-seller` calls it to decide whether to
 * tokenize a destination at all, before any network call, and every caller
 * treats its `null` as "refuse now". Making it async to fetch a route would put
 * a live PayHold round trip — and PayHold being briefly unreachable — between a
 * host and the ability to add a payout method, on a code path whose whole job
 * is to fail closed. So the table stays, and the drift it invites is made
 * *loud* instead: `payoutRouteFor` compares PayHold's live answer against this
 * table on every call and logs when they disagree. See `warnOnRouteDrift`.
 *
 * The last drift was silent and cost real hosts: this set was missing **BF**
 * (Burkina Faso), so a host there was routed to `stripe_connect` for a bank
 * account, PayHold's `assertRailOnRoute` refused the rail, and they could not
 * set up payouts at all — with nothing on the screen able to tell them why.
 *
 * **The derivation below used to read `c.momo` and that is now the wrong
 * flag.** PayHold split one `momo` boolean into two on 2026-09-10 (`momo` =
 * a wallet can be *charged* here, `momoPayout` = a wallet can be *paid* here),
 * because they are two different provider pages and they disagree. `rails.ts`
 * picks the kind from the payout side — `hasWallet` is a `mobile_money` rail
 * with `payout: true` — so this table has to read `momoPayout` too. Reading
 * the collection flag is what put **ET** on `bank` below: Ethiopia has no
 * collection channel at all, so `momo` is false there, while Amole Money has
 * taken payouts since the split.
 *
 * Re-derive against PayHold's generated `_shared/countries.ts` with:
 *   COUNTRIES.filter(c => c.flutterwavePayout)
 *            .map(c => [c.code, c.momoPayout ? 'momo' : 'bank'])
 */
const FLUTTERWAVE_PAYOUT_KIND: Record<string, 'momo' | 'bank'> = {
  // West Africa
  CI: 'momo',
  GH: 'momo',
  NG: 'bank', // No mobile money on Flutterwave in Nigeria — bank transfer only.
  SN: 'momo',
  // Central Africa
  CM: 'momo',
  // East Africa
  ET: 'momo', // Amole Money. No collection channel here — payout wallet only.
  KE: 'momo',
  RW: 'momo',
  TZ: 'momo',
  UG: 'momo',
  // Southern Africa
  MW: 'momo', // Airtel Money (AIRTELMW). Bank transfers there stay closed.
  ZA: 'bank',
  ZM: 'momo',
};

/**
 * Flutterwave *collects* here and nothing *pays out* here — so no rail on
 * earth reaches a host in one of these, and the honest answer at registration
 * is to refuse rather than to tokenize.
 *
 * Without this set they fall out of `FLUTTERWAVE_PAYOUT_KIND` into
 * `payoutProviderFor`'s `stripe_connect` default, which is the precise bug
 * recorded above: Stripe cannot reach a recipient in any of them (African
 * payouts always ride Flutterwave, per docs/payhold.md), `assertRailOnRoute`
 * refuses, and the host is left with no way through and no explanation. **BF**
 * was removed from the table above on 2026-09-10 — its Flutterwave transfer
 * guide is real, but `/banks/BF` errors so there are no bank codes to send to,
 * and the momo transfer table names no Burkinabè network — and it would have
 * re-entered that bug on the way out. EG has sat in it all along.
 *
 * **MW left this set the same day**, in the other direction: PayHold opened
 * Malawi's wallet corridor (`20260910000004`), so Airtel Money reaches a
 * Malawian host and the country belongs in the kind table above. Its *bank*
 * corridor stays closed, which this set cannot express and does not need to —
 * `payout.methods` says so per request.
 *
 * Collection is a different fact and is deliberately untouched: renters in all
 * three can still pay. See `FLUTTERWAVE_COLLECT_COUNTRIES` in
 * `web/src/lib/payments.ts`.
 *
 * Re-derive with:
 *   COUNTRIES.filter(c => c.flutterwaveLocal && !c.flutterwavePayout && !c.stripePayout)
 *            .map(c => c.code)
 */
const NO_PAYOUT_RAIL = new Set(['BF', 'EG']);

/**
 * Which PayHold rail a host's payout destination is tokenized against, or
 * `null` when no rail actually reaches this method in this country.
 *
 * `null` is what lets the caller refuse before tokenizing anything, instead of
 * creating a destination that will sit at `blocked` forever. This function is
 * the one place every registration and every destination change goes through,
 * so it is the backstop against a stale client, a direct API call, or the
 * method picker's own next bug reaching PayHold with a dead-end combination.
 *
 * Three cases answer `null`, and each of them used to answer something:
 *
 *   • **Mobile money outside a Flutterwave momo corridor.** This returned
 *     `flutterwave_momo` for every country on earth. A US host picking MoMo got
 *     a destination registered against a rail that does not exist there, and so
 *     did a host in Nigeria, Ethiopia or South Africa — Flutterwave pays those
 *     three by bank transfer and has no wallet to send to.
 *
 *   • **Card inside a Flutterwave corridor.** Stripe cannot reach a recipient
 *     there at all (African payouts always ride Flutterwave, per
 *     docs/payhold.md) and Flutterwave has no card payout of its own.
 *
 *   • **Every wallet, including PayPal — but for two different reasons now.**
 *     Venmo, Cash App, Alipay and WeChat Pay are still §29.3's
 *     declared-and-disabled rails: no `provider` on the route row, no live
 *     adapter, nothing to fall back to. **PayPal is live** since
 *     `20260910000005` and still answers `null` here, because this function is
 *     synchronous and PayPal's eligibility is per (country, currency) — a
 *     Kenyan seller paid in USD reaches it and the same seller paid in KES does
 *     not. A hardcoded table cannot hold that and must not try. The caller
 *     turns this `null` into a live-route check (`payoutRailFromRoute`), which
 *     answers `'paypal'` wherever PayHold's `methods` names it, so a refusal
 *     here is a question rather than a verdict.
 *
 *   • **A market Flutterwave collects in and nobody pays out from.** Burkina
 *     Faso and Egypt — see `NO_PAYOUT_RAIL`. These are not in the kind
 *     table, so `bank` and `card` used to fall through to the `stripe_connect`
 *     default and fail at `assertRailOnRoute` two systems away.
 *
 * The caller turns `null` into `unsupported_payout_method` with a sentence
 * naming the method, which is a host being told something true and actionable
 * rather than a rail error from two systems away.
 */
export function payoutProviderFor(
  method: PayoutMethod,
  countryCode: string,
): PayoutRail | null {
  const code = countryCode.toUpperCase();
  // Checked before the kind lookup: absence from the kind table means "not a
  // Flutterwave payout corridor", which for most of the world correctly means
  // Stripe. For these two it means nothing reaches them at all, and the
  // default below would be a rail that cannot pay them.
  if (NO_PAYOUT_RAIL.has(code)) return null;

  const kind = FLUTTERWAVE_PAYOUT_KIND[code];
  if (method === 'momo') return kind === 'momo' ? 'flutterwave_momo' : null;
  if (method === 'bank') return kind ? 'flutterwave_bank' : 'stripe_connect';
  if (method === 'card') return kind ? null : 'stripe_connect';
  return null;
}

/**
 * The same question as `payoutProviderFor`, asked of PayHold's live route
 * instead of the table — the second opinion that makes a refusal safe.
 *
 * `payoutProviderFor` is synchronous so that the registration path can fail
 * closed without a network round trip, and that is the right shape: a host must
 * never be handed a destination no rail can pay. The cost is that its `null` is
 * unfalsifiable. When the table is stale, a host who could be paid perfectly
 * well is refused, nothing distinguishes that from a correct refusal, and it
 * stays that way until a person notices. That has now happened twice, in both
 * directions:
 *
 *   • **BF missing from the table** — Burkinabè hosts refused for months.
 *   • **BF stale in the table** — after PayHold blocked it, AutoHire went on
 *     handing out `flutterwave_momo` for a corridor with no destination.
 *
 * So `payhold-register-seller` calls this before it turns a `null` into
 * `unsupported_payout_method`, and only on that path: the accept path never
 * pays for it, and a refusal is rare. A disagreement means the table is stale,
 * which is a thing to log and correct — not a reason to refuse a host whom
 * PayHold has just said it can pay.
 *
 * Returns `null` when the live route agrees there is no way through, which is
 * also what a blocked corridor and every disabled wallet rail answer. The
 * caller refuses exactly as before in that case.
 */
export function payoutRailFromRoute(
  method: PayoutMethod,
  route: PayoutCountryRoute,
): PayoutRail | null {
  const payout = route.payout;
  // A corridor PayHold has closed reaches nobody, whatever the method.
  if (!payout || payout.blocked) return null;

  // PayHold answering directly beats anything derived from `kind`. A rescue may
  // only ever hand back a rail this list contains — it is built from the
  // routing table itself, so a rail that is not in it is one `assertRailOnRoute`
  // would refuse.
  if (payout.methods) {
    if (method === 'momo') return payout.methods.includes('momo') ? 'flutterwave_momo' : null;
    if (method === 'bank') {
      if (payout.methods.includes('bank')) return 'flutterwave_bank';
      return payout.methods.includes('connect') ? 'stripe_connect' : null;
    }
    if (method === 'card') return payout.methods.includes('connect') ? 'stripe_connect' : null;

    // A wallet is a rail exactly when PayHold names it here, and never
    // otherwise. This branch used to `return null` under the comment "the five
    // §29.3 wallets are never in `methods` — no rail carries them", which was
    // true when it was written and false about an hour later: PayPal's route
    // was enabled and a US host was offered PayPal by the screen and refused
    // by this function. The list is the gate now, so switching another wallet
    // on at PayHold needs one entry here and in `PayoutRail`, not a hunt for
    // whatever else assumed all five were dead.
    if (method === 'paypal') return payout.methods.includes('paypal') ? 'paypal' : null;
    return null;
  }

  if (payout.provider === 'flutterwave') {
    // Only what the route positively names, never an inference from it.
    //
    // `kind` is a single value and cannot say "wallet yes, bank no", which is
    // a real shape: Flutterwave gates bank transfers into Kenya ("submit a
    // request") and Tanzania (Tanzanian-registered businesses only), so both
    // left `flutterwave_bank`'s corridor list on 2026-09-09 while staying
    // reachable by wallet. Malawi is the same shape.
    //
    // So `bank` is rescued only on an explicit `bank` route. Reading a `momo`
    // route as "bank works too" would hand back `flutterwave_bank` for a
    // corridor PayHold's own routing table has closed, and `assertRailOnRoute`
    // would refuse it — turning a clean local refusal into a failure two
    // systems away. Being strict costs nothing real: where bank genuinely
    // works, `payoutProviderFor` already answered `flutterwave_bank` and this
    // rescue path was never reached.
    if (method === 'momo') return payout.kind === 'momo' ? 'flutterwave_momo' : null;
    if (method === 'bank') return payout.kind === 'bank' ? 'flutterwave_bank' : null;
    return null;
  }

  if (payout.provider === 'stripe' && payout.kind === 'connect') {
    // Connect sends to a bank account or a debit card.
    return method === 'bank' || method === 'card' ? 'stripe_connect' : null;
  }

  // No provider on the route row is §29.3's declared-and-disabled shape, and
  // the five wallet methods have no live adapter on any provider — so they are
  // refused here for the same reason `payoutProviderFor` refuses them, rather
  // than being rescued by a live route that cannot carry them either.
  return null;
}
