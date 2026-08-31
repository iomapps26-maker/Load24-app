import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

function createStore() {
  return { user_roles: [], platform_settings: [] };
}
let store = createStore();

function makeBuilder(table) {
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
    maybeSingle: () => {
      const rows = (store[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows[0] || null, error: null });
    },
    // requireRole's audit-log write (lib/auditLog.js) lands here on every
    // staff mutation — accept and drop it so it doesn't error into stderr.
    insert: () => Promise.resolve({ data: null, error: null }),
    upsert(row) {
      return {
        select: () => ({
          single: () => {
            const rows = store[table] || (store[table] = []);
            const idx = rows.findIndex((r) => r.key === row.key);
            if (idx === -1) rows.push(row);
            else rows[idx] = { ...rows[idx], ...row };
            return Promise.resolve({ data: rows.find((r) => r.key === row.key), error: null });
          }
        })
      };
    },
    then: (resolve) => resolve({ data: (store[table] || []).filter((r) => filters.every((f) => f(r))), error: null })
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeBuilder(table) }
}));

const { default: platformSettingsRouter } = await import('./platformSettings.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/platform-settings', requireRole(STAFF_ROLES), platformSettingsRouter);
  return app;
}

function staff() {
  store.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

beforeEach(() => {
  store = createStore();
});

describe('GET /api/admin/platform-settings/bidding', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/platform-settings/bidding');
    expect(res.status).toBe(403);
  });

  it('returns the seeded defaults when nothing has been saved yet', async () => {
    staff();
    const res = await request(buildApp()).get('/api/admin/platform-settings/bidding');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ load24_charge_percent: 4.0, security_deposit_amount: 1000 });
  });

  it('returns the saved value merged over the defaults', async () => {
    staff();
    store.platform_settings.push({ key: 'bidding', value: { load24_charge_percent: 6 } });
    const res = await request(buildApp()).get('/api/admin/platform-settings/bidding');
    expect(res.body).toEqual({ load24_charge_percent: 6, security_deposit_amount: 1000 });
  });
});

describe('PATCH /api/admin/platform-settings/bidding', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).patch('/api/admin/platform-settings/bidding').send({ load24_charge_percent: 5 });
    expect(res.status).toBe(403);
  });

  it('rejects an out-of-range charge percentage', async () => {
    staff();
    for (const bad of [-1, 101, 'abc']) {
      const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({ load24_charge_percent: bad });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a negative security deposit', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({ security_deposit_amount: -100 });
    expect(res.status).toBe(400);
  });

  it('rejects an empty patch', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({});
    expect(res.status).toBe(400);
  });

  it('raises the Load24 charge, leaving the deposit untouched', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({ load24_charge_percent: 4.5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ load24_charge_percent: 4.5, security_deposit_amount: 1000 });
    expect(store.platform_settings[0]).toMatchObject({ key: 'bidding', updated_by: 'staff-1' });
  });

  it('lowers the Load24 charge to zero', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({ load24_charge_percent: 0 });
    expect(res.status).toBe(200);
    expect(res.body.load24_charge_percent).toBe(0);
  });

  it('updates both values at once', async () => {
    staff();
    const res = await request(buildApp())
      .patch('/api/admin/platform-settings/bidding')
      .send({ load24_charge_percent: 3, security_deposit_amount: 2000 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ load24_charge_percent: 3, security_deposit_amount: 2000 });
  });
});
