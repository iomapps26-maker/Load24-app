import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], incentive_rules: [], load_bids: [], loads: [], user_profiles: [], wallets: [], wallet_transactions: [] };
}
let adminStore = createAdminStore();

function makeAdminQueryBuilder(table) {
  const filters = [];
  let sort = null;
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
    order: (field, { ascending = true } = {}) => {
      sort = { field, sign: ascending ? 1 : -1 };
      return builder;
    },
    maybeSingle: () => {
      const rows = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows[0] || null, error: null });
    },
    insert(row) {
      return {
        select: () => ({
          single: () => {
            const saved = {
              id: `rule-${(adminStore[table] || []).length + 1}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              balance: 0,
              ...row
            };
            (adminStore[table] || (adminStore[table] = [])).push(saved);
            return Promise.resolve({ data: saved, error: null });
          }
        })
      };
    },
    update(patch) {
      const updateFilters = [];
      const updateBuilder = {
        eq: (field, value) => {
          updateFilters.push((r) => r[field] === value);
          return updateBuilder;
        },
        select: () => ({
          maybeSingle: () => {
            const match = (adminStore[table] || []).find((r) => updateFilters.every((f) => f(r)));
            if (!match) return Promise.resolve({ data: null, error: null });
            Object.assign(match, patch);
            return Promise.resolve({ data: match, error: null });
          }
        })
      };
      return updateBuilder;
    },
    delete() {
      const deleteFilters = [];
      const deleteBuilder = {
        eq: (field, value) => {
          deleteFilters.push((r) => r[field] === value);
          return deleteBuilder;
        },
        select: () => ({
          maybeSingle: () => {
            const idx = (adminStore[table] || []).findIndex((r) => deleteFilters.every((f) => f(r)));
            if (idx === -1) return Promise.resolve({ data: null, error: null });
            const [removed] = adminStore[table].splice(idx, 1);
            return Promise.resolve({ data: removed, error: null });
          }
        })
      };
      return deleteBuilder;
    },
    then: (resolve) => {
      let data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      if (sort) {
        const { field, sign } = sort;
        data = [...data].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
      }
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { default: incentivesRouter } = await import('./incentives.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/incentives', requireRole(STAFF_ROLES), incentivesRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/incentives', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/incentives');
    expect(res.status).toBe(403);
  });

  it('lists rules, filterable by is_active/metric', async () => {
    staff();
    adminStore.incentive_rules.push(
      { id: 'r1', metric: 'trips_completed', threshold: 10, reward_amount: 500, is_active: true },
      { id: 'r2', metric: 'trips_completed', threshold: 5, reward_amount: 200, is_active: false }
    );
    const res = await request(buildApp()).get('/api/admin/incentives').query({ is_active: 'true' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('r1');
  });
});

describe('POST /api/admin/incentives', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/incentives').send({ metric: 'trips_completed', threshold: 10, reward_amount: 500 });
    expect(res.status).toBe(403);
  });

  it('rejects an unknown metric', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/incentives').send({ metric: 'bogus', threshold: 10, reward_amount: 500 });
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive threshold or reward_amount', async () => {
    staff();
    const res1 = await request(buildApp()).post('/api/admin/incentives').send({ metric: 'trips_completed', threshold: 0, reward_amount: 500 });
    expect(res1.status).toBe(400);
    const res2 = await request(buildApp()).post('/api/admin/incentives').send({ metric: 'trips_completed', threshold: 10, reward_amount: -5 });
    expect(res2.status).toBe(400);
  });

  it('creates a rule, recording created_by, defaulting is_active to true', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/incentives').send({ metric: 'trips_completed', threshold: 10, reward_amount: 500 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ metric: 'trips_completed', threshold: 10, reward_amount: 500, is_active: true, created_by: 'staff-1' });
  });
});

describe('PATCH /api/admin/incentives/:id', () => {
  it('deactivates a rule', async () => {
    staff();
    adminStore.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 10, reward_amount: 500, is_active: true });
    const res = await request(buildApp()).patch('/api/admin/incentives/r1').send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });

  it('404s for a rule that does not exist', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/incentives/does-not-exist').send({ is_active: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/incentives/:id', () => {
  it('deletes a rule', async () => {
    staff();
    adminStore.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 10, reward_amount: 500, is_active: true });
    const res = await request(buildApp()).delete('/api/admin/incentives/r1');
    expect(res.status).toBe(204);
    expect(adminStore.incentive_rules).toHaveLength(0);
  });
});

describe('POST /api/admin/incentives/evaluate', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/incentives/evaluate');
    expect(res.status).toBe(403);
  });

  it('runs the job and reports how many payouts were applied', async () => {
    staff();
    adminStore.incentive_rules.push({ id: 'r1', metric: 'trips_completed', threshold: 1, reward_amount: 100, is_active: true });
    adminStore.load_bids.push({ bid_by_email: 'trucker@x.com', load_id: 'l1', status: 'approved' });
    adminStore.loads.push({ id: 'l1', status: 'completed' });
    adminStore.user_profiles.push({ user_id: 'trucker-user', user_email: 'trucker@x.com' });

    const res = await request(buildApp()).post('/api/admin/incentives/evaluate');

    expect(res.status).toBe(200);
    expect(res.body.payouts_applied).toBe(1);
    expect(adminStore.wallet_transactions).toHaveLength(1);
    expect(adminStore.wallet_transactions[0]).toMatchObject({ user_id: 'trucker-user', type: 'credit', amount: 100 });
  });
});
