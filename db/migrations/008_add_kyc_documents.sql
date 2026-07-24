-- KYC document upload service: one kyc_cases row per user (created lazily on
-- first access, kyc_type frozen from user_profiles.user_type at that point
-- so required-document rules don't shift under an in-progress case if the
-- user later changes role), and one kyc_documents row per required document
-- type (see apps/backend/src/lib/kycRequiredDocs.js for the per-role list).
create table if not exists public.kyc_cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  kyc_type text not null check (kyc_type in ('shipper','transporter','broker','truck_owner','driver')),
  status text not null default 'pending' check (status in ('pending','partial','submitted','verified','rejected')),
  rejection_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kyc_documents (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.kyc_cases(id) on delete cascade,
  document_type text not null,
  storage_path text not null,
  file_name text,
  mime_type text,
  uploaded_at timestamptz not null default now(),
  unique (case_id, document_type)
);
create index if not exists kyc_documents_case_id_idx on public.kyc_documents (case_id);

alter table public.kyc_cases enable row level security;
alter table public.kyc_documents enable row level security;

create policy "kyc_cases_select_own_or_staff" on public.kyc_cases
  for select using (
    user_id = auth.uid() or public.has_role(array['admin','support_executive','support_manager'])
  );
create policy "kyc_cases_insert_own" on public.kyc_cases
  for insert with check (user_id = auth.uid());
-- Owner can update their own case (the Express API only ever moves it
-- pending/partial -> submitted this way); staff review sets
-- verified/rejected. Same "owner can update the row, API controls which
-- values it actually sends" trust model as user_profiles_update_own_or_admin
-- in 001_init.sql — full column-level lockdown would need a trigger, which
-- nothing else in this schema does either.
create policy "kyc_cases_update_own" on public.kyc_cases
  for update using (user_id = auth.uid());
create policy "kyc_cases_update_staff" on public.kyc_cases
  for update using (public.has_role(array['admin','support_executive','support_manager']));

create policy "kyc_documents_select_own_or_staff" on public.kyc_documents
  for select using (
    exists (
      select 1 from public.kyc_cases c
      where c.id = case_id
        and (c.user_id = auth.uid() or public.has_role(array['admin','support_executive','support_manager']))
    )
  );
create policy "kyc_documents_insert_own" on public.kyc_documents
  for insert with check (
    exists (select 1 from public.kyc_cases c where c.id = case_id and c.user_id = auth.uid())
  );
create policy "kyc_documents_update_own" on public.kyc_documents
  for update using (
    exists (select 1 from public.kyc_cases c where c.id = case_id and c.user_id = auth.uid())
  );

-- Private bucket (public = false) — objects are only reachable through
-- signed URLs the Express API generates via the service-role client, never
-- listed or served directly.
insert into storage.buckets (id, name, public)
values ('kyc-documents', 'kyc-documents', false)
on conflict (id) do nothing;

-- Object path convention: `${user_id}/${document_type}.${ext}`. Signed
-- upload/download URLs are minted by the service-role client and already
-- scope the exact path server-side, so these policies are a defense-in-depth
-- backstop (e.g. any future direct-client storage access) rather than the
-- primary access control.
create policy "kyc_documents_storage_select_own_or_staff" on storage.objects
  for select using (
    bucket_id = 'kyc-documents'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.has_role(array['admin','support_executive','support_manager']))
  );
create policy "kyc_documents_storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'kyc-documents' and auth.uid()::text = (storage.foldername(name))[1]
  );
create policy "kyc_documents_storage_update_own" on storage.objects
  for update using (
    bucket_id = 'kyc-documents' and auth.uid()::text = (storage.foldername(name))[1]
  );
