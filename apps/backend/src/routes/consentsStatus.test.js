import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {}
}));

const { default: authRouter } = await import('./auth.js');

function createMockSupabase(seedRows = []) {
  return {
    from(table) {
      if (table !== 'consents') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(f1, v1) {
              return {
                eq: (f2, v2) =>
                  Promise.resolve({ data: seedRows.filter((r) => r[f1] === v1 && r[f2] === v2), error: null })
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
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/auth', authRouter);
  return app;
}

describe('GET /api/auth/consents/status', () => {
  it('reports both required consents missing for a fresh user', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).get('/api/auth/consents/status');
    expect(res.status).toBe(200);
    expect(res.body.missing_consents).toHaveLength(2);
  });

  it('reports nothing missing once both are granted at the current version', async () => {
    const app = buildApp(
      createMockSupabase([
        { user_id: 'user-1', consent_type: 'terms_of_service', version: '1.0', granted: true },
        { user_id: 'user-1', consent_type: 'privacy_policy', version: '1.0', granted: true }
      ])
    );
    const res = await request(app).get('/api/auth/consents/status');
    expect(res.status).toBe(200);
    expect(res.body.missing_consents).toEqual([]);
  });
});
