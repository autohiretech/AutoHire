-- AutoHire migration 069 — "Usually books: SUV · Electric", computed, never declared.
--
-- Every trust signal in the social layer so far is derived from real ledger
-- data — social proof (migration 060) reads real bookings, not a claim. A
-- free-text "my favorite car" field on a profile would be the first
-- unverified assertion in the whole system, and it would sit oddly next to
-- everything else. So this is a small aggregate over the renter's own
-- completed, PAID bookings — the same two conditions trip_post_guard already
-- requires before a post about a trip can exist.
--
-- Requires at least 2 distinct completed trips before returning anything —
-- one trip isn't a preference, it's just the one car someone happened to
-- book. Below that threshold the function returns no rows, and the caller
-- shows nothing rather than a badge built on a sample size of one.
--
-- Only categories are exposed (sedan, suv, 4x4, …) — never price, dates, or
-- location. That keeps this at the same sensitivity as rating_avg/
-- rating_count, which are already public on every profile.
--
-- Array-in, array-out: a feed page has many distinct authors on screen at
-- once, and this is the batch shape so hydrating it never turns into one
-- round trip per post.
--
-- Apply after schema.sql. Safe to re-run.

create or replace function renter_preferred_categories(p_renter_ids text[])
  returns table (renter_id text, category car_category, trips bigint)
  language sql stable security definer set search_path = public as $$
  with completed as (
    select b.renter_id, l.category
    from bookings b
    join listings l on l.id = b.listing_id
    where b.renter_id = any(p_renter_ids)
      and b.state = 'completed'
      and b.payment_status = 'paid'
  ),
  totals as (
    select renter_id, count(*) as total_trips from completed group by renter_id
  ),
  counted as (
    select renter_id, category, count(*) as trips,
           row_number() over (partition by renter_id order by count(*) desc, category) as rnk
    from completed
    group by renter_id, category
  )
  select c.renter_id, c.category, c.trips
  from counted c
  join totals t on t.renter_id = c.renter_id
  where t.total_trips >= 2 and c.rnk <= 2;
$$;

grant execute on function renter_preferred_categories(text[]) to authenticated, anon;
