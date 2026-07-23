# db/

Postgres schema for the Supabase project, applied by hand via the Supabase
SQL Editor (no migration runner wired up yet).

- `migrations/001_init.sql` — initial schema: `user_profiles`, `loads`,
  `load_likes`, RLS policies, `has_role()` helper.
- `migrations/002_fix_users_permission.sql` — fixes RLS policies that
  queried `auth.users` directly (which the `authenticated` role can't read)
  by switching them to `auth.jwt() ->> 'email'`.

To apply: paste each file's contents into Supabase Dashboard → SQL Editor,
in order, and run. New migrations should follow the same `00N_description.sql`
numbering.
