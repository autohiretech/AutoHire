-- AutoHire migration 084 — a message from an admin is a conversation, not a
-- leaflet.
--
-- Admin → Users could send someone a message, and that was the end of it: the
-- person read "we need a clearer photo of your licence" with no way to say
-- "here it is" or "which one?". The only reply channel in the app is the
-- renter↔host chat, which hangs off a listing (`conversations.listing_id` is
-- NOT NULL), so an admin conversation has nowhere to live there.
--
-- One open thread per person, reused: an admin writing twice continues the
-- same conversation rather than starting a pile of one-line threads, and the
-- person always has exactly one place to answer. Closing a thread starts the
-- next message off fresh.
--
-- Nothing is written directly: both tables are RPC-only, so the unread counts
-- and the thread summary can never drift from the messages.
--
-- Apply in the Supabase SQL editor, after 080. Safe to re-run.

create table if not exists support_threads (
  id                   text primary key,
  profile_id           text not null references profiles(id) on delete cascade,
  subject              text not null,
  status               text not null default 'open' check (status in ('open', 'closed')),
  created_at           timestamptz not null default now(),
  last_message_at      timestamptz not null default now(),
  last_message_preview text not null default '',
  -- Who spoke last, so a list can show "waiting on us" without reading messages.
  last_from_admin      boolean not null default true,
  unread_for_admin     integer not null default 0,
  unread_for_user      integer not null default 0
);

create index if not exists support_threads_profile_idx on support_threads (profile_id, last_message_at desc);
create index if not exists support_threads_recent_idx  on support_threads (last_message_at desc);

create table if not exists support_messages (
  id         text primary key,
  thread_id  text not null references support_threads(id) on delete cascade,
  sender_id  text not null references profiles(id) on delete cascade,
  from_admin boolean not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_thread_idx on support_messages (thread_id, created_at);

alter table support_threads  enable row level security;
alter table support_messages enable row level security;

-- Read your own; admins read everyone's. Writes go through the functions below,
-- so there is deliberately no insert or update policy.
drop policy if exists support_threads_read on support_threads;
create policy support_threads_read on support_threads for select
  using (profile_id = (auth.uid())::text or is_admin());

drop policy if exists support_messages_read on support_messages;
create policy support_messages_read on support_messages for select
  using (
    is_admin()
    or exists (
      select 1 from support_threads t
       where t.id = support_messages.thread_id
         and t.profile_id = (auth.uid())::text
    )
  );

-- ----------------------------------------------------------------------------
-- Appending a message, and the thread summary that follows from it.
-- ----------------------------------------------------------------------------
create or replace function support_append(
  p_thread_id  text,
  p_sender_id  text,
  p_from_admin boolean,
  p_body       text
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  insert into support_messages (id, thread_id, sender_id, from_admin, body)
  values ('smsg-' || replace(gen_random_uuid()::text, '-', ''), p_thread_id, p_sender_id, p_from_admin, p_body);

  update support_threads
     set last_message_at      = now(),
         last_message_preview = left(p_body, 140),
         last_from_admin      = p_from_admin,
         -- Writing is reading: whoever just answered has plainly seen what
         -- they answered, so their own side clears while the other side's
         -- count goes up. Without this the inbox still says "waiting on us"
         -- about a conversation the admin just replied to.
         unread_for_user      = case when p_from_admin then unread_for_user + 1 else 0 end,
         unread_for_admin     = case when p_from_admin then 0 else unread_for_admin + 1 end,
         -- A reply reopens a closed conversation. Nobody replies to say nothing,
         -- and a person answering into a closed thread would be answering
         -- nobody.
         status               = 'open'
   where id = p_thread_id;
end $$;

/** The person's open thread, created if they have none. */
create or replace function support_open_thread(p_profile_id text, p_subject text)
  returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  select id into v_id
    from support_threads
   where profile_id = p_profile_id and status = 'open'
   order by last_message_at desc
   limit 1;

  if v_id is null then
    v_id := 'sup-' || replace(gen_random_uuid()::text, '-', '');
    insert into support_threads (id, profile_id, subject)
    values (v_id, p_profile_id, coalesce(nullif(btrim(p_subject), ''), 'Message from AutoHire'));
  end if;
  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- The admin side.
-- ----------------------------------------------------------------------------
-- Redefined from 080: the same notification, now with a conversation behind it.
create or replace function admin_send_message(p_profile_id text, p_title text, p_body text)
  returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_thread text;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Message body is required.';
  end if;

  v_thread := support_open_thread(p_profile_id, p_title);
  perform support_append(v_thread, coalesce(nullif(auth.uid()::text, ''), p_profile_id), true, p_body);

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
declare
  v_thread text;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if coalesce(trim(p_message), '') = '' then
    raise exception 'Warning message is required.';
  end if;

  v_thread := support_open_thread(p_profile_id, 'Warning from AutoHire');
  perform support_append(v_thread, coalesce(nullif(auth.uid()::text, ''), p_profile_id), true, p_message);

  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('adm-' || replace(gen_random_uuid()::text, '-', ''),
          p_profile_id, 'admin_message', 'Warning from AutoHire', p_message, '{in_app}', now(), false);
  perform log_admin_action('warn', p_profile_id, p_message);
end $$;

/** The admin inbox: newest activity first, with the person attached. */
create or replace function admin_support_threads(
  p_scope  text default 'open',
  p_search text default '',
  p_limit  int  default 20,
  p_offset int  default 0
) returns table (
  id text, profile_id text, full_name text, email text, avatar_url text,
  subject text, status text, last_message_at timestamptz, last_message_preview text,
  last_from_admin boolean, unread_for_admin integer, message_count bigint, total_count bigint
)
  language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  return query
  select t.id, t.profile_id, p.full_name, p.email, p.avatar_url,
         t.subject, t.status, t.last_message_at, t.last_message_preview,
         t.last_from_admin, t.unread_for_admin,
         (select count(*) from support_messages m where m.thread_id = t.id) as message_count,
         count(*) over() as total_count
    from support_threads t
    join profiles p on p.id = t.profile_id
   where (p_scope <> 'open' or t.status = 'open')
     and (coalesce(btrim(p_search), '') = ''
          or p.full_name ilike '%' || btrim(p_search) || '%'
          or p.email     ilike '%' || btrim(p_search) || '%')
   order by t.unread_for_admin > 0 desc, t.last_message_at desc
   limit p_limit offset p_offset;
end $$;

/** Every message in one thread, oldest first, and it counts as read by the admin. */
create or replace function admin_support_messages(p_thread_id text)
  returns table (id text, sender_id text, from_admin boolean, body text, created_at timestamptz)
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update support_threads set unread_for_admin = 0 where id = p_thread_id;
  return query
  select m.id, m.sender_id, m.from_admin, m.body, m.created_at
    from support_messages m
   where m.thread_id = p_thread_id
   order by m.created_at;
end $$;

create or replace function admin_support_reply(p_thread_id text, p_body text)
  returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_profile text;
  v_subject text;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a reply first.';
  end if;
  select profile_id, subject into v_profile, v_subject from support_threads where id = p_thread_id;
  if v_profile is null then
    raise exception 'That conversation no longer exists.';
  end if;

  perform support_append(p_thread_id, coalesce(nullif(auth.uid()::text, ''), v_profile), true, p_body);

  -- The person is told the same way any admin message tells them, so a reply
  -- cannot sit unread in a thread they have no reason to open.
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('adm-' || replace(gen_random_uuid()::text, '-', ''),
          v_profile, 'admin_message', v_subject, p_body, '{in_app}', now(), false);
  perform log_admin_action('message', v_profile, v_subject);
end $$;

create or replace function admin_support_close(p_thread_id text, p_closed boolean default true)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update support_threads
     set status = case when p_closed then 'closed' else 'open' end
   where id = p_thread_id;
end $$;

/** How many conversations are waiting on an admin — the sidebar count. */
create or replace function admin_support_waiting()
  returns integer
  language plpgsql stable security definer set search_path = public as $$
declare v int;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  select count(*) into v from support_threads where status = 'open' and unread_for_admin > 0;
  return v;
end $$;

-- ----------------------------------------------------------------------------
-- The person's side.
-- ----------------------------------------------------------------------------
/** My conversation with AutoHire: the open one, or the most recent if none is
    open. Reading it clears my unread count. */
create or replace function my_support_thread()
  returns table (
    id text, subject text, status text, unread_for_user integer,
    message_id text, from_admin boolean, body text, created_at timestamptz
  )
  language plpgsql security definer set search_path = public as $$
declare
  v_id  text;
  v_uid text := nullif(auth.uid()::text, '');
begin
  if v_uid is null then
    return;
  end if;
  select t.id into v_id
    from support_threads t
   where t.profile_id = v_uid
   order by (t.status = 'open') desc, t.last_message_at desc
   limit 1;
  if v_id is null then
    return;
  end if;

  update support_threads set unread_for_user = 0 where support_threads.id = v_id;

  return query
  select t.id, t.subject, t.status, t.unread_for_user,
         m.id, m.from_admin, m.body, m.created_at
    from support_threads t
    left join support_messages m on m.thread_id = t.id
   where t.id = v_id
   order by m.created_at;
end $$;

/** Reply to AutoHire — or start the conversation, when there isn't one yet. */
create or replace function my_support_reply(p_body text, p_subject text default null)
  returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_uid    text := nullif(auth.uid()::text, '');
  v_thread text;
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a message first.';
  end if;
  if length(p_body) > 2000 then
    raise exception 'Keep the message under 2,000 characters.';
  end if;

  v_thread := support_open_thread(v_uid, coalesce(p_subject, 'Message to AutoHire'));
  perform support_append(v_thread, v_uid, false, p_body);
  return v_thread;
end $$;

revoke all on function support_append(text, text, boolean, text) from anon, authenticated;
revoke all on function support_open_thread(text, text) from anon, authenticated;
revoke all on function admin_support_threads(text, text, int, int) from anon;
revoke all on function admin_support_messages(text) from anon;
revoke all on function admin_support_reply(text, text) from anon;
revoke all on function admin_support_close(text, boolean) from anon;
revoke all on function admin_support_waiting() from anon;
revoke all on function my_support_thread() from anon;
revoke all on function my_support_reply(text, text) from anon;
grant execute on function admin_support_threads(text, text, int, int) to authenticated;
grant execute on function admin_support_messages(text) to authenticated;
grant execute on function admin_support_reply(text, text) to authenticated;
grant execute on function admin_support_close(text, boolean) to authenticated;
grant execute on function admin_support_waiting() to authenticated;
grant execute on function my_support_thread() to authenticated;
grant execute on function my_support_reply(text, text) to authenticated;
