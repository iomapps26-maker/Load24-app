import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// dashboard.js is entirely count/sum queries (no row-fetching), so this
// mock is shaped around {count, head:true} selects and a single rpc() call
// rather than the row-returning builders kyc.test.js/trucks.test.js use.
function createCountStore() {
  return { user_roles: [], kyc_cases: [], loads: [], truck_availabilities: [] };
}
let countStore = createCountStore();
let mockState = {
  listUsersTotal: 5,
  listUsersError: null,
  revenue: 0,
  revenueError: null
};

// Thenable at every step (same approach as kyc.test.js/trucks.test.js) so
// this works both for dashboard.js's own single-filter-then-await queries
// AND for requireRole's .select().eq().in() chain (.eq() isn't terminal
// there — .in() is).
function makeCountBuilder(table) {
  const filters = [];
  const builder = {
    select: () => builder, // {count:'exact', head:true} — mode doesn't matter, this mock always counts
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    in: (field, values) => {
      filters.push((r) => values.includes(r[field]));
      return builder;
    },
    then: (resolve) => {
      const rows = (countStore[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data: rows, count: rows.length, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => makeCountBuilder(table),
    auth: {
      admin: {
        listUsers: () => Promise.resolve({ data: { total: mockState.listUsersTotal }, error: mockState.listUsersError })
      }
    },
    rpc: (fnName) => {
      if (fnName !== 'admin_wallet_revenue') throw new Error(`unexpected rpc ${fnName}`);
      return Promise.resolve({ data: mockState.revenue, error: mockState.revenueError });
    }
  }
}));

const { default: dashboardRouter } = await import('./dashboard.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

// Mirrors exactly how index.js mounts this router — requireRole lives at
// the mount point, not inside dashboard.js itself, so the 403 case below is
// really testing that wiring, same as it'll behave in production.
function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/dashboard', requireRole(STAFF_ROLES), dashboardRouter);
  return app;
}

beforeEach(() => {
  countStore = createCountStore();
  mockState = { listUsersTotal: 5, listUsersError: null, revenue: 0, revenueError: null };
});

describe('GET /api/admin/dashboard', () => {
  it('rejects a non-staff caller with 403', async () => {
    const app = buildApp('user-1');
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  it('returns every tile computed from its own query', async () => {
    countStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    countStore.kyc_cases.push({ status: 'pending' }, { status: 'partial' }, { status: 'submitted' }, { status: 'verified' });
    countStore.loads.push(
      { status: 'active' },
      { status: 'active' },
      { status: 'matched' },
      { status: 'in_transit' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'cancelled' }
    );
    countStore.truck_availabilities.push({ status: 'available' }, { status: 'available' }, { status: 'booked' });
    mockState.listUsersTotal = 42;
    mockState.revenue = 15000;

    const app = buildApp('staff-1');
    const res = await request(app).get('/api/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total_users: 42,
      kyc_pending: 3, // pending + partial + submitted, not 'verified'
      live_loads: 2,
      available_vehicles: 2,
      bookings: 1,
      active_trips: 1,
      completed_loads: 2,
      revenue: 15000
    });
  });

  it('folds a failed sub-query into 0 rather than failing the whole dashboard', async () => {
    countStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    mockState.listUsersError = { message: 'Database error finding users' };
    mockState.revenueError = { message: 'function not found' };

    const app = buildApp('staff-1');
    const res = await request(app).get('/api/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.total_users).toBe(0);
    expect(res.body.revenue).toBe(0);
    expect(res.body.live_loads).toBe(0);
  });
});
