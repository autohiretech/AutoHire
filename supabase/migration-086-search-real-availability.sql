-- AutoHire migration 086 — a dated search hides cars that are not actually
-- free.
--
-- `search_available_listings` (074/075/076) answered "free between these
-- dates" by looking at bookings alone. A host's blocked days and a car in
-- maintenance were both invisible to it, so the browse page and the assistant
-- offered cars for dates they could never be booked on — `booking_availability`,
-- the trigger that has always checked all three, refused them at the end
-- instead. The renter found out after choosing.
--
-- Same signature, so every caller (the browse page, list_listings,
-- apply_filters) picks this up with no change.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create or replace function search_available_listings(
  p_country text default null,
  p_city text default null,
  p_category text default null,
  p_owner_type text default null,
  p_transmission text default null,
  p_fuel text default null,
  p_min_seats integer default null,
  p_max_price_rwf integer default null,
  p_query text default null,
  p_start_date date default null,
  p_end_date date default null,
  p_near_lat double precision default null,
  p_near_lng double precision default null
)
  returns setof listings
  language sql security definer set search_path = public stable as $$
  select listings.*
  from listings
  where (p_country is null or listings.country = p_country)
    and (p_city is null or listings.city = p_city)
    and (p_category is null or listings.category = p_category::car_category)
    and (p_owner_type is null or listings.owner_type = p_owner_type::owner_type)
    and (p_transmission is null or listings.transmission = p_transmission::transmission)
    and (p_fuel is null or listings.fuel = p_fuel::fuel_type)
    and (p_min_seats is null or listings.seats >= p_min_seats)
    and (p_max_price_rwf is null or listings.price_per_day_rwf <= p_max_price_rwf)
    -- Same keyword-OR search as listListings' keywordConditions(): every
    -- whitespace-separated word must hit title/make/model/city/location
    -- (case-insensitive), words are ANDed together ("toyota kigali" needs
    -- both to match, not the literal phrase). "not exists a word that
    -- doesn't match any field" is the SQL form of "every word matches".
    --
    -- The `cross join lateral` strips each word once (rather than four times
    -- inline, as 074/075 did) and the `word <> ''` that follows is what drops
    -- a punctuation-only token out of the AND entirely — see the header.
    and (
      p_query is null or btrim(p_query) = '' or not exists (
        select 1
        from unnest(regexp_split_to_array(btrim(p_query), '\s+')) as raw_word
        cross join lateral (
          select regexp_replace(raw_word, '[%*,()]', '', 'g') as word
        ) stripped
        where stripped.word <> ''
          and not (
            listings.title       ilike '%' || stripped.word || '%'
            or listings.make     ilike '%' || stripped.word || '%'
            or listings.model    ilike '%' || stripped.word || '%'
            or listings.city     ilike '%' || stripped.word || '%'
            or listings.location ilike '%' || stripped.word || '%'
          )
      )
    )
    -- Availability: skip entirely unless both dates are given.
    --
    -- Three things make a car unavailable for a range, and this used to check
    -- only the first. A renter asking for next weekend was shown cars the host
    -- had blocked and cars sitting in maintenance, then refused at booking by
    -- `booking_availability` — the trigger that has always enforced all three.
    and (
      p_start_date is null or p_end_date is null or (
        -- 1. Somebody else's booking overlaps the range.
        not exists (
          select 1
          from bookings b
          where b.listing_id = listings.id
            and b.state not in ('cancelled', 'declined', 'completed')
            and b.start_date < p_end_date
            and b.end_date > p_start_date
        )
        -- 2. The host blocked a day inside it. `blocked_dates` is a date[] of
        -- single days; the range is [start, end), same half-open convention
        -- the booking overlap above uses.
        and not exists (
          select 1
          from unnest(coalesce(listings.blocked_dates, '{}'::date[])) as blocked_day
          where blocked_day >= p_start_date
            and blocked_day <  p_end_date
        )
        -- 3. The car is off the road. Maintenance that ENDS before the trip
        -- starts is no reason to hide it — `maintenance_until` is the day it
        -- comes back, and the car page already says "back on <date>" — but an
        -- open-ended maintenance (null) covers everything.
        and (
          listings.status <> 'maintenance'
          or (listings.maintenance_until is not null and listings.maintenance_until <= p_start_date)
        )
      )
    )
  order by
    -- Unchanged from migration 075: `null` (both params absent) ties every
    -- row and falls through to the tiebreakers; `'infinity'` sorts a listing
    -- with no coordinates last without excluding it; otherwise the haversine
    -- great-circle distance in km, clamped into acos's domain.
    case
      when p_near_lat is null or p_near_lng is null then null
      when listings.lat is null or listings.lng is null then 'infinity'::double precision
      else 6371 * acos(least(1.0, greatest(-1.0,
        cos(radians(p_near_lat)) * cos(radians(listings.lat)) * cos(radians(listings.lng) - radians(p_near_lng))
        + sin(radians(p_near_lat)) * sin(radians(listings.lat))
      )))
    end asc,
    listings.rating_avg desc,
    listings.id asc
$$;
grant execute on function search_available_listings(
  text, text, text, text, text, text, integer, integer, text, date, date, double precision, double precision
) to anon, authenticated;
