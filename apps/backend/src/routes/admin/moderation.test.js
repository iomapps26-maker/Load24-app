import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], loads: [], trucks: [] };
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
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data, error: null });
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
