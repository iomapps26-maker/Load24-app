-- Local/dev seed data. Run AFTER migrations 001-003, in the Supabase SQL
-- Editor (needs the service role / postgres connection — inserting into
-- auth.users requires elevated privileges the `authenticated` role doesn't
-- have). Do not run this against production.
--
-- Creates two demo accounts (password for both: "password123"):
--   shipper@load24.test    — posts a load
--   trucker@load24.test    — likes it, and is also granted the admin role
-- plus a device registration and consent record for the trucker.

do $$
declare
  v_shipper_id uuid := gen_random_uuid();
  v_trucker_id uuid := gen_random_uuid();
  v_load_id uuid;
begin
  -- ---- auth.users + auth.identities (email/password sign-in) ----
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values
    (v_shipper_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'shipper@load24.test', crypt('password123', gen_salt('bf')),
     now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    (v_trucker_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'trucker@load24.test', crypt('password123', gen_salt('bf')),
     now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at
  ) values
    (gen_random_uuid(), v_shipper_id, v_shipper_id::text,
     jsonb_build_object('sub', v_shipper_id::text, 'email', 'shipper@load24.test'), 'email', now(), now()),
    (gen_random_uuid(), v_trucker_id, v_trucker_id::text,
     jsonb_build_object('sub', v_trucker_id::text, 'email', 'trucker@load24.test'), 'email', now(), now());

  -- ---- user_profiles ----
  insert into public.user_profiles (user_id, user_email, full_name, mobile, user_type, company_name, city, state, pincode, mobile_verified, kyc_status)
  values
    (v_shipper_id, 'shipper@load24.test', 'Demo Shipper', '9000000001', 'shipper', 'Demo Shipping Co', 'Mumbai', 'Maharashtra', '400001', true, 'verified'),
    (v_trucker_id, 'trucker@load24.test', 'Demo Trucker', '9000000002', 'vehicle_owner', null, 'Pune', 'Maharashtra', '411001', true, 'verified');

  -- ---- user_roles (trucker granted admin for local testing of staff views) ----
  insert into public.user_roles (user_id, role) values (v_trucker_id, 'admin');

  -- ---- loads ----
  insert into public.loads (
    load_id, posted_by, poster_type, company_name,
    loading_pincode, loading_address, loading_city, loading_state,
    unloading_pincode, unloading_address, unloading_city, unloading_state,
    material_type, weight_tons, required_truck_type, bhada_price, status
  ) values (
    'LD-SEED-0001', 'shipper@load24.test', 'shipper', 'Demo Shipping Co',
    '400001', '123 Dock Road', 'Mumbai', 'Maharashtra',
    '411001', '45 Depot Lane', 'Pune', 'Maharashtra',
    'Steel Coils', 12, 'eicher_truck', 25000, 'active'
  ) returning id into v_load_id;

  -- ---- load_likes ----
  insert into public.load_likes (load_id, liked_by_email, liked_by_name, liked_by_mobile, liked_by_type, truck_number, offered_price)
  values (v_load_id, 'trucker@load24.test', 'Demo Trucker', '9000000002', 'vehicle_owner', 'MH12AB1234', 23000);

  -- ---- user_devices ----
  insert into public.user_devices (user_id, push_token, platform, device_id, app_version)
  values (v_trucker_id, 'ExponentPushToken[seed-demo-token]', 'android', 'seed-device-1', '1.0.0');

  -- ---- consents ----
  insert into public.consents (user_id, consent_type, version, granted)
  values
    (v_shipper_id, 'terms_of_service', '1.0', true),
    (v_trucker_id, 'terms_of_service', '1.0', true),
    (v_trucker_id, 'marketing_sms', '1.0', true);
end $$;
