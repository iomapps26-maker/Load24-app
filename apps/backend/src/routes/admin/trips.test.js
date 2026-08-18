import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function createAdminStore() {
  return { user_roles: [], loads: [], load_bids: [], user_profiles: [], trip_location_pings: [], notifications: [] };
}
let adminStore = createAdminStore();

// Thenable at every step (kyc.test.js/trucks.test.js's approach), plus
// .maybeSingle()/.single() terminals and a multi-filter .update() — trips.js
// chains .update().eq().in().select().single(), and notifyEmail (called via
// trips.js's cancel route) round-trips through user_profiles + notifications
// on this same mocked supabaseAdmin.
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
    single: () => {
      const rows = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'no rows' } });
    },
    insert(row) {
      const saved = { id: `${table}-${(adminStore[table] || []).length + 1}`, created_at: new Date().toISOString(), ...row };
      (adminStore[table] || (adminStore[table] = [])).push(saved);
      return { select: () => ({ single: () => Promise.resolve({ data: saved, error: null }) }) };
    },
    update(patch) {
      const updateFilters = [];
      const updateBuilder = {
        eq: (field, value) => {
          updateFilters.push((r) => r[field] === value);
          return updateBuilder;
        },
        in: (field, values) => {
          updateFilters.push((r) => values.includes(r[field]));
          return updateBuilder;
        },
        select: () => ({
          single: () => {
            const match = (adminStore[table] || []).find((r) => updateFilters.every((f) => f(r)));
            if (!match) return Promise.resolve({ data: null, error: { message: 'no rows updated' } });
            Object.assign(match, patch);
            return Promise.resolve({ data: match, error: null });
          },
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

const { default: tripsRouter } = await import('./trips.js');
const { requireRole } = await import('../../middleware/requireRole.js');

const STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/trips', requireRole(STAFF_ROLES), tripsRouter);
  return app;
}

beforeEach(() => {
  adminStore = createAdminStore();
});

function staff() {
  adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
}

describe('GET /api/admin/trips', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/trips');
    expect(res.status).toBe(403);
  });

  it('lists matched/in_transit loads with bid and profile info, excluding other statuses', async () => {
    staff();
    adminStore.loads.push(
      { id: 'l1', posted_by: 'shipper@x.com', status: 'matched', material_type: 'Steel', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'l2', posted_by: 'shipper2@x.com', status: 'in_transit', material_type: 'Cement', created_at: '2026-02-01T00:00:00.000Z' },
      { id: 'l3', posted_by: 'shipper3@x.com', status: 'active', material_type: 'Sand', created_at: '2026-03-01T00:00:00.000Z' }
    );
    adminStore.load_bids.push(
      { id: 'b1', load_id: 'l1', status: 'approved', bid_by_email: 'trucker@x.com', amount: 5000 },
      { id: 'b2', load_id: 'l2', status: 'pending', bid_by_email: 'trucker2@x.com', amount: 6000 }
    );
    adminStore.user_profiles.push(
      { user_id: 'u1', user_email: 'shipper@x.com', full_name: 'Shipper One' },
      { user_id: 'u2', user_email: 'trucker@x.com', full_name: 'Trucker One' }
    );

    const res = await request(buildApp()).get('/api/admin/trips');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2); // l3 excluded — status 'active'
    const trip1 = res.body.find((t) => t.load.id === 'l1');
    expect(trip1.bid).toMatchObject({ id: 'b1', amount: 5000 });
    expect(trip1.poster).toMatchObject({ full_name: 'Shipper One' });
    expect(trip1.accepter).toMatchObject({ full_name: 'Trucker One' });
    const trip2 = res.body.find((t) => t.load.id === 'l2');
    expect(trip2.bid).toBeNull(); // b2 is 'pending', not 'approved'
    expect(trip2.accepter).toBeNull();
  });
});

describe('POST /api/admin/trips/:loadId/cancel', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/admin/trips/l1/cancel');
    expect(res.status).toBe(403);
  });

  it('404s for a load that does not exist', async () => {
    staff();
    const res = await request(buildApp()).post('/api/admin/trips/does-not-exist/cancel');
    expect(res.status).toBe(404);
  });

  it('409s when the load is not matched/in_transit', async () => {
    staff();
    adminStore.loads.push({ id: 'l1', posted_by: 'shipper@x.com', status: 'active', material_type: 'Steel' });
    const res = await request(buildApp()).post('/api/admin/trips/l1/cancel');
    expect(res.status).toBe(409);
  });

  it('cancels the trip and notifies both parties', async () => {
    staff();
    adminStore.loads.push({ id: 'l1', posted_by: 'shipper@x.com', status: 'matched', material_type: 'Steel' });
    adminStore.load_bids.push({ id: 'b1', load_id: 'l1', status: 'approved', bid_by_email: 'trucker@x.com', amount: 5000 });

    const res = await request(buildApp()).post('/api/admin/trips/l1/cancel').send({ reason: 'Fraud reported' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(adminStore.notifications).toHaveLength(0); // no user_id resolvable (no user_profiles seeded) — notifyEmail no-ops silently, as designed
  });

  it('notifies resolvable parties when their profiles exist', async () => {
    staff();
    adminStore.loads.push({ id: 'l1', posted_by: 'shipper@x.com', status: 'matched', material_type: 'Steel' });
    adminStore.load_bids.push({ id: 'b1', load_id: 'l1', status: 'approved', bid_by_email: 'trucker@x.com', amount: 5000 });
    adminStore.user_profiles.push(
      { user_id: 'u1', user_email: 'shipper@x.com' },
      { user_id: 'u2', user_email: 'trucker@x.com' }
    );

    const res = await request(buildApp()).post('/api/admin/trips/l1/cancel').send({ reason: 'Fraud reported' });

    expect(res.status).toBe(200);
    expect(adminStore.notifications).toHaveLength(2);
    expect(adminStore.notifications.map((n) => n.user_id).sort()).toEqual(['u1', 'u2']);
    expect(adminStore.notifications[0].body).toBe('Fraud reported');
  });
});

describe('GET /api/admin/trips/:loadId/pings', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/admin/trips/l1/pings');
    expect(res.status).toBe(403);
  });

  it('returns pings oldest first', async () => {
    staff();
    adminStore.trip_location_pings.push(
      { id: 'p1', load_id: 'l1', lat: 19.1, lng: 72.9, recorded_at: '2026-01-01T10:00:00.000Z' },
      { id: 'p2', load_id: 'l1', lat: 19.2, lng: 73.0, recorded_at: '2026-01-01T09:00:00.000Z' },
      { id: 'p3', load_id: 'l2', lat: 20.0, lng: 74.0, recorded_at: '2026-01-01T09:30:00.000Z' }
    );

    const res = await request(buildApp()).get('/api/admin/trips/l1/pings');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('p2'); // oldest first
    expect(res.body[1].id).toBe('p1');
  });
});
