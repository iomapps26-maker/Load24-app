-- In-app notification feed. Rows are written server-side only (via the
-- service-role client, see backend/src/lib/notify.js) at the state-changing
-- events users actually care about — a bid on their load, their bid getting
-- approved/rejected, a wallet credit, a withdrawal status change, etc. There
-- is no client insert policy: a signed-in user can only read/mark-read their
-- own notifications, never create one for themselves or anyone else.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Short machine-readable event key (e.g. 'bid_placed', 'bid_approved',
  -- 'wallet_credited') so the mobile app can pick an icon/deep-link without
  -- parsing the title text.
  type text not null,
  title text not null,
  body text,

  -- Whatever ids the tapped notification needs to deep-link (load_id,
  -- bid_id, withdrawal_id, ...) — free-form per `type` rather than one
  -- column per referenced table.
  data jsonb not null default '{}'::jsonb,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Defensive add: `create table if not exists` above is a no-op if a
-- `notifications` table already exists from some earlier/other source, which
-- would otherwise leave this script trying to index a column that was never
-- added. Covers a legacy `read boolean` column too, migrating it to read_at
-- so the index/policies below always have the column they expect.
alter table public.notifications add column if not exists read_at timestamptz;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'read'
  ) then
    update public.notifications set read_at = coalesce(read_at, now()) where read = true and read_at is null;
    alter table public.notifications drop column read;
  end if;
end $$;

create index if not exists notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_id_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;

-- drop-then-create so this script is safe to re-run — Postgres has no
-- `create policy if not exists` (same convention as 027_add_truck_availabilities.sql).
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());

-- The only client-initiated write: marking your own notification(s) read.
-- Inserts are deliberately not covered by any policy — only the
-- service-role client (which bypasses RLS entirely) creates rows.
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid());
