import { Router } from 'express';
import { drivingDistanceKm } from '../lib/googleMaps.js';

const router = Router();

// Best-effort address string for the Distance Matrix API — includes
// everything that narrows down a location, and lets Google's own geocoding
// handle typos/partial addresses rather than us pre-validating anything.
function formatAddress(address, city, state, pincode) {
  return [address, city, state, pincode, 'India'].filter(Boolean).join(', ');
}

// GET /api/loads?truck_type=tata_407&pincode=110001&material_type=cement — mirrors
// FindLoads.jsx's query, filtering on the same fields PostLoadScreen collects
// GET /api/loads?mine=true — the caller's own posted loads, any status (for the home dashboard)
router.get('/', async (req, res) => {
  const { truck_type, pincode, material_type, mine, limit = 50 } = req.query;

  let query = req.supabase
    .from('loads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (mine === 'true') {
    query = query.eq('posted_by', req.user.email);
  } else {
    query = query.eq('status', 'active');
    if (truck_type && truck_type !== 'all') query = query.eq('required_truck_type', truck_type);
    if (pincode) query = query.or(`loading_pincode.eq.${pincode},unloading_pincode.eq.${pincode}`);
    if (material_type) query = query.ilike('material_type', `%${material_type}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/loads — create a load (RLS enforces posted_by === caller's email)
router.post('/', async (req, res) => {
  const payload = { ...req.body, posted_by: req.user.email };

  // Approximate road distance, looked up once at posting time and stored —
  // cheaper than re-querying Google on every read, and the route isn't
  // editable after posting so it never goes stale.
  const origin = formatAddress(payload.loading_address, payload.loading_city, payload.loading_state, payload.loading_pincode);
  const destination = formatAddress(payload.unloading_address, payload.unloading_city, payload.unloading_state, payload.unloading_pincode);
  const distanceKm = await drivingDistanceKm(origin, destination);
  if (distanceKm != null) payload.distance_km = distanceKm;

  const { data, error } = await req.supabase.from('loads').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

export default router;