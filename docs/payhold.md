# PayHold integration

PayHold is the escrow and payout platform AutoHire runs its money through.
AutoHire is **tenant #1**.

The division is total: **PayHold owns the money**, AutoHire owns the cars, the
trips and the people. AutoHire never calls Stripe or Flutterwave again — PayHold
orchestrates the providers, holds the funds, runs the clearance clock, and pays
hosts out.

Repo: <https://github.com/autohiretech/payhold>

## The flow

```
renter picks dates
  │
  ├─ POST /v1/deals ─────────────► deal + payment_link      (payhold-create-deal)
  │                                    │
  │                          renter pays on PayHold's page
  │                                    │
  │  ◄──── webhook order.funded_held ──┘                    (payhold-webhook)
  │        AutoHire creates the booking. Money is HELD.
  │
trip runs
  │
  ├─ renter confirms return ─► POST /deals/:id/confirm side=buyer
  ├─ host confirms return   ─► POST /deals/:id/confirm side=seller   (payhold-confirm)
  │        both sides in → PayHold releases the hold, atomically
  │
  │  ◄──── webhook order.clearing_started
  │        money is the host's, inside the clearance window
  │
  │  ◄──── webhook order.released
  │        cleared and withdrawable
  │
  └─ PayHold's payout-dispatch cron sends it automatically once the
     clearance window ends. "Send it now" (POST /v1/sellers/:id/withdraw,
     via payhold-balance) only brings that forward, or retries a stuck one.
           │
           └── webhook payout.paid → money is in their account
```

## Getting paid: automatic, with a nudge

**A host does not have to do anything to be paid.** `release_deal` queues a
payout with `scheduled_for` at the end of the clearance window, and PayHold's
`payout-dispatch` cron sends it. Withdrawal is an *expedite*, not the route.

What "Send it now" actually does, from `request_withdrawal`:

- Claims payouts in `scheduled`, `blocked`, `needs_verification`, `failed` or
  `frozen` whose deal is `released` or `payout_pending`, stamps them requested
  and re-arms `next_attempt_at`. So it doubles as **retry a failed payout**.
- **Cannot pull money out of the clearance window.** A deal still in `clearing`
  is not claimable — there is no early access, by design.
- **All-or-nothing.** It takes everything cleared; there is no partial amount.
- Raises rather than returning zero when nothing has cleared. `payhold-balance`
  translates that into a calm message — the raw string is a Postgres error
  carrying the seller's uuid.

## What was built

| Piece | What it does |
|---|---|
| [`_shared/payhold.ts`](../supabase/functions/_shared/payhold.ts) | The client. Every PayHold call and the webhook verifier. |
| [`payhold-create-deal`](../supabase/functions/payhold-create-deal/index.ts) | Checkout → deal → hosted payment link. |
| [`payhold-webhook`](../supabase/functions/payhold-webhook/index.ts) | Signed events → bookings, refunds, disputes. |
| [`payhold-register-seller`](../supabase/functions/payhold-register-seller/index.ts) | Host's payout destination → PayHold seller. |
| [`payhold-balance`](../supabase/functions/payhold-balance/index.ts) | GET wallet totals, POST withdraw (optionally to a chosen destination). |
| [`payhold-earnings`](../supabase/functions/payhold-earnings/index.ts) | Per-trip money, its stage, and the host's payout destinations. |
| [`payhold-confirm`](../supabase/functions/payhold-confirm/index.ts) | One side confirms a finished trip. |
| [`EarningsPage`](../web/src/pages/EarningsPage.tsx) | `/earnings` — totals, trip-by-trip stages, fee breakdown, withdraw. |
| [migration 047](../supabase/migration-047-payhold.sql) | `payhold_deal_id`, `payhold_seller_id`, `payhold_dispute_id`. |

## The stages a host's money passes through

`/earnings` shows every trip and where its money is. The stage comes from the
deal's status, overridden by the payout's when one exists — a stopped payout
outranks everything, because the money is the host's and something is in the way.

| Stage | Means | PayHold source |
|---|---|---|
| Awaiting payment | The renter hasn't finished paying | `created`, `checkout_started`, `payment_pending` |
| On trip | Held while the car is out | `funded_held`, `in_progress`, `revision_requested` |
| Needs confirming | Trip over, waiting on a confirmation | `confirmed_buyer`, `confirmed_seller` |
| In dispute | Resolution Center; payout frozen | `disputed` |
| Clearing | Theirs, inside the window — shows the date | `clearing` |
| Ready to send | Cleared; goes out automatically | `released`, `payout_pending` |
| Sending | On its way | payout `processing` |
| Paid | In their account | `paid_out`, payout `paid` |
| On hold | Stopped, with the reason | payout `failed`/`frozen`/`blocked`/`needs_verification`/`held_for_review` |
| Refunded | Went back to the renter | `refunded`, `partially_refunded` |
| Cancelled | No money moved | `payment_failed`, `expired`, `canceled` |

`disputed` is deliberately **not** "needs confirming": a disputed deal cannot be
resolved by confirming, and pointing a host at that button would waste their
time. Every one of PayHold's 18 deal statuses and 8 payout statuses is mapped;
an unrecognised one falls back to "On trip" rather than disappearing.

Each row also opens a breakdown — renter paid, AutoHire fee, payment fee,
refunds, and what the host earns — from PayHold's `deal_amounts`. That gap is
the most-queried number on the page, so it is one tap away rather than a support
question.

## What AutoHire stores

Three join columns and nothing else:

| Column | Holds |
|---|---|
| `bookings.payhold_deal_id` | The deal that paid for this trip. **Unique** — this is the webhook's idempotency key. |
| `profiles.payhold_seller_id` | The host's PayHold seller record. |
| `disputes.payhold_dispute_id` | The Resolution Center case. |

**No balance columns.** The ledger is PayHold's and is read live from
`GET /v1/sellers/:id/balance`. A mirrored copy would drift the first time a
webhook was missed, and a host who sees money that is not there makes plans
against it.

**No raw destinations.** A host's MoMo number or bank account passes through
`payhold-register-seller` once, on its way to be tokenized, and is written down
by nobody. AutoHire keeps the seller id and a mask (`••••4242`); PayHold keeps
the token.

## Auth

Outbound, AutoHire → PayHold:

```
X-Api-Key: <PAYHOLD_API_KEY>
```

Not a bearer token — `Authorization` on PayHold means a dashboard session, and
sending the key there gets a 401.

Inbound, PayHold → AutoHire: **the signature is the authentication.**

```
PayHold-Signature: t=<unix>,v1=<hmac-sha256>
```

HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``, hex. The timestamp is inside
the signed material, so it cannot be edited to widen the replay window. Verified
in `verifyWebhookSignature`, with a 3-hour age bound — generous because
PayHold's last retry lands two hours out, and rejecting a legitimate final retry
loses the event for good.

## Secrets

```bash
supabase secrets set \
  PAYHOLD_BASE_URL=https://mwnbjjlilqrwdmwutbxr.supabase.co/functions/v1 \
  PAYHOLD_API_KEY=<dashboard → Rails → API Keys> \
  PAYHOLD_WEBHOOK_SECRET=<the secret PayHold minted for our endpoint>
```

Web app: `VITE_PAYMENTS_PAYHOLD=true` switches checkout onto this rail.

Until `PAYHOLD_BASE_URL` and `PAYHOLD_API_KEY` are set, `payholdConfigured()` is
false and every function returns 503 without touching anything. Nothing breaks
by merging this.

## Deploy

```bash
supabase functions deploy payhold-create-deal
supabase functions deploy payhold-register-seller
supabase functions deploy payhold-balance
supabase functions deploy payhold-confirm
supabase functions deploy payhold-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook only: the caller is PayHold's server, not a
signed-in user.

Then register the endpoint in the PayHold dashboard:

```
https://<autohire-ref>.functions.supabase.co/payhold-webhook
```

Subscribe it to: `order.funded_held`, `order.clearing_started`,
`order.released`, `payout.paid`, `refund.succeeded`, `dispute.opened`.

Apply [migration 047](../supabase/migration-047-payhold.sql).

## Amounts

PayHold takes **integer minor units** plus an ISO currency code, always —
floating point never touches money on either side. RWF, UGX, XAF, XOF, JPY, KRW
and VND are zero-decimal and go as-is; everything else is ×100.

The conversion lives in exactly two places: `toMinorUnits` in the adapter and
`money()` in `EarningsPage`. Getting it wrong shows a host 100× their balance.

A trip is always denominated in the **car's** currency. PayHold converts to
something the renter's country can actually be charged and carries the FX
itself.

## The retiring functions

These existed because AutoHire was orchestrating providers by hand. PayHold does
that now:

| Old | Replaced by |
|---|---|
| `create-payment-intent` | `POST /v1/deals` |
| `capture-payment` | `POST /deals/:id/confirm` (both sides → release) |
| `flutterwave-collect` | PayHold's hosted checkout |
| `flutterwave-transfer` | `POST /v1/sellers/:id/withdraw` |
| `flutterwave-beneficiary` | `POST /v1/sellers` |

**They are still deployed and still work.** `VITE_PAYMENTS_PAYHOLD` picks the
rail at checkout, so both paths exist while the switch is being tested. Delete
them once PayHold has carried real bookings — not before, because a booking made
on the old rail still needs the old capture path to finish.

## Not done

- **Never run against PayHold's live API.** The shapes here were read from
  PayHold's own source rather than guessed, and the webhook signature is
  verified interoperable against its actual signer — but no call has been made
  to a real endpoint. Expect the first end-to-end run to find something.
- **Hosts registered before PayHold must re-enter their payout destination.**
  AutoHire only ever stored a mask, and tokenizing `••••4242` would produce a
  destination that cannot receive money. `payhold-create-deal` refuses to open a
  deal for a host with no `payhold_seller_id` rather than take a renter's money
  for a trip that cannot be settled — but nothing yet *prompts* those hosts to
  reconnect. Their cars are unbookable until they do.
- **Confirmations are not wired to the trip UI.** `payhold-confirm` exists and
  is correct; no button calls it yet. Until one does, releases depend on
  PayHold's `auto_complete_after_hours` timer.
- **Disputes are one-way.** A dispute opened in PayHold is mirrored into
  AutoHire by webhook. One opened in AutoHire is *not* pushed to PayHold, so it
  does not freeze the payout. `openDispute` in the adapter is ready; nothing
  calls it.
- **`payment-options` is not read.** The renter sees whatever PayHold's hosted
  page offers rather than a preview in AutoHire.
- **Earnings shows the 20 most recent trips.** `payhold-earnings` accepts an
  `offset` and reports `hasMore`, but the page has no "load more" button, so
  older trips are reachable only through the API. Each trip is a
  `GET /deals/:id`, which is why the page is capped rather than unbounded.
- **No CSV or statement export**, so a host reconciling against their own bank
  has to read the screen.
