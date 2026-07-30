import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/requireRole.js';

const STAFF_ROLES = ['admin', 'sales_executive', 'sales_team_lead', 'sales_manager'];

const router = Router();

const csvField = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

// GET /api/load-likes/mine — loads the current user has liked, for FindLoads' heart state
router.get('/mine', async (req, res) => {
  const { data, error } = await req.supabase
    .from('load_likes')
    .select('*')
    .eq('liked_by_email', req.user.email);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/load-likes — like a load (bumps loads.likes_count via DB trigger)
router.post('/', async (req, res) => {
  const { load_id, liked_by_type, truck_id, truck_number, offered_price } = req.body;
  if (!load_id) return res.status(400).json({ error: 'load_id is required' });

  const { data, error } = await req.supabase
    .from('load_likes')
    .insert({
      load_id,
      liked_by_email: req.user.email,
      liked_by_type,
      truck_id,
      truck_number,
      offered_price
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/load-likes/:id — unlike
router.delete('/:id', async (req, res) => {
  const { error } = await req.supabase.from('load_likes').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});

export default router;