-- 054: give the load poster longer than 60 seconds to confirm a bid.
--
-- 015_add_load_bids.sql set load_bids.expires_at to now() + 1 minute: past
-- that, GET /api/load-bids/load/:id auto-rejects the bid and POST /:id/approve
-- 409s it. One minute is far too short for a real person — the poster has to
-- receive the push, open the app, wait on a (often cold-starting) backend, and
-- decide, all before the timer runs out. In practice every bid expired before
-- it could be confirmed, and the mobile Approve button looked like it "did
-- nothing" (the 409 was also being swallowed client-side — fixed separately in
-- SeeBiddingScreen.jsx).
--
-- 10 minutes. Only affects bids placed after this runs; existing rows keep
-- their original expires_at. The security-deposit hold (§5) now rides along
-- for up to 10 min on an unanswered bid instead of 1 — still released the
-- moment the bid is declined, expires, or its trip ends.

alter table public.load_bids
  alter column expires_at set default (now() + interval '10 minutes');
