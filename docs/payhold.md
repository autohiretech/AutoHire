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
  └─ host withdraws ─► POST /v1/sellers/:id/withdraw        (payhold-balance)
           │
           └── webhook payout.paid → money is in their account
```

## What was built

| Piece | What it does |
|---|---|
| [`_shared/payhold.ts`](../supabase/functions/_shared/payhold.ts) | The client. Every PayHold call and the webhook verifier. |
| [`payhold-create-deal`](../supabase/functions/payhold-create-deal/index.ts) | Checkout → deal → hosted payment link. |
| [`payhold-webhook`](../supabase/functions/payhold-webhook/index.ts) | Signed events → bookings, refunds, disputes. |
| [`payhold-register-seller`](../supabase/functions/payhold-register-seller/index.ts) | Host's payout destination → PayHold seller. |
| [`payhold-balance`](../supabase/functions/payhold-balance/index.ts) | GET wallet, POST withdraw. |
| [`payhold-confirm`](../supabase/functions/payhold-confirm/index.ts) | One side confirms a finished trip. |
| [`EarningsPage`](../web/src/pages/EarningsPage.tsx) | `/earnings` — held, clearing, available, withdraw. |
| [migration 047](../supabase/migration-047-payhold.sql) | `payhold_deal_id`, `payhold_seller_id`, `payhold_dispute_id`. |

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
