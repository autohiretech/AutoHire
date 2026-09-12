-- AutoHire migration 087 — listing the AutoHire conversation is not reading it.
--
-- `my_support_thread` cleared the reader's unread count as a side effect, which
-- was right when the only caller was the notification that opened it. The
-- Messages list now draws a row for the same thread, and that call must leave
-- the count alone or the unread dot disappears before anyone has read
-- anything.
--
-- The old zero-argument version is dropped rather than left beside this one:
-- a default argument plus a same-named zero-arg function is ambiguous, and
-- `my_support_thread()` would stop resolving.
--
-- Apply in the Supabase SQL editor, after 084. Safe to re-run.

drop function if exists my_support_thread();

/** My conversation with AutoHire: the open one, or the most recent if none is
    open. Reading it clears my unread count. */
create or replace function my_support_thread(p_mark_read boolean default true)
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

  -- Reading the thread is what clears it. The Messages list asks for the
  -- same thread just to draw a row, and that must not count as reading:
  -- without this the unread dot vanished the moment the list rendered, so
  -- a reply from an admin was marked read by nobody looking at it.
  if p_mark_read then
    update support_threads set unread_for_user = 0 where support_threads.id = v_id;
  end if;

  return query
  select t.id, t.subject, t.status, t.unread_for_user,
         m.id, m.from_admin, m.body, m.created_at
    from support_threads t
    left join support_messages m on m.thread_id = t.id
   where t.id = v_id
   order by m.created_at;
end $$;

revoke all on function my_support_thread(boolean) from anon;
grant execute on function my_support_thread(boolean) to authenticated;
