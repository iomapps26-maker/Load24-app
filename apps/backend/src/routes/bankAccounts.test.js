import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// `mock`-prefixed so vitest's vi.mock hoisting check lets the factory below
// reference it (same pattern as kyc.test.js's mockAdminState).
const mockState = { signedUrlCalls: [] };

function createAdminStore() {
  return { user_roles: [], bank_details: [], user_profiles: [], audit_log: [] };
}
let adminStore = createAdminStore();

// Thenable at every step so any chain order the route uses resolves —
// .eq().order(), .eq().maybeSingle(), .in(), .update().eq().eq().select().maybeSingle().
function makeQueryBuilder(table) {
  const filters = [];
  let sort = null;
  const rows = () => adminStore[table] || [];
  const matching = () => rows().filter((r) => filters.every((f) => f(r)));

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
    maybeSingle: () => Promise.resolve({ data: matching()[0] ?? null, error: null }),
    insert: (row) => {
      (adminStore[table] ||= []).push(row);
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
            const match = rows().find((r) => updateFilters.every((f) => f(r)));
            if (!match) return Promise.resolve({ data: null, error: null });
            Object.assign(match, patch);
            return Promise.resolve({ data: match, error: null });
          }
        })
      };
      return updateBuilder;
    },
    then: (resolve) => {
      let data = matching();
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
      from: (bucket) => ({
        createSignedUrl: (path, ttl) => {
          mockState.signedUrlCalls.push({ bucket, path, ttl });
          return Promise.resolve({ data: { signedUrl: `https://example.com/view/${path}?ttl=${ttl}` }, error: null });
        }
      })
    },
    from: (table) => makeQueryBuilder(table)
  }
}));

vi.mock('../lib/notify.js', () => ({ notifyUser: vi.fn() }));

const { notifyUser } = await import('../lib/notify.js');
const { default: bankAccountsRouter } = await import('./bankAccounts.js');

beforeEach(() => {
  adminStore = createAdminStore();
  mockState.signedUrlCalls.length = 0;
  notifyUser.mockClear();
});

function buildApp(userId = 'staff-1') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/profile/bank-accounts', bankAccountsRouter);
  return app;
}

function seedStaff(userId = 'staff-1', role = 'admin') {
  adminStore.user_roles.push({ user_id: userId, role });
}

describe('GET /api/profile/bank-accounts/pending', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).get('/api/profile/bank-accounts/pending');
    expect(res.status).toBe(403);
  });

  it('returns pending accounts oldest-first with profile + a fresh signed proof url', async () => {
    seedStaff();
    adminStore.bank_details.push(
      {
        id: 'acc-2',
        user_id: 'user-2',
        account_holder_name: 'Priya Sharma',
        account_number: '9911xxxx',
        ifsc_code: 'ICIC0000123',
        bank_name: 'ICICI Bank',
        bank_branch: 'Andheri',
        account_type: 'current',
        proof_path: 'user-2/proof.jpg',
        verification_status: 'pending',
        created_at: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'acc-1',
        user_id: 'user-1',
        account_holder_name: 'Rajesh Kumar',
        account_number: '50100xxxx',
        ifsc_code: 'HDFC0001234',
        bank_name: 'HDFC Bank',
        proof_path: null,
        verification_status: 'pending',
        created_at: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'acc-3',
        user_id: 'user-3',
        account_holder_name: 'Done Already',
        verification_status: 'verified',
        created_at: '2026-01-15T00:00:00.000Z'
      }
    );
    adminStore.user_profiles.push({ user_id: 'user-1', full_name: 'Rajesh Kumar', mobile: '98xxxxxxx', city: 'Bengaluru' });

    const res = await request(buildApp()).get('/api/profile/bank-accounts/pending');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2); // acc-3 (verified) excluded
    expect(res.body[0].id).toBe('acc-1'); // oldest first
    expect(res.body[0].bank_account_holder_name).toBe('Rajesh Kumar');
    expect(res.body[0].bank_ifsc_code).toBe('HDFC0001234');
    expect(res.body[0].proof_url).toBeNull();
    expect(res.body[0].profile).toMatchObject({ full_name: 'Rajesh Kumar', city: 'Bengaluru' });
    expect(res.body[1].id).toBe('acc-2');
    expect(res.body[1].account_type).toBe('current');
    expect(res.body[1].proof_url).toBe('https://example.com/view/user-2/proof.jpg?ttl=300');
    expect(res.body[1].profile).toBeNull();
    // raw storage path never leaves the server
    expect(res.body[1].proof_path).toBeUndefined();
  });

  it('returns an empty array when nothing is pending', async () => {
    seedStaff('staff-1', 'support_manager');
    adminStore.bank_details.push({ id: 'acc-1', user_id: 'user-1', verification_status: 'rejected', created_at: '2026-01-01T00:00:00.000Z' });
    const res = await request(buildApp()).get('/api/profile/bank-accounts/pending');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /api/profile/bank-accounts/:id/verify', () => {
  it('rejects a non-staff caller with 403', async () => {
    const res = await request(buildApp('user-1')).post('/api/profile/bank-accounts/acc-1/verify');
    expect(res.status).toBe(403);
  });

  it('404s for an unknown id', async () => {
    seedStaff();
    const res = await request(buildApp()).post('/api/profile/bank-accounts/nope/verify');
    expect(res.status).toBe(404);
  });

  it('409s when the account is not pending', async () => {
    seedStaff();
    adminStore.bank_details.push({ id: 'acc-1', user_id: 'user-1', verification_status: 'verified' });
    const res = await request(buildApp()).post('/api/profile/bank-accounts/acc-1/verify');
    expect(res.status).toBe(409);
  });

  it('marks a pending account verified, clears rejection_reason, notifies the user', async () => {
    seedStaff();
    adminStore.bank_details.push({
      id: 'acc-1',
      user_id: 'user-1',
      account_holder_name: 'Rajesh Kumar',
      verification_status: 'pending',
      rejection_reason: 'old reason'
    });
    const res = await request(buildApp()).post('/api/profile/bank-accounts/acc-1/verify');

    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe('verified');
    expect(res.body.rejection_reason).toBeNull();
    expect(res.body.reviewed_by).toBe('staff-1');
    expect(res.body.reviewed_at).toBeTruthy();
    expect(notifyUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ type: 'bank_account_verified' }));
  });
});

describe('POST /api/profile/bank-accounts/:id/reject', () => {
  beforeEach(() => {
    seedStaff();
    adminStore.bank_details.push({ id: 'acc-1', user_id: 'user-1', verification_status: 'pending' });
  });

  it('400s when reason is missing or blank', async () => {
    expect((await request(buildApp()).post('/api/profile/bank-accounts/acc-1/reject')).status).toBe(400);
    expect((await request(buildApp()).post('/api/profile/bank-accounts/acc-1/reject').send({ reason: '   ' })).status).toBe(400);
  });

  it('409s when the account is not pending', async () => {
    adminStore.bank_details[0].verification_status = 'rejected';
    const res = await request(buildApp()).post('/api/profile/bank-accounts/acc-1/reject').send({ reason: 'name mismatch' });
    expect(res.status).toBe(409);
  });

  it('marks a pending account rejected with the reason and notifies the user', async () => {
    const res = await request(buildApp())
      .post('/api/profile/bank-accounts/acc-1/reject')
      .send({ reason: 'Account holder name does not match KYC' });

    expect(res.status).toBe(200);
    expect(res.body.verification_status).toBe('rejected');
    expect(res.body.rejection_reason).toBe('Account holder name does not match KYC');
    expect(res.body.reviewed_by).toBe('staff-1');
    expect(notifyUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ type: 'bank_account_rejected' }));
  });
});
