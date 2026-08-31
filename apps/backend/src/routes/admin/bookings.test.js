import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// In-memory store behind the service-role client. The builder covers what
// routes/admin/bookings.js chains: select().order().(eq|in|gte|lte|or|limit)
// terminated by await, plus select().in() for the load / profile joins.
const store = { bookings: [], loads: [], user_profiles: [], user_roles: [] };

function makeBuilder(table) {
  const preds = [];
  let limit = Infinity;
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: (f, v) => (preds.push((r) => r[f] === v), builder),
    neq: (f, v) => (preds.push((r) => r[f] !== v), builder),
    in: (f, vals) => (preds.push((r) => vals.includes(r[f])), builder),
    gte: (f, v) => (preds.push((r) => r[f] >= v), builder),
    lte: (f, v) => (preds.push((r) => r[f] <= v), builder),
    or: (expr) => {
      // "poster_email.eq.a@b.com,accepter_email.eq.a@b.com" — split on the top
      // -level comma, then take column / op / (value = the rest, may hold dots)
      const clauses = expr.split(',').map((c) => {
        const d1 = c.indexOf('.');
        const d2 = c.indexOf('.', d1 + 1);
        const field = c.slice(0, d1);
        const value = c.slice(d2 + 1);
        return (r) => r[field] === value;
      });
      preds.push((r) => clauses.some((c) => c(r)));
      return builder;
    },
    limit: (n) => {
      limit = n;
      return builder;
    },
    then: (resolve) => {
      const rows = (store[table] || []).filter((r) => preds.every((p) => p(r))).slice(0, limit);
      resolve({ data: rows, error: null });
    }
  };
  return builder;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: { from: (table) => makeBuilder(table) }
}));

const { default: bookingsRouter } = await import('./bookings.js');
const { requireRole } = await import('../../middleware/requireRole.js');

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/admin/bookings', requireRole(['admin']), bookingsRouter);
  return app;
}

beforeEach(() => {
  store.bookings = [];
  store.loads = [];
  store.user_profiles = [];
  store.user_roles = [{ user_id: 'staff-1', role: 'admin' }];
});

function seedBooking(over = {}) {
  const b = {
    id: 'bk1',
    booking_ref: 'BK000001',
    load_id: 'l1',
    bid_id: 'b1',
    poster_email: 'shipper@x.com',
    accepter_email: 'trucker@x.com',
    amount: 5000,
    status: 'confirmed',
    confirmed_at: '2026-06-01T00:00:00.000Z',
    ...over
  };
  store.bookings.push(b);
  return b;
}

describe('GET /api/admin/bookings', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('nobody')).get('/api/admin/bookings');
    expect(res.status).toBe(403);
  });

  it('returns [] when there are no bookings', async () => {
    const res = await request(buildApp()).get('/api/admin/bookings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('joins each booking with its load and both party profiles', async () => {
    seedBooking();
    store.loads.push({ id: 'l1', load_id: 'LD000001', status: 'matched', material_type: 'Steel', loading_city: 'Pune', unloading_city: 'Delhi' });
    store.user_profiles.push(
      { user_email: 'shipper@x.com', full_name: 'Shipper One' },
      { user_email: 'trucker@x.com', full_name: 'Trucker One' }
    );

    const res = await request(buildApp()).get('/api/admin/bookings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      booking_ref: 'BK000001',
      load: { load_id: 'LD000001', material_type: 'Steel' },
      poster: { full_name: 'Shipper One' },
      accepter: { full_name: 'Trucker One' }
    });
  });

  it('filters by an exact status', async () => {
    seedBooking({ id: 'bk1', booking_ref: 'BK1', status: 'confirmed' });
    seedBooking({ id: 'bk2', booking_ref: 'BK2', status: 'completed' });

    const res = await request(buildApp()).get('/api/admin/bookings?status=completed');
    expect(res.status).toBe(200);
    expect(res.body.map((b) => b.booking_ref)).toEqual(['BK2']);
  });

  it('treats status=active as confirmed + in_transit', async () => {
    seedBooking({ id: 'bk1', booking_ref: 'BK1', status: 'confirmed' });
    seedBooking({ id: 'bk2', booking_ref: 'BK2', status: 'in_transit' });
    seedBooking({ id: 'bk3', booking_ref: 'BK3', status: 'cancelled' });

    const res = await request(buildApp()).get('/api/admin/bookings?status=active');
    expect(res.body.map((b) => b.booking_ref).sort()).toEqual(['BK1', 'BK2']);
  });

  it('400s an unknown status', async () => {
    const res = await request(buildApp()).get('/api/admin/bookings?status=weird');
    expect(res.status).toBe(400);
  });

  it('searches by exact booking_ref (case-insensitive)', async () => {
    seedBooking({ booking_ref: 'BK000042' });
    const res = await request(buildApp()).get('/api/admin/bookings?search=bk000042');
    expect(res.body).toHaveLength(1);
  });

  it('searches by a party email', async () => {
    seedBooking({ booking_ref: 'BK1', poster_email: 'a@x.com' });
    seedBooking({ booking_ref: 'BK2', accepter_email: 'find@x.com' });
    const res = await request(buildApp()).get('/api/admin/bookings?search=find@x.com');
    expect(res.body.map((b) => b.booking_ref)).toEqual(['BK2']);
  });

  it('400s a non-positive limit', async () => {
    const res = await request(buildApp()).get('/api/admin/bookings?limit=0');
    expect(res.status).toBe(400);
  });
});
