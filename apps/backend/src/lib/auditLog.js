import { supabaseAdmin } from './supabase.js';

// Fire-and-forget audit trail write, same philosophy as notify.js's
// insert(): a failure here (bad actor id, DB hiccup) must never break the
// staff mutation that triggered it — an admin approving a withdrawal
// shouldn't 500 out just because the audit_log insert failed. Callers await
// this for ordering (so the row exists by the time the request completes),
// not for its success; every error path resolves rather than throws.
//
// Lives in lib/ rather than routes/admin/auditLog.js (which only defines
// the GET /api/admin/audit-log listing route) so that middleware/
// requireRole.js — the one call site that matters, see the comment there —
// can import it without a middleware-importing-from-routes dependency
// direction. Same placement reasoning as notify.js's notifyUser/notifyEmail.
export async function logAction({ actorUserId, action, targetTable = null, targetId = null, detail = {} }) {
  // Wrapped in try/catch, not just an `error` check, because requireRole
  // (the sole caller) awaits this inline in the request path: an unhandled
  // rejection here would stall every staff-gated mutation on an audit-log
  // hiccup instead of just failing to record one.
  try {
    const { error } = await supabaseAdmin
      .from('audit_log')
      .insert({ actor_user_id: actorUserId, action, target_table: targetTable, target_id: targetId, detail });
    if (error) console.error('[auditLog]', action, error);
  } catch (err) {
    console.error('[auditLog]', action, err);
  }
}
