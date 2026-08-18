import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// Caps how much a single request can pull back — audit_log grows
// unboundedly with staff activity, unlike the small config-table CRUDs
// elsewhere under /api/admin (commission_rules, incentive_rules, ...), so
// unlike those this route can't get away with an unlimited `select('*')`.
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

// GET /api/admin/audit-log?actor_user_id=&action=&from=&to=&limit=
// from/to filter created_at (inclusive), as ISO timestamps. All rows are
// written by logAction() (lib/auditLog.js) from inside requireRole() — see
// the comment there for exactly when a row lands and what it means.
router.get('/', async (req, res) => {
  const { actor_user_id, action, from, to, limit } = req.query;

  let query = supabaseAdmin.from('audit_log').select('*').order('created_at', { ascending: false });
  if (actor_user_id) query = query.eq('actor_user_id', actor_user_id);
  if (action) query = query.eq('action', action);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const parsedLimit = limit !== undefined ? Number(limit) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return res.status(400).json({ error: 'limit must be a positive number' });
  }
  query = query.limit(Math.min(parsedLimit, MAX_LIMIT));

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;
