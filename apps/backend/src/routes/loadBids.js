import { Router } from 'express';

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
