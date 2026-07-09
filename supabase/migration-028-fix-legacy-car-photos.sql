-- AutoHire migration 028 — give the six original `car-N` listings real photos.
--
-- `car-1`…`car-6` come from the very first fixture seed (supabase/seed.sql, removed
-- from the repo in commit 8989323 but still live in the database). Their photos are
-- hardcoded Unsplash URLs that never matched the model — the Suzuki Swift renders a
-- Fiat 500, the Hiace a VW bus, the C-Class a dark sports car. The old seed even
-- flagged it in its own data ("Photos look like a stock image, not the actual car").
--
-- They are the *oldest* rows in the table, so before this they always won the
-- unordered `listListings()` query that feeds the "Featured" slideshow.
--
-- We rewrite them to the same `loremflickr.com/.../<keyword>?lock=<n>` descriptor shape
-- the demo seeds use. Nothing fetches loremflickr: web/src/lib/images.ts maps the
-- keyword onto a curated, subject-verified Wikimedia photo pool. The keyword here is
-- the *model* (rav4, prado, swift, hiace, cclass, hilux) rather than the make, so a
-- Hiace renders as a van and not as a RAV4.
--
-- We do NOT delete these rows: bookings.listing_id is `on delete cascade`, and bk-1,
-- bk-2 plus several flags and disputes point at car-1…car-5. Dropping the listings
-- would silently take the demo trips and the admin moderation queue with them.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

update listings set photos = array[
  'https://loremflickr.com/800/600/rav4,car?lock=1',
  'https://loremflickr.com/800/600/car,interior?lock=1',
  'https://loremflickr.com/800/600/car,dashboard?lock=1'
] where id = 'car-1';   -- Toyota RAV4

update listings set photos = array[
  'https://loremflickr.com/800/600/prado,car?lock=2',
  'https://loremflickr.com/800/600/car,interior?lock=2',
  'https://loremflickr.com/800/600/car,dashboard?lock=2'
] where id = 'car-2';   -- Toyota Land Cruiser Prado

update listings set photos = array[
  'https://loremflickr.com/800/600/swift,car?lock=3',
  'https://loremflickr.com/800/600/car,interior?lock=3',
  'https://loremflickr.com/800/600/car,dashboard?lock=3'
] where id = 'car-3';   -- Suzuki Swift

update listings set photos = array[
  'https://loremflickr.com/800/600/hiace,car?lock=4',
  'https://loremflickr.com/800/600/car,interior?lock=4',
  'https://loremflickr.com/800/600/car,dashboard?lock=4'
] where id = 'car-4';   -- Toyota Hiace

update listings set photos = array[
  'https://loremflickr.com/800/600/cclass,car?lock=5',
  'https://loremflickr.com/800/600/car,interior?lock=5',
  'https://loremflickr.com/800/600/car,dashboard?lock=5'
] where id = 'car-5';   -- Mercedes-Benz C-Class

update listings set photos = array[
  'https://loremflickr.com/800/600/hilux,car?lock=6',
  'https://loremflickr.com/800/600/car,interior?lock=6',
  'https://loremflickr.com/800/600/car,dashboard?lock=6'
] where id = 'car-6';   -- Toyota Hilux
