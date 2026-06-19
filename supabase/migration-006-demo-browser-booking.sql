-- AutoHire migration 006 — DEMO ONLY: allow browser-created bookings.
--
-- Migration 005 removed the bookings INSERT policy so the only way to create a
-- booking was the `confirm-booking` Edge Function (which verifies a real Stripe
-- payment). For a demo with no payment provider and no deployed function, this
-- re-allows a logged-in renter to insert their own booking straight from the
-- browser. The availability + status-lock triggers from migration 005 still
-- fire, so dates and the state machine are still enforced.
--
-- ⚠️  This reopens the "renter sets their own price" hole. Drop this policy
--     before going to production:  drop policy bookings_insert_demo on bookings;
--
-- Apply in the Supabase SQL editor. Safe to re-run.

drop policy if exists bookings_insert_demo on bookings;
create policy bookings_insert_demo on bookings for insert
  with check (renter_id = auth.uid()::text);
