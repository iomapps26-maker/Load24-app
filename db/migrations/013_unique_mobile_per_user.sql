-- Enforces one mobile number per account. Without this, the same phone
-- number could be attached to multiple user_profiles rows (e.g. one person
-- signing up as both a shipper and a transporter with the same number),
-- which breaks "contact this person" flows that assume mobile identifies a
-- single account. Application code (apps/backend/src/routes/profile.js)
-- normalizes to E.164 (+91XXXXXXXXXX) before insert/update and checks this
-- constraint proactively to return a friendly error instead of a raw 23505.
update public.user_profiles
set mobile = '+91' || right(regexp_replace(mobile, '\D', '', 'g'), 10)
where mobile !~ '^\+91[6-9][0-9]{9}$'
  and right(regexp_replace(mobile, '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$';

alter table public.user_profiles
  add constraint user_profiles_mobile_unique unique (mobile);
