-- Payment-proof screenshot on a paid withdrawal. When staff mark a
-- withdrawal_requests row paid (POST /api/wallet/withdrawals/:id/pay) they now
-- attach the bank / UPI transfer receipt; the requesting user sees it in the
-- app's Wallet section next to that withdrawal.
--
-- This is 042_add_wallet_topup_requests.sql's manual-proof flow run in the
-- other direction — staff upload, the row owner views — so it reuses the same
-- private-bucket + service-role-minted signed-URL shape. Nothing here uses
-- multipart; the admin portal PUTs the file straight to Storage via a
-- createSignedUploadUrl() token, same as KYC docs / bank proofs / top-ups.
--
-- Re-runnable.

alter table public.withdrawal_requests
  add column if not exists payment_proof_path text,
  add column if not exists payment_reference text,
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references auth.users(id);

-- Length guard only — the route trims `reference` to 64 chars (routes/wallet.js).
alter table public.withdrawal_requests
  drop constraint if exists withdrawal_requests_payment_reference_len;
alter table public.withdrawal_requests
  add constraint withdrawal_requests_payment_reference_len
  check (payment_reference is null or char_length(payment_reference) <= 64);

-- Private bucket (public = false) — receipts are only ever reachable through
-- short-lived signed URLs minted by the service-role client, same as
-- wallet-payment-proofs / kyc-documents.
insert into storage.buckets (id, name, public)
values ('withdrawal-payment-proofs', 'withdrawal-payment-proofs', false)
on conflict (id) do nothing;

-- Object path convention: `${user_id}/${withdrawal_request_id}.${ext}` — one
-- screenshot per request, a re-upload (while still approved) overwrites it
-- (see routes/wallet.js). Signed upload/view URLs are minted server-side and
-- already scope the exact path, so these policies are a defense-in-depth
-- backstop, same reasoning as wallet_topup_proofs_storage_*. Difference: only
-- staff ever write here (the user is on the receiving end), the owner can read
-- their own.
drop policy if exists "withdrawal_proofs_storage_select_own_or_staff" on storage.objects;
create policy "withdrawal_proofs_storage_select_own_or_staff" on storage.objects
  for select using (
    bucket_id = 'withdrawal-payment-proofs'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
    )
  );
drop policy if exists "withdrawal_proofs_storage_insert_staff" on storage.objects;
create policy "withdrawal_proofs_storage_insert_staff" on storage.objects
  for insert with check (
    bucket_id = 'withdrawal-payment-proofs'
    and public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
  );
drop policy if exists "withdrawal_proofs_storage_update_staff" on storage.objects;
create policy "withdrawal_proofs_storage_update_staff" on storage.objects
  for update using (
    bucket_id = 'withdrawal-payment-proofs'
    and public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
  );
