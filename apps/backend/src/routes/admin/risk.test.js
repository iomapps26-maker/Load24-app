import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], user_profiles: [], loads: [], load_bids: [] };
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
    in: (field, values) => {
      filters.push((r) => values.includes(r[field]));
      return builder;
    },
    then: (resolve) => {
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { default: riskRouter } = await import('./risk.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/risk', requireRole(STAFF_ROLES), riskRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/risk', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/risk');
    expect(res.status).toBe(403);
  });

  it('returns an empty array when there are no profiles', async () => {
    staff();
    const res = await request(buildApp()).get('/api/admin/risk');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('aggregates each user\'s loads/bids and sorts riskiest first', async () => {
    staff();
    adminStore.user_profiles.push(
      { user_id: 'u1', user_email: 'clean@x.com', full_name: 'Clean User', kyc_status: 'verified', trust_score: 90 },
      { user_id: 'u2', user_email: 'risky@x.com', full_name: 'Risky User', kyc_status: 'pending', trust_score: 20 }
    );
    adminStore.loads.push(
      { posted_by: 'clean@x.com', status: 'completed' },
      { posted_by: 'risky@x.com', status: 'cancelled' },
      { posted_by: 'risky@x.com', status: 'expired' },
      { posted_by: 'risky@x.com', status: 'active' } // not terminal, doesn't count as cancelled
    );
    adminStore.load_bids.push(
      { bid_by_email: 'risky@x.com', status: 'rejected' }
    );

    const res = await request(buildApp()).get('/api/admin/risk');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].user_id).toBe('u2'); // riskiest first
    expect(res.body[0]).toMatchObject({
      total_loads: 3,
      cancelled_loads: 2,
      total_bids: 1,
      rejected_bids: 1,
      kyc_mismatch: true
    });
    expect(res.body[0].risk_score).toBeGreaterThan(res.body[1].risk_score);
    expect(res.body[1].user_id).toBe('u1');
    expect(res.body[1].kyc_mismatch).toBe(false);
  });

  it('gives a user with no loads/bids at all a risk score based on trust alone', async () => {
    staff();
    adminStore.user_profiles.push({ user_id: 'u1', user_email: 'new@x.com', kyc_status: 'pending', trust_score: 50 });

    const res = await request(buildApp()).get('/api/admin/risk');

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      total_loads: 0, cancelled_loads: 0, total_bids: 0, rejected_bids: 0,
      kyc_mismatch: false, // not active, so no mismatch even though kyc_status isn't verified
      risk_score: 50 // trust component only: 100 - 50
    });
  });

  it('respects the limit query param', async () => {
    staff();
    for (let i = 0; i < 5; i++) {
      adminStore.user_profiles.push({ user_id: `u${i}`, user_email: `u${i}@x.com`, kyc_status: 'verified', trust_score: 50 });
    }

    const res = await request(buildApp()).get('/api/admin/risk').query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
