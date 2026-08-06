# AutoHire external API

The API your external system calls to read AutoHire's data: **users, hosts,
companies, disputes, bookings and listings**.

This is the inbound direction — your server calls us. The outbound direction (us
calling your payment system) is [payments-external.md](./payments-external.md).

Implementation: [`supabase/functions/external-api/index.ts`](../supabase/functions/external-api/index.ts).

## Auth

```
X-API-Key: <EXTERNAL_API_KEY>
```

The key reads **every account's data** — it is a service credential, not a user
login. Keep it server-side, never in a browser or mobile app, and rotate it like
any other secret. A missing or wrong key gets `401`, compared in constant time.

```bash
supabase secrets set EXTERNAL_API_KEY="$(openssl rand -hex 32)"
supabase functions deploy external-api --no-verify-jwt
```

`--no-verify-jwt` because the caller is your server, not a signed-in user. The
API key is the only thing standing in front of this data — there is no second
factor.

## Base URL

```
https://<project-ref>.functions.supabase.co/external-api
```

## Shape

List:

```json
{
  "data": [ { "id": "...", "fullName": "..." } ],
  "page": { "limit": 50, "offset": 0, "total": 123 }
}
```

Single: `{ "data": { … } }`  Error: `{ "error": { "code": "not_found", "message": "…" } }`

Fields are camelCase, matching the app's own types in `@autohire/shared`.

Every list route takes `?limit=` (default 50, max 200) and `?offset=`.

## Routes

| Method | Path | Filters |
|---|---|---|
| GET | `/health` | — |
| GET | `/users` | `role` `country` `verification` `ownerType` `q` |
| GET | `/users/:id` | |
| GET | `/hosts` | `country` `ownerType` `verification` `q` |
| GET | `/hosts/:id` | |
| GET | `/companies` | `country` `verification` `q` |
| GET | `/companies/:id` | |
| GET | `/disputes` | `status` `bookingId` `raisedBy` `against` |
| GET | `/disputes/:id` | |
| PATCH | `/disputes/:id` | body: `{ "status": "resolved_renter" }` |
| GET | `/bookings` | `state` `hostId` `renterId` `listingId` |
| GET | `/bookings/:id` | |
| GET | `/listings` | `country` `status` `hostId` `city` `q` |
| GET | `/listings/:id` | |

`q` is a case-insensitive substring search (names/email, or title/make/model for
listings).

**users / hosts / companies are the same table** viewed three ways:

- `users` — every account,
- `hosts` — `role = 'owner'` (individual hosts *and* companies),
- `companies` — `owner_type = 'business'`.

A company is always host-only: companies and hosts can view cars but never book
them, so they never appear as `renterId` on a booking.

## Examples

```bash
curl -H "X-API-Key: $KEY" \
  "$BASE/disputes?status=open&limit=20"

curl -H "X-API-Key: $KEY" \
  "$BASE/companies?country=RW"

curl -X PATCH -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"status":"resolved_renter"}' \
  "$BASE/disputes/dsp-123"
```

Dispute statuses: `open`, `under_review`, `resolved_renter`, `resolved_host`,
`dismissed`.

## What this API will not give you

**Writes.** Read-only except a dispute's status. Creating bookings, changing
amounts or moving trip states stays inside AutoHire, where DB triggers enforce
the money and state-machine rules — an API that bypassed them could produce a
paid booking that no payment backs.

**Credentials.** Two columns are deliberately never served:

- `profiles.payout_beneficiary` — the payout provider's token,
- `profiles.payment_ref` — the payment provider's vault token.

Your system issued both, so it can map by profile id. Re-serving them would only
widen what a leaked API key exposes. Raw card numbers and raw payout
destinations don't exist in the database at all — only masked forms
(`••••4242`).

`bookings.paymentIntentId` **is** served — it's the hold reference your system
issued, and reconciliation needs it. It identifies a payment; it doesn't
authorise one.

**Anything not on the allowlist.** Each resource names its columns explicitly;
`select('*')` is never used. A column added to the database later is invisible
here until someone deliberately adds it — so a future token or document column
can't leak by accident.

## Adding a resource

One entry in `RESOURCES` in the function: table, column allowlist, optional
scope, filters, search columns, sort. Follow the exclusion rule above when
choosing columns.

## Not done

- **No rate limiting.** The function will answer as fast as it's asked. If the
  key ever goes near an untrusted network, put a limit in front of it.
- **No webhooks outbound.** Your system polls; AutoHire does not push changes.
  If you need push, the notification triggers in migrations 015/016 are the
  natural place to hang it.
- **No `updated_at` on most tables**, so incremental sync is by `created_at`
  ordering plus pagination, not a true change feed.
- **Untested against a live database.** Auth, routing, method and validation
  paths were exercised locally; the query paths were not run against real data.
