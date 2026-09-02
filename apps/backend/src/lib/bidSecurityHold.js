import { supabaseAdmin } from './supabase.js';
import { applyWalletAdjustment } from './wallet.js';

// Load Confirmation Rule (marketplace spec §5). Placing a bid moves a
// security-deposit amount — the bid-amount-scaled figure from the
// platform_settings.bidding.security_deposit slab table, see
// lib/bidSecurityDeposit.js — into a real WALLET
// HOLD: a 'security_hold' wallet_transactions row, which the
// 014_add_wallet.sql trigger debits from wallets.balance. It is never
// treated as revenue — it's released ('security_release') back to the
// bidder automatically when the bid is declined or expires, and when the
// trip a confirmed bid produces is completed or cancelled.
//
// One hold per load_bids row, tracked by the columns added in
// 047_add_bid_security_hold.sql:
//   security_hold_txn_id, security_hold_amount, security_hold_released_at.

// Places the hold for a freshly-created bid. Throws if the ledger write
// fails (e.g. the DB's balance >= 0 check — the caller checks available
// balance first, so this is the race-loser path). Returns the
// wallet_transactions row so the caller can stamp security_hold_txn_id.
export async function placeBidSecurityHold({ userId, loadId, amount }) {
  return applyWalletAdjustment({
    user_id: userId,
    type: 'security_hold',
    amount,
    reference_load_id: loadId,
    notes: `Security hold — bid on load ${loadId}`
  });
}

// Releases a bid's security hold exactly once. Idempotent: a no-op unless
// the bid actually has an unreleased hold. `bid` must carry id, load_id,
// bid_by_email, security_hold_txn_id, security_hold_amount and
// security_hold_released_at.
//
// The release transaction_id is deterministic (REL-<bid.id>) so two
// concurrent callers (say the reject route and the lazy expiry sweep firing
// at the same moment) can't double-credit — the second insert trips the
// wallet_transactions.transaction_id unique constraint (Postgres 23505),
// which we swallow. Same guard as routes/wallet.js's top-up verify reusing
// the request's transaction_id.
export async function releaseBidSecurityHold(bid, { reason } = {}) {
  if (!bid?.security_hold_txn_id || bid.security_hold_released_at || !bid.security_hold_amount) {
    return null;
  }

  // user_profiles RLS is bypassed here (service-role client) — same reason
  // routes/loadBids.js's profileForEmail does: the bidder is identified by
  // email on the bid, not a user_id we hold.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id')
    .eq('user_email', bid.bid_by_email)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    console.error('[bid-security-hold] no profile for', bid.bid_by_email, '- cannot release hold on bid', bid.id);
    return null;
  }

  let txn;
  try {
    txn = await applyWalletAdjustment({
      user_id: profile.user_id,
      type: 'security_release',
      amount: Number(bid.security_hold_amount),
      reference_load_id: bid.load_id,
      notes: reason ? `Security release — ${reason}` : `Security release — bid ${bid.id}`,
      transaction_id: `REL-${bid.id}`
    });
  } catch (err) {
    if (err?.code === '23505') return null; // already released by a concurrent caller
    throw err;
  }

  await supabaseAdmin
    .from('load_bids')
    .update({ security_hold_released_at: new Date().toISOString() })
    .eq('id', bid.id)
    .is('security_hold_released_at', null);

  return txn;
}

// Safety net for holds stuck on bids the load poster never acted on: a bid
// only auto-rejects when someone *reads* it (routes/loadBids.js's
// autoRejectExpired, same lazy model as the WhatsApp OTP expiry), so a
// poster who never opens "See Bidding" would leave the bidder's money held
// forever. Called from GET /api/load-bids/mine so a bidder checking their
// own bids frees it. Uses the service-role client because
// load_bids_update_poster RLS won't let the bidder flip their own row.
export async function sweepExpiredBidHolds(bids, now = new Date()) {
  const stale = (bids || []).filter(
    (b) =>
      b.status === 'pending' &&
      b.expires_at &&
      new Date(b.expires_at) < now &&
      b.security_hold_txn_id &&
      !b.security_hold_released_at
  );

  for (const bid of stale) {
    try {
      await supabaseAdmin
        .from('load_bids')
        .update({ status: 'rejected', reviewed_at: now.toISOString() })
        .eq('id', bid.id)
        .eq('status', 'pending');
      await releaseBidSecurityHold(bid, { reason: 'bid expired' });
    } catch (err) {
      console.error('[bid-security-hold] sweep failed for bid', bid.id, err);
    }
  }
}
