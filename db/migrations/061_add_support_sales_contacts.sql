-- Support & sales contact directories: two independent rosters of
-- contact-info-only records (name/phone/email — no auth.users row, no
-- login), each app user permanently and evenly auto-assigned to exactly one
-- row of each roster.
--
-- NOT the same concept as the sales_executive/sales_team_lead/sales_manager/
-- support_executive/support_manager values in public.user_roles (real staff
-- login roles used for CRM/bid-review authorization elsewhere, e.g.
-- routes/loadBids.js's BID_REVIEW_STAFF_ROLES). To keep that distinction
-- obvious at the schema level, nothing here is named *_executive or
-- *_manager — "roster" signals a plain contact directory, not a role.
--
-- support_contact_roster assignment is permanent per user, but only ever
-- SURFACED on a trip's details page while that trip is active (a booking
-- exists and status <> 'cancelled' — same predicate as lib/bookings.js's
-- getBookingByLoadId). sales_contact_roster assignment is permanent per user
-- and surfaced generally in the app's Profile -> Support area, unrelated to
-- any trip.
--
-- All writes go through supabaseAdmin (service-role, bypasses RLS) exactly
-- like master_data / wallets — RLS below is defense-in-depth on reads only.
-- The only writers of the two assignment tables are the
-- assign_support_contact() / assign_sales_contact() functions below, called
-- via supabaseAdmin.rpc(...) from apps/backend/src/lib/contactAssignment.js
-- — never client-side.

create table if not exists public.support_contact_roster (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  is_active boolean not null default true,
  -- Denormalized count of user_support_contact rows pointing at this contact
  -- — maintained only by assign_support_contact() below, never touched
  -- directly by the admin CRUD routes. Lets both the least-loaded pick and
  -- the admin "assigned users" column stay O(1) instead of a COUNT(*) join.
  assigned_count integer not null default 0 check (assigned_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_contact_roster (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  is_active boolean not null default true,
  assigned_count integer not null default 0 check (assigned_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One permanent row per user per roster. support_contact_id/sales_contact_id
-- deliberately have NO "on delete cascade" — deleting a roster row must not
-- silently orphan/erase a user's permanent assignment; a contact with any
-- assignments can't be hard-deleted at all (23503 — see the admin routes'
-- assigned_count pre-check for the friendlier 409), only deactivated
-- (is_active = false).

create table if not exists public.user_support_contact (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  support_contact_id uuid not null references public.support_contact_roster(id),
  assigned_at timestamptz not null default now()
);
create index if not exists user_support_contact_contact_idx on public.user_support_contact (support_contact_id);

create table if not exists public.user_sales_contact (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  sales_contact_id uuid not null references public.sales_contact_roster(id),
  assigned_at timestamptz not null default now()
);
create index if not exists user_sales_contact_contact_idx on public.user_sales_contact (sales_contact_id);

-- ---- Round-robin assignment -------------------------------------------
--
-- Idempotent get-or-assign, safe under concurrency:
--  1. Already assigned? Return the existing row.
--  2. Otherwise take a per-user advisory lock so two concurrent first-time
--     calls for the SAME user can't each claim a different contact and race
--     the unique(user_id) insert — the loser would otherwise leave a
--     dangling assigned_count increment on a contact the user never actually
--     got assigned to. Different users hash to different lock keys and never
--     block each other; a hashtext collision between two different users
--     just serializes their first assignment, still correct.
--  3. Re-check after acquiring the lock (the call queued behind us may have
--     just assigned this exact user).
--  4. Atomically claim the least-loaded active contact: the subquery's
--     FOR UPDATE SKIP LOCKED locks exactly one candidate row before the
--     outer UPDATE claims it in the same statement — a concurrent pick for a
--     DIFFERENT user racing for the same least-loaded row skips over it
--     (doesn't block on it) and claims the next-least-loaded one instead, so
--     N concurrent first-time assignments for N different users fan out
--     across the N least-loaded contacts correctly.
--  5. Insert the permanent assignment, return the contact.
--
-- Not SECURITY DEFINER: both are only ever called via supabaseAdmin.rpc(...)
-- (service_role, already bypasses RLS entirely).

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
      update public.support_contact_roster
      set assigned_count = assigned_count + 1, updated_at = now()
      where id = (
        select scr.id
        from public.support_contact_roster scr
        where scr.is_active = true
        order by scr.assigned_count asc, scr.id asc
        for update skip locked
        limit 1
      )
      returning support_contact_roster.id into v_contact_id;

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

-- Sales twin — identical shape against sales_contact_roster /
-- user_sales_contact. The 'sales:' prefix on the advisory lock key keeps
-- support and sales first-assignments for the same user_id from contending
-- on the same advisory lock key for no reason.

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
      update public.sales_contact_roster
      set assigned_count = assigned_count + 1, updated_at = now()
      where id = (
        select scr.id
        from public.sales_contact_roster scr
        where scr.is_active = true
        order by scr.assigned_count asc, scr.id asc
        for update skip locked
        limit 1
      )
      returning sales_contact_roster.id into v_contact_id;

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

-- ---- RLS ---------------------------------------------------------------
--
-- Reads only — all writes are supabaseAdmin from
-- apps/backend/src/routes/admin/supportContacts.js /
-- apps/backend/src/routes/admin/salesContacts.js, or the two functions
-- above. No INSERT/UPDATE/DELETE policy on any of the four tables.

alter table public.support_contact_roster enable row level security;
alter table public.sales_contact_roster enable row level security;
alter table public.user_support_contact enable row level security;
alter table public.user_sales_contact enable row level security;

drop policy if exists "support_contact_roster_select_staff" on public.support_contact_roster;
create policy "support_contact_roster_select_staff" on public.support_contact_roster
  for select using (public.has_role(array['admin', 'support_executive', 'support_manager']));

drop policy if exists "sales_contact_roster_select_staff" on public.sales_contact_roster;
create policy "sales_contact_roster_select_staff" on public.sales_contact_roster
  for select using (public.has_role(array['admin', 'sales_executive', 'sales_team_lead', 'sales_manager']));

drop policy if exists "user_support_contact_select_own_or_staff" on public.user_support_contact;
create policy "user_support_contact_select_own_or_staff" on public.user_support_contact
  for select using (
    user_id = auth.uid()
    or public.has_role(array['admin', 'support_executive', 'support_manager'])
  );

drop policy if exists "user_sales_contact_select_own_or_staff" on public.user_sales_contact;
create policy "user_sales_contact_select_own_or_staff" on public.user_sales_contact
  for select using (
    user_id = auth.uid()
    or public.has_role(array['admin', 'sales_executive', 'sales_team_lead', 'sales_manager'])
  );
