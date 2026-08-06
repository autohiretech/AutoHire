// AutoHire — adapter for the EXTERNAL payment-hold system.
//
// This is the one file to edit when connecting the provider. Everything else
// (Edge Functions, the app, the DB) talks to the platform-neutral shapes below,
// so a change in their API surface stops here.
//
// The model: the external system owns the escrow HOLD and settles through
// Stripe underneath. AutoHire never touches Stripe on this rail — it asks for a
// hold at booking, captures it at pickup, and voids or refunds it on
// cancellation. That mirrors what `create-payment-intent` + `capture-payment`
// do for the direct-Stripe rail, so the booking lifecycle is unchanged.
//
// Secrets (supabase secrets set …):
//   EXTERNAL_PAYMENTS_BASE_URL        e.g. https://api.example.com
//   EXTERNAL_PAYMENTS_API_KEY         bearer token for server-to-server calls
//   EXTERNAL_PAYMENTS_WEBHOOK_SECRET  HMAC secret used to sign webhooks
//   EXTERNAL_PAYMENTS_AUTH_SCHEME     optional, default 'Bearer'
//   EXTERNAL_PAYMENTS_PATH_*          optional per-endpoint path overrides
//
// WHAT TO CHECK WHEN THE API DOCS ARRIVE (each is marked CONTRACT below):
//   1. the five endpoint paths + methods,
//   2. the request field names in `createHold`,
//   3. the response field names — `normaliseHold` already accepts the common
//      spellings; add theirs if it differs,
//   4. the webhook signature header + digest in `verifyWebhookSignature`,
//   5. whether amounts are minor units (cents) or major units.

export type HoldStatus =
  /** Created, awaiting the renter's action (3-D Secure, redirect, approval). */
  | 'pending'
  /** Money is authorised and held. This is what lets us confirm a booking. */
  | 'authorised'
  /** The hold was taken — the money has actually moved. */
  | 'captured'
  /** Released without charging (cancelled before pickup). */
  | 'voided'
  /** Captured then given back. */
  | 'refunded'
  | 'failed';

export interface Hold {
  /** The external system's id for this hold — stored as bookings.payment_intent_id. */
  reference: string;
  status: HoldStatus;
  /** Minor units (cents), matching what we sent. */
  amount: number;
  currency: string;
  /** Whatever we attached at creation — we use it to bind a hold to a booking. */
  metadata: Record<string, string>;
}

export interface CreateHoldInput {
  amount: number;
  currency: string;
  /** Shown to the renter on the provider's side, if they render anything. */
  description: string;
  /** Bound to the hold so the webhook and confirm step can trust it. */
  metadata: {
    uid: string;
    listingId: string;
    startDate: string;
    endDate: string;
    totalRwf: string;
    priceCurrency: string;
    /** The payer's own country (profiles.country), '' if they haven't set one. */
    payerCountry: string;
  };
  /**
   * The provider's vault token for a payment method this account already saved
   * (profiles.payment_ref). Absent means collect a method as part of this hold.
   */
  paymentMethodRef?: string;
  /** Where to send the renter back to when their flow needs a redirect. */
  returnUrl?: string;
}

export interface CreateHoldResult extends Hold {
  /**
   * How the browser finishes the payment. The external system settles through
   * Stripe, so it will hand back one of:
   *   • clientSecret — a Stripe PaymentIntent secret we confirm with Stripe.js
   *     (the app already does this on the direct rail), or
   *   • redirectUrl  — a hosted page we send the renter to, like Flutterwave.
   * If neither comes back the hold is already authorised and there is nothing
   * for the browser to do.
   */
  clientSecret?: string;
  redirectUrl?: string;
}

export interface CreatePayoutInput {
  amount: number;
  currency: string;
  /** The host being paid. */
  recipient: { profileId: string; method: string; destination: string; name?: string };
  reference: string;
}

export interface PayoutResult {
  reference: string;
  status: 'pending' | 'paid' | 'failed';
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BASE_URL = (Deno.env.get('EXTERNAL_PAYMENTS_BASE_URL') ?? '').replace(/\/+$/, '');
const API_KEY = Deno.env.get('EXTERNAL_PAYMENTS_API_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('EXTERNAL_PAYMENTS_WEBHOOK_SECRET') ?? '';
const AUTH_SCHEME = Deno.env.get('EXTERNAL_PAYMENTS_AUTH_SCHEME') ?? 'Bearer';

/** CONTRACT 1 — endpoint paths. Override per-deployment without a code change. */
const PATHS = {
  createHold: Deno.env.get('EXTERNAL_PAYMENTS_PATH_CREATE_HOLD') ?? '/v1/holds',
  getHold: Deno.env.get('EXTERNAL_PAYMENTS_PATH_GET_HOLD') ?? '/v1/holds/{reference}',
  captureHold: Deno.env.get('EXTERNAL_PAYMENTS_PATH_CAPTURE') ?? '/v1/holds/{reference}/capture',
  voidHold: Deno.env.get('EXTERNAL_PAYMENTS_PATH_VOID') ?? '/v1/holds/{reference}/void',
  refundHold: Deno.env.get('EXTERNAL_PAYMENTS_PATH_REFUND') ?? '/v1/holds/{reference}/refund',
  createPayout: Deno.env.get('EXTERNAL_PAYMENTS_PATH_PAYOUT') ?? '/v1/payouts',
};

/** True once the secrets are set — callers fall back to the demo path if not. */
export function externalPaymentsConfigured(): boolean {
  return !!BASE_URL && !!API_KEY;
}

export function externalWebhookConfigured(): boolean {
  return !!WEBHOOK_SECRET;
}

export class ExternalPaymentError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ExternalPaymentError';
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

async function call<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  if (!externalPaymentsConfigured()) {
    throw new ExternalPaymentError(
      'External payments are not configured (set EXTERNAL_PAYMENTS_BASE_URL and EXTERNAL_PAYMENTS_API_KEY).',
      503,
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Authorization: `${AUTH_SCHEME} ${API_KEY}`,
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
    const message =
      (parsed as { message?: string; error?: string })?.message ??
      (parsed as { error?: string })?.error ??
      `External payment provider returned ${res.status}.`;
    throw new ExternalPaymentError(message, res.status, parsed);
  }
  return parsed as T;
}

const withRef = (path: string, reference: string) =>
  path.replace('{reference}', encodeURIComponent(reference));

// ---------------------------------------------------------------------------
// Response normalisation
// ---------------------------------------------------------------------------

/**
 * CONTRACT 3 — map their payload onto `Hold`. The common spellings are accepted
 * already; when the docs land, add whatever they actually use rather than
 * reshaping the callers.
 */
export function normaliseHold(raw: unknown): Hold {
  const r = (raw ?? {}) as Record<string, unknown>;
  // Some APIs nest the useful part under data/hold/payment.
  const d = ((r.data ?? r.hold ?? r.payment ?? r) as Record<string, unknown>) ?? {};

  const reference = String(d.reference ?? d.id ?? d.hold_id ?? d.holdId ?? d.payment_id ?? '');
  if (!reference) {
    throw new ExternalPaymentError('External provider response had no hold reference.', 502, raw);
  }

  const rawStatus = String(d.status ?? d.state ?? '').toLowerCase();
  const status: HoldStatus =
    rawStatus === 'authorised' || rawStatus === 'authorized' || rawStatus === 'requires_capture' || rawStatus === 'held'
      ? 'authorised'
      : rawStatus === 'captured' || rawStatus === 'succeeded' || rawStatus === 'completed' || rawStatus === 'paid'
        ? 'captured'
        : rawStatus === 'voided' || rawStatus === 'cancelled' || rawStatus === 'canceled' || rawStatus === 'released'
          ? 'voided'
          : rawStatus === 'refunded'
            ? 'refunded'
            : rawStatus === 'failed' || rawStatus === 'declined' || rawStatus === 'error'
              ? 'failed'
              : 'pending';

  return {
    reference,
    status,
    amount: Number(d.amount ?? d.amount_minor ?? d.value ?? 0),
    currency: String(d.currency ?? d.currency_code ?? '').toUpperCase(),
    metadata: (d.metadata ?? d.meta ?? {}) as Record<string, string>,
  };
}

// ---------------------------------------------------------------------------
// The six calls AutoHire needs
// ---------------------------------------------------------------------------

/**
 * Authorise and hold the booking amount. Called before any booking row exists —
 * a failure here means the renter is never charged and no trip is created.
 *
 * CONTRACT 2 — request field names.
 */
export async function createHold(input: CreateHoldInput): Promise<CreateHoldResult> {
  const raw = await call<Record<string, unknown>>(PATHS.createHold, {
    method: 'POST',
    body: {
      amount: input.amount,
      currency: input.currency,
      // Authorise now, take the money at pickup. If their API words this
      // differently (e.g. `type: 'authorization'`), change it here.
      capture_method: 'manual',
      description: input.description,
      metadata: input.metadata,
      payment_method: input.paymentMethodRef,
      return_url: input.returnUrl,
    },
  });

  const d = ((raw.data ?? raw.hold ?? raw) as Record<string, unknown>) ?? {};
  return {
    ...normaliseHold(raw),
    clientSecret: (d.client_secret ?? d.clientSecret ?? d.stripe_client_secret) as string | undefined,
    redirectUrl: (d.redirect_url ?? d.redirectUrl ?? d.checkout_url ?? d.payment_link) as string | undefined,
  };
}

/** Re-read a hold. This is the trust boundary: never believe the browser. */
export async function getHold(reference: string): Promise<Hold> {
  return normaliseHold(await call(withRef(PATHS.getHold, reference), { method: 'GET' }));
}

/** Take the held money — called when the trip starts (pickup). Idempotent. */
export async function captureHold(reference: string, amount?: number): Promise<Hold> {
  return normaliseHold(
    await call(withRef(PATHS.captureHold, reference), {
      method: 'POST',
      body: amount === undefined ? {} : { amount },
    }),
  );
}

/** Release an uncaptured hold — cancelled before the money was taken. */
export async function voidHold(reference: string): Promise<Hold> {
  return normaliseHold(await call(withRef(PATHS.voidHold, reference), { method: 'POST', body: {} }));
}

/** Give back money already captured. Omit `amount` for a full refund. */
export async function refundHold(reference: string, amount?: number): Promise<Hold> {
  return normaliseHold(
    await call(withRef(PATHS.refundHold, reference), {
      method: 'POST',
      body: amount === undefined ? {} : { amount },
    }),
  );
}

/** Pay a host out. Only needed if the external system also handles payouts. */
export async function createPayout(input: CreatePayoutInput): Promise<PayoutResult> {
  const raw = await call<Record<string, unknown>>(PATHS.createPayout, {
    method: 'POST',
    body: {
      amount: input.amount,
      currency: input.currency,
      reference: input.reference,
      recipient: {
        external_id: input.recipient.profileId,
        method: input.recipient.method,
        destination: input.recipient.destination,
        name: input.recipient.name,
      },
    },
  });
  const d = ((raw.data ?? raw.payout ?? raw) as Record<string, unknown>) ?? {};
  const status = String(d.status ?? '').toLowerCase();
  return {
    reference: String(d.reference ?? d.id ?? input.reference),
    status: status === 'paid' || status === 'succeeded' ? 'paid' : status === 'failed' ? 'failed' : 'pending',
  };
}

// ---------------------------------------------------------------------------
// Webhook verification
// ---------------------------------------------------------------------------

/**
 * CONTRACT 4 — verify a webhook is really from them before acting on it. The
 * default is HMAC-SHA256 over the raw body, hex-encoded, compared to the
 * `x-signature` header. Swap the digest or header if theirs differs; do NOT
 * relax it — this is what stops anyone from POSTing themselves a free booking.
 */
export async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!WEBHOOK_SECRET || !signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time compare — a length-leaking early return is enough to attack.
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature.trim().toLowerCase().replace(/^sha256=/, ''));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
