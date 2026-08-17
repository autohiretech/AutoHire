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
| `…054_exclusive_pricing_mode` | Replaces `hourly_booking_enabled` with `listings.pricing_mode` (`daily`/`hourly`, exclusive) and makes `price_per_day_rwf` nullable — a car is priced one way or the other, not both |
| `…055_host_resolves_amount_owed` | Lets the host lower (never raise) `bookings.amount_owed_rwf` — they collected it themselves outside PayHold, or are waiving some or all of it |
| `…056_amount_exceeded` | Adds `bookings.amount_exceeded_rwf` — the fixed original overage, kept once `amount_owed_rwf` becomes host-adjustable and can drift from it |
| `…057_overage_collection_failed` | `bookings.overage_collection_failed`/`_reason` — surfaces PayHold's `order.balance_charge_failed` to the host |
| `…058_social_notification_kinds` | New `notification_kind` values for the social layer (`social_follow`, `circle_invite`, `board_activity`, `trip_companion`, `host_broadcast`). Ships alone: `alter type ... add value` can't be used by the same transaction that adds it |
| `…059_follows` | `follows` (one-way, role-agnostic graph) + a trigger notifying the followee |
| `…060_social_proof` | `social_proof_for_listing()` / `total_completed_trips()` — SECURITY DEFINER functions answering "who I follow rented this car", without exposing `bookings` rows |
| `…061_circles` | `circles` + `circle_members` — named groups, plus `shares_circle()` / `is_circle_member()` / `is_circle_owner()` (all SECURITY DEFINER, to dodge the RLS-self-reference recursion on `circle_members`) |
| `…062_boards` | `boards` + `board_items` — collaborative wishlists beside (not replacing) `watchlist`; `board_items.target_start/target_end` feed the `listing_demand` view |
| `…063_circle_invites` | `circle_invites` (share-link only — token is the credential) + `claim_circle_invite()`. Phone/email invite-matching is deferred: it needs a `profiles.phone` uniqueness backfill first, its own migration, checked against production data |
| `…064_trip_posts` | `trip_posts` + `trip_post_guard()` — a post must be anchored to a paid, completed booking the author was on, enforced by trigger. The only exception is `demo-post-%` ids (migration 065's seed) |
| `…065_seed_demo_social` | Demo riders (`demo-rider-%`), demo trip posts (`demo-post-%`, all `visibility = 'public'`), and follow edges from every demo rider to their market's demo hosts — same convention as `migration-024-seed-demo-cars.sql`, deletable the same way |
| `…066_trip_photos_storage` | Private `trip-photos` storage bucket for post attachments. Path is `<author_id>/<post_id>/<file>`; read policy checks the caller against `trip_posts`' own visibility rule, not just folder ownership |
| `…067_host_broadcasts` | `host_broadcasts` — un-anchored fleet announcements (blueprint Module 6), publicly readable, fanning out `host_broadcast` notifications to followers. Deliberately separate from `trip_posts`: nothing here is verified by a booking, so the UI must never dress it up as one |
| `…068_seed_demo_broadcasts` | Moves 3 fleet-update posts migration 065 wrongly seeded into `trip_posts` (before `host_broadcasts` existed) over to where they belong, and gives every demo host real broadcasts (`demo-bcast-%`). Disables the notify trigger for the insert — these re-keyed hosts have real UUIDs now, so the trigger's `demo-%` skip-guard can't catch them, and seed data shouldn't fan out real notifications |
| `…069_renter_preferences` | `renter_preferred_categories()` — "Usually books: SUV · Electric", computed from a renter's own completed+paid bookings (2-trip minimum), never a self-declared field |
| `…070_people_first_seed` | Corrects migration 065's content-hierarchy mistake: demo people get illustrated DiceBear avatars (never real stock photos of real humans), and every demo post's photos swap from car-catalog shots to place/moment shots — the person's experience is the hero, the car is a linked reference |
| `…071_people_in_photos` | Corrects 070's own overcorrection: empty landscape shots still aren't pictures of PEOPLE. Retargets the same loremflickr posts at friends/family/portrait keywords alongside the place |
| `…072_real_people_photos` | The actual fix: `web/src/lib/images.ts` never fetches loremflickr, it maps keywords onto curated pools — and there was no people pool, so 070/071's keywords silently fell through to a generic car photo. Ships with a real `people` pool (6 verified Wikimedia Commons road-trip photos) added to images.ts, and re-seeds every demo post with the exact tokens `poolFor()` now routes there |
| `…073_ai_chat_sessions` | `ai_chat_sessions` — the AI assistant's chat history moves off localStorage. One row per conversation (`turns` holds the client's own BotTurn[] JSON verbatim); a renter can have many, so "new chat" is an insert and "choose an old chat" is a pick from their own rows, newest first |

040 goes first because 045 and 047 both widen check constraints on the columns
it creates — run either before it and they fail on a column that does not exist.
040 had been missed entirely: the live database had 041 and 043 but not 040,
which is the kind of gap a hand-applied history produces and the reason the CLI
now tracks them.
