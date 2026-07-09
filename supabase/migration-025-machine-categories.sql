-- AutoHire migration 025 — machinery categories (cultivating + building).
--
-- Expands the catalogue beyond road vehicles to rentable MACHINES:
--   • Cultivating (agriculture): tractor, harvester, tiller
--   • Building (construction):   excavator, bulldozer, loader, crane, forklift
--
-- These are added to the existing `car_category` enum so machines reuse the same
-- listings table, filters, pricing and multi-currency/FX logic as cars.
--
-- IMPORTANT: run this migration ON ITS OWN and let it finish before running
-- migration-026 (the machine seed). Postgres will not let a brand-new enum value
-- be used by an INSERT in the same transaction, so the seed lives in a separate
-- file that you run afterwards.
--
-- Apply in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS guards).

alter type car_category add value if not exists 'tractor';
alter type car_category add value if not exists 'harvester';
alter type car_category add value if not exists 'tiller';
alter type car_category add value if not exists 'excavator';
alter type car_category add value if not exists 'bulldozer';
alter type car_category add value if not exists 'loader';
alter type car_category add value if not exists 'crane';
alter type car_category add value if not exists 'forklift';
