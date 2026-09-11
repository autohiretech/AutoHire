-- AutoHire — migration 078: admins notify groups of people.
--
-- Until now an admin could message one user at a time from Admin → Users
-- (`admin_send_message`). Telling every host about a change, or everyone who
-- has not finished verification, meant opening each account in turn. Admin →
-- Notifications sends one message to an audience in a single call, records it
-- as a broadcast, and shows how many recipients have seen it.
--
-- An audience is resolved on the server, from the same rules everywhere
-- (`admin_audience_members`), so the size an admin is shown before sending is
-- the number of notifications that get written.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- What was sent
-- ---------------------------------------------------------------------------

create table if not exists admin_broadcasts (
  id              uuid primary key default gen_random_uuid(),
  admin_id        text references profiles(id) on delete set null,
  audience        text not null
                  check (audience in ('everyone', 'hosts', 'renters', 'unverified', 'unverified_hosts', 'people')),
  -- ISO 3166-1 alpha-2; null means every country. Never set for `people`.
  country         char(2),
  -- The chosen profile ids, for `people` only — so the history can say who.
  people          text[],
  title           text not null,
  body            text not null,
  link            text,
  recipient_count integer not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists admin_broadcasts_created_idx on admin_broadcasts (created_at desc);

alter table admin_broadcasts enable row level security;
drop policy if exists admin_broadcasts_read on admin_broadcasts;
create policy admin_broadcasts_read on admin_broadcasts for select using (is_admin());

-- Which broadcast a notification came from, so "seen by" is a count of read
-- rows rather than a second table kept in step. Null for every other kind.
alter table notifications
  add column if not exists broadcast_id uuid references admin_broadcasts(id) on delete set null;
create index if not exists notifications_broadcast_idx
  on notifications (broadcast_id) where broadcast_id is not null;

-- ---------------------------------------------------------------------------
-- Who is in an audience
-- ---------------------------------------------------------------------------
--
-- A host is an account with `owner_type` set — the same test `listHosts` uses.
-- Group audiences leave out suspended accounts, admins and the sender. `people`
-- is exactly who the admin picked: choosing someone by name is deliberate.

create or replace function admin_audience_members(p_audience text, p_country text, p_people text[])
  returns setof text
  language sql stable security definer set search_path = public as $$
  select p.id
    from profiles p
   where case
           when p_audience = 'people' then p.id = any(coalesce(p_people, '{}'::text[]))
           else p.suspended = false
                and p.role <> 'admin'
                and p.id <> coalesce(auth.uid()::text, '')
                and (p_country is null or p.country = upper(p_country))
                and case p_audience
                      when 'everyone'         then true
                      when 'hosts'            then p.owner_type is not null
                      when 'renters'          then p.owner_type is null
                      when 'unverified'       then p.verification <> 'verified'
                      when 'unverified_hosts' then p.owner_type is not null and p.verification <> 'verified'
                      else false
                    end
         end;
$$;

-- Internal: returns profile ids without an admin check, so only the admin
-- functions below (running as the owner) may call it.
revoke all on function admin_audience_members(text, text, text[]) from public, anon, authenticated;

-- How many people each group audience reaches, optionally within one country.
create or replace function admin_notify_audience_sizes(p_country text default null)
  returns table (audience text, people bigint)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select a, (select count(*) from admin_audience_members(a, nullif(trim(p_country), ''), null))
    from unnest(array['everyone', 'hosts', 'renters', 'unverified', 'unverified_hosts']) as a;
end $$;

-- The countries people are in, largest first, for the country filter.
create or replace function admin_notify_countries()
  returns table (country char(2), people bigint)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select p.country, count(*)
    from profiles p
   where p.country is not null and p.suspended = false and p.role <> 'admin'
   group by p.country
   order by count(*) desc, p.country;
end $$;

-- ---------------------------------------------------------------------------
-- Sending
-- ---------------------------------------------------------------------------

create or replace function admin_notify_people(
  p_audience text,
  p_title    text,
  p_body     text,
  p_country  text   default null,
  p_people   text[] default null,
  p_link     text   default null
) returns table (broadcast_id uuid, recipient_count integer)
  language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid;
  v_count   integer;
  v_title   text := coalesce(nullif(trim(p_title), ''), 'Message from AutoHire');
  v_body    text := nullif(trim(p_body), '');
  v_link    text := nullif(trim(p_link), '');
  v_country text := case when p_audience = 'people' then null else upper(nullif(trim(p_country), '')) end;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if p_audience is null
     or p_audience not in ('everyone', 'hosts', 'renters', 'unverified', 'unverified_hosts', 'people') then
    raise exception 'Choose who to notify.';
  end if;
  if v_body is null then
    raise exception 'Write a message first.';
  end if;
  if length(v_body) > 2000 then
    raise exception 'Keep the message under 2,000 characters.';
  end if;
  if length(v_title) > 120 then
    raise exception 'Keep the title under 120 characters.';
  end if;
  if p_audience = 'people' and coalesce(cardinality(p_people), 0) = 0 then
    raise exception 'Choose at least one person.';
  end if;
  if v_country is not null and v_country !~ '^[A-Z]{2}$' then
    raise exception 'Country must be a two-letter code.';
  end if;
  -- A link opens a page on AutoHire, never another site: a platform
  -- notification pointing off-site is exactly what a phishing message looks
  -- like, and nothing an admin needs to send requires one.
  if v_link is not null and v_link !~ '^/([A-Za-z0-9._~%-]+(/[A-Za-z0-9._~%-]+)*/?)?([?#][^\s]*)?$' then
    raise exception 'A link must be a page on AutoHire, starting with / (for example /verification).';
  end if;

  insert into admin_broadcasts (admin_id, audience, country, people, title, body, link)
  values (nullif(auth.uid()::text, ''), p_audience, v_country,
          case when p_audience = 'people' then p_people end,
          v_title, v_body, v_link)
  returning id into v_id;

  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read, link, broadcast_id)
  select 'adm-' || replace(gen_random_uuid()::text, '-', ''), m, 'message', v_title, v_body,
         '{in_app}', now(), false, v_link, v_id
    from admin_audience_members(p_audience, v_country, p_people) as m;
  get diagnostics v_count = row_count;

  -- Raising rolls the broadcast row back too, so the history never shows a
  -- message that reached nobody.
  if v_count = 0 then
    raise exception 'Nobody matches that audience, so nothing was sent.';
  end if;

  update admin_broadcasts b set recipient_count = v_count where b.id = v_id;
  perform log_admin_action('broadcast', v_id::text, v_title);
  return query select v_id, v_count;
end $$;

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

create or replace function admin_list_broadcasts(p_limit int default 50)
  returns table (
    id uuid, admin_id text, admin_name text, audience text, country char(2),
    people_names text[], title text, body text, link text,
    recipient_count integer, read_count bigint, created_at timestamptz
  )
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select b.id, b.admin_id, a.full_name, b.audience, b.country,
         (select array_agg(p.full_name order by p.full_name) from profiles p where p.id = any(b.people)),
         b.title, b.body, b.link, b.recipient_count,
         (select count(*) from notifications n where n.broadcast_id = b.id and n.read),
         b.created_at
    from admin_broadcasts b
    left join profiles a on a.id = b.admin_id
   order by b.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;
