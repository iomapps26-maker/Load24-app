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
- `migrations/007_add_mpin.sql` — adds `mpin_hash`/`mpin_set_at`/
  `mpin_failed_attempts`/`mpin_locked_until` to `user_profiles` for the
  MPIN-unlock feature (`POST /api/auth/mpin/set`, `/mpin/login`).
- `migrations/008_add_kyc_documents.sql` — adds `kyc_cases`/`kyc_documents`
  for the KYC document upload service, plus the private `kyc-documents`
  Supabase Storage bucket and its RLS policies. Required-document lists per
  role live in code (`apps/backend/src/lib/kycRequiredDocs.js`), not the DB.
- `migrations/009_add_whatsapp_otp_login.sql` — adds `whatsapp_otp_codes` for
  WhatsApp-based OTP sign-in/sign-up (`POST /api/auth/whatsapp/send-otp`,
  `/verify-otp`). Service-role-only table, no RLS policies.
- `migrations/014_add_wallet.sql` — adds `wallets`, `wallet_transactions`
  (append-only ledger; `apply_wallet_transaction()` trigger derives
  `wallets.balance` from it — nothing ever writes balance directly), and
  `withdrawal_requests` for the staff-approved payout flow. RLS only gates
  reads (own or staff); all writes go through the service-role client in
  `apps/backend/src/routes/wallet.js` so business rules (balance checks,
  Razorpay webhook idempotency) live in one place instead of being
  duplicated into RLS.
- `seed.sql` — local/dev seed data: two demo accounts (shipper + trucker),
  a profile, a load, a like, a device, and consent rows. Requires a service
  role connection (inserts into `auth.users`) — never run against production.

To apply: paste each file's contents into Supabase Dashboard → SQL Editor,
in order, and run. New migrations should follow the same `00N_description.sql`
numbering.
