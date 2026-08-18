import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockAdminState = { removeCalls: [], signedUrlCalls: [] };

// Backing store + minimal query builder for the plain `.from(table)...` reads
// supabaseAdmin does outside of storage — used by requireRole's user_roles
// check and by GET /queue's trucks/owners/documents lookups below. Thenable
// at every step so any chain order the real code uses resolves correctly
// whether or not .order() is called — same approach as kyc.test.js's.
function createAdminStore() {
  return { user_roles: [], trucks: [], user_profiles: [], truck_documents: [], notifications: [], master_data: [] };
}
let adminStore = createAdminStore();

// truck_type/body_type validation now round-trips through master_data (see
// trucks.js's isActiveMasterDataValue) instead of a hardcoded array — seed
// the same values the old TRUCK_TYPES/BODY_TYPES arrays held so every
// existing test below still exercises the same valid/invalid truck_type
// and body_type values it always did.
function seedMasterData() {
  const truckTypes = [
    'mahindra_pickup', 'tata_407', 'tata_ace', 'chota_hathi', 'four_vehicle_loader',
    'eicher_truck', 'ashok_leyland', 'lcv', 'lgv',
    'trailer', 'tanker', 'tipper', 'flatbed', 'car_carrier', 'other'
  ];
  const bodyTypes = ['open', 'closed', 'container', 'other'];
  adminStore.master_data.push(
    ...truckTypes.map((value) => ({ category: 'truck_type', value, label: value, is_active: true })),
    ...bodyTypes.map((value) => ({ category: 'body_type', value, label: value, is_active: true }))
  );
}

function makeAdminQueryBuilder(table) {
  const filters = [];
  let sort = null;
  const builder = {
    select: () => builder,
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return builder;
    },
    in: (field, values) => {
      filters.push((r) => values.includes(r[field]));
      return builder;
    },
    order: (field, { ascending = true } = {}) => {
      sort = { field, sign: ascending ? 1 : -1 };
      return builder;
    },
    // Used by isActiveMasterDataValue's plain select().eq()...eq().maybeSingle()
    // chain — everything else in this file's admin reads either goes through
    // .then() directly or through update()'s own maybeSingle() below.
    maybeSingle: () => {
      const data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: data[0] ?? null, error: null });
    },
    insert(row) {
      (adminStore[table] || (adminStore[table] = [])).push(row);
      return Promise.resolve({ data: row, error: null });
    },
    update(patch) {
      const updateFilters = [];
      const updateBuilder = {
        eq: (field, value) => {
          updateFilters.push((r) => r[field] === value);
          return updateBuilder;
        },
        select: () => ({
          maybeSingle: () => {
            const match = (adminStore[table] || []).find((r) => updateFilters.every((f) => f(r)));
            if (!match) return Promise.resolve({ data: null, error: null });
            Object.assign(match, patch);
            return Promise.resolve({ data: match, error: null });
          }
        })
      };
      return updateBuilder;
    },
    then: (resolve) => {
      let data = (adminStore[table] || []).filter((r) => filters.every((f) => f(r)));
      if (sort) {
        const { field, sign } = sort;
        data = [...data].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0));
      }
      resolve({ data, error: null });
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
          },
          createSignedUrl: (path, ttl) => {
            mockAdminState.signedUrlCalls.push({ bucket, path, ttl });
            return Promise.resolve({ data: { signedUrl: `https://example.com/view/${path}?ttl=${ttl}` }, error: null });
          }
        };
      }
    },
    from: (table) => makeAdminQueryBuilder(table)
  }
}));

const { default: trucksRouter } = await import('./trucks.js');

beforeEach(() => {
  adminStore = createAdminStore();
  seedMasterData();
});

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
    // Regression test for the TRUCK_TYPES-hardcoded-array -> master_data
    // move (041_add_master_data.sql): validateEnums now round-trips through
    // isActiveMasterDataValue instead of an Array#includes check, and
    // 'spaceship' still isn't a seeded value (see seedMasterData above), so
    // this must still 400 the same way it always did.
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({ ...validBody, truck_type: 'spaceship' });
    expect(res.status).toBe(400);
  });

  it('rejects a truck_type that exists in master_data but has been deactivated', async () => {
    // Behavior only possible now that this is DB-backed: staff deactivating
    // a truck_type via PATCH /api/admin/master-data/:id (masterData.js)
    // must make it stop validating on new trucks, same as if it had never
    // been seeded at all.
    adminStore.master_data = adminStore.master_data.filter((r) => !(r.category === 'truck_type' && r.value === 'tata_407'));
    adminStore.master_data.push({ category: 'truck_type', value: 'tata_407', label: 'Tata 407', is_active: false });
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send(validBody);
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

  it('accepts truck_type/body_type "other" with the free-text detail', async () => {
    const app = buildApp(createMockSupabase());
    const res = await request(app).post('/api/trucks').send({
      ...validBody,
      truck_type: 'other',
      truck_type_other: 'Custom 12-wheeler',
      body_type: 'other',
      body_type_other: 'Half-open'
    });
    expect(res.status).toBe(201);
    expect(res.body.truck_type_other).toBe('Custom 12-wheeler');
    expect(res.body.body_type_other).toBe('Half-open');
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

describe('POST /api/trucks/:id/verify', () => {
  it('rejects a non-staff caller with 403', async () => {
    const app = buildApp(createMockSupabase(), 'user-1');
    const res = await request(app).post('/api/trucks/t1/verify');
    expect(res.status).toBe(403);
  });

  it('verifies via supabaseAdmin, not the RLS-scoped client', async () => {
    // Regression test for the "infinite recursion detected in policy for
    // relation 'user_roles'" bug: this must go through supabaseAdmin
    // (adminStore), not req.supabase (mockSupabase's own trucks rows) —
    // seeding the truck only in adminStore.trucks proves the handler never
    // touches req.supabase.trucks for this write.
    adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    adminStore.trucks.push({ id: 't1', owner_id: 'user-1', registration_number: 'MH12AB1234', status: 'active', verified: false });

    const app = buildApp(createMockSupabase(), 'staff-1');
    const res = await request(app).post('/api/trucks/t1/verify');

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.verified_at).toBeTruthy();
  });

  it('404s for a truck that does not exist', async () => {
    adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    const app = buildApp(createMockSupabase(), 'staff-1');
    const res = await request(app).post('/api/trucks/does-not-exist/verify');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/trucks/queue', () => {
  it('rejects a non-staff caller with 403', async () => {
    const app = buildApp(createMockSupabase(), 'user-1');
    const res = await request(app).get('/api/trucks/queue');
    expect(res.status).toBe(403);
  });

  it('returns active, unverified trucks newest-first with owner and documents attached', async () => {
    adminStore.user_roles.push({ user_id: 'staff-1', role: 'admin' });
    adminStore.trucks.push(
      { id: 't1', owner_id: 'user-1', registration_number: 'MH12AB1234', status: 'active', verified: false, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 't2', owner_id: 'user-2', registration_number: 'DL1MQ8614', status: 'active', verified: false, created_at: '2026-02-01T00:00:00.000Z' },
      { id: 't3', owner_id: 'user-3', registration_number: 'HR55AR0995', status: 'active', verified: true, created_at: '2026-03-01T00:00:00.000Z' },
      { id: 't4', owner_id: 'user-4', registration_number: 'PB01XY9999', status: 'inactive', verified: false, created_at: '2026-03-02T00:00:00.000Z' }
    );
    adminStore.user_profiles.push(
      { user_id: 'user-1', full_name: 'Ravi Kumar', mobile: '+919000000001', city: 'Pune' },
      { user_id: 'user-2', full_name: 'Asha Devi', mobile: '+919000000002', city: 'Nashik' }
    );
    adminStore.truck_documents.push({
      truck_id: 't1',
      document_type: 'rc',
      file_name: 'rc.pdf',
      mime_type: 'application/pdf',
      uploaded_at: '2026-01-02T00:00:00.000Z',
      storage_path: 'user-1/t1/rc.pdf'
    });

    const app = buildApp(createMockSupabase(), 'staff-1');
    const res = await request(app).get('/api/trucks/queue');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2); // t3 (verified) and t4 (inactive) excluded
    expect(res.body[0].truck.id).toBe('t2'); // newest first
    expect(res.body[0].owner).toMatchObject({ full_name: 'Asha Devi' });
    expect(res.body[0].documents).toEqual([]);
    expect(res.body[1].truck.id).toBe('t1');
    expect(res.body[1].owner).toMatchObject({ full_name: 'Ravi Kumar' });
    expect(res.body[1].documents).toHaveLength(1);
    expect(res.body[1].documents[0].document_type).toBe('rc');
    expect(res.body[1].documents[0].url).toBe('https://example.com/view/user-1/t1/rc.pdf?ttl=300');
    expect(res.body[1].documents[0].storage_path).toBeUndefined(); // never sent to the client
  });

  it('returns an empty array when no trucks are pending', async () => {
    adminStore.user_roles.push({ user_id: 'staff-1', role: 'support_executive' });
    const app = buildApp(createMockSupabase(), 'staff-1');
    const res = await request(app).get('/api/trucks/queue');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
