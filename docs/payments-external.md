# Connecting the external payment system

AutoHire's payment rail is pluggable. This document is the contract for the
**external hold system** — the provider that owns escrow and settles through
Stripe on its own side. AutoHire never touches Stripe on this rail.

Everything provider-specific lives in one file:
[`supabase/functions/_shared/external-payments.ts`](../supabase/functions/_shared/external-payments.ts).
Connecting the API means editing that file and setting secrets. Nothing in the
app, the database, or the booking lifecycle needs to change.

## The model

Money is **held, not taken**, when a booking is made, and captured when the trip
starts. That is the same escrow shape the direct-Stripe rail uses today, so
trips, cancellations and payouts behave identically.

```
renter confirms      -> createHold        (authorise; money held)
  |
  |  webhook / confirm-booking re-reads the hold
  v
booking row exists   (hold_status='held', provider='external')
  |
pickup               -> captureHold       (money actually moves)
cancel before pickup -> voidHold          (nothing charged)
cancel after capture -> refundHold
trip completes       -> createPayout      (host is paid)
```

## What AutoHire calls

Six calls, all in `_shared/external-payments.ts`. Defaults are guesses at a
conventional REST shape — override the paths with env vars, or edit the file.

| Call | Default path | When |
|---|---|---|
| `createHold` | `POST /v1/holds` | Renter confirms checkout |
| `getHold` | `GET /v1/holds/{reference}` | Before creating any booking row |
| `captureHold` | `POST /v1/holds/{reference}/capture` | Trip starts (pickup) |
| `voidHold` | `POST /v1/holds/{reference}/void` | Cancelled before capture |
| `refundHold` | `POST /v1/holds/{reference}/refund` | Cancelled after capture |
| `createPayout` | `POST /v1/payouts` | Trip completes, host is paid |

`createHold` sends:

```json
{
  "amount": 45000,
  "currency": "RWF",
  "capture_method": "manual",
  "description": "AutoHire — Toyota RAV4 (3 days)",
  "metadata": {
    "uid": "<renter profile id>",
    "listingId": "...",
    "startDate": "2026-08-10",
    "endDate": "2026-08-13",
    "totalRwf": "45000",
    "priceCurrency": "RWF"
  },
  "return_url": "https://…/cars/<id>/book?ext=1"
}
```

**`metadata` must come back on `getHold`.** It is how a hold is bound to a
booking: `confirm-booking` and the webhook read `uid`, `listingId`, `startDate`
and `endDate` from the hold itself, never from the browser. Without it a payment
cannot be turned into a trip.

## What we need back

Any of these spellings is understood for the response (see `normaliseHold`);
add yours if it differs:

- **reference** — `reference` | `id` | `hold_id` | `payment_id`
- **status** — `status` | `state`, mapped to:
  - held → `authorised` | `authorized` | `requires_capture` | `held`
  - taken → `captured` | `succeeded` | `completed` | `paid`
  - released → `voided` | `cancelled` | `released`
  - also `refunded`, `failed` | `declined`
- **amount** — `amount` | `amount_minor` | `value`
- **currency** — `currency` | `currency_code`
- **metadata** — `metadata` | `meta`

`createHold` may additionally return **one** of:

- `client_secret` — a Stripe PaymentIntent secret. The browser confirms the card
  with Stripe.js and the hold lands in `requires_capture`. This is the expected
  shape given the system settles through Stripe.
- `redirect_url` (or `checkout_url` / `payment_link`) — a hosted page. The renter
  is redirected and comes back to `?ext=1`; the webhook creates the booking.
- neither — the hold is already authorised and checkout finishes immediately.

## Webhook

`POST` to the `external-webhook` function, deployed with `--no-verify-jwt`
(the caller is their server, not a signed-in user).

- Signature: HMAC-SHA256 over the **raw body**, hex, in `x-signature`
  (`x-webhook-signature` and `verif-hash` are also read). A `sha256=` prefix is
  tolerated. Change the digest or header in `verifyWebhookSignature` if theirs
  differs — but do not remove the check: it is the only thing stopping anyone
  from POSTing themselves a free booking.
- The payload is **not trusted**. We take the reference from it, re-read the
  hold with `getHold`, and build the booking from that.
- Delivery is idempotent on the hold reference — a retry returns the existing
  booking rather than creating a second one.

## Amounts

Sent as **minor units** (cents) except for zero-decimal currencies (RWF, UGX,
JPY, KRW, VND, XAF, XOF), which are sent as-is. If their API expects major
units, drop the `× 100` in `external-create-hold/index.ts` (marked CONTRACT 5).

A booking is always denominated in the **car's** currency — the one the host set.
The renter's market never re-denominates it.

## Secrets

```bash
supabase secrets set \
  EXTERNAL_PAYMENTS_BASE_URL=https://api.example.com \
  EXTERNAL_PAYMENTS_API_KEY=... \
  EXTERNAL_PAYMENTS_WEBHOOK_SECRET=...
# optional
#  EXTERNAL_PAYMENTS_AUTH_SCHEME=Bearer
#  EXTERNAL_PAYMENTS_PATH_CREATE_HOLD=/payments/holds   (etc.)
```

Web app: `VITE_PAYMENTS_EXTERNAL=true` switches checkout to this rail.

## Deploy

```bash
supabase functions deploy external-create-hold
supabase functions deploy external-webhook --no-verify-jwt
supabase functions deploy confirm-booking   # external branch
supabase functions deploy capture-payment   # external capture
```

Apply `migration-045-external-payment-provider.sql` so `provider = 'external'`
is accepted on bookings, payouts and profiles.

## What is NOT done

The adapter is written against a conventional REST shape and has **never been
run against a real endpoint**. Before trusting it in production:

1. confirm the six paths and methods,
2. confirm the request field names in `createHold` (CONTRACT 2),
3. confirm the response field names (CONTRACT 3) — add any that `normaliseHold`
   doesn't already accept,
4. confirm the webhook signature scheme (CONTRACT 4),
5. confirm minor vs major units (CONTRACT 5),
6. decide whether payouts go through this system too, or stay on the existing
   Flutterwave/Stripe transfer functions. `createPayout` exists but nothing
   calls it yet — payout release still runs through migration 040's trigger.

Until `EXTERNAL_PAYMENTS_BASE_URL` and `EXTERNAL_PAYMENTS_API_KEY` are set,
`externalPaymentsConfigured()` is false and every path falls back to the
existing Stripe / Flutterwave / demo behaviour. Nothing breaks by merging this.
