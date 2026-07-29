-- Location capture for transporter KYC (address + GPS pin) — replaces the
-- earlier plan of treating "location" as a document photo upload. Stored on
-- kyc_cases (one location per case) rather than kyc_documents since it isn't
-- a file. See apps/backend/src/lib/kycRequiredDocs.js (KYC_REQUIRES_LOCATION)
-- for which roles this applies to.
alter table public.kyc_cases
  add column if not exists location_address text,
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision,
  add column if not exists location_captured_at timestamptz;
