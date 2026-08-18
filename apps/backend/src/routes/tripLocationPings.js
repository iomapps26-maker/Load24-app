import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const router = Router();

function dbError(res, error, fallbackMessage) {
  console.error('[trip-location-pings]', error);
  return res.status(400).json({ error: fallbackMessage });
}

// POST /api/trip-location-pings { load_id, lat, lng, recorded_at? } — the
// mobile app posts to this repeatedly during an active trip. Mounted with
// requireAuth only (see index.js) — not requireConsents like most other
// routes, and obviously not admin-gated.
//
// Authorization is enforced explicitly in JS rather than RLS: the caller
// must be one of the trip's two parties (the poster or the approved
// bidder). loads.posted_by / load_bids.bid_by_email are emails, not
// user_ids, so this can't be expressed as a clean RLS "owner_id = auth.uid()"
// check — same constraint loadBids.js's trip-details/deliver routes already
// document, and the same explicit-check-then-supabaseAdmin pattern they use.
router.post('/', async (req, res) => {
  const { load_id, lat, lng, recorded_at } = req.body;
  if (!load_id || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'load_id, lat and lng are required' });
  }

  const { data: load, error: loadError } = await req.supabase.from('loads').select('posted_by, status, material_type').eq('id', load_id).maybeSingle();
  if (loadError) return dbError(res, loadError, 'Could not load this trip');
  if (!load) return res.status(404).json({ error: 'Load not found' });
  if (!['matched', 'in_transit'].includes(load.status)) {
    return res.status(409).json({ error: 'This trip is not active' });
  }

  const { data: bid, error: bidError } = await req.supabase
    .from('load_bids')
    .select('bid_by_email')
    .eq('load_id', load_id)
    .eq('status', 'approved')
    .maybeSingle();
  if (bidError) return dbError(res, bidError, 'Could not load bidding details');

  const callerEmail = req.user.email;
  const isPoster = callerEmail === load.posted_by;
  const isAccepter = !!bid && callerEmail === bid.bid_by_email;
  if (!isPoster && !isAccepter) {
    return res.status(403).json({ error: 'Not authorized to report location for this trip' });
  }

  const { data, error } = await supabaseAdmin
    .from('trip_location_pings')
    .insert({
      load_id,
      lat,
      lng,
      recorded_at: recorded_at || new Date().toISOString(),
      reported_by: req.user.id
    })
    .select()
    .single();
  if (error) return dbError(res, error, 'Could not record this location ping');

  res.status(201).json(data);
});

export default router;
