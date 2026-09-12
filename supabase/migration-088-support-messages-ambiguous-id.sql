-- AutoHire migration 088 — the admin can actually read a conversation.
--
-- `admin_support_messages` returns a table whose first output column is `id`,
-- and its body then ran `update support_threads set unread_for_admin = 0 where
-- id = p_thread_id`. Inside a plpgsql function that output column is a
-- variable, so `id` there is ambiguous: every call failed with 42702 and the
-- admin's Messages screen drew a conversation with no messages in it — the
-- error never reached the screen, so it looked like an empty thread rather
-- than a broken read.
--
-- Qualifying the column is the whole fix. The equivalent update in
-- `my_support_thread` was already written `support_threads.id = v_id`, which
-- is why the renter side worked.
--
-- Apply in the Supabase SQL editor, after 084. Safe to re-run.

create or replace function admin_support_messages(p_thread_id text)
  returns table (id text, sender_id text, from_admin boolean, body text, created_at timestamptz)
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update support_threads set unread_for_admin = 0 where support_threads.id = p_thread_id;
  return query
  select m.id, m.sender_id, m.from_admin, m.body, m.created_at
    from support_messages m
   where m.thread_id = p_thread_id
   order by m.created_at;
end $$;
