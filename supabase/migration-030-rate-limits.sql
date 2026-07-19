-- AutoHire migration 030 — server-side rate limiting.
--
-- A tiny fixed-window counter the Edge Functions call to throttle abuse. Used
-- by ai-search (each call costs an Anthropic request) so one user can't run up
-- the bill. Keyed by "<bucket>:<identity>" over a time window.
--
-- Only the service role touches this table (the functions use it); RLS is on
-- with no policies, so the anon/authenticated roles can't read or write it.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (key, window_start)
);

alter table rate_limits enable row level security;

-- Atomically bump the counter for `p_key` in the current window and report
-- whether the caller is still under `p_limit`. `p_window_seconds` sets the
-- window size; returns true when the request is ALLOWED.
create or replace function rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
  language plpgsql security definer set search_path = public as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c integer;
begin
  insert into rate_limits (key, window_start, count)
    values (p_key, w, 1)
  on conflict (key, window_start)
    do update set count = rate_limits.count + 1
  returning count into c;

  -- Opportunistic cleanup of old windows (keeps the table tiny).
  delete from rate_limits where window_start < now() - interval '1 day';

  return c <= p_limit;
end $$;

revoke all on function rate_limit_hit(text, integer, integer) from anon, authenticated;
