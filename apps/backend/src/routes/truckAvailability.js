import { Router } from 'express';

const router = Router();

const TRIP_PREFERENCES = ['single_trip', 'return_load', 'regular_lane'];
const STATUSES = ['available', 'offered', 'held', 'booked', 'loading', 'trip_active', 'unavailable', 'maintenance'];
const RECURRING_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function validate(body) {
  if (body.trip_preference && !TRIP_PREFERENCES.includes(body.trip_preference)) {
    return `Invalid trip_preference: ${body.trip_preference}`;
  }
  if (body.status && !STATUSES.includes(body.status)) {
    return `Invalid status: ${body.status}`;
  }
  if (body.recurring_days && !body.recurring_days.every((d) => RECURRING_DAYS.includes(d))) {
    return `Invalid recurring_days: ${body.recurring_days}`;
  }
  return null;
}

// Fields the caller may set themselves.
function pickWritableFields(body) {
  const {
    truck_id, available_now, available_from,
    current_pincode, current_city, current_state,
    preferred_routes, destination_preference, operating_radius_km,
    expected_freight, minimum_freight, trip_preference,
    is_recurring, recurring_days, status
  } = body;
  return {
    truck_id, available_now, available_from,
    current_pincode, current_city, current_state,
    preferred_routes, destination_preference, operating_radius_km,
    expected_freight, minimum_freight, trip_preference,
    is_recurring, recurring_days, status
  };
}

// GET /api/truck-availability — browse open postings (Find Trucks side),
// filterable the same way FindLoadsScreen filters loads.
// GET /api/truck-availability?mine=true — the caller's own postings, any status.
router.get('/', async (req, res) => {
  const { mine, trip_preference, pincode, limit = 50 } = req.query;

  let query = req.supabase
    .from('truck_availabilities')
    .select('*, truck:trucks(registration_number, truck_type, truck_type_other, capacity_tons, body_type, driver_name, driver_mobile)')
    .order('created_at', { ascending: false })
    .limit(Number(limit));

  if (mine === 'true') {
    query = query.eq('owner_id', req.user.id);
  } else {
    query = query.eq('status', 'available');
    if (trip_preference && trip_preference !== 'all') query = query.eq('trip_preference', trip_preference);
    if (pincode) query = query.eq('current_pincode', pincode);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/truck-availability — post a registered truck as available.
router.post('/', async (req, res) => {
  const { truck_id } = req.body;
  if (!truck_id) return res.status(400).json({ error: 'truck_id is required' });

  const enumError = validate(req.body);
  if (enumError) return res.status(400).json({ error: enumError });

  // Confirms the truck belongs to the caller before insert — RLS would also
  // catch a mismatch, but this gives a clean 404 instead of an opaque
  // insert failure.
  const { data: truck } = await req.supabase.from('trucks').select('id').eq('id', truck_id).eq('owner_id', req.user.id).maybeSingle();
  if (!truck) return res.status(404).json({ error: 'Truck not found' });

  const { data, error } = await req.supabase
    .from('truck_availabilities')
    .insert({ ...pickWritableFields(req.body), owner_id: req.user.id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PATCH /api/truck-availability/:id — update a posting owned by the caller
// (edit details, or move it through the status lifecycle).
router.patch('/:id', async (req, res) => {
  const enumError = validate(req.body);
  if (enumError) return res.status(400).json({ error: enumError });

  const { data, error } = await req.supabase
    .from('truck_availabilities')
    .update({ ...pickWritableFields(req.body), updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Posting not found' });
  res.json(data);
});

// DELETE /api/truck-availability/:id — remove a posting owned by the caller.
router.delete('/:id', async (req, res) => {
  const { data, error } = await req.supabase
    .from('truck_availabilities')
    .delete()
    .eq('id', req.params.id)
    .eq('owner_id', req.user.id)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Posting not found' });
  res.status(204).end();
});

export default router;
