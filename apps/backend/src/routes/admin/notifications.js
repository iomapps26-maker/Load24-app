import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// GET /api/admin/notifications?type=&page=&limit= — every notification ever
// sent, across every user, newest first — unlike GET /api/notifications
// (RLS-scoped to notifications_select_own: a staff account hitting that
// endpoint only ever sees notifications sent to itself). Read-only: no
// staff action exists on this table beyond viewing it — see
// notificationTemplates.js for the editable side of the notifications
// system (the templates that will eventually generate these rows).
router.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin.from('notifications').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to);
  if (req.query.type) query = query.eq('type', req.query.type);

  const { data: notifications, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const userIds = [...new Set((notifications || []).map((n) => n.user_id))];
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabaseAdmin.from('user_profiles').select('user_id, full_name, mobile').in('user_id', userIds)
    : { data: [], error: null };
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
  res.json({
    notifications: (notifications || []).map((n) => ({ ...n, recipient: profileByUserId.get(n.user_id) || null })),
    page,
    limit,
    total: count ?? 0
  });
});

export default router;
