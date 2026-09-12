-- AutoHire migration 089 — the same ambiguity, closed everywhere else.
--
-- 088 fixed `admin_support_messages`, where an output column named `id` made a
-- bare `id` in the body ambiguous and every call failed. Three sibling
-- functions in 084 write the same bare `where id = p_thread_id` and work only
-- because they return void, so nothing named `id` is in scope. That is a
-- property of their return type, not of the code, and the next person to give
-- one of them a `returns table` re-creates the bug with no hint in the diff.
--
-- Qualifying them costs nothing and removes the trap. Behaviour is unchanged.
--
-- Apply in the Supabase SQL editor, after 088. Safe to re-run.

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
   where support_threads.id = p_thread_id;
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
  select t.profile_id, t.subject into v_profile, v_subject
    from support_threads t where t.id = p_thread_id;
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
   where support_threads.id = p_thread_id;
end $$;
