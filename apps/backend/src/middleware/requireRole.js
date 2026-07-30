import { supabaseAdmin } from '../lib/supabase.js';

// Gates staff-only endpoints (e.g. withdrawal approval) against the
// authoritative user_roles table — mirrors the has_role() Postgres helper
// used by RLS policies, but for routes that need to act across other users'
// rows via the service-role client rather than the caller's own RLS scope.
export function requireRole(roles) {
  return async (req, res, next) => {
    const { data, error } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', req.user.id).in('role', roles);
    if (error) return res.status(400).json({ error: error.message });
    if (!data || data.length === 0) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
