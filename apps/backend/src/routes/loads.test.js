import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyUser = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyUser: (...args) => notifyUser(...args),
  notifyEmail: vi.fn(() => Promise.resolve())
}));

const adminState = { truckAvailabilities: [] };
function chain(rows) {
  const c = {};
  ['select', 'eq', 'in', 'neq', 'order', 'limit'].forEach((m) => {
    c[m] = () => c;
  });
  c.then = (resolve) => resolve({ data: rows, error: null });
  return c;
}
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => {
      if (table === 'truck_availabilities') return chain(adminState.truckAvailabilities);
      throw new Error(`unexpected admin table ${table}`);
    }
  }
}));

const { default: loadsRouter } = await import('./loads.js');

function mockReqSupabase({ nearbyPincodes = [] } = {}) {
  return {
    rpc: (fn) => {
      if (fn === 'pincodes_within_radius') return Promise.resolve({ data: nearbyPincodes, error: null });
      throw new Error(`unexpected rpc ${fn}`);
    },
    from(table) {
      if (table === 'loads') {
        return {
          insert: (row) => ({
            select: () => ({ single: () => Promise.resolve({ data: { id: 'load-1', ...row }, error: null }) })
          })
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function buildApp(supabase, userId = 'shipper-1', email = 'shipper@example.com') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId, email };
    req.supabase = supabase;
    next();
  });
  app.use('/api/loads', loadsRouter);
  return app;
}

describe('POST /api/loads nearby-truck notifications', () => {
  beforeEach(() => {
    notifyUser.mockClear();
    adminState.truckAvailabilities = [];
  });

  it('notifies owners of available trucks near the load pickup point', async () => {
    adminState.truckAvailabilities = [{ id: 'posting-1', owner_id: 'trucker-1' }];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });
    const app = buildApp(supabase);

    const res = await request(app)
      .post('/api/loads')
      .send({ loading_pincode: '411001', loading_city: 'Pune', material_type: 'Cement' });
    expect(res.status).toBe(201);

    await new Promise((resolve) => setImmediate(resolve));

    expect(notifyUser).toHaveBeenCalledWith(
      'trucker-1',
      expect.objectContaining({
        type: 'load_available_nearby',
        data: { load_id: 'load-1', truck_availability_id: 'posting-1' }
      })
    );
  });

  it('skips the fan-out when the load has no loading_pincode', async () => {
    const supabase = mockReqSupabase();
    const app = buildApp(supabase);

    const res = await request(app).post('/api/loads').send({ material_type: 'Cement' });
    expect(res.status).toBe(201);

    await new Promise((resolve) => setImmediate(resolve));
    expect(notifyUser).not.toHaveBeenCalled();
  });
});
