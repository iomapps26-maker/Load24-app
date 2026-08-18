import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], match_suggestions: [], loads: [], user_profiles: [], load_bids: [], truck_availabilities: [] };
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
    upsert: (rows) => {
      (adminStore[table] || (adminStore[table] = [])).push(...rows);
      return Promise.resolve({ data: rows, error: null });
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

const { default: crmRouter } = await import('./crm.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const CRM_STAFF_ROLES = ['admin', 'sales_executive', 'sales_team_lead', 'sales_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/crm', requireRole(CRM_STAFF_ROLES), crmRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff(role = 'sales_executive') {
  adminStore.user_roles.push({ user_id: 'staff-1', role });
}

describe('GET /api/admin/crm/suggestions', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/crm/suggestions');
    expect(res.status).toBe(403);
  });

  it('allows a sales_executive (not just admin/support roles)', async () => {
    staff('sales_executive');
    const res = await request(buildApp()).get('/api/admin/crm/suggestions');
    expect(res.status).toBe(200);
  });

  it('joins suggestions with the load and transporter profile', async () => {
    staff();
    adminStore.match_suggestions.push({
      id: 's1', load_id: 'l1', suggested_transporter_id: 'u1', reason: 'Recently bid on similar loads', created_at: '2026-01-01T00:00:00.000Z'
    });
    adminStore.loads.push({ id: 'l1', material_type: 'Cement' });
    adminStore.user_profiles.push({ user_id: 'u1', full_name: 'Transporter One' });

    const res = await request(buildApp()).get('/api/admin/crm/suggestions');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].load).toMatchObject({ material_type: 'Cement' });
    expect(res.body[0].transporter).toMatchObject({ full_name: 'Transporter One' });
  });

  it('filters by load_id', async () => {
    staff();
    adminStore.match_suggestions.push(
      { id: 's1', load_id: 'l1', suggested_transporter_id: 'u1', reason: 'r1', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 's2', load_id: 'l2', suggested_transporter_id: 'u2', reason: 'r2', created_at: '2026-01-02T00:00:00.000Z' }
    );

    const res = await request(buildApp()).get('/api/admin/crm/suggestions').query({ load_id: 'l2' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].load_id).toBe('l2');
  });
});

describe('POST /api/admin/crm/generate', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/crm/generate');
    expect(res.status).toBe(403);
  });

  it('runs the job and reports how many suggestions were upserted', async () => {
    staff();
    adminStore.loads.push({ id: 'target', posted_by: 'poster@x.com', status: 'active', material_type: 'Cement', required_truck_type: 'tata_407', loading_pincode: '400001' });
    adminStore.truck_availabilities.push({ owner_id: 'owner-user', current_pincode: '400001', status: 'available' });

    const res = await request(buildApp()).post('/api/admin/crm/generate');

    expect(res.status).toBe(200);
    expect(res.body.suggestions_upserted).toBe(1);
    expect(adminStore.match_suggestions).toHaveLength(1);
  });
});
