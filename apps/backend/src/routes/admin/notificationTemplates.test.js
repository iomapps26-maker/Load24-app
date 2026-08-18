import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], notification_templates: [] };
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
            const duplicate = (adminStore[table] || []).some((r) => r.channel === row.channel && r.event_key === row.event_key);
            if (duplicate) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
            const saved = {
              id: `tpl-${(adminStore[table] || []).length + 1}`,
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
            const nextChannel = patch.channel ?? match.channel;
            const nextEventKey = patch.event_key ?? match.event_key;
            const duplicate = (adminStore[table] || []).some(
              (r) => r !== match && r.channel === nextChannel && r.event_key === nextEventKey
            );
            if (duplicate) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
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

const { default: templatesRouter } = await import('./notificationTemplates.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/notification-templates', requireRole(STAFF_ROLES), templatesRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/notification-templates', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/notification-templates');
    expect(res.status).toBe(403);
  });

  it('lists templates, filterable by channel and event_key', async () => {
    staff();
    adminStore.notification_templates.push(
      { id: 't1', channel: 'push', event_key: 'kyc_verified', body: 'Your KYC is {{status}}' },
      { id: 't2', channel: 'email', event_key: 'kyc_verified', subject: 'KYC Update', body: 'Hi {{name}}, your KYC is {{status}}' }
    );

    const res = await request(buildApp()).get('/api/admin/notification-templates').query({ channel: 'push' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('t1');
  });
});

describe('GET /api/admin/notification-templates/:id', () => {
  it('404s for a template that does not exist', async () => {
    staff();
    const res = await request(buildApp()).get('/api/admin/notification-templates/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns a single template', async () => {
    staff();
    adminStore.notification_templates.push({ id: 't1', channel: 'push', event_key: 'kyc_verified', body: 'Hi' });
    const res = await request(buildApp()).get('/api/admin/notification-templates/t1');
    expect(res.status).toBe(200);
    expect(res.body.event_key).toBe('kyc_verified');
  });
});

describe('POST /api/admin/notification-templates', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1'))
      .post('/api/admin/notification-templates')
      .send({ channel: 'push', event_key: 'kyc_verified', body: 'Hi' });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid channel', async () => {
    staff();
    const res = await request(buildApp())
      .post('/api/admin/notification-templates')
      .send({ channel: 'sms', event_key: 'kyc_verified', body: 'Hi' });
    expect(res.status).toBe(400);
  });

  it('rejects unbalanced {{ }} placeholders', async () => {
    staff();
    const res = await request(buildApp())
      .post('/api/admin/notification-templates')
      .send({ channel: 'push', event_key: 'kyc_verified', body: 'Hi {{name}' });
    expect(res.status).toBe(400);
  });

  it('creates a template', async () => {
    staff();
    const res = await request(buildApp())
      .post('/api/admin/notification-templates')
      .send({ channel: 'whatsapp', event_key: 'trip_cancelled_by_staff', body: 'Trip {{load_id}} was cancelled' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ channel: 'whatsapp', event_key: 'trip_cancelled_by_staff' });
  });

  it('409s on a duplicate channel/event_key pair', async () => {
    staff();
    adminStore.notification_templates.push({ id: 't1', channel: 'push', event_key: 'kyc_verified', body: 'Hi' });
    const res = await request(buildApp())
      .post('/api/admin/notification-templates')
      .send({ channel: 'push', event_key: 'kyc_verified', body: 'Hi again' });
    expect(res.status).toBe(409);
  });
});

describe('PATCH /api/admin/notification-templates/:id', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).patch('/api/admin/notification-templates/t1').send({ body: 'New body' });
    expect(res.status).toBe(403);
  });

  it('rejects unbalanced {{ }} placeholders', async () => {
    staff();
    adminStore.notification_templates.push({ id: 't1', channel: 'push', event_key: 'kyc_verified', body: 'Hi' });
    const res = await request(buildApp()).patch('/api/admin/notification-templates/t1').send({ body: 'Hi {{name}}}' });
    expect(res.status).toBe(400);
  });

  it('updates the body', async () => {
    staff();
    adminStore.notification_templates.push({ id: 't1', channel: 'push', event_key: 'kyc_verified', body: 'Old body' });
    const res = await request(buildApp()).patch('/api/admin/notification-templates/t1').send({ body: 'New body {{name}}' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('New body {{name}}');
  });

  it('404s for a template that does not exist', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/notification-templates/does-not-exist').send({ body: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/notification-templates/:id', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).delete('/api/admin/notification-templates/t1');
    expect(res.status).toBe(403);
  });

  it('deletes a template', async () => {
    staff();
    adminStore.notification_templates.push({ id: 't1', channel: 'push', event_key: 'kyc_verified', body: 'Hi' });
    const res = await request(buildApp()).delete('/api/admin/notification-templates/t1');
    expect(res.status).toBe(204);
    expect(adminStore.notification_templates).toHaveLength(0);
  });

  it('404s for a template that does not exist', async () => {
    staff();
    const res = await request(buildApp()).delete('/api/admin/notification-templates/does-not-exist');
    expect(res.status).toBe(404);
  });
});
