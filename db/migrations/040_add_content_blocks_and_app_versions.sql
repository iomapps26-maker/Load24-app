-- Staff-managed CMS-lite content, plus mobile-app version gating. Both are
-- read by the mobile app on launch via the single public GET /api/app-config
-- endpoint (apps/backend/src/routes/admin/content.js's appConfigHandler) —
-- no auth, since the app calls it before a user has signed in. Writes go
-- through the admin CRUD in the same file (content_blocks) and its
-- app_versions sibling router, both staff-gated.
--
-- `key` + `type` rather than `type` alone: a given type can have more than
-- one live block (several FAQ entries, a home banner and a checkout banner)
-- so `key` is what the mobile app and admin UI both address a specific
-- block by; `type` is what appConfigHandler groups them into in its
-- response shape (banners/faqs/config).
create table if not exists public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  type text not null check (type in ('banner', 'faq', 'config')),
  payload jsonb not null default '{}',
  is_active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_blocks_type_active_idx on public.content_blocks (type, is_active);

alter table public.content_blocks enable row level security;

-- Same shape as commission_rules_staff_all (035_add_commission_rules.sql)
-- for the write side. Unlike commission_rules, this table also has a real
-- anonymous reader: appConfigHandler runs with no Supabase session at all
-- (mobile app, pre-login), so it goes through supabaseAdmin like every
-- other unauthenticated route in this codebase (whatsappAuth.ts, the
-- Razorpay webhook) — meaning this select policy is a defense-in-depth
-- backstop rather than the actual access path, same disclaimer as the
-- staff_all policies elsewhere.
create policy "content_blocks_staff_all" on public.content_blocks
  for all using (
    public.has_role(array['admin','support_executive','support_manager'])
  ) with check (
    public.has_role(array['admin','support_executive','support_manager'])
  );

create policy "content_blocks_select_active" on public.content_blocks
  for select using (is_active = true);

-- One row per platform. min_supported_version/latest_version are opaque
-- version strings (compared client-side, e.g. "must upgrade if below
-- min_supported_version") rather than a structured semver type — nothing
-- else in this schema enforces a version format, and the mobile app's own
-- comparison logic is what actually interprets them.
create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  platform text not null unique check (platform in ('android', 'ios')),
  min_supported_version text not null,
  latest_version text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_versions enable row level security;

create policy "app_versions_staff_all" on public.app_versions
  for all using (
    public.has_role(array['admin','support_executive','support_manager'])
  ) with check (
    public.has_role(array['admin','support_executive','support_manager'])
  );

-- No is_active gate here (unlike content_blocks_select_active) — every row
-- is a live platform's version info by definition, and appConfigHandler
-- needs to read both platforms regardless of caller.
create policy "app_versions_select_all" on public.app_versions
  for select using (true);
