-- 015_add_load_bids.sql's check constraint still allowed the old
-- 'truck_owner' role value instead of 'vehicle_owner' (renamed in
-- 012_rename_truck_owner_to_vehicle_owner.sql) — the same bug 012 already
-- fixed for user_profiles/load_likes/kyc_cases. Vehicle owners are the
-- primary bidder role in this marketplace, so every bid they placed hit
-- load_bids_bid_by_type_check and failed.
alter table public.load_bids drop constraint load_bids_bid_by_type_check;

update public.load_bids set bid_by_type = 'vehicle_owner' where bid_by_type = 'truck_owner';

alter table public.load_bids add constraint load_bids_bid_by_type_check
  check (bid_by_type in ('vehicle_owner','transporter','broker'));
