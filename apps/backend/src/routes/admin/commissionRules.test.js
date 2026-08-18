import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], commission_rules: [] };
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

const { default: commissionRulesRouter } = await import('./commissionRules.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/commission-rules', requireRole(STAFF_ROLES), commissionRulesRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/commission-rules', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/commission-rules');
    expect(res.status).toBe(403);
  });

  it('lists rules, filterable by is_active/material_type/vehicle_type', async () => {
    staff();
    adminStore.commission_rules.push(
      { id: 'r1', material_type: 'Cement', vehicle_type: 'tata_407', rate_percent: 10, is_active: true },
      { id: 'r2', material_type: null, vehicle_type: null, rate_percent: 5, is_active: false }
    );

    const res = await request(buildApp()).get('/api/admin/commission-rules').query({ is_active: 'true' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('r1');
  });
});

describe('GET /api/admin/commission-rules/:id', () => {
  it('404s for a rule that does not exist', async () => {
    staff();
    const res = await request(buildApp()).get('/api/admin/commission-rules/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns a single rule', async () => {
    staff();
    adminStore.commission_rules.push({ id: 'r1', material_type: 'Cement', vehicle_type: null, rate_percent: 10, is_active: true });
    const res = await request(buildApp()).get('/api/admin/commission-rules/r1');
    expect(res.status).toBe(200);
    expect(res.body.material_type).toBe('Cement');
  });
});

describe('POST /api/admin/commission-rules', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/commission-rules').send({ rate_percent: 10 });
    expect(res.status).toBe(403);
  });

  it('rejects a missing/invalid rate_percent', async () => {
    staff();
    const res1 = await request(buildApp()).post('/api/admin/commission-rules').send({});
    expect(res1.status).toBe(400);
    const res2 = await request(buildApp()).post('/api/admin/commission-rules').send({ rate_percent: 0 });
    expect(res2.status).toBe(400);
    const res3 = await request(buildApp()).post('/api/admin/commission-rules').send({ rate_percent: 101 });
    expect(res3.status).toBe(400);
  });

  it('creates a rule, recording created_by, defaulting is_active to true', async () => {
    staff();
    const res = await request(buildApp())
      .post('/api/admin/commission-rules')
      .send({ material_type: 'Cement', vehicle_type: 'tata_407', rate_percent: 10 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      material_type: 'Cement',
      vehicle_type: 'tata_407',
      rate_percent: 10,
      is_active: true,
      created_by: 'staff-1'
    });
  });

  it('treats omitted material_type/vehicle_type as wildcards (null)', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/commission-rules').send({ rate_percent: 8 });
    expect(res.status).toBe(201);
    expect(res.body.material_type).toBeNull();
    expect(res.body.vehicle_type).toBeNull();
  });
});

describe('PATCH /api/admin/commission-rules/:id', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).patch('/api/admin/commission-rules/r1').send({ is_active: false });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid rate_percent', async () => {
    staff();
    adminStore.commission_rules.push({ id: 'r1', material_type: null, vehicle_type: null, rate_percent: 10, is_active: true });
    const res = await request(buildApp()).patch('/api/admin/commission-rules/r1').send({ rate_percent: -5 });
    expect(res.status).toBe(400);
  });

  it('deactivates a rule', async () => {
    staff();
    adminStore.commission_rules.push({ id: 'r1', material_type: null, vehicle_type: null, rate_percent: 10, is_active: true });
    const res = await request(buildApp()).patch('/api/admin/commission-rules/r1').send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });

  it('404s for a rule that does not exist', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/commission-rules/does-not-exist').send({ is_active: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/commission-rules/:id', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).delete('/api/admin/commission-rules/r1');
    expect(res.status).toBe(403);
  });

  it('deletes a rule', async () => {
    staff();
    adminStore.commission_rules.push({ id: 'r1', material_type: null, vehicle_type: null, rate_percent: 10, is_active: true });
    const res = await request(buildApp()).delete('/api/admin/commission-rules/r1');
    expect(res.status).toBe(204);
    expect(adminStore.commission_rules).toHaveLength(0);
  });

  it('404s for a rule that does not exist', async () => {
    staff();
    const res = await request(buildApp()).delete('/api/admin/commission-rules/does-not-exist');
    expect(res.status).toBe(404);
  });
});
