import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

// Executive logins for the Executive Desk (/executive/).
// An admin creates each executive's own login ID + password here — staff
// sign in with Supabase email/password (/executive/login/), so a
// login ID is really an email. A bare ID like "ravi.k" becomes
// ravi.k@staff.load24.internal; the login page appends the same domain when
// no "@" is typed, so executives never see it. A real email works too.
//
// Mounted admin-only in index.js — an executive must not be able to mint
// more staff logins.
export const STAFF_LOGIN_DOMAIN = 'staff.load24.internal';
const MIN_PASSWORD_LENGTH = 8;
// desk_executive (migration 067) opens only /api/executive — no admin
// portal access, unlike support_executive.
const EXECUTIVE_ROLE = 'desk_executive';
// ~100 years: Supabase's way of disabling a login without deleting it (and
// its audit_log history) — "none" lifts it again.
const DISABLED_BAN_DURATION = '876000h';

function loginEmailFor(loginId) {
  const id = String(loginId || '').trim().toLowerCase();
  if (!id) return null;
  if (id.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id) ? id : null;
  return /^[a-z0-9._-]{3,40}$/.test(id) ? `${id}@${STAFF_LOGIN_DOMAIN}` : null;
}

function loginIdFor(email) {
  return email && email.endsWith(`@${STAFF_LOGIN_DOMAIN}`) ? email.slice(0, -STAFF_LOGIN_DOMAIN.length - 1) : email;
}

function serialize(user, role) {
  return {
    user_id: user.id,
    login_id: loginIdFor(user.email),
    email: user.email,
    full_name: user.user_metadata?.full_name ?? null,
    mobile: user.user_metadata?.mobile ?? null,
    role,
    disabled: !!user.banned_until && new Date(user.banned_until) > new Date(),
    last_sign_in_at: user.last_sign_in_at ?? null,
    created_at: user.created_at
  };
}

// GET /api/admin/staff-accounts — every executive login. Driven from
// user_roles (a handful of rows) with one getUserById per row, rather than
// GoTrue's paginated listUsers over every app user.
router.get('/', async (req, res) => {
  const { data: roles, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id, role, created_at')
    .eq('role', EXECUTIVE_ROLE)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });

  const users = await Promise.all(
    (roles || []).map(async (r) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
      return data?.user ? serialize(data.user, r.role) : null;
    })
  );
  res.json({ accounts: users.filter(Boolean) });
});

// POST /api/admin/staff-accounts { login_id, password, full_name, mobile? }
router.post('/', async (req, res) => {
  const { login_id, password, full_name, mobile } = req.body;
  const email = loginEmailFor(login_id);
  if (!email) {
    return res.status(400).json({ error: 'Login ID must be 3–40 characters (letters, numbers, . _ -) or a valid email' });
  }
  if (!full_name || !String(full_name).trim()) return res.status(400).json({ error: 'full_name is required' });
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: String(full_name).trim(), mobile: mobile || null, staff_account: true, created_by: req.user.id }
  });
  if (createError || !created?.user) {
    const taken = /already.*registered|already.*exists|email_exists/i.test(createError?.message || createError?.code || '');
    return res.status(taken ? 409 : 400).json({ error: taken ? 'That login ID is already taken' : createError?.message || 'Could not create the login' });
  }

  const { error: roleError } = await supabaseAdmin
    .from('user_roles')
    .insert({ user_id: created.user.id, role: EXECUTIVE_ROLE, granted_by: req.user.id });
  if (roleError) {
    // Don't leave a login behind with no role — it could sign in and see
    // nothing but 403s, and the ID would stay "taken".
    await supabaseAdmin.auth.admin.deleteUser(created.user.id);
    return res.status(400).json({ error: roleError.message });
  }

  res.status(201).json(serialize(created.user, EXECUTIVE_ROLE));
});

// Only accounts this page manages (desk executives) can be changed here —
// never an admin's own login or an app user's.
async function executiveOr404(req, res) {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('role')
    .eq('user_id', req.params.userId)
    .eq('role', EXECUTIVE_ROLE)
    .maybeSingle();
  if (error) {
    res.status(400).json({ error: error.message });
    return false;
  }
  if (!data) {
    res.status(404).json({ error: 'Executive login not found' });
    return false;
  }
  return true;
}

// POST /api/admin/staff-accounts/:userId/password { password }
router.post('/:userId/password', async (req, res) => {
  const { password } = req.body;
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }
  if (!(await executiveOr404(req, res))) return;

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.params.userId, { password });
  if (error) return res.status(400).json({ error: error.message });
  res.json(serialize(data.user, EXECUTIVE_ROLE));
});

// POST /api/admin/staff-accounts/:userId/disable | /enable — blocks or
// restores sign-in. The ban stops new sign-ins and token refreshes; staff
// have no user_profiles row for token_valid_after revocation, so a session
// already open can last until its access token expires (≤1h).
router.post('/:userId/:action(disable|enable)', async (req, res) => {
  if (!(await executiveOr404(req, res))) return;

  const ban_duration = req.params.action === 'disable' ? DISABLED_BAN_DURATION : 'none';
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.params.userId, { ban_duration });
  if (error) return res.status(400).json({ error: error.message });
  res.json(serialize(data.user, EXECUTIVE_ROLE));
});

export default router;
