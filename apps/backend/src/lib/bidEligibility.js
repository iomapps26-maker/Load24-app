// Marketplace spec §2 — "Bid Eligibility Conditions": a bid may be placed
// only when every account- and vehicle-level condition below holds, and a
// failing bid must be rejected *with the exact reason*. This is the single
// ordered gate behind routes/loadBids.js's POST /.
//
// Pure and synchronous: the route fetches the rows (profile, load, and — for
// driver/vehicle_owner — the chosen truck) and passes them in. Returns null
// when the bid may proceed, otherwise { status, body } where body is the
// JSON response ({ error, code, ...detail }) — same shape the route already
// sends for the KYC and security-deposit gates.
//
// Not covered here, by design:
//   * self-bidding            — its own check in the route + RLS (017)
//   * wallet security deposit — its own check in the route (needs an async
//                               wallet read); §2 treats it separately
//   * "available for the required route/date" (§2) — deferred: preferred_routes
//     is free text, so there's nothing to match against reliably yet.

// The two roles that register trucks (mirrors trucks.js's TRUCK_ROLES). Only
// these must attach a vehicle and clear the vehicle conditions; a
// transporter/broker may bid with no truck at all.
export const TRUCK_REQUIRED_ROLES = ['vehicle_owner', 'driver'];

function fail(status, code, error, detail) {
  return { status, body: { error, code, ...detail } };
}

// A closed-list value only "matches" another when they're the same slug; the
// 'other' escape hatch (022/025) carries the real value in a free-text
// column, so two 'other's match only when that text agrees (trimmed,
// case-insensitive). Anything else is a mismatch.
function truckTypeMatches(load, truck) {
  const required = load.required_truck_type;
  const have = truck.truck_type;
  if (required !== 'other' && have !== 'other') return required === have;
  if (required === 'other' && have === 'other') {
    const a = (load.required_truck_type_other || '').trim().toLowerCase();
    const b = (truck.truck_type_other || '').trim().toLowerCase();
    return a !== '' && a === b;
  }
  return false;
}

// permit / PUC / insurance are the truck papers that carry an expiry
// (020/021 — RC and the photos don't). A null expiry isn't treated as
// invalid here: staff verification already confirmed the document set was
// present, so this only catches papers that have since lapsed.
const EXPIRING_DOCS = [
  ['permit_expiry', 'permit'],
  ['puc_expiry', 'PUC'],
  ['insurance_expiry', 'insurance']
];

function expiredDoc(truck, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const [column, label] of EXPIRING_DOCS) {
    const raw = truck[column];
    if (!raw) continue;
    const when = new Date(raw);
    if (!Number.isNaN(when.getTime()) && when < today) return label;
  }
  return null;
}

export function checkBidEligibility({ profile, load, truck, now = new Date() }) {
  // ---- account-level -----------------------------------------------------
  if (!profile) {
    return fail(403, 'account_inactive', 'Complete your profile before placing a bid');
  }
  if (profile.is_active === false) {
    return fail(403, 'account_inactive', 'Your account is not active. Contact LOAD24 support to reactivate it.');
  }
  if (!profile.mobile_verified) {
    return fail(403, 'mobile_not_verified', 'Verify your mobile number before placing a bid');
  }
  if (profile.bidding_restricted_until && new Date(profile.bidding_restricted_until) > now) {
    const reason = profile.bidding_restriction_reason;
    return fail(
      403,
      'bidding_restricted',
      `Bidding is restricted on your account${reason ? ` — ${reason}` : ''}`,
      { restricted_until: profile.bidding_restricted_until, reason: reason ?? null }
    );
  }
  if (profile.kyc_status !== 'verified') {
    return fail(403, 'kyc_verification_required', 'Complete your KYC verification before placing a bid', {
      kyc_status: profile.kyc_status ?? null
    });
  }

  // ---- load state ------------------------------------------------------
  if (load?.status && load.status !== 'active') {
    return fail(409, 'load_not_active', 'This load is no longer open for bidding');
  }

  // ---- vehicle-level (driver / vehicle_owner only) ---------------------
  if (TRUCK_REQUIRED_ROLES.includes(profile.user_type)) {
    if (!truck) {
      return fail(403, 'vehicle_required', 'Select a verified vehicle to bid on this load');
    }
    if (!truck.verified) {
      return fail(403, 'vehicle_not_verified', 'Your selected vehicle is pending verification');
    }
    const expired = expiredDoc(truck, now);
    if (expired) {
      return fail(403, 'vehicle_documents_expired', `Your vehicle's ${expired} has expired — update it before bidding`);
    }
    if (!truckTypeMatches(load, truck)) {
      return fail(403, 'vehicle_type_mismatch', "Your vehicle's type doesn't match what this load requires");
    }
    const capacity = truck.capacity_tons == null ? null : Number(truck.capacity_tons);
    const required = Number(load.weight_tons);
    if (capacity == null || Number.isNaN(capacity) || (required > 0 && capacity < required)) {
      return fail(
        403,
        'vehicle_capacity_insufficient',
        capacity == null || Number.isNaN(capacity)
          ? "Add your vehicle's load capacity before bidding"
          : `This load needs ${required} t capacity; your vehicle carries ${capacity} t`,
        { vehicle_capacity_tons: capacity, load_weight_tons: Number.isNaN(required) ? null : required }
      );
    }
  }

  return null;
}
