-- MPIN (numeric PIN) login for the mobile app. This is a *local unlock*
-- credential, not a replacement for Supabase Auth: the client still holds a
-- cached Supabase session (see apps/mobile lib/supabase.js), and
-- POST /api/auth/mpin/login just re-verifies the caller's identity against
-- that already-authenticated session instead of re-prompting for a password.
--
-- Failed-attempt/lockout counters are persisted here (rather than relying on
-- the in-memory express-rate-limit window alone) so a lockout survives an
-- API server restart.
alter table public.user_profiles
  add column if not exists mpin_hash text,
  add column if not exists mpin_set_at timestamptz,
  add column if not exists mpin_failed_attempts integer not null default 0,
  add column if not exists mpin_locked_until timestamptz;
