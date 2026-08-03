import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const createUserCalls: any[] = [];

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        createUser: async (attrs: any) => {
          createUserCalls.push(attrs);
          return { data: {}, error: null };
        },
        generateLink: async ({ email }: { email: string }) => ({
          data: { properties: { hashed_token: `token-for-${email}` } },
          error: null
        })
      }
    }
  }
}));

vi.mock('../lib/otp.js', () => ({
  consumeOtp: async (_phone: string, code: string) =>
    code === '111111' ? { ok: true } : { ok: false, status: 401, error: 'Incorrect code' }
}));

const linkedCalls: any[] = [];
let ownerForPhone: { userId: string; authEmail: string } | null = null;

vi.mock('../lib/identityLinking.js', () => ({
  findAccountOwningPhone: async (_phone: string) => ownerForPhone,
  linkVerifiedPhoneToUser: async (userId: string, phone: string) => {
    linkedCalls.push({ userId, phone });
  },
  logAuthLinkEvent: async () => {}
}));

const { default: whatsappAuthRouter } = await import('./whatsappAuth.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/whatsapp', whatsappAuthRouter);
  return app;
}

describe('POST /api/auth/whatsapp/verify-otp', () => {
  it('creates a new synthetic-email user when no existing account owns the phone', async () => {
    ownerForPhone = null;
    createUserCalls.length = 0;
    const app = buildApp();

    const res = await request(app).post('/api/auth/whatsapp/verify-otp').send({ phone: '9876543210', code: '111111' });

    expect(res.status).toBe(200);
    expect(createUserCalls).toHaveLength(1);
    expect(createUserCalls[0].email).toBe('wa919876543210@phone.load24.internal');
    expect(res.body.email).toBe('wa919876543210@phone.load24.internal');
  });

  it('auto-links into an existing different real account instead of creating a new user', async () => {
    ownerForPhone = { userId: 'user-existing', authEmail: 'real@gmail.com' };
    createUserCalls.length = 0;
    linkedCalls.length = 0;
    const app = buildApp();

    const res = await request(app).post('/api/auth/whatsapp/verify-otp').send({ phone: '9876543211', code: '111111' });

    expect(res.status).toBe(200);
    expect(createUserCalls).toHaveLength(0);
    expect(linkedCalls).toEqual([{ userId: 'user-existing', phone: '+919876543211' }]);
    expect(res.body.email).toBe('real@gmail.com');
  });

  it('rejects an incorrect code', async () => {
    ownerForPhone = null;
    const app = buildApp();

    const res = await request(app).post('/api/auth/whatsapp/verify-otp').send({ phone: '9876543212', code: '000000' });

    expect(res.status).toBe(401);
  });
});
