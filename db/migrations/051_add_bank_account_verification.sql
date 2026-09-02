-- Payout bank-account verification for the admin portal (/admin/bank-accounts).
-- Staff review the payout bank account a user submitted in the mobile app and
-- mark it verified or rejected; the result flows back to the app's Profile
-- screen (Pending / Verified / Rejected badge, rejection reason + re-submit).
--
-- Mirrors the KYC review flow (008_add_kyc_documents.sql / routes/kyc.js):
-- same staff role gate, same audit trail (via requireRole -> logAction), same
-- private-bucket + short-lived-signed-URL pattern for the proof image.
--
-- Reuses the existing bank_details table (006_add_profile_features.sql) rather
-- than a new bank_accounts table — it is already the single per-user store the
-- withdrawal flow (routes/wallet.js) snapshots into withdrawal_requests.bank_*.
-- This migration adds the review columns and replaces the old boolean
-- `verified` / `verified_at` pair with a three-state `verification_status`
-- matching kyc_cases.status.
--
-- Every `create policy` is drop-then-create (Postgres has no
-- `create policy if not exists`) so this script is safe to re-run.

alter table public.bank_details
  add column if not exists bank_branch text,
  add column if not exists account_type text check (account_type in ('savings', 'current')),
  add column if not exists proof_path text,
  add column if not exists verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected')),
  add column if not exists rejection_reason text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

-- Carry the old boolean across before dropping it, then drop it. Wrapped in a
-- guard so the script stays re-runnable once `verified` is already gone.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bank_details' and column_name = 'verified'
  ) then
    update public.bank_details
      set verification_status = 'verified',
          reviewed_at = coalesce(verified_at, now())
      where verified is true;
    alter table public.bank_details drop column verified;
    alter table public.bank_details drop column verified_at;
  end if;
end $$;

create index if not exists bank_details_verification_status_idx
  on public.bank_details (verification_status, created_at);

-- Staff (same three roles as KYC review) can read every account and update the
-- review columns. The Express API actually does this through the service-role
-- client (routes/bankAccounts.js), so these are a backstop for any direct
-- client access — same reasoning as kyc_cases_update_staff.
drop policy if exists "bank_details_select_staff" on public.bank_details;
create policy "bank_details_select_staff" on public.bank_details
  for select using (public.has_role(array['admin', 'support_executive', 'support_manager']));

drop policy if exists "bank_details_update_staff" on public.bank_details;
create policy "bank_details_update_staff" on public.bank_details
  for update using (public.has_role(array['admin', 'support_executive', 'support_manager']));

-- Private bucket (public = false) — the cancelled cheque / passbook image is
-- only ever reachable through the short-lived signed URLs the Express API mints
-- via the service-role client, same as kyc-documents / trip-documents.
insert into storage.buckets (id, name, public)
values ('bank-account-proofs', 'bank-account-proofs', false)
on conflict (id) do nothing;

-- Object path convention: `${user_id}/proof.${ext}` — one proof per user,
-- keyed by the uploader so the `foldername[1] = auth.uid()` backstop holds.
-- Signed upload/view URLs are minted server-side and already scope the exact
-- path, so these policies are defense-in-depth, same as kyc_documents_storage_*.
drop policy if exists "bank_account_proofs_storage_select_own_or_staff" on storage.objects;
create policy "bank_account_proofs_storage_select_own_or_staff" on storage.objects
  for select using (
    bucket_id = 'bank-account-proofs'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.has_role(array['admin', 'support_executive', 'support_manager'])
    )
  );
drop policy if exists "bank_account_proofs_storage_insert_own" on storage.objects;
create policy "bank_account_proofs_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'bank-account-proofs' and auth.uid()::text = (storage.foldername(name))[1]
  );
drop policy if exists "bank_account_proofs_storage_update_own" on storage.objects;
create policy "bank_account_proofs_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'bank-account-proofs' and auth.uid()::text = (storage.foldername(name))[1]
  );
