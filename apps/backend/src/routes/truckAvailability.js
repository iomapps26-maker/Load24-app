import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { requireRole } from '../middleware/requireRole.js';
import { notifyUser } from '../lib/notify.js';
import { sendWhatsAppLoadAlert } from '../lib/whatsapp.js';
import { NEARBY_RADIUS_KM, WHATSAPP_ALERT_CAP } from '../lib/notifyRadius.js';

const router = Router();
const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

// Which roles would plausibly want a truck (driver/vehicle_owner post
// trucks themselves, so they're excluded).
const NOTIFY_ROLES = ['shipper', 'transporter', 'broker'];

// Looked up once per posting and shared by notifyNearbyUsers and
// notifyNearbyLoads below — both fan-outs need the same
// (posting.current_pincode, NEARBY_RADIUS_KM) pincode set, so this avoids
// hitting pincodes_within_radius() twice for a single truck-availability post.
async function nearbyPincodes(req, posting) {
  if (!posting.current_pincode) return [];

  const { data, error } = await req.supabase.rpc('pincodes_within_radius', {
    origin_pincode: posting.current_pincode,
    radius_km: NEARBY_RADIUS_KM
  });
  if (error) {
    console.error('[truck-availability] pincodes_within_radius failed', error);
    return [];
  }
  return data || [];
}

// Fire-and-forget: notifies shippers/transporters/brokers within `nearby`
// pincodes (via the pincodes_within_radius() SQL function, see
// 030_add_pincode_centroids.sql) that a truck just became available near
// them. Never throws — a lookup failure should never fail the posting
// itself, just silently skip the fan-out.
async function notifyNearbyUsers(posting, nearby) {
  if (!nearby.length) return;

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

// Fire-and-forget, the mirror of notifyNearbyUsers: tells the truck owner
// about loads that are *already* posted and active within `nearby`
// pincodes of where they just said their truck is. Matched on the load's
// pickup point (loading_pincode) since that's what the truck would need to
// reach.
async function notifyNearbyLoads(req, posting, nearby) {
  if (!nearby.length) return;

  // Same trust model as notifyNearbyUsers — loads posted by other users
  // aren't visible to this caller under RLS, so this needs the service-role
  // client.
  const { data: loads, error: loadsError } = await supabaseAdmin
    .from('loads')
    .select('id, material_type, loading_city, loading_pincode, posted_by')
    .eq('status', 'active')
    .in('loading_pincode', nearby.map((r) => r.pincode))
    .neq('posted_by', req.user.email);
  if (loadsError) return console.error('[truck-availability] nearby load lookup failed', loadsError);
  if (!loads?.length) return;

  await Promise.all(
    loads.map((load) =>
      notifyUser(posting.owner_id, {
        type: 'load_available_nearby',
        title: 'Load available near you',
        body: `A load${load.material_type ? ` (${load.material_type})` : ''} is posted near ${load.loading_city || load.loading_pincode}`,
        data: { load_id: load.id, truck_availability_id: posting.id }
      })
    )
  );

  // WhatsApp goes to the truck owner's own verified account number — same
  // trust model as the OTP login flow, and avoids texting a number that was
  // never confirmed to belong to this account.
  const { data: ownerProfile, error: ownerError } = await supabaseAdmin
    .from('user_profiles')
    .select('mobile, mobile_verified')
    .eq('user_id', posting.owner_id)
    .maybeSingle();
  if (ownerError) console.error('[truck-availability] owner profile lookup failed', ownerError);
  const ownerPhone = ownerProfile?.mobile_verified ? ownerProfile.mobile : null;
  if (!ownerPhone) return;

  // Best-effort, capped, and settled independently — a WhatsApp send
  // failure (missing template config, API hiccup, etc.) must never take
  // down the in-app notifications above, or stop the other capped sends.
  const capped = loads.slice(0, WHATSAPP_ALERT_CAP);
  const results = await Promise.allSettled(
    capped.map((load) =>
      sendWhatsAppLoadAlert(ownerPhone, {
        material: load.material_type,
        city: load.loading_city || load.loading_pincode
      })
    )
  );
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('[truck-availability] WhatsApp load alert failed', r.reason);
  });
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
  // lookup + N inserts) — no reason to make the poster wait on it. Both
  // fan-outs need the same nearby-pincode set, so it's resolved once here
  // and shared instead of each function hitting pincodes_within_radius() on
  // its own.
  nearbyPincodes(req, data)
    .then((nearby) => {
      notifyNearbyUsers(data, nearby).catch((err) => console.error('[truck-availability] notifyNearbyUsers failed', err));
      notifyNearbyLoads(req, data, nearby).catch((err) => console.error('[truck-availability] notifyNearbyLoads failed', err));
    })
    .catch((err) => console.error('[truck-availability] nearbyPincodes failed', err));
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
