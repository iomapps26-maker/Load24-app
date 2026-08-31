import { describe, it, expect, beforeEach, vi } from 'vitest';

// applyWalletAdjustment is the only thing that writes to the ledger — mock
// it and record the calls so these tests can assert type/amount/txn id and
// simulate a unique-violation (concurrent double-release).
const adjustCalls = [];
let adjustImpl = (args) => Promise.resolve({ id: `txn-${adjustCalls.length}`, ...args });
vi.mock('./wallet.js', () => ({
  applyWalletAdjustment: (args) => {
    adjustCalls.push(args);
    return adjustImpl(args);
  }
}));

// In-memory user_profiles + load_bids behind the service-role client.
const db = { user_profiles: [], load_bids: [] };
const loadBidsUpdates = [];

vi.mock('./supabase.js', () => ({
  supabaseAdmin: {
    from(table) {
      if (table === 'user_profiles') {
        const filters = [];
        const builder = {
          select: () => builder,
          eq: (field, value) => {
            filters.push((r) => r[field] === value);
            return builder;
          },
          maybeSingle: () =>
            Promise.resolve({ data: db.user_profiles.find((r) => filters.every((f) => f(r))) ?? null, error: null })
        };
        return builder;
      }
      if (table === 'load_bids') {
        return {
          update(patch) {
            const filters = [];
            const chain = {
              eq: (field, value) => {
                filters.push((r) => r[field] === value);
                return chain;
              },
              is: (field, value) => {
                filters.push((r) => (value === null ? r[field] == null : r[field] === value));
                return chain;
              },
              then: (resolve) => {
                const matches = db.load_bids.filter((r) => filters.every((f) => f(r)));
                matches.forEach((r) => Object.assign(r, patch));
                loadBidsUpdates.push({ patch, matched: matches.length });
                resolve({ data: matches, error: null });
              }
            };
            return chain;
          }
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  }
}));

const { placeBidSecurityHold, releaseBidSecurityHold, sweepExpiredBidHolds } = await import('./bidSecurityHold.js');

const heldBid = (over = {}) => ({
  id: 'bid-1',
  load_id: 'load-1',
  bid_by_email: 'bidder@example.com',
  status: 'pending',
  expires_at: new Date(Date.now() - 60_000).toISOString(),
  security_hold_txn_id: 'hold-txn-1',
  security_hold_amount: 1000,
  security_hold_released_at: null,
  ...over
});

beforeEach(() => {
  adjustCalls.length = 0;
  loadBidsUpdates.length = 0;
  adjustImpl = (args) => Promise.resolve({ id: `txn-${adjustCalls.length}`, ...args });
  db.user_profiles = [{ user_email: 'bidder@example.com', user_id: 'bidder-1' }];
  db.load_bids = [];
});

describe('placeBidSecurityHold', () => {
  it('writes one security_hold ledger entry for the load', async () => {
    await placeBidSecurityHold({ userId: 'bidder-1', loadId: 'load-1', amount: 1000 });
    expect(adjustCalls).toHaveLength(1);
    expect(adjustCalls[0]).toMatchObject({
      user_id: 'bidder-1',
      type: 'security_hold',
      amount: 1000,
      reference_load_id: 'load-1'
    });
  });
});

describe('releaseBidSecurityHold', () => {
  it('writes a security_release for the held amount with a deterministic txn id', async () => {
    db.load_bids = [heldBid()];
    const txn = await releaseBidSecurityHold(heldBid(), { reason: 'bid rejected' });

    expect(txn).not.toBeNull();
    expect(adjustCalls[0]).toMatchObject({
      user_id: 'bidder-1',
      type: 'security_release',
      amount: 1000,
      reference_load_id: 'load-1',
      transaction_id: 'REL-bid-1'
    });
    expect(db.load_bids[0].security_hold_released_at).toBeTruthy();
  });

  it('is a no-op when the bid never had a hold', async () => {
    const r = await releaseBidSecurityHold(heldBid({ security_hold_txn_id: null, security_hold_amount: null }));
    expect(r).toBeNull();
    expect(adjustCalls).toHaveLength(0);
  });

  it('is a no-op when the hold was already released', async () => {
    const r = await releaseBidSecurityHold(heldBid({ security_hold_released_at: '2026-08-01T00:00:00.000Z' }));
    expect(r).toBeNull();
    expect(adjustCalls).toHaveLength(0);
  });

  it('swallows a unique-violation (23505) from a concurrent release', async () => {
    db.load_bids = [heldBid()];
    adjustImpl = () => Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const r = await releaseBidSecurityHold(heldBid());
    expect(r).toBeNull();
    expect(db.load_bids[0].security_hold_released_at).toBeNull();
  });

  it('rethrows a non-unique-violation error', async () => {
    adjustImpl = () => Promise.reject(Object.assign(new Error('boom'), { code: '55000' }));
    await expect(releaseBidSecurityHold(heldBid())).rejects.toThrow('boom');
  });

  it('is a no-op (no throw) when the bidder has no profile', async () => {
    db.user_profiles = [];
    const r = await releaseBidSecurityHold(heldBid());
    expect(r).toBeNull();
    expect(adjustCalls).toHaveLength(0);
  });
});

describe('sweepExpiredBidHolds', () => {
  it('rejects and releases only stale pending bids with an unreleased hold', async () => {
    const stale = heldBid({ id: 'bid-stale' });
    const freshPending = heldBid({ id: 'bid-fresh', expires_at: new Date(Date.now() + 60_000).toISOString() });
    const alreadyApproved = heldBid({ id: 'bid-approved', status: 'approved' });
    const noHold = heldBid({ id: 'bid-nohold', security_hold_txn_id: null });
    db.load_bids = [{ ...stale }, { ...freshPending }, { ...alreadyApproved }, { ...noHold }];

    await sweepExpiredBidHolds([stale, freshPending, alreadyApproved, noHold]);

    // Only the stale pending bid: one status flip + one release.
    expect(loadBidsUpdates.filter((u) => u.patch.status === 'rejected')).toHaveLength(1);
    expect(adjustCalls).toHaveLength(1);
    expect(adjustCalls[0]).toMatchObject({ type: 'security_release', transaction_id: 'REL-bid-stale' });
  });

  it('does nothing for an empty / nullish list', async () => {
    await sweepExpiredBidHolds(null);
    await sweepExpiredBidHolds([]);
    expect(adjustCalls).toHaveLength(0);
  });
});
