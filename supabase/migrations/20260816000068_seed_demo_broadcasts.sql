-- AutoHire migration 068 — seed demo host broadcasts, and fix a
-- content-modeling mistake from migration 065.
--
-- migration 065 seeded three "fleet update" posts (RAV4 back from service,
-- etc.) into trip_posts, using the demo-post-% escape hatch, because at the
-- time host_broadcasts didn't exist yet. That was always the wrong table —
-- an un-anchored fleet announcement isn't a trip anyone took, it's exactly
-- what migration 067 built host_broadcasts FOR. This migration moves that
-- content to where it belongs and gives every demo host real broadcasts, not
-- just the three that happened to need a workaround first.
--
-- Same lesson as migration 065: resolve every host by business_name /
-- full_name, never by a literal id — checked against the live database
-- again just now, and the ids have not changed since 065, but "Kigali Auto
-- Rentals"'s own `country` column now reads 'US' instead of 'RW', which is
-- further proof that nothing about these demo profiles should be trusted
-- except the identity fields and listings.host_id.
--
-- REPLACEMENT: delete from host_broadcasts where id like 'demo-bcast-%';
-- Safe to re-run — demo broadcasts are deleted and reinserted.
--
-- One more wrinkle from the same re-keying: host_broadcast_notify()'s
-- "skip if seeded" guard checks `new.host_id like 'demo-%'`, which only ever
-- matched the ORIGINAL literal ids from migration 024. These hosts now carry
-- real UUIDs, so that guard can't fire — every row below would otherwise
-- send a real notification to every real follower these hosts have picked up
-- (including yours, if you've followed one while testing). Seed data should
-- never have side effects outside the rows it inserts, so the trigger is
-- disabled for the duration of this insert and re-enabled immediately after.
--
-- Apply after migration 067.

-- Fix migration 065's mistake: these were never trips, they don't belong in
-- trip_posts even via the demo escape hatch.
delete from trip_posts where id in ('demo-post-rw-06', 'demo-post-ae-05', 'demo-post-cn-05');

delete from host_broadcasts where id like 'demo-bcast-%';

alter table host_broadcasts disable trigger host_broadcast_notify_trigger;

insert into host_broadcasts (id, host_id, body, listing_id, created_at)
select 'demo-bcast-rw-01', p.id,
  'Weekend special: 15% off our RAV4 fleet, Saturday and Sunday only.',
  'demo-car-001', now() - interval '1 day'
from profiles p where p.business_name = 'Kigali Auto Rentals'
union all
select 'demo-bcast-rw-02', p.id,
  'Fleet now at 100 vehicles across Kigali, Musanze, Rubavu and Huye — same-day pickup on most cars.',
  null, now() - interval '6 days'
from profiles p where p.business_name = 'Kigali Auto Rentals'
union all
select 'demo-bcast-rw-03', p.id,
  'Land Cruiser just back from a full service — ready for gorilla trekking season.',
  'demo-car-002', now() - interval '2 days'
from profiles p where p.full_name = 'Jean-Paul Mugisha'
union all
select 'demo-bcast-ae-01', p.id,
  'New arrival: Tesla Model 3, available for weekly bookings starting today.',
  'demo-car-205', now() - interval '1 day'
from profiles p where p.business_name = 'Dubai Prestige Cars'
union all
select 'demo-bcast-ae-02', p.id,
  'Ramadan hours: pickup and drop-off available until midnight across all our Dubai locations.',
  null, now() - interval '9 days'
from profiles p where p.business_name = 'Dubai Prestige Cars'
union all
select 'demo-bcast-ae-03', p.id,
  'Land Cruiser back from detailing — perfect for a desert weekend out of Abu Dhabi.',
  'demo-car-202', now() - interval '3 days'
from profiles p where p.full_name = 'Ahmed Rahman'
union all
select 'demo-bcast-cn-01', p.id,
  'EV6 fast-charging upgrade complete — book it for your next Chengdu trip.',
  'demo-car-355', now() - interval '2 days'
from profiles p where p.business_name = 'Shanghai EV Fleet'
union all
select 'demo-bcast-cn-02', p.id,
  'Now serving Beijing, Shanghai, Guangzhou, Shenzhen and Chengdu — 75 EVs and counting.',
  null, now() - interval '11 days'
from profiles p where p.business_name = 'Shanghai EV Fleet'
union all
select 'demo-bcast-cn-03', p.id,
  'Ioniq 5 available again after service — one-pedal driving, zero hassle.',
  'demo-car-354', now() - interval '4 days'
from profiles p where p.full_name = 'Li Wei';

alter table host_broadcasts enable trigger host_broadcast_notify_trigger;
