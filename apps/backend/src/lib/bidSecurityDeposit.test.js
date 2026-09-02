import { describe, it, expect } from 'vitest';
import { computeBidSecurityHold, SECURITY_DEPOSIT_DEFAULT } from './bidSecurityDeposit.js';

describe('computeBidSecurityHold — default slab table', () => {
  const hold = (amount) => computeBidSecurityHold(amount, SECURITY_DEPOSIT_DEFAULT);

  it('holds ₹750 for a bid in the first slab (≤ 10,000)', () => {
    expect(hold(1)).toBe(750);
    expect(hold(5000)).toBe(750);
    expect(hold(10000)).toBe(750); // upper bound is inclusive
  });

  it('holds ₹1,000 for a bid in the second slab (10,001 – 20,000)', () => {
    expect(hold(10001)).toBe(1000);
    expect(hold(15000)).toBe(1000);
    expect(hold(20000)).toBe(1000);
  });

  it('holds ₹1,100 for a bid in the third slab (20,001 – 30,000)', () => {
    expect(hold(20001)).toBe(1100);
    expect(hold(30000)).toBe(1100);
  });

  it('adds 1% of the excess over 30,000 for a bid above the top slab', () => {
    expect(hold(30001)).toBe(1100); // +₹0.01 → rounds to 1100
    expect(hold(45000)).toBe(1250); // 1100 + 1% of 15,000
    expect(hold(100000)).toBe(1800); // 1100 + 1% of 70,000
    expect(hold(1000000)).toBe(10800); // 1100 + 1% of 970,000 — no cap
  });

  it('rounds the overage to the nearest rupee', () => {
    expect(hold(30050)).toBe(1101); // 1100 + 1% of 50 = 1100.5 → 1101
    expect(hold(30049)).toBe(1100); // 1100 + 0.49 → 1100
  });
});

describe('computeBidSecurityHold — edge cases', () => {
  it('returns 0 for a non-positive or non-numeric bid', () => {
    expect(computeBidSecurityHold(0)).toBe(0);
    expect(computeBidSecurityHold(-500)).toBe(0);
    expect(computeBidSecurityHold(undefined)).toBe(0);
    expect(computeBidSecurityHold('abc')).toBe(0);
  });

  it('returns 0 when the slab table is empty (deposit disabled)', () => {
    expect(computeBidSecurityHold(5000, { slabs: [], above_slab_percent: 1 })).toBe(0);
    expect(computeBidSecurityHold(5000, {})).toBe(0);
    expect(computeBidSecurityHold(5000, null)).toBe(0);
  });

  it('sorts slabs by up_to before evaluating', () => {
    const table = {
      slabs: [
        { up_to: 30000, amount: 1100 },
        { up_to: 10000, amount: 750 },
        { up_to: 20000, amount: 1000 }
      ],
      above_slab_percent: 1
    };
    expect(computeBidSecurityHold(5000, table)).toBe(750);
    expect(computeBidSecurityHold(25000, table)).toBe(1100);
    expect(computeBidSecurityHold(40000, table)).toBe(1200);
  });

  it('treats a missing / zero above_slab_percent as a flat top-slab hold', () => {
    const table = { slabs: [{ up_to: 10000, amount: 750 }], above_slab_percent: 0 };
    expect(computeBidSecurityHold(50000, table)).toBe(750);
    expect(computeBidSecurityHold(50000, { slabs: [{ up_to: 10000, amount: 750 }] })).toBe(750);
  });

  it('supports a single-slab table (flat deposit for every bid at/below it)', () => {
    const table = { slabs: [{ up_to: 1000000, amount: 1000 }], above_slab_percent: 1 };
    expect(computeBidSecurityHold(500, table)).toBe(1000);
    expect(computeBidSecurityHold(999999, table)).toBe(1000);
  });
});
