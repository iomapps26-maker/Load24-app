import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

// Kept here (not imported from trucks.js) so trucks.js doesn't have to
// depend on an admin/ route file for a plain constant — both this file and
// trucks.js check against the same fixed list independently.
export const MASTER_DATA_CATEGORIES = ['truck_type', 'body_type', 'material_category', 'cancellation_reason', 'support_category'];

function validateCategory(category) {
  if (!MASTER_DATA_CATEGORIES.includes(category)) return `category must be one of: ${MASTER_DATA_CATEGORIES.join(', ')}`;
  return null;
}

const router = Router();

// GET /api/admin/master-data?category=&is_active=
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('master_data').select('*').order('label', { ascending: true });
  const { category, is_active } = req.query;
  if (category) query = query.eq('category', category);
  if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/admin/master-data/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('master_data').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Master data row not found' });
  res.json(data);
});

// POST /api/admin/master-data { category, value, label, is_active? }
router.post('/', async (req, res) => {
  const { category, value, label, is_active } = req.body;
  if (!category || !value || !label) return res.status(400).json({ error: 'category, value, and label are required' });
  const categoryError = validateCategory(category);
  if (categoryError) return res.status(400).json({ error: categoryError });

  const { data, error } = await supabaseAdmin
    .from('master_data')
    .insert({ category, value, label, is_active: is_active !== undefined ? !!is_active : true })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: `"${value}" already exists under category "${category}"` });
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json(data);
});

// PATCH /api/admin/master-data/:id
router.patch('/:id', async (req, res) => {
  const { category, value, label, is_active } = req.body;
  const patch = {};

  if (category !== undefined) {
    const categoryError = validateCategory(category);
    if (categoryError) return res.status(400).json({ error: categoryError });
    patch.category = category;
  }
  if (value !== undefined) patch.value = value;
  if (label !== undefined) patch.label = label;
  if (is_active !== undefined) patch.is_active = !!is_active;

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('master_data').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That value already exists under this category' });
    return res.status(400).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Master data row not found' });
  res.json(data);
});

// DELETE /api/admin/master-data/:id — hard delete. Deactivating via
// PATCH { is_active: false } is the usual way to retire a value without
// erasing history (existing trucks etc. keep whatever value they already
// have either way, since nothing here is a foreign key) — this is for
// cleaning up an outright mistake.
router.delete('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('master_data').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Master data row not found' });
  res.status(204).end();
});

export default router;

// GET /api/master-data/:category — public, no auth: both the mobile app's
// forms (truck registration, and whatever material_category/
// cancellation_reason/support_category features eventually use) and the
// admin site read this instead of a hardcoded constant. supabaseAdmin
// rather than req.supabase for the same "no session on this route" reason
// as content.js's appConfigHandler — this is mounted with no requireAuth in
// front of it in index.js.
export const publicMasterDataRouter = Router();

publicMasterDataRouter.get('/:category', async (req, res) => {
  const { category } = req.params;
  const categoryError = validateCategory(category);
  if (categoryError) return res.status(400).json({ error: categoryError });

  const { data, error } = await supabaseAdmin
    .from('master_data')
    .select('value, label')
    .eq('category', category)
    .eq('is_active', true)
    .order('label', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});
