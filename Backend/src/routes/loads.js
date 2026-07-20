import { Router } from 'express';

const router = Router();

// GET /api/loads?truck_type=tata_407&pincode=110001 — mirrors FindLoads.jsx's query
router.get('/', async (req, res) => {
  const { truck_type, pincode, limit = 50 } = req.query;

  let query = req.supabase
    .from('loads')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (truck_type && truck_type !== 'all') query = query.eq('required_truck_type', truck_type);
  if (pincode) query = query.or(`loading_pincode.eq.${pincode},unloading_pincode.eq.${pincode}`);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/loads — create a load (RLS enforces posted_by === caller's email)
router.post('/', async (req, res) => {
  const payload = { ...req.body, posted_by: req.user.email };
  const { data, error } = await req.supabase.from('loads').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

export default router;