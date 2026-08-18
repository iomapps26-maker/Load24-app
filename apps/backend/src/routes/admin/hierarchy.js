import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// Groups user_roles rows by person (not by individual role row) into tree
// nodes, then attaches each person under their manager. reports_to_user_id
// lives on user_roles (see 036_add_user_roles_hierarchy.sql) so different
// roles for the same person could in principle name different managers —
// this simple tree collapses that to one manager per person, using the
// first non-null reports_to_user_id found across their role rows (most
// staff hold exactly one role, so this rarely matters in practice; see
// PATCH /:userId/manager's `role` param for disambiguating a specific row
// when it does).
function buildOrgTree(userRoles, profileByUserId) {
  const personByUserId = new Map();

  for (const row of userRoles) {
    let person = personByUserId.get(row.user_id);
    if (!person) {
      const profile = profileByUserId.get(row.user_id);
      person = {
        user_id: row.user_id,
        full_name: profile?.full_name || null,
        mobile: profile?.mobile || null,
        roles: [],
        reports_to_user_id: null,
        direct_reports: []
      };
      personByUserId.set(row.user_id, person);
    }
    person.roles.push(row.role);
    if (person.reports_to_user_id === null && row.reports_to_user_id) {
      person.reports_to_user_id = row.reports_to_user_id;
    }
  }

  // A manager pointing at someone with no user_roles row at all (left the
  // team, role revoked) falls back to being a root rather than vanishing.
  const roots = [];
  for (const person of personByUserId.values()) {
    const manager = person.reports_to_user_id ? personByUserId.get(person.reports_to_user_id) : null;
    if (manager) manager.direct_reports.push(person);
    else roots.push(person);
  }
  return roots;
}

// GET /api/admin/hierarchy — the org tree, rooted at whoever has no manager.
router.get('/', async (req, res) => {
  const { data: userRoles, error: rolesError } = await supabaseAdmin.from('user_roles').select('*');
  if (rolesError) return res.status(400).json({ error: rolesError.message });

  const userIds = [...new Set((userRoles || []).map((r) => r.user_id))];
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabaseAdmin.from('user_profiles').select('user_id, full_name, mobile').in('user_id', userIds)
    : { data: [], error: null };
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const profileByUserId = new Map((profiles || []).map((p) => [p.user_id, p]));
  res.json(buildOrgTree(userRoles || [], profileByUserId));
});

// Walks a candidate manager's own chain upward (same "first non-null
// reports_to_user_id wins" rule buildOrgTree uses) to check whether
// assigning them would create a reporting loop. Bails out on a repeat
// user_id rather than looping forever if a cycle already exists elsewhere
// in the data.
async function wouldCreateCycle(userId, candidateManagerId) {
  let cursor = candidateManagerId;
  const seen = new Set();
  while (cursor) {
    if (cursor === userId) return true;
    if (seen.has(cursor)) return false;
    seen.add(cursor);
    const { data: rows } = await supabaseAdmin.from('user_roles').select('reports_to_user_id').eq('user_id', cursor);
    cursor = (rows || []).map((r) => r.reports_to_user_id).find(Boolean) || null;
  }
  return false;
}

// PATCH /api/admin/hierarchy/:userId/manager { manager_user_id, role? }
// manager_user_id: null (or omitted) clears it — the user becomes a root.
// role: which of the user's role rows to update, only required if they
// hold more than one (see user_roles' unique(user_id, role)) — this route
// never grants/revokes a role itself, only sets reports_to_user_id on a
// role assignment that already exists; granting the role in the first
// place is POST/DELETE /api/admin/users/:userId/roles (users.js, Phase 1).
router.patch('/:userId/manager', async (req, res) => {
  const { manager_user_id, role } = req.body;
  const userId = req.params.userId;

  if (manager_user_id && manager_user_id === userId) {
    return res.status(400).json({ error: 'A user cannot be their own manager' });
  }

  let query = supabaseAdmin.from('user_roles').select('*').eq('user_id', userId);
  if (role) query = query.eq('role', role);
  const { data: rows, error: rowsError } = await query;
  if (rowsError) return res.status(400).json({ error: rowsError.message });
  if (!rows || rows.length === 0) {
    return res.status(404).json({ error: role ? `User does not have the ${role} role` : 'User has no staff role assignments' });
  }
  if (!role && rows.length > 1) {
    return res.status(400).json({
      error: `User holds multiple roles (${rows.map((r) => r.role).join(', ')}) — specify which one via "role"`
    });
  }

  if (manager_user_id && (await wouldCreateCycle(userId, manager_user_id))) {
    return res.status(400).json({ error: 'This assignment would create a reporting cycle' });
  }

  const targetRow = rows[0];
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .update({ reports_to_user_id: manager_user_id || null })
    .eq('id', targetRow.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;
