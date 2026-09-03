-- 053: stop load_bids.bid_by_type / load_likes.liked_by_type CHECK constraints
-- from rejecting valid users.
--
-- This constraint has already broken bidding twice: 016 (it still allowed the
-- pre-rename 'truck_owner') and 018 (it was missing 'driver'). Every time it
-- hard-codes a snapshot of user_profiles.user_type, and user_type keeps
-- drifting. 'shipper' was never in the list at all — so a shipper who reaches
-- PlaceBidScreen (a WhatsApp "Bid" deep link, or the Find Loads tab) places a
-- bid, clears every eligibility check, and then the INSERT dies on
-- load_bids_bid_by_type_check with the opaque "Could not place your bid".
--
-- bid_by_type / liked_by_type are denormalized copies of the actor's
-- self-reported role, kept only to label a row on the poster's "See Bidding"
-- screen. They gate nothing. The real boundaries are the load_bids_insert_own /
-- load_likes RLS policies and lib/bidEligibility.js. Drop the checks; keep the
-- columns and their existing values.

alter table public.load_bids  drop constraint if exists load_bids_bid_by_type_check;
alter table public.load_likes drop constraint if exists load_likes_liked_by_type_check;
