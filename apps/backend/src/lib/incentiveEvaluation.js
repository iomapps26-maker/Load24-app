import { supabaseAdmin } from './supabase.js';
import { applyWalletAdjustment } from './wallet.js';

// Metrics this evaluator knows how to compute -> a function returning
// Map<bid_by_email, current metric value>. Add an entry here (and widen
// 038_add_incentive_rules.sql's metric check constraint) to support a new
// metric; nothing else in this file or incentives.js needs to change.
//
// 'trips_completed' is deliberately a *lifetime* count, not "this month" —
// loads.status flips to 'completed' in loadBids.js's deliver route, but
// nothing there (or anywhere else) stamps updated_at at that moment, and
// there's no DB trigger doing it either, so a calendar-window metric can't
// actually be computed correctly from what's in the schema today. A
// lifetime milestone ("pay a bonus the first time someone crosses N
// completed trips") sidesteps that and is still exactly the "simple...
// evaluates it against trip/wallet data" the spec asks for.
const METRIC_EVALUATORS = {
  trips_completed: computeLifetimeTripsCompleted
};

async function computeLifetimeTripsCompleted() {
  const { data: bids, error: bidsError } = await supabaseAdmin.from('load_bids').select('bid_by_email, load_id').eq('status', 'approved');
  if (bidsError) throw bidsError;
  if (!bids?.length) return new Map();

  const loadIds = [...new Set(bids.map((b) => b.load_id))];
  const { data: completedLoads, error: loadsError } = await supabaseAdmin
    .from('loads')
    .select('id')
    .in('id', loadIds)
    .eq('status', 'completed');
  if (loadsError) throw loadsError;

  const completedLoadIds = new Set((completedLoads || []).map((l) => l.id));
  const counts = new Map();
  for (const bid of bids) {
    if (!completedLoadIds.has(bid.load_id)) continue;
    counts.set(bid.bid_by_email, (counts.get(bid.bid_by_email) || 0) + 1);
  }
  return counts;
}

// A payout for a given (rule, user) is uniquely identified by this notes
// string, checked against wallet_transactions before paying so a
// milestone already earned isn't paid again next time the job runs.
// Reuses wallet_transactions as the de-dup ledger rather than inventing a
// separate payouts table — it's already the authoritative record of what's
// been paid (see applyWalletAdjustment, lib/wallet.js), and a new table for
// this alone would just be a second, redundant source of truth.
function payoutNotes(rule, userId) {
  return `Incentive payout: rule=${rule.id} metric=${rule.metric} user=${userId}`;
}

// Evaluates every active incentive_rules row against current trip data and
// pays out any newly-crossed threshold via applyWalletAdjustment (type
// 'credit') — the same ledger-write POST /api/wallet/adjust uses, not a
// second payout path. Safe to call repeatedly (scheduled interval, manual
// POST /api/admin/incentives/evaluate, or both) — payoutNotes' de-dup check
// means a rule already paid to a user is a silent no-op on later runs, the
// same "call it as often as you like" safety loadBids.js's commission
// auto-apply already relies on.
export async function evaluateIncentiveRules() {
  const { data: rules, error: rulesError } = await supabaseAdmin.from('incentive_rules').select('*').eq('is_active', true);
  if (rulesError) throw rulesError;
  if (!rules?.length) return { payouts_applied: 0 };

  const metricCache = new Map(); // metric name -> Map<email, value>, computed once even if several rules share a metric
  let payoutsApplied = 0;

  for (const rule of rules) {
    const evaluator = METRIC_EVALUATORS[rule.metric];
    if (!evaluator) {
      console.error('[incentives] no evaluator registered for metric', rule.metric);
      continue;
    }
    if (!metricCache.has(rule.metric)) metricCache.set(rule.metric, await evaluator());
    const valuesByEmail = metricCache.get(rule.metric);
    if (!valuesByEmail.size) continue;

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, user_email')
      .in('user_email', [...valuesByEmail.keys()]);
    if (profilesError) throw profilesError;
    const userIdByEmail = new Map((profiles || []).map((p) => [p.user_email, p.user_id]));

    for (const [email, value] of valuesByEmail) {
      if (value < Number(rule.threshold)) continue;
      const userId = userIdByEmail.get(email);
      if (!userId) continue;

      const notes = payoutNotes(rule, userId);
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('wallet_transactions')
        .select('id')
        .eq('notes', notes)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) continue; // already paid this rule to this user

      await applyWalletAdjustment({ user_id: userId, type: 'credit', amount: Number(rule.reward_amount), notes });
      payoutsApplied += 1;
    }
  }

  return { payouts_applied: payoutsApplied };
}
