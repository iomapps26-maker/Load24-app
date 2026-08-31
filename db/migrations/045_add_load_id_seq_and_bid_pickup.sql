-- Closes three gaps against the load-posting / bidding spec:
--
--  1. loads.load_id — a human-readable "Load ID" separate from the uuid PK —
--     has existed since 001_init.sql but nothing ever populated it (POST
--     /api/loads just inserts the request body). Give it a DB-side default
--     so every load gets one atomically, even on a direct insert, and
--     backfill the rows already in the table. Format: LD000123, zero-padded
--     to 6 digits for alignment/sortability; it just grows past 6 once the
--     sequence gets there.
--
--  2. load_bids.expected_pickup_at — one of the bid fields the marketplace
--     spec calls for, previously not captured anywhere. Nullable: existing
--     bid history predates it and the mobile bid screen leaves it optional.
--
--  3. load_bids_insert_own RLS — bidding is now restricted to KYC-verified
--     users (browsing loads stays open to any authenticated user). The
--     Express route (routes/loadBids.js POST /) returns the friendly error;
--     this policy is the real enforcement boundary, same split as
--     017_prevent_self_bidding.sql.

-- ---- 1. Sequential Load ID -------------------------------------------------

create sequence if not exists public.loads_load_id_seq;
alter sequence public.loads_load_id_seq owned by public.loads.load_id;

-- Backfill: oldest load gets the lowest number. Offset by any rows that
-- already carry a load_id (e.g. the 'LD-SEED-0001' row from seed.sql) so the
-- generated 'LDnnnnnn' values can't collide with them.
with ordered as (
  select
    id,
    row_number() over (order by created_at, id)
      + coalesce((select count(*) from public.loads where load_id is not null), 0) as n
  from public.loads
  where load_id is null
)
update public.loads l
set load_id = 'LD' || lpad(ordered.n::text, 6, '0')
from ordered
where ordered.id = l.id;

-- Point the sequence just past the highest number handed out so the next
-- insert continues the run (is_called = false -> nextval returns exactly this).
select setval(
  'public.loads_load_id_seq',
  coalesce((select count(*) from public.loads), 0) + 1,
  false
);

alter table public.loads
  alter column load_id set default 'LD' || lpad(nextval('public.loads_load_id_seq')::text, 6, '0'),
  alter column load_id set not null;

-- ---- 2. Expected pickup date/time on a bid --------------------------------

alter table public.load_bids
  add column if not exists expected_pickup_at timestamptz;

-- ---- 3. Bidding requires KYC verification --------------------------------

drop policy "load_bids_insert_own" on public.load_bids;

create policy "load_bids_insert_own" on public.load_bids
  for insert with check (
    bid_by_email = (auth.jwt() ->> 'email')
    and not exists (
      select 1 from public.loads
      where loads.id = load_bids.load_id
      and loads.posted_by = (auth.jwt() ->> 'email')
    )
    and exists (
      select 1 from public.user_profiles
      where user_profiles.user_id = auth.uid()
      and user_profiles.kyc_status = 'verified'
    )
  );
