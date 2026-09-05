-- 057: pull the bid confirmation window back in from 10 minutes to 5.
--
-- 054_extend_bid_confirmation_window.sql widened it from 1 minute (too short
-- for a poster to even open the app) to 10. 10 turned out to be longer than
-- needed and leaves a bid's §5 security-deposit hold tying up the bidder's
-- wallet balance for longer than necessary. 5 minutes is the new middle
-- ground. Only affects bids placed after this runs; existing rows keep their
-- original expires_at. autoRejectExpired / POST /:id/approve already read
-- the column, so no code change beyond comments + the SeeBidding countdown.

alter table public.load_bids
  alter column expires_at set default (now() + interval '5 minutes');
