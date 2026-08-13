import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyEmail = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyEmail: (...args) => notifyEmail(...args),
  notifyUser: vi.fn(() => Promise.resolve())
}));

// Records every supabaseAdmin.from('truck_availabilities').update(...).eq(...) call
// so the test can assert both the patch and the filters it was scoped to,
// without simulating real row filtering.
const adminCalls = [];
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => {
      if (table === 'truck_availabilities') {
        const call = { table, patch: null, filters: [] };
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
        c.then = (resolve) => resolve({ data: null, error: null });
        return c;
      }
      throw new Error(`unexpected admin table ${table}`);
    }
  }
}));

const { default: loadBidsRouter } = await import('./loadBids.js');

function mockReqSupabase({ bid }) {
  return {
    from(table) {
      if (table === 'load_bids') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                gt: () => ({
                  select: () => ({ single: () => Promise.resolve({ data: bid, error: null }) })
                })
              })
            })
          })
        };
      }
      if (table === 'loads') {
        return { update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function buildApp(supabase) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'poster-1', email: 'poster@example.com' };
    req.supabase = supabase;
    next();
  });
  app.use('/api/load-bids', loadBidsRouter);
  return app;
}

describe('POST /api/load-bids/:id/approve', () => {
  beforeEach(() => {
    adminCalls.length = 0;
    notifyEmail.mockClear();
  });

  it("books the bid's truck availability so it drops out of nearby-load notifications", async () => {
    const bid = { id: 'bid-1', load_id: 'load-1', truck_id: 'truck-1', bid_by_email: 'trucker@example.com', amount: 5000 };
    const supabase = mockReqSupabase({ bid });
    const app = buildApp(supabase);

    const res = await request(app).post('/api/load-bids/bid-1/approve').send({});
    expect(res.status).toBe(200);

    const call = adminCalls.find((c) => c.table === 'truck_availabilities');
    expect(call).toBeTruthy();
    expect(call.patch.status).toBe('booked');
    expect(call.filters).toContainEqual(['truck_id', 'truck-1']);
    expect(call.filters).toContainEqual(['status', 'available']);
  });

  it('skips the truck_availabilities update when the bid has no truck_id', async () => {
    const bid = { id: 'bid-2', load_id: 'load-1', truck_id: null, bid_by_email: 'x@example.com', amount: 1000 };
    const supabase = mockReqSupabase({ bid });
    const app = buildApp(supabase);

    const res = await request(app).post('/api/load-bids/bid-2/approve').send({});
    expect(res.status).toBe(200);
    expect(adminCalls.length).toBe(0);
  });
});
