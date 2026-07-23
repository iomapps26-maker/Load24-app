-- Adds the pieces missing from the identity model: an authoritative roles
-- table (user_profiles.user_type is self-reported at signup, so it can't be
-- trusted for permissions), device registrations for push notifications, and
-- consent records. Identity itself still lives in Supabase's auth.users —
-- these tables extend it rather than replacing it with a custom users table.

-- ============================================================
-- user_roles  (authoritative RBAC — admin-granted, not self-service)
-- ============================================================
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in (
    'admin',
    'sales_executive','sales_team_lead','sales_manager',
    'support_executive','support_manager',
    'accounts_executive','accounts_manager'
  )),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

alter table public.user_roles enable row level security;

create policy "user_roles_select_own_or_admin" on public.user_roles
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );
create policy "user_roles_write_admin_only" on public.user_roles
  for insert with check (
    exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );
create policy "user_roles_update_admin_only" on public.user_roles
  for update using (
    exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );
create policy "user_roles_delete_admin_only" on public.user_roles
  for delete using (
    exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  );

-- has_role() now checks the authoritative table instead of the self-reported
-- user_profiles.user_type, closing the gap where any signed-up user could
-- set their own user_type to 'admin' via POST /api/profile.
create or replace function public.has_role(roles text[]) returns boolean as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(roles)
  );
$$ language sql stable;

-- ============================================================
-- user_devices  (push notification tokens for the mobile app)
-- ============================================================
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  push_token text not null,
  platform text not null check (platform in ('ios','android','web')),
  device_id text,
  app_version text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

create index if not exists user_devices_user_id_idx on public.user_devices (user_id);

alter table public.user_devices enable row level security;

create policy "user_devices_select_own" on public.user_devices
  for select using (user_id = auth.uid());
create policy "user_devices_insert_own" on public.user_devices
  for insert with check (user_id = auth.uid());
create policy "user_devices_update_own" on public.user_devices
  for update using (user_id = auth.uid());
create policy "user_devices_delete_own" on public.user_devices
  for delete using (user_id = auth.uid());

-- ============================================================
-- consents  (terms / privacy / marketing consent records, versioned)
-- ============================================================
create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms_of_service','privacy_policy','marketing_sms','marketing_email')),
  version text not null,
  granted boolean not null default true,
  granted_at timestamptz not null default now(),
  ip_address text,
  unique (user_id, consent_type, version)
);

create index if not exists consents_user_id_idx on public.consents (user_id);

alter table public.consents enable row level security;

create policy "consents_select_own_or_staff" on public.consents
  for select using (
    user_id = auth.uid()
    or public.has_role(array['admin','support_manager'])
  );
create policy "consents_insert_own" on public.consents
  for insert with check (user_id = auth.uid());
