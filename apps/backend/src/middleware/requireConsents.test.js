import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireConsents } from './requireConsents.js';

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

function buildApp(mockSupabase) {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: 'user-1' };
    req.supabase = mockSupabase;
    next();
  });
  app.use(requireConsents);
  app.get('/protected', (req, res) => res.json({ ok: true }));
  return app;
}

describe('requireConsents', () => {
  it('blocks access when required consents are missing', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).get('/protected');
    expect(res.status).toBe(403);
    expect(res.body.missing_consents).toHaveLength(2);
  });

  it('blocks access when a consent was granted at an old version', async () => {
    const app = buildApp(
      createMockSupabase([
        { user_id: 'user-1', consent_type: 'terms_of_service', version: '0.9', granted: true },
        { user_id: 'user-1', consent_type: 'privacy_policy', version: '1.0', granted: true }
      ])
    );
    const res = await request(app).get('/protected');
    expect(res.status).toBe(403);
    expect(res.body.missing_consents).toEqual([{ consent_type: 'terms_of_service', version: '1.0' }]);
  });

  it('allows access once all required consents are recorded at the current version', async () => {
    const app = buildApp(
      createMockSupabase([
        { user_id: 'user-1', consent_type: 'terms_of_service', version: '1.0', granted: true },
        { user_id: 'user-1', consent_type: 'privacy_policy', version: '1.0', granted: true }
      ])
    );
    const res = await request(app).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
