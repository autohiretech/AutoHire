-- AutoHire migration 058 — notification kinds for the social layer.
--
-- The social layer (follows, circles, boards, trip posts, companions) needs to
-- reach people through the notification rails that already exist — the
-- `notifications` table, its channel badges, the realtime subscription from
-- migration 014, and the deep links from migration 052. None of that needs
-- changing. It only needs new values on `notification_kind`.
--
-- This ships ALONE, before every other social migration, for a Postgres
-- reason rather than a product one: `alter type ... add value` may run inside
-- a transaction, but the new value cannot be USED by that same transaction.
-- A single file that both added 'social_follow' and inserted a notification
-- with it would fail on the insert. Splitting it means every later migration —
-- and every Edge Function — can reference these freely.
--
-- Nothing else in this file. No table, no policy, no trigger.
--
-- Apply after migration 057. Safe to re-run.

-- Someone followed you. (One-way graph — there is nothing to accept.)
alter type notification_kind add value if not exists 'social_follow';

-- You were invited into a circle, or someone you invited has joined.
alter type notification_kind add value if not exists 'circle_invite';

-- A car was pinned to, or removed from, a board you're on.
alter type notification_kind add value if not exists 'board_activity';

-- You were added to someone's trip as a companion. Carries no money — see
-- migration 063; the organizer stays the sole payer and sole liable driver.
alter type notification_kind add value if not exists 'trip_companion';

-- A host you follow posted an announcement or a limited-time offer.
alter type notification_kind add value if not exists 'host_broadcast';
