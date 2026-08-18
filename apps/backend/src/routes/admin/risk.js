import { Router } from 'express';
import { supabaseAdmin } from '../../lib/supabase.js';
import { computeRiskSignals } from '../../lib/riskScore.js';

const router = Router();

// "Non-completed terminal state" for a load, counted against its poster —
// deliberately just cancelled/expired, not flagged/removed: those are staff
// moderation outcomes, not the poster's own cancellation behavior, so they
// shouldn't count as a signal about the poster.
const LOAD_NON_COMPLETED_TERMINAL = ['cancelled', 'expired'];
// For a bid, 'rejected' covers both an explicit poster rejection and the
// 1-minute-window auto-reject (loadBids.js's autoRejectExpired) — both mean
// "this bid didn't pan out" from the bidder's side.
const BID_NON_COMPLETED_TERMINAL = 'rejected';

// GET /api/admin/risk?limit= — every user with a profile, sorted by
// risk_score descending (highest risk first). loadBids.js already selects
// trust_score/rating_score/total_ratings per user (~line 38) but nothing
// aggregated or flagged on them until now. The scoring formula itself lives
// in lib/riskScore.js (computeRiskSignals) — this route only fetches the
// existing tables (no new table, per spec) and aggregates the raw counts
// each user needs, in JS rather than a SQL view/GROUP BY — see riskScore.js's
// header comment for why.
router.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const [{ data: profiles, error: profilesError }, { data: loads, error: loadsError }, { data: bids, error: bidsError }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, user_email, full_name, mobile, city, user_type, kyc_status, trust_score'),
    supabaseAdmin.from('loads').select('posted_by, status'),
    supabaseAdmin.from('load_bids').select('bid_by_email, status')
  ]);
  if (profilesError) return res.status(400).json({ error: profilesError.message });
  if (loadsError) return res.status(400).json({ error: loadsError.message });
  if (bidsError) return res.status(400).json({ error: bidsError.message });

  const loadStatsByEmail = new Map();
  for (const load of loads || []) {
    const stats = loadStatsByEmail.get(load.posted_by) || { total_loads: 0, cancelled_loads: 0 };
    stats.total_loads += 1;
    if (LOAD_NON_COMPLETED_TERMINAL.includes(load.status)) stats.cancelled_loads += 1;
    loadStatsByEmail.set(load.posted_by, stats);
  }

  const bidStatsByEmail = new Map();
  for (const bid of bids || []) {
    const stats = bidStatsByEmail.get(bid.bid_by_email) || { total_bids: 0, rejected_bids: 0 };
    stats.total_bids += 1;
    if (bid.status === BID_NON_COMPLETED_TERMINAL) stats.rejected_bids += 1;
    bidStatsByEmail.set(bid.bid_by_email, stats);
  }

  const rows = (profiles || []).map((profile) => {
    const loadStats = loadStatsByEmail.get(profile.user_email) || { total_loads: 0, cancelled_loads: 0 };
    const bidStats = bidStatsByEmail.get(profile.user_email) || { total_bids: 0, rejected_bids: 0 };
    const signals = computeRiskSignals({
      trust_score: profile.trust_score,
      cancelled_loads: loadStats.cancelled_loads,
      rejected_bids: bidStats.rejected_bids,
      kyc_status: profile.kyc_status,
      total_loads: loadStats.total_loads,
      total_bids: bidStats.total_bids
    });

    return {
      user_id: profile.user_id,
      full_name: profile.full_name,
      mobile: profile.mobile,
      city: profile.city,
      user_type: profile.user_type,
      kyc_status: profile.kyc_status,
      trust_score: profile.trust_score,
      total_loads: loadStats.total_loads,
      cancelled_loads: loadStats.cancelled_loads,
      total_bids: bidStats.total_bids,
      rejected_bids: bidStats.rejected_bids,
      ...signals
    };
  });

  rows.sort((a, b) => b.risk_score - a.risk_score);
  res.json(rows.slice(0, limit));
});

export default router;
