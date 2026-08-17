-- AutoHire migration 070 — make the seeded feed about people, not cars.
--
-- Two fixes, same root cause: migration 065 seeded this content in a hurry
-- by reusing what migration 024 already had lying around — car-catalog
-- photos for post images, and no avatar at all for the people. That made
-- every seeded post read as "another photo of a car" with a name tag next to
-- it, which is backwards for a social feed: the person and what they did
-- should be the hero, the car is a linked reference (it already has its own
-- gallery on the listing page).
--
-- 1. Avatars. DiceBear's `personas` style, seeded deterministically by
--    profile id — illustrated, not photographic. Deliberately NOT a stock
--    photo of a real human face: attaching an actual person's photo to a
--    fictional identity is a different and worse problem than a stock car
--    photo ever was. https://www.dicebear.com
--
-- 2. Post photos. Every demo-post-% row's `photos` swaps from car-exterior /
--    interior / dashboard shots to place-and-moment shots — the scenery of
--    the trip, not a product shot of the vehicle. Same loremflickr
--    convention migration 024 already established, just travel keywords
--    instead of car keywords, and disjoint lock ids (6001+) so nothing
--    collides with a car's own gallery or the earlier 5001+ range.
--
-- Host avatars are resolved by business_name/full_name, same reasoning as
-- migrations 065 and 068 — these accounts carry real UUIDs today, not the
-- literal ids migration 024 originally gave them.
--
-- Apply after migration 068. Safe to re-run.

-- ----------------------------------------------------------------------------
-- 1. Avatars
-- ----------------------------------------------------------------------------
update profiles
   set avatar_url = 'https://api.dicebear.com/9.x/personas/svg?seed=' || id
 where id like 'demo-rider-%';

update profiles
   set avatar_url = 'https://api.dicebear.com/9.x/personas/svg?seed=' || id
 where business_name in ('Kigali Auto Rentals', 'Dubai Prestige Cars', 'Shanghai EV Fleet')
    or full_name in ('Jean-Paul Mugisha', 'Ahmed Rahman', 'Li Wei');

-- ----------------------------------------------------------------------------
-- 2. Post photos — place and moment, not the car
-- ----------------------------------------------------------------------------
update trip_posts set photos = array[
  'https://loremflickr.com/800/600/musanze,volcano?lock=6001',
  'https://loremflickr.com/800/600/rwanda,mountains?lock=6002'
] where id = 'demo-post-rw-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/kigali,street?lock=6003'
] where id = 'demo-post-rw-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/nyungwe,forest?lock=6004',
  'https://loremflickr.com/800/600/huye,rwanda?lock=6005'
] where id = 'demo-post-rw-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/huye,town?lock=6006'
] where id = 'demo-post-rw-04';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/wedding,celebration?lock=6007',
  'https://loremflickr.com/800/600/kigali,evening?lock=6008'
] where id = 'demo-post-rw-05';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/dubai,skyline?lock=6009',
  'https://loremflickr.com/800/600/dubai,coastline?lock=6010'
] where id = 'demo-post-ae-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/abudhabi,desert?lock=6011'
] where id = 'demo-post-ae-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/ajman,city?lock=6012'
] where id = 'demo-post-ae-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/sharjah,street?lock=6013'
] where id = 'demo-post-ae-04';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/shenzhen,skyline?lock=6014',
  'https://loremflickr.com/800/600/shenzhen,night?lock=6015'
] where id = 'demo-post-cn-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/beijing,city?lock=6016'
] where id = 'demo-post-cn-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/chengdu,city?lock=6017'
] where id = 'demo-post-cn-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/shanghai,family?lock=6018'
] where id = 'demo-post-cn-04';
