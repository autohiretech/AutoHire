-- AutoHire migration — ai-agent sessions & turns.
--
-- Backs the new supabase/functions/ai-agent tool-calling loop (replacing
-- ai-search's single-shot call): one row per conversation in `ai_sessions`,
-- one row per turn (user, assistant, or a bare tool-execution marker — see
-- below) in `ai_turns`. Deliberately separate from `ai_chat_sessions`
-- (migration 073, `20260817000001`) rather than replacing it — that table is
-- ai-search's whole-conversation-as-one-JSON-blob shape for a UI that's still
-- live; this one is normalized per-turn because the agent loop needs to
-- reconstruct exact model/tool history, not just replay a transcript.
--
-- `profiles.id` is `text`, not `uuid` (see migration 073's own
-- `ai_chat_sessions.profile_id text`) — `user_id`/`auth.uid()` comparisons
-- here match that, cast via `auth.uid()::text`.
--
-- `ai_turns.confirm_jti` is the one column beyond the four the design calls
-- for (id, session_id, role, content, tool_log, created_at): it's the
-- one-time-use marker for a `money`/`destructive` tool's confirm token
-- (see confirm.ts + loop.ts). A `role = 'tool'` row with a `confirm_jti` and
-- otherwise-empty content/tool_log is written the instant a confirmed
-- tool finishes running — before the turn's own assistant-role row — purely
-- so a reused token has something to collide with (the unique index) even if
-- the request fails or is retried before that assistant row is written.
--
-- Safe to re-run.

create table if not exists ai_sessions (
  id text primary key,
  user_id text not null references profiles(id) on delete cascade,
  -- What the client was looking at when the session started — mirrors
  -- context.route / context.filters off the request; kept loosely in sync by
  -- the function on every apply_filters action so "resume this chat" can
  -- restore the search the renter was mid-way through.
  route text,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_sessions_user_idx on ai_sessions (user_id, updated_at desc);

alter table ai_sessions enable row level security;

drop policy if exists ai_sessions_select on ai_sessions;
create policy ai_sessions_select on ai_sessions for select
  using (user_id = auth.uid()::text);

drop policy if exists ai_sessions_insert on ai_sessions;
create policy ai_sessions_insert on ai_sessions for insert
  with check (user_id = auth.uid()::text);

drop policy if exists ai_sessions_update on ai_sessions;
create policy ai_sessions_update on ai_sessions for update
  using (user_id = auth.uid()::text);

drop policy if exists ai_sessions_delete on ai_sessions;
create policy ai_sessions_delete on ai_sessions for delete
  using (user_id = auth.uid()::text);

create table if not exists ai_turns (
  id text primary key,
  session_id text not null references ai_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  -- 'user': { text, confirmed }. 'assistant': { text, chips, actions }.
  -- 'tool': {} — see the confirm_jti note above; this role exists only for
  -- that marker row.
  content jsonb not null default '{}'::jsonb,
  -- Every tool call the turn made: [{ tool, input, result?, error?,
  -- confirmJti? }, ...]. Empty for a plain user turn.
  tool_log jsonb not null default '[]'::jsonb,
  -- One-time-use guard for a confirm token's `jti` — see loop.ts's
  -- TokenLedger. Unique (not primary key: most rows have it null, and a
  -- partial unique index is the standard way to allow that while still
  -- rejecting a real collision).
  confirm_jti text,
  created_at timestamptz not null default now()
);

create index if not exists ai_turns_session_idx on ai_turns (session_id, created_at);

create unique index if not exists ai_turns_confirm_jti_key
  on ai_turns (confirm_jti) where confirm_jti is not null;

alter table ai_turns enable row level security;

-- No direct user_id column on ai_turns — ownership is via the parent
-- session, same pattern circle_members/board_items use for a child table.
drop policy if exists ai_turns_select on ai_turns;
create policy ai_turns_select on ai_turns for select
  using (exists (select 1 from ai_sessions s where s.id = ai_turns.session_id and s.user_id = auth.uid()::text));

drop policy if exists ai_turns_insert on ai_turns;
create policy ai_turns_insert on ai_turns for insert
  with check (exists (select 1 from ai_sessions s where s.id = ai_turns.session_id and s.user_id = auth.uid()::text));
