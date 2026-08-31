import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// Full user_roles.role check constraint (003_add_roles_devices_consents.sql)
// — every internal staff role an admin can grant, not just the three
// STAFF_ROLES that gate access to /api/admin/* itself (see index.js).
const GRANTABLE_ROLES = [
  'admin',
  'sales_executive',
  'sales_team_lead',
  'sales_manager',
  'support_executive',
  'support_manager',
  'accounts_executive',
  'accounts_manager'
];

// GET /api/admin/users?q=&page=&limit= — lists/searches users, joined with
// their roles. Driven from user_profiles rather than auth.users: every real
// user gets a profile row during onboarding, and unlike GoTrue's Admin API
// (the only way to reach auth.users — see dashboard.js's listUsers
// comment), user_profiles is a normal PostgREST table with proper
// .range() pagination and .ilike() search, no known reliability issues.
router.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, mobile, city, user_email, user_type, kyc_status, is_active, bidding_restricted_until, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  const q = (req.query.q || '').trim();
  if (q) {
    query = query.or(`full_name.ilike.%${q}%,mobile.ilike.%${q}%,user_email.ilike.%${q}%`);
  }

  const { data: profiles, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const userIds = (profiles || []).map((p) => p.user_id);
  const { data: roles, error: rolesError } = userIds.length
    ? await supabaseAdmin.from('user_roles').select('user_id, role').in('user_id', userIds)
    : { data: [], error: null };
  if (rolesError) return res.status(400).json({ error: rolesError.message });

  const rolesByUserId = new Map();
  for (const r of roles || []) {
    if (!rolesByUserId.has(r.user_id)) rolesByUserId.set(r.user_id, []);
    rolesByUserId.get(r.user_id).push(r.role);
  }

  res.json({
    users: (profiles || []).map((p) => ({ ...p, roles: rolesByUserId.get(p.user_id) || [] })),
    page,
    limit,
    total: count ?? 0
  });
});

// POST /api/admin/users/:userId/roles { role } — grants a staff role.
// user_roles_write_admin_only RLS (003_add_roles_devices_consents.sql)
// already restricts this to admin callers, but this goes through
// supabaseAdmin anyway — same reasoning as trucks.js's :id/verify comment:
// has_role(), which that policy calls, has already caused one silent
// production failure (infinite recursion evaluating user_roles' own select
// policy) elsewhere in this codebase, so staff writes in this session
// consistently avoid relying on it at all rather than trust it case by case.
router.post('/:userId/roles', async (req, res) => {
  const { role } = req.body;
  if (!GRANTABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${GRANTABLE_ROLES.join(', ')}` });
  }

  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .insert({ user_id: req.params.userId, role, granted_by: req.user.id })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `User already has the ${role} role` });
    if (error.code === '23503') return res.status(404).json({ error: 'User not found' });
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json(data);
});

// DELETE /api/admin/users/:userId/roles/:role — revokes one.
router.delete('/:userId/roles/:role', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .delete()
    .eq('user_id', req.params.userId)
    .eq('role', req.params.role)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'That user does not have this role' });
  res.status(204).end();
});

export default router;
