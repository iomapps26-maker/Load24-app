import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { support_contact_roster: [], user_roles: [] };
}
let adminStore = createAdminStore();

// Same shape as admin/masterData.test.js's mock query builder.
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
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: data[0] ?? null, error: null });
    },
    insert(row) {
      const withDefaults = { id: `id-${(adminStore[table] || []).length + 1}`, assigned_count: 0, ...row };
      (adminStore[table] || (adminStore[table] = [])).push(withDefaults);
      return { select: () => ({ single: () => Promise.resolve({ data: withDefaults, error: null }) }) };
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

const { default: supportContactsRouter } = await import('./supportContacts.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/support-contacts', requireRole(STAFF_ROLES), supportContactsRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('POST /api/admin/support-contacts', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/support-contacts').send({ name: 'Asha', phone: '9000000001' });
    expect(res.status).toBe(403);
  });

  it('requires name and phone', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/support-contacts').send({ name: 'Asha' });
    expect(res.status).toBe(400);
  });

  it('creates a row, defaulting is_active to true and assigned_count to 0', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/support-contacts').send({ name: 'Asha', phone: '9000000001' });
    expect(res.status).toBe(201);
    expect(res.body.is_active).toBe(true);
    expect(res.body.assigned_count).toBe(0);
  });
});

describe('GET /api/admin/support-contacts', () => {
  it('filters by is_active', async () => {
    staff();
    adminStore.support_contact_roster.push(
      { id: '1', name: 'Asha', phone: '9000000001', is_active: true, assigned_count: 3 },
      { id: '2', name: 'Ravi', phone: '9000000002', is_active: false, assigned_count: 0 }
    );
    const res = await request(buildApp()).get('/api/admin/support-contacts?is_active=true');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual(['1']);
  });
});

describe('PATCH /api/admin/support-contacts/:id', () => {
  it('deactivates a row', async () => {
    staff();
    adminStore.support_contact_roster.push({ id: '1', name: 'Asha', phone: '9000000001', is_active: true, assigned_count: 0 });
    const res = await request(buildApp()).patch('/api/admin/support-contacts/1').send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });
});

describe('DELETE /api/admin/support-contacts/:id', () => {
  it('removes a row with no assignments', async () => {
    staff();
    adminStore.support_contact_roster.push({ id: '1', name: 'Asha', phone: '9000000001', is_active: true, assigned_count: 0 });
    const res = await request(buildApp()).delete('/api/admin/support-contacts/1');
    expect(res.status).toBe(204);
    expect(adminStore.support_contact_roster).toHaveLength(0);
  });

  it('refuses to delete a row with assigned users (409), and leaves it in place', async () => {
    staff();
    adminStore.support_contact_roster.push({ id: '1', name: 'Asha', phone: '9000000001', is_active: true, assigned_count: 5 });
    const res = await request(buildApp()).delete('/api/admin/support-contacts/1');
    expect(res.status).toBe(409);
    expect(adminStore.support_contact_roster).toHaveLength(1);
  });

  it('404s for an unknown id', async () => {
    staff();
    const res = await request(buildApp()).delete('/api/admin/support-contacts/missing');
    expect(res.status).toBe(404);
  });
});
