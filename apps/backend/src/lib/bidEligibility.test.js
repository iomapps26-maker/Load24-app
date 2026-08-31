import { describe, it, expect } from 'vitest';
import { checkBidEligibility, TRUCK_REQUIRED_ROLES } from './bidEligibility.js';

// A profile / load / truck that clear every condition — each test overrides
// just the field it's exercising.
const okProfile = () => ({
  user_type: 'transporter',
  is_active: true,
  mobile_verified: true,
  kyc_status: 'verified',
  bidding_restricted_until: null,
  bidding_restriction_reason: null
});
const okLoad = () => ({
  status: 'active',
  required_truck_type: 'tata_407',
  required_truck_type_other: null,
  weight_tons: 5
});
const okTruck = () => ({
  verified: true,
  truck_type: 'tata_407',
  truck_type_other: null,
  capacity_tons: 10,
  permit_expiry: '2999-01-01',
  puc_expiry: '2999-01-01',
  insurance_expiry: '2999-01-01'
});

const NOW = new Date('2026-08-29T00:00:00.000Z');
const run = (over = {}) =>
  checkBidEligibility({
    profile: okProfile(),
    load: okLoad(),
    truck: null,
    now: NOW,
    ...over
  });

describe('checkBidEligibility — account-level conditions', () => {
  it('passes a clean transporter bidding without a vehicle', () => {
    expect(run()).toBeNull();
  });

  it('rejects when the profile is missing entirely', () => {
    const r = run({ profile: null });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('account_inactive');
  });

  it('rejects an inactive account', () => {
    expect(run({ profile: { ...okProfile(), is_active: false } }).body.code).toBe('account_inactive');
  });

  it('rejects an unverified mobile', () => {
    expect(run({ profile: { ...okProfile(), mobile_verified: false } }).body.code).toBe('mobile_not_verified');
  });

  it('rejects an account with a restriction still in the future, echoing the reason', () => {
    const r = run({
      profile: {
        ...okProfile(),
        bidding_restricted_until: '2026-09-30T00:00:00.000Z',
        bidding_restriction_reason: 'payment dispute under review'
      }
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('bidding_restricted');
    expect(r.body.error).toContain('payment dispute under review');
    expect(r.body.restricted_until).toBe('2026-09-30T00:00:00.000Z');
    expect(r.body.reason).toBe('payment dispute under review');
  });

  it('ignores a restriction whose window has already passed', () => {
    expect(
      run({ profile: { ...okProfile(), bidding_restricted_until: '2026-01-01T00:00:00.000Z' } })
    ).toBeNull();
  });

  it('rejects when KYC is not verified, passing the current status through', () => {
    const r = run({ profile: { ...okProfile(), kyc_status: 'submitted' } });
    expect(r.body.code).toBe('kyc_verification_required');
    expect(r.body.kyc_status).toBe('submitted');
  });

  it('checks account state head-to-toe: inactive beats every later condition', () => {
    const r = run({
      profile: { ...okProfile(), is_active: false, mobile_verified: false, kyc_status: 'pending' }
    });
    expect(r.body.code).toBe('account_inactive');
  });

  it('rejects a bid on a load that is no longer active', () => {
    const r = run({ load: { ...okLoad(), status: 'matched' } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('load_not_active');
  });
});

describe('checkBidEligibility — vehicle conditions (driver / vehicle_owner)', () => {
  const vehicleProfile = () => ({ ...okProfile(), user_type: 'vehicle_owner' });

  it('requires a vehicle when the role is driver or vehicle_owner', () => {
    for (const user_type of TRUCK_REQUIRED_ROLES) {
      const r = run({ profile: { ...okProfile(), user_type }, truck: null });
      expect(r.body.code).toBe('vehicle_required');
    }
  });

  it('rejects an unverified vehicle', () => {
    const r = run({ profile: vehicleProfile(), truck: { ...okTruck(), verified: false } });
    expect(r.body.code).toBe('vehicle_not_verified');
  });

  it('rejects a vehicle with a lapsed document and names which one', () => {
    const r = run({ profile: vehicleProfile(), truck: { ...okTruck(), puc_expiry: '2026-05-01' } });
    expect(r.body.code).toBe('vehicle_documents_expired');
    expect(r.body.error).toContain('PUC');
  });

  it('treats a null expiry as acceptable (verification already covered presence)', () => {
    expect(
      run({ profile: vehicleProfile(), truck: { ...okTruck(), permit_expiry: null, puc_expiry: null, insurance_expiry: null } })
    ).toBeNull();
  });

  it('rejects a vehicle whose type does not match the load', () => {
    const r = run({ profile: vehicleProfile(), truck: { ...okTruck(), truck_type: 'trailer' } });
    expect(r.body.code).toBe('vehicle_type_mismatch');
  });

  it('matches two "other" types only when the free-text detail agrees', () => {
    const load = { ...okLoad(), required_truck_type: 'other', required_truck_type_other: 'Bulker' };
    expect(
      run({ profile: vehicleProfile(), load, truck: { ...okTruck(), truck_type: 'other', truck_type_other: 'bulker ' } })
    ).toBeNull();
    expect(
      run({ profile: vehicleProfile(), load, truck: { ...okTruck(), truck_type: 'other', truck_type_other: 'Tanker' } }).body.code
    ).toBe('vehicle_type_mismatch');
  });

  it('rejects a vehicle whose capacity is below the load weight, with the numbers', () => {
    const r = run({ profile: vehicleProfile(), load: { ...okLoad(), weight_tons: 12 }, truck: { ...okTruck(), capacity_tons: 9 } });
    expect(r.body.code).toBe('vehicle_capacity_insufficient');
    expect(r.body.vehicle_capacity_tons).toBe(9);
    expect(r.body.load_weight_tons).toBe(12);
  });

  it('rejects a vehicle with no recorded capacity', () => {
    const r = run({ profile: vehicleProfile(), truck: { ...okTruck(), capacity_tons: null } });
    expect(r.body.code).toBe('vehicle_capacity_insufficient');
    expect(r.body.error).toMatch(/capacity/i);
  });

  it('passes a verified vehicle that matches type and capacity with valid documents', () => {
    expect(run({ profile: vehicleProfile(), truck: okTruck() })).toBeNull();
  });
});
