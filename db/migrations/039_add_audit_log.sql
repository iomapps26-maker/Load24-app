-- Staff mutation audit trail. Populated exclusively by logAction()
-- (apps/backend/src/lib/auditLog.js), called from inside requireRole()
-- itself (apps/backend/src/middleware/requireRole.js) rather than from each
-- route by hand — requireRole is the one choke point every staff mutation
-- already passes through (both the router-level app.use(...,
-- requireRole(...), someAdminRouter) mounts in index.js and the per-route
-- requireRole(STAFF_ROLES) calls in trucks.js/wallet.js), so nothing can
-- ship ungated by accident the way a per-route log call could be forgotten.
--
-- target_table/target_id are best-effort, not foreign keys: requireRole has
-- no fixed knowledge of which resource a given mutation touches (it's
-- generic middleware reused across a dozen unrelated route files), so both
-- are derived heuristically from the request path rather than looked up
-- against a real schema — see lib/auditLog.js. target_id is text rather
-- than uuid for the same reason: not every route's :id param is a UUID.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,
  target_table text,
  target_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_log_actor_user_id_idx on public.audit_log (actor_user_id);
create index if not exists audit_log_action_idx on public.audit_log (action);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

-- Read-only from the API's perspective (GET /api/admin/audit-log,
-- auditLog.js) — every write goes through logAction()'s supabaseAdmin
-- client, which bypasses RLS entirely, so no insert policy is needed here.
-- Same three roles that gate /api/admin/* generally (ADMIN_STAFF_ROLES in
-- index.js), matching commission_rules_staff_all/incentive_rules_staff_all's
-- shape.
create policy "audit_log_staff_select" on public.audit_log
  for select using (
    public.has_role(array['admin','support_executive','support_manager'])
  );
