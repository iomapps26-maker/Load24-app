import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockAdminState = { removeCalls: [], signedUrlCalls: [] };

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
    }
  }
}));

const { default: trucksRouter } = await import('./trucks.js');

// In-memory stand-in for req.supabase.from('user_profiles'|'trucks'|'truck_documents')...
function createMockSupabase({ userType = 'vehicle_owner', seedTrucks = [], seedDocuments = [] } = {}) {
  let rows = [...seedTrucks];
  let docRows = [...seedDocuments];

  function ownedRow(ownerField, ownerValue, idField, idValue) {
    return rows.find((r) => r[ownerField] === ownerValue && r[idField] === idValue) ?? null;
  }

  return {
    _rows: () => rows,
    from(table) {
      if (table === 'user_profiles') {
        return {
          select() {
            return {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: userType ? { user_type: userType } : null, error: null })
              })
            };
          }
        };
      }
      if (table === 'trucks') {
        return {
          select() {
            return {
              eq(field, value) {
                let filtered = rows.filter((r) => r[field] === value);
                return {
                  eq(field2, value2) {
                    filtered = filtered.filter((r) => r[field2] === value2);
                    return { maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null }) };
                  },
                  order: () => Promise.resolve({ data: filtered, error: null }),
                  maybeSingle: () => Promise.resolve({ data: filtered[0] ?? null, error: null })
                };
              }
            };
          },
          insert(row) {
            if (rows.some((r) => r.registration_number === row.registration_number)) {
              return { select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } }) }) };
            }
            rows.push(row);
            return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
          },
          update(patch) {
            return {
              eq(field, value) {
                return {
                  eq(field2, value2) {
                    return {
                      select: () => ({
                        maybeSingle: () => {
                          const existing = ownedRow(field2, value2, field, value);
                          if (!existing) return Promise.resolve({ data: null, error: null });
                          Object.assign(existing, patch);
                          return Promise.resolve({ data: existing, error: null });
                        }
                      })
                    };
                  },
                  // Real supabase-js query builders are themselves
                  // thenable — a caller that only chains one .eq() and
                  // awaits it directly (no .select()) still executes, same
                  // as the "fire and forget" updates elsewhere in the app
                  // (e.g. loadBids.js re-verification resets).
                  then(resolve) {
                    const matches = rows.filter((r) => r[field] === value);
                    matches.forEach((r) => Object.assign(r, patch));
                    resolve({ data: matches, error: null });
                  }
                };
              }
            };
          },
          delete() {
            return {
              eq(field, value) {
                return {
                  eq(field2, value2) {
                    return {
                      select: () => ({
                        maybeSingle: () => {
                          const idx = rows.findIndex((r) => r[field] === value && r[field2] === value2);
                          if (idx === -1) return Promise.resolve({ data: null, error: null });
                          const [removed] = rows.splice(idx, 1);
                          return Promise.resolve({ data: removed, error: null });
                        }
                      })
                    };
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'truck_documents') {
        return {
          upsert(row) {
            docRows = docRows.filter((d) => !(d.truck_id === row.truck_id && d.document_type === row.document_type));
            docRows.push(row);
            return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) };
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
  app.use('/api/trucks', trucksRouter);
  return app;
}

const validBody = { registration_number: 'MH12AB1234', truck_type: 'tata_407' };

describe('POST /api/trucks', () => {
  it('rejects accounts whose role is not driver or vehicle_owner', async () => {
    const app = buildApp(createMockSupabase({ userType: 'shipper' }));
    const res = await request(app).post('/api/trucks').send(validBody);
    expect(res.status).toBe(403);
  });

  it('requires registration_number and truck_type', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({ registration_number: 'MH12AB1234' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid truck_type', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({ ...validBody, truck_type: 'spaceship' });
    expect(res.status).toBe(400);
  });

  it('creates a truck owned by the caller', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.owner_id).toBe('user-1');
    expect(res.body.registration_number).toBe('MH12AB1234');
  });

  it('rejects a duplicate registration number', async () => {
    const mockSupabase = createMockSupabase({ seedTrucks: [{ id: 't1', owner_id: 'user-1', ...validBody }] });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/trucks').send(validBody);
    expect(res.status).toBe(409);
  });

  it('allows driver accounts too', async () => {
    const app = buildApp(createMockSupabase({ userType: 'driver' }));
    const res = await request(app).post('/api/trucks').send(validBody);
    expect(res.status).toBe(201);
  });

  it('rejects an invalid body_type', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({ ...validBody, body_type: 'convertible' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid fuel_type', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({ ...validBody, fuel_type: 'petrol' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid axle_type', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({ ...validBody, axle_type: 'triple_axle' });
    expect(res.status).toBe(400);
  });

  it('accepts the full new field set', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({
      ...validBody,
      tyre_count: 6,
      body_type: 'open',
      capacity_tons: 10,
      length_ft: 20,
      width_ft: 8,
      owner_name: 'Sumit',
      fuel_type: 'diesel',
      axle_type: 'multi_axle'
    });
    expect(res.status).toBe(201);
    expect(res.body.tyre_count).toBe(6);
    expect(res.body.fuel_type).toBe('diesel');
  });
});

describe('GET /api/trucks', () => {
  it('returns only the caller\'s own trucks', async () => {
    const mockSupabase = createMockSupabase({
      seedTrucks: [
        { id: 't1', owner_id: 'user-1', ...validBody },
        { id: 't2', owner_id: 'user-2', registration_number: 'DL01XY9999', truck_type: 'tata_ace' }
      ]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).get('/api/trucks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe('t1');
  });
});

describe('PATCH /api/trucks/:id', () => {
  it('resets verified to false on edit', async () => {
    const mockSupabase = createMockSupabase({
      seedTrucks: [{ id: 't1', owner_id: 'user-1', verified: true, ...validBody }]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).patch('/api/trucks/t1').send({ capacity_tons: 5 });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
  });

  it('404s for a truck the caller does not own', async () => {
    const mockSupabase = createMockSupabase({
      seedTrucks: [{ id: 't1', owner_id: 'other-user', ...validBody }]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).patch('/api/trucks/t1').send({ capacity_tons: 5 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/trucks/:id', () => {
  it('removes a truck owned by the caller', async () => {
    const mockSupabase = createMockSupabase({
      seedTrucks: [{ id: 't1', owner_id: 'user-1', ...validBody }]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).delete('/api/trucks/t1');
    expect(res.status).toBe(204);
    expect(mockSupabase._rows()).toHaveLength(0);
  });

  it('404s for a truck the caller does not own', async () => {
    const mockSupabase = createMockSupabase({
      seedTrucks: [{ id: 't1', owner_id: 'other-user', ...validBody }]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).delete('/api/trucks/t1');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/trucks/:id/documents/upload-url', () => {
  it('rejects an unknown document_type', async () => {
    const mockSupabase = createMockSupabase({ seedTrucks: [{ id: 't1', owner_id: 'user-1', ...validBody }] });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/trucks/t1/documents/upload-url').send({ document_type: 'road_tax', file_name: 'x.pdf' });
    expect(res.status).toBe(400);
  });

  it('404s for a truck the caller does not own', async () => {
    const mockSupabase = createMockSupabase({ seedTrucks: [{ id: 't1', owner_id: 'other-user', ...validBody }] });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/trucks/t1/documents/upload-url').send({ document_type: 'rc', file_name: 'rc.pdf' });
    expect(res.status).toBe(404);
  });

  it('mints a signed upload URL scoped to the caller and truck', async () => {
    const mockSupabase = createMockSupabase({ seedTrucks: [{ id: 't1', owner_id: 'user-1', ...validBody }] });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/trucks/t1/documents/upload-url').send({ document_type: 'rc', file_name: 'rc.pdf' });
    expect(res.status).toBe(200);
    expect(res.body.storage_path).toBe('user-1/t1/rc.pdf');
  });
});

describe('POST /api/trucks/:id/documents', () => {
  it('records the document and re-locks verification', async () => {
    const mockSupabase = createMockSupabase({
      seedTrucks: [{ id: 't1', owner_id: 'user-1', verified: true, ...validBody }]
    });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/trucks/t1/documents').send({
      document_type: 'insurance',
      storage_path: 'user-1/t1/insurance.pdf',
      file_name: 'insurance.pdf',
      mime_type: 'application/pdf'
    });
    expect(res.status).toBe(200);
    expect(res.body.document_type).toBe('insurance');
    expect(mockSupabase._rows()[0].verified).toBe(false);
  });

  it('rejects a storage_path that does not belong to the caller', async () => {
    const mockSupabase = createMockSupabase({ seedTrucks: [{ id: 't1', owner_id: 'user-1', ...validBody }] });
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/trucks/t1/documents').send({
      document_type: 'rc',
      storage_path: 'someone-else/t1/rc.pdf'
    });
    expect(res.status).toBe(403);
  });
});
