-- AutoHire migration 011 — host-provided location link.
--
-- An optional URL the host can attach to a listing (e.g. a Google Maps share /
-- directions link, a What3Words address, or a page with arrival instructions)
-- that renters can open when heading to the pickup point.
--
-- Apply after migrations 001–010 in the Supabase SQL editor. Safe to re-run.

alter table listings
  add column if not exists location_url text;
