-- Sales-lead surface for apps/backend/src/routes/admin/crm.js — populated
-- by the scheduled job in lib/matchSuggestions.js (a simple two-signal
-- heuristic, not a rules engine: recent similar bids, or an available
-- truck near the load's pickup point), read via GET /crm/suggestions and
-- acted on by staff manually (nothing here auto-assigns a transporter to a
-- load). unique(load_id, suggested_transporter_id) lets the job upsert on
-- every run instead of accumulating duplicate suggestions each time it fires.
create table if not exists public.match_suggestions (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  suggested_transporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  unique (load_id, suggested_transporter_id)
);

create index if not exists match_suggestions_load_id_idx on public.match_suggestions (load_id);

alter table public.match_suggestions enable row level security;

-- Staff-managed, no user-facing concept of ownership. Scoped to the sales
-- chain named in the spec (sales_executive/team_lead/manager) plus admin,
-- not ADMIN_STAFF_ROLES (admin/support_executive/support_manager) — CRM
-- leads are a sales concern, not a general support/admin one, same
-- reasoning commission_rules_staff_all gives for using its own narrower
-- role set instead of wallet.js's accounts_* roles.
create policy "match_suggestions_staff_all" on public.match_suggestions
  for all using (
    public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager'])
  ) with check (
    public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager'])
  );
