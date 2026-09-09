-- AutoHire migration — punctuation is not a keyword.
--
-- `search_available_listings()` (migrations 074/075) ANDs the words of
-- `p_query`: every whitespace-separated word must hit title/make/model/city/
-- location. A word made of nothing but the characters we strip (`%*,()`) was
-- deliberately made to *fail* that test, mirroring the client's own
-- `keywordConditions()` returning `id.eq.__no_match__` for it — the reasoning
-- being that garbage should match zero listings rather than, through an
-- `ilike '%%'` that is trivially true, match every one of them.
--
-- Zero and everything were the wrong two choices. The third one — ignore it —
-- is what a search box should do, and the cost of not doing it was real: the
-- pickup box gets a Nominatim address whenever the renter searches from where
-- they are ("Gasabo District, City of Kigali, Rwanda"), the parser hands the
-- remainder on as keywords, and the bare "," among them zeroed the entire
-- search single-handedly. Kigali had 68 listings; the page said "No cars
-- match". A stray comma is not a search term, and it is not a way to say "no
-- results" either.
--
-- So: strip each word first, then drop the ones left empty, and require only
-- the words that survive to match. A query of pure punctuation now narrows
-- nothing instead of excluding everything — the same behavior as `keywordsOf`
-- in `web/src/lib/supabaseClient.ts`, which this must stay in step with.
--
-- Everything else — every filter predicate, the availability `not exists`,
-- migration 075's haversine `order by` — is copied from migration 075
-- unchanged. The argument type list is unchanged too (13 params, same types,
-- same order), so `create or replace` genuinely replaces this function rather
-- than adding a second overload beside it, and no `drop` is needed.
--
-- Idempotent: safe to re-run.

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
    and (
      p_start_date is null or p_end_date is null or not exists (
        select 1
        from bookings b
        where b.listing_id = listings.id
          and b.state not in ('cancelled', 'declined', 'completed')
          and b.start_date < p_end_date
          and b.end_date > p_start_date
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
