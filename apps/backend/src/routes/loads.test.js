import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyUser = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyUser: (...args) => notifyUser(...args),
  notifyEmail: vi.fn(() => Promise.resolve())
}));

const sendWhatsAppLoadBroadcast = vi.fn(() => Promise.resolve({}));
vi.mock('../lib/whatsapp.js', () => ({
  sendWhatsAppLoadBroadcast: (...args) => sendWhatsAppLoadBroadcast(...args)
}));

const adminState = { truckAvailabilities: [], userProfiles: [] };
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
      if (table === 'user_profiles') return chain(adminState.userProfiles);
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

// Baseline "would match" posting/load pair — individual tests knock one
// field out of alignment at a time to prove that field is actually checked.
const baseLoadBody = {
  loading_pincode: '411001',
  loading_city: 'Pune',
  unloading_city: 'Mumbai',
  material_type: 'Cement',
  required_truck_type: 'tata_407',
  weight_tons: 8,
  loading_date: '2026-08-25',
  bhada_price: 25000
};
const basePosting = {
  id: 'posting-1',
  owner_id: 'trucker-1',
  available_now: true,
  available_from: null,
  truck: { truck_type: 'tata_407', capacity_tons: 10 }
};
const baseProfile = { user_id: 'trucker-1', mobile: '+919876543210', mobile_verified: true };

async function postLoad(supabase, body = baseLoadBody) {
  const res = await request(buildApp(supabase)).post('/api/loads').send(body);
  expect(res.status).toBe(201);
  await new Promise((resolve) => setImmediate(resolve));
  return res;
}

describe('POST /api/loads nearby-truck notifications', () => {
  beforeEach(() => {
    notifyUser.mockClear();
    sendWhatsAppLoadBroadcast.mockClear();
    adminState.truckAvailabilities = [];
    adminState.userProfiles = [];
  });

  it('notifies and WhatsApps a matching, verified owner of an available truck near the pickup point', async () => {
    adminState.truckAvailabilities = [basePosting];
    adminState.userProfiles = [baseProfile];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);

    expect(notifyUser).toHaveBeenCalledWith(
      'trucker-1',
      expect.objectContaining({
        type: 'load_available_nearby',
        data: { load_id: 'load-1', truck_availability_id: 'posting-1' }
      })
    );
    expect(sendWhatsAppLoadBroadcast).toHaveBeenCalledWith('+919876543210', {
      loadId: 'load-1',
      route: 'Pune → Mumbai',
      vehicleType: 'tata_407',
      tonnage: 8,
      pickup: '2026-08-25',
      freight: 25000
    });
  });

  it('skips the fan-out when the load has no loading_pincode', async () => {
    const supabase = mockReqSupabase();
    await postLoad(supabase, { material_type: 'Cement' });
    expect(notifyUser).not.toHaveBeenCalled();
    expect(sendWhatsAppLoadBroadcast).not.toHaveBeenCalled();
  });

  it('skips a posting whose truck type does not match the load and is not "other"', async () => {
    adminState.truckAvailabilities = [{ ...basePosting, truck: { truck_type: 'trailer', capacity_tons: 10 } }];
    adminState.userProfiles = [baseProfile];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('matches a posting whose truck type is "other" regardless of the load\'s required type', async () => {
    adminState.truckAvailabilities = [{ ...basePosting, truck: { truck_type: 'other', capacity_tons: 10 } }];
    adminState.userProfiles = [baseProfile];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);
    expect(notifyUser).toHaveBeenCalled();
  });

  it('skips a posting whose truck capacity is below the load weight', async () => {
    adminState.truckAvailabilities = [{ ...basePosting, truck: { truck_type: 'tata_407', capacity_tons: 5 } }];
    adminState.userProfiles = [baseProfile];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('matches a posting with no capacity_tons on file rather than excluding it', async () => {
    adminState.truckAvailabilities = [{ ...basePosting, truck: { truck_type: 'tata_407', capacity_tons: null } }];
    adminState.userProfiles = [baseProfile];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);
    expect(notifyUser).toHaveBeenCalled();
  });

  it('skips a posting that is not available now and free only after the load\'s pickup date', async () => {
    adminState.truckAvailabilities = [{ ...basePosting, available_now: false, available_from: '2026-09-01' }];
    adminState.userProfiles = [baseProfile];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('matches a posting that is not available now but free by the load\'s pickup date', async () => {
    adminState.truckAvailabilities = [{ ...basePosting, available_now: false, available_from: '2026-08-20' }];
    adminState.userProfiles = [baseProfile];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);
    expect(notifyUser).toHaveBeenCalled();
  });

  it('notifies in-app but does not WhatsApp an owner whose mobile is unverified', async () => {
    adminState.truckAvailabilities = [basePosting];
    adminState.userProfiles = [{ ...baseProfile, mobile_verified: false }];
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });

    await postLoad(supabase);
    expect(notifyUser).toHaveBeenCalled();
    expect(sendWhatsAppLoadBroadcast).not.toHaveBeenCalled();
  });
});

describe('GET /api/loads/:id', () => {
  function mockSingleLoadSupabase(row) {
    return {
      from(table) {
        if (table !== 'loads') throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: () => Promise.resolve({ data: row && row.id === val ? row : null, error: null })
            })
          })
        };
      }
    };
  }

  // Resolves the loadId a WhatsApp "View Load"/"Bid" link carries (see
  // PlaceBidScreen.jsx) — unlike LoadCard.jsx's in-app navigation, which
  // already has the whole load object on hand.
  it('returns a single load by id', async () => {
    const supabase = mockSingleLoadSupabase({ id: 'load-1', material_type: 'Cement' });
    const res = await request(buildApp(supabase)).get('/api/loads/load-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'load-1', material_type: 'Cement' });
  });

  it('404s on an id that does not match any load', async () => {
    const supabase = mockSingleLoadSupabase(null);
    const res = await request(buildApp(supabase)).get('/api/loads/does-not-exist');
    expect(res.status).toBe(404);
  });
});
