-- AutoHire migration 079 — a notification kind for messages the admin sends.
--
-- `admin_send_message` / `admin_warn_user` (038) and `admin_notify_people`
-- (078) all wrote `kind = 'message'`. That is the kind migration 015's trigger
-- uses for a new CHAT message, and the in-app list hides it on purpose
-- (`.neq('kind', 'message')`) because chat carries its own unread badge. So
-- every admin message, warning and broadcast was written to a row nobody could
-- ever see.
--
-- The value lands in its own migration because Postgres refuses to USE a new
-- enum label in the transaction that adds it, and 080 both writes it and
-- backfills the rows already sent.
--
-- Apply in the Supabase SQL editor. Safe to re-run.

alter type notification_kind add value if not exists 'admin_message';
