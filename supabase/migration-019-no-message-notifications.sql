-- AutoHire migration 019 — keep messages out of the notifications feed.
--
-- Messages already have their own unread badge + chime, so a new message should
-- NOT also create a bell notification. Drop the message_notify trigger; booking
-- and overdue notifications (migrations 016/017) stay.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

drop trigger if exists message_notify on messages;
drop function if exists notify_on_message();
