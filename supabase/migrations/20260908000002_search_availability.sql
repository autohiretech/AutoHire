-- AutoHire migration — availability-aware search.
--
-- `listListings`/`listListingsPage` (web/src/lib/supabaseClient.ts) filter
-- listings on country/city/category/owner_type/transmission/fuel/seats/price/
-- keyword, but never on whether the car is actually free for the dates a
-- renter picked — a fully-booked car shows up in search results exactly like
-- an open one. `search_available_listings()` mirrors every one of those
-- existing predicates (read straight off `listListings`'s `.eq()`/`.gte()`/
-- `.lte()` chain and its `query` keyword-OR search) and adds one more: when
-- both `p_start_date` and `p_end_date` are given, exclude any listing with a
-- conflicting booking. Pass either date alone (or neither) and the exclusion
-- is skipped entirely — today's no-dates behavior is unchanged.
--
-- The "which bookings count as blocking" list and the overlap test are
-- copy-pasted, not re-derived, from the two places that already answer this
-- question and must never quietly disagree with a third:
--   - status list: `listing_booked_ranges` (migration-009-listing-status.sql)
--     — `b.state not in ('cancelled', 'declined', 'completed')`.
--   - overlap test: `CarDetailPage.tsx`'s `isUnavailable` — a date `d` is
--     blocked by `range.startDate <= d && d < range.endDate` (half-open, so
--     the end date is free for same-day handoff to the next renter). The
--     equivalent range/range conflict test is the standard half-open overlap:
--     `existing.start_date < new_end_date and existing.end_date > new_start_date`
--     (strict both sides — `<=`/`>=` here would double-block the handoff day).
--
-- Returns `setof listings` (identical shape to `select('*') from listings`,
-- so the client's existing `mapRows<Listing>` needs no changes) and is called
-- through supabase-js's `.rpc()`, which returns a `PostgrestFilterBuilder` —
-- `{ count: 'exact' }` plus `.range()` work on it exactly as they do on a
-- table `.select()`, so `listListingsPage` gets its paged slice and exact
-- total without the function needing to know about pages at all.
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
  p_end_date date default null
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
  order by listings.rating_avg desc, listings.id asc
$$;

grant execute on function search_available_listings(
  text, text, text, text, text, text, integer, integer, text, date, date
) to anon, authenticated;

-- The availability `not exists` above is now the hot path for every dated
-- search; `bookings` only had single-column indexes on `state` and
-- `listing_id` (migration-032-kyc-audit-and-indexes.sql) before this.
create index if not exists bookings_listing_dates_idx on bookings (listing_id, start_date, end_date);
