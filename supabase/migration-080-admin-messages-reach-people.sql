-- AutoHire migration 080 — admin messages reach the people they are sent to.
--
--   `admin_send_message`, `admin_warn_user` and `admin_notify_people` write
--      the `admin_message` kind added in 079, so the bell shows them. Chat
--      keeps `message` and its own badge. Rows already sent (id `adm-…`) are
--      converted, so messages sent into the void before today appear now.

-- Apply in the Supabase SQL editor, after 079. Safe to re-run.

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
          p_profile_id, 'admin_message',
          coalesce(nullif(trim(p_title), ''), 'Message from AutoHire'),
          p_body, '{in_app}', now(), false);
  perform log_admin_action('message', p_profile_id, nullif(trim(p_title), ''));
end $$;

create or replace function admin_warn_user(p_profile_id text, p_message text)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if coalesce(trim(p_message), '') = '' then
    raise exception 'Warning message is required.';
  end if;
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('adm-' || replace(gen_random_uuid()::text, '-', ''),
          p_profile_id, 'admin_message', 'Warning from AutoHire', p_message, '{in_app}', now(), false);
  perform log_admin_action('warn', p_profile_id, p_message);
end $$;

-- Unchanged from 078 apart from the kind the rows are written with.
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
  select 'adm-' || replace(gen_random_uuid()::text, '-', ''), m, 'admin_message', v_title, v_body,
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

-- Everything an admin already sent. `adm-` ids are written only by the three
-- functions above; chat notifications are `ntf-…` from migration 015's trigger.
update notifications
   set kind = 'admin_message'
 where kind = 'message'
   and id like 'adm-%';
