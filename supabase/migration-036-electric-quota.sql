-- AutoHire migration 036 — electric-car quota (platform-wide, cars only).
--
-- The platform enforces that at least N% of CARS are electric (default 95%).
-- Machinery (tractors, excavators, …) is exempt. A non-electric car can only be
-- listed while doing so keeps the fleet at/above the threshold; electric cars
-- are always allowed. The percentage is admin-controlled.
--
-- Enforced by a BEFORE trigger on listings, so it holds no matter who inserts.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

-- Admin-controlled threshold.
alter table app_settings
  add column if not exists electric_min_percent int not null default 95
  constraint app_settings_electric_pct_range check (electric_min_percent between 0 and 100);

create or replace function electric_min_percent() returns int
  language sql stable security definer set search_path = public as $$
  select coalesce((select electric_min_percent from app_settings where id = 1), 95);
$$;

create or replace function admin_set_electric_min_percent(p_pct int) returns int
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_pct < 0 or p_pct > 100 then
    raise exception 'Percent must be between 0 and 100.';
  end if;
  update app_settings set electric_min_percent = p_pct where id = 1;
  return p_pct;
end $$;

revoke all on function admin_set_electric_min_percent(int) from anon;
grant execute on function admin_set_electric_min_percent(int) to authenticated;

-- A "car" (subject to the quota) vs machinery (exempt). Mirrors isMachine() /
-- the 'Vehicles' group in web/src/lib/categories.ts.
create or replace function is_car_category(c car_category) returns boolean
  language sql immutable as $$
  select c in ('sedan','suv','4x4','hatchback','pickup','van','minibus','luxury');
$$;

-- Reject a non-electric car when adding it would drop cars below the threshold.
create or replace function enforce_electric_quota() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  min_pct       int;
  total_cars    bigint;
  electric_cars bigint;
begin
  -- Machinery is exempt; electric cars are always allowed.
  if not is_car_category(new.category) or new.fuel = 'electric' then
    return new;
  end if;

  min_pct := electric_min_percent();
  if min_pct <= 0 then
    return new;   -- quota disabled
  end if;

  select count(*) filter (where is_car_category(category)),
         count(*) filter (where is_car_category(category) and fuel = 'electric')
    into total_cars, electric_cars
  from listings
  where id <> new.id;   -- exclude the row being inserted/updated

  -- Require electric_cars / (total_cars + 1) >= min_pct/100 after this car.
  if electric_cars * 100 < min_pct * (total_cars + 1) then
    raise exception
      'Only electric cars can be listed right now — the platform must stay at least % percent electric.',
      min_pct
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists enforce_electric_quota_trigger on listings;
create trigger enforce_electric_quota_trigger
  before insert or update on listings
  for each row execute function enforce_electric_quota();

-- Fleet snapshot for the listing form + admin panel (counts cars only).
create or replace function electric_quota_status()
  returns table (
    min_percent          int,
    total_cars           bigint,
    electric_cars        bigint,
    can_add_non_electric boolean
  )
  language sql stable security definer set search_path = public as $$
  select
    electric_min_percent(),
    count(*) filter (where is_car_category(category)),
    count(*) filter (where is_car_category(category) and fuel = 'electric'),
    electric_min_percent() <= 0
      or (count(*) filter (where is_car_category(category) and fuel = 'electric')) * 100
         >= electric_min_percent() * (count(*) filter (where is_car_category(category)) + 1)
  from listings;
$$;

grant execute on function electric_quota_status() to anon, authenticated;
