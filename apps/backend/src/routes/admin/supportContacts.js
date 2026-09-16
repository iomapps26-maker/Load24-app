import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { dbError, writeError } from '../../lib/httpErrors.js';

// Admin CRUD for the support-contact roster (db/migrations/061_...) — same
// shape as admin/masterData.js, but using dbError/writeError instead of
// forwarding raw error.message. Assignment (which user gets which contact)
// is never written here — only assign_support_contact() (called from
// routes/loadBids.js's trip-details handler via lib/contactAssignment.js)
// writes user_support_contact; this file only manages the roster itself.

const LOG = '[admin/support-contacts]';

const router = Router();

// GET /api/admin/support-contacts?is_active=
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('support_contact_roster').select('*').order('name', { ascending: true });
  if (req.query.is_active !== undefined) query = query.eq('is_active', req.query.is_active === 'true');

  const { data, error } = await query;
  if (error) return dbError(res, error, 'Could not load support contacts', { log: LOG });
  res.json(data);
});

// GET /api/admin/support-contacts/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('support_contact_roster').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return dbError(res, error, 'Could not load this support contact', { log: LOG });
  if (!data) return res.status(404).json({ error: 'Support contact not found' });
  res.json(data);
});

// POST /api/admin/support-contacts { name, phone, email?, is_active? }
router.post('/', async (req, res) => {
  const { name, phone, email, is_active } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name and phone are required' });

  const { data, error } = await supabaseAdmin
    .from('support_contact_roster')
    .insert({ name, phone, email: email || null, is_active: is_active !== undefined ? !!is_active : true })
    .select()
    .single();
  if (error) return writeError(res, error, 'Could not create this support contact', { log: LOG });
  res.status(201).json(data);
});

// PATCH /api/admin/support-contacts/:id
router.patch('/:id', async (req, res) => {
  const { name, phone, email, is_active } = req.body;
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  if (email !== undefined) patch.email = email || null;
  if (is_active !== undefined) patch.is_active = !!is_active;

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('support_contact_roster').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) return writeError(res, error, 'Could not update this support contact', { log: LOG });
  if (!data) return res.status(404).json({ error: 'Support contact not found' });
  res.json(data);
});

// DELETE /api/admin/support-contacts/:id — hard delete, only when nobody is
// currently assigned to this contact (pre-checked here for a clean message;
// the FK's lack of ON DELETE CASCADE, migration 061, is the real backstop
// for the rare race where an assignment lands between this check and the
// delete). Deactivate (PATCH { is_active: false }) instead to retire a
// contact that already has users on it — existing assignments stay valid.
router.delete('/:id', async (req, res) => {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('support_contact_roster')
    .select('assigned_count')
    .eq('id', req.params.id)
    .maybeSingle();
  if (fetchError) return dbError(res, fetchError, 'Could not delete this support contact', { log: LOG });
  if (!existing) return res.status(404).json({ error: 'Support contact not found' });
  if (existing.assigned_count > 0) {
    return res.status(409).json({
      error: `This contact has ${existing.assigned_count} user(s) assigned to it — deactivate it instead of deleting.`
    });
  }

  const { data, error } = await supabaseAdmin.from('support_contact_roster').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'This contact has users assigned to it — deactivate it instead of deleting.' });
    }
    return writeError(res, error, 'Could not delete this support contact', { log: LOG });
  }
  if (!data) return res.status(404).json({ error: 'Support contact not found' });
  res.status(204).end();
});

export default router;
