// Pure evaluator for the bid-amount → wallet-hold slab table (marketplace
// spec §5). No I/O: the `securityDeposit` config object is read from
// platform_settings by platformSettings.getBiddingSettings(). Staff edit the
// table from the admin panel (PATCH /api/admin/platform-settings/bidding).
// Mirrored in apps/mobile/lib/bidSecurityDeposit.js for PlaceBidScreen's
// payment breakup — edit both together.
//
// `slabs` is walked in ascending `up_to` order: the first slab whose `up_to`
// is >= the bid amount sets a flat hold. A bid above every slab's `up_to`
// pays the top slab's `amount` plus `above_slab_percent`% of the excess over
// that slab's `up_to`. An empty `slabs` array disables the deposit entirely.
//
//   bid ≤ 10,000            -> ₹750
//   bid 10,001 – 20,000     -> ₹1,000
//   bid 20,001 – 30,000     -> ₹1,100
//   bid above 30,000        -> ₹1,100 + 1% of (bid − 30,000)
export const SECURITY_DEPOSIT_DEFAULT = Object.freeze({
  slabs: [
    { up_to: 10000, amount: 750 },
    { up_to: 20000, amount: 1000 },
    { up_to: 30000, amount: 1100 }
  ],
  above_slab_percent: 1
});

// Returns the rupee hold to move into the wallet for a bid of `bidAmount`
// (0 = no deposit). Rounded to the nearest rupee, same as PlaceBidScreen's
// Load24-charge line.
export function computeBidSecurityHold(bidAmount, securityDeposit = SECURITY_DEPOSIT_DEFAULT) {
  const amount = Number(bidAmount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const slabs = [...(securityDeposit?.slabs || [])]
    .map((s) => ({ up_to: Number(s.up_to), amount: Number(s.amount) }))
    .filter((s) => Number.isFinite(s.up_to) && Number.isFinite(s.amount) && s.up_to > 0 && s.amount >= 0)
    .sort((a, b) => a.up_to - b.up_to);
  if (slabs.length === 0) return 0;

  for (const slab of slabs) {
    if (amount <= slab.up_to) return Math.round(slab.amount);
  }

  const top = slabs[slabs.length - 1];
  const pct = Number(securityDeposit?.above_slab_percent);
  const overage = Number.isFinite(pct) && pct > 0 ? ((amount - top.up_to) * pct) / 100 : 0;
  return Math.round(top.amount + overage);
}
