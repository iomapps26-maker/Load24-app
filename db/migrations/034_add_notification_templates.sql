-- Staff-editable templates for outbound notifications (push/email/whatsapp),
-- body/subject carrying {{variable}} placeholders. This migration is just
-- the table backing apps/backend/src/routes/admin/notificationTemplates.js
-- — src/lib/notify.js's existing call sites still send their own hardcoded
-- title/body and are NOT rewired to read from here yet; that's a
-- deliberate follow-up once templates actually exist and are populated,
-- not an oversight.
create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('push', 'email', 'whatsapp')),
  event_key text not null,
  subject text,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, event_key)
);

alter table public.notification_templates enable row level security;

-- Entirely staff-managed with no user-facing concept of ownership — one
-- policy for every operation, same shape *_update_staff policies elsewhere
-- use, just without an "own" branch since nothing here is user-owned.
create policy "notification_templates_staff_all" on public.notification_templates
  for all using (
    public.has_role(array['admin','support_executive','support_manager'])
  ) with check (
    public.has_role(array['admin','support_executive','support_manager'])
  );
