import { describe, it, expect } from 'vitest';
import { computeRiskSignals } from './riskScore.js';

describe('computeRiskSignals', () => {
  it('scores a clean, low-risk user near zero', () => {
    const result = computeRiskSignals({
      trust_score: 90,
      cancelled_loads: 0,
      rejected_bids: 0,
      kyc_status: 'verified',
      total_loads: 3,
      total_bids: 0
    });
    expect(result.trust_component).toBe(10); // 100 - 90
    expect(result.cancellation_component).toBe(0);
    expect(result.kyc_mismatch).toBe(false);
    expect(result.kyc_mismatch_component).toBe(0);
    expect(result.risk_score).toBe(10);
  });

  it('weighs cancelled loads and rejected bids together at 5 points each', () => {
    const result = computeRiskSignals({
      trust_score: 50,
      cancelled_loads: 3,
      rejected_bids: 2,
      kyc_status: 'verified',
      total_loads: 5,
      total_bids: 4
    });
    expect(result.cancellation_component).toBe(25); // (3 + 2) * 5
    expect(result.risk_score).toBe(50 /* trust: 100-50 */ + 25);
  });

  it('flags a KYC mismatch only when the user is actually active', () => {
    const inactive = computeRiskSignals({
      trust_score: 50, cancelled_loads: 0, rejected_bids: 0, kyc_status: 'pending', total_loads: 0, total_bids: 0
    });
    expect(inactive.kyc_mismatch).toBe(false);
    expect(inactive.kyc_mismatch_component).toBe(0);

    const activeWithLoads = computeRiskSignals({
      trust_score: 50, cancelled_loads: 0, rejected_bids: 0, kyc_status: 'pending', total_loads: 1, total_bids: 0
    });
    expect(activeWithLoads.kyc_mismatch).toBe(true);
    expect(activeWithLoads.kyc_mismatch_component).toBe(25);

    const activeWithBids = computeRiskSignals({
      trust_score: 50, cancelled_loads: 0, rejected_bids: 0, kyc_status: 'pending', total_loads: 0, total_bids: 1
    });
    expect(activeWithBids.kyc_mismatch).toBe(true);
  });

  it('does not flag a mismatch once KYC is actually verified, regardless of activity', () => {
    const result = computeRiskSignals({
      trust_score: 50, cancelled_loads: 0, rejected_bids: 0, kyc_status: 'verified', total_loads: 10, total_bids: 10
    });
    expect(result.kyc_mismatch).toBe(false);
  });

  it('clamps the trust component at 0 rather than going negative for a trust_score above 100', () => {
    const result = computeRiskSignals({
      trust_score: 150, cancelled_loads: 0, rejected_bids: 0, kyc_status: 'verified', total_loads: 0, total_bids: 0
    });
    expect(result.trust_component).toBe(0);
  });

  it('treats missing/null numeric inputs as 0 rather than NaN', () => {
    const result = computeRiskSignals({
      trust_score: null, cancelled_loads: undefined, rejected_bids: null, kyc_status: 'verified', total_loads: 0, total_bids: 0
    });
    expect(result.trust_component).toBe(100); // 100 - 0
    expect(result.cancellation_component).toBe(0);
    expect(Number.isNaN(result.risk_score)).toBe(false);
  });

  it('combines all three components additively, worst case', () => {
    const result = computeRiskSignals({
      trust_score: 10, // trust component: 90
      cancelled_loads: 4,
      rejected_bids: 1, // cancellation component: 5*5 = 25
      kyc_status: 'rejected',
      total_loads: 5,
      total_bids: 0 // kyc mismatch: true -> 25
    });
    expect(result.risk_score).toBe(90 + 25 + 25);
  });
});
