import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// supabaseAdmin is a real Supabase client construct at import time, so it's
// mocked here — DELETE / only calls .auth.admin.deleteUser(...). POST /'s
// duplicate-mobile check and mobile_verified lookup both read user_profiles
// through this admin client too (RLS on req.supabase can't see other rows,
// or is irrelevant for a same-user read done for consistency) — backed by
// the same `rows` array as req.supabase's mock below, via adminState.rows.
const mockAdminState = { deleteUserCalls: [], deleteUserError: null, rows: [] };

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        deleteUser(userId) {
          mockAdminState.deleteUserCalls.push(userId);
          return Promise.resolve({ error: mockAdminState.deleteUserError });
        }
      }
    },
    from(table) {
      if (table !== 'user_profiles') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          const filters = [];
          const builder = {
            eq(field, value) {
              filters.push((r) => r[field] === value);
              return builder;
            },
            neq(field, value) {
              filters.push((r) => r[field] !== value);
              return builder;
            },
            maybeSingle: () =>
              Promise.resolve({
                data: mockAdminState.rows.find((r) => filters.every((f) => f(r))) ?? null,
                error: null
              })
          };
          return builder;
        }
      };
    }
  }
}));

const { default: profileRouter } = await import('./profile.js');

// In-memory stand-in for req.supabase.from('user_profiles')... — shares the
// same backing array as the supabaseAdmin mock above (mockAdminState.rows),
// since profile.js's POST route reads via supabaseAdmin and writes via
// req.supabase against what should be the same table.
function createMockSupabase(seedRows = []) {
  mockAdminState.rows = seedRows;
  const rows = mockAdminState.rows;

  return {
    _rows: () => rows,
    from(table) {
      if (table !== 'user_profiles') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(field, value) {
              return {
                maybeSingle: () =>
                  Promise.resolve({ data: rows.find((r) => r[field] === value) ?? null, error: null })
              };
            }
          };
        },
        update(fields) {
          return {
            eq(field, value) {
              const row = rows.find((r) => r[field] === value);
              if (row) Object.assign(row, fields);
              return {
                select() {
                  return { single: () => Promise.resolve({ data: row, error: null }) };
                }
              };
            }
          };
        },
        upsert(fields) {
          return {
            select() {
              return {
                single: () => {
                  let row = rows.find((r) => r.user_id === fields.user_id);
                  if (row) Object.assign(row, fields);
                  else {
                    row = { ...fields };
                    rows.push(row);
                  }
                  return Promise.resolve({ data: row, error: null });
                }
              };
            }
          };
        }
      };
    }
  };
}

function buildApp(mockSupabase, userId = 'user-1', userPhone = null) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId, phone: userPhone };
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/profile', profileRouter);
  return app;
}

describe('DELETE /api/profile', () => {
  beforeEach(() => {
    mockAdminState.deleteUserCalls = [];
    mockAdminState.deleteUserError = null;
  });

  it('hard-deletes the caller\'s auth user', async () => {
    const app = buildApp(createMockSupabase(), 'user-1');
    const res = await request(app).delete('/api/profile');
    expect(res.status).toBe(204);
    expect(mockAdminState.deleteUserCalls).toEqual(['user-1']);
  });

  it('surfaces a delete failure as a 400', async () => {
    mockAdminState.deleteUserError = { message: 'boom' };
    const app = buildApp(createMockSupabase());
    const res = await request(app).delete('/api/profile');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/profile', () => {
  const baseBody = { full_name: 'Test User', mobile: '9876543210', user_type: 'shipper' };

  it('marks the mobile verified when it matches the OTP-verified auth phone (WhatsApp OTP sign-up)', async () => {
    const app = buildApp(createMockSupabase([]), 'user-1', '+919876543210');
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(true);
  });

  it('leaves the mobile unverified when it does not match the auth-verified phone', async () => {
    const app = buildApp(createMockSupabase([]), 'user-1', '+911111111111');
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(false);
  });

  it('leaves the mobile unverified when there is no auth phone at all (email/Google sign-up)', async () => {
    const app = buildApp(createMockSupabase([]), 'user-1', null);
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(false);
  });

  it('keeps mobile_verified true on a re-save that does not change an already-verified number', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true }]),
      'user-1',
      null // auth phone unrelated here — this account verified via the link-phone flow instead
    );
    const res = await request(app).post('/api/profile').send({ ...baseBody, full_name: 'Updated Name' });
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(true);
  });

  it('resets mobile_verified to false when a previously-verified profile switches to a different, unproven number', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true }]),
      'user-1',
      null
    );
    const res = await request(app).post('/api/profile').send({ ...baseBody, mobile: '9111111111' });
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(false);
  });

  it('rejects a mobile already registered to a different account', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'other-user', mobile: '+919876543210', mobile_verified: true }]),
      'user-1',
      '+919876543210'
    );
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(409);
  });
});
