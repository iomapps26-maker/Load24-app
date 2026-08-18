import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const insertedPings = [];

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from(table) {
      if (table !== 'trip_location_pings') throw new Error(`unexpected table ${table}`);
      return {
        insert(row) {
          const saved = { id: `ping-${insertedPings.length + 1}`, created_at: new Date().toISOString(), ...row };
          insertedPings.push(saved);
          return { select: () => ({ single: () => Promise.resolve({ data: saved, error: null }) }) };
        }
      };
    }
  }
}));

const { default: tripLocationPingsRouter } = await import('./tripLocationPings.js');

// In-memory stand-in for req.supabase.from('loads'|'load_bids') — the
// authorization reads this route does before ever touching supabaseAdmin.
function createMockSupabase({ load = null, bid = null } = {}) {
  return {
    from(table) {
      if (table === 'loads') {
        return {
          select: () => ({
            eq: (field, value) => ({
              maybeSingle: () => Promise.resolve({ data: load && load[field] === value ? load : null, error: null })
            })
          })
        };
      }
      if (table === 'load_bids') {
        return {
          select: () => ({
            eq: (field1, value1) => ({
              eq: (field2, value2) => ({
                maybeSingle: () => {
                  if (!bid) return Promise.resolve({ data: null, error: null });
                  const match = bid[field1] === value1 && bid[field2] === value2;
                  return Promise.resolve({ data: match ? bid : null, error: null });
                }
              })
            })
          })
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function buildApp(mockSupabase, { userEmail = 'poster@x.com' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'caller-1', email: userEmail };
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/trip-location-pings', tripLocationPingsRouter);
  return app;
}

const validBody = { load_id: 'l1', lat: 19.076, lng: 72.877 };

describe('POST /api/trip-location-pings', () => {
  it('requires load_id, lat and lng', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trip-location-pings').send({ load_id: 'l1' });
    expect(res.status).toBe(400);
  });

  it('404s for a load that does not exist', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trip-location-pings').send(validBody);
    expect(res.status).toBe(404);
  });

  it('409s when the trip is not active', async () => {
    const app = buildApp(createMockSupabase({ load: { id: 'l1', posted_by: 'poster@x.com', status: 'completed' } }));
    const res = await request(app).post('/api/trip-location-pings').send(validBody);
    expect(res.status).toBe(409);
  });

  it('403s a caller who is neither the poster nor the approved bidder', async () => {
    const app = buildApp(
      createMockSupabase({
        load: { id: 'l1', posted_by: 'poster@x.com', status: 'matched' },
        bid: { load_id: 'l1', status: 'approved', bid_by_email: 'trucker@x.com' }
      }),
      { userEmail: 'stranger@x.com' }
    );
    const res = await request(app).post('/api/trip-location-pings').send(validBody);
    expect(res.status).toBe(403);
  });

  it('accepts a ping from the poster', async () => {
    const app = buildApp(
      createMockSupabase({ load: { id: 'l1', posted_by: 'poster@x.com', status: 'matched' } }),
      { userEmail: 'poster@x.com' }
    );
    const res = await request(app).post('/api/trip-location-pings').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ load_id: 'l1', lat: 19.076, lng: 72.877, reported_by: 'caller-1' });
  });

  it('accepts a ping from the approved bidder', async () => {
    const app = buildApp(
      createMockSupabase({
        load: { id: 'l1', posted_by: 'poster@x.com', status: 'in_transit' },
        bid: { load_id: 'l1', status: 'approved', bid_by_email: 'trucker@x.com' }
      }),
      { userEmail: 'trucker@x.com' }
    );
    const res = await request(app).post('/api/trip-location-pings').send(validBody);
    expect(res.status).toBe(201);
  });

  it('defaults recorded_at to now when not provided', async () => {
    const app = buildApp(
      createMockSupabase({ load: { id: 'l1', posted_by: 'poster@x.com', status: 'matched' } }),
      { userEmail: 'poster@x.com' }
    );
    const res = await request(app).post('/api/trip-location-pings').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.recorded_at).toBeTruthy();
  });
});
