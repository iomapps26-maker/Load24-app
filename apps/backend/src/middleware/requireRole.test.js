import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], audit_log: [] };
}
let adminStore = createAdminStore();
let forceRoleLookupError = false;

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
    insert(row) {
      (adminStore[table] || (adminStore[table] = [])).push(row);
      return Promise.resolve({ data: row, error: null });
    },
    then: (resolve) => {
      if (table === 'user_roles' && forceRoleLookupError) {
        return resolve({ data: null, error: { message: 'db down' } });
      }
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeAdminQueryBuilder(table) }
}));

const { requireRole } = await import('./requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

beforeEach(() => {
  adminStore = createAdminStore();
  forceRoleLookupError = false;
});

function staff(userId = 'staff-1') {
  adminStore.user_roles.push({ user_id: userId, role: 'admin' });
}

function buildApp({ mountStyle = 'router-level', userId = 'staff-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });

  if (mountStyle === 'router-level') {
    // Mirrors index.js's app.use('/api/admin/x', requireRole(...), router)
    // pattern — requireRole runs before any specific route inside the
    // sub-router matches, so req.route is unset at that point.
    const sub = express.Router();
    sub.get('/', (req, res) => res.json({ ok: true }));
    sub.post('/', (req, res) => res.status(201).json({ ok: true }));
    sub.patch('/:id', (req, res) => res.json({ ok: true, id: req.params.id }));
    app.use('/api/admin/widgets', requireRole(STAFF_ROLES), sub);
  } else {
    // Mirrors trucks.js's actual structure: requireRole(STAFF_ROLES) is
    // called per-route *inside* a router that itself is mounted at
    // '/api/trucks' — req.baseUrl is '/api/trucks' by the time requireRole
    // runs (unlike the router-level style above, req.route/req.params
    // *are* already set, since this router's own '/:id/verify' route has
    // already matched).
    const trucksRouter = express.Router();
    trucksRouter.post('/:id/verify', requireRole(STAFF_ROLES), (req, res) => res.json({ ok: true }));
    app.use('/api/trucks', trucksRouter);
  }

  return app;
}

describe('requireRole', () => {
  it('403s a caller with none of the required roles, and does not next()', async () => {
    const res = await request(buildApp()).get('/api/admin/widgets');
    expect(res.status).toBe(403);
    expect(adminStore.audit_log).toHaveLength(0);
  });

  it('400s when the role lookup itself errors', async () => {
    forceRoleLookupError = true;
    const res = await request(buildApp()).get('/api/admin/widgets');
    expect(res.status).toBe(400);
    expect(adminStore.audit_log).toHaveLength(0);
  });

  it('allows a staff caller through to next()', async () => {
    staff();
    const res = await request(buildApp()).get('/api/admin/widgets');
    expect(res.status).toBe(200);
  });

  it('does not log a GET request', async () => {
    staff();
    await request(buildApp()).get('/api/admin/widgets');
    expect(adminStore.audit_log).toHaveLength(0);
  });

  it('logs a POST mutation with actor, action, and body', async () => {
    staff();
    await request(buildApp()).post('/api/admin/widgets').send({ name: 'thing' });

    expect(adminStore.audit_log).toHaveLength(1);
    const row = adminStore.audit_log[0];
    expect(row.actor_user_id).toBe('staff-1');
    expect(row.action).toBe('POST /api/admin/widgets/');
    expect(row.target_table).toBe('widgets');
    expect(row.detail.body).toEqual({ name: 'thing' });
  });

  it('logs a PATCH mutation mounted router-level, with the id captured in the action string rather than target_id', async () => {
    staff();
    await request(buildApp()).patch('/api/admin/widgets/widget-1').send({ name: 'renamed' });

    expect(adminStore.audit_log).toHaveLength(1);
    const row = adminStore.audit_log[0];
    // req.params isn't populated yet at this mount style (the sub-router
    // hasn't matched '/:id' when requireRole runs) — see guessTargetId's
    // comment — but the raw path, id included, is still in the action.
    expect(row.target_id).toBeNull();
    expect(row.action).toBe('PATCH /api/admin/widgets/widget-1');
  });

  it('logs a per-route requireRole() mutation (trucks.js-style mount) too', async () => {
    staff();
    await request(buildApp({ mountStyle: 'per-route' })).post('/api/trucks/truck-1/verify');

    expect(adminStore.audit_log).toHaveLength(1);
    const row = adminStore.audit_log[0];
    expect(row.actor_user_id).toBe('staff-1');
    expect(row.target_id).toBe('truck-1');
    expect(row.target_table).toBe('trucks');
  });

  it('still completes the request (201s) even if the audit_log insert throws', async () => {
    staff();
    // Freezing the backing array makes insert()'s .push() throw
    // synchronously — logAction's try/catch (lib/auditLog.js) must absorb
    // that rather than letting it reject requireRole's await and stall the
    // request.
    Object.freeze(adminStore.audit_log);
    const res = await request(buildApp()).post('/api/admin/widgets').send({});
    expect(res.status).toBe(201);
  });
});
