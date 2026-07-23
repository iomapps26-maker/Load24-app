import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// supabaseAdmin is a real Supabase client construct at import time, so it's
// mocked here — DELETE / only calls .auth.admin.deleteUser(...).
const mockAdminState = { deleteUserCalls: [], deleteUserError: null };

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        deleteUser(userId) {
          mockAdminState.deleteUserCalls.push(userId);
          return Promise.resolve({ error: mockAdminState.deleteUserError });
        }
      }
    }
  }
}));

const { default: profileRouter } = await import('./profile.js');

// In-memory stand-in for req.supabase.from('user_profiles')...
function createMockSupabase(seedRows = []) {
  let rows = [...seedRows];

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
        }
      };
    }
  };
}

function buildApp(mockSupabase, userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/profile', profileRouter);
  return app;
}

describe('POST /api/profile/kyc/submit', () => {
  it('moves pending to submitted', async () => {
    const app = buildApp(createMockSupabase([{ user_id: 'user-1', kyc_status: 'pending' }]));
    const res = await request(app).post('/api/profile/kyc/submit');
    expect(res.status).toBe(200);
    expect(res.body.kyc_status).toBe('submitted');
  });

  it('rejects when already verified', async () => {
    const app = buildApp(createMockSupabase([{ user_id: 'user-1', kyc_status: 'verified' }]));
    const res = await request(app).post('/api/profile/kyc/submit');
    expect(res.status).toBe(400);
  });

  it('404s when profile does not exist', async () => {
    const app = buildApp(createMockSupabase([]));
    const res = await request(app).post('/api/profile/kyc/submit');
    expect(res.status).toBe(404);
  });
});

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
