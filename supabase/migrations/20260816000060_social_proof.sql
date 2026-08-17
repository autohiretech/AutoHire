-- AutoHire migration 060 — social proof: "N people you follow rented this".
--
-- The hard part isn't the badge, it's the RLS. `bookings_read` (schema.sql)
-- only lets you see a booking where you're the renter, the host, or an admin —
-- correctly so, a booking carries dates and money. But the badge needs to ask
-- "of the people I follow, who rented THIS car" across bookings that belong to
-- other people entirely, which a plain client-side select can never do no
-- matter how `follows` is joined in.
--
-- So this is a SECURITY DEFINER function, not a view over `bookings`. It is
-- deliberately narrow: it returns only public_profiles columns (never dates,
-- amounts, or payment status) for renters who (a) are followed by the caller
-- and (b) completed a PAID booking on the given listing. That's the same
-- information a follower list already exposes, just filtered down to one car —
-- it adds no new disclosure, it just answers a more specific question.
--
-- `total_trips` is a plain count with no per-row detail, in keeping with
-- `listings.rating_count` already being public.
--
-- Apply after migration 059. Safe to re-run.

create or replace function social_proof_for_listing(p_listing_id text)
  returns table (
    renter_id  text,
    full_name  text,
    avatar_url text
  )
  language sql stable security definer set search_path = public as $$
  select distinct p.id as renter_id, p.full_name, p.avatar_url
  from bookings b
  join follows f on f.followee_id = b.renter_id and f.follower_id = auth.uid()::text
  join profiles p on p.id = b.renter_id
  where b.listing_id = p_listing_id
    and b.state = 'completed'
    and b.payment_status = 'paid';
$$;

-- Callable by any signed-in user (it reads auth.uid() itself); the function
-- body is what restricts what comes back, not a grant.
grant execute on function social_proof_for_listing(text) to authenticated;

-- The badge also needs "N total completed trips" even when you follow no one
-- who's rented it yet. This is a SMALLER disclosure than the per-renter path
-- above (a count, no names), but still needs SECURITY DEFINER for the same
-- reason: `bookings_read` restricts a plain select to your own trips, and this
-- must count everyone's.
create or replace function total_completed_trips(p_listing_id text)
  returns bigint
  language sql stable security definer set search_path = public as $$
  select count(*) from bookings
  where listing_id = p_listing_id and state = 'completed' and payment_status = 'paid';
$$;

grant execute on function total_completed_trips(text) to authenticated, anon;
