import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { master_data: [], user_roles: [] };
}
let adminStore = createAdminStore();

function makeAdminQueryBuilder(table) {
  const filters = [];
  let sort = null;
  let projection = null;
  const builder = {
    // Mimics Postgrest column projection (real supabase-js narrows the
    // response to exactly the requested columns) — publicMasterDataRouter
    // relies on this to keep id/category/is_active out of its response.
    select: (fields) => {
      if (fields && fields !== '*') projection = fields.split(',').map((f) => f.trim());
      return builder;
    },
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
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: data[0] ?? null, error: null });
    },
    insert(row) {
      if ((adminStore[table] || []).some((r) => r.category === row.category && r.value === row.value)) {
        return { select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }) }) };
      }
      const withId = { id: `id-${(adminStore[table] || []).length + 1}`, ...row };
      (adminStore[table] || (adminStore[table] = [])).push(withId);
      return { select: () => ({ single: () => Promise.resolve({ data: withId, error: null }) }) };
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
      if (projection) data = data.map((r) => Object.fromEntries(projection.map((f) => [f, r[f]])));
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { default: masterDataRouter, publicMasterDataRouter } = await import('./masterData.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/master-data', requireRole(STAFF_ROLES), masterDataRouter);
  app.use('/api/master-data', publicMasterDataRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('POST /api/admin/master-data', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/master-data').send({ category: 'truck_type', value: 'x', label: 'X' });
    expect(res.status).toBe(403);
  });

  it('requires category, value, and label', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/master-data').send({ category: 'truck_type', value: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown category', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/master-data').send({ category: 'weather', value: 'x', label: 'X' });
    expect(res.status).toBe(400);
  });

  it('creates a row, defaulting is_active to true', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/master-data').send({ category: 'support_category', value: 'billing', label: 'Billing' });
    expect(res.status).toBe(201);
    expect(res.body.is_active).toBe(true);
  });

  it('rejects a duplicate (category, value) pair', async () => {
    staff();
    await request(buildApp()).post('/api/admin/master-data').send({ category: 'truck_type', value: 'tata_407', label: 'Tata 407' });
    const res = await request(buildApp()).post('/api/admin/master-data').send({ category: 'truck_type', value: 'tata_407', label: 'Tata 407 (dup)' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/admin/master-data', () => {
  it('filters by category and is_active', async () => {
    staff();
    adminStore.master_data.push(
      { id: '1', category: 'truck_type', value: 'tata_407', label: 'Tata 407', is_active: true },
      { id: '2', category: 'body_type', value: 'open', label: 'Open', is_active: true },
      { id: '3', category: 'truck_type', value: 'retired', label: 'Retired', is_active: false }
    );
    const res = await request(buildApp()).get('/api/admin/master-data?category=truck_type&is_active=true');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual(['1']);
  });
});

describe('PATCH /api/admin/master-data/:id', () => {
  it('deactivates a row', async () => {
    staff();
    adminStore.master_data.push({ id: '1', category: 'truck_type', value: 'tata_407', label: 'Tata 407', is_active: true });
    const res = await request(buildApp()).patch('/api/admin/master-data/1').send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });
});

describe('DELETE /api/admin/master-data/:id', () => {
  it('removes a row', async () => {
    staff();
    adminStore.master_data.push({ id: '1', category: 'truck_type', value: 'tata_407', label: 'Tata 407', is_active: true });
    const res = await request(buildApp()).delete('/api/admin/master-data/1');
    expect(res.status).toBe(204);
    expect(adminStore.master_data).toHaveLength(0);
  });
});

describe('GET /api/master-data/:category', () => {
  it('requires no auth', async () => {
    adminStore.master_data.push({ id: '1', category: 'truck_type', value: 'tata_407', label: 'Tata 407', is_active: true });
    const app = express();
    app.use('/api/master-data', publicMasterDataRouter);
    const res = await request(app).get('/api/master-data/truck_type');
    expect(res.status).toBe(200);
  });

  it('rejects an unknown category with 400', async () => {
    const res = await request(buildApp()).get('/api/master-data/weather');
    expect(res.status).toBe(400);
  });

  it('returns only active rows, as value/label pairs, alphabetically by label', async () => {
    adminStore.master_data.push(
      { id: '1', category: 'truck_type', value: 'tata_407', label: 'Tata 407', is_active: true },
      { id: '2', category: 'truck_type', value: 'other', label: 'Other', is_active: true },
      { id: '3', category: 'truck_type', value: 'retired_type', label: 'Retired Type', is_active: false },
      { id: '4', category: 'body_type', value: 'open', label: 'Open', is_active: true }
    );
    const res = await request(buildApp()).get('/api/master-data/truck_type');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { value: 'other', label: 'Other' },
      { value: 'tata_407', label: 'Tata 407' }
    ]);
  });
});
