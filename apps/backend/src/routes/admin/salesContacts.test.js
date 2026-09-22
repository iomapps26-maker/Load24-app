import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { sales_contact_roster: [], user_roles: [] };
}
let adminStore = createAdminStore();

// Same shape as admin/masterData.test.js's mock query builder.
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
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: data[0] ?? null, error: null });
    },
    insert(row) {
      const withDefaults = { id: `id-${(adminStore[table] || []).length + 1}`, assigned_count: 0, ...row };
      (adminStore[table] || (adminStore[table] = [])).push(withDefaults);
      return { select: () => ({ single: () => Promise.resolve({ data: withDefaults, error: null }) }) };
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

// lib/referrals.js is exercised on its own in lib/referrals.test.js — mocked
// here so the route's stats-attaching/delete-guard logic is testable
// without needing referral_codes/referrals in the adminStore mock above,
// same reasoning as routes/profile.test.js's mock of the same module.
const getOrCreateSalesContactReferralCodeMock = vi.fn();
const getSalesContactReferralStatsMock = vi.fn();
vi.mock('../../lib/referrals.js', () => ({
  getOrCreateSalesContactReferralCode: (...args) => getOrCreateSalesContactReferralCodeMock(...args),
  getSalesContactReferralStats: (...args) => getSalesContactReferralStatsMock(...args)
}));

const { default: salesContactsRouter } = await import('./salesContacts.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/sales-contacts', requireRole(STAFF_ROLES), salesContactsRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
  getOrCreateSalesContactReferralCodeMock.mockReset().mockResolvedValue('CODE0001');
  getSalesContactReferralStatsMock.mockReset().mockResolvedValue({ code: 'CODE0001', total_referred: 0, verified_count: 0 });
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('POST /api/admin/sales-contacts', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/sales-contacts').send({ name: 'Vivek', phone: '9000000003' });
    expect(res.status).toBe(403);
  });

  it('requires name and phone', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/sales-contacts').send({ name: 'Vivek' });
    expect(res.status).toBe(400);
  });

  it('creates a row, defaulting is_active to true and assigned_count to 0', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/sales-contacts').send({ name: 'Vivek', phone: '9000000003' });
    expect(res.status).toBe(201);
    expect(res.body.is_active).toBe(true);
    expect(res.body.assigned_count).toBe(0);
  });

  it('generates a permanent referral code for the new contact', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/sales-contacts').send({ name: 'Vivek', phone: '9000000003' });
    expect(res.status).toBe(201);
    expect(res.body.referral_code).toBe('CODE0001');
    expect(res.body.total_referred).toBe(0);
    expect(res.body.verified_referred).toBe(0);
    expect(getOrCreateSalesContactReferralCodeMock).toHaveBeenCalledWith(res.body.id);
  });

  it('still creates the contact even if referral code generation fails', async () => {
    staff();
    getOrCreateSalesContactReferralCodeMock.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post('/api/admin/sales-contacts').send({ name: 'Vivek', phone: '9000000003' });
    expect(res.status).toBe(201);
    expect(res.body.referral_code).toBeNull();
  });
});

describe('GET /api/admin/sales-contacts', () => {
  it('filters by is_active', async () => {
    staff();
    adminStore.sales_contact_roster.push(
      { id: '1', name: 'Vivek', phone: '9000000003', is_active: true, assigned_count: 3 },
      { id: '2', name: 'Meera', phone: '9000000004', is_active: false, assigned_count: 0 }
    );
    const res = await request(buildApp()).get('/api/admin/sales-contacts?is_active=true');
    expect(res.status).toBe(200);
    expect(res.body.map((r) => r.id)).toEqual(['1']);
  });

  it('attaches referral stats to each row', async () => {
    staff();
    adminStore.sales_contact_roster.push({ id: '1', name: 'Vivek', phone: '9000000003', is_active: true, assigned_count: 0 });
    getSalesContactReferralStatsMock.mockResolvedValue({ code: 'CODE0001', total_referred: 4, verified_count: 2 });
    const res = await request(buildApp()).get('/api/admin/sales-contacts');
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ referral_code: 'CODE0001', total_referred: 4, verified_referred: 2 });
    expect(getSalesContactReferralStatsMock).toHaveBeenCalledWith('1');
  });
});

describe('PATCH /api/admin/sales-contacts/:id', () => {
  it('deactivates a row', async () => {
    staff();
    adminStore.sales_contact_roster.push({ id: '1', name: 'Vivek', phone: '9000000003', is_active: true, assigned_count: 0 });
    const res = await request(buildApp()).patch('/api/admin/sales-contacts/1').send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);
  });
});

describe('DELETE /api/admin/sales-contacts/:id', () => {
  it('removes a row with no assignments', async () => {
    staff();
    adminStore.sales_contact_roster.push({ id: '1', name: 'Vivek', phone: '9000000003', is_active: true, assigned_count: 0 });
    const res = await request(buildApp()).delete('/api/admin/sales-contacts/1');
    expect(res.status).toBe(204);
    expect(adminStore.sales_contact_roster).toHaveLength(0);
  });

  it('refuses to delete a row with assigned users (409), and leaves it in place', async () => {
    staff();
    adminStore.sales_contact_roster.push({ id: '1', name: 'Vivek', phone: '9000000003', is_active: true, assigned_count: 5 });
    const res = await request(buildApp()).delete('/api/admin/sales-contacts/1');
    expect(res.status).toBe(409);
    expect(adminStore.sales_contact_roster).toHaveLength(1);
  });

  it('refuses to delete a row with referrals attributed to it (409), and leaves it in place', async () => {
    staff();
    adminStore.sales_contact_roster.push({ id: '1', name: 'Vivek', phone: '9000000003', is_active: true, assigned_count: 0 });
    getSalesContactReferralStatsMock.mockResolvedValue({ code: 'CODE0001', total_referred: 3, verified_count: 1 });
    const res = await request(buildApp()).delete('/api/admin/sales-contacts/1');
    expect(res.status).toBe(409);
    expect(adminStore.sales_contact_roster).toHaveLength(1);
  });

  it('404s for an unknown id', async () => {
    staff();
    const res = await request(buildApp()).delete('/api/admin/sales-contacts/missing');
    expect(res.status).toBe(404);
  });
});
