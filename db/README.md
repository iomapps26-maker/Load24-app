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
- `migrations/043_add_platform_settings.sql` — `platform_settings`: a small
  `key -> jsonb` store for tunable platform-wide values that aren't a
  per-row rule engine (`commission_rules`) or CMS content (`content_blocks`).
  Seeded with the `bidding` key holding `load24_charge_percent` (the headline
  Load24 charge shown to a bidder as a payment breakup on `PlaceBidScreen`)
  and `security_deposit_amount` (default ₹1000 — the amount moved into a
  wallet hold when a bid is placed; see `047_add_bid_security_hold.sql`).
  Read by the app via `GET /api/load-bids/config` and enforced server-side in
  `routes/loadBids.js`'s `POST /`; staff raise or lower either value from the
  admin panel via `PATCH /api/admin/platform-settings/bidding`
  (`routes/admin/platformSettings.js`).
- `migrations/044_add_trip_documents.sql` — `trip_documents`: the E-Way Bill
  and Bilty (lorry receipt) either trip party attaches on the Trip Details
  screen once a bid is approved. One row per `(load_id, document_type)` —
  a re-upload by either side replaces it. Files live in the private
  `trip-documents` Storage bucket, same signed-upload-URL-then-confirm
  pattern as `kyc-documents`; routes are
  `POST /api/load-bids/load/:load_id/documents{,/upload-url}` and the files
  come back (with short-lived signed view URLs) inside
  `GET /api/load-bids/load/:load_id/trip-details` as `trip_documents`.
  Writes go through `supabaseAdmin` after an explicit party check in
  `routes/loadBids.js` (same email-not-user_id constraint as
  `trip_location_pings`), so the table's only RLS policy is a staff read
  backstop.
- `migrations/045_add_load_id_seq_and_bid_pickup.sql` — three bidding-spec
  gaps. (1) `loads.load_id` (the human-readable `LDnnnnnn` id, distinct from
  the uuid PK) has existed since `001_init.sql` but nothing populated it —
  gains a `nextval('loads_load_id_seq')`-based column default and a backfill
  of existing rows. (2) `load_bids.expected_pickup_at` (nullable) — the
  "expected pickup date/time" bid field, collected as an optional date on
  `PlaceBidScreen` and shown on `SeeBidding` / Trip Details. (3)
  `load_bids_insert_own` now also requires the bidder's
  `user_profiles.kyc_status = 'verified'` — bidding is gated to verified
  users (browsing loads stays open); `routes/loadBids.js` `POST /` returns
  the friendly `kyc_verification_required` error, same split as
  `017_prevent_self_bidding.sql`.
- `migrations/046_add_bidding_restrictions.sql` — the two bid-eligibility
  conditions (marketplace spec §2) that had no home: **account active**
  (`user_profiles.is_active`, which existed but never gated bidding) and
  **no active restriction** (new `user_profiles.bidding_restricted_until` /
  `bidding_restriction_reason` — a future timestamp blocks bidding, with the
  reason shown to the user; clearing = set back to `null`). `load_bids_insert_own`
  gains `is_active`, `mobile_verified` and not-restricted checks alongside the
  existing KYC clause; the friendly per-condition error (including the vehicle
  conditions — verified truck, matching type/capacity, unexpired documents —
  which stay route-only) comes from `lib/bidEligibility.js` via
  `routes/loadBids.js` `POST /`. Staff set/clear the account fields via
  `PATCH /api/admin/moderation/users/:userId` (`routes/admin/moderation.js`).
- `migrations/047_add_bid_security_hold.sql` — the ₹1,000 Load Confirmation
  Rule (marketplace spec §5). Placing a bid now moves
  `platform_settings.bidding.security_deposit_amount` into a real **wallet
  hold** — a `security_hold` `wallet_transactions` row (the 014 trigger
  debits it from `wallets.balance`), not just a balance check. It's released
  (`security_release`) automatically when the bid is declined/expires
  (`routes/loadBids.js`) and when the resulting trip is completed
  (`.../deliver`) or cancelled (`routes/admin/trips.js`). New `load_bids`
  columns `security_hold_txn_id` / `security_hold_amount` (snapshot, so a
  later Super-Admin change doesn't retro-alter in-flight holds) /
  `security_hold_released_at` track one hold per bid; the place/release logic
  is `lib/bidSecurityHold.js`, and `GET /api/wallet` gains `held_balance`.
- `migrations/048_prevent_double_booking.sql` — prevent double booking
  (marketplace spec §9). Two guards under `routes/loadBids.js`'s
  `POST /:id/approve` (which now claims the load row `active -> matched` as its
  first write and 409s a losing racer): (1) a **partial unique index**
  `load_bids_one_approved_per_load` on `load_bids (load_id) where status =
  'approved'` — the DB itself allows only one accepted bid per load, so
  concurrent confirmations can't both win (loser gets `23505`); (2)
  `load_bids_insert_own` re-declared with an added `loads.status = 'active'`
  clause so bidding closes the instant a load leaves the active pool (the
  friendly `load_not_active` still comes from `lib/bidEligibility.js`). The
  route also now rejects the losing sibling bids and releases their §5 holds
  the moment one is accepted, rather than waiting on the 1-minute lazy expiry.
- `migrations/049_add_bookings.sql` — `bookings` (marketplace spec §8 "Load
  Confirmation"): the confirmed-trip record, created the moment a load's
  poster confirms the winning bid. One row per approved bid
  (`bookings_bid_id_key`), at most one live one per load
  (`bookings_one_active_per_load` — same rule as
  `load_bids_one_approved_per_load`, migration 048). Carries the booking
  reference `booking_ref` (`BKnnnnnn`, column default off
  `bookings_booking_ref_seq`, same shape as `loads.load_id`), the two party
  emails, the agreed price (= winning bid amount), a §5 hold snapshot, and a
  `status` that follows the trip: `confirmed → in_transit → completed`, or
  `cancelled`. RLS grants **SELECT only** (the two parties + staff); every
  write goes through `supabaseAdmin` via `lib/bookings.js`
  (`createBookingForConfirmedBid` / `ensureBooking` / `completeBookingForLoad`
  / `cancelBookingForLoad`), wired into `routes/loadBids.js`'s
  `POST /:id/approve` (create — best-effort, `trip-details` backfills a
  missing one on read) and `.../deliver` (→ completed), and
  `routes/admin/trips.js`'s cancel (→ cancelled). Returned by
  `POST /:id/approve`, `GET /load/:load_id`, `GET /load/:load_id/trip-details`
  and embedded in `GET /api/load-bids/mine`; listed for staff at
  `GET /api/admin/bookings` (`routes/admin/bookings.js`) and attached to each
  row of `GET /api/admin/trips`. Existing confirmed trips are backfilled with
  a status derived from the load. `POST /:id/approve` also now re-verifies the
  winning bidder's eligibility (`lib/bidEligibility.js`) and that their §5
  security hold is still active *before* it locks the load — spec §8 steps
  2-4, previously only checked at bid-placement time.
- `seed.sql` — local/dev seed data: two demo accounts (shipper + trucker),
  a profile, a load, a like, a device, and consent rows. Requires a service
  role connection (inserts into `auth.users`) — never run against production.

To apply: paste each file's contents into Supabase Dashboard → SQL Editor,
in order, and run. New migrations should follow the same `00N_description.sql`
numbering.
