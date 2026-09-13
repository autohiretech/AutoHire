-- 093 — a three-letter word is too short to guess with.
--
-- 092 let any word of three characters or more be matched by trigram
-- similarity. Testing it against the real fleet showed what that costs:
--
--     query "bus"  →  top hit "Caterpillar D6 XE — electric bulldozer"
--
-- Which is not a bus. "bus" has two trigrams, and two trigrams land somewhere
-- in almost any long sentence — "bulldozer" among them. The word had already
-- matched properly through `categories_named` ('bus' → minibus); the fuzzy
-- pass then dragged in a dozen machines behind the real answers and put one of
-- them first.
--
-- Five characters. Long enough that its trigrams mean something, and it still
-- covers the typos this was built for: "corola" (6), "toyta" (5), "hyundia"
-- (7). Shorter words keep the substring test and the category lookup, which
-- are exact and were always the right tools for them — "suv", "van", "4x4"
-- never needed guessing.
--
-- The ranking expression is deliberately untouched: it only ever reaches
-- `word_similarity` after the exact tests miss, so it cannot invent a match
-- that the filter above did not already allow.
--
-- Apply in the Supabase SQL editor or via `supabase db push`. Safe to re-run.

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
  language sql security definer set search_path = public, extensions stable as $$
  select listings.*
  from listings
  left join profiles host on host.id = listings.host_id
  cross join lateral (
    select lower(
      coalesce(listings.title, '') || ' ' ||
      coalesce(listings.make, '') || ' ' ||
      coalesce(listings.model, '') || ' ' ||
      coalesce(listings.city, '') || ' ' ||
      coalesce(listings.location, '') || ' ' ||
      coalesce(listings.category::text, '') || ' ' ||
      coalesce(host.full_name, '') || ' ' ||
      coalesce(host.business_name, '')
    ) as hay
  ) doc
  where (p_country is null or listings.country = p_country)
    and (p_city is null or listings.city = p_city)
    and (p_category is null or listings.category = p_category::car_category)
    and (p_owner_type is null or listings.owner_type = p_owner_type::owner_type)
    and (p_transmission is null or listings.transmission = p_transmission::transmission)
    and (p_fuel is null or listings.fuel = p_fuel::fuel_type)
    and (p_min_seats is null or listings.seats >= p_min_seats)
    and (p_max_price_rwf is null or listings.price_per_day_rwf <= p_max_price_rwf)
    and (
      p_query is null or btrim(p_query) = '' or not exists (
        select 1
        from unnest(regexp_split_to_array(btrim(lower(p_query)), '\s+')) as raw_word
        cross join lateral (
          select regexp_replace(raw_word, '[%*,()]', '', 'g') as word
        ) stripped
        where stripped.word <> ''
          and not (
            doc.hay like '%' || stripped.word || '%'
            or listings.category = any (categories_named(stripped.word))
            -- Five, not three. See the header: "bus" is two trigrams and two
            -- trigrams land in almost anything.
            or (length(stripped.word) >= 5 and word_similarity(stripped.word, doc.hay) >= 0.5)
          )
      )
    )
    and (
      p_start_date is null or p_end_date is null or (
        not exists (
          select 1
          from bookings b
          where b.listing_id = listings.id
            and b.state not in ('cancelled', 'declined', 'completed')
            and b.start_date < p_end_date
            and b.end_date > p_start_date
        )
        and not exists (
          select 1
          from unnest(coalesce(listings.blocked_dates, '{}'::date[])) as blocked_day
          where blocked_day >= p_start_date
            and blocked_day <  p_end_date
        )
        and (
          listings.status <> 'maintenance'
          or (listings.maintenance_until is not null and listings.maintenance_until <= p_start_date)
        )
      )
    )
  order by
    case
      when p_query is null or btrim(p_query) = '' then null
      else (
        select sum(
          case
            when doc.hay like '%' || btrim(lower(p_query)) || '%' then 3.0
            when doc.hay like '%' || w.word || '%' then 1.0
            when listings.category = any (categories_named(w.word)) then 0.9
            else word_similarity(w.word, doc.hay)
          end
        )
        from unnest(regexp_split_to_array(btrim(lower(p_query)), '\s+')) as raw
        cross join lateral (select regexp_replace(raw, '[%*,()]', '', 'g') as word) w
        where w.word <> ''
      )
    end desc nulls last,
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
