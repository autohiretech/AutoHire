-- AutoHire migration 001 — owner columns + admin role + hardened RLS.
-- Apply this against an EXISTING Supabase DB that already ran schema.sql once.
-- (schema.sql's CREATE TABLEs won't re-run on existing tables, so this ALTERs.)
--
-- Order of operations:
--   1. Run THIS file in the Supabase SQL editor.
--   2. Re-run supabase/seed.sql (it truncates + repopulates with profile_id).
--   3. (Optional) Run the "set not null" block at the bottom to match schema.sql.
--   4. Provision yourself as admin once you know your auth uid:
--        update profiles set role = 'admin' where id = '<your-auth-uid>';

-- 1. New owner columns (nullable for now; seed repopulates, step 3 hardens). -----
alter table verification_documents
  add column if not exists profile_id text references profiles(id);
alter table notifications
  add column if not exists profile_id text references profiles(id);

-- 2. Admin helper -------------------------------------------------------------
create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()::text and p.role = 'admin'
  );
$$;

-- 3. Re-apply RLS (idempotent: drops every public policy, then recreates). -----
alter table profiles               enable row level security;
alter table listings               enable row level security;
alter table bookings               enable row level security;
alter table payouts                enable row level security;
alter table conversations          enable row level security;
alter table messages               enable row level security;
alter table reviews                enable row level security;
alter table verification_documents enable row level security;
alter table notifications          enable row level security;
alter table flags                  enable row level security;
alter table disputes               enable row level security;

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I;', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy profiles_read   on profiles for select using (true);
create policy profiles_insert on profiles for insert with check (id = auth.uid()::text);
create policy profiles_update on profiles for update using (id = auth.uid()::text) with check (id = auth.uid()::text);

create policy listings_read   on listings for select using (true);
create policy listings_write  on listings for all
  using (host_id = auth.uid()::text) with check (host_id = auth.uid()::text);

create policy bookings_read   on bookings for select
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text or is_admin());
create policy bookings_insert on bookings for insert
  with check (renter_id = auth.uid()::text);
create policy bookings_update on bookings for update
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text)
  with check (renter_id = auth.uid()::text or host_id = auth.uid()::text);

create policy payouts_read on payouts for select
  using (host_id = auth.uid()::text or is_admin());

create policy conversations_read   on conversations for select
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text);
create policy conversations_write  on conversations for all
  using (renter_id = auth.uid()::text or host_id = auth.uid()::text)
  with check (renter_id = auth.uid()::text or host_id = auth.uid()::text);
create policy messages_read on messages for select
  using (exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and (c.renter_id = auth.uid()::text or c.host_id = auth.uid()::text)
  ));
create policy messages_insert on messages for insert
  with check (sender_id = auth.uid()::text);
create policy messages_update on messages for update
  using (exists (
    select 1 from conversations c
    where c.id = messages.conversation_id
      and (c.renter_id = auth.uid()::text or c.host_id = auth.uid()::text)
  ));

create policy reviews_read   on reviews for select using (true);
create policy reviews_insert on reviews for insert with check (author_id = auth.uid()::text);

create policy flags_read   on flags for select
  using (reported_by = auth.uid()::text or is_admin());
create policy flags_insert on flags for insert with check (reported_by = auth.uid()::text);
create policy flags_update on flags for update using (is_admin()) with check (is_admin());
create policy disputes_read   on disputes for select
  using (raised_by = auth.uid()::text or against = auth.uid()::text or is_admin());
create policy disputes_insert on disputes for insert with check (raised_by = auth.uid()::text);
create policy disputes_update on disputes for update using (is_admin()) with check (is_admin());

create policy vdocs_read   on verification_documents for select
  using (profile_id = auth.uid()::text or is_admin());
create policy vdocs_write  on verification_documents for all
  using (profile_id = auth.uid()::text) with check (profile_id = auth.uid()::text);
create policy notifications_read  on notifications for select
  using (profile_id = auth.uid()::text or is_admin());
create policy notifications_write on notifications for all
  using (profile_id = auth.uid()::text) with check (profile_id = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- (Optional) After re-running seed.sql, harden the new columns to NOT NULL so
-- they match a fresh schema.sql. Run this LAST.
--   alter table verification_documents alter column profile_id set not null;
--   alter table notifications          alter column profile_id set not null;
