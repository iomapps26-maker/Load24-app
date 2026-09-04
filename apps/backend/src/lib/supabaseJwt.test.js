import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifySupabaseJwt, userFromJwtPayload } from './supabaseJwt.js';

const SECRET = 'test-jwt-secret-value';

function sign(payload, { secret = SECRET, alg = 'HS256' } = {}) {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe('verifySupabaseJwt', () => {
  it('accepts a correctly signed, unexpired token', () => {
    const token = sign({ sub: 'user-1', email: 'a@b.com', exp: nowSec() + 3600 });
    const payload = verifySupabaseJwt(token, SECRET);
    expect(payload?.sub).toBe('user-1');
    expect(payload?.email).toBe('a@b.com');
  });

  it('rejects a token signed with the wrong secret', () => {
    const token = sign({ sub: 'user-1', exp: nowSec() + 3600 }, { secret: 'other-secret' });
    expect(verifySupabaseJwt(token, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = sign({ sub: 'user-1', exp: nowSec() - 60 });
    expect(verifySupabaseJwt(token, SECRET)).toBeNull();
  });

  it('rejects a token with a tampered payload', () => {
    const token = sign({ sub: 'user-1', exp: nowSec() + 3600 });
    const [h, , s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'admin', exp: nowSec() + 3600 })).toString('base64url');
    expect(verifySupabaseJwt(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it('rejects a non-HS256 alg (e.g. "none")', () => {
    const token = sign({ sub: 'user-1', exp: nowSec() + 3600 }, { alg: 'none' });
    expect(verifySupabaseJwt(token, SECRET)).toBeNull();
  });

  it('rejects a token with no sub claim', () => {
    const token = sign({ email: 'a@b.com', exp: nowSec() + 3600 });
    expect(verifySupabaseJwt(token, SECRET)).toBeNull();
  });

  it('rejects structurally invalid input', () => {
    expect(verifySupabaseJwt('not-a-jwt', SECRET)).toBeNull();
    expect(verifySupabaseJwt('', SECRET)).toBeNull();
    expect(verifySupabaseJwt(null, SECRET)).toBeNull();
  });

  it('returns null when no secret is configured', () => {
    const token = sign({ sub: 'user-1', exp: nowSec() + 3600 });
    expect(verifySupabaseJwt(token, undefined)).toBeNull();
    expect(verifySupabaseJwt(token, '')).toBeNull();
  });
});

describe('userFromJwtPayload', () => {
  it('shapes the claims like getUser()\'s data.user', () => {
    const user = userFromJwtPayload({ sub: 'user-9', email: 'x@y.com', role: 'authenticated' });
    expect(user).toMatchObject({ id: 'user-9', email: 'x@y.com', role: 'authenticated' });
    expect(user.app_metadata).toEqual({});
  });
});
