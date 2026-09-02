import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// The proof endpoints touch supabaseAdmin.storage; the review-status reset on
// POST / doesn't, but the import graph pulls supabase.js in either way.
vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        remove: () => Promise.resolve({ data: null, error: null }),
        createSignedUploadUrl: (path) =>
          Promise.resolve({ data: { signedUrl: `https://example.com/${path}`, path, token: 'tok' }, error: null })
      })
    }
  }
}));

const { default: bankDetailsRouter } = await import('./bankDetails.js');

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
        },
        update(patch) {
          return {
            eq(field, value) {
              const match = rows.find((r) => r[field] === value);
              if (match) Object.assign(match, patch);
              return {
                select: () => ({ maybeSingle: () => Promise.resolve({ data: match ?? null, error: null }) })
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
      createMockSupabase([{ user_id: 'user-1', account_holder_name: 'Vivek Gupta', verification_status: 'verified' }])
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

  it('requires all core fields', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/bank-details').send({ account_holder_name: 'Vivek' });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown account_type', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/bank-details').send({ ...validBody, account_type: 'nre' });
    expect(res.status).toBe(400);
  });

  it('creates bank details as pending', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app)
      .post('/api/bank-details')
      .send({ ...validBody, bank_branch: 'Sector 18', account_type: 'savings' });
    expect(res.status).toBe(201);
    expect(res.body.verification_status).toBe('pending');
    expect(res.body.bank_branch).toBe('Sector 18');
    expect(res.body.account_type).toBe('savings');
  });

  it('resets a verified account back to pending and clears the review fields on edit', async () => {
    const mockSupabase = createMockSupabase([
      { user_id: 'user-1', verification_status: 'verified', rejection_reason: null, reviewed_by: 'staff-1' }
    ]);
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/bank-details').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.verification_status).toBe('pending');
    expect(res.body.reviewed_by).toBeNull();
  });
});

describe('POST /api/bank-details/proof', () => {
  it('rejects a storage_path outside the caller\'s own folder', async () => {
    const app = buildApp(createMockSupabase([{ user_id: 'user-1', verification_status: 'verified' }]));
    const res = await request(app).post('/api/bank-details/proof').send({ storage_path: 'someone-else/proof.jpg' });
    expect(res.status).toBe(403);
  });

  it('404s when the caller has no bank details row yet', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/bank-details/proof').send({ storage_path: 'user-1/proof.jpg' });
    expect(res.status).toBe(404);
  });

  it('records the proof path and resets review status to pending', async () => {
    const mockSupabase = createMockSupabase([{ user_id: 'user-1', verification_status: 'rejected', rejection_reason: 'blurry' }]);
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/bank-details/proof').send({ storage_path: 'user-1/proof.jpg' });
    expect(res.status).toBe(200);
    expect(res.body.proof_path).toBe('user-1/proof.jpg');
    expect(res.body.verification_status).toBe('pending');
    expect(res.body.rejection_reason).toBeNull();
  });
});
