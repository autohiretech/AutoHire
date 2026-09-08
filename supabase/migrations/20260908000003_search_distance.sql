-- AutoHire migration — distance-sortable search.
--
-- `search_available_listings()` (migration 074) filters listings on every
-- field `listListings` already filters on, plus date availability. It has no
-- notion of "how far is this car from me" — the second real-filter feature
-- this app needed (the first being availability) is a sort, not a filter:
-- "Closest to me" should rank listings by the renter's own location against
-- each listing's `lat`/`lng` (a host's declared car pickup coordinates —
-- `CreateListingInput.lat`/`.lng`, `web/src/lib/types.ts`), computed as a
-- real haversine great-circle distance in Postgres, not a hardcoded
-- city-to-city lookup table or a client-side approximation.
--
-- No PostGIS, earthdistance, or cube extension exists anywhere in this
-- schema (confirmed by grep) — plain haversine SQL is the right amount of
-- machinery for one function, not a reason to add a new extension.
--
-- This expands `search_available_listings`'s signature rather than adding a
-- second function: two new optional params, `p_near_lat`/`p_near_lng`,
-- appended at the end (so every existing positional or named call against
-- the old 11-param signature keeps working unchanged) and defaulted `null`
-- (so omitting them reproduces today's behavior exactly). Availability and
-- distance are independent, composable reasons a search needs this RPC
-- instead of a plain table query — one function that can do both, not two
-- that could quietly drift apart.
--
-- Every filter predicate and the availability `not exists` clause are
-- unchanged from migration 074 — copy them, do not re-derive. Only the
-- `order by` changes:
--   - Neither coordinate given: the new distance expression evaluates to
--     `null` for every row, which ties every comparison and falls straight
--     through to `rating_avg desc, id asc` — byte-for-byte the same final
--     order as before this migration, not just "close enough."
--   - Both given: order by haversine distance from that point ascending,
--     with any listing missing a lat or lng sorted last rather than excluded
--     or erroring — the same convention `ResultsMap.tsx` already uses for a
--     listing with no coordinates (it drops the pin, keeps the listing).
--     The `least(1.0, greatest(-1.0, ...))` clamp around the `acos` argument
--     is required, not decorative: floating-point rounding can push that
--     argument fractionally outside [-1, 1] for two very-close or antipodal
--     points, and `acos` of an out-of-domain argument returns NULL silently
--     — which would then sort however Postgres feels like placing a NULL,
--     silently corrupting the distance sort, instead of erroring loudly.
--
-- Idempotent: safe to re-run.
--
-- `create or replace function` only replaces a function whose argument
-- TYPE LIST matches exactly — Postgres identifies a function by
-- (schema, name, arg types), and 13 types is not the same signature as
-- migration 074's 11. Without dropping the old signature first, this would
-- create a *second*, separate overload sitting alongside the original
-- rather than replacing it — and any caller invoking with exactly the old
-- 11 named arguments would then hit "function is not unique," since both
-- overloads satisfy that call once the new one's trailing two params have
-- defaults. Drop the old signature explicitly so there is ever only one.

drop function if exists search_available_listings(
  text, text, text, text, text, text, integer, integer, text, date, date
);

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
    and (
      p_query is null or btrim(p_query) = '' or not exists (
        select 1
        from unnest(regexp_split_to_array(btrim(p_query), '\s+')) as word
        where word <> ''
          -- A word that's nothing but stripped characters (e.g. "%%%") must
          -- fail to match, the same as the client's own `keywordConditions`
          -- forcing `id.eq.__no_match__` for it. Without this guard,
          -- `regexp_replace(word, ...)` collapses to '', every `ilike '%%'`
          -- below is trivially true, and a garbage word would silently match
          -- every listing instead of zero — the opposite of the client.
          and not (
            regexp_replace(word, '[%*,()]', '', 'g') <> ''
            and (
              listings.title    ilike '%' || regexp_replace(word, '[%*,()]', '', 'g') || '%'
              or listings.make     ilike '%' || regexp_replace(word, '[%*,()]', '', 'g') || '%'
              or listings.model    ilike '%' || regexp_replace(word, '[%*,()]', '', 'g') || '%'
              or listings.city     ilike '%' || regexp_replace(word, '[%*,()]', '', 'g') || '%'
              or listings.location ilike '%' || regexp_replace(word, '[%*,()]', '', 'g') || '%'
            )
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
    -- `null` (both params absent) ties every row and falls through to the
    -- tiebreakers below, unchanged from migration 074. `'infinity'` (a
    -- point was given but this listing has no lat/lng) sorts the listing
    -- last among distance-ranked results without excluding it. Otherwise,
    -- the real haversine great-circle distance in km, clamped into acos's
    -- domain — see the header comment above for why the clamp is required.
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
