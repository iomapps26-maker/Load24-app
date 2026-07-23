-- Business-facing roles selected by users during onboarding (shipper,
-- transporter, broker, vehicle_owner, driver). Kept separate from
-- public.user_roles, which is the admin-granted staff/RBAC table used for
-- internal permissions (sales, support, accounts, admin) — these are two
-- different concerns and must not share an enum or a table.

create table if not exists public.user_business_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in (
    'shipper', 'transporter', 'broker', 'vehicle_owner', 'driver'
  )),
  status text not null default 'active' check (status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create index if not exists user_business_roles_user_id_idx on public.user_business_roles (user_id);

alter table public.user_business_roles enable row level security;

create policy "user_business_roles_select_own_or_staff" on public.user_business_roles
  for select using (
    user_id = auth.uid()
    or public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager'])
  );

create policy "user_business_roles_insert_own" on public.user_business_roles
  for insert with check (user_id = auth.uid());
