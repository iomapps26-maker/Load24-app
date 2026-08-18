import { supabaseAdmin } from './supabase.js';

// How far back a bid still counts as "recent" — a transporter who bid on a
// similar load 6 months ago isn't a strong signal today.
const RECENT_BID_WINDOW_DAYS = 60;

// Populates match_suggestions for every currently-active load, using two
// simple signals — not a scoring/ranking engine, per spec:
//   1. Recent bids (any status — even a rejected bid shows the transporter
//      deals in this kind of freight) on a *different* load with the same
//      material_type + required_truck_type, within RECENT_BID_WINDOW_DAYS.
//   2. An 'available' truck_availabilities posting at the same
//      loading_pincode as the load — the transporter has a truck sitting
//      right where this load needs to be picked up.
// Upserts on (load_id, suggested_transporter_id) — db/migrations/037_add_
// match_suggestions.sql's unique constraint — so re-running the job (see
// index.js's scheduled interval, or POST /api/admin/crm/generate for an
// on-demand run) just refreshes existing suggestions' reason rather than
// duplicating them. If both signals match the same pair, whichever is
// processed second wins the reason text — a simple, documented trade-off,
// not a real limitation worth two rows for.
export async function generateMatchSuggestions() {
  const { data: activeLoads, error: loadsError } = await supabaseAdmin
    .from('loads')
    .select('id, posted_by, material_type, required_truck_type, loading_pincode')
    .eq('status', 'active');
  if (loadsError) throw loadsError;
  if (!activeLoads?.length) return { suggestions_upserted: 0 };

  const [{ data: allLoads, error: allLoadsError }, { data: allBids, error: bidsError }, { data: availabilities, error: availError }] =
    await Promise.all([
      supabaseAdmin.from('loads').select('id, material_type, required_truck_type'),
      supabaseAdmin.from('load_bids').select('load_id, bid_by_email, created_at'),
      supabaseAdmin.from('truck_availabilities').select('owner_id, current_pincode').eq('status', 'available')
    ]);
  if (allLoadsError) throw allLoadsError;
  if (bidsError) throw bidsError;
  if (availError) throw availError;

  const loadById = new Map((allLoads || []).map((l) => [l.id, l]));
  const cutoff = Date.now() - RECENT_BID_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // bid_by_email -> Set of "material_type|required_truck_type" combos they
  // have a recent bid against.
  const recentBidKeysByEmail = new Map();
  for (const bid of allBids || []) {
    if (new Date(bid.created_at).getTime() < cutoff) continue;
    const originalLoad = loadById.get(bid.load_id);
    if (!originalLoad) continue;
    const key = `${originalLoad.material_type}|${originalLoad.required_truck_type}`;
    if (!recentBidKeysByEmail.has(bid.bid_by_email)) recentBidKeysByEmail.set(bid.bid_by_email, new Set());
    recentBidKeysByEmail.get(bid.bid_by_email).add(key);
  }

  // Resolve bidder emails to user_ids in one batch (match_suggestions is
  // keyed by user_id, but load_bids only records the bidder's email).
  const bidderEmails = [...recentBidKeysByEmail.keys()];
  const { data: bidderProfiles, error: profilesError } = bidderEmails.length
    ? await supabaseAdmin.from('user_profiles').select('user_id, user_email').in('user_email', bidderEmails)
    : { data: [], error: null };
  if (profilesError) throw profilesError;
  const userIdByEmail = new Map((bidderProfiles || []).map((p) => [p.user_email, p.user_id]));

  const suggestions = [];
  for (const load of activeLoads) {
    const key = `${load.material_type}|${load.required_truck_type}`;

    for (const [email, keys] of recentBidKeysByEmail) {
      if (email === load.posted_by || !keys.has(key)) continue; // never suggest the poster to themselves
      const userId = userIdByEmail.get(email);
      if (!userId) continue;
      suggestions.push({
        load_id: load.id,
        suggested_transporter_id: userId,
        reason: `Recently bid on a similar ${load.material_type || 'load'} requiring ${load.required_truck_type}`
      });
    }

    for (const posting of availabilities || []) {
      if (!posting.current_pincode || posting.current_pincode !== load.loading_pincode) continue;
      if (userIdByEmail.get(load.posted_by) === posting.owner_id) continue; // self-guard by id too
      suggestions.push({
        load_id: load.id,
        suggested_transporter_id: posting.owner_id,
        reason: `Has an available truck at the pickup pincode (${load.loading_pincode})`
      });
    }
  }

  if (!suggestions.length) return { suggestions_upserted: 0 };

  const { error: upsertError } = await supabaseAdmin
    .from('match_suggestions')
    .upsert(suggestions, { onConflict: 'load_id,suggested_transporter_id' });
  if (upsertError) throw upsertError;

  return { suggestions_upserted: suggestions.length };
}
