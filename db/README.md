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
  top-up verification idempotency) live in one place instead of being
  duplicated into RLS.
- `migrations/030_add_pincode_centroids.sql` — `pincode_centroids` reference
  table (~19k Indian pincodes with lat/lng, sourced from GeoNames.org) plus a
  `pincodes_within_radius()` SQL function, used by
  `POST /api/truck-availability` to notify nearby shippers/transporters/
  brokers when a truck is posted as available. Large file (~800KB) — it's
  almost entirely the bulk `insert` of centroid rows.
- `migrations/039_add_audit_log.sql` — `audit_log`, written exclusively by
  `logAction()` (`apps/backend/src/lib/auditLog.js`), called from inside
  `requireRole()` (`apps/backend/src/middleware/requireRole.js`) on every
  staff-gated mutation rather than from each route by hand. Listed via
  `GET /api/admin/audit-log` (`routes/admin/auditLog.js`).
- `migrations/040_add_content_blocks_and_app_versions.sql` — `content_blocks`
  (staff-managed banners/FAQs/config, CRUD in `routes/admin/content.js`) and
  `app_versions` (min/latest supported version per platform). Both are read
  by the mobile app on launch via the single public
  `GET /api/app-config` endpoint — no auth, same as the WhatsApp OTP routes.
- `migrations/041_add_master_data.sql` — `master_data`: staff-managed values
  for closed lists that used to be (or would otherwise become) hardcoded
  arrays in route code — seeded with the `TRUCK_TYPES`/`BODY_TYPES` values
  that were previously hardcoded in `trucks.js` (`fuel_type`/`axle_type`
  stayed hardcoded; out of scope for this pass). CRUD under
  `/api/admin/master-data`; public `GET /api/master-data/:category` is what
  the mobile app and admin site both read instead of a constant.
- `migrations/042_add_wallet_topup_requests.sql` — `wallet_topup_requests`:
  replaces the Razorpay "Add Money" flow with a manual proof-of-payment flow.
  A user requests a top-up (amount + reason category/note), immediately gets
  a `transaction_id`, pays via the static QR/bank details already shown in
  the app, then attaches a screenshot against that same request from
  Transaction History. Staff review the screenshot (`GET
  /api/wallet/topup-requests/pending`) and either verify it — which creates
  the actual `wallet_transactions` row (reusing the same `transaction_id`)
  that credits the wallet — or reject it with a reason. Screenshots live in
  the private `wallet-payment-proofs` Storage bucket, same signed-upload-URL
  pattern as `kyc-documents` (008_add_kyc_documents.sql).
- `seed.sql` — local/dev seed data: two demo accounts (shipper + trucker),
  a profile, a load, a like, a device, and consent rows. Requires a service
  role connection (inserts into `auth.users`) — never run against production.

To apply: paste each file's contents into Supabase Dashboard → SQL Editor,
in order, and run. New migrations should follow the same `00N_description.sql`
numbering.
