-- AutoHire migration 098 — a hybrid counts toward the electric quota.
--
-- Migration 036 built the quota around `fuel = 'electric'` and nothing else, so
-- a hybrid was counted exactly like a diesel: it pushed the fleet's percentage
-- DOWN and could itself be refused. Meanwhile the banner at the top of every
-- page on the site reads "90% Electric, Hybrid & Ecological." The claim already
-- included hybrids; only the enforcement did not, so the two disagreed in the
-- direction that matters — the site promised one thing and the database
-- quietly held the fleet to another.
--
-- This is a POLICY change, decided by the owner, not a bug fix: hybrids now
-- qualify. Nothing else about the rule moves. Machinery stays exempt, purely
-- electric cars are still always allowed, and the threshold itself is still
-- whatever an admin has set (80 at the time of writing, with the fleet at
-- 85.7% electric and 86.7% counting hybrids).
--
-- The counts get a name that says what they are. `electric_cars` kept its
-- meaning — cars that are actually electric — because an admin panel showing
-- "Electric cars: 484" when 6 of them are hybrids would be the same kind of
-- quiet untruth this migration exists to remove. `qualifying_cars` is the
-- figure the rule is computed from, and the two are returned side by side so
-- the split is visible rather than inferred.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- What the quota accepts. A single definition, so the trigger that refuses a
-- listing and the panel that reports the percentage can never drift apart —
-- which is exactly how the enforcement and the banner drifted in the first
-- place.
create or replace function fuel_meets_quota(f fuel_type) returns boolean
  language sql immutable as $$
  select f in ('electric', 'hybrid');
$$;

comment on function fuel_meets_quota(fuel_type) is
  'Fuels that count toward the platform electric quota. Hybrid qualifies (owner decision, 2026-09-14); see migration 098.';

-- Reject a car that meets neither fuel when adding it would drop the fleet
-- below the threshold.
create or replace function enforce_electric_quota() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  min_pct         int;
  total_cars      bigint;
  qualifying_cars bigint;
begin
  -- Machinery is exempt; a qualifying car is always allowed.
  if not is_car_category(new.category) or fuel_meets_quota(new.fuel) then
    return new;
  end if;

  min_pct := electric_min_percent();
  if min_pct <= 0 then
    return new;   -- quota disabled
  end if;

  select count(*) filter (where is_car_category(category)),
         count(*) filter (where is_car_category(category) and fuel_meets_quota(fuel))
    into total_cars, qualifying_cars
  from listings
  where id <> new.id;   -- exclude the row being inserted/updated

  -- Require qualifying_cars / (total_cars + 1) >= min_pct/100 after this car.
  if qualifying_cars * 100 < min_pct * (total_cars + 1) then
    raise exception
      'Only electric or hybrid cars can be listed right now — the platform must stay at least % percent electric or hybrid.',
      min_pct
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Fleet snapshot for the listing form + admin panel (counts cars only).
--
-- `electric_cars` is unchanged in both name and meaning so nothing reading it
-- starts lying; `qualifying_cars` is added beside it and is what the rule uses.
-- A caller that has not been updated keeps getting a true count of electric
-- cars — it under-reports the fleet's standing rather than over-reporting it,
-- which is the safe direction for a number this one to be stale in.
--
-- Dropped first, not replaced: `create or replace` cannot change a function's
-- return type, and adding columns to a `returns table` does exactly that. It
-- fails with "cannot change return type of existing function" rather than
-- doing anything by halves, so the drop is required, not tidiness.
drop function if exists electric_quota_status();

create function electric_quota_status()
  returns table (
    min_percent          int,
    total_cars           bigint,
    electric_cars        bigint,
    hybrid_cars          bigint,
    qualifying_cars      bigint,
    can_add_non_electric boolean
  )
  language sql stable security definer set search_path = public as $$
  select
    electric_min_percent(),
    count(*) filter (where is_car_category(category)),
    count(*) filter (where is_car_category(category) and fuel = 'electric'),
    count(*) filter (where is_car_category(category) and fuel = 'hybrid'),
    count(*) filter (where is_car_category(category) and fuel_meets_quota(fuel)),
    electric_min_percent() <= 0
      or (count(*) filter (where is_car_category(category) and fuel_meets_quota(fuel))) * 100
         >= electric_min_percent() * (count(*) filter (where is_car_category(category)) + 1)
  from listings;
$$;

grant execute on function electric_quota_status() to anon, authenticated;
grant execute on function fuel_meets_quota(fuel_type) to anon, authenticated;
