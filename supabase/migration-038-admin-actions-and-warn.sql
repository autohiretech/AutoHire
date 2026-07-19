-- AutoHire migration 038 — admin action log + warnings.
--
-- Records every admin action taken on a user (suspend, reinstate, warn,
-- message, verification override) in an append-only admin_actions log, and
-- adds a dedicated "warn" action. Document approve/reject is already recorded
-- in verification_events.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists admin_actions (
  id         bigint generated always as identity primary key,
  admin_id   text,
  target_id  text not null,
  action     text not null,     -- suspend | reinstate | warn | message | verification_override | clear_override
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists admin_actions_target_idx on admin_actions (target_id, created_at desc);

alter table admin_actions enable row level security;
drop policy if exists admin_actions_read on admin_actions;
create policy admin_actions_read on admin_actions for select using (is_admin());

create or replace function log_admin_action(p_action text, p_target text, p_detail text default null)
  returns void
  language sql security definer set search_path = public as $$
  insert into admin_actions (admin_id, target_id, action, detail)
  values (nullif(auth.uid()::text, ''), p_target, p_action, p_detail);
$$;

-- --- Re-define the admin RPCs to record what they did -----------------------

create or replace function admin_set_suspended(p_profile_id text, p_suspended boolean)
  returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  update profiles set suspended = p_suspended where id = p_profile_id;
  perform log_admin_action(case when p_suspended then 'suspend' else 'reinstate' end, p_profile_id);
  return p_suspended;
end $$;

create or replace function admin_send_message(p_profile_id text, p_title text, p_body text)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Message body is required.';
  end if;
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('adm-' || replace(gen_random_uuid()::text, '-', ''),
          p_profile_id, 'message',
          coalesce(nullif(trim(p_title), ''), 'Message from AutoHire'),
          p_body, '{}', now(), false);
  perform log_admin_action('message', p_profile_id, nullif(trim(p_title), ''));
end $$;

create or replace function admin_warn_user(p_profile_id text, p_message text)
  returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  if coalesce(trim(p_message), '') = '' then
    raise exception 'Warning message is required.';
  end if;
  insert into notifications (id, profile_id, kind, title, body, channels, created_at, read)
  values ('adm-' || replace(gen_random_uuid()::text, '-', ''),
          p_profile_id, 'message', 'Warning from AutoHire', p_message, '{}', now(), false);
  perform log_admin_action('warn', p_profile_id, p_message);
end $$;

create or replace function admin_set_verification(
  p_profile_id text,
  p_status     verification_status,
  p_note       text default null
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  perform set_config('app.verification_sync', 'on', true);
  update profiles set verification = p_status, verification_override = true
    where id = p_profile_id;
  perform set_config('app.verification_sync', 'off', true);
  insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
    values (null, p_profile_id, null, 'override', p_status, auth.uid()::text, p_note);
  perform log_admin_action('verification_override', p_profile_id,
                           p_status::text || coalesce(' — ' || p_note, ''));
end $$;

create or replace function admin_clear_verification_override(p_profile_id text)
  returns verification_status
  language plpgsql security definer set search_path = public as $$
declare v verification_status;
begin
  if not is_admin() then
    raise exception 'Admins only.';
  end if;
  v := compute_profile_verification(p_profile_id);
  perform set_config('app.verification_sync', 'on', true);
  update profiles set verification = v, verification_override = false
    where id = p_profile_id;
  perform set_config('app.verification_sync', 'off', true);
  insert into verification_events (document_id, profile_id, doc_type, event, status, actor_id, note)
    values (null, p_profile_id, null, 'updated', v, auth.uid()::text, 'Override cleared');
  perform log_admin_action('clear_override', p_profile_id);
  return v;
end $$;

revoke all on function admin_warn_user(text, text) from anon;
grant execute on function admin_warn_user(text, text) to authenticated;
