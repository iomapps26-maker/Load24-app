import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const ADMIN_ID = 'admin-1';
const state = { authUsers: {}, userRoles: [], roleInsertError: null, deleted: [], updates: [] };

function resetState() {
  state.authUsers = {};
  state.userRoles = [];
  state.roleInsertError = null;
  state.deleted = [];
  state.updates = [];
}

// user_roles: select/eq/order/maybeSingle + insert — the only table this
// router touches.
function userRolesBuilder() {
  const filters = [];
  const matching = () => state.userRoles.filter((r) => filters.every((f) => f(r)));
  const b = {
    select: () => b,
    eq: (field, value) => {
      filters.push((r) => r[field] === value);
      return b;
    },
    order: () => b,
    maybeSingle: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
    insert: (row) => {
      if (state.roleInsertError) return Promise.resolve({ error: state.roleInsertError });
      state.userRoles.push({ ...row, created_at: new Date().toISOString() });
      return Promise.resolve({ error: null });
    },
    then: (resolve, reject) => Promise.resolve({ data: matching(), error: null }).then(resolve, reject)
  };
  return b;
}

vi.mock('../../lib/supabase.js', () => ({
  supabaseAdmin: {
    from: () => userRolesBuilder(),
    auth: {
      admin: {
        createUser: (attrs) => {
          if (Object.values(state.authUsers).some((u) => u.email === attrs.email)) {
            return Promise.resolve({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } });
          }
          const user = { id: `exec-${Object.keys(state.authUsers).length + 1}`, created_at: '2026-09-24T00:00:00Z', ...attrs };
          state.authUsers[user.id] = user;
          return Promise.resolve({ data: { user }, error: null });
        },
        getUserById: (id) => Promise.resolve({ data: { user: state.authUsers[id] ?? null }, error: null }),
        updateUserById: (id, attrs) => {
          state.updates.push({ id, attrs });
          const user = { ...state.authUsers[id] };
          if (attrs.ban_duration && attrs.ban_duration !== 'none') user.banned_until = '2126-01-01T00:00:00Z';
          if (attrs.ban_duration === 'none') user.banned_until = null;
          state.authUsers[id] = user;
          return Promise.resolve({ data: { user }, error: null });
        },
        deleteUser: (id) => {
          state.deleted.push(id);
          delete state.authUsers[id];
          return Promise.resolve({ error: null });
        }
      }
    }
  }
}));

const { default: staffAccountsRouter } = await import('./staffAccounts.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: ADMIN_ID };
    next();
  });
  app.use('/api/admin/staff-accounts', staffAccountsRouter);
  return app;
}

beforeEach(resetState);

describe('POST /api/admin/staff-accounts', () => {
  it('turns a bare login ID into a staff email and grants desk_executive', async () => {
    const res = await request(buildApp())
      .post('/api/admin/staff-accounts')
      .send({ login_id: 'Ravi.K', password: 'longenough', full_name: 'Ravi Kumar' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ login_id: 'ravi.k', email: 'ravi.k@staff.load24.internal', full_name: 'Ravi Kumar', role: 'desk_executive', disabled: false });
    expect(state.userRoles).toEqual([expect.objectContaining({ user_id: res.body.user_id, role: 'desk_executive', granted_by: ADMIN_ID })]);
    expect(state.authUsers[res.body.user_id]).toMatchObject({ password: 'longenough', email_confirm: true });
  });

  it('accepts a real email as the login ID', async () => {
    const res = await request(buildApp())
      .post('/api/admin/staff-accounts')
      .send({ login_id: 'priya@load24.in', password: 'longenough', full_name: 'Priya' });
    expect(res.body.login_id).toBe('priya@load24.in');
  });

  it('409s a taken login ID', async () => {
    const app = buildApp();
    await request(app).post('/api/admin/staff-accounts').send({ login_id: 'ravi', password: 'longenough', full_name: 'A' });
    const res = await request(app).post('/api/admin/staff-accounts').send({ login_id: 'ravi', password: 'longenough', full_name: 'B' });
    expect(res.status).toBe(409);
  });

  it('rejects a short password or a malformed login ID', async () => {
    const app = buildApp();
    expect((await request(app).post('/api/admin/staff-accounts').send({ login_id: 'ravi', password: 'short', full_name: 'A' })).status).toBe(400);
    expect((await request(app).post('/api/admin/staff-accounts').send({ login_id: 'r v', password: 'longenough', full_name: 'A' })).status).toBe(400);
    expect(Object.keys(state.authUsers)).toHaveLength(0);
  });

  it('deletes the login again if the role grant fails', async () => {
    state.roleInsertError = { message: 'boom' };
    const res = await request(buildApp()).post('/api/admin/staff-accounts').send({ login_id: 'ravi', password: 'longenough', full_name: 'A' });

    expect(res.status).toBe(400);
    expect(state.deleted).toHaveLength(1);
    expect(Object.keys(state.authUsers)).toHaveLength(0);
  });
});

describe('managing an existing executive', () => {
  async function createExecutive(app) {
    const res = await request(app).post('/api/admin/staff-accounts').send({ login_id: 'ravi', password: 'longenough', full_name: 'Ravi' });
    return res.body.user_id;
  }

  it('lists executives', async () => {
    const app = buildApp();
    const id = await createExecutive(app);
    const res = await request(app).get('/api/admin/staff-accounts');
    expect(res.body.accounts.map((a) => a.user_id)).toEqual([id]);
  });

  it('resets a password', async () => {
    const app = buildApp();
    const id = await createExecutive(app);
    const res = await request(app).post(`/api/admin/staff-accounts/${id}/password`).send({ password: 'brandnewpass' });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ id, attrs: { password: 'brandnewpass' } }]);
  });

  it('disables and re-enables sign-in', async () => {
    const app = buildApp();
    const id = await createExecutive(app);
    expect((await request(app).post(`/api/admin/staff-accounts/${id}/disable`)).body.disabled).toBe(true);
    expect((await request(app).post(`/api/admin/staff-accounts/${id}/enable`)).body.disabled).toBe(false);
  });

  it('refuses to touch an account that is not a support executive', async () => {
    state.authUsers['someone'] = { id: 'someone', email: 'boss@load24.in' };
    state.userRoles.push({ user_id: 'someone', role: 'admin' });
    const res = await request(buildApp()).post('/api/admin/staff-accounts/someone/password').send({ password: 'brandnewpass' });
    expect(res.status).toBe(404);
    expect(state.updates).toHaveLength(0);
  });
});
