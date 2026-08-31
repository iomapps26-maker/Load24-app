-- Bookings (marketplace spec §8 "Load Confirmation"). A booking is the
-- confirmed-trip record created the moment a load's poster confirms the
-- winning bid: it carries the booking reference (BKnnnnnn — the id both
-- parties and LOAD24 support quote for the trip), the agreed price, and a
-- status that follows the trip through to a terminal 'completed' /
-- 'cancelled'.
--
-- The bid and the load already model "who won" and "is the load locked";
-- bookings is the single row that represents the *agreement* between the two
-- parties and its lifecycle, so anything trip-level (support, disputes,
-- reporting, the mobile trip card, the admin trip list) has one thing to key
-- on instead of re-deriving it from loads + load_bids every time.
--
-- One booking per approved bid (bookings_bid_id_key); at most one live
-- booking per load (bookings_one_active_per_load) — the same
-- one-accepted-bid-per-load rule as load_bids_one_approved_per_load
-- (migration 048), and like that constraint a cancelled booking is left in
-- place (nothing re-lists a cancelled load today).
--
-- All writes go through the service-role client (routes/loadBids.js,
-- routes/admin/trips.js, lib/bookings.js) — the RLS policy below only grants
-- SELECT, to the two parties and staff — same trust model as the wallet and
-- trip_documents modules (migrations 014 / 044).

create sequence if not exists public.bookings_booking_ref_seq;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  -- BKnnnnnn, zero-padded to 6 digits for alignment/sortability (grows past
  -- 6 once the sequence gets there) — same shape as loads.load_id
  -- (migration 045). Every booking needs one at insert, so unlike a
  -- pending-vs-approved bid this is a plain column default.
  booking_ref text not null unique
    default 'BK' || lpad(nextval('public.bookings_booking_ref_seq')::text, 6, '0'),
  load_id uuid not null references public.loads(id) on delete cascade,
  bid_id uuid not null unique references public.load_bids(id) on delete cascade,
  -- The two parties, by email (loads.posted_by / load_bids.bid_by_email are
  -- emails, not user_ids — same identity model the trip-details / deliver /
  -- location-ping routes already work in).
  poster_email text not null,
  accepter_email text not null,
  -- The agreed price = the winning bid amount (loads.bhada_price is only the
  -- original ask).
  amount numeric not null check (amount > 0),
  status text not null default 'confirmed'
    check (status in ('confirmed', 'in_transit', 'completed', 'cancelled')),
  -- Snapshot of the §5 security hold the winning bid carried in (migration
  -- 047) — for reference/reporting; the hold itself stays tracked on
  -- load_bids and is released by lib/bidSecurityHold.js as before.
  security_hold_txn_id uuid references public.wallet_transactions(id),
  security_hold_amount numeric check (security_hold_amount is null or security_hold_amount >= 0),
  confirmed_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now()
);

create index if not exists bookings_load_id_idx on public.bookings (load_id);
create index if not exists bookings_status_idx on public.bookings (status);
create index if not exists bookings_poster_email_idx on public.bookings (poster_email);
create index if not exists bookings_accepter_email_idx on public.bookings (accepter_email);

-- At most one non-cancelled booking per load.
create unique index if not exists bookings_one_active_per_load
  on public.bookings (load_id)
  where status <> 'cancelled';

-- ---- Backfill: one booking per already-confirmed trip ---------------------
--
-- Every load that currently has an approved bid gets a booking, its status
-- derived from where the load ended up. Oldest confirmation gets the lowest
-- reference (by the bid's reviewed_at, then created_at).

with confirmed as (
  select
    l.id  as load_id,
    l.status as load_status,
    l.posted_by,
    b.id  as bid_id,
    b.bid_by_email,
    b.amount,
    b.security_hold_txn_id,
    b.security_hold_amount,
    coalesce(b.reviewed_at, b.created_at) as confirmed_at,
    row_number() over (order by coalesce(b.reviewed_at, b.created_at), b.id) as n
  from public.loads l
  join public.load_bids b on b.load_id = l.id and b.status = 'approved'
)
insert into public.bookings (
  booking_ref, load_id, bid_id, poster_email, accepter_email, amount, status,
  security_hold_txn_id, security_hold_amount, confirmed_at, completed_at, cancelled_at
)
select
  'BK' || lpad(c.n::text, 6, '0'),
  c.load_id, c.bid_id, c.posted_by, c.bid_by_email, c.amount,
  case c.load_status
    when 'completed' then 'completed'
    when 'cancelled' then 'cancelled'
    when 'in_transit' then 'in_transit'
    else 'confirmed'
  end,
  c.security_hold_txn_id, c.security_hold_amount, c.confirmed_at,
  case when c.load_status = 'completed' then c.confirmed_at end,
  case when c.load_status = 'cancelled' then c.confirmed_at end
from confirmed c
on conflict do nothing;

-- Continue the run just past the highest number the backfill handed out
-- (is_called = false -> the next nextval returns exactly this value).
select setval(
  'public.bookings_booking_ref_seq',
  coalesce((select count(*) from public.bookings), 0) + 1,
  false
);

-- ---- RLS: the two parties + staff can read; nobody writes via the API key -

alter table public.bookings enable row level security;

-- drop-then-create (Postgres has no `create policy if not exists`) so this
-- script is safe to re-run.
drop policy if exists "bookings_select_parties_or_staff" on public.bookings;
create policy "bookings_select_parties_or_staff" on public.bookings
  for select using (
    poster_email = (auth.jwt() ->> 'email')
    or accepter_email = (auth.jwt() ->> 'email')
    or public.has_role(array['admin'])
  );
