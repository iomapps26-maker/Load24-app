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

// Matches SECURITY_DEPOSIT_DEFAULT in lib/platformSettings.js.
const DEFAULT_DEPOSIT = {
  slabs: [
    { up_to: 10000, amount: 750 },
    { up_to: 20000, amount: 1000 },
    { up_to: 30000, amount: 1100 }
  ],
  above_slab_percent: 1
};

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
    expect(res.body).toEqual({ load24_charge_percent: 4.0, security_deposit: DEFAULT_DEPOSIT });
  });

  it('returns the saved value merged over the defaults', async () => {
    staff();
    store.platform_settings.push({ key: 'bidding', value: { load24_charge_percent: 6 } });
    const res = await request(buildApp()).get('/api/admin/platform-settings/bidding');
    expect(res.body).toEqual({ load24_charge_percent: 6, security_deposit: DEFAULT_DEPOSIT });
  });

  it('falls back to the default slab table for a row saved before the slab table (legacy security_deposit_amount)', async () => {
    staff();
    store.platform_settings.push({ key: 'bidding', value: { load24_charge_percent: 5, security_deposit_amount: 2000 } });
    const res = await request(buildApp()).get('/api/admin/platform-settings/bidding');
    expect(res.body).toEqual({ load24_charge_percent: 5, security_deposit: DEFAULT_DEPOSIT });
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

  it('rejects a security_deposit slab with a negative amount', async () => {
    staff();
    const res = await request(buildApp())
      .patch('/api/admin/platform-settings/bidding')
      .send({ security_deposit: { slabs: [{ up_to: 10000, amount: -100 }], above_slab_percent: 1 } });
    expect(res.status).toBe(400);
  });

  it('rejects a security_deposit slab with a non-positive up_to', async () => {
    staff();
    const res = await request(buildApp())
      .patch('/api/admin/platform-settings/bidding')
      .send({ security_deposit: { slabs: [{ up_to: 0, amount: 750 }], above_slab_percent: 1 } });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range above_slab_percent', async () => {
    staff();
    const res = await request(buildApp())
      .patch('/api/admin/platform-settings/bidding')
      .send({ security_deposit: { slabs: [{ up_to: 10000, amount: 750 }], above_slab_percent: 150 } });
    expect(res.status).toBe(400);
  });

  it('rejects a security_deposit with duplicate up_to values', async () => {
    staff();
    const res = await request(buildApp())
      .patch('/api/admin/platform-settings/bidding')
      .send({
        security_deposit: {
          slabs: [
            { up_to: 10000, amount: 750 },
            { up_to: 10000, amount: 900 }
          ],
          above_slab_percent: 1
        }
      });
    expect(res.status).toBe(400);
  });

  it('rejects an empty patch', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({});
    expect(res.status).toBe(400);
  });

  it('raises the Load24 charge, leaving the deposit table untouched', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({ load24_charge_percent: 4.5 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ load24_charge_percent: 4.5, security_deposit: DEFAULT_DEPOSIT });
    expect(store.platform_settings[0]).toMatchObject({ key: 'bidding', updated_by: 'staff-1' });
  });

  it('lowers the Load24 charge to zero', async () => {
    staff();
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({ load24_charge_percent: 0 });
    expect(res.status).toBe(200);
    expect(res.body.load24_charge_percent).toBe(0);
  });

  it('saves a new slab table, sorting the slabs by up_to', async () => {
    staff();
    const res = await request(buildApp())
      .patch('/api/admin/platform-settings/bidding')
      .send({
        load24_charge_percent: 3,
        security_deposit: {
          slabs: [
            { up_to: 20000, amount: 1000 },
            { up_to: 10000, amount: 500 }
          ],
          above_slab_percent: 2
        }
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      load24_charge_percent: 3,
      security_deposit: {
        slabs: [
          { up_to: 10000, amount: 500 },
          { up_to: 20000, amount: 1000 }
        ],
        above_slab_percent: 2
      }
    });
  });

  it('accepts an empty slab table (deposit disabled)', async () => {
    staff();
    const res = await request(buildApp())
      .patch('/api/admin/platform-settings/bidding')
      .send({ security_deposit: { slabs: [], above_slab_percent: 0 } });
    expect(res.status).toBe(200);
    expect(res.body.security_deposit).toEqual({ slabs: [], above_slab_percent: 0 });
  });

  it('drops the legacy security_deposit_amount key when staff touch the settings', async () => {
    staff();
    store.platform_settings.push({ key: 'bidding', value: { load24_charge_percent: 4, security_deposit_amount: 2000 } });
    const res = await request(buildApp()).patch('/api/admin/platform-settings/bidding').send({ load24_charge_percent: 5 });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('security_deposit_amount');
    expect(store.platform_settings[0].value).not.toHaveProperty('security_deposit_amount');
  });
});
