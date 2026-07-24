import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {}
}));

const { default: authRouter } = await import('./auth.js');

// In-memory stand-in for req.supabase's consents access.
function createMockSupabase(seedRows = []) {
  let rows = [...seedRows];
  return {
    _rows: () => rows,
    from(table) {
      if (table !== 'consents') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq: (field, value) => Promise.resolve({ data: rows.filter((r) => r[field] === value), error: null })
          };
        },
        insert(newRows) {
          rows.push(...newRows);
          return {
            select: () => Promise.resolve({ data: newRows, error: null })
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
  app.use('/api/auth', authRouter);
  return app;
}

describe('POST /api/auth/accept-terms', () => {
  it('records the default required consents when no body is sent', async () => {
    const mockSupabase = createMockSupabase();
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/auth/accept-terms').send();

    expect(res.status).toBe(201);
    expect(res.body.consents).toHaveLength(2);
    expect(mockSupabase._rows().map((r) => r.consent_type).sort()).toEqual(['privacy_policy', 'terms_of_service']);
  });

  it('rejects an unknown consent_type', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app)
      .post('/api/auth/accept-terms')
      .send({ consents: [{ consent_type: 'not_a_real_type', version: '1.0' }] });
    expect(res.status).toBe(400);
  });

  it('is a no-op when the consent at that version is already recorded', async () => {
    const mockSupabase = createMockSupabase([
      { user_id: 'user-1', consent_type: 'terms_of_service', version: '1.0', granted: true }
    ]);
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/auth/accept-terms')
      .send({ consents: [{ consent_type: 'terms_of_service', version: '1.0' }] });

    expect(res.status).toBe(200);
    expect(res.body.consents).toEqual([]);
  });

  it('records an optional marketing consent alongside the required ones', async () => {
    const mockSupabase = createMockSupabase();
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/auth/accept-terms')
      .send({
        consents: [
          { consent_type: 'terms_of_service', version: '1.0' },
          { consent_type: 'privacy_policy', version: '1.0' },
          { consent_type: 'marketing_email', version: '1.0' }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.consents).toHaveLength(3);
  });
});
