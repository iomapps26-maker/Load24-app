-- Staff-managed incentive rules — apps/backend/src/routes/admin/incentives.js
-- is the CRUD surface; lib/incentiveEvaluation.js's scheduled job (wired
-- into index.js) evaluates active rules against trip data and pays out
-- through applyWalletAdjustment (lib/wallet.js) — the same ledger-write
-- POST /api/wallet/adjust and loadBids.js's commission auto-apply already
-- share, not a second payout path.
--
-- metric is a single value for now ('trips_completed' — see
-- incentiveEvaluation.js for exactly what it means and why it's a lifetime
-- count rather than a calendar-window one) rather than an open list,
-- deliberately: start narrow, widen this constraint (and add a case to
-- incentiveEvaluation.js's METRIC_EVALUATORS) when a second metric is
-- actually needed.
create table if not exists public.incentive_rules (
  id uuid primary key default gen_random_uuid(),
  metric text not null check (metric in ('trips_completed')),
  threshold numeric not null check (threshold > 0),
  reward_amount numeric not null check (reward_amount > 0),
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incentive_rules_active_idx on public.incentive_rules (is_active);

alter table public.incentive_rules enable row level security;

-- Same shape as commission_rules_staff_all (035_add_commission_rules.sql):
-- ADMIN_STAFF_ROLES (admin/support_executive/support_manager), the Phase
-- 1/2 default — the spec named no different role set for incentives.js the
-- way it did for crm.js's sales roles, and rule *configuration* is an admin
-- task even though the payouts themselves move money. Writes always go
-- through supabaseAdmin either way, so this is a defense-in-depth backstop.
create policy "incentive_rules_staff_all" on public.incentive_rules
  for all using (
    public.has_role(array['admin','support_executive','support_manager'])
  ) with check (
    public.has_role(array['admin','support_executive','support_manager'])
  );
