-- Replaces the Razorpay "Add Money" flow with a manual proof-of-payment flow:
-- user requests a top-up (amount + reason), gets a transaction_id and pays
-- via the existing static QR/bank details shown in the app, then attaches a
-- screenshot against that same transaction_id. Staff review the screenshot
-- and either verify it (which is the only thing that ever credits the
-- wallet — via a real wallet_transactions row, same trigger-driven balance
-- update every other credit already uses) or reject it. Mirrors kyc_cases'
-- lazy-create + signed-upload-URL + staff-queue shape (008_add_kyc_documents.sql)
-- rather than inventing a new pattern.
create table if not exists public.wallet_topup_requests (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  amount numeric not null check (amount > 0),
  reason_category text not null check (reason_category in ('security_fee', 'service_charge', 'load_payment', 'other')),
  reason_note text,
  proof_storage_path text,
  proof_uploaded_at timestamptz,
  status text not null default 'awaiting_payment' check (
    status in ('awaiting_payment', 'pending_verification', 'verified', 'rejected')
  ),
  rejection_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  -- Set once verified — the actual ledger row that credited the wallet.
  -- wallet_transactions.transaction_id is deliberately the *same* string as
  -- this row's transaction_id (one ID the user sees end-to-end), not a
  -- separately generated one.
  wallet_transaction_id uuid references public.wallet_transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wallet_topup_requests_user_id_idx on public.wallet_topup_requests (user_id);
create index if not exists wallet_topup_requests_status_idx on public.wallet_topup_requests (status);

alter table public.wallet_topup_requests enable row level security;

create policy "wallet_topup_requests_select_own_or_staff" on public.wallet_topup_requests
  for select using (
    user_id = auth.uid() or public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
  );

-- Private bucket (public = false) — screenshots are only ever reachable
-- through short-lived signed URLs minted by the service-role client, same as
-- kyc-documents.
insert into storage.buckets (id, name, public)
values ('wallet-payment-proofs', 'wallet-payment-proofs', false)
on conflict (id) do nothing;

-- Object path convention: `${user_id}/${topup_request_id}.${ext}` — one
-- screenshot per request, re-uploads overwrite it (see routes/wallet.js).
-- Signed upload/view URLs are minted server-side and already scope the exact
-- path, so these are a defense-in-depth backstop, same reasoning as
-- kyc_documents_storage_* policies.
create policy "wallet_topup_proofs_storage_select_own_or_staff" on storage.objects
  for select using (
    bucket_id = 'wallet-payment-proofs'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.has_role(array['admin','support_executive','support_manager','accounts_executive','accounts_manager'])
    )
  );
create policy "wallet_topup_proofs_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'wallet-payment-proofs' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "wallet_topup_proofs_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'wallet-payment-proofs' and auth.uid()::text = (storage.foldername(name))[1]
  );
