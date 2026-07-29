-- Consolidate the duplicate "truck owner" / "vehicle owner" role into a
-- single value, 'vehicle_owner'. The mobile role picker (ProfileSetupScreen)
-- already sent 'vehicle_owner' while every check constraint here still only
-- allowed 'truck_owner', so anyone picking that role hit
-- user_profiles_user_type_check on save. Standardizing on 'vehicle_owner'
-- since that's what the frontend already sends.

-- Constraints must be dropped before the data is updated — the old
-- constraints only allow 'truck_owner', so updating rows to 'vehicle_owner'
-- while they're still in effect fails the same check we're trying to fix.
alter table public.user_profiles drop constraint user_profiles_user_type_check;
alter table public.load_likes drop constraint load_likes_liked_by_type_check;
alter table public.kyc_cases drop constraint kyc_cases_kyc_type_check;

update public.user_profiles set user_type = 'vehicle_owner' where user_type = 'truck_owner';
update public.load_likes set liked_by_type = 'vehicle_owner' where liked_by_type = 'truck_owner';
update public.kyc_cases set kyc_type = 'vehicle_owner' where kyc_type = 'truck_owner';

alter table public.user_profiles add constraint user_profiles_user_type_check check (user_type in (
  'shipper','transporter','broker','vehicle_owner','driver',
  'sales_executive','sales_team_lead','sales_manager',
  'support_executive','support_manager',
  'accounts_executive','accounts_manager','admin'
));

alter table public.load_likes add constraint load_likes_liked_by_type_check
  check (liked_by_type in ('vehicle_owner','transporter','broker'));

alter table public.kyc_cases add constraint kyc_cases_kyc_type_check
  check (kyc_type in ('shipper','transporter','broker','vehicle_owner','driver'));
