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

// GET /api/load-likes/export?status=&load_id=&from=&to= — staff-only CSV of
// likes with both parties' contact details side by side (poster + liker), so
// sales can reach out to each separately without either seeing the other's
// info in-app. Generated on demand from live data, not pre-built/scheduled.
router.get('/export', requireRole(STAFF_ROLES), async (req, res) => {
  const { status, load_id, from, to } = req.query;

  let query = supabaseAdmin
    .from('load_likes')
    .select('*, loads(load_id, posted_by, poster_type, company_name, loading_city, loading_state, unloading_city, unloading_state, material_type, weight_tons, bhada_price, loading_date)')
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (load_id) query = query.eq('load_id', load_id);
  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);

  const { data: likes, error } = await query;
  if (error) return res.status(400).json({ error: error.message });

  const posterEmails = [...new Set((likes || []).map((l) => l.loads?.posted_by).filter(Boolean))];
  const { data: posterProfiles, error: profilesError } = posterEmails.length
    ? await supabaseAdmin.from('user_profiles').select('user_email, full_name, mobile, company_name').in('user_email', posterEmails)
    : { data: [], error: null };
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const posterByEmail = new Map((posterProfiles || []).map((p) => [p.user_email, p]));

  const header = [
    'load_id', 'route', 'material_type', 'weight_tons', 'bhada_price', 'loading_date',
    'poster_name', 'poster_mobile', 'poster_email', 'poster_company',
    'liker_name', 'liker_mobile', 'liker_email', 'liker_type', 'truck_number', 'offered_price',
    'like_status', 'liked_at'
  ].join(',');

  const rows = (likes || []).map((l) => {
    const load = l.loads || {};
    const poster = posterByEmail.get(load.posted_by) || {};
    return [
      load.load_id,
      `${load.loading_city || ''}-${load.unloading_city || ''}`,
      load.material_type,
      load.weight_tons,
      load.bhada_price,
      load.loading_date,
      poster.full_name,
      poster.mobile,
      load.posted_by,
      poster.company_name || load.company_name,
      l.liked_by_name,
      l.liked_by_mobile,
      l.liked_by_email,
      l.liked_by_type,
      l.truck_number,
      l.offered_price,
      l.status,
      l.created_at
    ].map(csvField).join(',');
  });

  const csv = [header, ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="load-likes-${Date.now()}.csv"`);
  res.status(200).send(csv);
});

// DELETE /api/load-likes/:id — unlike
router.delete('/:id', async (req, res) => {
  const { error } = await req.supabase.from('load_likes').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.status(204).end();
});

export default router;