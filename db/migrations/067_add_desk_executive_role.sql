-- desk_executive: a staff role that can only use the Executive Desk
-- (/api/executive — see EXECUTIVE_DESK_ROLES in apps/backend/src/index.js).
-- Executive logins created on the admin Staff Logins page
-- (routes/admin/staffAccounts.js) get this role instead of
-- support_executive, which also opens the whole /api/admin/* namespace
-- and the staff-only KYC / bank / truck / wallet review endpoints.
-- Existing support_executive holders keep their admin access.
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check check (role in (
  'admin',
  'sales_executive','sales_team_lead','sales_manager',
  'support_executive','support_manager',
  'accounts_executive','accounts_manager',
  'desk_executive'
));
