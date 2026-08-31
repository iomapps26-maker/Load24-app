import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';
import { notifyEmail } from '../lib/notify.js';
import { applyWalletAdjustment, getOrCreateWallet, getAvailableBalance } from '../lib/wallet.js';
import { getBiddingSettings } from '../lib/platformSettings.js';
import { checkBidEligibility, TRUCK_REQUIRED_ROLES } from '../lib/bidEligibility.js';
import { placeBidSecurityHold, releaseBidSecurityHold, sweepExpiredBidHolds } from '../lib/bidSecurityHold.js';
import {
  createBookingForConfirmedBid,
  ensureBooking,
  getBookingByLoadId,
  completeBookingForLoad
} from '../lib/bookings.js';

// The load_bids columns that track a bid's security hold (§5, migration 047)
// — read wherever a hold might need releasing so releaseBidSecurityHold can
// decide idempotently.
const SECURITY_HOLD_COLUMNS = 'id, load_id, bid_by_email, security_hold_txn_id, security_hold_amount, security_hold_released_at';

const TRIP_DOCS_BUCKET = 'trip-documents';
const TRIP_DOC_URL_TTL_SECONDS = 300;
// The paperwork either trip party can attach on the Trip Details screen once
// a bid is approved (see migrations/044_add_trip_documents.sql).
const TRIP_DOCUMENT_TYPES = ['eway_bill', 'bilty'];

const router = Router();

// Supabase/PostgREST error.message can be raw internal detail (missing
// table, column, constraint names) — never forward it to the client. Log
// the real error for debugging and send a generic message instead.
function dbError(res, error, fallbackMessage) {
  console.error('[load-bids]', error);
  return res.status(400).json({ error: fallbackMessage });
}

// Any pending bid whose 1-minute window has passed but hasn't been acted on
// yet is treated as rejected — checked lazily whenever bids are read, same
// approach as the WhatsApp OTP expires_at column (see whatsappAuth.js)
// rather than a background job. Each bid it rejects gets its §5 security
// hold released back to the bidder (best-effort — a release failure must
// not stop the others or the read that triggered this).
async function autoRejectExpired(supabase, load_id) {
  const nowIso = new Date().toISOString();

  const { data: expiring } = await supabase
    .from('load_bids')
    .select(SECURITY_HOLD_COLUMNS)
    .eq('load_id', load_id)
    .eq('status', 'pending')
    .lt('expires_at', nowIso);
  if (!expiring?.length) return;

  await supabase
    .from('load_bids')
    .update({ status: 'rejected', reviewed_at: nowIso })
    .eq('load_id', load_id)
    .eq('status', 'pending')
    .lt('expires_at', nowIso);

  for (const bid of expiring) {
    await releaseBidSecurityHold(bid, { reason: 'bid expired' }).catch((err) =>
      console.error('[load-bids] expired hold release failed for bid', bid.id, err)
    );
  }
}

// Prevent double booking (spec §9): the moment one bid on a load is accepted,
// every other still-pending bid on that load is out. Flip them 'rejected' right
// away — rather than leaving them for the 1-minute lazy expiry
// (autoRejectExpired) — and hand each bidder back their §5 security hold.
// Best-effort: the approval this follows is already committed, so a failure
// here just means a sibling hold frees a little later (its own lazy expiry
// still catches it). Mirrors autoRejectExpired above.
async function rejectSiblingBids(supabase, load_id, approvedBidId) {
  const nowIso = new Date().toISOString();

  const { data: siblings } = await supabase
    .from('load_bids')
    .select(SECURITY_HOLD_COLUMNS)
    .eq('load_id', load_id)
    .eq('status', 'pending')
    .neq('id', approvedBidId);
  if (!siblings?.length) return;

  await supabase
    .from('load_bids')
    .update({ status: 'rejected', reviewed_at: nowIso })
    .eq('load_id', load_id)
    .eq('status', 'pending')
    .neq('id', approvedBidId);

  for (const sib of siblings) {
    await releaseBidSecurityHold(sib, { reason: 'another bid was approved' }).catch((err) =>
      console.error('[load-bids] sibling hold release failed for bid', sib.id, err)
    );
    await notifyEmail(sib.bid_by_email, {
      type: 'bid_rejected',
      title: 'Your bid was not selected',
      body: 'This load was awarded to another bidder',
      data: { load_id, bid_id: sib.id }
    }).catch((err) => console.error('[load-bids] sibling reject notify failed for bid', sib.id, err));
  }
}

// Spec §8 "Load Confirmation" preconditions, re-checked the moment the poster
// confirms rather than trusted from when the bid was placed. Between bidding
// and confirmation the winning bidder could have been deactivated, put under a
// bidding restriction, had a vehicle document lapse or lose verification, or
// had their §5 security hold released by another path. Any of those must block
// the confirmation — the load stays open for other bids — instead of locking a
// load to a bid that no longer qualifies.
//
// Reads the bidder's profile and truck on the service-role client: req.supabase
// is scoped to the poster, whose RLS can't see the other party's rows (same
// reason profileForEmail below switches clients). `bid` must carry
// bid_by_email, truck_id, security_hold_txn_id and security_hold_released_at;
// `load` carries required_truck_type / required_truck_type_other / weight_tons.
// Returns { status, body } to forward verbatim, or null when the bid may be
// confirmed.
async function assertConfirmable(bid, load) {
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('kyc_status, is_active, mobile_verified, user_type, bidding_restricted_until, bidding_restriction_reason')
    .eq('user_email', bid.bid_by_email)
    .maybeSingle();

  let truck = null;
  if (bid.truck_id && TRUCK_REQUIRED_ROLES.includes(profile?.user_type)) {
    const { data: truckRow } = await supabaseAdmin
      .from('trucks')
      .select('verified, truck_type, truck_type_other, capacity_tons, permit_expiry, puc_expiry, insurance_expiry')
      .eq('id', bid.truck_id)
      .maybeSingle();
    truck = truckRow;
  }

  // load.status is forced 'active' here on purpose — the atomic
  // 'active' -> 'matched' claim right after this call is the real load-state
  // gate; from checkBidEligibility we only want the account/vehicle verdict.
  const ineligible = checkBidEligibility({ profile, load: { ...load, status: 'active' }, truck, now: new Date() });
  if (ineligible) {
    return {
      status: 409,
      body: {
        error: `This bid can't be confirmed — the bidder is no longer eligible (${ineligible.body.error})`,
        code: 'bidder_ineligible',
        reason: ineligible.body
      }
    };
  }

  // §5 security deposit: the hold placed when the bid was made must still be
  // active. If the platform currently charges no deposit, there's nothing to
  // verify (a bid placed while it was 0 also carries no hold).
  const { security_deposit_amount } = await getBiddingSettings();
  if (Number(security_deposit_amount) > 0 && (!bid.security_hold_txn_id || bid.security_hold_released_at)) {
    return {
      status: 409,
      body: {
        error: "This bid can't be confirmed — its security deposit hold is no longer active",
        code: 'security_hold_inactive'
      }
    };
  }

  return null;
}

// user_profiles RLS only lets a row's own owner (or staff) select it, so
// once we've authorized the caller as one of the two trip parties above, we
// deliberately switch to the service-role client to read the *other*
// party's profile/documents — same trust model kyc.js uses for signed URLs.
async function profileForEmail(email) {
  const { data } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, full_name, mobile, user_type, company_name, city, state, trust_score, rating_score, total_ratings, kyc_status')
    .eq('user_email', email)
    .maybeSingle();
  return data;
}

// The E-Way Bill / Bilty attached to this trip, keyed by document_type, each
// with a short-lived (5 min) signed view URL minted fresh on every
// trip-details fetch rather than stored/cached so a leaked link stops
// working quickly. Shape: { eway_bill?: {...}, bilty?: {...} }.
async function tripDocumentsForLoad(loadId) {
  const { data: rows } = await supabaseAdmin
    .from('trip_documents')
    .select('document_type, file_name, mime_type, storage_path, uploaded_by_email, updated_at')
    .eq('load_id', loadId);
  if (!rows?.length) return {};

  const entries = await Promise.all(
    rows.map(async ({ document_type, file_name, mime_type, storage_path, uploaded_by_email, updated_at }) => {
      const { data } = await supabaseAdmin.storage.from(TRIP_DOCS_BUCKET).createSignedUrl(storage_path, TRIP_DOC_URL_TTL_SECONDS);
      return [document_type, { document_type, file_name, mime_type, uploaded_by_email, updated_at, url: data?.signedUrl ?? null }];
    })
  );
  return Object.fromEntries(entries);
}

// Shared by the two trip-document routes below: resolves the load and its
// approved bid and checks the caller is one of the trip's two parties. Same
// explicit-JS-check constraint trip-details/deliver document (the parties are
// identified by email, not a user_id RLS can key on). Returns { status, error }
// on failure so the caller can forward it verbatim.
async function resolveTripForParty(req) {
  const { data: load, error: loadError } = await req.supabase
    .from('loads').select('*').eq('id', req.params.load_id).maybeSingle();
  if (loadError) { console.error('[load-bids]', loadError); return { status: 400, error: 'Could not load this load' }; }
  if (!load) return { status: 404, error: 'Load not found' };

  const { data: bid, error: bidError } = await req.supabase
    .from('load_bids').select('*').eq('load_id', req.params.load_id).eq('status', 'approved').maybeSingle();
  if (bidError) { console.error('[load-bids]', bidError); return { status: 400, error: 'Could not load bidding details' }; }
  if (!bid) return { status: 404, error: 'No accepted bid yet for this load' };

  const isPoster = req.user.email === load.posted_by;
  const isAccepter = req.user.email === bid.bid_by_email;
  if (!isPoster && !isAccepter) return { status: 403, error: 'Not authorized to view trip details for this load' };

  return { load, bid, isPoster, isAccepter };
}

// Picks the highest-specificity active commission_rules row matching this
// trip's material_type/required_truck_type — both fields are nullable
// wildcards on a rule, so one naming neither, either, or both dimensions
// can all match the same trip; a rule with both set wins over one with
// only one set, which wins over a fully generic rule, ties broken by
// whichever matching rule was created most recently. Fetches the whole
// table (small, staff-managed via admin/commissionRules.js) rather than
// building a filter string — same reasoning loads.js's location search
// strips commas/parens for: a user-typed material_type could contain
// characters that break or hijack a PostgREST .or() filter expression, and
// this table is tiny enough that filtering in JS just avoids the problem
// outright instead of sanitizing around it.
async function findMatchingCommissionRule(materialType, vehicleType) {
  const { data: rules, error } = await supabaseAdmin.from('commission_rules').select('*').eq('is_active', true);
  if (error) throw error;

  const candidates = (rules || []).filter(
    (r) => (r.material_type === null || r.material_type === materialType) && (r.vehicle_type === null || r.vehicle_type === vehicleType)
  );
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const specificity = (r) => (r.material_type !== null ? 1 : 0) + (r.vehicle_type !== null ? 1 : 0);
    const diff = specificity(b) - specificity(a);
    if (diff !== 0) return diff;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  return candidates[0];
}

// Charges the accepter (the party who earns the trip's bid amount) a
// commission on trip completion, if an active rule matches — reuses the
// exact ledger-write POST /api/wallet/adjust uses for a staff-typed manual
// adjustment (applyWalletAdjustment, lib/wallet.js) rather than duplicating
// it. Never throws: a rule-lookup or ledger-write failure here shouldn't
// stop a trip from being marked delivered, the same "best-effort side
// effect" treatment loads.js's notifyNearbyTruckOwners gives its own
// fan-out. A trip with no matching active rule is a normal, silent no-op —
// not an error.
async function applyCommissionForCompletedTrip(load, bid) {
  try {
    const rule = await findMatchingCommissionRule(load.material_type, load.required_truck_type);
    if (!rule) return;

    const accepterProfile = await profileForEmail(bid.bid_by_email);
    if (!accepterProfile) return;

    const amount = Number(bid.amount) * (Number(rule.rate_percent) / 100);
    if (!(amount > 0)) return;

    await applyWalletAdjustment({
      user_id: accepterProfile.user_id,
      type: 'commission',
      amount,
      reference_load_id: load.id,
      notes: `Auto-applied ${rule.rate_percent}% commission rule (${rule.id}) on trip completion`
    });
  } catch (err) {
    console.error('[load-bids] commission auto-apply failed', err);
  }
}

// GET /api/load-bids/mine — bids the current user has placed, with the load
// embedded (via the load_id FK) so an approved bid can be rendered as a trip
// card (route, material, price) on the home screen without a second
// per-load fetch — the bidder loses the load from GET /api/loads the moment
// it's matched (that endpoint only lists status='active'), so this is their
// only remaining way to see it.
router.get('/mine', async (req, res) => {
  const { data, error } = await req.supabase
    .from('load_bids')
    .select('*, load:loads(*)')
    .eq('bid_by_email', req.user.email)
    .order('created_at', { ascending: false });

  if (error) return dbError(res, error, 'Could not load your bids');

  // Free any §5 security hold stuck on a bid whose 1-minute window lapsed
  // without the poster ever opening "See Bidding" (the only other place
  // expired bids get swept). Best-effort — never block the bidder's list on it.
  await sweepExpiredBidHolds(data).catch((err) => console.error('[load-bids] expired hold sweep failed', err));

  // Attach the booking (spec §8) to each approved bid so the home-screen trip
  // card can show the reference. Merged in JS rather than a PostgREST embed so
  // the shape is predictable; RLS (bookings_select_parties_or_staff) lets the
  // bidder read their own via accepter_email.
  const approvedIds = (data || []).filter((b) => b.status === 'approved').map((b) => b.id);
  if (approvedIds.length) {
    const { data: bookings } = await req.supabase
      .from('bookings')
      .select('bid_id, booking_ref, status')
      .in('bid_id', approvedIds);
    const byBidId = new Map((bookings || []).map((bk) => [bk.bid_id, bk]));
    for (const bid of data) bid.booking = byBidId.get(bid.id) ?? null;
  }

  res.json(data);
});

// GET /api/load-bids/config — the tunable bidding values PlaceBidScreen
// renders as its payment breakup: the Load24 charge percentage and the
// security-deposit amount that POST / below moves into a wallet hold (§5).
// Staff change these from the admin panel (PATCH /api/admin/platform-settings/bidding).
router.get('/config', async (req, res) => {
  try {
    res.json(await getBiddingSettings());
  } catch (error) {
    return dbError(res, error, 'Could not load bidding settings');
  }
});

// POST /api/load-bids — place a bid amount on a load
router.post('/', async (req, res) => {
  const { load_id, amount, bid_by_type, truck_id, truck_number, expected_pickup_at } = req.body;
  if (!load_id) return res.status(400).json({ error: 'load_id is required' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });

  // Expected pickup date/time is optional, but if sent it must be a real
  // date — normalize to an ISO string so the timestamptz column stores it
  // consistently regardless of what format the client sent.
  let expectedPickupAt = null;
  if (expected_pickup_at != null && expected_pickup_at !== '') {
    const parsed = new Date(expected_pickup_at);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'expected_pickup_at is not a valid date' });
    }
    expectedPickupAt = parsed.toISOString();
  }

  // Bid eligibility (marketplace spec §2): the caller's account — and, for a
  // driver/vehicle_owner, their chosen vehicle — must clear every condition in
  // lib/bidEligibility.js before a bid is accepted. RLS (load_bids_insert_own,
  // migrations 045/046) is the real boundary for the account-level conditions;
  // this is the friendly per-reason path, and the only place the vehicle
  // conditions are enforced. user_profiles / loads / trucks RLS each let the
  // caller read their own row.
  const { data: bidderProfile, error: bidderProfileError } = await req.supabase
    .from('user_profiles')
    .select('kyc_status, is_active, mobile_verified, user_type, bidding_restricted_until, bidding_restriction_reason')
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (bidderProfileError) return dbError(res, bidderProfileError, 'Could not verify your account');

  const { data: load, error: loadError } = await req.supabase
    .from('loads')
    .select('posted_by, status, required_truck_type, required_truck_type_other, weight_tons')
    .eq('id', load_id)
    .single();
  if (loadError) return dbError(res, loadError, 'Could not find this load');
  if (load.posted_by === req.user.email) {
    return res.status(403).json({ error: 'You cannot bid on your own posted load' });
  }

  // A driver/vehicle_owner must bid with one of their own registered trucks;
  // checkBidEligibility then validates it (verified, matching type/capacity,
  // unexpired documents). Every other role bids without a vehicle.
  let bidderTruck = null;
  if (TRUCK_REQUIRED_ROLES.includes(bidderProfile?.user_type)) {
    if (!truck_id) {
      return res.status(403).json({ error: 'Select a verified vehicle to bid on this load', code: 'vehicle_required' });
    }
    const { data: truckRow, error: truckError } = await req.supabase
      .from('trucks')
      .select('verified, truck_type, truck_type_other, capacity_tons, permit_expiry, puc_expiry, insurance_expiry')
      .eq('id', truck_id)
      .eq('owner_id', req.user.id)
      .maybeSingle();
    if (truckError) return dbError(res, truckError, 'Could not verify your vehicle');
    if (!truckRow) {
      return res.status(403).json({ error: 'Select one of your registered vehicles to bid', code: 'vehicle_required' });
    }
    bidderTruck = truckRow;
  }

  const ineligible = checkBidEligibility({ profile: bidderProfile, load, truck: bidderTruck, now: new Date() });
  if (ineligible) return res.status(ineligible.status).json(ineligible.body);

  // ₹1,000 Load Confirmation Rule (marketplace spec §5): placing a bid moves
  // the configurable security-deposit amount into a real wallet HOLD (a
  // 'security_hold' ledger entry — see lib/bidSecurityHold.js), not just a
  // balance check. Checked against available balance first (money already
  // committed to a pending withdrawal doesn't count), same "spendable right
  // now" figure POST /api/wallet/withdraw guards on. The hold is released
  // automatically when the bid is declined/expires or the resulting trip
  // completes/cancels; the amount is snapshotted on the bid so a later
  // Super-Admin change doesn't retro-alter it.
  const { security_deposit_amount } = await getBiddingSettings();
  const depositAmount = Number(security_deposit_amount);
  let holdTxn = null;
  if (depositAmount > 0) {
    const wallet = await getOrCreateWallet(req.user.id);
    const available = await getAvailableBalance(wallet);
    if (available < depositAmount) {
      return res.status(402).json({
        error: `Keep ₹${depositAmount.toLocaleString('en-IN')} in your wallet as a security deposit before placing a bid`,
        code: 'security_deposit_required',
        security_deposit_amount: depositAmount,
        wallet_balance: available
      });
    }
    try {
      holdTxn = await placeBidSecurityHold({ userId: req.user.id, loadId: load_id, amount: depositAmount });
    } catch (err) {
      return dbError(res, err, 'Could not place the security hold for your bid');
    }
  }

  const { data, error } = await req.supabase
    .from('load_bids')
    .insert({
      load_id,
      bid_by_email: req.user.email,
      bid_by_type,
      truck_id,
      truck_number,
      amount,
      expected_pickup_at: expectedPickupAt,
      security_hold_txn_id: holdTxn?.id ?? null,
      security_hold_amount: holdTxn ? depositAmount : null
    })
    .select()
    .single();

  if (error) {
    // The bid row didn't persist — undo the hold so the bidder isn't left
    // with money locked against a bid that doesn't exist.
    if (holdTxn) {
      await applyWalletAdjustment({
        user_id: req.user.id,
        type: 'security_release',
        amount: depositAmount,
        reference_load_id: load_id,
        notes: 'Security release — bid could not be saved'
      }).catch((releaseErr) => console.error('[load-bids] hold rollback failed', releaseErr));
    }
    return dbError(res, error, 'Could not place your bid');
  }

  await notifyEmail(load.posted_by, {
    type: 'bid_placed',
    title: 'New bid on your load',
    body: `₹${Number(amount).toLocaleString('en-IN')} bid received`,
    data: { load_id, bid_id: data.id }
  });

  res.status(201).json(data);
});

// GET /api/load-bids/load/:load_id — poster-only "See Bidding" view: the load
// plus every bid placed on it. RLS (load_bids_select_own_or_poster) already
// keeps this to the load's poster or the bidder themselves.
router.get('/load/:load_id', async (req, res) => {
  await autoRejectExpired(req.supabase, req.params.load_id);

  const { data: load, error: loadError } = await req.supabase
    .from('loads')
    .select('*')
    .eq('id', req.params.load_id)
    .single();
  if (loadError) return dbError(res, loadError, 'Could not load this load');

  const { data: bids, error: bidsError } = await req.supabase
    .from('load_bids')
    .select('*')
    .eq('load_id', req.params.load_id)
    .order('created_at', { ascending: false });
  if (bidsError) return dbError(res, bidsError, 'Could not load bids for this load');

  // Once one bid is approved this load has a booking (spec §8) — hand it to the
  // poster's "See Bidding" view so it can show the reference next to the
  // confirmed bid without a second round-trip.
  const booking = bids?.some((b) => b.status === 'approved')
    ? await getBookingByLoadId(req.params.load_id).catch((err) => {
        console.error('[load-bids] getBookingByLoadId failed for load', req.params.load_id, err);
        return null;
      })
    : null;

  res.json({ load, bids, booking });
});

// GET /api/load-bids/load/:load_id/trip-details — once a bid on this load
// has been approved, both counterparties (the poster and the approved
// bidder) can see each other's contact details, profile, and KYC documents.
// Authorization is enforced explicitly in JS (not just RLS) because the
// documents/profile lookups below run on the service-role client, which
// bypasses RLS entirely.
router.get('/load/:load_id/trip-details', async (req, res) => {
  const { data: load, error: loadError } = await req.supabase
    .from('loads')
    .select('*')
    .eq('id', req.params.load_id)
    .maybeSingle();
  if (loadError) return dbError(res, loadError, 'Could not load this load');
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const { data: bid, error: bidError } = await req.supabase
    .from('load_bids')
    .select('*')
    .eq('load_id', req.params.load_id)
    .eq('status', 'approved')
    .maybeSingle();
  if (bidError) return dbError(res, bidError, 'Could not load bidding details');
  if (!bid) return res.status(404).json({ error: 'No accepted bid yet for this load' });

  const callerEmail = req.user.email;
  const isPoster = callerEmail === load.posted_by;
  const isAccepter = callerEmail === bid.bid_by_email;
  if (!isPoster && !isAccepter) {
    return res.status(403).json({ error: 'Not authorized to view trip details for this load' });
  }

  const [posterProfile, accepterProfile, tripDocuments, booking] = await Promise.all([
    profileForEmail(load.posted_by),
    profileForEmail(bid.bid_by_email),
    tripDocumentsForLoad(load.id),
    // Spec §8: the confirmed-trip record. ensureBooking backfills one for a
    // confirmation that predates the bookings table (migration 049) or whose
    // best-effort create in POST /:id/approve failed.
    ensureBooking({ load, bid }).catch((err) => {
      console.error('[load-bids] ensureBooking failed for bid', bid.id, err);
      return null;
    })
  ]);

  res.json({
    // E-Way Bill / Bilty either party attached to this trip, keyed by type.
    trip_documents: tripDocuments,
    viewer_role: isPoster ? 'poster' : 'accepter',
    load,
    booking,
    bid: {
      id: bid.id,
      booking_ref: booking?.booking_ref ?? null,
      amount: bid.amount,
      truck_id: bid.truck_id,
      truck_number: bid.truck_number,
      bid_by_type: bid.bid_by_type,
      expected_pickup_at: bid.expected_pickup_at,
      reviewed_at: bid.reviewed_at
    },
    poster: {
      email: load.posted_by,
      full_name: posterProfile?.full_name ?? null,
      mobile: posterProfile?.mobile ?? null,
      user_type: posterProfile?.user_type ?? load.poster_type ?? null,
      company_name: posterProfile?.company_name ?? load.company_name ?? null,
      city: posterProfile?.city ?? null,
      state: posterProfile?.state ?? null,
      trust_score: posterProfile?.trust_score ?? null,
      rating_score: posterProfile?.rating_score ?? null,
      total_ratings: posterProfile?.total_ratings ?? null,
      kyc_status: posterProfile?.kyc_status ?? null
    },
    accepter: {
      email: bid.bid_by_email,
      full_name: accepterProfile?.full_name ?? bid.bid_by_name ?? null,
      mobile: accepterProfile?.mobile ?? bid.bid_by_mobile ?? null,
      user_type: accepterProfile?.user_type ?? bid.bid_by_type ?? null,
      company_name: accepterProfile?.company_name ?? null,
      city: accepterProfile?.city ?? null,
      state: accepterProfile?.state ?? null,
      trust_score: accepterProfile?.trust_score ?? null,
      rating_score: accepterProfile?.rating_score ?? null,
      total_ratings: accepterProfile?.total_ratings ?? null,
      kyc_status: accepterProfile?.kyc_status ?? null
    }
  });
});

// POST /api/load-bids/load/:load_id/documents/upload-url { document_type, file_name }
// — mints a signed Storage upload URL for one of this trip's two document
// slots (eway_bill / bilty). Same signed-upload-URL-then-confirm shape as
// wallet.js's payment-proof flow; either trip party may upload or replace.
router.post('/load/:load_id/documents/upload-url', async (req, res) => {
  const { document_type, file_name } = req.body;
  if (!TRIP_DOCUMENT_TYPES.includes(document_type)) {
    return res.status(400).json({ error: 'document_type must be eway_bill or bilty' });
  }

  const trip = await resolveTripForParty(req);
  if (trip.error) return res.status(trip.status).json({ error: trip.error });

  const ext = file_name && file_name.includes('.') ? file_name.split('.').pop().toLowerCase() : 'jpg';
  const storage_path = `${req.user.id}/${trip.load.id}-${document_type}.${ext}`;

  await supabaseAdmin.storage.from(TRIP_DOCS_BUCKET).remove([storage_path]);
  const { data, error } = await supabaseAdmin.storage.from(TRIP_DOCS_BUCKET).createSignedUploadUrl(storage_path);
  if (error) return dbError(res, error, 'Could not start the upload');

  res.status(200).json({ storage_path, signed_url: data.signedUrl, token: data.token });
});

// POST /api/load-bids/load/:load_id/documents { document_type, storage_path, file_name, mime_type }
// — records a file already uploaded via the signed URL above against the
// trip. Upserts on (load_id, document_type) so a re-upload just replaces it,
// removing the previous object (which may sit under the other party's folder).
router.post('/load/:load_id/documents', async (req, res) => {
  const { document_type, storage_path, file_name, mime_type } = req.body;
  if (!TRIP_DOCUMENT_TYPES.includes(document_type)) {
    return res.status(400).json({ error: 'document_type must be eway_bill or bilty' });
  }
  if (!storage_path) return res.status(400).json({ error: 'storage_path is required' });
  if (!storage_path.startsWith(`${req.user.id}/`)) {
    return res.status(403).json({ error: 'storage_path does not belong to this account' });
  }

  const trip = await resolveTripForParty(req);
  if (trip.error) return res.status(trip.status).json({ error: trip.error });

  const { data: existing } = await supabaseAdmin
    .from('trip_documents')
    .select('storage_path')
    .eq('load_id', trip.load.id)
    .eq('document_type', document_type)
    .maybeSingle();
  if (existing?.storage_path && existing.storage_path !== storage_path) {
    await supabaseAdmin.storage.from(TRIP_DOCS_BUCKET).remove([existing.storage_path]);
  }

  const { data, error } = await supabaseAdmin
    .from('trip_documents')
    .upsert(
      {
        load_id: trip.load.id,
        bid_id: trip.bid.id,
        document_type,
        uploaded_by: req.user.id,
        uploaded_by_email: req.user.email,
        storage_path,
        file_name: file_name ?? null,
        mime_type: mime_type ?? null,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'load_id,document_type' }
    )
    .select('document_type, file_name')
    .single();
  if (error) return dbError(res, error, 'Could not save this document');

  res.status(200).json({ ok: true, document: data });
});

// POST /api/load-bids/load/:load_id/deliver — either trip party (the poster or
// the approved bidder) can mark a trip delivered. Authorized in JS the same
// way trip-details is above: the load must have an approved bid, and the
// caller must be one of its two parties. Writes via supabaseAdmin — RLS
// (loads_update_own_or_staff) only lets the poster write to a loads row, but
// the accepter needs to be able to close out the trip too.
router.post('/load/:load_id/deliver', async (req, res) => {
  const { data: load, error: loadError } = await req.supabase
    .from('loads')
    .select('*')
    .eq('id', req.params.load_id)
    .maybeSingle();
  if (loadError) return dbError(res, loadError, 'Could not load this load');
  if (!load) return res.status(404).json({ error: 'Load not found' });

  const { data: bid, error: bidError } = await req.supabase
    .from('load_bids')
    .select('*')
    .eq('load_id', req.params.load_id)
    .eq('status', 'approved')
    .maybeSingle();
  if (bidError) return dbError(res, bidError, 'Could not load bidding details');
  if (!bid) return res.status(404).json({ error: 'No accepted bid yet for this load' });

  const callerEmail = req.user.email;
  const isPoster = callerEmail === load.posted_by;
  const isAccepter = callerEmail === bid.bid_by_email;
  if (!isPoster && !isAccepter) {
    return res.status(403).json({ error: 'Not authorized to mark this trip delivered' });
  }

  if (!['matched', 'in_transit'].includes(load.status)) {
    return res.status(409).json({ error: 'This trip is not in a deliverable state' });
  }

  const { data, error } = await supabaseAdmin
    .from('loads')
    .update({ status: 'completed' })
    .eq('id', load.id)
    .in('status', ['matched', 'in_transit'])
    .select()
    .single();
  if (error) return dbError(res, error, 'Could not mark this trip delivered');

  await applyCommissionForCompletedTrip(load, bid);

  // Move the booking (spec §8) to 'completed' — best-effort, the load's own
  // status is the source of truth for the trip.
  await completeBookingForLoad(load.id).catch((err) =>
    console.error('[load-bids] booking complete failed for load', load.id, err)
  );

  // The §5 security hold rode through the confirmed trip — release it now
  // the trip is done (best-effort, same treatment as the commission apply).
  await releaseBidSecurityHold(bid, { reason: 'trip completed' }).catch((err) =>
    console.error('[load-bids] hold release on delivery failed for bid', bid.id, err)
  );

  await notifyEmail(isPoster ? bid.bid_by_email : load.posted_by, {
    type: 'trip_delivered',
    title: 'Trip marked delivered',
    body: `${load.material_type ? `${load.material_type} — ` : ''}trip marked as delivered by ${isPoster ? 'the poster' : 'the accepter'}`,
    data: { load_id: load.id, bid_id: bid.id }
  });

  res.json(data);
});

// POST /api/load-bids/:id/approve — poster-only via RLS (load_bids_update_poster).
// Confirming a load (spec §8 "Load Confirmation" / §9 "prevent double booking"):
//
//   1. winning bid still pending and within its window   (guard below)
//   2. bidder eligibility re-verified   \  assertConfirmable() — §8 steps 2-4,
//   3. wallet / §5 security hold still active  }  not trusted from bid-placement
//   4. ₹1,000 hold confirmed present   /
//   5. load locked — the load row is the lock: we claim it ('active' ->
//      'matched') as the *first* write, so a second confirmation (this bid
//      again, or any sibling bid) finds it already matched and gets a 409
//      instead of a second accepted bid. load_bids_one_approved_per_load
//      (migration 048) is the DB backstop.
//   6. booking created — the bookings row (lib/bookings.js, migration 049)
//      carrying the BKnnnnnn reference and the trip's lifecycle status.
//      Best-effort: the trip is confirmed regardless, and trip-details
//      backfills a missing booking on read (ensureBooking).
router.post('/:id/approve', async (req, res) => {
  const nowIso = new Date().toISOString();

  const { data: bid, error: bidError } = await req.supabase
    .from('load_bids')
    .select('id, load_id, status, expires_at, bid_by_email, truck_id, security_hold_txn_id, security_hold_amount, security_hold_released_at')
    .eq('id', req.params.id)
    .maybeSingle();
  if (bidError) return dbError(res, bidError, 'Could not approve this bid');
  if (!bid) return res.status(404).json({ error: 'Bid not found' });
  if (bid.status !== 'pending' || new Date(bid.expires_at).getTime() <= Date.now()) {
    return res.status(409).json({ error: 'Bid is no longer pending (expired or already reviewed)' });
  }

  // Spec §8 steps 2-4: re-verify the bidder still qualifies and their §5
  // security hold is still active *before* anything is locked. A failure here
  // leaves the load open for other bids.
  const { data: loadForCheck, error: loadCheckError } = await req.supabase
    .from('loads')
    .select('posted_by, required_truck_type, required_truck_type_other, weight_tons')
    .eq('id', bid.load_id)
    .maybeSingle();
  if (loadCheckError) return dbError(res, loadCheckError, 'Could not confirm this load');
  if (!loadForCheck) return res.status(404).json({ error: 'Load not found' });

  const blocked = await assertConfirmable(bid, loadForCheck);
  if (blocked) return res.status(blocked.status).json(blocked.body);

  // Claim the load. Only one approve can move it out of 'active'; a racing
  // confirmation of another bid — or a double-tap — gets 409 right here,
  // before any second bid can be flipped to 'approved'.
  const { data: claimedLoad, error: claimError } = await req.supabase
    .from('loads')
    .update({ status: 'matched' })
    .eq('id', bid.load_id)
    .eq('status', 'active')
    .select('id')
    .maybeSingle();
  if (claimError) return dbError(res, claimError, 'Could not confirm this load');
  if (!claimedLoad) {
    return res.status(409).json({ error: 'This load is already booked', code: 'load_already_booked' });
  }

  // Now accept the bid. Still guarded — the 1-minute window can lapse in the
  // gap above; if it has, put the load back so it isn't stranded 'matched'
  // with no accepted bid.
  const { data, error } = await req.supabase
    .from('load_bids')
    .update({ status: 'approved', reviewed_at: nowIso })
    .eq('id', bid.id)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .select()
    .single();

  if (error || !data) {
    await req.supabase
      .from('loads')
      .update({ status: 'active' })
      .eq('id', bid.load_id)
      .eq('status', 'matched');
    if (error) return dbError(res, error, 'Could not approve this bid');
    return res.status(409).json({ error: 'Bid is no longer pending (expired or already reviewed)' });
  }

  // This truck now has a trip — take its posting out of the 'available' pool
  // so it stops surfacing in notifyNearbyTruckOwners (loads.js) and
  // notifyNearbyUsers (truckAvailability.js) fan-outs. req.supabase here is
  // scoped to the load poster, not the truck owner, so truck_availabilities'
  // "owner_id = auth.uid()" update policy would block this — service-role
  // client needed, same trust model as profileForEmail above.
  if (data.truck_id) {
    const { error: truckStatusError } = await supabaseAdmin
      .from('truck_availabilities')
      .update({ status: 'booked', updated_at: nowIso })
      .eq('truck_id', data.truck_id)
      .eq('status', 'available');
    if (truckStatusError) console.error('[load-bids] failed to mark truck availability booked', truckStatusError);
  }

  // Spec §8 step 6: create the booking — the confirmed-trip record carrying
  // the BKnnnnnn reference. Best-effort: the load is already locked and the
  // bid approved, so a failure here just means trip-details backfills it on
  // the next read (ensureBooking). Never fail the confirmation over it.
  let booking = null;
  try {
    booking = await createBookingForConfirmedBid({
      load: { id: data.load_id, posted_by: loadForCheck.posted_by },
      bid: data
    });
  } catch (err) {
    console.error('[load-bids] booking create failed for bid', data.id, err);
  }

  // Spec §9 "reject further bids": now this load is booked, drop every other
  // pending bid on it and return each bidder's security hold.
  await rejectSiblingBids(req.supabase, data.load_id, data.id);

  await notifyEmail(data.bid_by_email, {
    type: 'bid_approved',
    title: 'Your bid was approved',
    body: `₹${Number(data.amount).toLocaleString('en-IN')}${booking ? ` · Booking ${booking.booking_ref}` : ''} — trip details are ready`,
    data: { load_id: data.load_id, bid_id: data.id, booking_ref: booking?.booking_ref ?? null }
  });

  res.json({ ...data, booking });
});

// POST /api/load-bids/:id/reject — poster-only via RLS (load_bids_update_poster).
router.post('/:id/reject', async (req, res) => {
  const { data, error } = await req.supabase
    .from('load_bids')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) return dbError(res, error, 'Could not reject this bid');
  if (!data) return res.status(409).json({ error: 'Bid is no longer pending' });

  // Give the bidder their §5 security hold back now the bid is off the table.
  await releaseBidSecurityHold(data, { reason: 'bid rejected' }).catch((err) =>
    console.error('[load-bids] hold release on reject failed for bid', data.id, err)
  );

  await notifyEmail(data.bid_by_email, {
    type: 'bid_rejected',
    title: 'Your bid was rejected',
    body: `₹${Number(data.amount).toLocaleString('en-IN')} bid on a load was declined`,
    data: { load_id: data.load_id, bid_id: data.id }
  });

  res.json(data);
});

export default router;
