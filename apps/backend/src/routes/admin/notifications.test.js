import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], notifications: [], user_profiles: [] };
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

const { default: adminNotificationsRouter } = await import('./notifications.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/notifications', requireRole(STAFF_ROLES), adminNotificationsRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/notifications', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/notifications');
    expect(res.status).toBe(403);
  });

  it('lists every notification across every user, newest-first, with recipient attached', async () => {
    staff();
    adminStore.notifications.push(
      { id: 'n1', user_id: 'u1', type: 'bid_placed', title: 'New bid', body: null, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'n2', user_id: 'u2', type: 'kyc_verified', title: 'KYC Verified', body: null, created_at: '2026-02-01T00:00:00.000Z' }
    );
    adminStore.user_profiles.push({ user_id: 'u2', full_name: 'Recipient Two' });

    const res = await request(buildApp()).get('/api/admin/notifications');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.notifications[0].id).toBe('n2'); // newest first
    expect(res.body.notifications[0].recipient).toMatchObject({ full_name: 'Recipient Two' });
    expect(res.body.notifications[1].recipient).toBeNull();
  });

  it('filters by type', async () => {
    staff();
    adminStore.notifications.push(
      { id: 'n1', user_id: 'u1', type: 'bid_placed', title: 'New bid', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'n2', user_id: 'u2', type: 'kyc_verified', title: 'KYC Verified', created_at: '2026-02-01T00:00:00.000Z' }
    );

    const res = await request(buildApp()).get('/api/admin/notifications').query({ type: 'kyc_verified' });

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].id).toBe('n2');
  });
});
