import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import bankDetailsRouter from './bankDetails.js';

// In-memory stand-in for req.supabase.from('bank_details')...
function createMockSupabase(seedRows = []) {
  let rows = [...seedRows];

  return {
    _rows: () => rows,
    from(table) {
      if (table !== 'bank_details') throw new Error(`unexpected table ${table}`);
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
        upsert(row) {
          rows = rows.filter((r) => r.user_id !== row.user_id);
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

function buildApp(mockSupabase, userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/bank-details', bankDetailsRouter);
  return app;
}

describe('GET /api/bank-details/me', () => {
  it('returns null when no bank details saved yet', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).get('/api/bank-details/me');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('returns the caller\'s own bank details', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', account_holder_name: 'Vivek Gupta', verified: true }])
    );
    const res = await request(app).get('/api/bank-details/me');
    expect(res.status).toBe(200);
    expect(res.body.account_holder_name).toBe('Vivek Gupta');
  });
});

describe('POST /api/bank-details', () => {
  const validBody = {
    account_holder_name: 'Vivek Gupta',
    account_number: '1452639870656',
    ifsc_code: 'SBI0002524546',
    bank_name: 'SBI BANK NOIDA'
  };

  it('requires all fields', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/bank-details').send({ account_holder_name: 'Vivek' });
    expect(res.status).toBe(400);
  });

  it('creates bank details as unverified', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/bank-details').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.verified).toBe(false);
  });

  it('resets verified to false when editing already-verified details', async () => {
    const mockSupabase = createMockSupabase([{ user_id: 'user-1', verified: true }]);
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/bank-details').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.verified).toBe(false);
  });
});
