-- AutoHire migration 018 — richer chat: attachments, replies, reactions, delete.
--
-- Adds to messages:
--   attachment_url/_type/_name  — image or file shared in a message
--   reply_to                    — the message this one quotes (set null if gone)
--   reactions                   — emoji -> array of user ids, e.g. {"👍":["u1"]}
-- Plus a DELETE policy (sender removes their own message) and a public
-- `chat-files` storage bucket.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_type text,
  add column if not exists attachment_name text,
  add column if not exists reply_to        text references messages(id) on delete set null,
  add column if not exists reactions       jsonb not null default '{}'::jsonb;

-- Sender can delete their own message. (read/insert/update policies already exist;
-- update is needed for reactions and is allowed for either participant.)
drop policy if exists messages_delete on messages;
create policy messages_delete on messages for delete
  using (sender_id = auth.uid()::text);

-- Storage for chat attachments.
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do update set public = true;

drop policy if exists "chat-files read"   on storage.objects;
drop policy if exists "chat-files write"  on storage.objects;
drop policy if exists "chat-files modify" on storage.objects;
drop policy if exists "chat-files delete" on storage.objects;

create policy "chat-files read" on storage.objects for select
  using (bucket_id = 'chat-files');
create policy "chat-files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "chat-files modify" on storage.objects for update to authenticated
  using (bucket_id = 'chat-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "chat-files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-files' and (storage.foldername(name))[1] = auth.uid()::text);
