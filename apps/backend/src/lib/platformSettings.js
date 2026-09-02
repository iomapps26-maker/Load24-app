import { supabaseAdmin } from './supabase.js';
import { SECURITY_DEPOSIT_DEFAULT } from './bidSecurityDeposit.js';

// Re-exported so callers that already import from platformSettings.js can also
// reach the slab-table evaluator without a second import path.
export { SECURITY_DEPOSIT_DEFAULT, computeBidSecurityHold } from './bidSecurityDeposit.js';

// Fallbacks for when the 'bidding' row (or one of its keys) is missing — keep
// in sync with db/migrations/052_bidding_security_deposit_slabs.sql's seed.
// `security_deposit` is the bid-amount → wallet-hold slab table evaluated by
// computeBidSecurityHold (lib/bidSecurityDeposit.js); staff edit it from the
// admin panel.
export const BIDDING_SETTINGS_DEFAULTS = Object.freeze({
  load24_charge_percent: 4.0,
  security_deposit: SECURITY_DEPOSIT_DEFAULT
});

// The tunable values behind PlaceBidScreen's payment breakup and the wallet
// security-deposit gate in loadBids.js's POST /. Read through supabaseAdmin
// (the value isn't caller-scoped) and merged over BIDDING_SETTINGS_DEFAULTS
// so a fresh DB without the seed row still returns sensible numbers rather
// than throwing. Staff change these via routes/admin/platformSettings.js.
export async function getBiddingSettings() {
  const { data, error } = await supabaseAdmin
    .from('platform_settings')
    .select('value')
    .eq('key', 'bidding')
    .maybeSingle();
  if (error) throw error;
  const merged = { ...BIDDING_SETTINGS_DEFAULTS, ...(data?.value || {}) };
  // A row saved before 052 carries the flat `security_deposit_amount` and no
  // `security_deposit` — fall back to the default slab table and drop the
  // dead key so nothing downstream reads it.
  if (!merged.security_deposit || !Array.isArray(merged.security_deposit.slabs)) {
    merged.security_deposit = SECURITY_DEPOSIT_DEFAULT;
  }
  delete merged.security_deposit_amount;
  return merged;
}
