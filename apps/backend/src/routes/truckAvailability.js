import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/requireRole.js';
import { notifyUser } from '../lib/notify.js';

const router = Router();
const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

// How far "nearby" reaches when fanning out a new-truck-available
// notification, and which roles would plausibly want a truck (driver/
// vehicle_owner post trucks themselves, so they're excluded).
const NEARBY_RADIUS_KM = 50;
const NOTIFY_ROLES = ['shipper', 'transporter', 'broker'];

// Fire-and-forget: finds shippers/transporters/brokers within
// NEARBY_RADIUS_KM of the posting's current_pincode (via the
// pincodes_within_radius() SQL function, see
// 030_add_pincode_centroids.sql) and notifies them a truck just became
// available near them. Never throws — a lookup failure (missing pincode, a
// pincode not in the centroid table, etc.) should never fail the posting
// itself, just silently skip the fan-out.
async function notifyNearbyUsers(req, posting) {
  if (!posting.current_pincode) return;

  const { data: nearby, error } = await req.supabase.rpc('pincodes_within_radius', {
    origin_pincode: posting.current_pincode,
    radius_km: NEARBY_RADIUS_KM
  });
  if (error) return console.error('[truck-availability] pincodes_within_radius failed', error);
  if (!nearby?.length) return;

  // user_profiles RLS only lets req.supabase see the caller's own row (or
  // staff), so finding *other* users near this pincode needs the
  // service-role client — same trust model as profileForEmail in loadBids.js.
  const { data: users, error: usersError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .in('pincode', nearby.map((r) => r.pincode))
    .in('user_type', NOTIFY_ROLES)
    .neq('user_id', posting.owner_id);
  if (usersError) return console.error('[truck-availability] nearby user lookup failed', usersError);

  await Promise.all(
    (users || []).map((u) =>
      notifyUser(u.user_id, {
        type: 'truck_available_nearby',
        title: 'Truck available near you',
        body: `A truck just became available near ${posting.current_city || posting.current_pincode}`,
        data: { truck_availability_id: posting.id }
      })
    )
  );
}

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

  // After the response, not before: the fan-out is a nice-to-have and can
  // take a bit longer than the post itself (RPC scan + a user_profiles
  // lookup + N inserts) — no reason to make the poster wait on it.
  notifyNearbyUsers(req, data).catch((err) => console.error('[truck-availability] notifyNearbyUsers failed', err));
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

// POST /api/truck-availability/:id/offer — staff-only: ops offers this
// posting a load, taking it out of the open 'available' pool. There's no
// direct shipper-to-truck offer flow yet (see 027_add_truck_availabilities.sql),
// so for now this transition is staff-initiated only — same trust model as
// trucks_update_staff/kyc_cases_update_staff.
router.post('/:id/offer', requireRole(STAFF_ROLES), async (req, res) => {
  const { data, error } = await req.supabase
    .from('truck_availabilities')
    .update({ status: 'offered', updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'available')
    .select()
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'Posting is not currently available' });

  await notifyUser(data.owner_id, {
    type: 'truck_availability_offered',
    title: 'New offer for your truck',
    body: 'A load offer has come in for one of your posted trucks',
    data: { truck_availability_id: data.id }
  });

  res.json(data);
});

export default router;
