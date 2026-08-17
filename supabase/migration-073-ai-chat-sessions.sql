-- AutoHire migration 073 — the AI assistant's chat history moves to the
-- database, off localStorage.
--
-- localStorage survives a refresh but nothing else: a different device, a
-- cleared browser, or two tabs never agree on what the conversation actually
-- is. This table is the source of truth instead; localStorage stays only as
-- an instant-paint cache the client overwrites the moment the real row loads.
--
-- One row per conversation, not one row per message — `turns` is the same
-- JSON shape the client already builds turn-by-turn (query/reply/booking/
-- matches), so there's no message-level schema to keep in sync with the UI's
-- own BotTurn type as it evolves. A renter can have many rows: "start a new
-- chat" is just inserting another one, and "choose an old chat" is picking
-- one from `ai_chat_sessions_list` by profile_id, newest first.
--
-- Apply after migration 072. Safe to re-run.

create table if not exists ai_chat_sessions (
  id text primary key,
  profile_id text not null references profiles(id) on delete cascade,
  -- The client's own BotTurn[] shape, verbatim — including the Listing
  -- snapshots a booking/match embeds. Not normalized: nothing here is ever
  -- queried by field, only loaded whole for one renter's one conversation.
  turns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- "My most recent chats" is the only real query this table serves.
create index if not exists ai_chat_sessions_profile_idx
  on ai_chat_sessions (profile_id, updated_at desc);

alter table ai_chat_sessions enable row level security;

drop policy if exists ai_chat_sessions_select on ai_chat_sessions;
create policy ai_chat_sessions_select on ai_chat_sessions for select
  using (profile_id = auth.uid()::text);

drop policy if exists ai_chat_sessions_insert on ai_chat_sessions;
create policy ai_chat_sessions_insert on ai_chat_sessions for insert
  with check (profile_id = auth.uid()::text);

-- Covers both a normal turn-by-turn save and the upsert `saveChatSession`
-- does client-side — `updated_at` is bumped by the client on every write, not
-- a trigger, since the update already carries the new turns in the same
-- round trip.
drop policy if exists ai_chat_sessions_update on ai_chat_sessions;
create policy ai_chat_sessions_update on ai_chat_sessions for update
  using (profile_id = auth.uid()::text);

drop policy if exists ai_chat_sessions_delete on ai_chat_sessions;
create policy ai_chat_sessions_delete on ai_chat_sessions for delete
  using (profile_id = auth.uid()::text);
