import { supabaseAdmin } from '../lib/supabase.js';
import { logAction } from '../lib/auditLog.js';

// Requests whose method isn't state-changing don't get an audit_log row —
// requireRole also gates plenty of staff *reads* (GET /api/trucks/queue,
// GET /api/admin/hierarchy, ...), and logging those would swamp the trail
// with read traffic instead of the "who changed what" record it's for.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Best-effort guess at which resource a mutation touched, from the mount
// path alone — requireRole is generic middleware shared across a dozen
// unrelated route files (trucks.js's per-route calls, every apps/backend/
// src/routes/admin/*.js router mounted in index.js, wallet.js's withdrawal
// approval), so it has no real knowledge of the underlying table. Strips
// the leading /api and any admin/ segment so e.g. '/api/admin/commission-
// rules' -> 'commission_rules' and '/api/trucks' -> 'trucks'; not
// guaranteed accurate (a route's URL segment doesn't always match its
// table 1:1 — see hierarchy.js, which mutates user_roles under /admin/
// hierarchy), just a useful default for audit_log.target_table.
function guessTargetTable(baseUrl) {
  const segments = baseUrl.split('/').filter(Boolean);
  if (segments[0] === 'api') segments.shift();
  if (segments[0] === 'admin') segments.shift();
  return segments[0] ? segments[0].replace(/-/g, '_') : null;
}

// Same best-effort spirit as guessTargetTable, with one sharp edge: Express
// only populates named route params (:id, :userId, ...) once request
// handling actually descends into the router that declares them. For the
// per-route style (trucks.js's router.post('/:id/verify',
// requireRole(...), handler)) that's already true by the time this runs.
// For the far more common router-level style (index.js's app.use('/api/
// admin/x', requireRole(...), someAdminRouter)) it is NOT — requireRole
// runs *before* someAdminRouter gets a chance to match e.g. '/:userId/
// manager', so req.params is still {} here and this returns null. The id
// isn't lost in that case, just less structured: it's still sitting in the
// raw action/detail.query string built below (req.path carries the
// unparsed remainder, e.g. '/exec-1/manager').
function guessTargetId(params) {
  if (!params) return null;
  if (params.id) return params.id;
  if (params.userId) return params.userId;
  const values = Object.values(params);
  return values.length > 0 ? String(values[0]) : null;
}

// Gates staff-only endpoints (e.g. withdrawal approval) against the
// authoritative user_roles table — mirrors the has_role() Postgres helper
// used by RLS policies, but for routes that need to act across other users'
// rows via the service-role client rather than the caller's own RLS scope.
export function requireRole(roles) {
  return async (req, res, next) => {
    const { data, error } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', req.user.id).in('role', roles);
    if (error) return res.status(400).json({ error: error.message });
    if (!data || data.length === 0) return res.status(403).json({ error: 'Forbidden' });

    // requireRole is the one choke point every staff mutation already
    // passes through (both the router-level app.use(path, requireRole(...),
    // someAdminRouter) mounts in index.js and the per-route
    // requireRole(STAFF_ROLES) calls in trucks.js/wallet.js), so logging
    // here — instead of adding a logAction() call to every route by hand —
    // guarantees nothing mutation-shaped ships ungated by accident. The
    // tradeoff: this fires at authorization time, not completion, so a
    // request that 400s/500s downstream still shows up as a logged attempt.
    // That's accepted deliberately — perfect precision isn't worth
    // reintroducing the per-route call sites this exists to avoid. See
    // lib/auditLog.js for why a logging failure can't ever block the
    // request itself.
    if (MUTATING_METHODS.has(req.method)) {
      await logAction({
        actorUserId: req.user.id,
        action: `${req.method} ${req.baseUrl}${req.route?.path || req.path}`,
        targetTable: guessTargetTable(req.baseUrl),
        targetId: guessTargetId(req.params),
        detail: { query: req.query, body: req.body }
      });
    }

    next();
  };
}
