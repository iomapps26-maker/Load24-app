-- Org hierarchy for internal staff — apps/backend/src/routes/admin/
-- hierarchy.js. Deliberately a column on user_roles (per role assignment),
-- not on user_profiles (per person): a person holding two staff roles
-- (rare, but the schema already allows it — unique(user_id, role) not
-- unique(user_id)) can report to a different manager for each, e.g. a
-- sales_executive role reporting up the sales chain while an
-- accounts_executive role for the same person reports up the accounts
-- chain. References auth.users(id), not user_roles(id): a manager is
-- identified by who they are, not by which specific role row of theirs is
-- "the" manager one.
alter table public.user_roles
  add column if not exists reports_to_user_id uuid references auth.users(id);

create index if not exists user_roles_reports_to_idx on public.user_roles (reports_to_user_id);
