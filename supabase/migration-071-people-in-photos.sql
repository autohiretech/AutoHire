-- AutoHire migration 071 — put people back in the photos.
--
-- migration 070 fixed the wrong problem completely: it swapped car-catalog
-- shots for scenery, but an empty landscape is still not a picture of a
-- person. A social post about "the trip I took" should show the person who
-- took it — a candid shot of them at the destination, with friends, mid-trip
-- — not a tourism-board photo of a skyline with nobody in it. Retargets the
-- same loremflickr convention at keywords that actually surface people:
-- travel/friends/family/portrait tags alongside the place, not the place
-- alone. loremflickr can't guarantee content, only bias the tag search
-- toward it — which is what "person, place" keyword pairs do here.
--
-- Apply after migration 070. Safe to re-run.

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,travel?lock=7001',
  'https://loremflickr.com/800/600/musanze,portrait?lock=7002'
] where id = 'demo-post-rw-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/woman,travel?lock=7003'
] where id = 'demo-post-rw-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,roadtrip?lock=7004',
  'https://loremflickr.com/800/600/portrait,rwanda?lock=7005'
] where id = 'demo-post-rw-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/man,travel?lock=7006'
] where id = 'demo-post-rw-04';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/wedding,people?lock=7007',
  'https://loremflickr.com/800/600/friends,celebration?lock=7008'
] where id = 'demo-post-rw-05';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/woman,dubai?lock=7009',
  'https://loremflickr.com/800/600/friends,dubai?lock=7010'
] where id = 'demo-post-ae-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,desert?lock=7011'
] where id = 'demo-post-ae-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/family,travel?lock=7012'
] where id = 'demo-post-ae-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/man,portrait?lock=7013'
] where id = 'demo-post-ae-04';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/woman,city?lock=7014',
  'https://loremflickr.com/800/600/friends,night?lock=7015'
] where id = 'demo-post-cn-01';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/man,city?lock=7016'
] where id = 'demo-post-cn-02';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/friends,travel?lock=7017'
] where id = 'demo-post-cn-03';

update trip_posts set photos = array[
  'https://loremflickr.com/800/600/family,portrait?lock=7018'
] where id = 'demo-post-cn-04';
