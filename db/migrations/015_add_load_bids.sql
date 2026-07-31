-- Bidding: any user can place a bid amount on a load; only the load's poster
-- can approve/reject it, and only within a 1-minute window from creation —
-- past that the bid is treated as auto-rejected (see loadBids.js for the
-- lazy expiry-on-read check that flips the row, same pattern as the
-- WhatsApp OTP expires_at column in 009_add_whatsapp_otp_login.sql).
create table if not exists public.load_bids (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  bid_by_email text not null,
  bid_by_name text,
  bid_by_mobile text,
  bid_by_type text check (bid_by_type in ('vehicle_owner','transporter','broker')),
  truck_id text,
  truck_number text,
  amount numeric not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 minute'),
  created_at timestamptz not null default now()
);

create index if not exists load_bids_load_id_idx on public.load_bids (load_id);
create index if not exists load_bids_status_idx on public.load_bids (status);

alter table public.load_bids enable row level security;

-- select: the bidder themselves, or the poster of the load being bid on
create policy "load_bids_select_own_or_poster" on public.load_bids
  for select using (
    bid_by_email = (auth.jwt() ->> 'email')
    or exists (
      select 1 from public.loads
      where loads.id = load_bids.load_id
      and loads.posted_by = (auth.jwt() ->> 'email')
    )
    or public.has_role(array['admin'])
  );

create policy "load_bids_insert_own" on public.load_bids
  for insert with check (
    bid_by_email = (auth.jwt() ->> 'email')
  );

-- update: only the poster can approve/reject their own load's bids
create policy "load_bids_update_poster" on public.load_bids
  for update using (
    exists (
      select 1 from public.loads
      where loads.id = load_bids.load_id
      and loads.posted_by = (auth.jwt() ->> 'email')
    )
    or public.has_role(array['admin'])
  );
