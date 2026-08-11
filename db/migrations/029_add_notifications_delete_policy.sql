-- Lets a user permanently dismiss (swipe-delete) their own notification
-- instead of only marking it read — 028_add_notifications.sql only covered
-- select/update. A deleted row is gone for good: it will not reappear on a
-- later login, same "swipe away = gone" behavior as other notification feeds.
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (user_id = auth.uid());
