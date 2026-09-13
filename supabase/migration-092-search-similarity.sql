-- 091 — search that finds the thing you meant.
--
-- The box under the category chips matched five columns with `ilike '%word%'`.
-- That is a substring test, and it fails three ways a renter notices:
--
--   • **A typo returns nothing.** "corola" is not a substring of "Corolla", so
--     an empty page — the one result that reads as "you have no cars like
--     that" when the truth is "you have three".
--   • **Category words find nothing.** Typing "suv" searched titles for the
--     letters s-u-v. The category the renter just named is a column, and it
--     was not being read.
--   • **Host names find nothing.** A renter who remembers the person, not the
--     car, had no way to ask.
--
-- Word matches now if ANY of: a substring hit on the car's own text, the
-- word naming the car's category (with the words people actually use —
-- "digger", "jeep", "truck"), a substring hit on the host's name, or a trigram
-- similarity above threshold against the whole document. Words stay ANDed, so
-- "toyota kigali" still needs both.
--
-- Results are then ORDERED by how well they matched, which `ilike` could never
-- do: every row it returned was equally true.
--
-- Apply in the Supabase SQL editor or via `supabase db push`. Safe to re-run.

create extension if not exists pg_trgm with schema extensions;

-- ── The words people use for a category ────────────────────────────────────
-- `car_category` is a fixed enum and nobody types enum values. A renter says
-- "jeep", "digger", "truck", "bus" — and means suv, excavator, pickup,
-- minibus. Immutable, so the planner may inline it.
create or replace function categories_named(p_word text)
  returns car_category[]
  language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct c.cat_text::car_category), '{}'::car_category[])
  from (
    values
      ('sedan','sedan'), ('saloon','sedan'), ('estate','sedan'),
      ('suv','suv'), ('jeep','suv'), ('crossover','suv'),
      ('4x4','4x4'), ('4×4','4x4'), ('4wd','4x4'), ('offroad','4x4'), ('off-road','4x4'),
      ('hatchback','hatchback'), ('hatch','hatchback'),
      ('pickup','pickup'), ('truck','pickup'), ('ute','pickup'), ('bakkie','pickup'),
      ('van','van'), ('minivan','van'),
      ('minibus','minibus'), ('bus','minibus'), ('coaster','minibus'), ('matatu','minibus'),
      ('luxury','luxury'), ('premium','luxury'), ('executive','luxury'), ('vip','luxury'),
      ('tractor','tractor'),
      ('harvester','harvester'), ('combine','harvester'),
      ('tiller','tiller'), ('rotavator','tiller'),
      ('excavator','excavator'), ('digger','excavator'), ('backhoe','excavator'),
      ('bulldozer','bulldozer'), ('dozer','bulldozer'),
      ('loader','loader'),
      ('crane','crane'),
      ('forklift','forklift'), ('fork','forklift')
  ) as c(word, cat_text)
  where c.word = lower(btrim(p_word))
$$;

comment on function categories_named(text) is
  'Which car categories a search word names, including the words people '
  'actually use. Empty array when the word names none — never null, so it can '
  'be tested with = any() without a null guard.';

-- ── Search ─────────────────────────────────────────────────────────────────
-- Same signature as 086, so every caller picks it up unchanged.
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
  -- The host, for searching by the person rather than the car. LEFT so a
  -- listing whose host row is missing still appears; it just has no name to
  -- match on.
  left join profiles host on host.id = listings.host_id
  -- Everything worth matching, once, as one string. Built here rather than
  -- repeated per word per column: `word_similarity` against the whole document
  -- is also what lets "toyota corolla kigali" score higher on a car that is
  -- all three than on one that is merely a Toyota.
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
    -- Every word must match something. "Not exists a word that matches
    -- nothing" is the SQL form of that, and it keeps the AND semantics 076
    -- established: "toyota kigali" is both, never the phrase.
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
            -- Trigram similarity, for the typo. `word_similarity` scores the
            -- best-matching *part* of the document rather than the whole of
            -- it, which is the right question here: the document is a
            -- sentence and the word is one thing inside it. 0.5 keeps
            -- "corola"→Corolla while refusing to call "bmw" a Toyota; a
            -- one- or two-letter word is left to the substring test above,
            -- since trigrams of something that short match far too much.
            or (length(stripped.word) >= 3 and word_similarity(stripped.word, doc.hay) >= 0.5)
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
    -- **Relevance first, and only when there is a query.** `ilike` returned
    -- every hit as equally true, so "toyota" put whichever Toyota happened to
    -- be rated highest above the one whose title actually starts with it.
    -- Null with no query, which ties every row and falls through to the
    -- distance/rating order below exactly as before.
    case
      when p_query is null or btrim(p_query) = '' then null
      else (
        select sum(
          case
            -- The whole phrase, verbatim. Someone who typed it that way meant it.
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
grant execute on function categories_named(text) to anon, authenticated;
