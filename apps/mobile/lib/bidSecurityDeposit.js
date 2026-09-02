// Mirror of the backend's lib/platformSettings.js computeBidSecurityHold() /
// SECURITY_DEPOSIT_DEFAULT — the wallet security deposit held when a bid is
// placed scales with the bid amount as a staff-tunable slab table (marketplace
// spec §5). PlaceBidScreen uses this to show the exact hold for the amount the
// bidder has dialled in, matching the figure loadBids.js POST / will lock.
// Keep the two copies in sync.
//
//   bid ≤ 10,000         -> ₹750
//   bid 10,001 – 20,000  -> ₹1,000
//   bid 20,001 – 30,000  -> ₹1,100
//   bid above 30,000     -> ₹1,100 + 1% of (bid − 30,000)
export const SECURITY_DEPOSIT_DEFAULT = {
  slabs: [
    { up_to: 10000, amount: 750 },
    { up_to: 20000, amount: 1000 },
    { up_to: 30000, amount: 1100 }
  ],
  above_slab_percent: 1
};

// Returns the rupee hold for `bidAmount` (0 = no deposit). Rounded to the
// nearest rupee, same as the Load24-charge line in the payment breakup.
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
