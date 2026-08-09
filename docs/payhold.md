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

if something goes wrong instead
  │
  ├─ POST /disputes ─────────────► case opened, PAYOUT FROZEN   (payhold-dispute)
  │  ◄──── webhook dispute.opened ─ mirrored back either way
  │        resolved by a person in PayHold's dashboard, not by us
  │
  └─ POST /deals/:id/refund ─────► money goes back               (payhold-refund)
     ◄──── webhook refund.succeeded
           full → the trip is cancelled; partial → it carries on
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
| [`payhold-seller`](../supabase/functions/payhold-seller/index.ts) | The host's seller record: id, KYC, capabilities, destinations. |
| [`payhold-dispute`](../supabase/functions/payhold-dispute/index.ts) | Raise a case in PayHold — this is what freezes the payout. |
| [`payhold-refund`](../supabase/functions/payhold-refund/index.ts) | Send the renter's money back, in full or in part. |
| [`EarningsPage`](../web/src/pages/EarningsPage.tsx) | `/earnings` — totals, trip-by-trip stages, fee breakdown, withdraw. |
| [migration 047](../supabase/migration-047-payhold.sql) | `payhold_deal_id`, `payhold_seller_id`, `payhold_dispute_id`. |
| [migration 048](../supabase/migration-048-payhold-disputes-and-refunds.sql) | `partially_refunded`; unique index on `payhold_dispute_id`. |

## Every endpoint, both directions

**Outbound — AutoHire calls PayHold.** All of it goes through
[`_shared/payhold.ts`](../supabase/functions/_shared/payhold.ts) against
`PAYHOLD_BASE_URL` with `X-Api-Key`. There is no second door.

| PayHold endpoint | Client fn | AutoHire function that calls it |
|---|---|---|
| `POST /deals` | `createDeal` | `payhold-create-deal` |
| `GET /deals/:id` | `getDeal` | `payhold-webhook` (the trust boundary), `payhold-earnings` (one per trip) |
| `POST /deals/:id/confirm` | `confirmDeal` | `payhold-confirm` |
| `POST /deals/:id/refund` | `refundDeal` | `payhold-refund` |
| `POST /sellers` | `createSeller` | `payhold-register-seller` |
| `GET /sellers/:id/capabilities` | `sellerCapabilities` | `payhold-seller`, `payhold-register-seller`, `payhold-balance` |
| `GET /sellers/:id/balance` | `sellerBalance` | `payhold-balance` |
| `GET /sellers/:id/destinations` | `sellerDestinations` | `payhold-seller`, `payhold-earnings` |
| `POST /sellers/:id/withdraw` | `withdraw` | `payhold-balance` |
| `GET /payouts` | `listPayouts` | `payhold-earnings` — tenant-wide, filtered to the seller locally |
| `POST /disputes` | `openDispute` | `payhold-dispute` |

PayHold refuses `resolve` from an API key: deciding a case is a person's
judgement made in their dashboard. Resolutions come back by webhook.

**AutoHire's own routes** — what the app and its hosts call:

| Route | Method | Who | Does |
|---|---|---|---|
| `payhold-create-deal` | POST | renter | Opens the deal, returns the hosted checkout link |
| `payhold-confirm` | POST | renter or host | Confirms this side of a finished trip |
| `payhold-register-seller` | POST | host | Registers their payout destination — the only place the raw number exists |
| `payhold-seller` | GET | host (admin: `?hostId=`) | Their seller record, capabilities and destinations |
| `payhold-seller/capabilities` | GET | host | Just the can-I-be-paid answer |
| `payhold-seller/destinations` | GET | host | Just where the money can go |
| `payhold-balance` | GET | host | Wallet totals, read live |
| `payhold-balance` | POST | host | Withdraw — an expedite, not the route |
| `payhold-earnings` | GET | host | Every trip's money and the stage it's at |
| `payhold-dispute` | GET | either party (admin: all) | The cases they are party to |
| `payhold-dispute` | POST | renter or host | Raises a case — **freezes the payout** |
| `payhold-refund` | POST | host (own bookings) or admin | Refunds the renter, full or partial |
| `payhold-webhook` | POST | PayHold's server | Signed events → bookings, refunds, disputes |

Every one of these takes the side, the seller id and the party from the
**session**, never from the request body. The one exception is `?hostId=` on
`payhold-seller`, which is refused for anyone who is not an admin — a host who
could name another host's id would read where a competitor gets paid.

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

**The link runs both ways.** `POST /v1/sellers` now carries
`external_user_id` — the host's `profiles.id` — so a seller can be found from
our side even when `profiles.payhold_seller_id` is missing. PayHold makes it
unique per tenant and **refuses** a second registration under the same handle
rather than returning the existing seller, which turns a double-submit into an
error instead of a duplicate seller with money owed to the one it orphaned.

`payhold-register-seller` asks `findSellerByExternalUserId` before it tokenizes
anything, and re-links a seller it finds instead of creating another. That is
the only repair available, and it repairs a *lost link*, never a missing seller:
tokenization needs the raw number, which exists only while the host is typing
it. A host who never registered has to be asked again — the ReconnectPayouts
banner — and no bulk import can ever exist, on either side.

A re-link deliberately does **not** save the destination just typed. The
response carries `relinked: true` and the screen says so, because changing where
a host is paid is a new `seller_destinations` row with its own verification and
security hold (PayHold §5.1), and that flow is not built.

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

## Connecting the two systems

Everything below is one-time. Do it in this order — later steps fail without
earlier ones.

**Where this stands (9 Aug 2026): steps 1–8 are done. Step 9 has not started.**
The three `PAYHOLD_*` secrets are set on `gsnoggfofbmzamxxyazc`, the functions
are deployed, and the live site (<https://autohiretech.pages.dev>, Cloudflare
Pages) is built with `VITE_PAYMENTS_PAYHOLD=true` — its bundle calls
`payhold-register-seller` and no longer calls `setPayoutMethod`.
`web/.env` now matches, so local builds are on the same rail.

**`render.yaml` is not the live deploy.** It describes a Render static site;
the site actually serving traffic is Cloudflare Pages, where the `VITE_*`
values are set in the Pages project's build environment. Change the flag there.

**PayHold's Sellers list being empty is step 9, not a fault.** A seller row is
only ever created when a host opens `/payouts/setup` and types their raw
number — see below for why nothing can create one on their behalf. Check
`payhold-register-seller`'s function logs to tell "no host has tried" from
"hosts are hitting an error".

Still undeployed: `payhold-seller`, `payhold-dispute`, `payhold-refund` (all
404). They are unreleased work, not part of this flow.

### 0. Know the two addresses

| | |
|---|---|
| PayHold API (AutoHire calls this) | `https://mwnbjjlilqrwdmwutbxr.supabase.co/functions/v1` |
| AutoHire webhook (PayHold calls this) | `https://gsnoggfofbmzamxxyazc.supabase.co/functions/v1/payhold-webhook` |
| PayHold hosted checkout (renters land here) | `https://payhold.pages.dev` |

### 1. On PayHold: set `PUBLIC_URL` — do this first

```bash
# in the payhold-backend project
supabase secrets set PUBLIC_URL=https://payhold.pages.dev
```

**Without it every payment link is dead.** `deals/index.ts` falls back to
`https://app.payhold.local`, so AutoHire would hand renters a link to a domain
that does not exist and checkout would fail with no error anywhere.

### 2. On PayHold: mint an API key

Dashboard → **Rails → API Keys → New key**. Label it `autohire`.

It must be the dashboard, not curl: `api-keys/index.ts` refuses an API key and
requires an `owner` or `staff` session, so that a leaked key cannot mint its own
replacement.

**The plaintext appears once.** Only its SHA-256 is stored and `key_hash` is
revoked at the column level, so nobody — including PayHold staff — can read it
back. Lose it and you mint a new one.

### 3. On PayHold: register AutoHire's webhook

Dashboard → **Webhooks → Add endpoint**:

```
https://gsnoggfofbmzamxxyazc.supabase.co/functions/v1/payhold-webhook
```

Must be `https` — `webhook-endpoints/index.ts` refuses anything else, because
these payloads carry deal amounts and a signature proves who sent a thing, not
that nobody read it.

Subscribe it to: `order.funded_held`, `order.clearing_started`,
`order.released`, `payout.paid`, `refund.succeeded`, `dispute.opened`.

**The signing secret also appears once.** Copy it now — it becomes
`PAYHOLD_WEBHOOK_SECRET` in the next step. Unlike the API key it is encrypted
rather than hashed (dispatch has to recover it to sign), but no endpoint returns
it. Losing it means registering a new endpoint.

### 4. On PayHold: connect a payment rail

Dashboard → **Rails → Providers**. Flutterwave test keys are already in.

Live credentials are **refused** until the launch checklist is signed off —
that gate is in `provider-accounts/index.ts` and is deliberate. Test mode first;
a live secret connected as "test" would move real money during a sandbox run.

### 5. On AutoHire: apply the migrations

042 through 048, in order. 047 adds the three join columns; without it every
PayHold write fails on a missing column — the same class of error as the
`country` one. 048 adds the `partially_refunded` payment status and the unique
index the dispute mirror is idempotent on.

### 6. On AutoHire: set the secrets and deploy

```bash
supabase secrets set \
  PAYHOLD_BASE_URL=https://mwnbjjlilqrwdmwutbxr.supabase.co/functions/v1 \
  PAYHOLD_API_KEY=<from step 2> \
  PAYHOLD_WEBHOOK_SECRET=<from step 3>

supabase functions deploy payhold-create-deal
supabase functions deploy payhold-register-seller
supabase functions deploy payhold-seller
supabase functions deploy payhold-balance
supabase functions deploy payhold-earnings
supabase functions deploy payhold-confirm
supabase functions deploy payhold-dispute
supabase functions deploy payhold-refund
supabase functions deploy payhold-webhook --no-verify-jwt
```

`--no-verify-jwt` on the webhook only. Its caller is PayHold's server, not a
signed-in user, so the signature is the authentication.

### 7. On AutoHire: prove the corridor with curl — before the app depends on it

This step comes before the flag, and that ordering is the whole point.

The API key works on its own. It does not care about `VITE_PAYMENTS_PAYHOLD`,
which only decides what the *browser* does — so the one way to find out whether
PayHold will accept a seller and open a deal is to ask it directly, while the
app is still safely on the old rails.

```bash
PAYHOLD=https://mwnbjjlilqrwdmwutbxr.supabase.co/functions/v1
KEY=<the plaintext from step 2>

# 1. the API key works and the corridor is open
curl -s -X POST "$PAYHOLD/sellers" -H "X-Api-Key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"name":"ZZ Test host","country":"RW","payout_provider":"flutterwave_momo","destination":"250788000000"}'

# 2. a deal opens and returns a live payment link
curl -s -X POST "$PAYHOLD/deals" -H "X-Api-Key: $KEY" \
  -H 'content-type: application/json' \
  -d '{"buyer_ref":"test","seller_id":"<from 1>","description":"Test","amount":45000,"currency":"RWF"}'
```

Then open PayHold's dashboard → **Sellers**. The seller the first command
created should be listed. If it is not, stop here — nothing the app does later
will work, and every step below only makes that harder to see.

Open the `payment_link` the second command returned as well. A link pointing at
`app.payhold.local` means step 1 of this runbook was skipped and `PUBLIC_URL` is
still unset.

**Name the test seller something you will recognise** — `ZZ Test host` sorts to
the bottom. PayHold has no delete-seller endpoint, so this row is permanent, in
the same tenant, next to your real hosts, forever.

### 8. On AutoHire: flip the rail

```
VITE_PAYMENTS_PAYHOLD=true
```

in the web env, then rebuild and redeploy the web app. Until this is set,
checkout stays on the old rails, `/earnings` says "not switched on yet" rather
than erroring, and — the part that is easy to miss — `payhold-register-seller`
is never called, so **no host can become a seller and PayHold's Sellers list
stays empty no matter how long you wait.**

Everything hangs off this one variable: the reconnect banner, the payout-setup
form's registration call, the booking page's checkout, and the earnings link.
Deployed functions and set secrets are not enough on their own.

**This is the moment every unregistered host's cars become unbookable.** That is
`payhold-create-deal` refusing to take a renter's money for a trip that cannot
be settled — correct behaviour, and it will still look like an outage if nobody
was warned. Flip it at a quiet hour, and tell hosts the day before.

### 9. Every host re-registers as a seller

**This cannot be automated, and it is not a coding problem.**

`POST /v1/sellers` needs the RAW MoMo or bank number so it can tokenize it.
AutoHire only ever stored a mask (`••••4242`) — so there is nothing to migrate.
A bulk script would tokenize masks. PayHold pulling hosts out of AutoHire's
`external-api` would fetch the same masks. The raw number exists only in the
moment a host types it, which is why `payhold-register-seller` is the only door.

Hosts are prompted on their dashboard: `ReconnectPayouts` shows a banner to any
host with no `payhold_seller_id` once `VITE_PAYMENTS_PAYHOLD` is on. It is
separate from `SetupChecklist` on purpose — that hides itself once every step is
done, so a host who onboarded months ago, exactly the host this affects, would
never have seen it.

Until a host has a `payhold_seller_id`, `payhold-create-deal` refuses to open a
deal for their cars: better an unbookable listing than a renter's money taken
for a trip that cannot be settled.

This is why step 7 exists and why it is a curl. An earlier version of this
runbook said to flip the flag only *after* a host had reconnected — which no
host could do, because the banner and the registration call are both behind that
same flag. There is no order of steps 8 and 9 that avoids a window where
unregistered hosts are unbookable. Shorten the window; you cannot remove it.

Watch it close: every host who reconnects appears in PayHold's dashboard →
**Sellers**, and in AutoHire as a non-null `profiles.payhold_seller_id`.

### 10. Prove it end to end in the app

Book a car whose host has reconnected, pay on the hosted page, and confirm a
booking appears with `payhold_deal_id` set. If it does not, the webhook is the
first place to look — PayHold's dashboard shows every delivery attempt and its
response.

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
  for a trip that cannot be settled. `ReconnectPayouts` now prompts them on the
  dashboard (see step 9), but their cars stay unbookable until they act.
- **Confirmations are not wired to the trip UI.** `payhold-confirm` exists and
  is correct; no button calls it yet. Until one does, releases depend on
  PayHold's `auto_complete_after_hours` timer.
- **Disputes go both ways now, but no button raises one.** `payhold-dispute`
  pushes a case to PayHold — which is what freezes the payout — and the webhook
  mirrors PayHold's back. Neither the trip screen nor `/admin` calls it yet, so
  the only way to raise one today is the API. Resolution is still one-way by
  design: PayHold refuses `resolve` from an API key.
- **Refunds have an endpoint, not a screen.** `payhold-refund` is wired for
  hosts (own bookings) and admins, full or partial. Nothing in the UI calls it,
  so a refund is still a curl or a dashboard action.
- **`payment-options` is not read.** The renter sees whatever PayHold's hosted
  page offers rather than a preview in AutoHire.
- **Earnings shows the 20 most recent trips.** `payhold-earnings` accepts an
  `offset` and reports `hasMore`, but the page has no "load more" button, so
  older trips are reachable only through the API. Each trip is a
  `GET /deals/:id`, which is why the page is capped rather than unbounded.
- **No CSV or statement export**, so a host reconciling against their own bank
  has to read the screen.
