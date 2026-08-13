import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const notifyUser = vi.fn(() => Promise.resolve());
vi.mock('../lib/notify.js', () => ({
  notifyUser: (...args) => notifyUser(...args),
  notifyEmail: vi.fn(() => Promise.resolve())
}));

const sendWhatsAppLoadAlert = vi.fn(() => Promise.resolve());
vi.mock('../lib/whatsapp.js', () => ({
  sendWhatsAppLoadAlert: (...args) => sendWhatsAppLoadAlert(...args)
}));

// Generic chainable stub: every query-builder method returns itself, and the
// object resolves to { data, error } when awaited — matches how supabase-js
// builders are thenable regardless of how many filters were chained.
// maybeSingle() is terminal (as it is in supabase-js), resolving to the
// first row instead of the whole array.
const adminState = { loads: [], userProfiles: [], ownerProfile: null };
function chain(rows) {
  const c = {};
  ['select', 'eq', 'in', 'neq', 'order', 'limit', 'gt', 'lt'].forEach((m) => {
    c[m] = () => c;
  });
  c.maybeSingle = () => Promise.resolve({ data: adminState.ownerProfile, error: null });
  c.then = (resolve) => resolve({ data: rows, error: null });
  return c;
}
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: (table) => {
      if (table === 'loads') return chain(adminState.loads);
      if (table === 'user_profiles') return chain(adminState.userProfiles);
      throw new Error(`unexpected admin table ${table}`);
    }
  }
}));

const { default: truckAvailabilityRouter } = await import('./truckAvailability.js');

function mockReqSupabase({ trucks = [{ id: 'truck-1' }], nearbyPincodes = [] } = {}) {
  return {
    rpc: (fn) => {
      if (fn === 'pincodes_within_radius') return Promise.resolve({ data: nearbyPincodes, error: null });
      throw new Error(`unexpected rpc ${fn}`);
    },
    from(table) {
      if (table === 'trucks') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: trucks[0] ?? null, error: null }) })
            })
          })
        };
      }
      if (table === 'truck_availabilities') {
        return {
          insert(row) {
            const saved = { id: 'posting-1', ...row };
            return { select: () => ({ single: () => Promise.resolve({ data: saved, error: null }) }) };
          }
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function buildApp(supabase, userId = 'owner-1', email = 'owner@example.com') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId, email };
    req.supabase = supabase;
    next();
  });
  app.use('/api/truck-availability', truckAvailabilityRouter);
  return app;
}

describe('POST /api/truck-availability nearby-load notifications', () => {
  beforeEach(() => {
    notifyUser.mockClear();
    sendWhatsAppLoadAlert.mockClear();
    adminState.loads = [];
    adminState.userProfiles = [];
    adminState.ownerProfile = null;
  });

  it('notifies the truck owner about active loads already posted near the truck, and WhatsApps a verified owner', async () => {
    adminState.loads = [
      { id: 'load-1', material_type: 'Cement', loading_city: 'Pune', loading_pincode: '411001', posted_by: 'shipper@example.com' }
    ];
    adminState.ownerProfile = { mobile: '+919876543210', mobile_verified: true };
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });
    const app = buildApp(supabase);

    const res = await request(app)
      .post('/api/truck-availability')
      .send({ truck_id: 'truck-1', current_pincode: '411000' });
    expect(res.status).toBe(201);

    // notifyNearbyLoads runs fire-and-forget after the response is sent.
    await new Promise((resolve) => setImmediate(resolve));

    expect(notifyUser).toHaveBeenCalledWith(
      'owner-1',
      expect.objectContaining({
        type: 'load_available_nearby',
        data: { load_id: 'load-1', truck_availability_id: 'posting-1' }
      })
    );
    expect(sendWhatsAppLoadAlert).toHaveBeenCalledWith('+919876543210', { material: 'Cement', city: 'Pune' });
  });

  it('skips the WhatsApp send when the owner has no verified mobile, but still notifies in-app', async () => {
    adminState.loads = [
      { id: 'load-1', material_type: 'Cement', loading_city: 'Pune', loading_pincode: '411001', posted_by: 'shipper@example.com' }
    ];
    adminState.ownerProfile = { mobile: '+919876543210', mobile_verified: false };
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });
    const app = buildApp(supabase);

    const res = await request(app)
      .post('/api/truck-availability')
      .send({ truck_id: 'truck-1', current_pincode: '411000' });
    expect(res.status).toBe(201);

    await new Promise((resolve) => setImmediate(resolve));

    expect(notifyUser).toHaveBeenCalledWith('owner-1', expect.objectContaining({ type: 'load_available_nearby' }));
    expect(sendWhatsAppLoadAlert).not.toHaveBeenCalled();
  });

  it('still sends the in-app notification when the WhatsApp send throws', async () => {
    adminState.loads = [
      { id: 'load-1', material_type: 'Cement', loading_city: 'Pune', loading_pincode: '411001', posted_by: 'shipper@example.com' }
    ];
    adminState.ownerProfile = { mobile: '+919876543210', mobile_verified: true };
    sendWhatsAppLoadAlert.mockRejectedValueOnce(new Error('template not approved'));
    const supabase = mockReqSupabase({ nearbyPincodes: [{ pincode: '411001' }] });
    const app = buildApp(supabase);

    const res = await request(app)
      .post('/api/truck-availability')
      .send({ truck_id: 'truck-1', current_pincode: '411000' });
    expect(res.status).toBe(201);

    await new Promise((resolve) => setImmediate(resolve));

    expect(notifyUser).toHaveBeenCalledWith('owner-1', expect.objectContaining({ type: 'load_available_nearby' }));
  });

  it('does nothing when the posting has no current_pincode', async () => {
    const supabase = mockReqSupabase();
    const app = buildApp(supabase);

    const res = await request(app).post('/api/truck-availability').send({ truck_id: 'truck-1' });
    expect(res.status).toBe(201);

    await new Promise((resolve) => setImmediate(resolve));
    expect(notifyUser).not.toHaveBeenCalled();
    expect(sendWhatsAppLoadAlert).not.toHaveBeenCalled();
  });
});
