import { Router } from 'express';
import { drivingDistanceKm } from '../lib/googleMaps.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { notifyUser } from '../lib/notify.js';
import { sendWhatsAppLoadBroadcast } from '../lib/whatsapp.js';
import { NEARBY_RADIUS_KM, WHATSAPP_ALERT_CAP } from '../lib/notifyRadius.js';

const router = Router();

// Best-effort address string for the Distance Matrix API — includes
// everything that narrows down a location, and lets Google's own geocoding
// handle typos/partial addresses rather than us pre-validating anything.
function formatAddress(address, city, state, pincode) {
  return [address, city, state, pincode, 'India'].filter(Boolean).join(', ');
}

// A posting matches a load if: the truck's type is either exactly what the
// load asks for or 'other' (a free-text type we can't rule out), its
// capacity can carry the load's weight (or capacity isn't on file — don't
// exclude an owner just for an unfilled field), and the truck is either
// available right now or will be by the load's pickup date. Destination
// isn't matched here: preferred_routes/destination_preference are freeform
// text on truck_availabilities, not structured city/pincode fields, so
// there's nothing reliable to compare against the load's unloading point
// without geocoding that text first — a follow-up, not something this can
// silently fake today.
function matchesLoad(posting, load) {
  const truckType = posting.truck?.truck_type;
  if (truckType && truckType !== 'other' && truckType !== load.required_truck_type) return false;

  const capacity = posting.truck?.capacity_tons;
  if (capacity != null && Number(capacity) < Number(load.weight_tons)) return false;

  if (!posting.available_now) {
    if (!posting.available_from) return false;
    if (load.loading_date && posting.available_from > load.loading_date) return false;
  }

  return true;
}

// Fire-and-forget: tells the owner of every *available* truck posting within
// NEARBY_RADIUS_KM of this load's pickup point — filtered to postings whose
// vehicle type, capacity and availability date actually fit this load (see
// matchesLoad) — that a new load just showed up near them. Only 'available'
// postings are eligible — once a truck is booked on a trip (see
// loadBids.js's approve route), it drops out of this fan-out until it's
// posted available again. Never throws — a lookup failure here should never
// fail the load posting itself.
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
  // The trucks join brings in truck_type/capacity_tons for matchesLoad.
  const { data: postings, error: postingsError } = await supabaseAdmin
    .from('truck_availabilities')
    .select('id, owner_id, available_now, available_from, truck:trucks(truck_type, capacity_tons)')
    .eq('status', 'available')
    .in('current_pincode', nearby.map((r) => r.pincode))
    .neq('owner_id', req.user.id);
  if (postingsError) return console.error('[loads] nearby truck lookup failed', postingsError);

  const matches = (postings || []).filter((posting) => matchesLoad(posting, load));
  if (!matches.length) return;

  await Promise.all(
    matches.map((posting) =>
      notifyUser(posting.owner_id, {
        type: 'load_available_nearby',
        title: 'New load near your available truck',
        body: `A load${load.material_type ? ` (${load.material_type})` : ''} was posted near ${load.loading_city || load.loading_pincode}`,
        data: { load_id: load.id, truck_availability_id: posting.id }
      })
    )
  );

  // WhatsApp goes to each matched owner's own verified account number only
  // — same trust model as the OTP login flow and notifyNearbyLoads' reverse
  // direction, and avoids texting a number that was never confirmed to
  // belong to this account.
  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, mobile, mobile_verified')
    .in('user_id', matches.map((m) => m.owner_id));
  if (profilesError) return console.error('[loads] owner profile lookup failed', profilesError);

  const verified = (profiles || []).filter((p) => p.mobile_verified && p.mobile);
  if (!verified.length) return;

  // Best-effort, capped, and settled independently — a WhatsApp send
  // failure (missing template config, API hiccup, etc.) must never take
  // down the in-app notifications above, or stop the other capped sends.
  const capped = verified.slice(0, WHATSAPP_ALERT_CAP);
  const route = `${load.loading_city || load.loading_pincode} → ${load.unloading_city || load.unloading_pincode}`;
  const pickup = [load.loading_date, load.loading_time].filter(Boolean).join(' ');
  const results = await Promise.allSettled(
    capped.map((profile) =>
      sendWhatsAppLoadBroadcast(profile.mobile, {
        loadId: load.id,
        route,
        vehicleType: load.required_truck_type,
        tonnage: load.weight_tons,
        pickup,
        freight: load.bhada_price
      })
    )
  );
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('[loads] WhatsApp load broadcast failed', r.reason);
  });
}

// GET /api/loads?truck_type=tata_407&location=110001&material_type=cement — mirrors
// FindLoads.jsx's query, filtering on the same fields PostLoadScreen collects
// GET /api/loads?mine=true — the caller's own posted loads, any status (for the home dashboard)
router.get('/', async (req, res) => {
  const { truck_type, location, material_type, mine } = req.query;

  // Clamp the page size — a client asking for ?limit=100000 shouldn't be able
  // to pull the whole table in one response. Same guard as
  // wallet.js's /transactions.
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);

  let query = req.supabase
    .from('loads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (mine === 'true') {
    query = query.eq('posted_by', req.user.email);
  } else {
    query = query.eq('status', 'active');
    if (truck_type && truck_type !== 'all') query = query.eq('required_truck_type', truck_type);
    // One box, multiple picks: each entry is a pincode (matched anywhere in
    // either pincode field) or a city name (matched anywhere in either city
    // field, case-insensitive) — the mobile picker lets the caller select
    // several cities/pincodes at once (repeated ?location= params, so
    // req.query.location is an array once there's more than one), and a
    // load matching ANY of them should show up. There's no reference table
    // mapping pincodes to city names (pincode_centroids only has lat/lng/
    // state — see db/migrations/030_add_pincode_centroids.sql), so this only
    // knows what each load's own poster typed into its city fields, not a
    // canonical city grouping.
    const locations = (Array.isArray(location) ? location : location ? [location] : [])
      // Comma/parens are PostgREST's own or() filter syntax — strip them so
      // a value containing one can't break or hijack the filter expression.
      .map((loc) => String(loc).replace(/[,()]/g, '').trim())
      .filter(Boolean);
    if (locations.length) {
      const orFilter = locations
        .map((loc) => `loading_pincode.ilike.%${loc}%,unloading_pincode.ilike.%${loc}%,loading_city.ilike.%${loc}%,unloading_city.ilike.%${loc}%`)
        .join(',');
      query = query.or(orFilter);
    }
    if (material_type) query = query.ilike('material_type', `%${material_type}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST /api/loads — create a load (RLS enforces posted_by === caller's email)
router.post('/', async (req, res) => {
  // load_id is a sequential "LDnnnnnn" assigned by a column default
  // (db/migrations/045) and the uuid primary key is DB-generated — never let
  // a client set or override either.
  const { load_id, id, ...body } = req.body;
  const payload = { ...body, posted_by: req.user.email };

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

// GET /api/loads/:id — a single load by id. Added for the WhatsApp broadcast's
// "View Load"/"Bid" links (https://load24.in/loads/:id — see
// PlaceBidScreen.jsx's loadId param): those only carry an id, unlike
// LoadCard.jsx's in-app navigation which already has the whole load object
// on hand. Same RLS as the list route (req.supabase, not supabaseAdmin) —
// no special-casing for "opened from WhatsApp" beyond that.
router.get('/:id', async (req, res) => {
  const { data, error } = await req.supabase.from('loads').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Load not found' });
  res.json(data);
});

export default router;