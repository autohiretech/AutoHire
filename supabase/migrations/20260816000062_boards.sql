-- AutoHire migration 062 — boards: collaborative wishlists, and a demand
-- signal no other rental marketplace collects.
--
-- boards sit BESIDE watchlist (migration 043/044), not on top of it — they do
-- different jobs. Watching means "tell me when this frees up" and drives DB
-- triggers that notify a single watcher. A board means "we (a circle, or just
-- me) are considering this" — a shared, editable list, sometimes attached to a
-- date range nobody has committed to yet. Nothing about watchlist changes here.
--
-- The one column that makes this more than a Pinterest board is
-- board_items.target_start / target_end — both nullable, because pinning a car
-- must never require committing to a week. When it IS filled in, it becomes
-- forward-looking demand: `listing_demand` aggregates it per car per start
-- date, which is what lets a host dashboard eventually say "4 people are
-- considering this excavator for the week of 8 Sept" — a signal no rental
-- platform currently surfaces, because everyone else only learns about demand
-- once it converts into a booking or doesn't.
--
-- Apply after migration 061. Safe to re-run.

create table if not exists boards (
  id         text primary key,
  title      text not null,
  created_by text not null references profiles(id) on delete cascade,
  -- Null = a personal board. Set = the whole circle can edit it.
  circle_id  text references circles(id) on delete set null,
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists board_items (
  board_id     text not null references boards(id) on delete cascade,
  listing_id   text not null references listings(id) on delete cascade,
  added_by     text not null references profiles(id) on delete cascade,
  note         text,
  target_start date,
  target_end   date,
  created_at   timestamptz not null default now(),
  primary key (board_id, listing_id)
);

create index if not exists board_items_listing_idx on board_items (listing_id);

alter table boards enable row level security;
alter table board_items enable row level security;

-- boards: visible if public, yours, or your circle's. Only the creator (or a
-- circle owner, for a circle board) may rename/delete it; anyone who can see
-- it may pin to it via board_items below — a shared board's whole point is
-- that members add to it without asking.
drop policy if exists boards_read on boards;
create policy boards_read on boards for select using (
  is_public
  or created_by = auth.uid()::text
  or (circle_id is not null and is_circle_member(circle_id))
  or is_admin()
);
drop policy if exists boards_insert on boards;
create policy boards_insert on boards for insert
  with check (
    created_by = auth.uid()::text
    and (circle_id is null or is_circle_member(circle_id))
  );
drop policy if exists boards_update on boards;
create policy boards_update on boards for update
  using (created_by = auth.uid()::text or (circle_id is not null and is_circle_owner(circle_id)))
  with check (created_by = auth.uid()::text or (circle_id is not null and is_circle_owner(circle_id)));
drop policy if exists boards_delete on boards;
create policy boards_delete on boards for delete
  using (created_by = auth.uid()::text or (circle_id is not null and is_circle_owner(circle_id)));

-- board_items: read follows the board; write requires being able to see the
-- board (a personal board is yours alone since only you can see it; a circle
-- board is open to every member — that's the collaboration). Removing a pin
-- is restricted to whoever added it, or the board's owner cleaning up.
drop policy if exists board_items_read on board_items;
create policy board_items_read on board_items for select using (
  exists (
    select 1 from boards b where b.id = board_items.board_id and (
      b.is_public
      or b.created_by = auth.uid()::text
      or (b.circle_id is not null and is_circle_member(b.circle_id))
      or is_admin()
    )
  )
);
drop policy if exists board_items_insert on board_items;
create policy board_items_insert on board_items for insert
  with check (
    added_by = auth.uid()::text
    and exists (
      select 1 from boards b where b.id = board_items.board_id and (
        b.created_by = auth.uid()::text
        or (b.circle_id is not null and is_circle_member(b.circle_id))
      )
    )
  );
drop policy if exists board_items_delete on board_items;
create policy board_items_delete on board_items for delete
  using (
    added_by = auth.uid()::text
    or exists (
      select 1 from boards b where b.id = board_items.board_id and (
        b.created_by = auth.uid()::text
        or (b.circle_id is not null and is_circle_owner(b.circle_id))
      )
    )
  );

-- Forward-looking interest per car per start date. security_invoker keeps the
-- CALLER's RLS in force (board_items_read), rather than the view owner's —
-- so this view can never show a date somebody pinned to a board you can't see.
create or replace view listing_demand
  with (security_invoker = on) as
  select listing_id, target_start, count(distinct added_by) as interested
  from board_items
  where target_start is not null and target_start >= current_date
  group by listing_id, target_start;

-- ----------------------------------------------------------------------------
-- "A car was pinned to <board>"
-- ----------------------------------------------------------------------------
create or replace function board_item_notify() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  b_title    text;
  b_circle   text;
  adder_name text;
  car_title  text;
  recipient  text;
begin
  if new.added_by like 'demo-%' then
    return new;
  end if;

  select title, circle_id into b_title, b_circle from boards where id = new.board_id;
  if b_circle is null then
    -- Personal board: nobody else to tell.
    return new;
  end if;

  select full_name into adder_name from profiles where id = new.added_by;
  select title into car_title from listings where id = new.listing_id;

  for recipient in
    select profile_id from circle_members
    where circle_id = b_circle and status = 'active' and profile_id <> new.added_by
  loop
    insert into notifications (id, profile_id, kind, title, body, channels, created_at, link)
    values (
      'ntf-board-' || substr(md5(new.board_id || new.listing_id || recipient || clock_timestamp()::text), 1, 16),
      recipient,
      'board_activity',
      coalesce(adder_name, 'Someone') || ' pinned a car to ' || coalesce(b_title, 'a board'),
      coalesce(car_title, ''),
      '{in_app}',
      now(),
      '/boards/' || new.board_id
    );
  end loop;
  return new;
end $$;

drop trigger if exists board_item_notify_trigger on board_items;
create trigger board_item_notify_trigger after insert on board_items
  for each row execute function board_item_notify();
