-- AutoHire migration 054 — a car is priced by the day OR by the hour, not both.
--
-- Migration 053 made hourly booking an ADD-ON: a car kept its day price and
-- could optionally also take hourly bookings. That's not what was wanted — a
-- host picks one pricing mode for the car, and picking "hourly" means there
-- is no day price to show, set, or book at all.
--
-- `pricing_mode` reuses booking_rental_type ('daily'/'hourly') — same
-- vocabulary as bookings.rental_type, which already tags each individual
-- booking with the mode it was made under. `hourly_booking_enabled` is
-- replaced rather than kept alongside: it was added in 053, days ago, never
-- carried real data volume, and two overlapping "is this car hourly" columns
-- is exactly the confusion this migration exists to remove.
--
-- Safe to re-run.

alter table listings
  add column if not exists pricing_mode booking_rental_type not null default 'daily';

-- Backfill from the column this replaces, before dropping it.
update listings set pricing_mode = 'hourly'
  where hourly_booking_enabled = true and pricing_mode = 'daily';

-- A day price is meaningless for an hourly-only car — nothing charges it,
-- nothing should display it. Drop the not-null before the old constraint,
-- which required a value unconditionally.
alter table listings alter column price_per_day_rwf drop not null;

alter table listings drop constraint if exists listings_price_per_day_positive;
alter table listings
  add constraint listings_price_per_day_positive
    check (price_per_day_rwf is null or price_per_day_rwf > 0);

alter table listings drop constraint if exists listings_daily_needs_day_price;
alter table listings
  add constraint listings_daily_needs_day_price
    check (pricing_mode = 'hourly' or price_per_day_rwf is not null);

-- Replaces 053's listings_hourly_needs_rate, which read hourly_booking_enabled.
alter table listings drop constraint if exists listings_hourly_needs_rate;
alter table listings
  add constraint listings_hourly_needs_rate
    check (pricing_mode = 'daily' or price_per_hour_rwf is not null);

alter table listings drop column if exists hourly_booking_enabled;
