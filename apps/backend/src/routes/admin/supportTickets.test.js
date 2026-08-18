import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], support_tickets: [], user_profiles: [] };
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
    update(patch) {
      const updateFilters = [];
      const updateBuilder = {
        eq: (field, value) => {
          updateFilters.push((r) => r[field] === value);
          return updateBuilder;
        },
        select: () => ({
          maybeSingle: () => {
            // assigned_to references auth.users — user_profiles stands in
            // for "does this user_id exist" the same way users.test.js does.
            if ('assigned_to' in patch && patch.assigned_to !== null) {
              const exists = adminStore.user_profiles.some((p) => p.user_id === patch.assigned_to);
              if (!exists) return Promise.resolve({ data: null, error: { code: '23503', message: 'foreign key violation' } });
            }
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

const { default: supportTicketsRouter } = await import('./supportTickets.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/support-tickets', requireRole(STAFF_ROLES), supportTicketsRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/support-tickets', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/support-tickets');
    expect(res.status).toBe(403);
  });

  it('lists every ticket newest-first with the submitter profile attached', async () => {
    staff();
    adminStore.support_tickets.push(
      { id: 't1', user_id: 'user-1', subject: 'Cannot post load', status: 'open', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 't2', user_id: 'user-2', subject: 'Wallet not crediting', status: 'resolved', created_at: '2026-02-01T00:00:00.000Z' }
    );
    adminStore.user_profiles.push({ user_id: 'user-1', full_name: 'Ravi Kumar', mobile: '+919000000001' });

    const res = await request(buildApp()).get('/api/admin/support-tickets');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('t2'); // newest first
    expect(res.body[0].profile).toBeNull(); // no profile seeded for user-2
    expect(res.body[1].profile).toMatchObject({ full_name: 'Ravi Kumar' });
  });

  it('filters by status', async () => {
    staff();
    adminStore.support_tickets.push(
      { id: 't1', user_id: 'user-1', subject: 'A', status: 'open', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 't2', user_id: 'user-2', subject: 'B', status: 'resolved', created_at: '2026-02-01T00:00:00.000Z' }
    );

    const res = await request(buildApp()).get('/api/admin/support-tickets').query({ status: 'resolved' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('t2');
  });

  it('rejects an invalid status filter', async () => {
    staff();
    const res = await request(buildApp()).get('/api/admin/support-tickets').query({ status: 'not_a_status' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/admin/support-tickets/:id', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).patch('/api/admin/support-tickets/t1').send({ status: 'resolved' });
    expect(res.status).toBe(403);
  });

  it('requires at least one of status/assigned_to', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/support-tickets/t1').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an invalid status', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/support-tickets/t1').send({ status: 'not_a_status' });
    expect(res.status).toBe(400);
  });

  it('updates status and assigns a staff member', async () => {
    staff();
    adminStore.support_tickets.push({ id: 't1', user_id: 'user-1', subject: 'A', status: 'open', created_at: '2026-01-01T00:00:00.000Z' });
    adminStore.user_profiles.push({ user_id: 'staff-1', full_name: 'Support Staff' });

    const res = await request(buildApp()).patch('/api/admin/support-tickets/t1').send({ status: 'in_progress', assigned_to: 'staff-1' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
    expect(res.body.assigned_to).toBe('staff-1');
  });

  it('404s for a ticket that does not exist', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/support-tickets/does-not-exist').send({ status: 'closed' });
    expect(res.status).toBe(404);
  });
});
