-- AutoHire migration 014 — enable Realtime for live chat & notifications.
--
-- Adds messages, conversations and notifications to the `supabase_realtime`
-- publication so the app receives Postgres-change events (new messages, unread
-- counts, notifications) without polling. RLS still applies to the refetch, so
-- clients only ever see their own rows.
--
-- `replica identity full` so UPDATE/DELETE events carry the full old row (lets
-- the client read conversation_id off deleted messages, etc.).
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table messages      replica identity full;
alter table conversations replica identity full;
alter table notifications replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
