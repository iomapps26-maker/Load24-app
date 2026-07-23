import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const DAY_MS = 24 * 60 * 60 * 1000;

// supabaseAdmin is a real Supabase client construct at import time (needs
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars), so it's mocked here —
// the route only calls .from(...).update(...).eq(...) and
// .auth.admin.signOut(...), both stubbed below.
const mockAdminState = { profileUpdates: [], signOutCalls: [], signOutError: null };

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from(table) {
      if (table !== 'user_profiles') throw new Error(`unexpected table ${table}`);
      return {
        update(fields) {
          return {
            eq(field, value) {
              mockAdminState.profileUpdates.push({ fields, [field]: value });
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    },
    auth: {
      admin: {
        signOut(token, scope) {
          mockAdminState.signOutCalls.push({ token, scope });
          return Promise.resolve({ error: mockAdminState.signOutError });
        }
      }
    }
  }
}));

const { default: authRouter } = await import('./auth.js');

// In-memory stand-in for req.supabase's user_devices access.
function createMockSupabase(seedRows = []) {
  let rows = [...seedRows];
  return {
    _rows: () => rows,
    from(table) {
      if (table !== 'user_devices') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(f1, v1) {
              return {
                eq(f2, v2) {
                  return {
                    maybeSingle: () =>
                      Promise.resolve({
                        data: rows.find((r) => r[f1] === v1 && r[f2] === v2) ?? null,
                        error: null
                      })
                  };
                }
              };
            }
          };
        },
        upsert(row) {
          rows = rows.filter((r) => !(r.user_id === row.user_id && r.device_id === row.device_id));
          rows.push(row);
          return {
            select() {
              return { single: () => Promise.resolve({ data: row, error: null }) };
            }
          };
        }
      };
    }
  };
}

function buildApp(mockSupabase, { userId = 'user-1', token = 'tok-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.token = token;
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/devices/checkin', () => {
  it('flags a brand-new device as suspicious', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app)
      .post('/api/auth/devices/checkin')
      .send({ device_id: 'device-a', device_info: { platform: 'ios' } });

    expect(res.status).toBe(200);
    expect(res.body.suspicious).toBe(true);
  });

  it('does not flag a device seen recently', async () => {
    const mockSupabase = createMockSupabase([
      { user_id: 'user-1', device_id: 'device-a', last_login_at: new Date(Date.now() - DAY_MS).toISOString() }
    ]);
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/auth/devices/checkin').send({ device_id: 'device-a' });

    expect(res.status).toBe(200);
    expect(res.body.suspicious).toBe(false);
  });

  it('flags a device not seen in over 90 days', async () => {
    const mockSupabase = createMockSupabase([
      { user_id: 'user-1', device_id: 'device-a', last_login_at: new Date(Date.now() - 91 * DAY_MS).toISOString() }
    ]);
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/auth/devices/checkin').send({ device_id: 'device-a' });

    expect(res.status).toBe(200);
    expect(res.body.suspicious).toBe(true);
  });

  it('requires device_id', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/auth/devices/checkin').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/logout-all-devices', () => {
  beforeEach(() => {
    mockAdminState.profileUpdates = [];
    mockAdminState.signOutCalls = [];
    mockAdminState.signOutError = null;
  });

  it('stamps token_valid_after and revokes refresh tokens', async () => {
    const app = buildApp(createMockSupabase(), { userId: 'user-1', token: 'tok-1' });
    const res = await request(app).post('/api/auth/logout-all-devices').send();

    expect(res.status).toBe(200);
    expect(mockAdminState.profileUpdates).toHaveLength(1);
    expect(mockAdminState.profileUpdates[0].user_id).toBe('user-1');
    expect(mockAdminState.profileUpdates[0].fields.token_valid_after).toBeTruthy();
    expect(mockAdminState.signOutCalls).toEqual([{ token: 'tok-1', scope: 'global' }]);
  });

  it('surfaces a signOut failure as a 400', async () => {
    mockAdminState.signOutError = { message: 'boom' };
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/auth/logout-all-devices').send();

    expect(res.status).toBe(400);
  });
});
