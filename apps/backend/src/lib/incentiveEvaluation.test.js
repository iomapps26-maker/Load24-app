import { describe, it, expect, vi, beforeEach } from 'vitest';

function createStore() {
  return { incentive_rules: [], load_bids: [], loads: [], user_profiles: [], wallets: [], wallet_transactions: [] };
}
let store = createStore();

function makeBuilder(table) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    in: (field, values) => {
      filters.push((r) => values.includes(r[field]));
      return builder;
    },
    maybeSingle: () => {
      const rows = (store[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows[0] || null, error: null });
    },
    insert(row) {
      const saved = { id: `${table}-${(store[table] || []).length + 1}`, created_at: new Date().toISOString(), balance: 0, ...row };
      (store[table] || (store[table] = [])).push(saved);
      return { select: () => ({ single: () => Promise.resolve({ data: saved, error: null }) }) };
    },
    then: (resolve) => {
      const data = (store[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('./supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeBuilder(table) }
}));

const { evaluateIncentiveRules } = await import('./incentiveEvaluation.js');

beforeEach(() => {
  store = createStore();
});

function seedTwoCompletedTrips(email) {
  store.load_bids.push(
    { bid_by_email: email, load_id: 'l1', status: 'approved' },
    { bid_by_email: email, load_id: 'l2', status: 'approved' }
  );
  store.loads.push({ id: 'l1', status: 'completed' }, { id: 'l2', status: 'completed' });
}

describe('evaluateIncentiveRules', () => {
  it('does nothing when there are no active rules', async () => {
    store.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 2, reward_amount: 100, is_active: false });
    const result = await evaluateIncentiveRules();
    expect(result.payouts_applied).toBe(0);
    expect(store.wallet_transactions).toHaveLength(0);
  });

  it('pays a user who has met the threshold', async () => {
    store.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 2, reward_amount: 250, is_active: true });
    seedTwoCompletedTrips('trucker@x.com');
    store.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const result = await evaluateIncentiveRules();

    expect(result.payouts_applied).toBe(1);
    expect(store.wallet_transactions).toHaveLength(1);
    expect(store.wallet_transactions[0]).toMatchObject({ user_id: 'trucker-user', type: 'credit', amount: 250, status: 'completed' });
  });

  it('does not pay a user below the threshold', async () => {
    store.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 5, reward_amount: 250, is_active: true });
    seedTwoCompletedTrips('trucker@x.com'); // only 2 completed trips, threshold is 5
    store.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const result = await evaluateIncentiveRules();
    expect(result.payouts_applied).toBe(0);
  });

  it('does not double-pay the same rule to the same user on a second run', async () => {
    store.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 2, reward_amount: 250, is_active: true });
    seedTwoCompletedTrips('trucker@x.com');
    store.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const first = await evaluateIncentiveRules();
    const second = await evaluateIncentiveRules();

    expect(first.payouts_applied).toBe(1);
    expect(second.payouts_applied).toBe(0); // already paid — de-duped via wallet_transactions.notes
    expect(store.wallet_transactions).toHaveLength(1);
  });

  it('does not count a bid on a load that is not completed', async () => {
    store.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 1, reward_amount: 100, is_active: true });
    store.load_bids.push({ bid_by_email: 'trucker@x.com', load_id: 'l1', status: 'approved' });
    store.loads.push({ id: 'l1', status: 'in_transit' }); // not yet completed
    store.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const result = await evaluateIncentiveRules();
    expect(result.payouts_applied).toBe(0);
  });

  it('skips a rule whose metric has no registered evaluator, without throwing', async () => {
    store.incentive_rules.push({ id: 'r1', metric: 'unknown_future_metric', threshold: 1, reward_amount: 100, is_active: true });
    await expect(evaluateIncentiveRules()).resolves.toEqual({ payouts_applied: 0 });
  });
});
