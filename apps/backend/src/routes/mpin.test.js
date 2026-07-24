import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {}
}));

const { default: authRouter } = await import('./auth.js');

// In-memory stand-in for req.supabase's user_profiles access (mpin columns only).
function createMockSupabase(seedProfile = { user_id: 'user-1' }) {
  let profile = seedProfile ? { ...seedProfile } : null;
  return {
    _profile: () => profile,
    from(table) {
      if (table !== 'user_profiles') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(field, value) {
              return {
                maybeSingle: () =>
                  Promise.resolve({ data: profile && profile[field] === value ? profile : null, error: null })
              };
            }
          };
        },
        update(fields) {
          return {
            eq(field, value) {
              if (profile && profile[field] === value) Object.assign(profile, fields);
              return Promise.resolve({ error: null });
            }
          };
        }
      };
    }
  };
}

function buildApp(mockSupabase, { userId = 'user-1' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.token = 'tok-1';
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/mpin/set', () => {
  it('rejects a non-numeric mpin', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/auth/mpin/set').send({ mpin: 'abcd' });
    expect(res.status).toBe(400);
  });

  it('rejects an mpin outside 4-6 digits', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/auth/mpin/set').send({ mpin: '123' });
    expect(res.status).toBe(400);
  });

  it('404s when the caller has no profile yet', async () => {
    const app = buildApp(createMockSupabase(null));
    const res = await request(app).post('/api/auth/mpin/set').send({ mpin: '1234' });
    expect(res.status).toBe(404);
  });

  it('hashes and stores the mpin', async () => {
    const mockSupabase = createMockSupabase();
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/auth/mpin/set').send({ mpin: '1234' });
    expect(res.status).toBe(200);
    expect(mockSupabase._profile().mpin_hash).toBeTruthy();
    expect(mockSupabase._profile().mpin_hash).not.toBe('1234');
    expect(mockSupabase._profile().mpin_failed_attempts).toBe(0);
  });
});

// mpinLoginRateLimiter is a real express-rate-limit instance shared across
// every test in this process (keyed by req.user.id), so each test below uses
// its own unique userId to avoid one test's requests exhausting another's
// budget.
describe('POST /api/auth/mpin/login', () => {
  it('rejects a malformed mpin', async () => {
    const app = buildApp(createMockSupabase(), { userId: 'login-malformed' });
    const res = await request(app).post('/api/auth/mpin/login').send({ mpin: 'xx' });
    expect(res.status).toBe(400);
  });

  it('400s when no mpin has been set', async () => {
    const app = buildApp(createMockSupabase({ user_id: 'login-unset', mpin_hash: null }), {
      userId: 'login-unset'
    });
    const res = await request(app).post('/api/auth/mpin/login').send({ mpin: '1234' });
    expect(res.status).toBe(400);
  });

  it('succeeds with the correct mpin and resets failure counters', async () => {
    const userId = 'login-success';
    const mockSupabase = createMockSupabase({ user_id: userId });
    const setApp = buildApp(mockSupabase, { userId });
    await request(setApp).post('/api/auth/mpin/set').send({ mpin: '4321' });

    mockSupabase._profile().mpin_failed_attempts = 2;

    const loginApp = buildApp(mockSupabase, { userId });
    const res = await request(loginApp).post('/api/auth/mpin/login').send({ mpin: '4321' });

    expect(res.status).toBe(200);
    expect(mockSupabase._profile().mpin_failed_attempts).toBe(0);
    expect(mockSupabase._profile().mpin_locked_until).toBeNull();
  });

  it('rejects a wrong mpin and increments failed attempts', async () => {
    const userId = 'login-wrong';
    const mockSupabase = createMockSupabase({ user_id: userId });
    const setApp = buildApp(mockSupabase, { userId });
    await request(setApp).post('/api/auth/mpin/set').send({ mpin: '4321' });

    const loginApp = buildApp(mockSupabase, { userId });
    const res = await request(loginApp).post('/api/auth/mpin/login').send({ mpin: '0000' });

    expect(res.status).toBe(401);
    expect(res.body.attempts_remaining).toBe(4);
    expect(mockSupabase._profile().mpin_failed_attempts).toBe(1);
  });

  it('locks out after too many failed attempts', async () => {
    const userId = 'login-lockout';
    const mockSupabase = createMockSupabase({ user_id: userId });
    const setApp = buildApp(mockSupabase, { userId });
    await request(setApp).post('/api/auth/mpin/set').send({ mpin: '4321' });

    const loginApp = buildApp(mockSupabase, { userId });
    for (let i = 0; i < 4; i++) {
      await request(loginApp).post('/api/auth/mpin/login').send({ mpin: '0000' });
    }
    const res = await request(loginApp).post('/api/auth/mpin/login').send({ mpin: '0000' });
    expect(res.status).toBe(401);
    expect(mockSupabase._profile().mpin_locked_until).toBeTruthy();
  });
});
