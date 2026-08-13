import { Router } from 'express';
import { drivingDistanceKm } from '../lib/googleMaps.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { notifyUser } from '../lib/notify.js';
import { NEARBY_RADIUS_KM } from '../lib/notifyRadius.js';

const router = Router();

// Best-effort address string for the Distance Matrix API — includes
// everything that narrows down a location, and lets Google's own geocoding
// handle typos/partial addresses rather than us pre-validating anything.
function formatAddress(address, city, state, pincode) {
  return [address, city, state, pincode, 'India'].filter(Boolean).join(', ');
}

// Fire-and-forget: tells the owner of every *available* truck posting within
// NEARBY_RADIUS_KM of this load's pickup point that a new load just showed
// up near them. Only 'available' postings are eligible — once a truck is
// booked on a trip (see loadBids.js's approve route), it drops out of this
// fan-out until it's posted available again. Never throws — a lookup
// failure here should never fail the load posting itself.
async function notifyNearbyTruckOwners(req, load) {
  if (!load.loading_pincode) return;

  const { data: nearby, error } = await req.supabase.rpc('pincodes_within_radius', {
    origin_pincode: load.loading_pincode,
    radius_km: NEARBY_RADIUS_KM
  });
  if (error) return console.error('[loads] pincodes_within_radius failed', error);
  if (!nearby?.length) return;

  // truck_availabilities RLS only lets req.supabase see 'available' postings
  // (which is exactly what we want here) or the caller's own — service-role
  // client isn't strictly required, but used for consistency with the
  // reverse fan-out and to avoid any RLS surprises on future policy changes.
  const { data: postings, error: postingsError } = await supabaseAdmin
    .from('truck_availabilities')
    .select('id, owner_id')
    .eq('status', 'available')
    .in('current_pincode', nearby.map((r) => r.pincode))
    .neq('owner_id', req.user.id);
  if (postingsError) return console.error('[loads] nearby truck lookup failed', postingsError);

  await Promise.all(
    (postings || []).map((posting) =>
      notifyUser(posting.owner_id, {
        type: 'load_available_nearby',
        title: 'New load near your available truck',
        body: `A load${load.material_type ? ` (${load.material_type})` : ''} was posted near ${load.loading_city || load.loading_pincode}`,
        data: { load_id: load.id, truck_availability_id: posting.id }
      })
    )
  );
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

  // After the response, not before — same reasoning as truckAvailability.js's
  // notifyNearbyUsers: this fan-out shouldn't make the poster wait.
  notifyNearbyTruckOwners(req, data).catch((err) => console.error('[loads] notifyNearbyTruckOwners failed', err));
});

export default router;