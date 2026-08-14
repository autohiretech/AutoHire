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
  ├─ POST /v1/deals ─────────────► deal + checkout session  (payhold-create-deal)
  │                                    │
  │                    renter pays in AutoHire's own modal
  │                    (POST /checkout/public/:token/pay,
  │                     then /validate if a code is asked for)
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
| [`payhold-ensure-seller`](../supabase/functions/payhold-ensure-seller/index.ts) | Host role → PayHold seller, no destination. Undeployed — see step 6. |
| [`payhold-balance`](../supabase/functions/payhold-balance/index.ts) | GET wallet totals, POST withdraw (optionally to a chosen destination). |
| [`payhold-earnings`](../supabase/functions/payhold-earnings/index.ts) | Per-trip money, its stage, and the host's payout destinations. |
| [`payhold-confirm`](../supabase/functions/payhold-confirm/index.ts) | One side confirms a finished trip. |
| [`payhold-seller`](../supabase/functions/payhold-seller/index.ts) | The host's seller record: id, KYC, capabilities, destinations. |
| [`payhold-payment-options`](../supabase/functions/payhold-payment-options/index.ts) | Which countries PayHold can collect in and pay out to. Drives the payout screen. |
| [`payhold-dispute`](../supabase/functions/payhold-dispute/index.ts) | Raise a case in PayHold — this is what freezes the payout. |
| [`payhold-refund`](../supabase/functions/payhold-refund/index.ts) | Send the renter's money back, in full or in part. |
| [`EarningsPage`](../web/src/pages/EarningsPage.tsx) | `/earnings` — totals, trip-by-trip stages, fee breakdown, withdraw. |
| [`seed-host-payout-methods.mjs`](../scripts/seed-host-payout-methods.mjs) | Gives the demo hosts a varied payout method and a real PayHold seller (step 9). |
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
| `POST /sellers` | `createSeller` | `payhold-register-seller` — the first destination; `payhold-ensure-seller` — no destination, at role change |
| `POST /sellers/:id/destinations` | `addSellerDestination` | `payhold-register-seller` — every later one |
| `GET /sellers/:id/capabilities` | `sellerCapabilities` | `payhold-seller`, `payhold-register-seller`, `payhold-balance` |
| `GET /sellers/:id/balance` | `sellerBalance` | `payhold-balance` |
| `GET /sellers/:id/destinations` | `sellerDestinations` | `payhold-seller`, `payhold-earnings` |
| `GET /payment-options` | `paymentOptions` | `payhold-payment-options` — tenant-wide, cached |
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
| `payhold-register-seller` | POST | host | Saves their payout destination, first or changed — the only place the raw number exists |
| `payhold-ensure-seller` | POST | host | Registers them as a seller with no destination, right after they toggle to host mode. Idempotent |
| `payhold-seller` | GET | host (admin: `?hostId=`) | Their seller record, capabilities and destinations |
| `payhold-seller/capabilities` | GET | host | Just the can-I-be-paid answer |
| `payhold-seller/destinations` | GET | host | Just where the money can go |
| `payhold-payment-options` | GET | any signed-in user | Which countries can collect / be paid out |
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
banner — and no bulk import of *real* hosts can ever exist, on either side. The
demo hosts are the one exception, and only because their numbers are invented
rather than remembered — see step 9.

A re-link deliberately does **not** save the destination just typed. The
response carries `relinked: true` and the screen says so: the link is being
repaired, and the destination on file is the one PayHold holds a token for.
Saving again goes down the change path below, which does use what was typed.

**Changing where a host is paid** is a different operation and now exists.
`payhold-register-seller` branches on `profiles.payhold_seller_id`: absent, it
registers a seller; present, it calls `POST /v1/sellers/:id/destinations`, which
adds a `seller_destinations` row, makes it primary and demotes the old one —
atomically, because a window with no primary destination is a window in which
the host is unpayable for a reason nobody chose.

The new destination lands unverified and inside PayHold §5.1's security hold, so
**payouts pause for up to 24 hours** while it is checked. There is no parameter
to skip that, and there should not be: "get in, move the destination, withdraw"
is the whole shape of an account takeover, and the hold is what puts a person
between the second step and the third. The response carries `changed: true` and
`securityHoldUntil`, and the payout screen says plainly what will happen before
the host saves.

Bookings are unaffected — `payhold-create-deal` gates on `payhold_seller_id`,
which does not move — so a host changing their bank account does not take their
cars off the market. Their `payout_status` goes back to `pending` until PayHold
says otherwise, which is what the screen's Verifying badge reads.

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

**Where this stands (9 Aug 2026): steps 1–8 are done. Step 9 has begun — three
sellers exist** (one real host, plus the two Rwandan demo hosts seeded by
`scripts/seed-host-payout-methods.mjs`). The first real calls to PayHold's API
have now been made, and they found three things — see **What the first live run
found**, below. The rest of this paragraph still holds:
The three `PAYHOLD_*` secrets are set on `gsnoggfofbmzamxxyazc`, the functions
are deployed, and the live site (<https://autohiretech.pages.dev>, Cloudflare
Pages) is built with `VITE_PAYMENTS_PAYHOLD=true` — its bundle calls
`payhold-register-seller` and no longer calls `setPayoutMethod`.
`web/.env` now matches, so local builds are on the same rail.

**`render.yaml` is not the live deploy.** It describes a Render static site;
the site actually serving traffic is Cloudflare Pages, where the `VITE_*`
values are set in the Pages project's build environment. Change the flag there.

**PayHold's Sellers list being empty is step 9, not a fault.** Until
`payhold-ensure-seller` is deployed, a seller row is only ever created when a
host opens `/payouts/setup` and types their raw number. Check
`payhold-register-seller`'s function logs to tell "no host has tried" from
"hosts are hitting an error".

**`payhold-ensure-seller` (14 Aug 2026, undeployed) changes what "nothing can
create one on their behalf" meant.** That sentence was true against the
PayHold that existed when this doc was written: `POST /v1/sellers` required a
country, a rail and a raw destination in the same request, so a seller record
could not exist without one. PayHold's `20260814000001` made the destination
optional — a seller can be `{ name, external_user_id }` and nothing else, and
money accrues against them from their first deal exactly as it does for any
other seller; only the *payout* waits, on the same eligibility gate an
unverified destination already produces. `payhold-ensure-seller` is wired into
`toggleRole()` in `AccountPage.tsx` and registers a destination-less seller the
moment someone becomes a host — before they have typed anything. It does not
replace `payhold-register-seller`, which is still the only place a raw number
is ever typed and tokenized; it just means that function usually finds a
seller already on file by the time a host reaches it, and goes straight to
adding a destination rather than creating one from nothing.
Once deployed, PayHold's Sellers list fills in as soon as hosts toggle role,
not once they finish payout setup — check `payhold-ensure-seller`'s logs
rather than `payhold-register-seller`'s to tell the two states apart.

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
supabase functions deploy payhold-ensure-seller
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

#### The demo hosts are the exception

The `demo-host-*` profiles seeded by migrations 024/026/027 have no login, so
nobody can ever type a destination for them — and without a seller their cars
are unbookable, which takes most of the catalogue out of a demo.

They are the one case a script can do the work, and only because the paragraph
above does not apply to them: there is no real number being remembered, so
nothing is lost by inventing one.

```bash
SUPABASE_URL=https://gsnoggfofbmzamxxyazc.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=… \
PAYHOLD_BASE_URL=https://mwnbjjlilqrwdmwutbxr.supabase.co/functions/v1 \
PAYHOLD_API_KEY=… \
node scripts/seed-host-payout-methods.mjs --dry-run
```

Drop `--dry-run` to write. It gives each demo host a method their market
actually offers (`payoutMethodsFor` — MoMo only in Flutterwave markets, card
only outside them), rotating so no two hosts in a market match: Rwanda gets
MoMo + bank, Dubai/Shanghai/Bay Area get bank + card, across all three rails.
Card numbers rotate through the Stripe test PANs so the masks differ too.

It is not a migration, because `POST /v1/sellers` is a network call to another
system that mints permanent records and SQL cannot make one. A migration that
filled the payout columns alone would leave `payhold_seller_id` null and the
cars still unbookable — the columns are not what PayHold checks.

Three guards, because **PayHold has no delete-seller endpoint** and everything
this creates is permanent in the tenant: it only touches ids matching
`--prefix` (default `demo-host-`), skips any host that already has a seller,
and otherwise asks by `external_user_id` first so a seller PayHold already has
is re-linked rather than duplicated. Re-running converges instead of
accumulating sellers.

**Real hosts are never seeded.** A fabricated destination on a real profile
would show them "Active · Card ••••4242" for an account that cannot receive
money — the reconnect banner exists precisely so they enter their own.

### 10. Deploy PayHold's checkout function — the in-page flow needs it

The in-modal flow is **half PayHold's**. AutoHire's bundle can be perfect and
still fall through to the hosted page until this ships:

```bash
# in the payhold-backend project
supabase functions deploy checkout
```

That one deploy carries all of it: the wildcard CORS on
`/checkout/public/*` (without which AutoHire's browser cannot read the method
list at all), the `next_action` field on `/pay`, and the new
`/checkout/public/:token/validate` route the OTP box posts to.

Check it landed without a deal, from anywhere:

```bash
curl -si -X OPTIONS \
  https://mwnbjjlilqrwdmwutbxr.supabase.co/functions/v1/checkout/public/x \
  -H 'origin: https://autohire.pages.dev' | grep -i access-control-allow-origin
```

`access-control-allow-origin: *` means it is live. **No header at all means the
old build is still deployed**, and every renter will be sent to PayHold's page
exactly as before — which is the failure mode to recognise, because AutoHire
degrades quietly rather than erroring.

### 11. Prove it end to end in the app

Book a car whose host has reconnected and pay **without leaving the modal**.
What to watch, in order:

1. The method list is PayHold's, not ours — if you see our own picker, the
   session fetch failed and step 10 is the reason.
2. Choosing mobile money asks for a number *here*, and paying shows "Check your
   phone" or a code box. **Landing on `payhold.pages.dev` at any point is the
   bug this flow exists to remove.**
3. The modal turns itself to "Your money is held safely" — that is the poll
   seeing `deal.status` move, driven by the webhook.
4. A booking appears with `payhold_deal_id` set. If step 3 happened and this did
   not, the webhook is the place to look — PayHold's dashboard shows every
   delivery attempt and its response.

## Checkout in the page

**The renter is asked how they want to pay exactly once, in AutoHire's own
modal, and PayHold's hosted page is never opened.**

That sentence was false until now, and no amount of styling could have fixed
it. PayHold's hosted page carries its own method picker, so handing a renter
over *after* they had already chosen here asked them the same question twice —
second time in someone else's brand, on a domain that is not ours. Framing that
page would only have moved the duplicate inside a border.

What changed is on PayHold's side. `POST /checkout/public/:token/pay` used to
return one field, `payment_link`, which can only ever mean "send them away". It
now also returns a **`next_action`** — the same information with its shape kept:

| `next_action.type` | Means | What the modal does |
|---|---|---|
| `wait` | The rail took the charge; the renter approves on their handset | "Check your phone", and polls |
| `otp` | The rail sent a code and wants it back | Shows the code box, posts to `/validate` |
| `element` | The provider collects the details itself | Read as `redirect` — see below |
| `redirect` | The provider's own page finishes it | Frames it in the modal, then falls back to the tab |

None of the four leaves the page while Flutterwave is the rail. `redirect` only
moves a renter when the frame is *refused*, and the rail that refuses is
Stripe: **Stripe Checkout will not be framed**, so a frame that loaded perfectly
goes blank at the moment the renter is sent to pay. Removing that fallback would
break the main path on a live rail.

**`element` is answered but not honoured, deliberately.** PayHold offers a card
two ways — its inline script, and the hosted link — and they are two doors onto
one charge sharing a `tx_ref`. Only the link can be put *inside* something.
Flutterwave's script (`checkout.flutterwave.com/v3.js`) was built, deployed and
removed within the day: it takes the entire viewport with a dialog of its own
that carries its own method sidebar, so a renter who had already chosen Card in
our modal was shown Card and Mobile Money again, full-screen, on top of the
booking. `payment_options: 'card'` did not suppress it. That is the same
duplicate this whole flow exists to remove, wearing a different costume. The
element is now read as what it *proves* — the rail is Flutterwave, and
Flutterwave frames — and the link goes in the modal.

### What each method actually costs

- **Mobile money finishes here in full.** The number is typed in the modal and
  the charge is direct — `POST /charges?type=mobile_money_rwanda` rather than
  the hosted `/payments` — so there is no provider page in it anywhere. If the
  network asks for a code, that box appears in the same modal.
- **Card on the Stripe rail is Stripe's Payment Element, mounted in our modal.**
  Each input is its own iframe served from Stripe, so the number never enters
  AutoHire's DOM and we stay **SAQ A** there. This is the rail every renter
  outside Africa lands on: `currenciesFor()` quotes them in USD or EUR and the
  Stripe card rail is the only one serving those currencies.
- **Card on the Flutterwave rail is our own form — and that is PCI SAQ D.**
  See the section below; it is a deliberate, recorded decision.
- **The framed Flutterwave page** remains for anything else. The fields live
  in Flutterwave's origin, so **the card number never enters AutoHire's DOM**
  and we stay PCI **SAQ A**. This is why they are not `<input>` elements of
  ours: owning those fields alone moves AutoHire to SAQ D, and PayHold §6
  forbids raw cards on their infrastructure, so their server could not relay
  them either. Flutterwave sends no `X-Frame-Options` and no `frame-ancestors`,
  which is what makes framing it possible at all — verify with
  `curl -sI https://checkout.flutterwave.com/v3/hosted/pay` before assuming it
  still holds.
- **The card element and the hosted link are one charge.** Both carry
  `tx_ref = deal_id`, our webhook matches on that reference, and Flutterwave
  refuses a second success against a `tx_ref` that already has one. At most one
  of them can ever complete, which is what makes offering both safe.

### Two bugs this replaced

Worth recording, because both were silent:

1. **The session call was blocked by CORS.** PayHold's `corsHeaders` allowed
   `DASHBOARD_ORIGIN` only, so AutoHire's `fetch` of `/checkout/public/:token`
   failed in the browser, `methods` stayed null, our own picker showed, and
   "Continue" navigated to the hosted page. That is the duplicate picker, and
   its cause was a header rather than a design decision. The public buyer routes
   now answer any origin — they read no cookie and no API key, so the session
   token in the path is the whole credential and CORS was protecting nothing the
   token was not already protecting better.
2. **The poll watched the wrong `status`.** `status` at the top of the public
   checkout response is the *session's* (`open` / `completed`), not the deal's.
   The modal compared it against deal states like `funded_held`, so it could
   never match and the renter would have waited out a payment that had already
   landed. It reads `deal.status` now.

A third, structural one: `bySession` accepted only `open` sessions, but `/pay`
completes the session — so every request *after* the charge started, including
the polling and the OTP, would have been told the payment link had already been
used. Reads and `/validate` now accept `completed`; starting a charge still
requires `open`, which is what stops one session being charged twice.

### Nothing here can fund a deal

`/pay` and `/validate` both stop at `payment_pending`. A validated OTP means the
rail accepted the renter's authorisation, not that money moved — the hold is
still written by `payhold-webhook` on the signed `order.funded_held`, after
PayHold has re-fetched the transaction from the provider (§15 phase 2). Polling
only decides what the renter is shown.

### `VITE_PAYHOLD_EMBED` and `frame-ancestors` are moot

Both existed to make PayHold's hosted page survive inside our frame. Nothing
frames that page now, so its `frame-ancestors` allowlist — the one place
AutoHire had something no other tenant did — no longer gates this flow. The
`redirect` branch frames the *provider*, not PayHold, and it is sandboxed
without `allow-top-navigation` so a payment page cannot move the booking out
from under the renter.

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

## What the first live run found

Seeding the demo hosts (step 9) made AutoHire's first real calls to PayHold.
Two of eight hosts registered; six were refused, and the refusals are AutoHire
bugs rather than seeding accidents. **Each of these breaks a real host at
`/payouts/setup` exactly as it broke the demo one.**

**1. `stripe_connect` does not take a number — it takes an `acct_…`.**

> A Stripe payout destination is a connected account id (acct_…). Raw bank
> details are given to Stripe during Connect onboarding, never to PayHold.

`payoutProviderFor` routes **card anywhere**, and **bank outside the twelve
African countries**, to `stripe_connect`. Both then send the raw number the host
typed, and PayHold refuses it with a 422.

This is not specific to `stripe_connect`. `paypal`, `venmo` and `cash_app_pay`
were each tried against a live UAE and US seller and returned the **identical**
error — PayHold settles all of them through Stripe, so every rail it exposes
outside the Flutterwave corridors wants an `acct_…`. There is no rail anywhere
in `PayoutProvider` that accepts a raw number or address outside Africa.

Nor can the id be invented. A syntactically valid `acct_…` was tried and Stripe
itself refused it through PayHold:

> Stripe: The provided key 'sk_test_…' does not have access to account
> 'acct_163vm7kxurp6t3nkf' (or that account does not exist).

PayHold passes the id straight to Stripe, so the account has to genuinely exist
under PayHold's platform. (That message also confirms PayHold's Stripe is in
**test** mode, which is the expected state per step 4.)

So today **no host outside the Flutterwave corridors can register a payout
method at all**, by any route — not a raw number, not a wallet address, not a
placeholder account. The screen offers them bank and card, PayHold accepts
neither, and there is nothing to fall back to. Fixing it means building Stripe
Connect onboarding — AutoHire sends the host to Stripe, Stripe returns an
`acct_…`, and *that* is what `destination` carries — which exists on neither
side. Until it does, `payoutMethodsFor` offering `bank` or `card` outside Africa
is offering a dead end, and those hosts' cars are unbookable.

**2. China cannot be paid at all.**

> PayHold cannot send money to China yet. Neither provider is licensed for that
> corridor. Buyers there can still pay — collection works everywhere — but a
> seller needs an account somewhere we can reach.

Collection works; payout does not. `alipay` and `wechat_pay` — the two rails
that exist precisely for that market — return the same refusal, so this is a
**corridor** limit and not a rail one: there is nothing to pick instead. Every
CN listing is therefore unbookable under PayHold no matter what AutoHire builds,
because the limit is licensing on PayHold's side. The 150 demo cars in Shanghai
are catalogue only until that changes.

**3. `GET /sellers?external_user_id=` is not filtered server-side.**

The deployed PayHold ignores the parameter and returns the tenant's whole list —
a handle matching nothing still comes back with every seller. `docs` above says
PayHold "filters this server-side"; it does not, yet.

`findSellerByExternalUserId` already checks the handle on our side rather than
trusting row zero, so nothing links to the wrong seller — that guard was written
for exactly this and it earned itself. But the **repair it provides is dead**: a
host whose `payhold_seller_id` was lost cannot be re-linked, because the lookup
cannot find their seller. Re-registering them would create a duplicate and
orphan the first, which is unrecoverable — there is no delete endpoint. Treat a
lost link as a support case until PayHold deploys the filter.

## Which payout methods a host is offered

`payoutMethodsFor` used to answer this from `FLUTTERWAVE_COUNTRIES` — eight
country codes in a constant — and it was wrong in both directions. It offered
Bank and Card to every host outside those eight, all of which route to
`stripe_connect` and get refused; and it withheld payouts from the ~60 countries
beyond those eight that PayHold does reach.

The list is now PayHold's. `payhold-payment-options` proxies its
`payment-options` table (198 countries: `can_collect`, `can_payout`,
`restricted`, `closed_reason`), and `payoutAvailability` in `payments.ts` turns
one country into one of four states:

| State | When | What the host sees |
|---|---|---|
| `ok` | Payable **and** a Flutterwave corridor | Mobile Money / Bank, as before |
| `unsupported` | Payable, but only via Stripe Connect | "needs a step we haven't finished building" |
| `unavailable` | `can_payout: false` — China and ~122 others | "we can't send payouts there yet"; renters can still book |
| `restricted` | Sanctioned — BY, RU, IR, SY, KP, CU | "money cannot move in either direction" |

Only `ok` shows the method chooser. The other three explain themselves and say
plainly that listings cannot take bookings until it is resolved — which was
already true, and previously happened silently after a 422.

**`unsupported` and `unavailable` are deliberately different.** The first is
work on AutoHire's side that a host can do nothing about; the second is a
corridor PayHold may open later. Collapsing them would tell a host in Dubai to
wait for something that is not coming, and a host in Shanghai to try something
that cannot work.

If the lookup fails or has not loaded, `payoutAvailability` falls back to the
old constant rather than blocking. Being wrong the way it was before beats a
screen a payable host cannot use.

## Not done

- **Live API: barely exercised.** Six `POST /sellers` calls, two of which
  succeeded, plus reads. Deals, webhooks, confirmations, payouts, disputes and
  refunds have still never run against a real endpoint. Expect each first run to
  find something, the way seller registration did.
- **Hosts registered before PayHold must re-enter their payout destination.**
  AutoHire only ever stored a mask, and tokenizing `••••4242` would produce a
  destination that cannot receive money. `payhold-create-deal` refuses to open a
  deal for a host with no `payhold_seller_id` rather than take a renter's money
  for a trip that cannot be settled. `ReconnectPayouts` now prompts them on the
  dashboard (see step 9), but their cars stay unbookable until they act.
- **Instant-book confirmations are auto-wired; the trip-UI button is not.**
  `payhold-confirm` still has no UI button, but `payhold-webhook` now
  auto-confirms **both** sides for `booking_mode = 'instant'` the moment
  PayHold reports `order.funded_held` — so an instant-book hold releases with
  neither party acting, then clears on PayHold's window. Rentals still depend
  on the trip-return confirm (button TBD) or the auto-release timer.
- **Disputes go both ways now, but no button raises one.** `payhold-dispute`
  pushes a case to PayHold — which is what freezes the payout — and the webhook
  mirrors PayHold's back. Neither the trip screen nor `/admin` calls it yet, so
  the only way to raise one today is the API. Resolution is still one-way by
  design: PayHold refuses `resolve` from an API key.
- **Refunds have an endpoint, not a screen.** `payhold-refund` is wired for
  hosts (own bookings) and admins, full or partial. Nothing in the UI calls it,
  so a refund is still a curl or a dashboard action.
- **`payment-options` is read for payouts, not for collection.** The payout
  screen now asks it which countries can be paid (see below); the renter still
  sees whatever PayHold's hosted page offers rather than a preview in AutoHire.
- **Earnings shows the 20 most recent trips.** `payhold-earnings` accepts an
  `offset` and reports `hasMore`, but the page has no "load more" button, so
  older trips are reachable only through the API. Each trip is a
  `GET /deals/:id`, which is why the page is capped rather than unbounded.
- **No CSV or statement export**, so a host reconciling against their own bank
  has to read the screen.


## The card decision, on the record

**AutoHire collects raw card fields on the Flutterwave rail. That puts AutoHire
in PCI DSS scope at SAQ D**, not SAQ A: roughly 300 controls, quarterly ASV
scans and an annual attestation, and it is an ongoing obligation rather than a
one-off. It was taken deliberately, after the alternatives were put and
declined twice, because Flutterwave offers nothing in between: a hosted page,
or a full-viewport script carrying its own method picker, and no field-level
embed of the kind Stripe and PayPal both have.

Where the exposure actually is, so it can be reviewed:

| | |
|---|---|
| In AutoHire's DOM | the card, in React state in `CheckoutModal`, for the life of one payment |
| Sent to | `payhold-create-deal`'s checkout session → `POST /checkout/public/:token/pay` |
| Stored by AutoHire | nothing — no column, no storage, no logging; cleared on Done |
| Stored by PayHold | nothing — encrypted in the request and forwarded |
| On the wire to the rail | 3DES-ECB under the tenant's encryption key, as `client` |

**Why the card is held in memory at all.** Flutterwave answers a card with a
demand for a PIN or a billing address, and the answer is the *whole payload
again* plus that extra factor. Something has to hold it between the two calls.
The browser does, because the alternative is PayHold caching cards server-side,
which is worse in every way.

### PayHold's §6 exception is per tenant and defaults to off

`Settings.raw_card_relay` is `false` for every tenant, and `startCharge` refuses
a card payload from anyone who has not switched it on. So PayHold's "never
handles card numbers" stays structurally true for every other tenant; AutoHire's
decision is AutoHire's alone. Turning it on for a tenant is the moment that
tenant takes SAQ D, and it should not be done without them saying so in writing.

### What would remove the obligation

Flutterwave shipping a hosted-fields product, or routing AutoHire's African card
volume through a rail that has one. Neither is in our gift today. If Flutterwave
does ship one, deleting our card inputs and dropping back to SAQ A is a small
change — the `payment_element` action already exists and Stripe already uses it.
