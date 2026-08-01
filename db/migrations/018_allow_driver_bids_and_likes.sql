-- Drivers are a valid onboarding role (ProfileSetupScreen.jsx ROLES) and use
-- the same "Find Loads" screen as vehicle owners/transporters/brokers to bid
-- on and like loads, but load_bids_bid_by_type_check and
-- load_likes_liked_by_type_check never included 'driver' — so every bid or
-- like placed by a driver hit the check constraint and failed with a generic
-- "Could not place your bid" / like error. Same class of bug 012 fixed for
-- 'truck_owner' vs 'vehicle_owner'.
alter table public.load_bids drop constraint load_bids_bid_by_type_check;
alter table public.load_bids add constraint load_bids_bid_by_type_check
  check (bid_by_type in ('vehicle_owner','transporter','broker','driver'));

alter table public.load_likes drop constraint load_likes_liked_by_type_check;
alter table public.load_likes add constraint load_likes_liked_by_type_check
  check (liked_by_type in ('vehicle_owner','transporter','broker','driver'));
