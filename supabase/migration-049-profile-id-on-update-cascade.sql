-- AutoHire migration 049 — let a profile's id change, and carry its data with it.
--
-- `profiles.id` is the account's identity everywhere: fifteen foreign keys in
-- eleven tables point at it. Every one was declared `on delete cascade` and
-- nothing else, so deleting an account cleans up after itself — but CHANGING an
-- id was impossible, because the first referencing row refuses the update.
--
-- That mattered the moment a catalogue-only host needed a login. Migration 024
-- seeded hosts with text ids (`demo-host-rw-1`) and no `auth.users` row, on the
-- assumption they would only ever be inventory. Giving one a real login means
-- its id has to become the auth UUID — Supabase mints that id and cannot be
-- told to use ours — and its 100 listings, bookings, payouts, disputes and
-- messages all have to follow it in the same breath.
--
-- The alternative was repointing each table by hand, in an order that never
-- leaves a row pointing at an id that does not exist yet, with the old profile
-- deleted last — and a `delete` here cascades, so getting that order wrong
-- destroys the data instead of moving it. `on update cascade` hands the whole
-- problem to Postgres, which does it atomically and cannot get the order wrong.
--
-- `on delete cascade` is preserved exactly as it was on every constraint. This
-- adds a behaviour, it does not change one.
--
-- Apply after migration 048. Safe to re-run.

do $$
declare
  fk record;
begin
  for fk in
    select
      con.conname,
      rel.relname        as table_name,
      att.attname        as column_name,
      con.confdeltype    as on_delete
    from pg_constraint con
    join pg_class rel        on rel.oid = con.conrelid
    join pg_class ref        on ref.oid = con.confrelid
    join pg_namespace nsp    on nsp.oid = rel.relnamespace
    join unnest(con.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute att    on att.attrelid = rel.oid and att.attnum = k.attnum
    where con.contype = 'f'
      and ref.relname = 'profiles'
      and nsp.nspname = 'public'
      -- Already carries ON UPDATE CASCADE ('c'); leave it alone so a re-run is
      -- a no-op rather than fifteen needless constraint rebuilds.
      and con.confupdtype <> 'c'
  loop
    execute format('alter table public.%I drop constraint %I', fk.table_name, fk.conname);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on update cascade %s',
      fk.table_name,
      fk.conname,
      fk.column_name,
      -- Carry the existing delete rule across verbatim. 'a' is NO ACTION, 'c'
      -- CASCADE, 'n' SET NULL, 'd' SET DEFAULT, 'r' RESTRICT. Rebuilding a
      -- constraint without this would silently drop the cleanup behaviour that
      -- account deletion depends on (migration 002).
      case fk.on_delete
        when 'c' then 'on delete cascade'
        when 'n' then 'on delete set null'
        when 'd' then 'on delete set default'
        when 'r' then 'on delete restrict'
        else ''
      end
    );
    raise notice 'on update cascade → %.%', fk.table_name, fk.column_name;
  end loop;
end $$;
