-- Tracks which of the three loading-time reminders (1h before, 20min before,
-- time-reached) have already fired for a confirmed trip, so the in-process
-- sweep job (lib/loadingReminders.js) can tell "already sent" from "not due
-- yet" on every run without re-notifying. Lives on bookings rather than
-- loads: a booking is the one row per confirmed trip (migration 049), and a
-- cancelled/re-posted load shouldn't carry stale reminder state forward.
alter table public.bookings
  add column if not exists loading_reminder_1h_sent_at timestamptz,
  add column if not exists loading_reminder_20m_sent_at timestamptz,
  add column if not exists loading_time_notified_at timestamptz;
