-- Adds an expected Unloading Date to loads, alongside the existing
-- loading_date/loading_time — the poster enters it on the Post Load form,
-- and it's shown next to Loading Time on the bidding screen. Optional (like
-- loading_date already is) since it's a new field and older behavior
-- shouldn't suddenly require it.
alter table public.loads
  add column if not exists unloading_date date;
