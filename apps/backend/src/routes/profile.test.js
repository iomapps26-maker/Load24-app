import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// supabaseAdmin is a real Supabase client construct at import time, so it's
// mocked here — DELETE / only calls .auth.admin.deleteUser(...). POST /'s
// duplicate-mobile check and mobile_verified lookup both read user_profiles
// through this admin client too (RLS on req.supabase can't see other rows,
// or is irrelevant for a same-user read done for consistency) — backed by
// the same `rows` array as req.supabase's mock below, via adminState.rows.
// kycCases/kycDocuments back resetKycCaseForRoleChange's reads/writes for
// the role-switch tests further down.
const mockAdminState = { deleteUserCalls: [], deleteUserError: null, rows: [], kycCases: [], kycDocuments: [] };

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        deleteUser(userId) {
          mockAdminState.deleteUserCalls.push(userId);
          return Promise.resolve({ error: mockAdminState.deleteUserError });
        }
      }
    },
    from(table) {
      if (table === 'user_profiles') {
        return {
          select() {
            const filters = [];
            const builder = {
              eq(field, value) {
                filters.push((r) => r[field] === value);
                return builder;
              },
              neq(field, value) {
                filters.push((r) => r[field] !== value);
                return builder;
              },
              // A real select is a snapshot, not a live handle onto the row a
              // later write might mutate — copy it, or a subsequent
              // .upsert()/.update() on the same in-memory row would silently
              // change what an already-fetched reference like `currentProfile`
              // reads too.
              maybeSingle: () => {
                const found = mockAdminState.rows.find((r) => filters.every((f) => f(r)));
                return Promise.resolve({ data: found ? { ...found } : null, error: null });
              }
            };
            return builder;
          },
          update(fields) {
            return {
              eq(field, value) {
                const row = mockAdminState.rows.find((r) => r[field] === value);
                if (row) Object.assign(row, fields);
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }
      if (table === 'kyc_cases') {
        return {
          select() {
            const filters = [];
            const builder = {
              eq(field, value) {
                filters.push((r) => r[field] === value);
                return builder;
              },
              maybeSingle: () => {
                const found = mockAdminState.kycCases.find((r) => filters.every((f) => f(r)));
                return Promise.resolve({ data: found ? { ...found } : null, error: null });
              }
            };
            return builder;
          },
          update(fields) {
            return {
              eq(field, value) {
                const row = mockAdminState.kycCases.find((r) => r[field] === value);
                if (row) Object.assign(row, fields);
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }
      if (table === 'kyc_documents') {
        return {
          select() {
            return {
              eq(field, value) {
                return Promise.resolve({
                  data: mockAdminState.kycDocuments.filter((d) => d[field] === value),
                  error: null
                });
              }
            };
          }
        };
      }
      throw new Error(`unexpected table ${table}`);
    }
  }
}));

const { default: profileRouter } = await import('./profile.js');

// In-memory stand-in for req.supabase.from('user_profiles')... — shares the
// same backing array as the supabaseAdmin mock above (mockAdminState.rows),
// since profile.js's POST route reads via supabaseAdmin and writes via
// req.supabase against what should be the same table.
function createMockSupabase(seedRows = []) {
  mockAdminState.rows = seedRows;
  const rows = mockAdminState.rows;

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
        },
        upsert(fields) {
          return {
            select() {
              return {
                single: () => {
                  let row = rows.find((r) => r.user_id === fields.user_id);
                  if (row) Object.assign(row, fields);
                  else {
                    row = { ...fields };
                    rows.push(row);
                  }
                  return Promise.resolve({ data: row, error: null });
                }
              };
            }
          };
        }
      };
    }
  };
}

function buildApp(mockSupabase, userId = 'user-1', userPhone = null) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId, phone: userPhone };
    req.supabase = mockSupabase;
    next();
  });
  app.use('/api/profile', profileRouter);
  return app;
}

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

describe('POST /api/profile', () => {
  const baseBody = { full_name: 'Test User', mobile: '9876543210', user_type: 'shipper' };

  it('marks the mobile verified when it matches the OTP-verified auth phone (WhatsApp OTP sign-up)', async () => {
    const app = buildApp(createMockSupabase([]), 'user-1', '+919876543210');
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(true);
  });

  it('leaves the mobile unverified when it does not match the auth-verified phone', async () => {
    const app = buildApp(createMockSupabase([]), 'user-1', '+911111111111');
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(false);
  });

  it('leaves the mobile unverified when there is no auth phone at all (email/Google sign-up)', async () => {
    const app = buildApp(createMockSupabase([]), 'user-1', null);
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(false);
  });

  it('keeps mobile_verified true on a re-save that does not change an already-verified number', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true }]),
      'user-1',
      null // auth phone unrelated here — this account verified via the link-phone flow instead
    );
    const res = await request(app).post('/api/profile').send({ ...baseBody, full_name: 'Updated Name' });
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(true);
  });

  it('resets mobile_verified to false when a previously-verified profile switches to a different, unproven number', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true }]),
      'user-1',
      null
    );
    const res = await request(app).post('/api/profile').send({ ...baseBody, mobile: '9111111111' });
    expect(res.status).toBe(201);
    expect(res.body.mobile_verified).toBe(false);
  });

  it('rejects a mobile already registered to a different account', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'other-user', mobile: '+919876543210', mobile_verified: true }]),
      'user-1',
      '+919876543210'
    );
    const res = await request(app).post('/api/profile').send(baseBody);
    expect(res.status).toBe(409);
  });
});

describe('POST /api/profile — role switch resets KYC', () => {
  const baseBody = { full_name: 'Test User', mobile: '9876543210', user_type: 'shipper' };

  beforeEach(() => {
    mockAdminState.kycCases = [];
    mockAdminState.kycDocuments = [];
  });

  it('re-targets the KYC case at the new role and drops it back to pending when no documents match', async () => {
    mockAdminState.kycCases = [
      { id: 'case-1', user_id: 'user-1', kyc_type: 'shipper', status: 'verified', reviewed_by: 'staff-1', reviewed_at: '2026-01-01T00:00:00Z', rejection_reason: null, location_address: null, location_lat: null, location_lng: null }
    ];
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true, user_type: 'shipper' }]),
      'user-1',
      null
    );

    const res = await request(app).post('/api/profile').send({ ...baseBody, user_type: 'driver' });

    expect(res.status).toBe(201);
    expect(res.body.kyc_status).toBe('pending');
    const kycCase = mockAdminState.kycCases[0];
    expect(kycCase.kyc_type).toBe('driver');
    expect(kycCase.status).toBe('pending');
    expect(kycCase.reviewed_by).toBeNull();
    expect(kycCase.reviewed_at).toBeNull();
  });

  it('leaves an existing KYC case untouched when the role is resaved unchanged', async () => {
    mockAdminState.kycCases = [
      { id: 'case-1', user_id: 'user-1', kyc_type: 'shipper', status: 'verified', reviewed_by: 'staff-1', reviewed_at: '2026-01-01T00:00:00Z', rejection_reason: null, location_address: null, location_lat: null, location_lng: null }
    ];
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true, user_type: 'shipper' }]),
      'user-1',
      null
    );

    const res = await request(app).post('/api/profile').send({ ...baseBody, full_name: 'Updated Name' });

    expect(res.status).toBe(201);
    expect(mockAdminState.kycCases[0].status).toBe('verified');
    expect(mockAdminState.kycCases[0].reviewed_by).toBe('staff-1');
  });

  it('still requires fresh admin approval after switching to a role whose required documents are already all on file', async () => {
    // broker and shipper require the identical document set in
    // kycRequiredDocs.js (and neither needs a location, unlike transporter),
    // so every required doc is already satisfied — that must move the case
    // straight to 'submitted', never to 'verified' without a fresh admin look.
    mockAdminState.kycCases = [
      { id: 'case-1', user_id: 'user-1', kyc_type: 'broker', status: 'verified', reviewed_by: 'staff-1', reviewed_at: '2026-01-01T00:00:00Z', rejection_reason: null, location_address: null, location_lat: null, location_lng: null }
    ];
    mockAdminState.kycDocuments = ['pan', 'aadhaar', 'bank_proof', 'lr', 'shop_photo'].map((document_type) => ({
      case_id: 'case-1',
      document_type
    }));
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true, user_type: 'broker' }]),
      'user-1',
      null
    );

    const res = await request(app).post('/api/profile').send({ ...baseBody, user_type: 'shipper' });

    expect(res.status).toBe(201);
    expect(res.body.kyc_status).toBe('submitted');
    const kycCase = mockAdminState.kycCases[0];
    expect(kycCase.kyc_type).toBe('shipper');
    expect(kycCase.status).toBe('submitted');
    expect(kycCase.reviewed_by).toBeNull();
  });

  it('does nothing when the user has no KYC case yet — the next KYC visit will create one for the new role', async () => {
    const app = buildApp(
      createMockSupabase([{ user_id: 'user-1', mobile: '+919876543210', mobile_verified: true, user_type: 'shipper' }]),
      'user-1',
      null
    );

    const res = await request(app).post('/api/profile').send({ ...baseBody, user_type: 'driver' });

    expect(res.status).toBe(201);
    expect(res.body.kyc_status).toBeUndefined();
    expect(mockAdminState.kycCases).toEqual([]);
  });
});
