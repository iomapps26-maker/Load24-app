-- Staff-managed commission rules — apps/backend/src/routes/admin/
-- commissionRules.js is the CRUD surface; loadBids.js's deliver route looks
-- one up automatically when a trip completes and applies it as the same
-- 'commission' wallet adjustment type POST /api/wallet/adjust already
-- supports manually (ADJUSTABLE_TYPES, wallet.js). material_type/
-- vehicle_type are both nullable wildcards — null means "applies
-- regardless" for that dimension; the most specific matching active rule
-- wins (see loadBids.js's findMatchingCommissionRule).
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  material_type text,
  vehicle_type text,
  rate_percent numeric not null check (rate_percent > 0 and rate_percent <= 100),
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commission_rules_active_idx on public.commission_rules (is_active);

alter table public.commission_rules enable row level security;

-- Entirely staff-managed, no user-facing concept of ownership — matches
-- notification_templates_staff_all's shape (034_add_notification_
-- templates.sql). Writes always go through supabaseAdmin (both the CRUD
-- routes and the auto-apply lookup in loadBids.js), so this is a
-- defense-in-depth backstop, not the primary access control. Scoped to the
-- same three roles that gate /api/admin/* itself (admin/support_executive/
-- support_manager) rather than also including wallet.js's accounts_*
-- roles — commission_rules is administered through the Phase 1/2 admin
-- surface, not the accounts-specific withdrawal-payout one.
create policy "commission_rules_staff_all" on public.commission_rules
  for all using (
    public.has_role(array['admin','support_executive','support_manager'])
  ) with check (
    public.has_role(array['admin','support_executive','support_manager'])
  );
