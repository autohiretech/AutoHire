-- AutoHire migration 004 — business/company accounts are hosts only and may
-- not rent. Enforces it at the database (the UI block can be bypassed via the
-- API; this is the real boundary). Apply after the earlier migrations.

drop policy if exists bookings_insert on bookings;
create policy bookings_insert on bookings for insert
  with check (
    renter_id = auth.uid()::text
    and not exists (
      select 1 from profiles p
      where p.id = auth.uid()::text and p.owner_type = 'business'
    )
  );
