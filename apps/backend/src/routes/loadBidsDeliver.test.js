import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyEmail = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyEmail: (...args) => notifyEmail(...args),
  notifyUser: vi.fn(() => Promise.resolve())
}));

// Records every supabaseAdmin.from('loads').update(...) call so tests can
// assert the patch and the status guard it was scoped to, without simulating
// real row filtering.
const adminCalls = [];
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => {
      if (table === 'loads') {
        const call = { table, patch: null, filters: [], inFilters: [] };
        adminCalls.push(call);
        const c = {};
        c.update = (patch) => {
          call.patch = patch;
          return c;
        };
        c.eq = (field, value) => {
          call.filters.push([field, value]);
          return c;
        };
        c.in = (field, values) => {
          call.inFilters.push([field, values]);
          return c;
        };
        c.select = () => c;
        c.single = () => Promise.resolve({ data: { ...call.patch, id: call.filters.find((f) => f[0] === 'id')?.[1] }, error: null });
        return c;
      }
      throw new Error(`unexpected admin table ${table}`);
    }
  }
}));

const { default: loadBidsRouter } = await import('./loadBids.js');

function mockReqSupabase({ load, bid }) {
  return {
    from(table) {
      if (table === 'loads') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: load, error: null }) }) }) };
      }
      if (table === 'load_bids') {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: bid, error: null }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function buildApp({ load, bid, callerEmail }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'caller-1', email: callerEmail };
    req.supabase = mockReqSupabase({ load, bid });
    next();
  });
  app.use('/api/load-bids', loadBidsRouter);
  return app;
}

describe('POST /api/load-bids/load/:load_id/deliver', () => {
  const load = { id: 'load-1', posted_by: 'poster@example.com', status: 'matched', material_type: 'Cement' };
  const bid = { id: 'bid-1', load_id: 'load-1', bid_by_email: 'trucker@example.com', status: 'approved', amount: 5000 };

  beforeEach(() => {
    adminCalls.length = 0;
    notifyEmail.mockClear();
  });

  it('lets the poster mark the trip delivered and notifies the accepter', async () => {
    const app = buildApp({ load, bid, callerEmail: 'poster@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(200);
    const call = adminCalls.find((c) => c.table === 'loads');
    expect(call.patch).toEqual({ status: 'completed' });
    expect(call.filters).toContainEqual(['id', 'load-1']);
    expect(call.inFilters).toContainEqual(['status', ['matched', 'in_transit']]);
    expect(notifyEmail).toHaveBeenCalledWith('trucker@example.com', expect.objectContaining({ type: 'trip_delivered' }));
  });

  it('lets the approved accepter mark the trip delivered and notifies the poster', async () => {
    const app = buildApp({ load, bid, callerEmail: 'trucker@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(200);
    expect(notifyEmail).toHaveBeenCalledWith('poster@example.com', expect.objectContaining({ type: 'trip_delivered' }));
  });

  it('rejects a caller who is neither the poster nor the approved accepter', async () => {
    const app = buildApp({ load, bid, callerEmail: 'stranger@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(403);
    expect(adminCalls.length).toBe(0);
  });

  it('409s when the load is already completed', async () => {
    const app = buildApp({ load: { ...load, status: 'completed' }, bid, callerEmail: 'poster@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(409);
    expect(adminCalls.length).toBe(0);
  });

  it('404s when there is no approved bid on the load', async () => {
    const app = buildApp({ load, bid: null, callerEmail: 'poster@example.com' });
    const res = await request(app).post('/api/load-bids/load/load-1/deliver').send({});

    expect(res.status).toBe(404);
  });
});
