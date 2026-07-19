-- AutoHire migration 037 — admin user management (list, suspend, message).
--
--   * profiles.suspended: a suspended account can't list vehicles or book.
--     Guarded so only admins can change it.
--   * admin_list_users: paginated, searchable directory with counts.
--   * admin_set_suspended / admin_send_message: admin actions.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table profiles add column if not exists suspended boolean not null default false;

-- Guard `suspended` like the other platform-managed columns (admins/service only).
create or replace function profile_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null
     or is_admin()
     or coalesce(current_setting('app.verification_sync', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role = 'admin' then
      raise exception 'You cannot create an admin account.';
    end if;
    if new.verification <> 'unverified'
       or new.rating_avg is not null
       or new.rating_count is not null
       or new.suspended then
      raise exception 'Verification, rating and suspension are managed by the platform.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     and (new.role = 'admin' or old.role = 'admin') then
    raise exception 'That role change is not allowed.';
  end if;
  if new.verification is distinct from old.verification
     or new.verification_override is distinct from old.verification_override
     or new.suspended is distinct from old.suspended
     or new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count then
    raise exception 'Verification, rating and suspension are managed by the platform.';
  end if;
  return new;
end $$;

-- Paginated, searchable user directory for the admin panel.
create or replace function admin_list_users(
  p_search text default '',
  p_limit  int  default 20,
  p_offset int  default 0
)
returns table (
  id text, full_name text, email text, phone text, avatar_url text,
  role user_role, owner_type owner_type, verification verification_status,
  suspended boolean, joined_at date,
  listing_count bigint, booking_count bigint, total_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select p.id, p.full_name, p.email, p.phone, p.avatar_url, p.role, p.owner_type,
         p.verification, p.suspended, p.joined_at,
         (select count(*) from listings l where l.host_id = p.id),
         (select count(*) from bookings b where b.renter_id = p.id or b.host_id = p.id),
         count(*) over()
  from profiles p
  where (p_search = ''
         or p.full_name ilike '%' || p_search || '%'
         or p.email     ilike '%' || p_search || '%')
  order by p.joined_at desc nulls last, p.full_name
  limit p_limit offset p_offset;
end $$;

create or replace function admin_set_suspended(p_profile_id text, p_suspended boolean)
  returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update profiles set suspended = p_suspended where id = p_profile_id;
  return p_suspended;
end $$;

-- Admin -> user message, delivered as a notification.
create or replace function admin_send_message(p_profile_id text, p_title text, p_body text)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Message body is required.';
  end if;
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('adm-' || replace(gen_random_uuid()::text, '-', ''),
          p_profile_id, 'message',
          coalesce(nullif(trim(p_title), ''), 'Message from AutoHire'),
          p_body, '{}', now(), false);
end $$;

revoke all on function admin_list_users(text, int, int) from anon;
revoke all on function admin_set_suspended(text, boolean) from anon;
revoke all on function admin_send_message(text, text, text) from anon;
grant execute on function admin_list_users(text, int, int) to authenticated;
grant execute on function admin_set_suspended(text, boolean) to authenticated;
grant execute on function admin_send_message(text, text, text) to authenticated;

-- Suspended accounts can't list vehicles or create bookings.
create or replace function block_suspended_listing() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select suspended from profiles where id = new.host_id) then
    raise exception 'This account is suspended and cannot list vehicles.';
  end if;
  return new;
end $$;

drop trigger if exists block_suspended_listing_trigger on listings;
create trigger block_suspended_listing_trigger
  before insert on listings
  for each row execute function block_suspended_listing();

create or replace function block_suspended_booking() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if (select suspended from profiles where id = new.renter_id) then
    raise exception 'This account is suspended and cannot make bookings.';
  end if;
  return new;
end $$;

drop trigger if exists block_suspended_booking_trigger on bookings;
create trigger block_suspended_booking_trigger
  before insert on bookings
  for each row execute function block_suspended_booking();
