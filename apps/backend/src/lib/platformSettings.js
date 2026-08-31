import { supabaseAdmin } from './supabase.js';

// Fallbacks for when the 'bidding' row (or one of its keys) is missing —
// keep in sync with db/migrations/043_add_platform_settings.sql's seed.
export const BIDDING_SETTINGS_DEFAULTS = Object.freeze({
  load24_charge_percent: 4.0,
  security_deposit_amount: 1000
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
  return { ...BIDDING_SETTINGS_DEFAULTS, ...(data?.value || {}) };
}
