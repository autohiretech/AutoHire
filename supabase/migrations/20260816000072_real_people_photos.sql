-- AutoHire migration 072 — route demo post photos to real people, not cars.
--
-- Migrations 070 and 071 both missed the same thing: `web/src/lib/images.ts`
-- never fetches loremflickr URLs at all. Every descriptor is intercepted by
-- resolvePhoto() and mapped, by keyword, onto a small curated pool of real,
-- individually-verified photos — and until now every pool was a car. Any
-- keyword that didn't match a known car make (which "friends,travel" and
-- "musanze,portrait" never could) silently fell through to a generic CAR
-- photo. That's why the feed kept showing Land Cruisers no matter what the
-- seed said.
--
-- The actual fix landed in images.ts alongside this migration: a new
-- `people` pool of six real, individually-verified Wikimedia Commons photos
-- (family/friends road trips), and poolFor() now routes the tokens
-- `friends`, `family`, `traveler(s)`, `tourist(s)`, `hitchhiking`,
-- `roadtrip`, `portrait`, `people` to it. Every keyword below uses one of
-- those tokens as the FIRST word specifically so it's unambiguous at a
-- glance which pool a descriptor hits — the second word is free-form context
-- (place, mood) and doesn't affect routing.
--
-- Apply after migration 071, and after the images.ts change ships to web.
-- Safe to re-run.

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,musanze?lock=8001',
  'https://loremflickr.com/800/600/roadtrip,rwanda?lock=8002'
] where id = 'demo-post-rw-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/portrait,kigali?lock=8003'
] where id = 'demo-post-rw-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,nyungwe?lock=8004',
  'https://loremflickr.com/800/600/portrait,huye?lock=8005'
] where id = 'demo-post-rw-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/traveler,huye?lock=8006'
] where id = 'demo-post-rw-04';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/people,wedding?lock=8007',
  'https://loremflickr.com/800/600/friends,kigali?lock=8008'
] where id = 'demo-post-rw-05';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,dubai?lock=8009',
  'https://loremflickr.com/800/600/roadtrip,dubai?lock=8010'
] where id = 'demo-post-ae-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,desert?lock=8011'
] where id = 'demo-post-ae-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/family,ajman?lock=8012'
] where id = 'demo-post-ae-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/portrait,sharjah?lock=8013'
] where id = 'demo-post-ae-04';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,shenzhen?lock=8014',
  'https://loremflickr.com/800/600/roadtrip,shenzhen?lock=8015'
] where id = 'demo-post-cn-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/traveler,beijing?lock=8016'
] where id = 'demo-post-cn-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,chengdu?lock=8017'
] where id = 'demo-post-cn-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/family,shanghai?lock=8018'
] where id = 'demo-post-cn-04';
