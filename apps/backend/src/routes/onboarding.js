import { Router } from 'express';

export const BUSINESS_ROLES = ['shipper', 'transporter', 'broker', 'vehicle_owner', 'driver'];

const router = Router();

// POST /api/onboarding/select-role — add one or more business roles to the
// signed-in user. Roles are additive (existing roles are never removed) and
// a role already held by the user is rejected rather than silently skipped.
router.post('/select-role', async (req, res) => {
  const { roles } = req.body;

  if (!Array.isArray(roles) || roles.length === 0) {
    return res.status(400).json({ error: 'roles must be a non-empty array' });
  }

  const invalid = roles.filter((role) => !BUSINESS_ROLES.includes(role));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid role(s): ${invalid.join(', ')}` });
  }

  const requested = [...new Set(roles)];
  if (requested.length !== roles.length) {
    return res.status(400).json({ error: 'Duplicate roles in request' });
  }

  const { data: existing, error: fetchError } = await req.supabase
    .from('user_business_roles')
    .select('role')
    .eq('user_id', req.user.id);

  if (fetchError) return res.status(400).json({ error: fetchError.message });

  const existingRoles = existing.map((r) => r.role);
  const alreadyAssigned = requested.filter((role) => existingRoles.includes(role));
  if (alreadyAssigned.length > 0) {
    return res.status(409).json({ error: `Role(s) already assigned: ${alreadyAssigned.join(', ')}` });
  }

  const { error: insertError } = await req.supabase
    .from('user_business_roles')
    .insert(requested.map((role) => ({ user_id: req.user.id, role })));

  if (insertError) return res.status(400).json({ error: insertError.message });

  const { data: updated, error: refetchError } = await req.supabase
    .from('user_business_roles')
    .select('role, status')
    .eq('user_id', req.user.id);

  if (refetchError) return res.status(400).json({ error: refetchError.message });

  res.status(201).json({ roles: updated.map((r) => r.role) });
});

export default router;
