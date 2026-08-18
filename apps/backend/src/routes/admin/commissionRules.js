import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';

const router = Router();

function validateRatePercent(rate_percent) {
  const parsed = Number(rate_percent);
  if (!parsed || parsed <= 0 || parsed > 100) {
    return 'rate_percent must be a number greater than 0 and at most 100';
  }
  return null;
}

// GET /api/admin/commission-rules?is_active=&material_type=&vehicle_type=
router.get('/', async (req, res) => {
  let query = supabaseAdmin.from('commission_rules').select('*').order('created_at', { ascending: false });
  const { is_active, material_type, vehicle_type } = req.query;
  if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
  if (material_type) query = query.eq('material_type', material_type);
  if (vehicle_type) query = query.eq('vehicle_type', vehicle_type);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// GET /api/admin/commission-rules/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('commission_rules').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Commission rule not found' });
  res.json(data);
});

// POST /api/admin/commission-rules { material_type?, vehicle_type?, rate_percent, is_active? }
// material_type/vehicle_type null (or omitted) means "applies regardless"
// for that dimension — see loadBids.js's findMatchingCommissionRule for how
// the most specific matching active rule gets picked at trip completion.
router.post('/', async (req, res) => {
  const { material_type, vehicle_type, rate_percent, is_active } = req.body;
  const rateError = validateRatePercent(rate_percent);
  if (rateError) return res.status(400).json({ error: rateError });

  const { data, error } = await supabaseAdmin
    .from('commission_rules')
    .insert({
      material_type: material_type || null,
      vehicle_type: vehicle_type || null,
      rate_percent: Number(rate_percent),
      is_active: is_active !== undefined ? !!is_active : true,
      created_by: req.user.id
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/admin/commission-rules/:id
router.patch('/:id', async (req, res) => {
  const { material_type, vehicle_type, rate_percent, is_active } = req.body;
  const patch = {};

  if (material_type !== undefined) patch.material_type = material_type || null;
  if (vehicle_type !== undefined) patch.vehicle_type = vehicle_type || null;
  if (rate_percent !== undefined) {
    const rateError = validateRatePercent(rate_percent);
    if (rateError) return res.status(400).json({ error: rateError });
    patch.rate_percent = Number(rate_percent);
  }
  if (is_active !== undefined) patch.is_active = !!is_active;

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin.from('commission_rules').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Commission rule not found' });
  res.json(data);
});

// DELETE /api/admin/commission-rules/:id
router.delete('/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('commission_rules').delete().eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Commission rule not found' });
  res.status(204).end();
});

export default router;
