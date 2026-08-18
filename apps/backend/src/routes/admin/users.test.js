import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_profiles: [], user_roles: [] };
}
let adminStore = createAdminStore();

// Thenable at every step (same approach as kyc.test.js/trucks.test.js),
// plus count-mode select, .or() substring search, .range() pagination, and
// insert/delete for the role-grant/revoke routes.
function makeAdminQueryBuilder(table) {
  const filters = [];
  let sort = null;
  let range = null;
  let countMode = false;

  const builder = {
    select: (columns, opts) => {
      if (opts && opts.count) countMode = true;
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
    // Minimal stand-in for PostgREST's `.or('a.ilike.%x%,b.ilike.%x%')` —
    // parses "field.ilike.%needle%" clauses and OR-matches them.
    or: (expr) => {
      const clauses = expr.split(',').map((clause) => {
        const [field, , pattern] = clause.split('.');
        const needle = pattern.replace(/%/g, '').toLowerCase();
        return (r) => String(r[field] || '').toLowerCase().includes(needle);
      });
      filters.push((r) => clauses.some((c) => c(r)));
      return builder;
    },
    order: (field, { ascending = true } = {}) => {
      sort = { field, sign: ascending ? 1 : -1 };
      return builder;
    },
    range: (from, to) => {
      range = { from, to };
      return builder;
    },
    insert(row) {
      return {
        select: () => ({
          single: () => {
            const duplicate = (adminStore[table] || []).some((r) => r.user_id === row.user_id && r.role === row.role);
            if (duplicate) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
            // user_profiles standing in for "does this user_id exist at all"
            // (the real FK is to auth.users, which isn't modeled here).
            const userExists = adminStore.user_profiles.some((p) => p.user_id === row.user_id);
            if (table === 'user_roles' && !userExists) {
              return Promise.resolve({ data: null, error: { code: '23503', message: 'foreign key violation' } });
            }
            const saved = { id: `role-${(adminStore[table] || []).length + 1}`, created_at: new Date().toISOString(), ...row };
            (adminStore[table] || (adminStore[table] = [])).push(saved);
            return Promise.resolve({ data: saved, error: null });
          }
        })
      };
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
            const rows = adminStore[table] || [];
            const idx = rows.findIndex((r) => deleteFilters.every((f) => f(r)));
            if (idx === -1) return Promise.resolve({ data: null, error: null });
            const [removed] = rows.splice(idx, 1);
            return Promise.resolve({ data: removed, error: null });
          }
        })
      };
      return deleteBuilder;
    },
    then: (resolve) => {
      let data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      const count = data.length;
      if (sort) {
        const { field, sign } = sort;
        data = [...data].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
      }
      if (range) data = data.slice(range.from, range.to + 1);
      resolve({ data, error: null, count: countMode ? count : null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { default: usersRouter } = await import('./users.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/users', requireRole(STAFF_ROLES), usersRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/users', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('lists users newest-first with roles attached', async () => {
    staff();
    adminStore.user_profiles.push(
      { user_id: 'user-1', full_name: 'Ravi Kumar', mobile: '+919000000001', city: 'Pune', created_at: '2026-01-01T00:00:00.000Z' },
      { user_id: 'user-2', full_name: 'Asha Devi', mobile: '+919000000002', city: 'Nashik', created_at: '2026-02-01T00:00:00.000Z' }
    );
    adminStore.user_roles.push({ user_id: 'user-2', role: 'support_executive' });

    const res = await request(buildApp()).get('/api/admin/users');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.users[0].user_id).toBe('user-2'); // newest first
    expect(res.body.users[0].roles).toEqual(['support_executive']);
    expect(res.body.users[1].roles).toEqual([]);
  });

  it('filters by the q search param across name/mobile/email', async () => {
    staff();
    adminStore.user_profiles.push(
      { user_id: 'user-1', full_name: 'Ravi Kumar', mobile: '+919000000001', user_email: 'ravi@x.com', created_at: '2026-01-01T00:00:00.000Z' },
      { user_id: 'user-2', full_name: 'Asha Devi', mobile: '+919000000002', user_email: 'asha@x.com', created_at: '2026-02-01T00:00:00.000Z' }
    );

    const res = await request(buildApp()).get('/api/admin/users').query({ q: 'asha' });

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.users[0].full_name).toBe('Asha Devi');
  });
});

describe('POST /api/admin/users/:userId/roles', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/users/user-2/roles').send({ role: 'support_executive' });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid role', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/users/user-2/roles').send({ role: 'not_a_real_role' });
    expect(res.status).toBe(400);
  });

  it('grants a role, recording granted_by', async () => {
    staff();
    adminStore.user_profiles.push({ user_id: 'user-2', full_name: 'Asha Devi' });

    const res = await request(buildApp()).post('/api/admin/users/user-2/roles').send({ role: 'support_executive' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ user_id: 'user-2', role: 'support_executive', granted_by: 'staff-1' });
  });

  it('409s when the user already has that role', async () => {
    staff();
    adminStore.user_profiles.push({ user_id: 'user-2', full_name: 'Asha Devi' });
    adminStore.user_roles.push({ user_id: 'user-2', role: 'support_executive' });

    const res = await request(buildApp()).post('/api/admin/users/user-2/roles').send({ role: 'support_executive' });
    expect(res.status).toBe(409);
  });

  it('404s for a user that does not exist', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/users/does-not-exist/roles').send({ role: 'support_executive' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/users/:userId/roles/:role', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).delete('/api/admin/users/user-2/roles/support_executive');
    expect(res.status).toBe(403);
  });

  it('revokes a role', async () => {
    staff();
    adminStore.user_roles.push({ user_id: 'user-2', role: 'support_executive' });

    const res = await request(buildApp()).delete('/api/admin/users/user-2/roles/support_executive');

    expect(res.status).toBe(204);
    expect(adminStore.user_roles.some((r) => r.user_id === 'user-2' && r.role === 'support_executive')).toBe(false);
  });

  it('404s when the user does not have that role', async () => {
    staff();
    const res = await request(buildApp()).delete('/api/admin/users/user-2/roles/support_executive');
    expect(res.status).toBe(404);
  });
});
