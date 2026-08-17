-- AutoHire migration 065 — demo feed content: hardcoded first, replaced by
-- real trips as they complete.
--
-- Follows the exact precedent migration-024-seed-demo-cars.sql set: catalogue
-- profiles with no `auth.users` row, a `demo-` id prefix, and a one-line
-- delete in the header for when you want it gone. Nothing here is special —
-- it's the same convention, applied to the social layer instead of the fleet.
--
-- Every post below is `demo-post-%`, so trip_post_guard() (migration 064)
-- lets it through with no booking behind it — that escape hatch exists for
-- exactly this file. Visibility is 'public' on every seeded post, overriding
-- the real default of 'circles': a demo post exists to populate the feed for
-- someone who has zero circles yet, which is every brand-new signup.
--
-- One thing this migration does NOT do: hardcode the demo hosts' ids.
-- migration-024's header lists them as literal text ids ('demo-host-rw-1' and
-- so on), but on THIS project those ids no longer exist — checked against the
-- live database before writing this file. The 500 demo-car-% listings are
-- still there, but their host_id columns now point to real Supabase Auth
-- UUIDs (someone created real accounts for "Kigali Auto Rentals", "Ahmed
-- Rahman", etc. at some point, and migration 049's cascading profile-id
-- update carried the listings' host_id along). So every host reference below
-- is resolved with a subquery against `listings.host_id`, never a literal id
-- — that's authoritative regardless of what the ids happen to be today, and
-- survives the next re-key the same way.
--
-- REPLACEMENT TABLE — what removes each part, once real content exists:
--   Posts             delete from trip_posts where id like 'demo-post-%';
--   Rider profiles    delete from profiles where id like 'demo-rider-%';
--                        (cascades to their posts, follows, memberships)
--   Follow edges      delete from follows where follower_id like 'demo-rider-%';
--
-- Safe to re-run — riders and posts are deleted and reinserted, same as
-- migration 024 does for the demo fleet.
--
-- Apply after migration 064.

delete from trip_posts where id like 'demo-post-%';
delete from follows where follower_id like 'demo-rider-%';
delete from profiles where id like 'demo-rider-%';

-- ----------------------------------------------------------------------------
-- Demo riders — catalogue-only, no auth.users row, four per market.
-- ----------------------------------------------------------------------------
insert into profiles
  (id, full_name, email, phone, role, joined_at, verification, rating_avg, rating_count, country)
values
  ('demo-rider-rw-1', 'Aline Uwase',     'aline.uwase@example.com',   '+250788300301', 'renter', '2025-06-01', 'verified', 4.9, 6, 'RW'),
  ('demo-rider-rw-2', 'Eric Niyonzima',  'eric.niyonzima@example.com','+250788300302', 'renter', '2025-07-14', 'verified', 4.7, 3, 'RW'),
  ('demo-rider-rw-3', 'Divine Ingabire', 'divine.ingabire@example.com','+250788300303','renter', '2025-08-02', 'verified', 5.0, 9, 'RW'),
  ('demo-rider-rw-4', 'Patrick Habimana','patrick.habimana@example.com','+250788300304','renter','2025-09-20', 'verified', 4.8, 4, 'RW'),
  ('demo-rider-ae-1', 'Fatima Al Marri', 'fatima.almarri@example.com','+971552300301', 'renter', '2025-05-11', 'verified', 4.9, 7, 'AE'),
  ('demo-rider-ae-2', 'Youssef Haddad',  'youssef.haddad@example.com','+971552300302', 'renter', '2025-06-30', 'verified', 4.6, 2, 'AE'),
  ('demo-rider-ae-3', 'Noor Al Suwaidi', 'noor.alsuwaidi@example.com','+971552300303', 'renter', '2025-08-18', 'verified', 5.0, 5, 'AE'),
  ('demo-rider-ae-4', 'Omar Khalifa',    'omar.khalifa@example.com',  '+971552300304', 'renter', '2025-09-05', 'verified', 4.7, 3, 'AE'),
  ('demo-rider-cn-1', 'Zhang Wei',       'zhang.wei@example.com',     '+8613900300301','renter', '2025-05-25', 'verified', 4.8, 6, 'CN'),
  ('demo-rider-cn-2', 'Liu Yang',        'liu.yang@example.com',      '+8613900300302','renter', '2025-07-02', 'verified', 4.9, 4, 'CN'),
  ('demo-rider-cn-3', 'Chen Jing',       'chen.jing@example.com',     '+8613900300303','renter', '2025-08-27', 'verified', 5.0, 8, 'CN'),
  ('demo-rider-cn-4', 'Wang Fang',       'wang.fang@example.com',     '+8613900300304','renter', '2025-09-12', 'verified', 4.6, 2, 'CN');

-- ----------------------------------------------------------------------------
-- Follow edges: every demo rider follows the demo hosts in their market,
-- resolved by whoever currently owns a demo-car-% listing in that country —
-- not by a literal id. So follower counts and host broadcasts have somewhere
-- to land on day one, however those host accounts are keyed today.
-- ----------------------------------------------------------------------------
insert into follows (follower_id, followee_id)
select r.id, h.host_id
from (values
  ('demo-rider-rw-1'), ('demo-rider-rw-2'), ('demo-rider-rw-3'), ('demo-rider-rw-4')
) as r(id)
cross join (
  select distinct host_id from listings where id like 'demo-car-%' and country = 'RW'
) as h(host_id)
union all
select r.id, h.host_id
from (values
  ('demo-rider-ae-1'), ('demo-rider-ae-2'), ('demo-rider-ae-3'), ('demo-rider-ae-4')
) as r(id)
cross join (
  select distinct host_id from listings where id like 'demo-car-%' and country = 'AE'
) as h(host_id)
union all
select r.id, h.host_id
from (values
  ('demo-rider-cn-1'), ('demo-rider-cn-2'), ('demo-rider-cn-3'), ('demo-rider-cn-4')
) as r(id)
cross join (
  select distinct host_id from listings where id like 'demo-car-%' and country = 'CN'
) as h(host_id)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Demo posts — riders posting about trips, hosts posting fleet updates.
-- Rider posts reference a listing id directly (those ids are stable). Host
-- posts resolve their author from the listing's current host_id, same
-- reasoning as the follows above. Photos reuse migration 024's brand-matched
-- loremflickr scheme with a disjoint lock range (5001+) so they never collide
-- with a car's own gallery locks.
-- ----------------------------------------------------------------------------
insert into trip_posts (id, author_id, booking_id, listing_id, body, photos, visibility, city, country, created_at)
values
  ('demo-post-rw-01', 'demo-rider-rw-1', null, 'demo-car-002',
   'Took the Land Cruiser up to Musanze for the weekend — handled the volcano roads without a complaint. Booking again for the gorilla trek in December.',
   array['https://loremflickr.com/800/600/toyota,landcruiser?lock=5001', 'https://loremflickr.com/800/600/volcano,rwanda?lock=5002'],
   'public', 'Musanze', 'RW', now() - interval '2 days'),
  ('demo-post-rw-02', 'demo-rider-rw-3', null, 'demo-car-006',
   'Ioniq 5 for a Kigali week of meetings — fast charging at the mall made it a non-issue. Quietest car I''ve rented here.',
   array['https://loremflickr.com/800/600/hyundai,ioniq?lock=5003'],
   'public', 'Kigali', 'RW', now() - interval '5 days'),
  ('demo-post-rw-03', 'demo-rider-rw-2', null, 'demo-car-004',
   'BYD Seal in Huye — smooth ride, and the range easily covered a round trip to Nyungwe.',
   array['https://loremflickr.com/800/600/byd,car?lock=5004', 'https://loremflickr.com/800/600/forest,rwanda?lock=5005'],
   'public', 'Huye', 'RW', now() - interval '9 days'),
  ('demo-post-rw-04', 'demo-rider-rw-4', null, 'demo-car-009',
   'MG4 for a Huye conference run — easiest booking I''ve made on here, host had it ready at the airport.',
   array['https://loremflickr.com/800/600/mg,car?lock=5007'],
   'public', 'Huye', 'RW', now() - interval '12 days'),
  ('demo-post-rw-05', 'demo-rider-rw-1', null, 'demo-car-011',
   'BMW i4 for a friend''s wedding in Kigali — turned more heads than the couple, honestly.',
   array['https://loremflickr.com/800/600/bmw,i4?lock=5008'],
   'public', 'Kigali', 'RW', now() - interval '16 days'),

  ('demo-post-ae-01', 'demo-rider-ae-1', null, 'demo-car-205',
   'Model 3 down the whole Dubai coastline — Supercharger stop in Abu Dhabi took fifteen minutes. Would book every visit.',
   array['https://loremflickr.com/800/600/tesla,model3?lock=5009', 'https://loremflickr.com/800/600/dubai,skyline?lock=5010'],
   'public', 'Dubai', 'AE', now() - interval '3 days'),
  ('demo-post-ae-02', 'demo-rider-ae-3', null, 'demo-car-202',
   'Land Cruiser for a desert weekend out of Abu Dhabi — exactly what you want under you on sand.',
   array['https://loremflickr.com/800/600/landcruiser,desert?lock=5011'],
   'public', 'Abu Dhabi', 'AE', now() - interval '7 days'),
  ('demo-post-ae-03', 'demo-rider-ae-2', null, 'demo-car-204',
   'EQB for the in-laws'' visit — third row made the airport run painless.',
   array['https://loremflickr.com/800/600/mercedes,eqb?lock=5013'],
   'public', 'Ajman', 'AE', now() - interval '11 days'),
  ('demo-post-ae-04', 'demo-rider-ae-4', null, 'demo-car-203',
   'Corolla for a quick Sharjah errand run — nothing fancy, exactly what was needed.',
   array['https://loremflickr.com/800/600/toyota,corolla?lock=5014'],
   'public', 'Sharjah', 'AE', now() - interval '15 days'),

  ('demo-post-cn-01', 'demo-rider-cn-1', null, 'demo-car-354',
   'Ioniq 5 through Shenzhen traffic all week — the one-pedal driving alone is worth booking again for.',
   array['https://loremflickr.com/800/600/hyundai,ioniq?lock=5015', 'https://loremflickr.com/800/600/shenzhen,city?lock=5016'],
   'public', 'Shenzhen', 'CN', now() - interval '4 days'),
  ('demo-post-cn-02', 'demo-rider-cn-3', null, 'demo-car-351',
   'Prius for a Beijing work trip — quiet, easy to park, exactly what a week of meetings needs.',
   array['https://loremflickr.com/800/600/toyota,prius?lock=5017'],
   'public', 'Beijing', 'CN', now() - interval '8 days'),
  ('demo-post-cn-03', 'demo-rider-cn-2', null, 'demo-car-355',
   'EV6 for a Chengdu weekend — fast charging network made the whole trip painless.',
   array['https://loremflickr.com/800/600/kia,ev6?lock=5019'],
   'public', 'Chengdu', 'CN', now() - interval '10 days'),
  ('demo-post-cn-04', 'demo-rider-cn-4', null, 'demo-car-352',
   'Pajero for a Shanghai family trip — plenty of room, and the host threw in a car seat with no extra charge.',
   array['https://loremflickr.com/800/600/mitsubishi,pajero?lock=5020'],
   'public', 'Shanghai', 'CN', now() - interval '14 days');

-- Host-authored posts — fleet updates. author_id resolved from the listing
-- itself so this never depends on a host id staying what it was when this
-- file was written.
insert into trip_posts (id, author_id, booking_id, listing_id, body, photos, visibility, city, country, created_at)
select 'demo-post-rw-06', l.host_id, null, l.id,
  'RAV4 just came back from service — brand new tires, ready for its next trip. Instant book open for this week.',
  array['https://loremflickr.com/800/600/toyota,rav4?lock=5006'], 'public'::post_visibility, 'Kigali', 'RW', now() - interval '1 day'
from listings l where l.id = 'demo-car-001'
union all
select 'demo-post-ae-05', l.host_id, null, l.id,
  'RAV4 back in the Deira lot, fresh detail. First booker this week gets it spotless.',
  array['https://loremflickr.com/800/600/toyota,rav4?lock=5012'], 'public'::post_visibility, 'Dubai', 'AE', now() - interval '2 days'
from listings l where l.id = 'demo-car-201'
union all
select 'demo-post-cn-05', l.host_id, null, l.id,
  'RAV4 relisted in Guangzhou with a new dash cam fitted — first trip on it goes to whoever books first.',
  array['https://loremflickr.com/800/600/toyota,rav4?lock=5018'], 'public'::post_visibility, 'Guangzhou', 'CN', now() - interval '1 day'
from listings l where l.id = 'demo-car-353';
