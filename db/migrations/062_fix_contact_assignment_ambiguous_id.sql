-- Fix assign_support_contact() / assign_sales_contact() (migration 061):
-- both raised 42702 "column reference \"id\" is ambiguous" on every call,
-- so every assignment silently failed (caught and swallowed by the route
-- handlers' .catch(), which is why the app degraded to the hardcoded
-- fallback instead of erroring) and assigned_count never moved off 0.
--
-- Root cause: `returns table (id uuid, name text, phone text, email text)`
-- implicitly declares `id` as a PL/pgSQL variable in scope for the whole
-- function body. The `update ... where id = (...)` below is unqualified,
-- so Postgres can't tell whether `id` means that variable or the
-- roster table's own `id` column. Fix: qualify it as scr.id (aliasing the
-- outer update target, not just the subquery) like every other column
-- reference in the same statement already does.

create or replace function public.assign_support_contact(p_user_id uuid)
returns table (id uuid, name text, phone text, email text)
language plpgsql
as $$
declare
  v_contact_id uuid;
begin
  select support_contact_id into v_contact_id
  from public.user_support_contact
  where user_id = p_user_id;

  if v_contact_id is null then
    perform pg_advisory_xact_lock(hashtext(p_user_id::text));

    select support_contact_id into v_contact_id
    from public.user_support_contact
    where user_id = p_user_id;

    if v_contact_id is null then
      update public.support_contact_roster scr
      set assigned_count = scr.assigned_count + 1, updated_at = now()
      where scr.id = (
        select scr2.id
        from public.support_contact_roster scr2
        where scr2.is_active = true
        order by scr2.assigned_count asc, scr2.id asc
        for update skip locked
        limit 1
      )
      returning scr.id into v_contact_id;

      if v_contact_id is null then
        raise exception 'No active support contacts configured';
      end if;

      insert into public.user_support_contact (user_id, support_contact_id)
      values (p_user_id, v_contact_id);
    end if;
  end if;

  return query
    select scr.id, scr.name, scr.phone, scr.email
    from public.support_contact_roster scr
    where scr.id = v_contact_id;
end;
$$;

create or replace function public.assign_sales_contact(p_user_id uuid)
returns table (id uuid, name text, phone text, email text)
language plpgsql
as $$
declare
  v_contact_id uuid;
begin
  select sales_contact_id into v_contact_id
  from public.user_sales_contact
  where user_id = p_user_id;

  if v_contact_id is null then
    perform pg_advisory_xact_lock(hashtext('sales:' || p_user_id::text));

    select sales_contact_id into v_contact_id
    from public.user_sales_contact
    where user_id = p_user_id;

    if v_contact_id is null then
      update public.sales_contact_roster scr
      set assigned_count = scr.assigned_count + 1, updated_at = now()
      where scr.id = (
        select scr2.id
        from public.sales_contact_roster scr2
        where scr2.is_active = true
        order by scr2.assigned_count asc, scr2.id asc
        for update skip locked
        limit 1
      )
      returning scr.id into v_contact_id;

      if v_contact_id is null then
        raise exception 'No active sales contacts configured';
      end if;

      insert into public.user_sales_contact (user_id, sales_contact_id)
      values (p_user_id, v_contact_id);
    end if;
  end if;

  return query
    select scr.id, scr.name, scr.phone, scr.email
    from public.sales_contact_roster scr
    where scr.id = v_contact_id;
end;
$$;
