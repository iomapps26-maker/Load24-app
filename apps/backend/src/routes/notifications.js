import { Router } from 'express';

const router = Router();

// GET /api/notifications?limit=&unread=true — the caller's own feed, newest
// first. RLS (notifications_select_own) already keeps this to the caller.
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  let query = req.supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (req.query.unread === 'true') query = query.is('read_at', null);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/notifications/unread-count — cheap poll target for a badge on the
// bell icon, so the app isn't re-fetching (and re-rendering) the whole feed
// just to know whether the dot should show.
router.get('/unread-count', async (req, res) => {
  const { count, error } = await req.supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ count: count ?? 0 });
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res) => {
  const { data, error } = await req.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .is('read_at', null)
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data ?? { ok: true });
});

// DELETE /api/notifications/:id — permanently dismiss one notification (swipe
// to delete on the mobile side). Unlike mark-read, this is a hard delete —
// gone for good, won't reappear on a later login. RLS (notifications_delete_own,
// 029_add_notifications_delete_policy.sql) already keeps this to the caller's
// own rows.
router.delete('/:id', async (req, res) => {
  const { data, error } = await req.supabase.from('notifications').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Notification not found' });
  res.status(204).end();
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  const { error } = await req.supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', req.user.id)
    .is('read_at', null);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
