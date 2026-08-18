import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { audit_log: [], user_roles: [] };
}
let adminStore = createAdminStore();

// Thenable at every step (order() and limit() included) so it resolves
// correctly regardless of the chain order the route actually calls — same
// approach as commissionRules.test.js's/risk.test.js's builders.
function makeAdminQueryBuilder(table) {
  const filters = [];
  let sort = null;
  let cap = null;
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
    gte: (field, value) => {
      filters.push((r) => r[field] >= value);
      return builder;
    },
    lte: (field, value) => {
      filters.push((r) => r[field] <= value);
      return builder;
    },
    order: (field, { ascending = true } = {}) => {
      sort = { field, sign: ascending ? 1 : -1 };
      return builder;
    },
    limit: (n) => {
      cap = n;
      return builder;
    },
    then: (resolve) => {
      let data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      if (sort) {
        const { field, sign } = sort;
        data = [...data].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
      }
      if (cap !== null) data = data.slice(0, cap);
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { default: auditLogRouter } = await import('./auditLog.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/audit-log', requireRole(STAFF_ROLES), auditLogRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

function row(overrides) {
  return {
    id: `row-${Math.random()}`,
    actor_user_id: 'staff-1',
    action: 'PATCH /api/admin/commission-rules/rule-1',
    target_table: 'commission_rules',
    target_id: 'rule-1',
    detail: {},
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('GET /api/admin/audit-log', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/audit-log');
    expect(res.status).toBe(403);
  });

  it('lists rows newest first', async () => {
    staff();
    adminStore.audit_log.push(
      row({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
      row({ id: 'b', created_at: '2026-02-01T00:00:00.000Z' })
    );
    const res = await request(buildApp()).get('/api/admin/audit-log');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('filters by actor_user_id', async () => {
    staff();
    adminStore.audit_log.push(row({ id: 'a', actor_user_id: 'staff-1' }), row({ id: 'b', actor_user_id: 'staff-2' }));
    const res = await request(buildApp()).get('/api/admin/audit-log?actor_user_id=staff-2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('b');
  });

  it('filters by action', async () => {
    staff();
    adminStore.audit_log.push(row({ id: 'a', action: 'POST /api/admin/content-blocks/' }), row({ id: 'b', action: 'DELETE /api/admin/content-blocks/x' }));
    const res = await request(buildApp()).get('/api/admin/audit-log?action=' + encodeURIComponent('POST /api/admin/content-blocks/'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('a');
  });

  it('filters by a from/to date range', async () => {
    staff();
    adminStore.audit_log.push(
      row({ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }),
      row({ id: 'b', created_at: '2026-02-15T00:00:00.000Z' }),
      row({ id: 'c', created_at: '2026-03-01T00:00:00.000Z' })
    );
    const res = await request(buildApp()).get('/api/admin/audit-log?from=2026-02-01T00:00:00.000Z&to=2026-02-28T00:00:00.000Z');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual(['b']);
  });

  it('rejects a non-numeric limit', async () => {
    staff();
    const res = await request(buildApp()).get('/api/admin/audit-log?limit=abc');
    expect(res.status).toBe(400);
  });

  it('caps limit at the maximum regardless of what was requested', async () => {
    staff();
    for (let i = 0; i < 5; i++) adminStore.audit_log.push(row({ id: `r${i}` }));
    const res = await request(buildApp()).get('/api/admin/audit-log?limit=2');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});
