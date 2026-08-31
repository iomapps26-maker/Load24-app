import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { notifyEmail } from '../../lib/notify.js';
import { releaseBidSecurityHold } from '../../lib/bidSecurityHold.js';
import { cancelBookingForLoad } from '../../lib/bookings.js';

const router = Router();

// GET /api/admin/trips — every active trip (loads with status in
// ('matched','in_transit')), joined with the poster/accepter profiles and
// the accepted load_bid. Mirrors the shape loadBids.js's
// GET /load/:load_id/trip-details builds for a single trip's two parties
// (around line 176-224), but across every such trip rather than one the
// caller is a party to — no KYC documents here though: those are minted
// per-trip on demand there for exactly two viewers, which doesn't scale to
// a list of every active trip the way it does for a single detail view.
router.get('/', async (req, res) => {
  const { data: loads, error } = await supabaseAdmin
    .from('loads')
    .select('*')
    .in('status', ['matched', 'in_transit'])
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  if (!loads || loads.length === 0) return res.json([]);

  const loadIds = loads.map((l) => l.id);
  const { data: bids, error: bidsError } = await supabaseAdmin
    .from('load_bids')
    .select('*')
    .in('load_id', loadIds)
    .eq('status', 'approved');
  if (bidsError) return res.status(400).json({ error: bidsError.message });

  const bidByLoadId = new Map((bids || []).map((b) => [b.load_id, b]));

  // The booking (spec §8) for each active trip — keyed by load_id, only the
  // live one (bookings_one_active_per_load).
  const { data: bookings, error: bookingsError } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_ref, load_id, status, amount, confirmed_at')
    .in('load_id', loadIds)
    .neq('status', 'cancelled');
  if (bookingsError) return res.status(400).json({ error: bookingsError.message });
  const bookingByLoadId = new Map((bookings || []).map((b) => [b.load_id, b]));

  const emails = new Set(loads.map((l) => l.posted_by));
  for (const bid of bids || []) emails.add(bid.bid_by_email);

  const { data: profiles, error: profilesError } = emails.size
    ? await supabaseAdmin
        .from('user_profiles')
        .select('user_id, user_email, full_name, mobile, user_type, city')
        .in('user_email', [...emails])
    : { data: [], error: null };
  if (profilesError) return res.status(400).json({ error: profilesError.message });

  const profileByEmail = new Map((profiles || []).map((p) => [p.user_email, p]));

  res.json(
    loads.map((load) => {
      const bid = bidByLoadId.get(load.id) || null;
      return {
        load,
        booking: bookingByLoadId.get(load.id) || null,
        bid: bid
          ? {
              id: bid.id,
              amount: bid.amount,
              truck_id: bid.truck_id,
              truck_number: bid.truck_number,
              bid_by_type: bid.bid_by_type,
              expected_pickup_at: bid.expected_pickup_at,
              reviewed_at: bid.reviewed_at
            }
          : null,
        poster: profileByEmail.get(load.posted_by) || null,
        accepter: bid ? profileByEmail.get(bid.bid_by_email) || null : null
      };
    })
  );
});

// POST /api/admin/trips/:loadId/cancel { reason? } — staff override: force
// a matched/in_transit trip to 'cancelled' regardless of which party would
// normally control that transition. Same status-guard as loadBids.js's
// POST /load/:load_id/deliver (only ever moves a trip out of
// matched/in_transit) — deliberately doesn't touch truck_availabilities
// either, matching that same route's scope; nothing in this codebase
// reverts a truck's availability status back to 'available' after a trip
// ends, staff-cancelled or delivered alike, so this doesn't introduce new,
// inconsistent behavior on that front.
router.post('/:loadId/cancel', async (req, res) => {
  const { reason } = req.body;

  const { data: load, error: loadError } = await supabaseAdmin.from('loads').select('*').eq('id', req.params.loadId).maybeSingle();
  if (loadError) return res.status(400).json({ error: loadError.message });
  if (!load) return res.status(404).json({ error: 'Load not found' });
  if (!['matched', 'in_transit'].includes(load.status)) {
    return res.status(409).json({ error: 'This trip is not in a cancellable state' });
  }

  const { data: bid, error: bidError } = await supabaseAdmin
    .from('load_bids')
    .select('id, load_id, bid_by_email, security_hold_txn_id, security_hold_amount, security_hold_released_at')
    .eq('load_id', load.id)
    .eq('status', 'approved')
    .maybeSingle();
  if (bidError) return res.status(400).json({ error: bidError.message });

  const { data, error } = await supabaseAdmin
    .from('loads')
    .update({ status: 'cancelled' })
    .eq('id', load.id)
    .in('status', ['matched', 'in_transit'])
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  // Release the accepted bid's §5 security hold — the trip is off, so the
  // bidder gets their deposit back (best-effort, must not fail the cancel).
  if (bid) {
    await releaseBidSecurityHold(bid, { reason: 'trip cancelled by staff' }).catch((err) =>
      console.error('[admin/trips] hold release on cancel failed for bid', bid.id, err)
    );
  }

  // Move the booking (spec §8) to 'cancelled' — best-effort, mirrors the load.
  await cancelBookingForLoad(load.id, reason || 'cancelled by LOAD24 staff').catch((err) =>
    console.error('[admin/trips] booking cancel failed for load', load.id, err)
  );

  const body = reason || `${load.material_type ? `${load.material_type} — ` : ''}this trip was cancelled by LOAD24 staff`;
  await notifyEmail(load.posted_by, { type: 'trip_cancelled_by_staff', title: 'Trip cancelled', body, data: { load_id: load.id } });
  if (bid) {
    await notifyEmail(bid.bid_by_email, { type: 'trip_cancelled_by_staff', title: 'Trip cancelled', body, data: { load_id: load.id } });
  }

  res.json(data);
});

// GET /api/admin/trips/:loadId/pings — every location ping recorded for
// this trip, oldest first (so the admin map view can draw the route in
// order it was actually travelled).
router.get('/:loadId/pings', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('trip_location_pings')
    .select('*')
    .eq('load_id', req.params.loadId)
    .order('recorded_at', { ascending: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

export default router;
