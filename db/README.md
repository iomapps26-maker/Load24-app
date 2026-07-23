# db/

Postgres schema for the Supabase project, applied by hand via the Supabase
SQL Editor (no migration runner wired up yet).

- `migrations/001_init.sql` — initial schema: `user_profiles`, `loads`,
  `load_likes`, RLS policies, `has_role()` helper.
- `migrations/002_fix_users_permission.sql` — fixes RLS policies that
  queried `auth.users` directly (which the `authenticated` role can't read)
  by switching them to `auth.jwt() ->> 'email'`.
- `migrations/003_add_roles_devices_consents.sql` — adds `user_roles`
  (authoritative, admin-granted RBAC — `user_profiles.user_type` is
  self-reported at signup and can't be trusted for permissions),
  `user_devices` (push tokens for the mobile app), and `consents`
  (versioned terms/privacy/marketing consent records). Also repoints
  `has_role()` at `user_roles` instead of `user_profiles.user_type`.
- `seed.sql` — local/dev seed data: two demo accounts (shipper + trucker),
  a profile, a load, a like, a device, and consent rows. Requires a service
  role connection (inserts into `auth.users`) — never run against production.

To apply: paste each file's contents into Supabase Dashboard → SQL Editor,
in order, and run. New migrations should follow the same `00N_description.sql`
numbering.
