-- AutoHire migration 044 — watching is for renters only.
--
-- Migration 043 let anyone watch a car, on the reasoning that watching isn't
-- booking. It's a renter's tool: the whole point of a watch is "tell me when I
-- can book this", which a host or company account can never act on. So hosts
-- (role 'owner') and companies (owner_type 'business') no longer get one.
--
-- Existing rows are left alone — an account that became a host keeps whatever it
-- watched, it just can't add more. Delete stays open so they can clear the list.
--
-- Apply after migration 043. Safe to re-run.

drop policy if exists watchlist_insert on watchlist;
create policy watchlist_insert on watchlist for insert
  with check (
    profile_id = auth.uid()::text
    -- profiles is world-readable (profiles_read), so this needs no definer.
    and not exists (
      select 1 from profiles p
      where p.id = auth.uid()::text
        and (p.role = 'owner' or p.owner_type = 'business')
    )
  );
