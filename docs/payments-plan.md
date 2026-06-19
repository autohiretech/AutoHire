# Payments plan (Stripe + Mobile Money) — Stage C

Status: **Stripe card payment BUILT (needs your keys + deploy); MoMo branded UI built (needs a PSP).**
Checkout lives in [web/src/pages/BookingPage.tsx](../web/src/pages/BookingPage.tsx): a method picker
(Card / MTN MoMo) with brand marks. Card uses Stripe Elements + the
[create-payment-intent](../supabase/functions/create-payment-intent/index.ts) Edge Function. MoMo
shows a branded form but needs a provider to actually charge.

## Demo mode (default — no keys needed)
With **no** `VITE_STRIPE_PUBLISHABLE_KEY` (client) and **no** `STRIPE_SECRET_KEY` (function),
checkout runs in demo mode: the card/MoMo forms show a "Demo mode — no real charge" notice and a
working **Pay** button. Clicking it calls `confirm-booking`, which (with no Stripe secret) confirms
the booking instantly — but the server still computes the price from the listing and the triggers
still enforce availability + the status lock, so the demo behaves like the real thing minus the
charge. The only setup is deploying the function once (no secrets):
`supabase functions deploy confirm-booking`.

## To turn Stripe on (real charges)
1. `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_…` in `web/.env`.
2. Apply [migration 005](../supabase/migration-005-paid-bookings-and-status-lock.sql) (payment
   columns + the booking-creation lock).
3. Set the function secret: `supabase secrets set STRIPE_SECRET_KEY=sk_test_…` (and optional
   `RWF_PER_USD`), then deploy **both** functions:
   `supabase functions deploy create-payment-intent --no-verify-jwt` and
   `supabase functions deploy confirm-booking`.
4. Test with card `4242 4242 4242 4242`. (Foreigners are charged in **USD**, converted from RWF.)

## How a paid booking is created (the security boundary)
The browser can no longer insert a booking — migration 005 removes the client insert policy, so the
**only** creation path is the server:
1. `create-payment-intent` recomputes the amount from the listing (never the client), checks the
   renter isn't a business account / the host, and that the dates are actually free, then opens the
   Stripe PaymentIntent.
2. The card is confirmed in the browser with Stripe Elements.
3. `confirm-booking` **re-fetches the PaymentIntent from Stripe**, requires `status === 'succeeded'`
   and metadata matching the caller/listing/dates, recomputes the amounts, and writes the booking
   with `payment_status = 'paid'` via the service role. It's idempotent on the PaymentIntent id.
4. DB triggers (migration 005) then hold regardless of who writes: amounts/dates/days are immutable,
   availability (blocked dates + double-booking) is enforced, and booking status follows a strict
   per-role state machine — neither party can change status after the car is booked.

> A `stripe-webhook` function (mark paid from `payment_intent.succeeded`) is still worth adding for
> reconciliation if the browser drops the `confirm-booking` call after paying — but a paid booking
> can no longer be forged, and an unpaid one can no longer be created.

## Goals
- **Foreign tourists pay by card** → Stripe (international Visa/Mastercard/Amex).
- **Local renters pay by mobile money** → MTN MoMo / Airtel Money (and bank transfer).
- **Hosts get paid out** in RWF via MoMo / Airtel / bank.
- The platform **owns the split** (takes the service fee, pays the host the rest).

## Why not Stripe Connect end-to-end
Stripe can **collect** from foreign cards but **cannot pay out** to Rwandan
mobile-money/bank recipients. So we use **split rails**: Stripe (or a local PSP)
for collection, and a separate local rail for host payouts. Our backend owns the
ledger and the split — this is already the model in
[ROADMAP.md](../ROADMAP.md) (Stage C).

## Architecture (split rails)
```
Renter ──▶ Checkout (BookingPage)
                │
                ├─ card?  ─▶ Stripe PaymentIntent (Edge Function) ─▶ Stripe ─┐
                │                                                             │
                └─ MoMo/Airtel? ─▶ PSP collection API (Edge Function) ───────┤
                                                                             ▼
                                                          Webhook ─▶ mark booking PAID
                                                                             │
                                                                             ▼
                                              Payout job ─▶ MoMo/Airtel/bank to host
                                                          (amount − service fee)
```
Card secrets and PSP keys live **server-side only** — in Supabase Edge Functions
(same pattern as `delete-account`) or a small `packages/api` (Hono). Never in the
browser.

## What we'll build
1. **`create-payment-intent` Edge Function** — takes a booking id, computes the
   amount from the listing (server-side, not trusting the client), creates a
   Stripe PaymentIntent, returns the client secret.
2. **Stripe Elements card form** on BookingPage (replaces the mock card inputs),
   using `@stripe/stripe-js` + `@stripe/react-stripe-js` and the client secret.
3. **`stripe-webhook` Edge Function** — verifies the Stripe signature and, on
   `payment_intent.succeeded`, marks the booking paid and records the payment.
4. **Mobile-money collection** — integrate a PSP that supports MoMo/Airtel
   (e.g. Flutterwave/Paystack/IremboPay) behind the same checkout, via its own
   Edge Function + webhook.
5. **Payouts** — a job that pays the host (subtotal) via their saved payout
   channel after trip completion; the `payouts` table already exists.

## Data-model additions
- A **`payments`** table: `id, booking_id, provider (stripe|momo|airtel|bank),
  provider_ref, amount_rwf, currency, status, created_at`.
- **`bookings.payment_status`** (`unpaid | paid | refunded`) so the UI reflects
  real payment state instead of jumping straight to `confirmed`.
- **Payout details on the host profile** (channel + account/MSISDN + account
  name) — needed before any payout can run. (Not yet collected at signup.)

## What you need to provide when we build
- A **Stripe account** + **test API keys** (publishable + secret) and a webhook
  signing secret.
- A choice of **mobile-money PSP** and its keys.
- Decide the **presentment currency** (charge foreigners in USD/EUR and settle,
  or charge in RWF) — affects FX and Stripe config.

## Notes
- Keep amounts authoritative on the server (recompute from the listing) to
  prevent client tampering.
- Test mode first: Stripe test cards + PSP sandbox before any live keys.
