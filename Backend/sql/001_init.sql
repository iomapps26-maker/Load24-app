-- LOAD24 Supabase schema (vertical slice: auth, user_profiles, loads, load_likes)
-- Auth itself is handled by Supabase Auth (auth.users). These tables extend it.
-- Run this in the Supabase SQL editor, or via `supabase db push`.

create extension if not exists "pgcrypto";

-- ============================================================
-- user_profiles  (mirrors base44/entities/UserProfile.jsonc)
-- ============================================================
create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  user_email text,
  full_name text,
  mobile text not null,
  user_type text not null check (user_type in (
    'shipper','transporter','broker','truck_owner','driver',
    'sales_executive','sales_team_lead','sales_manager',
    'support_executive','support_manager',
    'accounts_executive','accounts_manager','admin'
  )),
  company_name text,
  company_address text,
  city text,
  state text,
  pincode text,
  gst_number text,
  gst_verified boolean not null default false,
  gst_verification_status text not null default 'pending' check (gst_verification_status in ('pending','verified','rejected')),
  mobile_verified boolean not null default false,
  kyc_status text not null default 'pending' check (kyc_status in ('pending','partial','submitted','verified','rejected')),
  trust_score numeric not null default 50,
  total_deals integer not null default 0,
  completed_deals integer not null default 0,
  is_active boolean not null default true,
  language_preference text not null default 'hi' check (language_preference in ('en','hi')),
  assigned_sales_executive text,
  rating_score numeric not null default 0 check (rating_score between 0 and 5),
  total_ratings integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- loads  (mirrors base44/entities/Load.jsonc)
-- ============================================================
create table if not exists public.loads (
  id uuid primary key default gen_random_uuid(),
  load_id text unique,
  posted_by text not null,          -- email of poster
  poster_type text check (poster_type in ('shipper','transporter','broker')),
  company_name text,
  loading_pincode text not null,
  loading_address text not null,
  loading_landmark text,
  loading_city text,
  loading_state text,
  loading_lat double precision,
  loading_lng double precision,
  unloading_pincode text not null,
  unloading_address text not null,
  unloading_landmark text,
  unloading_city text,
  unloading_state text,
  unloading_lat double precision,
  unloading_lng double precision,
  material_type text not null,
  weight_tons numeric not null,
  required_truck_type text not null check (required_truck_type in (
    'mahindra_pickup','tata_407','tata_ace','chota_hathi','four_vehicle_loader',
    'eicher_truck','ashok_leyland','lcv','lgv','open_body','closed_body',
    'container','trailer','tanker','tipper','flatbed','car_carrier'
  )),
  truck_length_ft numeric,
  loading_poc_name text,
  loading_poc_mobile text,
  unloading_poc_name text,
  unloading_poc_mobile text,
  bhada_price numeric not null,
  fuel_type_required text check (fuel_type_required in ('diesel','cng','electric','any')),
  axle_type text check (axle_type in ('single_axle','multi_axle','any')),
  body_type text check (body_type in ('open','closed','container','any')),
  special_conditions text[],
  special_demand_comment text,
  custom_requirement text,
  loading_date date,
  loading_time text,
  status text not null default 'active' check (status in ('active','matched','in_transit','completed','cancelled','expired')),
  likes_count integer not null default 0,
  distance_km numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loads_status_idx on public.loads (status);
create index if not exists loads_created_idx on public.loads (created_at desc);

-- ============================================================
-- load_likes  (mirrors base44/entities/LoadLike.jsonc)
-- ============================================================
create table if not exists public.load_likes (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  liked_by_email text not null,
  liked_by_name text,
  liked_by_mobile text,
  liked_by_type text check (liked_by_type in ('truck_owner','transporter','broker')),
  truck_id text,
  truck_number text,
  offered_price numeric,
  voice_note_url text,
  assigned_sales_executive text,
  status text not null default 'new' check (status in ('new','contacted','negotiating','accepted','rejected','cancelled')),
  sales_notes text,
  call_status text not null default 'pending' check (call_status in ('pending','called','busy','no_answer','completed')),
  last_call_time timestamptz,
  created_at timestamptz not null default now(),
  unique (load_id, liked_by_email)
);

-- Keep loads.likes_count in sync
create or replace function public.sync_load_likes_count() returns trigger as $$
begin
  if (tg_op = 'INSERT') then
    update public.loads set likes_count = likes_count + 1 where id = new.load_id;
  elsif (tg_op = 'DELETE') then
    update public.loads set likes_count = greatest(likes_count - 1, 0) where id = old.load_id;
  end if;
  return null;
end;
$$ language plpgsql;

drop trigger if exists trg_load_likes_count on public.load_likes;
create trigger trg_load_likes_count
after insert or delete on public.load_likes
for each row execute function public.sync_load_likes_count();

-- ============================================================
-- Row Level Security  (mirrors the rls blocks in base44/entities/*.jsonc)
-- ============================================================
alter table public.user_profiles enable row level security;
alter table public.loads enable row level security;
alter table public.load_likes enable row level security;

-- Helper: does the caller's profile have one of these roles?
create or replace function public.has_role(roles text[]) returns boolean as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = auth.uid() and user_type = any(roles)
  );
$$ language sql stable;

-- user_profiles policies
create policy "user_profiles_select_own_or_staff" on public.user_profiles
  for select using (
    user_id = auth.uid()
    or public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager','support_executive','support_manager','accounts_executive','accounts_manager'])
  );
create policy "user_profiles_insert_own" on public.user_profiles
  for insert with check (user_id = auth.uid());
create policy "user_profiles_update_own_or_admin" on public.user_profiles
  for update using (user_id = auth.uid() or public.has_role(array['admin','support_manager']));

-- loads policies (read: anyone authenticated; write: owner or sales staff)
create policy "loads_select_all" on public.loads
  for select using (auth.role() = 'authenticated');
create policy "loads_insert_own" on public.loads
  for insert with check (
    posted_by = (select email from auth.users where id = auth.uid())
  );
create policy "loads_update_own_or_staff" on public.loads
  for update using (
    posted_by = (select email from auth.users where id = auth.uid())
    or public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager'])
  );
create policy "loads_delete_own_or_admin" on public.loads
  for delete using (
    posted_by = (select email from auth.users where id = auth.uid())
    or public.has_role(array['admin'])
  );

-- load_likes policies
create policy "load_likes_select_own_or_staff" on public.load_likes
  for select using (
    liked_by_email = (select email from auth.users where id = auth.uid())
    or assigned_sales_executive = (select email from auth.users where id = auth.uid())
    or public.has_role(array['admin','sales_executive','sales_team_lead','sales_manager'])
  );
create policy "load_likes_insert_own" on public.load_likes
  for insert with check (
    liked_by_email = (select email from auth.users where id = auth.uid())
  );
create policy "load_likes_delete_own_or_admin" on public.load_likes
  for delete using (
    liked_by_email = (select email from auth.users where id = auth.uid())
    or public.has_role(array['admin'])
  ); 
  