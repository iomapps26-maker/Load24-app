-- Support for the new /api/admin/* route namespace
-- (apps/backend/src/routes/admin/): a staff-assignment column on
-- support_tickets, staff RLS on that table for defense-in-depth (the admin
-- routes themselves read/write through supabaseAdmin, same as every other
-- staff endpoint in this codebase, so RLS isn't the only thing standing
-- between a bug and cross-user data — but every other staff-visible table
-- has this backstop and support_tickets shouldn't be the exception), and a
-- revenue-summing function for GET /api/admin/dashboard (PostgREST
-- aggregate functions — `.select('total:amount.sum()')` — are disabled on
-- this project: `{"code":"PGRST123","message":"Use of aggregate functions
-- is not allowed"}` — so the sum has to happen in a SQL function instead of
-- in a query the REST layer builds).

alter table public.support_tickets
  add column if not exists assigned_to uuid references auth.users(id);

drop policy if exists "support_tickets_select_own_or_staff" on public.support_tickets;
create policy "support_tickets_select_own_or_staff" on public.support_tickets
  for select using (
    user_id = auth.uid()
    or public.has_role(array['admin','support_executive','support_manager'])
  );

drop policy if exists "support_tickets_update_staff" on public.support_tickets;
create policy "support_tickets_update_staff" on public.support_tickets
  for update using (
    public.has_role(array['admin','support_executive','support_manager'])
  );

-- Revenue = the platform's own take (commission + service_charge), not
-- gross money moving through wallets — add_money/withdrawal are user funds
-- passing through, not LOAD24's earnings. Only ever called via the
-- service-role client (see admin/dashboard.js), so execute is revoked from
-- every client-facing role — the total figure itself is sensitive business
-- data, not something an anon/authenticated PostgREST call should be able
-- to read even if a client somehow knew the function name.
create or replace function public.admin_wallet_revenue() returns numeric as $$
  select coalesce(sum(amount), 0)
  from public.wallet_transactions
  where status = 'completed' and type in ('commission', 'service_charge');
$$ language sql stable;

revoke execute on function public.admin_wallet_revenue() from public, anon, authenticated;
