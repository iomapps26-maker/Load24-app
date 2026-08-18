// Risk-signal scoring for the admin risk view (routes/admin/risk.js). The
// formula lives here — in this one function — so tuning it later never
// means touching the route or re-deriving the aggregation logic; the route
// only computes the raw per-user counts and hands them to computeRiskSignals.
//
// A SQL view was the other option this could have lived in (aggregating
// loads/load_bids by GROUP BY at the database level rather than in JS), but
// this project has no local/CI Postgres to run a view's SQL against — every
// other view/RPC in this codebase (admin_wallet_revenue, has_role) is
// consequently untestable through this test suite and only ever verified
// live after a manual migration. Keeping the formula as a plain JS function
// instead means it gets real, run-on-every-commit test coverage
// (riskScore.test.js) — worth more here than the aggregation efficiency a
// view would buy, especially at this project's current data volumes.

// Tunable weights — change these, not the shape of computeRiskSignals, to
// retune scoring.
const CANCELLATION_WEIGHT = 5; // points per cancelled load / rejected bid
const KYC_MISMATCH_PENALTY = 25; // flat points for posting/bidding without verified KYC

// trust_score is expected on a roughly 0-100 scale (user_profiles.trust_score
// defaults to 50) — clamped defensively since nothing in the schema enforces
// that range at the DB level. Lower trust -> higher risk.
function trustComponent(trustScore) {
  return Math.max(0, 100 - (Number(trustScore) || 0));
}

// cancelled_loads/rejected_bids are counts of the user's own loads/bids that
// ended in a non-completed terminal state — see routes/admin/risk.js for
// exactly which statuses count as "non-completed terminal" and why (loads:
// cancelled/expired, not flagged/removed; bids: rejected).
function cancellationComponent(cancelledLoads, rejectedBids) {
  return ((Number(cancelledLoads) || 0) + (Number(rejectedBids) || 0)) * CANCELLATION_WEIGHT;
}

// True only when the user is actively posting or bidding despite not having
// verified KYC — not just "kyc_status isn't verified" on its own, since a
// brand-new signup with zero activity yet isn't a risk signal.
function hasKycMismatch(kycStatus, totalLoads, totalBids) {
  const isActive = (Number(totalLoads) || 0) > 0 || (Number(totalBids) || 0) > 0;
  return kycStatus !== 'verified' && isActive;
}

// Combines the three signals (low trust, cancellation rate, KYC mismatch)
// into one sortable risk_score — higher means riskier. Returns the
// individual components too, so the admin UI can show *why* a user scored
// the way they did, not just the final number.
export function computeRiskSignals({ trust_score, cancelled_loads, rejected_bids, kyc_status, total_loads, total_bids }) {
  const trust_component = trustComponent(trust_score);
  const cancellation_component = cancellationComponent(cancelled_loads, rejected_bids);
  const kyc_mismatch = hasKycMismatch(kyc_status, total_loads, total_bids);
  const kyc_mismatch_component = kyc_mismatch ? KYC_MISMATCH_PENALTY : 0;

  return {
    risk_score: trust_component + cancellation_component + kyc_mismatch_component,
    trust_component,
    cancellation_component,
    kyc_mismatch,
    kyc_mismatch_component
  };
}
