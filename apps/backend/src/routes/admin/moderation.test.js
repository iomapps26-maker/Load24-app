import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], loads: [], trucks: [], user_profiles: [] };
}
let adminStore = createAdminStore();

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
    order: (field, { ascending = true } = {}) => {
      sort = { field, sign: ascending ? 1 : -1 };
      return builder;
    },
    range: (from, to) => {
      range = { from, to };
      return builder;
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

const { default: moderationRouter } = await import('./moderation.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/moderation', requireRole(STAFF_ROLES), moderationRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/moderation/loads', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/moderation/loads');
    expect(res.status).toBe(403);
  });

  it('lists every load regardless of owner or status, newest-first, with poster attached', async () => {
    staff();
    adminStore.loads.push(
      { id: 'l1', posted_by: 'a@x.com', status: 'active', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'l2', posted_by: 'b@x.com', status: 'flagged', created_at: '2026-02-01T00:00:00.000Z' }
    );
    adminStore.user_profiles.push({ user_email: 'b@x.com', full_name: 'Shipper B' });

    const res = await request(buildApp()).get('/api/admin/moderation/loads');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.loads[0].id).toBe('l2'); // newest first
    expect(res.body.loads[0].poster).toMatchObject({ full_name: 'Shipper B' });
    expect(res.body.loads[1].poster).toBeNull();
  });

  it('filters by status', async () => {
    staff();
    adminStore.loads.push(
      { id: 'l1', posted_by: 'a@x.com', status: 'active', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'l2', posted_by: 'b@x.com', status: 'flagged', created_at: '2026-02-01T00:00:00.000Z' }
    );

    const res = await request(buildApp()).get('/api/admin/moderation/loads').query({ status: 'flagged' });

    expect(res.status).toBe(200);
    expect(res.body.loads).toHaveLength(1);
    expect(res.body.loads[0].id).toBe('l2');
  });
});

describe('GET /api/admin/moderation/trucks', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/moderation/trucks');
    expect(res.status).toBe(403);
  });

  it('lists every truck regardless of owner or status, with owner attached', async () => {
    staff();
    adminStore.trucks.push(
      { id: 't1', owner_id: 'u1', status: 'active', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 't2', owner_id: 'u2', status: 'removed', created_at: '2026-02-01T00:00:00.000Z' }
    );
    adminStore.user_profiles.push({ user_id: 'u2', full_name: 'Owner Two' });

    const res = await request(buildApp()).get('/api/admin/moderation/trucks');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.trucks[0].id).toBe('t2'); // newest first
    expect(res.body.trucks[0].owner).toMatchObject({ full_name: 'Owner Two' });
  });
});

describe('PATCH /api/admin/moderation/loads/:id', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).patch('/api/admin/moderation/loads/l1').send({ status: 'flagged' });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid status', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/moderation/loads/l1').send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('flags a load', async () => {
    staff();
    adminStore.loads.push({ id: 'l1', status: 'active' });
    const res = await request(buildApp()).patch('/api/admin/moderation/loads/l1').send({ status: 'flagged' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');
  });

  it('restores a flagged load to whatever status the caller supplies', async () => {
    staff();
    adminStore.loads.push({ id: 'l1', status: 'flagged' });
    const res = await request(buildApp()).patch('/api/admin/moderation/loads/l1').send({ status: 'matched' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('matched');
  });

  it('404s for a load that does not exist', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/moderation/loads/does-not-exist').send({ status: 'removed' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/moderation/trucks/:id', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).patch('/api/admin/moderation/trucks/t1').send({ status: 'flagged' });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid status', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/moderation/trucks/t1').send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('removes a truck', async () => {
    staff();
    adminStore.trucks.push({ id: 't1', status: 'active' });
    const res = await request(buildApp()).patch('/api/admin/moderation/trucks/t1').send({ status: 'removed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('removed');
  });

  it('404s for a truck that does not exist', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/moderation/trucks/does-not-exist').send({ status: 'active' });
    expect(res.status).toBe(404);
  });
});
