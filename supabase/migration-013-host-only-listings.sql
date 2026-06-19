-- AutoHire migration 013 — only hosts can create listings.
--
-- Closes the API-level hole behind the UI gate: previously any authenticated
-- user could insert a listing for themselves (host_id = their uid) regardless of
-- role. Now creating a listing requires a host account (profiles.role = 'owner').
-- A renter must become a host first. Update/delete stay role-free so an
-- owner-turned-renter can still manage existing listings.
--
-- Apply after migrations 001–012 in the Supabase SQL editor. Safe to re-run.

create or replace function is_host() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()::text and p.role = 'owner'
  );
$$;

drop policy if exists listings_write  on listings;
drop policy if exists listings_insert on listings;
drop policy if exists listings_update on listings;
drop policy if exists listings_delete on listings;

create policy listings_insert on listings for insert
  with check (host_id = auth.uid()::text and (is_host() or is_admin()));
create policy listings_update on listings for update
  using (host_id = auth.uid()::text) with check (host_id = auth.uid()::text);
create policy listings_delete on listings for delete
  using (host_id = auth.uid()::text);
