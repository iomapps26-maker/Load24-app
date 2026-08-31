import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyEmail = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyEmail: (...args) => notifyEmail(...args),
  notifyUser: vi.fn(() => Promise.resolve())
}));

// §5 bid security hold — deliver releases the approved bid's hold; the
// mechanics live in lib/bidSecurityHold.test.js.
const releaseBidSecurityHold = vi.fn(() => Promise.resolve(null));
vi.mock('../lib/bidSecurityHold.js', () => ({
  releaseBidSecurityHold: (...args) => releaseBidSecurityHold(...args),
  placeBidSecurityHold: vi.fn(() => Promise.resolve({ id: 'hold-txn' })),
  sweepExpiredBidHolds: vi.fn(() => Promise.resolve())
}));

// §8 booking — deliver moves it to 'completed'. Mechanics in lib/bookings.js.
const completeBookingForLoad = vi.fn(() => Promise.resolve({ id: 'bk-1', status: 'completed' }));
vi.mock('../lib/bookings.js', () => ({
  completeBookingForLoad: (...args) => completeBookingForLoad(...args),
  createBookingForConfirmedBid: vi.fn(() => Promise.resolve(null)),
  ensureBooking: vi.fn(() => Promise.resolve(null)),
  getBookingByLoadId: vi.fn(() => Promise.resolve(null)),
  cancelBookingForLoad: vi.fn(() => Promise.resolve(null)),
  getBookingByBidId: vi.fn(() => Promise.resolve(null)),
  BOOKING_COLUMNS: 'id'
}));

// Records every supabaseAdmin.from('loads').update(...) call so tests can
// assert the patch and the status guard it was scoped to, without simulating
// real row filtering.
const adminCalls = [];

// Backing store for the tables applyCommissionForCompletedTrip touches
// (commission_rules, user_profiles, wallets, wallet_transactions) — thenable
// at every step, same approach as kyc.test.js/trucks.test.js's adminStore.
function createAdminStore() {
  return { commission_rules: [], user_profiles: [], wallets: [], wallet_transactions: [] };
}
let adminStore = createAdminStore();

function makeAdminQueryBuilder(table) {
  const filters = [];
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    maybeSingle: () => {
      const rows = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows[0] || null, error: null });
    },
    insert(row) {
      const saved = { id: `${table}-${(adminStore[table] || []).length + 1}`, created_at: new Date().toISOString(), balance: 0, ...row };
      (adminStore[table] || (adminStore[table] = [])).push(saved);
      return { select: () => ({ single: () => Promise.resolve({ data: saved, error: null }) }) };
    },
    then: (resolve) => {
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => {
      if (table === 'loads') {
        const call = { table, patch: null, filters: [], inFilters: [] };
        adminCalls.push(call);
        const c = {};
        c.update = (patch) => {
          call.patch = patch;
          return c;
        };
        c.eq = (field, value) => {
          call.filters.push([field, value]);
          return c;
        };
        c.in = (field, values) => {
          call.inFilters.push([field, values]);
          return c;
        };
        c.select = () => c;
        c.single = () => Promise.resolve({ data: { ...call.patch, id: call.filters.find((f) => f[0] === 'id')?.[1] }, error: null });
        return c;
      }
      if (['commission_rules', 'user_profiles', 'wallets', 'wallet_transactions'].includes(table)) {
        return makeAdminQueryBuilder(table);
      }
      throw new Error(`unexpected admin table ${table}`);
    }
  }
}));

const { default: loadBidsRouter } = await import('./loadBids.js');

function mockReqSupabase({ load, bid }) {
  return {
    from(table) {
      if (table === 'loads') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: load, error: null }) }) }) };
      }
      if (table === 'load_bids') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: bid, error: null }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function buildApp({ load, bid, callerEmail }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'caller-1', email: callerEmail };
    req.supabase = mockReqSupabase({ load, bid });
    next();
  });
  app.use('/api/load-bids', loadBidsRouter);
  return app;
}

describe('POST /api/load-bids/load/:load_id/deliver', () => {
  const load = { id: 'load-1', posted_by: 'poster@example.com', status: 'matched', material_type: 'Cement', required_truck_type: 'tata_407' };
  const bid = { id: 'bid-1', load_id: 'load-1', bid_by_email: 'trucker@example.com', status: 'approved', amount: 5000 };

  beforeEach(() => {
    adminCalls.length = 0;
    adminStore = createAdminStore();
    notifyEmail.mockClear();
    releaseBidSecurityHold.mockClear();
    completeBookingForLoad.mockClear();
  });

  it('lets the poster mark the trip delivered, releases the hold, completes the booking and notifies the accepter', async () => {
    const app = buildApp({ load, bid, callerEmail: 'poster@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(200);
    const call = adminCalls.find((c) => c.table === 'loads');
    expect(call.patch).toEqual({ status: 'completed' });
    expect(call.filters).toContainEqual(['id', 'load-1']);
    expect(call.inFilters).toContainEqual(['status', ['matched', 'in_transit']]);
    expect(releaseBidSecurityHold).toHaveBeenCalledWith(bid, { reason: 'trip completed' });
    expect(completeBookingForLoad).toHaveBeenCalledWith('load-1');
    expect(notifyEmail).toHaveBeenCalledWith('trucker@example.com', expect.objectContaining({ type: 'trip_delivered' }));
  });

  it('lets the approved accepter mark the trip delivered and notifies the poster', async () => {
    const app = buildApp({ load, bid, callerEmail: 'trucker@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(200);
    expect(notifyEmail).toHaveBeenCalledWith('poster@example.com', expect.objectContaining({ type: 'trip_delivered' }));
  });

  it('rejects a caller who is neither the poster nor the approved accepter', async () => {
    const app = buildApp({ load, bid, callerEmail: 'stranger@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(403);
    expect(adminCalls.length).toBe(0);
  });

  it('409s when the load is already completed', async () => {
    const app = buildApp({ load: { ...load, status: 'completed' }, bid, callerEmail: 'poster@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(409);
    expect(adminCalls.length).toBe(0);
  });

  it('404s when there is no approved bid on the load', async () => {
    const app = buildApp({ load, bid: null, callerEmail: 'poster@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(404);
  });

  describe('commission auto-apply', () => {
    it('does not error when no commission rule matches (silent no-op)', async () => {
      // adminStore.commission_rules is empty — nothing to match.
      const app = buildApp({ load, bid, callerEmail: 'poster@example.com' });
      const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

      expect(res.status).toBe(200);
      expect(adminStore.wallet_transactions).toHaveLength(0);
    });

    it('applies a matching active commission rule as a wallet adjustment on the accepter', async () => {
      adminStore.commission_rules.push({
        id: 'rule-1',
        material_type: 'Cement',
        vehicle_type: 'tata_407',
        rate_percent: 10,
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z'
      });
      adminStore.user_profiles.push({ user_id: 'trucker-user-1', user_email: 'trucker@example.com' });

      const app = buildApp({ load, bid, callerEmail: 'poster@example.com' });
      const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

      expect(res.status).toBe(200);
      expect(adminStore.wallet_transactions).toHaveLength(1);
      const tx = adminStore.wallet_transactions[0];
      expect(tx).toMatchObject({
        user_id: 'trucker-user-1',
        type: 'commission',
        amount: 500, // 10% of bid.amount (5000)
        status: 'completed',
        reference_load_id: 'load-1'
      });
    });

    it('ignores an inactive rule even if it would otherwise match', async () => {
      adminStore.commission_rules.push({
        id: 'rule-1',
        material_type: 'Cement',
        vehicle_type: 'tata_407',
        rate_percent: 10,
        is_active: false,
        created_at: '2026-01-01T00:00:00.000Z'
      });
      adminStore.user_profiles.push({ user_id: 'trucker-user-1', user_email: 'trucker@example.com' });

      const app = buildApp({ load, bid, callerEmail: 'poster@example.com' });
      const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

      expect(res.status).toBe(200);
      expect(adminStore.wallet_transactions).toHaveLength(0);
    });

    it('prefers the more specific matching rule over a generic one', async () => {
      adminStore.commission_rules.push(
        { id: 'generic', material_type: null, vehicle_type: null, rate_percent: 5, is_active: true, created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'specific', material_type: 'Cement', vehicle_type: 'tata_407', rate_percent: 10, is_active: true, created_at: '2026-01-02T00:00:00.000Z' }
      );
      adminStore.user_profiles.push({ user_id: 'trucker-user-1', user_email: 'trucker@example.com' });

      const app = buildApp({ load, bid, callerEmail: 'poster@example.com' });
      const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

      expect(res.status).toBe(200);
      expect(adminStore.wallet_transactions[0].amount).toBe(500); // 10%, not the generic rule's 5%
    });

    it('does not apply commission when the accepter has no resolvable profile', async () => {
      adminStore.commission_rules.push({
        id: 'rule-1', material_type: null, vehicle_type: null, rate_percent: 10, is_active: true, created_at: '2026-01-01T00:00:00.000Z'
      });
      // No user_profiles row seeded for trucker@example.com.

      const app = buildApp({ load, bid, callerEmail: 'poster@example.com' });
      const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

      expect(res.status).toBe(200);
      expect(adminStore.wallet_transactions).toHaveLength(0);
    });
  });
});
