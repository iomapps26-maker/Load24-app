import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: () => {
      throw new Error('unexpected supabaseAdmin.from call in auth.ts routes under test');
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: {
            user: {
              id,
              email: 'wa919876543210@phone.load24.internal',
              phone: '+919876543210',
              identities: [{ provider: 'phone' }]
            }
          },
          error: null
        })
      }
    }
  }
}));

vi.mock('../lib/otp.js', () => ({
  issueOtp: async () => ({ expires_in: 300 }),
  consumeOtp: async (_phone: string, code: string) =>
    code === '111111' ? { ok: true } : { ok: false, status: 401, error: 'Incorrect code' }
}));

let ownerForPhone: { userId: string; authEmail: string } | null = null;
let ownerHasProfile = false;
const linkedCalls: any[] = [];
const clearedCalls: string[] = [];

vi.mock('../lib/identityLinking.js', () => ({
  findAccountOwningPhone: async (_phone: string) => ownerForPhone,
  hasRealActivity: async (_userId: string) => ownerHasProfile,
  linkVerifiedPhoneToUser: async (userId: string, phone: string) => {
    linkedCalls.push({ userId, phone });
  },
  clearPhoneFromUser: async (userId: string) => {
    clearedCalls.push(userId);
  },
  logAuthLinkEvent: async () => {}
}));

const { default: authRouter } = await import('./auth.js');

function buildApp(userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: userId };
    req.token = 'tok';
    req.supabase = {};
    next();
  });
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/link-phone/verify-otp', () => {
  it('links an unclaimed phone directly to the caller', async () => {
    ownerForPhone = null;
    linkedCalls.length = 0;
    const app = buildApp('user-1');

    const res = await request(app)
      .post('/api/auth/link-phone/verify-otp')
      .send({ phone: '9876543220', code: '111111' });

    expect(res.status).toBe(200);
    expect(linkedCalls).toEqual([{ userId: 'user-1', phone: '+919876543220' }]);
  });

  it('re-homes a phone owned by an empty-shell account with no profile', async () => {
    ownerForPhone = { userId: 'orphan-1', authEmail: 'wa919876543221@phone.load24.internal' };
    ownerHasProfile = false;
    linkedCalls.length = 0;
    clearedCalls.length = 0;
    const app = buildApp('user-2');

    const res = await request(app)
      .post('/api/auth/link-phone/verify-otp')
      .send({ phone: '9876543221', code: '111111' });

    expect(res.status).toBe(200);
    expect(clearedCalls).toEqual(['orphan-1']);
    expect(linkedCalls).toEqual([{ userId: 'user-2', phone: '+919876543221' }]);
  });

  it('blocks linking a phone owned by a different account that has real data', async () => {
    ownerForPhone = { userId: 'other-user', authEmail: 'someone@gmail.com' };
    ownerHasProfile = true;
    linkedCalls.length = 0;
    clearedCalls.length = 0;
    const app = buildApp('user-3');

    const res = await request(app)
      .post('/api/auth/link-phone/verify-otp')
      .send({ phone: '9876543222', code: '111111' });

    expect(res.status).toBe(409);
    expect(linkedCalls).toHaveLength(0);
    expect(clearedCalls).toHaveLength(0);
  });
});

describe('GET /api/auth/identities', () => {
  it('reports phone linked and hides the synthetic placeholder email', async () => {
    const app = buildApp('user-1');
    const res = await request(app).get('/api/auth/identities');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: null,
      google_linked: false,
      phone: '+919876543210',
      phone_linked: true
    });
  });
});
