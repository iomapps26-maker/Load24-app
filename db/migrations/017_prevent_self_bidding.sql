-- A load's poster must not be able to bid on their own load — the API
-- (loadBids.js POST /) already blocks this with a friendly error, but RLS
-- is the real enforcement boundary so a direct insert can't bypass it.
drop policy "load_bids_insert_own" on public.load_bids;

create policy "load_bids_insert_own" on public.load_bids
  for insert with check (
    bid_by_email = (auth.jwt() ->> 'email')
    and not exists (
      select 1 from public.loads
      where loads.id = load_bids.load_id
      and loads.posted_by = (auth.jwt() ->> 'email')
    )
  );
