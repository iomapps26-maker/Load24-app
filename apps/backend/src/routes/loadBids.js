import { Router } from 'express';
import { supabaseAdmin } from '../lib/supabase.js';

const KYC_BUCKET = 'kyc-documents';
const TRIP_DOC_URL_TTL_SECONDS = 300;

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
// rather than a background job.
async function autoRejectExpired(supabase, load_id) {
  await supabase
    .from('load_bids')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('load_id', load_id)
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString());
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

// Short-lived (5 min) signed URLs, minted fresh on every trip-details fetch
// rather than stored/cached, so a leaked link stops working quickly.
async function documentsForUser(userId) {
  const { data: kycCase } = await supabaseAdmin.from('kyc_cases').select('id').eq('user_id', userId).maybeSingle();
  if (!kycCase) return [];

  const { data: docs } = await supabaseAdmin
    .from('kyc_documents')
    .select('document_type, file_name, mime_type, storage_path')
    .eq('case_id', kycCase.id);
  if (!docs?.length) return [];

  return Promise.all(
    docs.map(async ({ document_type, file_name, mime_type, storage_path }) => {
      const { data } = await supabaseAdmin.storage.from(KYC_BUCKET).createSignedUrl(storage_path, TRIP_DOC_URL_TTL_SECONDS);
      return { document_type, file_name, mime_type, url: data?.signedUrl ?? null };
    })
  );
}

// GET /api/load-bids/mine — bids the current user has placed
router.get('/mine', async (req, res) => {
  const { data, error } = await req.supabase
    .from('load_bids')
    .select('*')
    .eq('bid_by_email', req.user.email)
    .order('created_at', { ascending: false });

  if (error) return dbError(res, error, 'Could not load your bids');
  res.json(data);
});

// POST /api/load-bids — place a bid amount on a load
router.post('/', async (req, res) => {
  const { load_id, amount, bid_by_type, truck_id, truck_number } = req.body;
  if (!load_id) return res.status(400).json({ error: 'load_id is required' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount must be greater than 0' });

  const { data: load, error: loadError } = await req.supabase
    .from('loads')
    .select('posted_by')
    .eq('id', load_id)
    .single();
  if (loadError) return dbError(res, loadError, 'Could not find this load');
  if (load.posted_by === req.user.email) {
    return res.status(403).json({ error: 'You cannot bid on your own posted load' });
  }

  const { data, error } = await req.supabase
    .from('load_bids')
    .insert({
      load_id,
      bid_by_email: req.user.email,
      bid_by_type,
      truck_id,
      truck_number,
      amount
    })
    .select()
    .single();

  if (error) return dbError(res, error, 'Could not place your bid');
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

  res.json({ load, bids });
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

  const [posterProfile, accepterProfile] = await Promise.all([
    profileForEmail(load.posted_by),
    profileForEmail(bid.bid_by_email)
  ]);

  const [posterDocuments, accepterDocuments] = await Promise.all([
    posterProfile ? documentsForUser(posterProfile.user_id) : [],
    accepterProfile ? documentsForUser(accepterProfile.user_id) : []
  ]);

  res.json({
    viewer_role: isPoster ? 'poster' : 'accepter',
    load,
    bid: {
      id: bid.id,
      amount: bid.amount,
      truck_id: bid.truck_id,
      truck_number: bid.truck_number,
      bid_by_type: bid.bid_by_type,
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
      kyc_status: posterProfile?.kyc_status ?? null,
      documents: posterDocuments
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
      kyc_status: accepterProfile?.kyc_status ?? null,
      documents: accepterDocuments
    }
  });
});

// POST /api/load-bids/:id/approve — poster-only via RLS (load_bids_update_poster).
// Guarded to still-pending, still-within-window bids so a stale approve can't
// land after the 1-minute auto-reject window has already passed.
router.post('/:id/approve', async (req, res) => {
  const { data, error } = await req.supabase
    .from('load_bids')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select()
    .single();

  if (error) return dbError(res, error, 'Could not approve this bid');
  if (!data) return res.status(409).json({ error: 'Bid is no longer pending (expired or already reviewed)' });
  res.json(data);
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
  res.json(data);
});

export default router;
