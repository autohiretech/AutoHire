# supabase/migrations/

CLI-tracked migrations — the ones applied with `supabase db push`, recorded in
`supabase_migrations.schema_migrations` on the remote.

**This is not the full history.** Migrations `001`–`039`, plus `041`, `043` and
`046`, were applied by hand in the SQL editor before the CLI was linked, so the
database has them but the CLI does not know it. They live one level up as
`supabase/migration-0NN-*.sql`.

The files here are copies of those, renamed to the timestamp form `db push`
requires. Every one is idempotent (`add column if not exists`,
`create or replace`, `drop … if exists`), so a re-run is safe.

## Adding the next one

Write it as `supabase/migration-0NN-name.sql` — the repo's convention, and what
the docs reference — then copy it here with a timestamp prefix and push:

```bash
cp supabase/migration-048-thing.sql \
   supabase/migrations/20260810000048_thing.sql
npx supabase db push --linked
```

## What was applied here, and why in this order

| File | Adds |
|---|---|
| `…040_booking_provider_and_payout_release` | `bookings.provider`, `charge_currency`, `hold_status`; `payouts.provider`; auto-payout trigger |
| `…042_hosts_cannot_book` | Trigger refusing bookings by hosts and companies |
| `…044_watchlist_renters_only` | Watchlist insert policy |
| `…045_external_payment_provider` | Widens the provider checks to `'external'` |
| `…047_payhold` | `payhold_deal_id`, `payhold_seller_id`, `payhold_dispute_id`; widens provider checks to `'payhold'` |
| `…048_payhold_disputes_and_refunds` | `partially_refunded` payment status; unique index on `disputes.payhold_dispute_id` |
| `…053_hourly_and_overage_pricing` | Hourly rentals (`listings.hourly_booking_enabled`/`price_per_hour_rwf`/`overage_multiplier`; `bookings.rental_type`/`pickup_time`/`estimated_hours`/`deposit_amount_rwf`) and settlement (`bookings.actual_hours`/`final_amount_rwf`/`amount_owed_rwf`), locked the same way amounts/dates already are |

040 goes first because 045 and 047 both widen check constraints on the columns
it creates — run either before it and they fail on a column that does not exist.
040 had been missed entirely: the live database had 041 and 043 but not 040,
which is the kind of gap a hand-applied history produces and the reason the CLI
now tracks them.
