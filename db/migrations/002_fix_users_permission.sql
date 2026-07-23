-- Fixes "permission denied for table users" on posting/updating/deleting loads
-- and liking loads. The original policies queried auth.users directly, but the
-- authenticated role has no SELECT grant on that table. auth.jwt() ->> 'email'
-- reads the email out of the already-verified JWT instead, no table access needed.

drop policy if exists "loads_insert_own" on public.loads;
create policy "loads_insert_own" on public.loads
  for insert with check (
    posted_by = (auth.jwt() ->> 'email')
  );

drop policy if exists "loads_update_own_or_staff" on public.loads;
create policy "loads_update_own_or_staff" on public.loads
  for update using (
    posted_by = (auth.jwt() ->> 'email')
    or public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager'])
  );

drop policy if exists "loads_delete_own_or_admin" on public.loads;
create policy "loads_delete_own_or_admin" on public.loads
  for delete using (
    posted_by = (auth.jwt() ->> 'email')
    or public.has_role(array['admin'])
  );

drop policy if exists "load_likes_select_own_or_staff" on public.load_likes;
create policy "load_likes_select_own_or_staff" on public.load_likes
  for select using (
    liked_by_email = (auth.jwt() ->> 'email')
    or assigned_sales_executive = (auth.jwt() ->> 'email')
    or public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager'])
  );

drop policy if exists "load_likes_insert_own" on public.load_likes;
create policy "load_likes_insert_own" on public.load_likes
  for insert with check (
    liked_by_email = (auth.jwt() ->> 'email')
  );

drop policy if exists "load_likes_delete_own_or_admin" on public.load_likes;
create policy "load_likes_delete_own_or_admin" on public.load_likes
  for delete using (
    liked_by_email = (auth.jwt() ->> 'email')
    or public.has_role(array['admin'])
  );
