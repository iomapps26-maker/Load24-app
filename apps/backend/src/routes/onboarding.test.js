import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import onboardingRouter from './onboarding.js';

// In-memory stand-in for the Supabase query builder used by the route
// (req.supabase.from('user_business_roles').select(...).eq(...) / .insert(...)).
function createMockSupabase(seedRows = []) {
  let rows = [...seedRows];

  return {
    _rows: () => rows,
    from(table) {
      if (table !== 'user_business_roles') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            eq(field, value) {
              return Promise.resolve({
                data: rows.filter((r) => r[field] === value),
                error: null
              });
            }
          };
        },
        insert(newRows) {
          rows = rows.concat(newRows.map((r) => ({ status: 'active', ...r })));
          return Promise.resolve({ error: null });
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
  app.use('/api/onboarding', onboardingRouter);
  return app;
}

describe('POST /api/onboarding/select-role', () => {
  let mockSupabase;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
  });

  it('assigns a single role', async () => {
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/onboarding/select-role')
      .send({ roles: ['shipper'] });

    expect(res.status).toBe(201);
    expect(res.body.roles).toEqual(['shipper']);
  });

  it('assigns multiple roles at once (multi-role support)', async () => {
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/onboarding/select-role')
      .send({ roles: ['shipper', 'vehicle_owner'] });

    expect(res.status).toBe(201);
    expect(res.body.roles.sort()).toEqual(['shipper', 'vehicle_owner']);
  });

  it('appends new roles without overwriting existing ones', async () => {
    mockSupabase = createMockSupabase([{ user_id: 'user-1', role: 'shipper', status: 'active' }]);
    const app = buildApp(mockSupabase);

    const res = await request(app)
      .post('/api/onboarding/select-role')
      .send({ roles: ['driver'] });

    expect(res.status).toBe(201);
    expect(res.body.roles.sort()).toEqual(['driver', 'shipper']);
  });

  it('rejects a role already assigned to the user', async () => {
    mockSupabase = createMockSupabase([{ user_id: 'user-1', role: 'shipper', status: 'active' }]);
    const app = buildApp(mockSupabase);

    const res = await request(app)
      .post('/api/onboarding/select-role')
      .send({ roles: ['shipper'] });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/shipper/);
  });

  it('rejects duplicate roles within the same request', async () => {
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/onboarding/select-role')
      .send({ roles: ['shipper', 'shipper'] });

    expect(res.status).toBe(400);
  });

  it('rejects an unknown role', async () => {
    const app = buildApp(mockSupabase);
    const res = await request(app)
      .post('/api/onboarding/select-role')
      .send({ roles: ['astronaut'] });

    expect(res.status).toBe(400);
  });

  it('rejects an empty roles array', async () => {
    const app = buildApp(mockSupabase);
    const res = await request(app).post('/api/onboarding/select-role').send({ roles: [] });

    expect(res.status).toBe(400);
  });

  it('does not leak roles across users', async () => {
    mockSupabase = createMockSupabase([{ user_id: 'user-2', role: 'shipper', status: 'active' }]);
    const app = buildApp(mockSupabase, 'user-1');

    const res = await request(app)
      .post('/api/onboarding/select-role')
      .send({ roles: ['shipper'] });

    expect(res.status).toBe(201);
    expect(res.body.roles).toEqual(['shipper']);
  });
});
