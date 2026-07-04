-- AutoHire migration 021 — AI Mode conversation history.
--
-- Persists the AI Mode ("smart renting with AI") chat so a user's prompts and
-- answers survive refreshes and appear in the History panel. OPTIONAL: AI Mode
-- works without these tables — it keeps history in memory for the session only
-- (web/src/components/marketplace/AiMode.tsx). Apply this migration only when
-- you want persistent, per-user history.
--
--   ai_conversations  — one chat session per row (title = the first prompt)
--   ai_messages       — one turn per row: the user's query + the AI's answer,
--                       the interpreted filters, and the matched car ids
--
-- The "AI" itself is a local demo (web/src/lib/demoAi.ts) — these tables only
-- store its output; nothing here calls a model. Swapping in a real API later
-- does not change this schema.
--
-- Note on listing_ids: it stores references, so a re-opened answer reflects the
-- cars as they exist now (edited/deleted ones drop out). If you want the
-- transcript frozen exactly as answered, store a jsonb snapshot instead.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists ai_conversations (
  id          text primary key,
  user_id     text not null references profiles(id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists ai_messages (
  id               text primary key,
  conversation_id  text not null references ai_conversations(id) on delete cascade,
  query            text not null,        -- what the user asked
  thought          text,                 -- the "thought process" line
  summary          text,                 -- the generated answer text
  filters          jsonb not null default '{}'::jsonb,  -- interpreted ListingFilters
  listing_ids      text[] not null default '{}',        -- matched listing ids
  created_at       timestamptz not null default now()
);

create index if not exists ai_conversations_user_idx
  on ai_conversations (user_id, updated_at desc);
create index if not exists ai_messages_conversation_idx
  on ai_messages (conversation_id, created_at);

alter table ai_conversations enable row level security;
alter table ai_messages       enable row level security;

-- Each user reads/writes only their own conversations…
drop policy if exists ai_conversations_rw on ai_conversations;
create policy ai_conversations_rw on ai_conversations for all
  using (user_id = auth.uid()::text)
  with check (user_id = auth.uid()::text);

-- …and only messages inside a conversation they own.
drop policy if exists ai_messages_rw on ai_messages;
create policy ai_messages_rw on ai_messages for all
  using (exists (
    select 1 from ai_conversations c
    where c.id = ai_messages.conversation_id and c.user_id = auth.uid()::text
  ))
  with check (exists (
    select 1 from ai_conversations c
    where c.id = ai_messages.conversation_id and c.user_id = auth.uid()::text
  ));
