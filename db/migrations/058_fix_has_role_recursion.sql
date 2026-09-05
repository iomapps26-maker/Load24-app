-- Fix infinite RLS recursion on user_roles / has_role() (SQLSTATE 42P17).
--
-- 003_add_roles_devices_consents.sql's four user_roles policies inline
-- "exists (select 1 from public.user_roles r where r.user_id = auth.uid()
-- and r.role = 'admin')" directly in a policy ON user_roles itself.
-- Evaluating that subquery is itself a query against user_roles, which
-- re-triggers the very same policy, which re-runs the same subquery —
-- Postgres detects the cycle and raises "infinite recursion detected in
-- policy for relation user_roles".
--
-- has_role() (003) is no better on its own: it queries user_roles directly
-- as a plain (non-SECURITY DEFINER) function, so calling it from ANY other
-- table's policy — loads, load_bids, kyc_documents, wallets, trucks, the
-- kyc-documents Storage bucket, all over the app — re-enters user_roles'
-- own recursive policy the same way, whenever that code path runs on a
-- caller-scoped (req.supabase) client rather than the service-role client.
-- Confirmed live: KYC document upload ("infinite recursion detected in
-- policy for relation \"user_roles\"") — and the same class of unexplained
-- 400 on bid placement / bid approval is almost certainly this too, since
-- both write through loads/load_bids policies that call has_role().
--
-- Fix: has_role() becomes SECURITY DEFINER, so its internal query against
-- user_roles runs as the function's owner and bypasses RLS entirely instead
-- of re-entering it. SET search_path is pinned per Postgres's own guidance
-- for SECURITY DEFINER functions — an unpinned search_path is hijackable by
-- anyone who can create objects earlier on the caller's path.
--
-- user_roles' own four policies get the same recursive subquery replaced
-- with public.has_role(array['admin']) — safe now that has_role() itself no
-- longer re-triggers RLS on the table it reads.

create or replace function public.has_role(roles text[]) returns boolean as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = any(roles)
  );
$$ language sql stable security definer set search_path = public;

drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
create policy "user_roles_select_own_or_admin" on public.user_roles
  for select using (
    user_id = auth.uid()
    or public.has_role(array['admin'])
  );

drop policy if exists "user_roles_write_admin_only" on public.user_roles;
create policy "user_roles_write_admin_only" on public.user_roles
  for insert with check (public.has_role(array['admin']));

drop policy if exists "user_roles_update_admin_only" on public.user_roles;
create policy "user_roles_update_admin_only" on public.user_roles
  for update using (public.has_role(array['admin']));

drop policy if exists "user_roles_delete_admin_only" on public.user_roles;
create policy "user_roles_delete_admin_only" on public.user_roles
  for delete using (public.has_role(array['admin']));
