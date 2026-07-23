-- Session/device management for the mobile app.
--
-- Logout-all-devices: Supabase access tokens can't be revoked before they
-- expire (only refresh tokens can), so a "log out everywhere" feature can't
-- rely on Supabase alone. Instead we stamp user_profiles.token_valid_after
-- with now() on logout-all; requireAuth compares every token's standard
-- `iat` claim (always present, no custom JWT claims / Auth Hooks needed)
-- against that cutoff and rejects anything issued before it. Refresh tokens
-- are additionally revoked via the Supabase admin API so no *new* access
-- token can be minted on other devices either.
alter table public.user_profiles
  add column if not exists token_valid_after timestamptz;

-- user_devices already exists (see 003_add_roles_devices_consents.sql) for
-- push-notification tokens, but nothing writes to it yet. Repurposing it as
-- the login/session registry too: device_id becomes the identity for "this
-- physical device", separate from push_token (a device checks in on every
-- login but may not have a push token yet).
alter table public.user_devices
  alter column push_token drop not null,
  add column if not exists device_info jsonb,
  add column if not exists ip_address text,
  add column if not exists last_login_at timestamptz;

alter table public.user_devices alter column device_id set not null;

-- ON CONFLICT upserts need a plain (non-partial) unique constraint.
alter table public.user_devices drop constraint if exists user_devices_user_id_push_token_key;
alter table public.user_devices add constraint user_devices_user_id_device_id_key unique (user_id, device_id);
