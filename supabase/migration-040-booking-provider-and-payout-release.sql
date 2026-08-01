-- AutoHire migration 040 — booking provider/escrow + auto-payout on completion.
--
-- Part of the payment-orchestration model:
--   • Each booking records the RAIL that collected it (routed from the car's
--     market — Flutterwave for Africa, Stripe otherwise) and an escrow
--     `hold_status` (funds are 'held' until the trip, then 'released').
--   • When a trip reaches 'completed', escrow is released and a host payout is
--     scheduled automatically, routed to the host's connected method/provider.
--     The actual disbursement (Flutterwave transfer / Stripe payout) is a
--     separate server step that acts on these 'scheduled' rows.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter table bookings add column if not exists provider text
  check (provider in ('stripe', 'flutterwave'));
alter table bookings add column if not exists charge_currency text;
alter table bookings add column if not exists hold_status text
  not null default 'held'
  check (hold_status in ('held', 'released', 'refunded'));

alter table payouts add column if not exists provider text
  check (provider in ('stripe', 'flutterwave'));

-- On completion: release escrow + schedule the host payout exactly once, routed
-- to the host's payout method. Runs BEFORE UPDATE so it can set hold_status on
-- the row without re-triggering itself.
create or replace function release_payout_on_complete()
returns trigger
language plpgsql
security definer
as $$
declare
  pm text;  -- host payout_method  (momo | bank | card)
  pp text;  -- host payout_provider (flutterwave | stripe)
  ch payout_channel;
begin
  if new.state = 'completed' and old.state is distinct from 'completed' then
    new.hold_status := 'released';

    if not exists (select 1 from payouts where booking_id = new.id) then
      select payout_method, payout_provider into pm, pp
        from profiles where id = new.host_id;

      ch := case
              when pm in ('bank', 'card') then 'bank_transfer'::payout_channel
              else 'mtn_momo'::payout_channel
            end;

      -- Host keeps the subtotal; the service fee is AutoHire's margin.
      insert into payouts (id, booking_id, host_id, amount_rwf, channel, status, provider, scheduled_for)
      values ('po-' || new.id, new.id, new.host_id, new.subtotal_rwf, ch, 'scheduled', pp, current_date + 1);
    end if;
  end if;

  return new;
end $$;

drop trigger if exists booking_release_payout on bookings;
create trigger booking_release_payout
  before update on bookings
  for each row execute function release_payout_on_complete();
