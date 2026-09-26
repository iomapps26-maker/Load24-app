import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';

// In-memory tables + auth users. Just enough of the supabase-js query
// builder for executive.js itself — the user-facing routers it mounts are
// stubbed below, since what's under test is the act-as wiring, not loads.js
// or kyc.js again (they have their own tests).
const state = { tables: {}, authUsers: {}, createUserError: null, notifyCalls: [] };

function resetState() {
  state.tables = {
    user_profiles: [],
    user_roles: [],
    user_business_roles: [],
    loads: [],
    kyc_cases: [],
    notifications: [],
    audit_log: []
  };
  state.authUsers = {
    [USER_ID]: { id: USER_ID, email: 'wa919876543210@phone.load24.internal', phone: '919876543210' },
    [ADMIN_ID]: { id: ADMIN_ID, email: 'boss@load24.in' }
  };
  state.createUserError = null;
  state.notifyCalls = [];
}

function queryBuilder(table) {
  const filters = [];
  let pendingUpdate = null;
  let pendingInsert = null;
  const rows = () => (state.tables[table] ||= []);
  const matching = () => rows().filter((r) => filters.every((f) => f(r)));

  const result = () => {
    if (pendingInsert) {
      const saved = { id: `${table}-${rows().length + 1}`, ...pendingInsert };
      rows().push(saved);
      return { data: saved, error: null };
    }
    if (pendingUpdate) {
      const hit = matching();
      hit.forEach((r) => Object.assign(r, pendingUpdate));
      return { data: hit, error: null };
    }
    return { data: matching(), error: null };
  };

  const b = {
    select: () => b,
    eq: (field, value) => {
      if (field === 'data->>section') filters.push((r) => r.data?.section === value);
      else filters.push((r) => r[field] === value);
      return b;
    },
    gte: (field, value) => {
      filters.push((r) => r[field] >= value);
      return b;
    },
    like: () => b,
    or: (expr) => {
      const needle = expr.split(',')[0].split('.')[2].replace(/%/g, '').toLowerCase();
      filters.push((r) => [r.full_name, r.mobile, r.user_email, r.company_name].some((v) => String(v || '').toLowerCase().includes(needle)));
      return b;
    },
    order: () => b,
    limit: () => b,
    update: (patch) => {
      pendingUpdate = patch;
      return b;
    },
    insert: (row) => {
      pendingInsert = row;
      return b;
    },
    maybeSingle: () => {
      const { data, error } = result();
      return Promise.resolve({ data: Array.isArray(data) ? data[0] ?? null : data, error });
    },
    single: () => {
      const { data, error } = result();
      return Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error });
    },
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject)
  };
  return b;
}

const supabaseAdmin = {
  from: (table) => queryBuilder(table),
  auth: {
    admin: {
      getUserById: (id) =>
        Promise.resolve(state.authUsers[id] ? { data: { user: state.authUsers[id] }, error: null } : { data: { user: null }, error: { message: 'not found' } }),
      createUser: (attrs) => {
        if (state.createUserError) return Promise.resolve({ data: { user: null }, error: state.createUserError });
        const user = { id: '44444444-4444-4444-8444-444444444444', ...attrs };
        state.authUsers[user.id] = user;
        return Promise.resolve({ data: { user }, error: null });
      },
      generateLink: ({ email }) => {
        const user = Object.values(state.authUsers).find((u) => u.email === email);
        return Promise.resolve({ data: { user: user ?? null }, error: user ? null : { message: 'not found' } });
      }
    }
  }
};

vi.mock('../lib/supabase.js', () => ({ supabaseAdmin }));
vi.mock('../lib/notify.js', () => ({
  notifyUser: (userId, event) => {
    state.notifyCalls.push({ userId, ...event });
    state.tables.notifications.push({ user_id: userId, type: event.type, data: event.data, created_at: new Date().toISOString() });
    return Promise.resolve();
  }
}));

// Each stubbed section router records who the request ran as and answers
// like its real counterpart would.
const seen = [];
function stubRouter(name, handlers) {
  return async () => {
    const { Router } = await import('express');
    const r = Router();
    r.use((req, res, next) => {
      seen.push({ section: name, method: req.method, path: req.path, userId: req.user.id, email: req.user.email, supabase: req.supabase, staffId: req.staffUser?.id });
      next();
    });
    handlers(r);
    return { default: r };
  };
}

vi.mock('./profile.js', stubRouter('profile', (r) => {
  r.get('/me', (req, res) => res.json({ user_id: req.user.id }));
  r.post('/', (req, res) => res.status(201).json({ user_id: req.user.id }));
  r.delete('/', (req, res) => res.status(204).end());
}));
vi.mock('./kyc.js', stubRouter('kyc', (r) => {
  r.post('/documents/upload-url', (req, res) => res.json({ storage_path: `${req.user.id}/pan.jpg`, signed_url: 'x', token: 't' }));
  r.post('/documents', (req, res) => res.json({ document: { document_type: req.body.document_type }, case_status: 'partial' }));
}));
vi.mock('./bankDetails.js', stubRouter('bank', (r) => {
  r.post('/', (req, res) => res.status(201).json({ id: 'bank-1', user_id: req.user.id }));
}));
vi.mock('./loads.js', stubRouter('loads', (r) => {
  r.post('/', (req, res) => {
    if (!req.body.loading_city) return res.status(400).json({ error: 'loading_city required' });
    const load = { id: 'load-1', posted_by: req.user.email, loading_city: req.body.loading_city, unloading_city: 'Mumbai' };
    state.tables.loads.push({ ...load });
    res.status(201).json(load);
  });
}));
vi.mock('./trucks.js', stubRouter('trucks', (r) => {
  r.get('/queue', (req, res) => res.json([]));
}));
vi.mock('./truckAvailability.js', stubRouter('availability', () => {}));

const { default: executiveRouter } = await import('./executive.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: STAFF_ID, email: 'ravi@staff.load24.internal' };
    req.supabase = { marker: 'staff-rls-client' };
    next();
  });
  app.use('/api/executive', executiveRouter);
  return app;
}

beforeEach(() => {
  resetState();
  seen.length = 0;
  state.tables.kyc_cases.push({ id: 'case-1', user_id: USER_ID });
});

describe('acting as a user', () => {
  it('runs the real section route as the target user with the service-role client', async () => {
    const res = await request(buildApp()).post(`/api/executive/users/${USER_ID}/loads`).send({ loading_city: 'Delhi' });

    expect(res.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ section: 'loads', userId: USER_ID, email: 'wa919876543210@phone.load24.internal', staffId: STAFF_ID });
    expect(seen[0].supabase).toBe(supabaseAdmin);
    expect(res.body.posted_by).toBe('wa919876543210@phone.load24.internal');
  });

  it('stamps the created row "by Support Team" and returns the stamp', async () => {
    const res = await request(buildApp()).post(`/api/executive/users/${USER_ID}/loads`).send({ loading_city: 'Delhi' });

    expect(res.body.support_staff_id).toBe(STAFF_ID);
    expect(state.tables.loads[0].support_staff_id).toBe(STAFF_ID);
    expect(state.tables.loads[0].support_action_at).toBeTruthy();
  });

  it('notifies the user once per section even across several writes', async () => {
    const app = buildApp();
    await request(app).post(`/api/executive/users/${USER_ID}/kyc/documents`).send({ document_type: 'pan', storage_path: `${USER_ID}/pan.jpg` });
    await request(app).post(`/api/executive/users/${USER_ID}/kyc/documents`).send({ document_type: 'aadhaar', storage_path: `${USER_ID}/aadhaar.jpg` });

    expect(state.notifyCalls).toHaveLength(1);
    expect(state.notifyCalls[0]).toMatchObject({ userId: USER_ID, type: 'support_team_action', data: { section: 'kyc' } });
    expect(state.tables.kyc_cases[0].support_staff_id).toBe(STAFF_ID);
  });

  it('does not stamp or notify when the section route fails', async () => {
    const res = await request(buildApp()).post(`/api/executive/users/${USER_ID}/loads`).send({});

    expect(res.status).toBe(400);
    expect(state.tables.loads).toHaveLength(0);
    expect(state.notifyCalls).toHaveLength(0);
  });

  it('does not stamp when only an upload URL was minted', async () => {
    const res = await request(buildApp()).post(`/api/executive/users/${USER_ID}/kyc/documents/upload-url`).send({ document_type: 'pan' });

    expect(res.status).toBe(200);
    expect(state.tables.kyc_cases[0].support_staff_id).toBeUndefined();
    expect(state.notifyCalls).toHaveLength(0);
  });

  it('blocks endpoints outside the allowlist, e.g. deleting the account or staff queues', async () => {
    const app = buildApp();
    const del = await request(app).delete(`/api/executive/users/${USER_ID}/profile`);
    const queue = await request(app).get(`/api/executive/users/${USER_ID}/trucks/queue`);

    expect(del.status).toBe(404);
    expect(queue.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('refuses to act as a staff account', async () => {
    state.tables.user_roles.push({ user_id: ADMIN_ID, role: 'admin' });
    const res = await request(buildApp()).get(`/api/executive/users/${ADMIN_ID}/profile/me`);

    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('404s an unknown or malformed user id', async () => {
    const app = buildApp();
    expect((await request(app).get('/api/executive/users/55555555-5555-4555-8555-555555555555/profile/me')).status).toBe(404);
    expect((await request(app).get('/api/executive/users/not-a-uuid/profile/me')).status).toBe(404);
  });
});

describe('POST /api/executive/users (register a caller)', () => {
  it('creates the phone-login auth user and a support-stamped profile', async () => {
    const res = await request(buildApp())
      .post('/api/executive/users')
      .send({ mobile: '9123456789', full_name: 'Suresh Transport', user_type: 'transporter', city: 'Jaipur' });

    expect(res.status).toBe(201);
    const created = state.authUsers[res.body.user_id];
    expect(created).toMatchObject({ email: 'wa919123456789@phone.load24.internal', phone_confirm: true });
    expect(state.tables.user_profiles[0]).toMatchObject({
      user_id: res.body.user_id,
      user_email: 'wa919123456789@phone.load24.internal',
      user_type: 'transporter',
      mobile_verified: true,
      support_staff_id: STAFF_ID
    });
    expect(state.tables.user_business_roles[0]).toMatchObject({ user_id: res.body.user_id, role: 'transporter' });
  });

  it('409s with the existing user id when the mobile is already registered', async () => {
    state.tables.user_profiles.push({ user_id: USER_ID, mobile: '+919876543210' });
    const res = await request(buildApp())
      .post('/api/executive/users')
      .send({ mobile: '98765 43210', full_name: 'Dup', user_type: 'shipper' });

    expect(res.status).toBe(409);
    expect(res.body.user_id).toBe(USER_ID);
  });

  it('reuses an auth user left behind by an unfinished WhatsApp sign-up', async () => {
    state.createUserError = { message: 'A user with this email address has already been registered' };
    state.authUsers['66666666-6666-4666-8666-666666666666'] = { id: '66666666-6666-4666-8666-666666666666', email: 'wa919000000001@phone.load24.internal' };

    const res = await request(buildApp())
      .post('/api/executive/users')
      .send({ mobile: '9000000001', full_name: 'Half Signed Up', user_type: 'driver' });

    expect(res.status).toBe(201);
    expect(res.body.user_id).toBe('66666666-6666-4666-8666-666666666666');
  });

  it('rejects an unknown user_type', async () => {
    const res = await request(buildApp()).post('/api/executive/users').send({ mobile: '9123456789', full_name: 'X', user_type: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/executive/users', () => {
  it('searches profiles', async () => {
    state.tables.user_profiles.push({ user_id: USER_ID, full_name: 'Ramesh Roadlines', mobile: '+919876543210' });
    const res = await request(buildApp()).get('/api/executive/users?q=ramesh');
    expect(res.body.users.map((u) => u.user_id)).toEqual([USER_ID]);
  });

  it('returns nothing for an empty query', async () => {
    const res = await request(buildApp()).get('/api/executive/users?q=');
    expect(res.body.users).toEqual([]);
  });
});
