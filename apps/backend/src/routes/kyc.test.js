import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockAdminState = { removeCalls: [], signedUrlCalls: [] };

// Backing store + minimal query builder for the plain `.from(table)...` reads
// supabaseAdmin does outside of storage — used by requireRole's user_roles
// check and by GET /queue's cases/profiles/documents lookups below.
function createAdminStore() {
  return { user_roles: [], kyc_cases: [], user_profiles: [], kyc_documents: [] };
}
let adminStore = createAdminStore();

function makeAdminQueryBuilder(table) {
  const filters = [];
  const rows = () => (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    in: (field, values) => Promise.resolve({ data: rows().filter((r) => values.includes(r[field])), error: null }),
    order: (field, { ascending = true } = {}) => {
      const sign = ascending ? 1 : -1;
      const data = [...rows()].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
      return Promise.resolve({ data, error: null });
    }
  };
  return builder;
}

vi.mock('../lib/supabase.js', () => ({
  supabaseAdmin: {
    storage: {
      from(bucket) {
        return {
          remove: (paths) => {
            mockAdminState.removeCalls.push({ bucket, paths });
            return Promise.resolve({ data: null, error: null });
          },
          createSignedUploadUrl: (path) => {
            mockAdminState.signedUrlCalls.push({ bucket, path });
            return Promise.resolve({ data: { signedUrl: `https://example.com/${path}`, path, token: 'tok' }, error: null });
          }
        };
      }
    },
    from: (table) => makeAdminQueryBuilder(table)
  }
}));

const { default: kycRouter } = await import('./kyc.js');

beforeEach(() => {
  adminStore = createAdminStore();
});

// In-memory stand-in covering the three tables kyc.js touches:
// user_profiles (read-only here), kyc_cases, kyc_documents.
function createMockSupabase({ profile = null, kycCase = null, documents = [] } = {}) {
  const state = { profile, kycCase, documents: [...documents] };

  return {
    _state: state,
    from(table) {
      if (table === 'user_profiles') {
        return {
          select() {
            return {
              eq: (field, value) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.profile && state.profile[field] === value ? state.profile : null,
                    error: null
                  })
              })
            };
          },
          update(fields) {
            return {
              eq(field, value) {
                if (state.profile && state.profile[field] === value) Object.assign(state.profile, fields);
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }

      if (table === 'kyc_cases') {
        return {
          select() {
            return {
              eq: (field, value) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: state.kycCase && state.kycCase[field] === value ? state.kycCase : null,
                    error: null
                  })
              })
            };
          },
          insert(row) {
            return {
              select() {
                return {
                  single: () => {
                    state.kycCase = { id: 'case-1', status: 'pending', created_at: new Date().toISOString(), ...row };
                    return Promise.resolve({ data: state.kycCase, error: null });
                  }
                };
              }
            };
          },
          update(fields) {
            return {
              eq(field, value) {
                if (state.kycCase && state.kycCase[field] === value) Object.assign(state.kycCase, fields);
                const promise = Promise.resolve({ error: null });
                promise.select = () => ({ single: () => Promise.resolve({ data: state.kycCase, error: null }) });
                return promise;
              }
            };
          }
        };
      }

      if (table === 'kyc_documents') {
        return {
          select() {
            return {
              eq: (field, value) => Promise.resolve({ data: state.documents.filter((d) => d[field] === value), error: null })
            };
          },
          upsert(row) {
            return {
              select() {
                return {
                  single: () => {
                    const idx = state.documents.findIndex(
                      (d) => d.case_id === row.case_id && d.document_type === row.document_type
                    );
                    const saved = { id: `doc-${idx >= 0 ? idx : state.documents.length}`, ...row };
                    if (idx >= 0) state.documents[idx] = saved;
                    else state.documents.push(saved);
                    return Promise.resolve({ data: saved, error: null });
                  }
                };
              }
            };
          }
        };
      }

      throw new Error(`unexpected table ${table}`);
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
  app.use('/api/profile/kyc', kycRouter);
  return app;
}

describe('GET /api/profile/kyc/case', () => {
  it('lazily creates a case from the profile role', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);
    const res = await request(app).get('/api/profile/kyc/case');

    expect(res.status).toBe(200);
    expect(res.body.case.kyc_type).toBe('driver');
    expect(res.body.required_documents).toEqual(['driving_license', 'pan', 'aadhaar', 'photo']);
    expect(res.body.missing_documents).toEqual(['driving_license', 'pan', 'aadhaar', 'photo']);
  });

  it('404s when no profile exists yet', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).get('/api/profile/kyc/case');
    expect(res.status).toBe(404);
  });

  it('404s for a role with no KYC requirement', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'admin' } });
    const app = buildApp(mockSupabase);
    const res = await request(app).get('/api/profile/kyc/case');
    expect(res.status).toBe(404);
  });

  it('reuses an existing case rather than recreating it', async () => {
    const mockSupabase = createMockSupabase({
      profile: { user_id: 'user-1', user_type: 'driver' },
      kycCase: { id: 'case-1', user_id: 'user-1', kyc_type: 'driver', status: 'partial' }
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).get('/api/profile/kyc/case');
    expect(res.status).toBe(200);
    expect(res.body.case.id).toBe('case-1');
    expect(res.body.case.status).toBe('partial');
  });
});

describe('POST /api/profile/kyc/documents/upload-url', () => {
  it('requires document_type', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/profile/kyc/documents/upload-url').send({});
    expect(res.status).toBe(400);
  });

  it('rejects a document_type not required for the role', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/profile/kyc/documents/upload-url')
      .send({ document_type: 'gst_certificate' });
    expect(res.status).toBe(400);
  });

  it('mints a signed URL scoped under the caller\'s user id', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/profile/kyc/documents/upload-url')
      .send({ document_type: 'aadhaar', file_name: 'aadhaar.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.storage_path).toBe('user-1/aadhaar.pdf');
    expect(res.body.signed_url).toContain('user-1/aadhaar.pdf');
  });
});

describe('POST /api/profile/kyc/documents', () => {
  it('rejects a storage_path outside the caller\'s own folder', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/profile/kyc/documents')
      .send({ document_type: 'aadhaar', storage_path: 'someone-else/aadhaar.pdf' });
    expect(res.status).toBe(403);
  });

  it('moves the case to partial after the first of several required documents', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/profile/kyc/documents')
      .send({ document_type: 'aadhaar', storage_path: 'user-1/aadhaar.pdf' });

    expect(res.status).toBe(200);
    expect(res.body.case_status).toBe('partial');
    expect(res.body.missing_documents).toEqual(['driving_license', 'pan', 'photo']);
  });

  it('auto-submits once every required document is uploaded', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);

    await request(app).post('/api/profile/kyc/documents').send({ document_type: 'aadhaar', storage_path: 'user-1/aadhaar.pdf' });
    await request(app)
      .post('/api/profile/kyc/documents')
      .send({ document_type: 'driving_license', storage_path: 'user-1/driving_license.pdf' });
    await request(app).post('/api/profile/kyc/documents').send({ document_type: 'pan', storage_path: 'user-1/pan.pdf' });
    const res = await request(app).post('/api/profile/kyc/documents').send({ document_type: 'photo', storage_path: 'user-1/photo.jpg' });

    expect(res.status).toBe(200);
    expect(res.body.case_status).toBe('submitted');
    expect(res.body.missing_documents).toEqual([]);
    expect(mockSupabase._state.profile.kyc_status).toBe('submitted');
  });
});

describe('POST /api/profile/kyc/submit', () => {
  it('400s when required documents are still missing', async () => {
    const mockSupabase = createMockSupabase({ profile: { user_id: 'user-1', user_type: 'driver' } });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/profile/kyc/submit');
    expect(res.status).toBe(400);
    expect(res.body.missing_documents).toEqual(['driving_license', 'pan', 'aadhaar', 'photo']);
  });

  it('submits once all required documents are present', async () => {
    const mockSupabase = createMockSupabase({
      profile: { user_id: 'user-1', user_type: 'driver' },
      kycCase: { id: 'case-1', user_id: 'user-1', kyc_type: 'driver', status: 'partial' },
      documents: [
        { case_id: 'case-1', document_type: 'aadhaar' },
        { case_id: 'case-1', document_type: 'driving_license' },
        { case_id: 'case-1', document_type: 'pan' },
        { case_id: 'case-1', document_type: 'photo' }
      ]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/profile/kyc/submit');
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe('submitted');
    expect(mockSupabase._state.profile.kyc_status).toBe('submitted');
  });

  it('400s when the case is already submitted', async () => {
    const mockSupabase = createMockSupabase({
      profile: { user_id: 'user-1', user_type: 'driver' },
      kycCase: { id: 'case-1', user_id: 'user-1', kyc_type: 'driver', status: 'submitted' },
      documents: [
        { case_id: 'case-1', document_type: 'aadhaar' },
        { case_id: 'case-1', document_type: 'driving_license' },
        { case_id: 'case-1', document_type: 'pan' },
        { case_id: 'case-1', document_type: 'photo' }
      ]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/profile/kyc/submit');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/profile/kyc/queue', () => {
  it('rejects a non-staff caller with 403', async () => {
    const app = buildApp(createMockSupabase(), 'user-1');
    const res = await request(app).get('/api/profile/kyc/queue');
    expect(res.status).toBe(403);
  });

  it('returns pending cases newest-first with profile and documents attached', async () => {
    adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    adminStore.kyc_cases.push(
      { id: 'case-1', user_id: 'user-1', kyc_type: 'driver', status: 'pending', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'case-2', user_id: 'user-2', kyc_type: 'transporter', status: 'pending', created_at: '2026-02-01T00:00:00.000Z' },
      { id: 'case-3', user_id: 'user-3', kyc_type: 'driver', status: 'submitted', created_at: '2026-03-01T00:00:00.000Z' }
    );
    adminStore.user_profiles.push(
      { user_id: 'user-1', full_name: 'Ravi Kumar', mobile: '+919000000001', city: 'Pune' },
      { user_id: 'user-2', full_name: 'Asha Devi', mobile: '+919000000002', city: 'Nashik' }
    );
    adminStore.kyc_documents.push({
      case_id: 'case-1',
      document_type: 'aadhaar',
      file_name: 'aadhaar.pdf',
      mime_type: 'application/pdf',
      uploaded_at: '2026-01-02T00:00:00.000Z'
    });

    const app = buildApp(createMockSupabase(), 'staff-1');
    const res = await request(app).get('/api/profile/kyc/queue');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2); // case-3 excluded — not 'pending'
    expect(res.body[0].case.id).toBe('case-2'); // newest first
    expect(res.body[0].profile).toMatchObject({ full_name: 'Asha Devi' });
    expect(res.body[0].documents).toEqual([]);
    expect(res.body[1].case.id).toBe('case-1');
    expect(res.body[1].profile).toMatchObject({ full_name: 'Ravi Kumar' });
    expect(res.body[1].documents).toHaveLength(1);
    expect(res.body[1].documents[0].document_type).toBe('aadhaar');
  });

  it('returns an empty array when no cases are pending', async () => {
    adminStore.user_roles.push({ user_id: 'staff-1', role: 'support_manager' });
    const app = buildApp(createMockSupabase(), 'staff-1');
    const res = await request(app).get('/api/profile/kyc/queue');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
